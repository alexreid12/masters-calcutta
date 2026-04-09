'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { Spinner, Money, AmateurBadge } from '@/components/ui';
import { MastersFlag, type FlagStatus } from '@/components/MastersFlag';
import type { Golfer, AsyncBid, Pool } from '@/types/database';

interface HighBid {
  golfer_id: string;
  high_bid: number;
  high_bidder_id: string;
  high_bidder_name: string;
}

interface GolferWithBids extends Golfer {
  myBid: AsyncBid | null;
  highBid: number | null;
  highBidderName: string | null;
  highBidderId: string | null;
  isOwned: boolean;
}

export default function AsyncBiddingPage({ params }: { params: { id: string } }) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const { user } = useAuth();

  const [golfers, setGolfers] = useState<GolferWithBids[]>([]);
  const [pool, setPool] = useState<Pool | null>(null);
  const [pot, setPot] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Per-golfer bid inputs (individual rows)
  const [bidAmounts, setBidAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});

  // Watchlist (localStorage-persisted, per pool)
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [watchlistOpen, setWatchlistOpen] = useState(true);

  // My Bids Summary panel
  const [myBidsSummaryOpen, setMyBidsSummaryOpen] = useState(true);

  // Cart / batch bidding
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [cartAmount, setCartAmount] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchResult, setBatchResult] = useState<{ ok: number; failed: { name: string; reason: string }[] } | null>(null);

  // ── Persistence ─────────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`watchlist:${params.id}`);
      if (saved) setWatchlist(new Set(JSON.parse(saved)));
    } catch {}
  }, [params.id]);

  useEffect(() => {
    try {
      localStorage.setItem(`watchlist:${params.id}`, JSON.stringify(Array.from(watchlist)));
    } catch {}
  }, [watchlist, params.id]);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    if (!user) return;
    const [poolRes, golfersRes, myBidsRes, highBidsRes, ownedRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase.from('golfers').select('*').eq('pool_id', params.id).order('world_ranking', { nullsFirst: false }),
      supabase.from('async_bids').select('*').eq('pool_id', params.id).eq('user_id', user.id),
      supabase.from('async_high_bids').select('*').eq('pool_id', params.id),
      supabase.from('ownership').select('golfer_id').eq('pool_id', params.id),
    ]);
    if (poolRes.data) {
      setPool(poolRes.data);
      setPot(Number(poolRes.data.total_pot ?? 0));
    }

    const myBidsMap = new Map((myBidsRes.data ?? []).map((b) => [b.golfer_id, b]));
    const highBidsMap = new Map((highBidsRes.data ?? []).map((b: any) => [b.golfer_id, b as HighBid]));
    const ownedSet = new Set((ownedRes.data ?? []).map((o: any) => o.golfer_id));

    const enriched = (golfersRes.data ?? []).map((g) => {
      const hb = highBidsMap.get(g.id);
      return {
        ...g,
        myBid: myBidsMap.get(g.id) ?? null,
        highBid: hb ? Number(hb.high_bid) : null,
        highBidderName: hb?.high_bidder_name ?? null,
        highBidderId: hb?.high_bidder_id ?? null,
        isOwned: ownedSet.has(g.id),
      };
    });

    setGolfers(enriched);

    // Pre-fill bid inputs with min bid only for fields the user hasn't typed in yet
    setBidAmounts((prev) => {
      const next = { ...prev };
      enriched.forEach((g) => {
        if (!prev[g.id]) {
          next[g.id] = String(g.highBid !== null ? g.highBid + 1 : 1);
        }
      });
      return next;
    });

    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`pool:${params.id}:bids`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pools', filter: `id=eq.${params.id}` },
        (payload: any) => setPot(Number(payload.new.total_pot ?? 0))
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'async_bids', filter: `pool_id=eq.${params.id}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const canBid = pool?.status === 'async_bidding';

  // ── Watchlist helpers ────────────────────────────────────────────────────────

  function toggleWatchlist(golferId: string) {
    setWatchlist((prev) => {
      const next = new Set(prev);
      next.has(golferId) ? next.delete(golferId) : next.add(golferId);
      return next;
    });
  }

  // ── Individual bid ───────────────────────────────────────────────────────────

  async function placeBid(golferId: string) {
    const raw = bidAmounts[golferId] ?? '';
    const amount = parseInt(raw, 10);
    if (!raw || isNaN(amount) || amount <= 0 || String(amount) !== raw.trim()) {
      setMessages((m) => ({ ...m, [golferId]: { type: 'error', text: 'Enter a whole dollar amount' } }));
      return;
    }
    const golfer = golfers.find((g) => g.id === golferId);
    const minBid = golfer?.highBid !== null && golfer?.highBid !== undefined ? golfer.highBid + 1 : 1;
    if (amount < minBid) {
      setMessages((m) => ({ ...m, [golferId]: { type: 'error', text: `Bid must be at least $${minBid}` } }));
      return;
    }
    setSubmitting(golferId);
    const res = await fetch(`/api/pools/${params.id}/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ golfer_id: golferId, amount }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessages((m) => ({ ...m, [golferId]: { type: 'error', text: json.error ?? 'Failed to place bid' } }));
    } else {
      setMessages((m) => ({ ...m, [golferId]: { type: 'success', text: 'Bid placed!' } }));
      setBidAmounts((a) => ({ ...a, [golferId]: '' }));
      await load();
    }
    setSubmitting(null);
    setTimeout(() => setMessages((m) => { const n = { ...m }; delete n[golferId]; return n; }), 3000);
  }

  // ── Cart helpers ─────────────────────────────────────────────────────────────

  function toggleCart(golferId: string) {
    setCart((prev) => {
      const next = new Set(prev);
      next.has(golferId) ? next.delete(golferId) : next.add(golferId);
      return next;
    });
  }

  function selectAll() {
    const eligible = golfers.filter((g) => !g.isOwned && g.highBidderId !== user?.id);
    setCart(new Set(eligible.map((g) => g.id)));
  }

  // ── Batch bidding ────────────────────────────────────────────────────────────

  async function placeBatchBids() {
    const amount = parseInt(cartAmount, 10);
    if (isNaN(amount) || amount <= 0) return;

    const selectedGolfers = golfers.filter((g) => cart.has(g.id));
    const maxMinBid = Math.max(...selectedGolfers.map((g) => g.highBid !== null ? g.highBid + 1 : 1));
    if (amount < maxMinBid) return;

    setBatchProgress({ current: 0, total: selectedGolfers.length });
    const results: { ok: number; failed: { name: string; reason: string }[] } = { ok: 0, failed: [] };

    for (let i = 0; i < selectedGolfers.length; i++) {
      const g = selectedGolfers[i];
      setBatchProgress({ current: i + 1, total: selectedGolfers.length });
      const res = await fetch(`/api/pools/${params.id}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ golfer_id: g.id, amount }),
      });
      const json = await res.json();
      if (res.ok) results.ok++;
      else results.failed.push({ name: g.name, reason: json.error ?? 'Failed' });
    }

    setBatchProgress(null);
    setBatchResult(results);
    setCart(new Set());
    setCartAmount('');
    await load();
    setTimeout(() => setBatchResult(null), 8000);
  }

  // ── Derived values ───────────────────────────────────────────────────────────

  const myHighBids = golfers
    .filter((g) => g.highBidderId === user?.id)
    .sort((a, b) => (b.highBid ?? 0) - (a.highBid ?? 0));
  const myHighBidCount = myHighBids.length;
  const myTotalCommitted = myHighBids.reduce((sum, g) => sum + (g.highBid ?? 0), 0);

  const watchlistGolfers = golfers.filter((g) => watchlist.has(g.id));
  const cartGolfers = golfers.filter((g) => cart.has(g.id));
  const cartMaxMinBid = cartGolfers.length > 0
    ? Math.max(...cartGolfers.map((g) => g.highBid !== null ? g.highBid + 1 : 1))
    : 1;
  const batchAmountVal = parseInt(cartAmount, 10);
  const batchAmountOk = !isNaN(batchAmountVal) && batchAmountVal >= cartMaxMinBid;

  function flagStatus(g: GolferWithBids): FlagStatus {
    if (g.highBidderId === user?.id) return 'high_bid';
    if (g.myBid !== null) return 'outbid';
    return 'no_bid';
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;

  if (!canBid && pool) {
    return (
      <div className="card text-center py-12">
        <p className="text-gray-500">
          Async bidding is {pool.status === 'setup' ? 'not yet open' : 'closed'}.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-masters-green">Async Bidding</h2>
        {pool?.async_bid_deadline && (
          <p className="text-sm text-gray-500">
            Deadline: {new Date(pool.async_bid_deadline).toLocaleString()}
          </p>
        )}
      </div>

      {/* ── My Bids Summary ───────────────────────────────────────────────── */}
      <div className="card mb-4 border border-masters-green/20">
        {/* Metric row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">My Bids</p>
            <p className="font-display text-2xl font-semibold text-masters-green">{myHighBidCount}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Committed</p>
            <p className="font-display text-2xl font-semibold text-masters-green">${myTotalCommitted.toLocaleString()}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Pool Pot</p>
            <p className="font-display text-2xl font-semibold text-masters-gold">${pot.toLocaleString()}</p>
          </div>
        </div>

      </div>

      {/* ── My Winning Bids ───────────────────────────────────────────────── */}
      <div className="card mb-4 border border-masters-green/20">
        <button
          className="w-full flex items-center justify-between text-left"
          onClick={() => setMyBidsSummaryOpen((v) => !v)}
        >
          <div>
            <span className="font-display text-base text-masters-green font-semibold">My Winning Bids</span>
            <p className="text-xs text-gray-400 mt-0.5">Golfers you&apos;ll own when bidding closes — binding commitments</p>
          </div>
          <span className="text-gray-400 text-xs flex-shrink-0 ml-3">{myBidsSummaryOpen ? '▲' : '▼'}</span>
        </button>

        {myBidsSummaryOpen && (
          <div className="mt-3">
            {myHighBids.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3">You don&apos;t hold any high bids yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase tracking-wide">
                    <th className="text-left pb-1 font-medium">Golfer</th>
                    <th className="text-right pb-1 font-medium">My Bid</th>
                  </tr>
                </thead>
                <tbody>
                  {myHighBids.map((g) => (
                    <tr key={g.id} className="border-t border-gray-50">
                      <td className="py-1.5 font-medium">
                        {g.name}<AmateurBadge isAmateur={g.is_amateur} />
                      </td>
                      <td className="py-1.5 text-right font-mono text-masters-green">
                        ${g.highBid!.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-200">
                    <td className="pt-2 font-bold text-masters-green">Total</td>
                    <td className="pt-2 text-right font-mono font-bold text-masters-green">
                      ${myTotalCommitted.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Place your max bids below. Your high bid is a <strong className="text-gray-700">binding commitment</strong> — if you hold the high bid when async bidding closes, you own that golfer. In the live auction, others can bid higher to take a golfer away from you, but you are guaranteed ownership unless outbid. Bids are permanent — raise your bid if you get outbid.
      </p>

      {/* ── Watchlist panel ───────────────────────────────────────────────── */}
      {watchlistGolfers.length > 0 && (
        <div className="card mb-4 border border-masters-gold/30 bg-masters-gold/5">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setWatchlistOpen((v) => !v)}
          >
            <span className="font-display text-base text-masters-green font-semibold">
              ★ My Watchlist ({watchlistGolfers.length})
            </span>
            <span className="text-gray-400 text-sm">{watchlistOpen ? '▲' : '▼'}</span>
          </button>

          {watchlistOpen && (
            <div className="mt-3 space-y-1.5">
              {watchlistGolfers.map((g) => {
                const isOutbid = g.myBid !== null && g.highBidderId !== user?.id;
                const iAmHigh = g.highBidderId === user?.id;
                const minBid = g.highBid !== null ? g.highBid + 1 : 1;
                return (
                  <div
                    key={g.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                      isOutbid ? 'bg-orange-50 border border-orange-200' :
                      iAmHigh  ? 'bg-masters-green/5 border border-masters-green/20' :
                      'bg-white border border-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MastersFlag status={flagStatus(g)} size={16} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {g.name}<AmateurBadge isAmateur={g.is_amateur} />
                        </p>
                        {g.highBid !== null && (
                          <p className="text-xs text-gray-500">
                            ${g.highBid} — {g.highBidderName}
                            {isOutbid && <span className="text-orange-600 font-medium ml-1">• Outbid!</span>}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!g.isOwned && !iAmHigh && canBid && (
                        <div className="flex items-center gap-1">
                          <div className="relative">
                            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">$</span>
                            <input
                              type="number"
                              min={minBid}
                              step="1"
                              value={bidAmounts[g.id] ?? ''}
                              onChange={(e) => setBidAmounts((a) => ({ ...a, [g.id]: e.target.value }))}
                              className="input w-20 text-right pl-4 pr-1 py-1 text-xs"
                            />
                          </div>
                          <button
                            onClick={() => placeBid(g.id)}
                            disabled={submitting === g.id}
                            className="btn-primary py-1 px-2 text-xs flex items-center gap-1"
                          >
                            {submitting === g.id && <Spinner className="text-white w-3 h-3" />}
                            Bid
                          </button>
                        </div>
                      )}
                      {iAmHigh && (
                        <span className="text-xs text-masters-green font-semibold">High bid ✓</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Select all / clear row ────────────────────────────────────────── */}
      {canBid && (
        <div className="flex items-center gap-3 mb-2 text-sm">
          <button onClick={selectAll} className="text-masters-green hover:underline text-xs font-medium">
            Select All Available
          </button>
          {cart.size > 0 && (
            <button onClick={() => setCart(new Set())} className="text-gray-400 hover:underline text-xs">
              Clear Selection
            </button>
          )}
          {cart.size > 0 && (
            <span className="text-xs text-gray-400 ml-auto">{cart.size} selected</span>
          )}
        </div>
      )}

      {/* ── Batch result banner ───────────────────────────────────────────── */}
      {batchResult && (
        <div className={`rounded-xl px-4 py-3 mb-4 text-sm ${batchResult.failed.length === 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-yellow-50 border border-yellow-200 text-yellow-800'}`}>
          <p className="font-medium">
            Successfully bid on {batchResult.ok} golfer{batchResult.ok !== 1 ? 's' : ''}.
            {batchResult.failed.length > 0 && ` ${batchResult.failed.length} failed.`}
          </p>
          {batchResult.failed.length > 0 && (
            <ul className="mt-1 text-xs space-y-0.5">
              {batchResult.failed.map((f, i) => (
                <li key={i}>{f.name}: {f.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Main table ───────────────────────────────────────────────────── */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-masters-green text-masters-cream text-left">
              {canBid && <th className="px-3 py-3 w-8" />}
              <th className="px-4 py-3">Golfer</th>
              <th className="px-4 py-3 text-right">Current High</th>
              <th className="px-4 py-3 text-right">My Bid</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {golfers.map((golfer) => {
              const msg = messages[golfer.id];
              const iAmHighBidder = golfer.highBidderId === user?.id;
              const minBid = golfer.highBid !== null ? golfer.highBid + 1 : 1;
              const isCartEligible = !golfer.isOwned && !iAmHighBidder && canBid;
              const inCart = cart.has(golfer.id);
              const inWatchlist = watchlist.has(golfer.id);

              return (
                <tr
                  key={golfer.id}
                  className={`border-b border-masters-cream-dark last:border-0 ${
                    golfer.isOwned  ? 'bg-gray-50' :
                    inCart          ? 'bg-blue-50/40' : ''
                  }`}
                >
                  {/* Checkbox */}
                  {canBid && (
                    <td className="px-3 py-3">
                      {isCartEligible && (
                        <input
                          type="checkbox"
                          checked={inCart}
                          onChange={() => toggleCart(golfer.id)}
                          className="w-4 h-4 accent-masters-green"
                        />
                      )}
                    </td>
                  )}

                  {/* Golfer name + watchlist star */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div>
                        <div className="font-medium">
                          {golfer.name}<AmateurBadge isAmateur={golfer.is_amateur} />
                        </div>
                        <div className="text-xs text-gray-400">{golfer.country} · #{golfer.world_ranking ?? '?'}</div>
                      </div>
                      <button
                        onClick={() => toggleWatchlist(golfer.id)}
                        className={`ml-1 p-0.5 rounded transition-colors ${inWatchlist ? 'text-masters-gold' : 'text-gray-200 hover:text-masters-gold'}`}
                        title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                      >
                        <span className="text-base leading-none">★</span>
                      </button>
                    </div>
                  </td>

                  {/* Current high bid */}
                  <td className="px-4 py-3 text-right">
                    {golfer.highBid !== null ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <Money amount={golfer.highBid} className="font-mono text-masters-green" />
                        <span className="text-xs text-gray-400">{golfer.highBidderName}</span>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>

                  {/* My bid + flag status */}
                  <td className="px-4 py-3 text-right">
                    {golfer.myBid ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <MastersFlag status={flagStatus(golfer)} size={18} />
                          <Money amount={golfer.myBid.amount} className="text-masters-green font-semibold" />
                        </div>
                        {iAmHighBidder ? (
                          <span className="text-xs text-masters-green font-medium">High bid</span>
                        ) : (
                          <span className="text-xs text-orange-500 font-medium">Outbid</span>
                        )}
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <MastersFlag status="no_bid" size={18} />
                      </div>
                    )}
                  </td>

                  {/* Action */}
                  <td className="px-4 py-3">
                    {golfer.isOwned ? (
                      <div className="flex justify-end">
                        <span className="badge-green text-xs">Sold</span>
                      </div>
                    ) : iAmHighBidder ? (
                      <div className="flex justify-end">
                        <span className="text-xs text-masters-green font-semibold">High bid ✓</span>
                      </div>
                    ) : canBid ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">$</span>
                            <input
                              type="number"
                              min={minBid}
                              step="1"
                              value={bidAmounts[golfer.id] ?? ''}
                              onChange={(e) => setBidAmounts((a) => ({ ...a, [golfer.id]: e.target.value }))}
                              className="input w-24 text-right pl-5 pr-2"
                            />
                          </div>
                          <button
                            onClick={() => placeBid(golfer.id)}
                            disabled={submitting === golfer.id}
                            className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1"
                          >
                            {submitting === golfer.id && <Spinner className="text-white w-3 h-3" />}
                            {golfer.myBid ? 'Raise' : 'Place Bid'}
                          </button>
                        </div>
                        {msg && (
                          <span className={`text-xs ${msg.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>
                            {msg.text}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Sticky batch-bid bottom bar ───────────────────────────────────── */}
      {cart.size > 0 && canBid && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-masters-green/20 shadow-xl px-4 py-4">
          <div className="max-w-3xl mx-auto">
            {batchProgress ? (
              <div className="flex items-center gap-3">
                <Spinner className="text-masters-green w-5 h-5" />
                <p className="text-sm font-medium text-masters-green">
                  Placing bid {batchProgress.current} of {batchProgress.total}...
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-masters-green">
                    {cart.size} golfer{cart.size !== 1 ? 's' : ''} selected
                  </p>
                  <p className="text-xs text-gray-500">
                    Minimum bid: <span className="font-mono font-semibold text-masters-green">${cartMaxMinBid}</span>
                    {' '}(based on highest selected)
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">$</span>
                    <input
                      type="number"
                      min={cartMaxMinBid}
                      step="1"
                      value={cartAmount}
                      onChange={(e) => setCartAmount(e.target.value)}
                      placeholder={String(cartMaxMinBid)}
                      className="input w-28 text-right pl-6 pr-2"
                    />
                  </div>
                  <button
                    onClick={placeBatchBids}
                    disabled={!batchAmountOk}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    Bid ${batchAmountOk ? batchAmountVal : '??'} on all
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
