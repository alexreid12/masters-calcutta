import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('status, commissioner_id')
    .eq('id', params.id)
    .single();

  if (pool?.status !== 'live_auction')
    return NextResponse.json({ error: 'Not in live auction' }, { status: 400 });
  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  const body = await req.json();
  const { item_id } = body;

  const serviceClient = createServiceClient();

  const { data: item } = await serviceClient
    .from('live_auction')
    .select('*')
    .eq('id', item_id)
    .eq('pool_id', params.id)
    .single();

  if (!item) return NextResponse.json({ error: 'Auction item not found' }, { status: 404 });
  if (item.status === 'sold') return NextResponse.json({ error: 'Already sold' }, { status: 400 });

  if (item.current_bidder_id) {
    // Someone outbid the async winner — replace ownership with live auction winner
    await serviceClient
      .from('ownership')
      .delete()
      .eq('pool_id', params.id)
      .eq('golfer_id', item.golfer_id);

    const { error: insertError } = await serviceClient.from('ownership').insert({
      pool_id: params.id,
      golfer_id: item.golfer_id,
      user_id: item.current_bidder_id,
      purchase_price: item.current_bid,
      acquired_via: 'live_auction',
    });
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    // Recalculate pot directly from ownership records (live auction prices may differ from async)
    const { data: allOwnership } = await serviceClient
      .from('ownership')
      .select('purchase_price')
      .eq('pool_id', params.id);
    const newPot = (allOwnership ?? []).reduce((sum, o: any) => sum + Number(o.purchase_price), 0);
    await serviceClient
      .from('pools')
      .update({ total_pot: newPot })
      .eq('id', params.id);
  }
  // No current_bidder_id → async owner keeps the golfer at their async price, ownership unchanged

  const { data: updatedItem, error: updateError } = await serviceClient
    .from('live_auction')
    .update({ status: 'sold', sold_at: new Date().toISOString() })
    .eq('id', item_id)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });
  return NextResponse.json(updatedItem);
}
