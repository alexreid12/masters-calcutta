'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Spinner, ScoreDisplay } from '@/components/ui';
import { calculatePayouts } from '@/lib/payout-engine';
import type { LeaderboardEntry, PayoutRule, Ownership, Score, Golfer } from '@/types/database';

interface OwnerStanding {
  owner_id: string;
  owner_name: string;
  totalSpent: number;
  projectedPayout: number;
  netProfit: number;
  golfers: {
    golfer_id: string;
    name: string;
    purchasePrice: number;
    totalToPar: number | null;
    positionDisplay: string | null;
    position: number | null;
    golferStatus: string;
    projPayout: number;
    thru: number | null;
  }[];
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export default function StandingsPage({ params }: { params: { id: string } }) {
  const supabase = useRef(createClient()).current;

  const [standings, setStandings] = useState<OwnerStanding[]>([]);
  const [totalPot, setTotalPot] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel(`standings:${params.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `pool_id=eq.${params.id}` }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ownership', filter: `pool_id=eq.${params.id}` }, () => loadData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function loadData() {
    const [poolRes, rulesRes, ownershipsRes, scoresRes, golfersRes, leaderboardRes] = await Promise.all([
      supabase.from('pools').select('total_pot, status').eq('id', params.id).single(),
      supabase.from('payout_rules').select('*').eq('pool_id', params.id).eq('is_active', true),
      supabase.from('ownership').select('*, profile:profiles(display_name)').eq('pool_id', params.id),
      supabase.from('scores').select('*').eq('pool_id', params.id),
      supabase.from('golfers').select('*').eq('pool_id', params.id),
      supabase.from('leaderboard').select('*').eq('pool_id', params.id).order('total_to_par', { ascending: true, nullsFirst: false }),
    ]);

    const pool = poolRes.data;
    const rules = (rulesRes.data ?? []) as PayoutRule[];
    const ownerships = (ownershipsRes.data ?? []) as (Ownership & { profile: { display_name: string } | null })[];
    const scores = (scoresRes.data ?? []) as Score[];
    const golfers = (golfersRes.data ?? []) as Golfer[];
    const leaderboard = (leaderboardRes.data ?? []) as LeaderboardEntry[];

    if (!pool) { setLoading(false); return; }

    setTotalPot(pool.total_pot);

    // Calculate projected payouts
    const payouts = calculatePayouts({
      totalPot: pool.total_pot,
      leaderboard,
      rules,
      ownerships,
      scores,
      golfers,
    });

    // Sum payouts per golfer
    const golferPayoutMap = new Map<string, number>();
    for (const p of payouts) {
      golferPayoutMap.set(p.golfer_id, (golferPayoutMap.get(p.golfer_id) ?? 0) + p.payout_amount);
    }

    // Build leaderboard lookup
    const lbMap = new Map(leaderboard.map((e) => [e.golfer_id, e]));
    const golferNameMap = new Map(golfers.map((g) => [g.id, g.name]));

    // Group by owner
    const ownerMap = new Map<string, OwnerStanding>();

    for (const ownership of ownerships) {
      const ownerId = ownership.user_id;
      const ownerName = ownership.profile?.display_name ?? 'Unknown';

      if (!ownerMap.has(ownerId)) {
        ownerMap.set(ownerId, {
          owner_id: ownerId,
          owner_name: ownerName,
          totalSpent: 0,
          projectedPayout: 0,
          netProfit: 0,
          golfers: [],
        });
      }

      const entry = ownerMap.get(ownerId)!;
      const lb = lbMap.get(ownership.golfer_id);
      const projPayout = golferPayoutMap.get(ownership.golfer_id) ?? 0;

      entry.totalSpent += ownership.purchase_price;
      entry.projectedPayout += projPayout;
      entry.golfers.push({
        golfer_id: ownership.golfer_id,
        name: golferNameMap.get(ownership.golfer_id) ?? ownership.golfer_id,
        purchasePrice: ownership.purchase_price,
        totalToPar: lb?.total_to_par ?? null,
        positionDisplay: lb?.position_display ?? null,
        position: lb?.position ?? null,
        golferStatus: lb?.golfer_status ?? 'active',
        projPayout,
        thru: lb?.thru ?? null,
      });
    }

    // Finalize net profit and sort golfers by score
    const result: OwnerStanding[] = [];
    for (const standing of Array.from(ownerMap.values())) {
      standing.netProfit = standing.projectedPayout - standing.totalSpent;
      standing.golfers.sort((a, b) => (a.totalToPar ?? 999) - (b.totalToPar ?? 999));
      result.push(standing);
    }

    // Sort owners by net profit desc
    result.sort((a, b) => b.netProfit - a.netProfit);

    setStandings(result);
    setUpdatedAt(new Date());
    setLoading(false);
  }

  function toggleExpand(ownerId: string) {
    setExpandedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;

  // Summary stats
  const totalProjected = standings.reduce((s, o) => s + o.projectedPayout, 0);
  const leader = standings[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-masters-green">Owner Standings</h2>
        {updatedAt && (
          <p className="text-xs text-gray-400">Live · Updated {updatedAt.toLocaleTimeString()}</p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 mb-1">Total Pot</p>
          <p className="font-display text-xl text-masters-green font-semibold">
            ${totalPot.toLocaleString()}
          </p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 mb-1">Projected Out</p>
          <p className="font-display text-xl text-masters-gold font-semibold">
            ${Math.round(totalProjected).toLocaleString()}
          </p>
        </div>
        {leader && (
          <div className="card text-center py-4 col-span-2 sm:col-span-1">
            <p className="text-xs text-gray-500 mb-1">Current Leader</p>
            <p className="font-display text-lg text-masters-green font-semibold truncate">{leader.owner_name}</p>
            <p className={`text-sm font-mono font-semibold ${leader.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {leader.netProfit >= 0 ? '+' : ''}${Math.round(leader.netProfit).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {standings.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">No ownership data yet.</div>
      ) : (
        <div className="space-y-3">
          {standings.map((owner, idx) => {
            const isExpanded = expandedOwners.has(owner.owner_id);
            const rank = idx + 1;
            return (
              <div key={owner.owner_id} className="card p-0 overflow-hidden">
                {/* Owner header row */}
                <button
                  onClick={() => toggleExpand(owner.owner_id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Rank badge */}
                    <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                      ${rank === 1 ? 'bg-masters-gold text-white' :
                        rank === 2 ? 'bg-gray-400 text-white' :
                        rank === 3 ? 'bg-amber-700 text-white' :
                        'bg-gray-100 text-gray-600'}`}>
                      {rank}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-masters-green truncate">{owner.owner_name}</p>
                      <p className="text-xs text-gray-400">
                        {owner.golfers.length} golfer{owner.golfers.length !== 1 ? 's' : ''} · spent ${owner.totalSpent.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 ml-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Proj. Payout</p>
                      <p className="font-mono font-semibold text-masters-green text-sm">
                        ${Math.round(owner.projectedPayout).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Net</p>
                      <p className={`font-mono font-semibold text-sm ${owner.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {owner.netProfit >= 0 ? '+' : ''}${Math.round(owner.netProfit).toLocaleString()}
                      </p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Golfer breakdown */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                          <th className="px-4 py-2 text-left font-medium">Golfer</th>
                          <th className="px-4 py-2 text-center font-medium">Pos</th>
                          <th className="px-4 py-2 text-right font-medium">Score</th>
                          <th className="px-4 py-2 text-center font-medium">Thru</th>
                          <th className="px-4 py-2 text-right font-medium">Paid</th>
                          <th className="px-4 py-2 text-right font-medium">Proj.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {owner.golfers.map((g) => (
                          <tr key={g.golfer_id} className={`border-t border-gray-50 ${g.golferStatus !== 'active' ? 'opacity-60' : ''}`}>
                            <td className="px-4 py-2 font-medium">{g.name}</td>
                            <td className="px-4 py-2 text-center font-mono text-gray-500 text-xs">
                              {g.positionDisplay ?? (g.position ? ordinal(g.position) : '—')}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <ScoreDisplay score={g.totalToPar} />
                            </td>
                            <td className="px-4 py-2 text-center font-mono text-gray-500 text-xs">
                              {g.golferStatus === 'missed_cut' ? 'MC' :
                               g.golferStatus === 'withdrawn' ? 'WD' :
                               g.thru === 18 ? 'F' :
                               g.thru !== null ? `${g.thru}` : '-'}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-gray-500 text-xs">
                              ${g.purchasePrice}
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-semibold text-xs">
                              {g.projPayout > 0 ? (
                                <span className="text-masters-green">${Math.round(g.projPayout)}</span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center mt-4">
        Payouts are projected based on current standings · Final payouts calculated after tournament completion
      </p>
    </div>
  );
}
