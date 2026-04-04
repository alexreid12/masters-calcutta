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

  // Optionally accept a manual event ID override from the request body
  let eventIdOverride: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    eventIdOverride = body?.eventId || process.env.ESPN_MASTERS_EVENT_ID || undefined;
  } catch {
    eventIdOverride = process.env.ESPN_MASTERS_EVENT_ID || undefined;
  }

  // Fetch ESPN
  let scoreboardData;
  try {
    scoreboardData = await fetchScoreboard(eventIdOverride);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reach ESPN API. Try again in a moment.' },
      { status: 502 }
    );
  }

  const event = findMastersEvent(scoreboardData);
  if (!event) {
    return NextResponse.json(
      {
        error:
          "Masters field not yet available on ESPN. Try closer to tournament week.",
        availableEvents: scoreboardData.events.map((e) => e.name),
      },
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

  // Load existing golfers so we can update rather than duplicate
  const { data: existing } = await supabase
    .from('golfers')
    .select('id, name, sportsdata_player_id')
    .eq('pool_id', params.id);

  const byEspnId = new Map(
    (existing ?? [])
      .filter((g) => g.sportsdata_player_id)
      .map((g) => [String(g.sportsdata_player_id), g.id])
  );
  const byNormalizedName = new Map(
    (existing ?? []).map((g) => [normalizeName(g.name), g.id])
  );

  let imported = 0;
  let updated = 0;

  for (const comp of competitors) {
    const name = comp.athlete.displayName;
    const country = comp.athlete.flag?.alt ?? null;
    const espnId = parseInt(comp.athlete.id, 10);
    const isAmateur = comp.athlete.amateur ?? false;
    const imageUrl = comp.athlete.headshot?.href ?? null;

    const existingId =
      byEspnId.get(comp.athlete.id) ??
      byNormalizedName.get(normalizeName(name)) ??
      null;

    if (existingId) {
      // Update existing golfer's ESPN ID and amateur status
      await supabase
        .from('golfers')
        .update({
          sportsdata_player_id: espnId,
          is_amateur: isAmateur,
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(country ? { country } : {}),
        })
        .eq('id', existingId);
      updated++;
    } else {
      // Insert new golfer
      await supabase.from('golfers').insert({
        pool_id: params.id,
        name,
        country,
        sportsdata_player_id: espnId,
        is_amateur: isAmateur,
        image_url: imageUrl,
      });
      imported++;
    }
  }

  return NextResponse.json({
    message: `Imported ${imported} new golfers, updated ${updated} existing. Event: ${event.name}`,
    imported,
    updated,
    total: competitors.length,
    eventId: event.id,
    eventName: event.name,
  });
}
