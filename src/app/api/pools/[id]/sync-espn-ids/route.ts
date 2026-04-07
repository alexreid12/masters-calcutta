import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  fetchScoreboard,
  findMastersEvent,
  getCompetitors,
  normalizeName,
} from '@/lib/espn';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('commissioner_id')
    .eq('id', params.id)
    .single();

  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  let eventIdOverride: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    eventIdOverride = body?.eventId || process.env.ESPN_MASTERS_EVENT_ID || undefined;
  } catch {
    eventIdOverride = process.env.ESPN_MASTERS_EVENT_ID || undefined;
  }

  let scoreboardData;
  try {
    scoreboardData = await fetchScoreboard(eventIdOverride);
  } catch {
    return NextResponse.json(
      { error: 'Failed to reach ESPN API. Try again in a moment.' },
      { status: 502 }
    );
  }

  const event = findMastersEvent(scoreboardData);
  if (!event) {
    return NextResponse.json(
      { error: 'Masters field not yet available on ESPN. Try closer to tournament week.' },
      { status: 404 }
    );
  }

  const competitors = getCompetitors(event);
  if (competitors.length === 0) {
    return NextResponse.json(
      { error: 'No competitors found in the Masters event.' },
      { status: 404 }
    );
  }

  // Load existing golfers for this pool
  const { data: existing } = await supabase
    .from('golfers')
    .select('id, name, sportsdata_player_id')
    .eq('pool_id', params.id);

  const byNormalizedName = new Map(
    (existing ?? []).map((g) => [normalizeName(g.name), g.id])
  );

  let matched = 0;
  const unmatched: string[] = [];

  for (const comp of competitors) {
    const espnName = comp.athlete.displayName;
    const espnId = parseInt(comp.athlete.id, 10);
    const normalizedEspn = normalizeName(espnName);

    const golferId = byNormalizedName.get(normalizedEspn) ?? null;

    if (golferId) {
      await supabase
        .from('golfers')
        .update({ sportsdata_player_id: espnId })
        .eq('id', golferId);
      matched++;
    } else {
      unmatched.push(espnName);
    }
  }

  return NextResponse.json({
    matched,
    total: competitors.length,
    unmatched,
    eventName: event.name,
  });
}
