'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { Spinner, Money } from '@/components/ui';
import type { Golfer, AsyncBid, Pool } from '@/types/database';

interface GolferWithBids extends Golfer {
  myBid: AsyncBid | null;
  highBid: number | null;
  isOwned: boolean;
}

export default function AsyncBiddingPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { user } = useAuth();
  const [golfers, setGolfers] = useState<GolferWithBids[]>([]);
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(true);
  const [bidAmounts, setBidAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({});

  async function load() {
    if (!user) return;
    const [poolRes, golfersRes, myBidsRes, highBidsRes, ownedRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase.from('golfers').select('*').eq('pool_id', params.id).order('world_ranking', { nullsFirst: false }),
      supabase.from('async_bids').select('*').eq('pool_id', params.id).eq('user_id', user.id),
      supabase.from('async_high_bids').select('*').eq('pool_id', params.id),
      supabase.from('ownership').select('golfer_id').eq('pool_id', params.id),
    ]);
    if (poolRes.data) setPool(poolRes.data);
    const myBidsMap = new Map((myBidsRes.data ?? []).map((b) => [b.golfer_id, b]));
    const highBidsMap = new Map((highBidsRes.data ?? []).map((b: any) => [b.golfer_id, Number(b.high_bid)]));
    const ownedSet = new Set((ownedRes.data ?? []).map((o: any) => o.golfer_id));
    setGolfers((golfersRes.data ?? []).map((g) => ({
      ...g,
      myBid: myBidsMap.get(g.id) ?? null,
      highBid: highBidsMap.get(g.id) ?? null,
      isOwned: ownedSet.has(g.id),
    })));
    setLoading(false);
  }

  useEffect(() => { load(); }, [user]);

  const canBid = pool?.status === 'async_bidding';

  async function placeBid(golferId: string) {
    const amount = parseFloat(bidAmounts[golferId]);
    if (!amount || amount <= 0) {
      setMessages((m) => ({ ...m, [golferId]: { type: 'error', text: 'Enter a valid amount' } }));
      return;
    }
    setSubmitting(golferId);
    // Retract old bid first
    const existing = golfers.find((g) => g.id === golferId)?.myBid;
    if (existing) {
      await supabase.from('async_bids').delete().eq('id', existing.id);
    }
    const { error } = await supabase.from('async_bids').insert({
      pool_id: params.id,
      golfer_id: golferId,
      user_id: user!.id,
      amount,
      is_max_bid: true,
    });
    if (error) {
      setMessages((m) => ({ ...m, [golferId]: { type: 'error', text: error.message } }));
    } else {
      setMessages((m) => ({ ...m, [golferId]: { type: 'success', text: 'Bid placed!' } }));
      setBidAmounts((a) => ({ ...a, [golferId]: '' }));
      await load();
    }
    setSubmitting(null);
    setTimeout(() => setMessages((m) => { const n = { ...m }; delete n[golferId]; return n; }), 3000);
  }

  async function retractBid(bidId: string, golferId: string) {
    setSubmitting(golferId);
    const { error } = await supabase.from('async_bids').delete().eq('id', bidId);
    if (!error) await load();
    setSubmitting(null);
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-masters-green">Async Bidding</h2>
        {pool?.async_bid_deadline && (
          <p className="text-sm text-gray-500">
            Deadline: {new Date(pool.async_bid_deadline).toLocaleString()}
          </p>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Place your max bids below. High bids become floor prices in the live auction.
        You can retract and rebid at any time before the deadline.
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-masters-green text-masters-cream text-left">
              <th className="px-4 py-3">Golfer</th>
              <th className="px-4 py-3 text-right">Current High</th>
              <th className="px-4 py-3 text-right">My Bid</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {golfers.map((golfer) => {
              const msg = messages[golfer.id];
              return (
                <tr
                  key={golfer.id}
                  className={`border-b border-masters-cream-dark last:border-0 ${golfer.isOwned ? 'bg-gray-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{golfer.name}</div>
                    <div className="text-xs text-gray-400">{golfer.country} · #{golfer.world_ranking ?? '?'}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {golfer.highBid ? <Money amount={golfer.highBid} className="text-masters-green" /> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {golfer.myBid ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <Money amount={golfer.myBid.amount} className="text-masters-green font-semibold" />
                        <button
                          onClick={() => retractBid(golfer.myBid!.id, golfer.id)}
                          disabled={!!submitting || !canBid}
                          className="text-xs text-red-500 hover:underline disabled:opacity-40"
                        >
                          Retract
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {golfer.isOwned ? (
                      <span className="badge-green text-xs">Sold</span>
                    ) : canBid ? (
                      <div className="flex items-center gap-2 justify-end">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="$"
                          value={bidAmounts[golfer.id] ?? ''}
                          onChange={(e) => setBidAmounts((a) => ({ ...a, [golfer.id]: e.target.value }))}
                          className="input w-24 text-right"
                        />
                        <button
                          onClick={() => placeBid(golfer.id)}
                          disabled={submitting === golfer.id}
                          className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1"
                        >
                          {submitting === golfer.id && <Spinner className="text-white w-3 h-3" />}
                          Bid
                        </button>
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
    </div>
  );
}
