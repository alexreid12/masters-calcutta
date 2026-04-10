import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface ScoreEntry {
  golfer_id: string;
  position_display: string;   // "1", "T2", "CUT", "WD", ""
  total_to_par: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  r4: number | null;
  thru: number;               // 0–18
  golfer_status: 'active' | 'missed_cut' | 'withdrawn';
}

function parsePosition(display: string): number | null {
  if (!display) return null;
  const s = display.replace(/^T/i, '').trim().toUpperCase();
  if (['CUT', 'MC', 'WD', 'DQ', '-'].includes(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('commissioner_id')
    .eq('id', params.id)
    .single();
  if (pool?.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  const body = await req.json();
  const entries: ScoreEntry[] = body.entries ?? [];
  if (!Array.isArray(entries) || entries.length === 0)
    return NextResponse.json({ error: 'No entries provided' }, { status: 400 });

  const serviceClient = createServiceClient();
  let updated = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    const roundData: Array<{ round: number; score_to_par: number }> = [];
    if (entry.r1 !== null) roundData.push({ round: 1, score_to_par: entry.r1 });
    if (entry.r2 !== null) roundData.push({ round: 2, score_to_par: entry.r2 });
    if (entry.r3 !== null) roundData.push({ round: 3, score_to_par: entry.r3 });
    if (entry.r4 !== null) roundData.push({ round: 4, score_to_par: entry.r4 });

    if (roundData.length === 0) {
      // No scores — just update golfer status
      await serviceClient.from('golfers').update({ status: entry.golfer_status }).eq('id', entry.golfer_id);
      continue;
    }

    // Derive total: use provided value, or sum the rounds
    const totalToPar =
      entry.total_to_par !== null
        ? entry.total_to_par
        : roundData.reduce((s, r) => s + r.score_to_par, 0);

    const lastRound = roundData[roundData.length - 1].round;
    const position = parsePosition(entry.position_display);
    const posDisplay = entry.position_display?.trim() || null;

    for (const { round, score_to_par } of roundData) {
      const isLast = round === lastRound;
      const { error } = await serviceClient.from('scores').upsert(
        {
          pool_id: params.id,
          golfer_id: entry.golfer_id,
          round,
          score_to_par,
          total_to_par: totalToPar,
          thru: isLast ? entry.thru : 18,
          position: isLast ? position : null,
          position_display: isLast ? posDisplay : null,
          is_active: entry.golfer_status === 'active',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pool_id,golfer_id,round' }
      );
      if (error) {
        errors.push(`${entry.golfer_id} R${round}: ${error.message}`);
      } else {
        updated++;
      }
    }

    // Update golfer status
    await serviceClient.from('golfers').update({ status: entry.golfer_status }).eq('id', entry.golfer_id);
  }

  // Mark pool as manually updated
  await serviceClient.from('pools').update({
    score_source: 'manual',
    score_updated_at: new Date().toISOString(),
  }).eq('id', params.id);

  if (errors.length > 0) {
    return NextResponse.json({ updated, errors }, { status: 207 });
  }
  return NextResponse.json({ updated });
}
