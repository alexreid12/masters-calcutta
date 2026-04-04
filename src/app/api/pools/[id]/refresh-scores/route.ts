import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { updateScoresForPool } from '@/lib/score-updater';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Auth: must be logged in as the pool commissioner
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('commissioner_id, status')
    .eq('id', params.id)
    .single();

  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  // Use the service client for writes (bypasses RLS)
  const serviceClient = createServiceClient();
  const eventIdOverride = process.env.ESPN_MASTERS_EVENT_ID || undefined;

  try {
    const result = await updateScoresForPool(serviceClient, params.id, eventIdOverride);
    return NextResponse.json({
      message: `Updated ${result.updated} score rows. ${result.skipped} players skipped.`,
      ...result,
    });
  } catch (err) {
    console.error('[refresh-scores] error:', err);
    return NextResponse.json(
      { error: 'Score refresh failed. Check server logs.' },
      { status: 500 }
    );
  }
}
