import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendOutbidEmail } from '@/lib/email';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { golfer_id, amount } = await req.json();
  if (!golfer_id || !amount || amount <= 0)
    return NextResponse.json({ error: 'Invalid bid' }, { status: 400 });

  // Validate pool is in async_bidding
  const { data: pool } = await supabase
    .from('pools')
    .select('status, name')
    .eq('id', params.id)
    .single();

  if (pool?.status !== 'async_bidding')
    return NextResponse.json({ error: 'Bidding not open' }, { status: 400 });

  // Find the current highest OTHER bidder before we modify anything
  const { data: topOtherBids } = await supabase
    .from('async_bids')
    .select('user_id, amount')
    .eq('pool_id', params.id)
    .eq('golfer_id', golfer_id)
    .neq('user_id', user.id)
    .order('amount', { ascending: false })
    .limit(1);

  const prevHighBid = topOtherBids?.[0] ?? null;

  // Remove existing bid from this user for this golfer, then insert new one
  await supabase
    .from('async_bids')
    .delete()
    .eq('pool_id', params.id)
    .eq('golfer_id', golfer_id)
    .eq('user_id', user.id);

  const { data, error } = await supabase
    .from('async_bids')
    .insert({
      pool_id: params.id,
      golfer_id,
      user_id: user.id,
      amount,
      is_max_bid: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // ── Outbid notification ────────────────────────────────────────────────────
  // If the new bid beats the previous high bidder (a different user), notify them.
  if (prevHighBid && amount > prevHighBid.amount) {
    // Fire-and-forget — don't let notification errors fail the bid response
    notifyOutbid({
      poolId: params.id,
      poolName: pool.name,
      golferId: golfer_id,
      outbidUserId: prevHighBid.user_id,
      prevAmount: Number(prevHighBid.amount),
      newAmount: amount,
    }).catch((err) => console.error('[bids] outbid notification failed:', err));
  }

  return NextResponse.json(data);
}

async function notifyOutbid({
  poolId,
  poolName,
  golferId,
  outbidUserId,
  prevAmount,
  newAmount,
}: {
  poolId: string;
  poolName: string;
  golferId: string;
  outbidUserId: string;
  prevAmount: number;
  newAmount: number;
}) {
  const serviceClient = createServiceClient();

  // 30-second cooldown — skip if we already notified this user about this golfer recently
  const cooldownStart = new Date(Date.now() - 30_000).toISOString();
  const { data: recentNotif } = await serviceClient
    .from('notifications')
    .select('id')
    .eq('user_id', outbidUserId)
    .eq('pool_id', poolId)
    .eq('type', 'outbid')
    .gte('created_at', cooldownStart)
    .limit(1)
    .maybeSingle();

  if (recentNotif) return; // still within cooldown window

  // Load golfer name and outbid user's profile in parallel
  const [golferRes, profileRes] = await Promise.all([
    serviceClient.from('golfers').select('name').eq('id', golferId).single(),
    serviceClient.from('profiles').select('email, display_name').eq('id', outbidUserId).single(),
  ]);

  const golferName = golferRes.data?.name ?? 'a golfer';
  const outbidEmail = profileRes.data?.email ?? null;
  const outbidName = profileRes.data?.display_name ?? 'there';

  // Insert in-app notification
  await serviceClient.from('notifications').insert({
    pool_id: poolId,
    user_id: outbidUserId,
    type: 'outbid',
    title: "You've been outbid!",
    message: `Someone bid $${newAmount} on ${golferName}. Your bid of $${prevAmount} is no longer the highest.`,
    metadata: {
      golfer_id: golferId,
      golfer_name: golferName,
      new_bid: newAmount,
      your_bid: prevAmount,
    },
  });

  // Send email if we have an address (fire-and-forget — failures are already caught in sendOutbidEmail)
  if (outbidEmail) {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    await sendOutbidEmail({
      to: outbidEmail,
      playerName: outbidName,
      golferName,
      previousBid: prevAmount,
      newBid: newAmount,
      poolName,
      biddingUrl: `${appUrl}/pool/${poolId}/auction/async`,
    });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { golfer_id } = await req.json();
  const { error } = await supabase
    .from('async_bids')
    .delete()
    .eq('pool_id', params.id)
    .eq('golfer_id', golfer_id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
