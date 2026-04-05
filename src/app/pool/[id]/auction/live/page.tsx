'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { Spinner, Money } from '@/components/ui';
import type { LiveAuctionItem, Golfer, Profile, Pool } from '@/types/database';

interface AuctionState {
  item: (LiveAuctionItem & { golfer: Golfer; current_bidder: Profile | null }) | null;
  sold: (LiveAuctionItem & { golfer: Golfer; owner: Profile | null })[];
  pending: Golfer[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  open: 'Bidding Open',
  going_once: 'Going Once...',
  going_twice: 'Going Twice...',
  sold: 'SOLD',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'text-green-600',
  going_once: 'text-yellow-600',
  going_twice: 'text-orange-600',
  sold: 'text-red-600',
};

export default function LiveAuctionPage({ params }: { params: { id: string } }) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const { user, profile } = useAuth();
  const [pool, setPool] = useState<Pool | null>(null);
  const [state, setState] = useState<AuctionState>({ item: null, sold: [], pending: [] });
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [flashKey, setFlashKey] = useState(0);
  const prevBidRef = useRef<number>(0);

  const isCommissioner = pool?.commissioner_id === user?.id;

  async function loadState() {
    const [poolRes, currentRes, soldRes, pendingGolfersRes, ownershipsRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase
        .from('live_auction')
        .select('*, golfers(*), profiles!current_bidder_id(*)')
        .eq('pool_id', params.id)
        .in('status', ['open', 'going_once', 'going_twice'])
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('live_auction')
        .select('*, golfers(*)')
        .eq('pool_id', params.id)
        .eq('status', 'sold')
        .order('sold_at', { ascending: false }),
      supabase
        .from('golfers')
        .select('*')
        .eq('pool_id', params.id)
        .order('world_ranking', { nullsFirst: false }),
      supabase
        .from('ownership')
        .select('golfer_id, profiles!user_id(display_name)')
        .eq('pool_id', params.id),
    ]);

    if (poolRes.data) setPool(poolRes.data);

    const soldGolferIds = new Set((soldRes.data ?? []).map((s: any) => s.golfer_id));
    const ownerMap = new Map((ownershipsRes.data ?? []).map((o: any) => [o.golfer_id, o.profiles?.display_name]));

    const soldWithOwners = (soldRes.data ?? []).map((s: any) => ({
      ...s,
      owner: ownerMap.has(s.golfer_id) ? { display_name: ownerMap.get(s.golfer_id) } : null,
    }));

    const pending = (pendingGolfersRes.data ?? []).filter(
      (g) => !soldGolferIds.has(g.id) && currentRes.data?.golfer_id !== g.id
    );

    setState({
      item: currentRes.data ?? null,
      sold: soldWithOwners,
      pending,
    });
    setLoading(false);
  }

  useEffect(() => {
    loadState();

    // Subscribe to live_auction changes
    const channel = supabase
      .channel(`auction:${params.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_auction', filter: `pool_id=eq.${params.id}` },
        () => loadState()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // Flash when bid changes
  useEffect(() => {
    const currentBid = state.item?.current_bid ?? 0;
    if (currentBid !== prevBidRef.current && prevBidRef.current !== 0) {
      setFlashKey((k) => k + 1);
    }
    prevBidRef.current = currentBid;
  }, [state.item?.current_bid]);

  const minBid = state.item
    ? Math.max(state.item.floor_price, state.item.current_bid + 1)
    : 1;

  async function placeBid() {
    if (!state.item) return;
    const amount = parseFloat(bidAmount);
    if (!amount || amount < minBid) {
      setError(`Minimum bid is $${minBid}`);
      return;
    }
    setError('');
    setSubmitting(true);

    // Optimistic locking: only succeed if current_bid hasn't changed
    const { error } = await supabase
      .from('live_auction')
      .update({
        current_bid: amount,
        current_bidder_id: user!.id,
        bid_count: state.item.bid_count + 1,
        status: 'open', // reset to open on new bid
      })
      .eq('id', state.item.id)
      .eq('current_bid', state.item.current_bid); // optimistic lock

    if (error) {
      setError('Bid failed — someone else bid first. Try again.');
    } else {
      setBidAmount('');
    }
    setSubmitting(false);
  }

  // Commissioner controls
  async function nominateGolfer(golferId: string) {
    // Find floor price from async bids
    const { data: highBid } = await supabase
      .from('async_high_bids')
      .select('high_bid')
      .eq('golfer_id', golferId)
      .maybeSingle();

    const floor = Math.max(1, Number(highBid?.high_bid ?? 1));
    await supabase.from('live_auction').insert({
      pool_id: params.id,
      golfer_id: golferId,
      floor_price: floor,
      current_bid: floor,
      status: 'open',
      opened_at: new Date().toISOString(),
    });
  }

  async function advanceStatus() {
    if (!state.item) return;
    const next: Record<string, string> = {
      open: 'going_once',
      going_once: 'going_twice',
      going_twice: 'sold',
    };
    const nextStatus = next[state.item.status];
    if (!nextStatus) return;

    const update: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'sold') {
      update.sold_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('live_auction')
      .update(update)
      .eq('id', state.item.id);

    if (updateError) {
      setError('Failed to advance status — try again.');
      return;
    }

    // When sold, create ownership record only after confirmed status update
    if (nextStatus === 'sold' && state.item.current_bidder_id) {
      await supabase.from('ownership').insert({
        pool_id: params.id,
        golfer_id: state.item.golfer_id,
        user_id: state.item.current_bidder_id,
        purchase_price: state.item.current_bid,
        acquired_via: 'live_auction',
      });
    }
  }

  async function resetStatus() {
    if (!state.item) return;
    await supabase.from('live_auction').update({ status: 'open' }).eq('id', state.item.id);
  }

  const quickBidAmounts = [minBid, minBid + 5, minBid + 10, minBid + 25, minBid + 50].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;

  if (!pool) return null;

  const isActive = ['live_auction', 'locked', 'tournament_active', 'completed'].includes(pool.status);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Main auction area */}
      <div className="lg:col-span-2 space-y-4">
        <h2 className="font-display text-2xl text-masters-green">Live Auction</h2>

        {!state.item ? (
          <div className="card text-center py-12">
            <p className="text-gray-500 text-lg">
              {pool.status === 'live_auction' ? 'Waiting for Commissioner to nominate a golfer...' : 'No active lot'}
            </p>
          </div>
        ) : (
          <div
            key={flashKey}
            className={`card border-2 ${
              state.item.status === 'going_once' ? 'border-yellow-400' :
              state.item.status === 'going_twice' ? 'border-orange-400' :
              state.item.status === 'sold' ? 'border-red-400' :
              'border-masters-green'
            } bid-flash`}
          >
            {/* Golfer info */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-display text-2xl font-semibold text-masters-green">
                  {state.item.golfer?.name}
                </h3>
                <p className="text-gray-500 text-sm mt-0.5">
                  {state.item.golfer?.country} · #{state.item.golfer?.world_ranking ?? '?'} World Ranking
                </p>
              </div>
              <span className={`text-lg font-bold ${STATUS_COLORS[state.item.status] ?? ''}`}>
                {STATUS_LABELS[state.item.status]}
              </span>
            </div>

            {/* Bid info */}
            <div className="flex flex-wrap gap-6 mb-6">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Current Bid</p>
                <Money
                  amount={state.item.current_bid}
                  className="text-3xl font-semibold text-masters-green"
                />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Floor</p>
                <Money amount={state.item.floor_price} className="text-xl text-gray-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Bids</p>
                <p className="text-xl font-mono font-semibold text-gray-700">{state.item.bid_count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Leader</p>
                <p className="text-sm font-semibold text-gray-700">
                  {state.item.current_bidder?.display_name ?? '—'}
                  {state.item.current_bidder_id === user?.id && (
                    <span className="badge-gold ml-1">You</span>
                  )}
                </p>
              </div>
            </div>

            {/* Bidding controls */}
            {state.item.status !== 'sold' && (
              <div className="border-t border-masters-cream-dark pt-4">
                <div className="flex flex-wrap gap-2 mb-3">
                  {quickBidAmounts.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setBidAmount(String(amt))}
                      className={`px-3 py-1.5 rounded border text-sm font-mono transition-colors ${
                        bidAmount === String(amt)
                          ? 'bg-masters-green text-white border-masters-green'
                          : 'border-masters-green/30 text-masters-green hover:bg-masters-green/10'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <div className="flex-1 flex gap-2">
                    <span className="flex items-center px-3 bg-gray-50 border border-r-0 border-gray-300 rounded-l text-gray-500">$</span>
                    <input
                      type="number"
                      min={minBid}
                      step="1"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && placeBid()}
                      className="input rounded-l-none flex-1"
                      placeholder={`Min $${minBid}`}
                    />
                  </div>
                  <button
                    onClick={placeBid}
                    disabled={submitting || state.item.current_bidder_id === user?.id}
                    className="btn-gold flex items-center gap-2"
                  >
                    {submitting && <Spinner className="w-4 h-4" />}
                    {state.item.current_bidder_id === user?.id ? 'You\'re leading' : 'Place Bid'}
                  </button>
                </div>
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
              </div>
            )}

            {/* Commissioner controls */}
            {isCommissioner && (
              <div className="border-t border-masters-cream-dark pt-4 mt-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Commissioner Controls</p>
                <div className="flex flex-wrap gap-2">
                  {state.item.status !== 'sold' && (
                    <>
                      <button onClick={advanceStatus} className="btn-primary text-sm">
                        {state.item.status === 'open' ? 'Going Once →' :
                         state.item.status === 'going_once' ? 'Going Twice →' :
                         'SOLD ✓'}
                      </button>
                      {state.item.status !== 'open' && (
                        <button onClick={resetStatus} className="btn-outline text-sm">
                          ← Reset to Open
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nominate panel (commissioner) */}
        {isCommissioner && state.pending.length > 0 && !state.item && (
          <div className="card">
            <h3 className="font-display text-lg text-masters-green mb-3">Nominate a Golfer</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {state.pending.slice(0, 18).map((g) => (
                <button
                  key={g.id}
                  onClick={() => nominateGolfer(g.id)}
                  className="text-left p-2 rounded border border-masters-green/20 hover:border-masters-green hover:bg-masters-green/5 transition-colors"
                >
                  <p className="text-sm font-medium">{g.name}</p>
                  <p className="text-xs text-gray-400">#{g.world_ranking ?? '?'}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        {/* Remaining golfers */}
        {state.pending.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-2">
              Remaining <span className="badge-gray ml-1">{state.pending.length}</span>
            </h3>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {state.pending.map((g) => (
                <div key={g.id} className="flex items-center justify-between py-1 text-sm border-b border-masters-cream-dark last:border-0">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-gray-400 text-xs">#{g.world_ranking ?? '?'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sold */}
        {state.sold.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-gray-700 mb-2">
              Sold <span className="badge-green ml-1">{state.sold.length}</span>
            </h3>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {state.sold.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between py-1 text-sm border-b border-masters-cream-dark last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.golfer?.name}</p>
                    <p className="text-xs text-gray-400 truncate">{s.owner?.display_name ?? '—'}</p>
                  </div>
                  <Money amount={s.current_bid} className="text-masters-green ml-2 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
