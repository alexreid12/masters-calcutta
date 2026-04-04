import type { PayoutRule, PayoutRuleType, LeaderboardEntry, Ownership, Score, Golfer } from '@/types/database';

export interface PayoutResult {
  golfer_id: string;
  golfer_name: string;
  owner_id: string;
  owner_name: string;
  finish_position: number;       // ordinal for position rules; rule.finish_position for specials
  purchase_price: number;
  payout_amount: number;
  net_profit: number;
  payout_rule_id: string | null;
  rule_type: PayoutRuleType;
  applied_percentage: number;
  // For special awards — human-readable description of why they won
  award_label: string;
  award_score?: number | null;   // the score_to_par that triggered the award
  award_round?: number | null;
}

export interface PayoutCalculationInput {
  totalPot: number;
  leaderboard: LeaderboardEntry[];
  rules: PayoutRule[];
  ownerships: Ownership[];
  scores: Score[];               // per-round scores for low/high round awards
  golfers: Golfer[];             // full golfer list for is_amateur flag
}

// ── Position payouts ─────────────────────────────────────────────────────────

function calcPositionPayouts(
  totalPot: number,
  leaderboard: LeaderboardEntry[],
  rules: PayoutRule[],
  ownerships: Ownership[]
): PayoutResult[] {
  const positionRules = rules
    .filter((r) => r.is_active && r.rule_type === 'position')
    .sort((a, b) => a.finish_position - b.finish_position);

  const finishers = leaderboard
    .filter((e) => e.total_to_par !== null && e.golfer_status !== 'withdrawn')
    .sort((a, b) => (a.total_to_par ?? 999) - (b.total_to_par ?? 999));

  // Assign ordinal positions, accounting for ties
  const positionMap = new Map<string, number>();
  let ordinal = 1;
  let i = 0;
  while (i < finishers.length) {
    const score = finishers[i].total_to_par;
    let j = i;
    while (j < finishers.length && finishers[j].total_to_par === score) j++;
    for (let k = i; k < j; k++) positionMap.set(finishers[k].golfer_id, ordinal);
    ordinal = j + 1;
    i = j;
  }

  const results: PayoutResult[] = [];
  const processedPositions = new Set<number>();

  for (const golfer of finishers) {
    const pos = positionMap.get(golfer.golfer_id);
    if (!pos || processedPositions.has(pos)) continue;
    processedPositions.add(pos);

    const tiedGolfers = finishers.filter((g) => positionMap.get(g.golfer_id) === pos);
    const tieCount = tiedGolfers.length;

    // Combine all rules spanned by the tied group
    const coveredRules = positionRules.filter(
      (r) => r.finish_position >= pos && r.finish_position < pos + tieCount
    );
    if (coveredRules.length === 0) continue;

    const totalPct = coveredRules.reduce((sum, r) => sum + r.payout_percentage, 0);
    const perGolferPct = totalPct / tieCount;
    const perGolferAmount = (totalPot * perGolferPct) / 100;
    const primaryRule = coveredRules[0];

    for (const g of tiedGolfers) {
      const ownership = ownerships.find((o) => o.golfer_id === g.golfer_id);
      if (!ownership) continue;

      results.push({
        golfer_id: g.golfer_id,
        golfer_name: g.name,
        owner_id: ownership.user_id,
        owner_name: g.owner_name ?? 'Unknown',
        finish_position: pos,
        purchase_price: ownership.purchase_price,
        payout_amount: round2(perGolferAmount),
        net_profit: round2(perGolferAmount - ownership.purchase_price),
        payout_rule_id: primaryRule.id,
        rule_type: 'position',
        applied_percentage: perGolferPct,
        award_label: tieCount > 1 ? `T${pos}` : ordinalLabel(pos),
      });
    }
  }

  return results;
}

// ── Low Round awards (per day) ────────────────────────────────────────────────

function calcLowRoundPayouts(
  totalPot: number,
  roundNum: number,
  rule: PayoutRule,
  scores: Score[],
  ownerships: Ownership[],
  leaderboard: LeaderboardEntry[]
): PayoutResult[] {
  const roundScores = scores.filter(
    (s) => s.round === roundNum && s.score_to_par !== null
  );
  if (roundScores.length === 0) return [];

  const minScore = Math.min(...roundScores.map((s) => s.score_to_par!));
  const lowGolfers = roundScores.filter((s) => s.score_to_par === minScore);

  const pctEach = rule.payout_percentage / lowGolfers.length;
  const amountEach = round2((totalPot * pctEach) / 100);

  return lowGolfers.flatMap((s) => {
    const ownership = ownerships.find((o) => o.golfer_id === s.golfer_id);
    if (!ownership) return [];
    const entry = leaderboard.find((e) => e.golfer_id === s.golfer_id);
    return [{
      golfer_id: s.golfer_id,
      golfer_name: entry?.name ?? s.golfer_id,
      owner_id: ownership.user_id,
      owner_name: entry?.owner_name ?? 'Unknown',
      finish_position: rule.finish_position,   // negative sentinel
      purchase_price: ownership.purchase_price,
      payout_amount: amountEach,
      net_profit: round2(amountEach - ownership.purchase_price),
      payout_rule_id: rule.id,
      rule_type: 'low_round' as PayoutRuleType,
      applied_percentage: pctEach,
      award_label: rule.label,
      award_score: minScore,
      award_round: roundNum,
    }];
  });
}

// ── High Round award (worst single-round score, made-cut golfers only) ───────

function calcHighRoundPayout(
  totalPot: number,
  rule: PayoutRule,
  scores: Score[],
  ownerships: Ownership[],
  leaderboard: LeaderboardEntry[]
): PayoutResult[] {
  // Only golfers who made the cut (not missed_cut or withdrawn)
  const madecut = new Set(
    leaderboard
      .filter((e) => e.golfer_status === 'active')
      .map((e) => e.golfer_id)
  );

  const eligible = scores.filter(
    (s) => s.score_to_par !== null && madecut.has(s.golfer_id)
  );
  if (eligible.length === 0) return [];

  const maxScore = Math.max(...eligible.map((s) => s.score_to_par!));
  const highGolfers = eligible.filter((s) => s.score_to_par === maxScore);

  // Deduplicate — a golfer might have the same bad score in multiple rounds
  const seen = new Set<string>();
  const uniqueHigh = highGolfers.filter((s) => {
    if (seen.has(s.golfer_id)) return false;
    seen.add(s.golfer_id);
    return true;
  });

  const pctEach = rule.payout_percentage / uniqueHigh.length;
  const amountEach = round2((totalPot * pctEach) / 100);

  return uniqueHigh.flatMap((s) => {
    const ownership = ownerships.find((o) => o.golfer_id === s.golfer_id);
    if (!ownership) return [];
    const entry = leaderboard.find((e) => e.golfer_id === s.golfer_id);
    return [{
      golfer_id: s.golfer_id,
      golfer_name: entry?.name ?? s.golfer_id,
      owner_id: ownership.user_id,
      owner_name: entry?.owner_name ?? 'Unknown',
      finish_position: rule.finish_position,
      purchase_price: ownership.purchase_price,
      payout_amount: amountEach,
      net_profit: round2(amountEach - ownership.purchase_price),
      payout_rule_id: rule.id,
      rule_type: 'high_round' as PayoutRuleType,
      applied_percentage: pctEach,
      award_label: rule.label,
      award_score: maxScore,
      award_round: s.round,
    }];
  });
}

// ── Low Amateur award ─────────────────────────────────────────────────────────

function calcLowAmateurPayout(
  totalPot: number,
  rule: PayoutRule,
  leaderboard: LeaderboardEntry[],
  ownerships: Ownership[],
  golfers: Golfer[]
): PayoutResult[] {
  if (rule.payout_percentage === 0) return []; // placeholder — no money, skip

  const amateurIds = new Set(golfers.filter((g) => g.is_amateur).map((g) => g.id));
  const amateurs = leaderboard
    .filter((e) => amateurIds.has(e.golfer_id) && e.total_to_par !== null && e.golfer_status !== 'withdrawn')
    .sort((a, b) => (a.total_to_par ?? 999) - (b.total_to_par ?? 999));

  if (amateurs.length === 0) return [];

  const bestScore = amateurs[0].total_to_par!;
  const tied = amateurs.filter((e) => e.total_to_par === bestScore);

  const pctEach = rule.payout_percentage / tied.length;
  const amountEach = round2((totalPot * pctEach) / 100);

  return tied.flatMap((e) => {
    const ownership = ownerships.find((o) => o.golfer_id === e.golfer_id);
    if (!ownership) return [];
    return [{
      golfer_id: e.golfer_id,
      golfer_name: e.name,
      owner_id: ownership.user_id,
      owner_name: e.owner_name ?? 'Unknown',
      finish_position: rule.finish_position,
      purchase_price: ownership.purchase_price,
      payout_amount: amountEach,
      net_profit: round2(amountEach - ownership.purchase_price),
      payout_rule_id: rule.id,
      rule_type: 'low_amateur' as PayoutRuleType,
      applied_percentage: pctEach,
      award_label: rule.label,
      award_score: bestScore,
    }];
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function calculatePayouts(input: PayoutCalculationInput): PayoutResult[] {
  const { totalPot, leaderboard, rules, ownerships, scores, golfers } = input;
  const activeRules = rules.filter((r) => r.is_active);

  const results: PayoutResult[] = [
    ...calcPositionPayouts(totalPot, leaderboard, activeRules, ownerships),
  ];

  for (const rule of activeRules) {
    switch (rule.rule_type) {
      case 'low_round':
        if (rule.round_number !== null) {
          results.push(
            ...calcLowRoundPayouts(totalPot, rule.round_number, rule, scores, ownerships, leaderboard)
          );
        }
        break;
      case 'high_round':
        results.push(...calcHighRoundPayout(totalPot, rule, scores, ownerships, leaderboard));
        break;
      case 'low_amateur':
        results.push(...calcLowAmateurPayout(totalPot, rule, leaderboard, ownerships, golfers));
        break;
    }
  }

  return results;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ordinalLabel(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatScoreToPar(score: number | null): string {
  if (score === null) return '-';
  if (score === 0) return 'E';
  return score > 0 ? `+${score}` : `${score}`;
}
