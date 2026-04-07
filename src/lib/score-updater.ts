/**
 * Core score update logic — used by both the Vercel cron job and the
 * manual "Refresh Scores Now" admin button.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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
}

/**
 * Fetch ESPN data and upsert scores for a single pool.
 * Returns a result summary without throwing (errors are counted, not raised).
 */
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
  };

  // ── 1. Fetch ESPN scoreboard ──────────────────────────────────────────────
  let scoreboardData;
  try {
    scoreboardData = await fetchScoreboard(eventIdOverride);
  } catch (err) {
    console.error('[score-updater] ESPN fetch failed:', err);
    result.errors++;
    return result;
  }

  // ── 2. Find the Masters event ─────────────────────────────────────────────
  const event = findMastersEvent(scoreboardData);
  if (!event) {
    console.warn('[score-updater] Masters event not found in ESPN response');
    return result;
  }
  result.eventName = event.name;

  const competitors = getCompetitors(event);
  if (competitors.length === 0) {
    console.warn('[score-updater] No competitors found in event');
    return result;
  }

  // Check if any round is actively in progress (someone is mid-round)
  result.roundInProgress = competitors.some(
    (c) => (c.status?.thru ?? 0) > 0 && (c.status?.thru ?? 0) < 18
  );

  // ── 3. Load this pool's golfers ───────────────────────────────────────────
  const { data: dbGolfers } = await supabase
    .from('golfers')
    .select('id, name, sportsdata_player_id, is_amateur')
    .eq('pool_id', poolId);

  if (!dbGolfers || dbGolfers.length === 0) return result;

  // Build fast lookup maps
  const byEspnId = new Map(
    dbGolfers
      .filter((g) => g.sportsdata_player_id !== null)
      .map((g) => [String(g.sportsdata_player_id), g])
  );
  const byNormalizedName = new Map(
    dbGolfers.map((g) => [normalizeName(g.name), g])
  );

  // ── 4. Process each ESPN competitor ──────────────────────────────────────
  for (const comp of competitors) {
    // Match to DB golfer: ESPN ID first, then normalized name
    let dbGolfer = byEspnId.get(comp.athlete.id) ?? null;
    if (!dbGolfer) {
      dbGolfer = byNormalizedName.get(normalizeName(comp.athlete.displayName)) ?? null;
    }
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

    // Update golfer status + amateur flag (ESPN is authoritative for amateur status)
    const golferUpdate: Record<string, unknown> = { status: golferStatus };
    if (comp.athlete.amateur === true && !dbGolfer.is_amateur) {
      golferUpdate.is_amateur = true;
    }
    const { error: golferErr } = await supabase
      .from('golfers')
      .update(golferUpdate)
      .eq('id', dbGolfer.id);
    if (golferErr) {
      console.error('[score-updater] golfer update error:', golferErr.message);
    }

    // Upsert completed round scores from linescores
    const roundScores = parseRoundScores(comp);

    // Position lives on the most-recently-known round (which may be the
    // in-progress round, or the last completed round if between rounds).
    // ESPN's `period` can jump ahead of available linescores (e.g. period=3
    // before round 3 tees off), so we fall back to the last round with data.
    const lastKnownRound =
      roundScores.find((rs) => rs.round === currentRound)?.round ??
      roundScores[roundScores.length - 1]?.round ??
      currentRound;

    for (const rs of roundScores) {
      const isCurrentRound = rs.round === currentRound;
      const isLastKnownRound = rs.round === lastKnownRound;
      const { error } = await supabase.from('scores').upsert(
        {
          pool_id: poolId,
          golfer_id: dbGolfer.id,
          round: rs.round,
          score_to_par: rs.score_to_par,
          total_to_par: totalToPar,
          thru: isCurrentRound ? thru : 18,           // completed rounds are F (18)
          position: isLastKnownRound ? position : null,
          position_display: isLastKnownRound ? posDisplay : null,
          is_active: golferStatus === 'active',
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

    // If player hasn't started yet (no rounds) but is in the field, skip score rows
    if (roundScores.length === 0) {
      result.skipped++;
    }
  }

  return result;
}
