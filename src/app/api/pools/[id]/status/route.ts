import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { PoolStatus } from '@/types/database';

const VALID_TRANSITIONS: Record<PoolStatus, PoolStatus> = {
  setup: 'async_bidding',
  async_bidding: 'live_auction',
  live_auction: 'locked',
  locked: 'tournament_active',
  tournament_active: 'completed',
  completed: 'completed',
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('status, commissioner_id')
    .eq('id', params.id)
    .single();

  if (!pool) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const next = VALID_TRANSITIONS[pool.status as PoolStatus];
  const { data, error } = await supabase
    .from('pools')
    .update({ status: next })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
