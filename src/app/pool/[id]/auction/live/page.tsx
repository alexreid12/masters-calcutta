'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { Spinner, Money, AmateurBadge } from '@/components/ui';
import type { LiveAuctionItem, Golfer, Profile, Pool } from '@/types/database';

interface AuctionState {
  item: (LiveAuctionItem & { golfer: Golfer; current_bidder: Profile | null }) | null;
  sold: (LiveAuctionItem & { golfer: Golfer; owner: Profile | null })[];
  pending: Golfer[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  open: 'Bidding Open',
  sold: 'SOLD',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'text-green-600',
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
  const [winFlash, setWinFlash] = useState(false);
  const [myTeamOpen, setMyTeamOpen] = useState(false);
  const prevBidRef = useRef<number>(0);
  const prevWinCountRef = useRef<number>(0);

  const isCommissioner = pool?.commissioner_id === user?.id;

  async function loadState() {
    const [poolRes, currentRes, soldRes, pendingGolfersRes, ownershipsRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase
        .from('live_auction')
        .select('*, golfers(*), profiles!current_bidder_id(*)')
        .eq('pool_id', params.id)
        .eq('status', 'open')
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
        .select('golfer_id, user_id, profiles!user_id(display_name)')
        .eq('pool_id', params.id),
    ]);

    if (poolRes.data) setPool(poolRes.data);

    const soldGolferIds = new Set((soldRes.data ?? []).map((s: any) => s.golfer_id));
    const ownerMap = new Map((ownershipsRes.data ?? []).map((o: any) => [o.golfer_id, { display_name: o.profiles?.display_name, user_id: o.user_id }]));

    const soldWithOwners = (soldRes.data ?? []).map((s: any) => ({
      ...s,
      owner: ownerMap.has(s.golfer_id) ? { display_name: ownerMap.get(s.golfer_id)?.display_name } : null,
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

    const channel = supabase
      .channel(`auction:${params.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_auction', filter: `pool_id=eq.${params.id}` },
        () => loadState()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ownership', filter: `pool_id=eq.${params.id}` },
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

  // Win celebration when user's golfer count increases
  useEffect(() => {
    const myWinCount = state.sold.filter((s) => s.current_bidder_id === user?.id).length;
    if (myWinCount > prevWinCountRef.current && prevWinCountRef.current >= 0 && !loading) {
      setWinFlash(true);
      setTimeout(() => setWinFlash(false), 1500);
    }
    prevWinCountRef.current = myWinCount;
  }, [state.sold, user?.id, loading]);

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

    const { error } = await supabase
      .from('live_auction')
      .update({
        current_bid: amount,
        current_bidder_id: user!.id,
        bid_count: state.item.bid_count + 1,
        status: 'open',
      })
      .eq('id', state.item.id)
      .eq('current_bid', state.item.current_bid);

    if (error) {
      setError('Bid failed — someone else bid first. Try again.');
    } else {
      setBidAmount('');
    }
    setSubmitting(false);
  }

  async function nominateGolfer(golferId: string) {
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

  async function sellGolfer() {
    if (!state.item) return;

    if (!state.item.current_bidder_id) {
      if (!confirm('No bids on this golfer. Skip and move to next?')) return;
    }

    const { error: updateError } = await supabase
      .from('live_auction')
      .update({ status: 'sold', sold_at: new Date().toISOString() })
      .eq('id', state.item.id);

    if (updateError) {
      setError('Failed to sell golfer — try again.');
      return;
    }

    if (state.item.current_bidder_id) {
      await supabase.from('ownership').insert({
        pool_id: params.id,
        golfer_id: state.item.golfer_id,
        user_id: state.item.current_bidder_id,
        purchase_price: state.item.current_bid,
        acquired_via: 'live_auction',
      });
    }
  }

  const quickBidAmounts = [minBid, minBid + 5, minBid + 10, minBid + 25, minBid + 50].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );

  // Derived: current user's won golfers
  const myGolfers = state.sold
    .filter((s) => s.current_bidder_id === user?.id)
    .sort((a, b) => b.current_bid - a.current_bid);
  const myTotalSpent = myGolfers.reduce((sum, s) => sum + s.current_bid, 0);

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;
  if (!pool) return null;

  const isActive = ['live_auction', 'locked', 'tournament_active', 'completed'].includes(pool.status);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* ── Left / top: My Team ───────────────────────────────────────────── */}
      <div className="lg:order-1 order-1">
        {/* Mobile: collapsible toggle */}
        <button
          className="lg:hidden w-full flex items-center justify-between card py-3 px-4 mb-0 text-left"
          onClick={() => setMyTeamOpen((v) => !v)}
        >
          <span className="font-display text-lg text-masters-green">
            My Team {myGolfers.length > 0 && <span className="text-sm font-mono text-gray-400">({myGolfers.length})</span>}
          </span>
          <span className="text-gray-400 text-sm">{myTeamOpen ? '▲' : '▼'}</span>
        </button>

        {/* Panel — always visible on desktop, toggled on mobile */}
        <div className={`card ${myTeamOpen ? '' : 'hidden lg:block'} transition-all ${winFlash ? 'ring-2 ring-masters-green bg-masters-green/5' : ''}`}>
          <h3 className="font-display text-lg text-masters-green mb-3 hidden lg:block">My Team</h3>

          {myGolfers.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No golfers yet — start bidding!</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-masters-cream-dark">
                <span className="text-xs text-gray-500">Total Spent</span>
                <span className="font-mono font-semibold text-masters-green text-sm">${myTotalSpent}</span>
              </div>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {myGolfers.map((s: any) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between py-1.5 border-b border-masters-cream-dark last:border-0 ${winFlash && s === myGolfers[0] ? 'text-masters-green font-semibold' : ''}`}
                  >
                    <span className="text-sm font-medium">
                      {s.golfer?.name}<AmateurBadge isAmateur={s.golfer?.is_amateur ?? false} />
                    </span>
                    <Money amount={s.current_bid} className="text-masters-green text-sm font-mono" />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Center: Active Auction ────────────────────────────────────────── */}
      <div className="lg:order-2 order-2 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl text-masters-green">Live Auction</h2>
          {pool && (
            <div className="text-right">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Current Pot</p>
              <p className="font-display text-xl font-semibold text-masters-green">
                ${Number(pool.total_pot).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {!state.item ? (
          <div className="card text-center py-12">
            <p className="text-gray-500 text-lg">
              {pool.status === 'live_auction' ? 'Waiting for Commissioner to nominate a golfer...' : 'No active lot'}
            </p>
          </div>
        ) : (
          <div
            key={flashKey}
            className={`card border-2 bid-flash ${
              state.item.status === 'sold' ? 'border-red-400' : 'border-masters-green'
            }`}
          >
            {/* Golfer info */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-display text-2xl font-semibold text-masters-green">
                  {state.item.golfer?.name}
                  <AmateurBadge isAmateur={state.item.golfer?.is_amateur ?? false} />
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
                    {state.item.current_bidder_id === user?.id ? 'You\'re leading' : 'BID!'}
                  </button>
                </div>
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
              </div>
            )}

            {/* Commissioner controls */}
            {isCommissioner && state.item.status !== 'sold' && (
              <div className="border-t border-masters-cream-dark pt-4 mt-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Commissioner Controls</p>
                <button onClick={sellGolfer} className="btn-primary text-sm">
                  SOLD ✓
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: Remaining & Sold ───────────────────────────────────────── */}
      <div className="lg:order-3 order-3 space-y-4">

        {/* Remaining golfers */}
        {state.pending.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-masters-cream-dark">
              <h3 className="font-semibold text-gray-700 text-sm">
                Remaining <span className="badge-gray ml-1">{state.pending.length}</span>
              </h3>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {state.pending.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between px-4 py-2 border-b border-masters-cream-dark last:border-0 hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {g.name}<AmateurBadge isAmateur={g.is_amateur} />
                    </p>
                    <p className="text-xs text-gray-400">#{g.world_ranking ?? '?'}</p>
                  </div>
                  {isCommissioner && !state.item && (
                    <button
                      onClick={() => nominateGolfer(g.id)}
                      className="ml-2 shrink-0 text-xs text-masters-green border border-masters-green/30 hover:bg-masters-green hover:text-white px-2 py-0.5 rounded transition-colors"
                    >
                      Nominate
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recently sold */}
        {state.sold.length > 0 && (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-masters-cream-dark">
              <h3 className="font-semibold text-gray-700 text-sm">
                Sold <span className="badge-green ml-1">{state.sold.length}</span>
              </h3>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {state.sold.slice(0, 10).map((s: any) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-2 border-b border-masters-cream-dark last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {s.golfer?.name}<AmateurBadge isAmateur={s.golfer?.is_amateur ?? false} />
                    </p>
                    <p className="text-xs text-gray-400 truncate">{s.owner?.display_name ?? '—'}</p>
                  </div>
                  <Money amount={s.current_bid} className="text-masters-green text-sm font-mono ml-2 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
