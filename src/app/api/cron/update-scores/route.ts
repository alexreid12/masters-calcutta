import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { updateScoresForPool } from '@/lib/score-updater';

export async function POST(req: NextRequest) {
  // Verify cron secret (Vercel sends this as Authorization: Bearer <secret>)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Find all pools currently in tournament_active
  const { data: activePools } = await supabase
    .from('pools')
    .select('id')
    .eq('status', 'tournament_active');

  if (!activePools || activePools.length === 0) {
    return NextResponse.json({ message: 'No active pools' });
  }

  const eventIdOverride = process.env.ESPN_MASTERS_EVENT_ID || undefined;

  const poolResults = await Promise.all(
    activePools.map((pool) =>
      updateScoresForPool(supabase, pool.id, eventIdOverride)
    )
  );

  const totals = poolResults.reduce(
    (acc, r) => ({
      updated: acc.updated + r.updated,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + r.errors,
    }),
    { updated: 0, skipped: 0, errors: 0 }
  );

  const firstResult = poolResults[0];

  return NextResponse.json({
    message: `Updated ${totals.updated} score rows across ${activePools.length} pool(s). ${totals.skipped} players skipped, ${totals.errors} errors.`,
    event: firstResult?.eventName,
    roundInProgress: firstResult?.roundInProgress ?? false,
  });
}

// Allow GET for manual testing in the browser
export async function GET(req: NextRequest) {
  return POST(req);
}
