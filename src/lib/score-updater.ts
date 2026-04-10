/**
 * Core score update logic — used by both the Vercel cron job and the
 * manual "Refresh Scores Now" admin button.
 *
 * Data source priority:
 *   1. masters.com JSON feed  (authoritative — browser headers required)
 *   2. ESPN scoreboard API    (fallback)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMastersData } from '@/lib/masters';
import {
  fetchScoreboard,
  findMastersEvent,
  getCompetitors,
  parseScoreToPar,
  parsePosition,
  parseGolferStatus,
  parseRoundScores,
  normalizeName,
} from '@/lib/espn';

export interface UpdateResult {
  updated: number;
  skipped: number;
  errors: number;
  eventName: string | null;
  roundInProgress: boolean;
  dataSource: 'masters.com' | 'espn' | 'none';
}

type DbGolfer = { id: string; name: string; sportsdata_player_id: number | null; is_amateur: boolean };

// ── Shared DB upsert ──────────────────────────────────────────────────────────

interface RoundRow {
  round: number;
  scoreToPar: number;
  strokes: number;
  thru: number;
}

interface PlayerUpdate {
  dbGolferId: string;
  isAmateur: boolean;
  wasAmateur: boolean;
  golferStatus: 'active' | 'missed_cut' | 'withdrawn';
  totalToPar: number | null;
  position: number | null;
  positionDisplay: string | null;
  rounds: RoundRow[];
}

async function upsertPlayerScores(
  supabase: SupabaseClient,
  poolId: string,
  player: PlayerUpdate,
  result: UpdateResult
) {
  // Update golfer row
  const golferUpdate: Record<string, unknown> = { status: player.golferStatus };
  if (player.isAmateur && !player.wasAmateur) golferUpdate.is_amateur = true;
  await supabase.from('golfers').update(golferUpdate).eq('id', player.dbGolferId);

  if (player.rounds.length === 0) {
    result.skipped++;
    return;
  }

  const lastRound = player.rounds[player.rounds.length - 1].round;

  for (const rs of player.rounds) {
    const isLastKnown = rs.round === lastRound;
    const { error } = await supabase.from('scores').upsert(
      {
        pool_id: poolId,
        golfer_id: player.dbGolferId,
        round: rs.round,
        score_to_par: rs.scoreToPar,
        total_to_par: player.totalToPar,
        thru: rs.thru,
        position: isLastKnown ? player.position : null,
        position_display: isLastKnown ? player.positionDisplay : null,
        is_active: player.golferStatus === 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'pool_id,golfer_id,round' }
    );
    if (error) {
      console.error('[score-updater] upsert error:', error.message);
      result.errors++;
    } else {
      result.updated++;
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function updateScoresForPool(
  supabase: SupabaseClient,
  poolId: string,
  eventIdOverride?: string
): Promise<UpdateResult> {
  const result: UpdateResult = {
    updated: 0,
    skipped: 0,
    errors: 0,
    eventName: null,
    roundInProgress: false,
    dataSource: 'none',
  };

  // ── Load pool's golfers once ──────────────────────────────────────────────
  const { data: dbGolfers } = await supabase
    .from('golfers')
    .select('id, name, sportsdata_player_id, is_amateur')
    .eq('pool_id', poolId);

  if (!dbGolfers || dbGolfers.length === 0) return result;

  const byNormalizedName = new Map<string, DbGolfer>(
    dbGolfers.map((g) => [normalizeName(g.name), g])
  );
  const byEspnId = new Map<string, DbGolfer>(
    dbGolfers
      .filter((g) => g.sportsdata_player_id !== null)
      .map((g) => [String(g.sportsdata_player_id), g])
  );

  // ── 1. Try masters.com (primary) ──────────────────────────────────────────
  const mastersData = await fetchMastersData();

  if (mastersData) {
    result.dataSource = 'masters.com';
    result.eventName = 'Masters Tournament';
    result.roundInProgress = mastersData.entries.some(
      (e) => e.thru > 0 && e.thru < 18 && e.golferStatus === 'active'
    );
    console.log(
      `[score-updater] Fetched scores from masters.com (${mastersData.entries.length} players) — ${mastersData.sourceUrl}`
    );

    for (const entry of mastersData.entries) {
      const dbGolfer = byNormalizedName.get(entry.normalizedName) ?? null;
      if (!dbGolfer) {
        result.skipped++;
        continue;
      }
      await upsertPlayerScores(supabase, poolId, {
        dbGolferId: dbGolfer.id,
        isAmateur: entry.isAmateur,
        wasAmateur: dbGolfer.is_amateur,
        golferStatus: entry.golferStatus,
        totalToPar: entry.totalToPar,
        position: entry.position,
        positionDisplay: entry.positionDisplay,
        rounds: entry.rounds,
      }, result);
    }
  } else {
    // ── 2. Fall back to ESPN ────────────────────────────────────────────────
    console.log('[score-updater] masters.com unavailable — falling back to ESPN API');

    let scoreboardData;
    try {
      scoreboardData = await fetchScoreboard(eventIdOverride);
    } catch (err) {
      console.error('[score-updater] ESPN fetch failed:', err);
      result.errors++;
      return result;
    }

    const event = findMastersEvent(scoreboardData);
    if (!event) {
      const names = (scoreboardData.events ?? []).map((e) => e.name).join(', ');
      console.warn(`[score-updater] Masters event not found. Available events: [${names || 'none'}]`);
      return result;
    }

    result.dataSource = 'espn';
    result.eventName = event.name;

    const competitors = getCompetitors(event);
    result.roundInProgress = competitors.some(
      (c) => (c.status?.thru ?? 0) > 0 && (c.status?.thru ?? 0) < 18
    );
    console.log(`[score-updater] Fetched scores from ESPN (${competitors.length} players)`);

    for (const comp of competitors) {
      // ESPN ID match first, then normalized name fallback
      const dbGolfer =
        byEspnId.get(comp.athlete.id) ??
        byNormalizedName.get(normalizeName(comp.athlete.displayName)) ??
        null;

      if (!dbGolfer) {
        result.skipped++;
        continue;
      }

      const golferStatus = parseGolferStatus(comp);
      const totalToPar = parseScoreToPar(comp.score?.displayValue);
      const posDisplay = comp.status?.position?.displayName ?? null;
      const position = parsePosition(posDisplay);
      const currentRound = comp.status?.period ?? 1;
      const thru = comp.status?.thru ?? 0;

      const roundScores = parseRoundScores(comp);
      const lastKnownRound =
        roundScores.find((rs) => rs.round === currentRound)?.round ??
        roundScores[roundScores.length - 1]?.round ??
        currentRound;

      await upsertPlayerScores(supabase, poolId, {
        dbGolferId: dbGolfer.id,
        isAmateur: comp.athlete.amateur ?? false,
        wasAmateur: dbGolfer.is_amateur,
        golferStatus,
        totalToPar,
        position,
        positionDisplay: posDisplay,
        rounds: roundScores.map((rs) => ({
          round: rs.round,
          scoreToPar: rs.score_to_par,
          strokes: rs.strokes,
          thru: rs.round === currentRound ? thru : 18,
        })).filter((rs) => rs.round <= lastKnownRound || rs.round === currentRound),
      }, result);
    }
  }

  // ── 3. Update pool score_source metadata ─────────────────────────────────
  // Requires migration 014_score_source.sql to have been applied.
  const { error: metaError } = await supabase
    .from('pools')
    .update({
      score_source: result.dataSource,
      score_updated_at: new Date().toISOString(),
    })
    .eq('id', poolId);
  if (metaError) {
    // Non-fatal: columns may not exist yet if migration hasn't run
    console.warn('[score-updater] Could not update score_source metadata:', metaError.message);
  }

  return result;
}
