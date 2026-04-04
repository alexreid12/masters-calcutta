import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { pool } = await supabase
    .from('pools')
    .select('status, commissioner_id')
    .eq('id', params.id)
    .single()
    .then((r) => ({ pool: r.data }));

  if (pool?.status !== 'live_auction')
    return NextResponse.json({ error: 'Not in live auction' }, { status: 400 });

  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  const body = await req.json();
  const { golfer_id } = body;

  // Get floor price from async bids
  const { data: highBid } = await supabase
    .from('async_high_bids')
    .select('high_bid')
    .eq('golfer_id', golfer_id)
    .maybeSingle();

  const floor = Math.max(1, Number(highBid?.high_bid ?? 1));

  const { data, error } = await supabase
    .from('live_auction')
    .insert({
      pool_id: params.id,
      golfer_id,
      floor_price: floor,
      current_bid: floor,
      status: 'open',
      opened_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { item_id, amount, current_bid } = body;

  // Optimistic lock bid
  const { data, error } = await supabase
    .from('live_auction')
    .update({
      current_bid: amount,
      current_bidder_id: user.id,
      status: 'open',
    })
    .eq('id', item_id)
    .eq('current_bid', current_bid) // optimistic lock
    .select()
    .single();

  if (error || !data)
    return NextResponse.json({ error: 'Bid failed — try again' }, { status: 409 });
  return NextResponse.json(data);
}
