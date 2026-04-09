import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
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
  const serviceClient = createServiceClient();

  // ── async_bidding → live_auction: lock in async high bids as ownership ────
  if (pool.status === 'async_bidding') {
    const [highBidsRes, golfersRes] = await Promise.all([
      serviceClient
        .from('async_high_bids')
        .select('golfer_id, high_bid, high_bidder_id')
        .eq('pool_id', params.id),
      serviceClient
        .from('golfers')
        .select('id', { count: 'exact', head: true })
        .eq('pool_id', params.id),
    ]);

    const highBids = highBidsRes.data ?? [];
    const totalGolfers = golfersRes.count ?? 0;

    // Idempotent: wipe any previously created async_auction ownership records
    // (guards against the transition being triggered twice)
    await serviceClient
      .from('ownership')
      .delete()
      .eq('pool_id', params.id)
      .eq('acquired_via', 'async_auction');

    // Create one ownership record per async high bidder
    if (highBids.length > 0) {
      const { error: insertError } = await serviceClient.from('ownership').insert(
        highBids.map((bid: any) => ({
          pool_id: params.id,
          golfer_id: bid.golfer_id,
          user_id: bid.high_bidder_id,
          purchase_price: Number(bid.high_bid),
          acquired_via: 'async_auction',
        }))
      );
      if (insertError) {
        return NextResponse.json(
          { error: `Failed to create ownership records: ${insertError.message}` },
          { status: 400 }
        );
      }
    }

    // Pot = sum of all async winning bids
    const newPot = highBids.reduce((sum: number, bid: any) => sum + Number(bid.high_bid), 0);

    const { data, error } = await serviceClient
      .from('pools')
      .update({ status: 'live_auction', total_pot: newPot })
      .eq('id', params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      ...data,
      _summary: {
        assigned: highBids.length,
        unowned: totalGolfers - highBids.length,
      },
    });
  }

  // ── live_auction → locked: return a sold/unsold summary ──────────────────
  if (pool.status === 'live_auction') {
    const [ownedRes, golfersRes] = await Promise.all([
      serviceClient
        .from('ownership')
        .select('id', { count: 'exact', head: true })
        .eq('pool_id', params.id),
      serviceClient
        .from('golfers')
        .select('id', { count: 'exact', head: true })
        .eq('pool_id', params.id),
    ]);

    const ownedCount = ownedRes.count ?? 0;
    const totalGolfers = golfersRes.count ?? 0;

    const { data, error } = await serviceClient
      .from('pools')
      .update({ status: 'locked' })
      .eq('id', params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      ...data,
      _summary: {
        sold: ownedCount,
        unsold: totalGolfers - ownedCount,
      },
    });
  }

  // ── All other transitions ─────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('pools')
    .update({ status: next })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
