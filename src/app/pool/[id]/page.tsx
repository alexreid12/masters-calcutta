export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { StatusBadge, Money, ScoreDisplay } from '@/components/ui';
import Link from 'next/link';
import type { PayoutRule } from '@/types/database';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default async function PoolDashboardPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [poolRes, statsRes, soldCountRes, recentSalesRes, leaderRes, rulesRes] = await Promise.all([
    supabase
      .from('pools')
      .select('*, profiles!commissioner_id(display_name)')
      .eq('id', params.id)
      .single(),
    supabase
      .from('golfers')
      .select('id, status')
      .eq('pool_id', params.id),
    supabase
      .from('ownership')
      .select('id', { count: 'exact', head: true })
      .eq('pool_id', params.id),
    supabase
      .from('ownership')
      .select('*, golfers(name), profiles!user_id(display_name)')
      .eq('pool_id', params.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('leaderboard')
      .select('*')
      .eq('pool_id', params.id)
      .order('total_to_par', { ascending: true })
      .limit(5),
    supabase
      .from('payout_rules')
      .select('*')
      .eq('pool_id', params.id)
      .eq('is_active', true)
      .order('finish_position', { ascending: true }),
  ]);

  if (poolRes.error || !poolRes.data) notFound();
  const pool = poolRes.data;
  const golfers = statsRes.data ?? [];
  const recentSales = recentSalesRes.data ?? [];
  const leaders = leaderRes.data ?? [];
  const allRules: PayoutRule[] = (rulesRes.data ?? []) as PayoutRule[];

  const positionRules = allRules.filter((r) => r.rule_type === 'position');
  const specialRules = allRules.filter((r) => r.rule_type !== 'position');

  const totalGolfers = golfers.length;
  const soldGolfers = soldCountRes.count ?? 0;

  const statusTimeline: { label: string; status: string; current: boolean }[] = [
    { label: 'Setup', status: 'setup', current: pool.status === 'setup' },
    { label: 'Async Bidding', status: 'async_bidding', current: pool.status === 'async_bidding' },
    { label: 'Live Auction', status: 'live_auction', current: pool.status === 'live_auction' },
    { label: 'Locked', status: 'locked', current: pool.status === 'locked' },
    { label: 'Tournament', status: 'tournament_active', current: pool.status === 'tournament_active' },
    { label: 'Completed', status: 'completed', current: pool.status === 'completed' },
  ];
  const currentIdx = statusTimeline.findIndex((s) => s.current);

  const hasPot = pool.total_pot > 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="card bg-masters-green text-white border-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-masters-gold">
              {pool.name} — {pool.year}
            </h2>
            <p className="text-masters-cream/70 text-sm mt-1">
              Commissioner: {(pool as any).profiles?.display_name}
            </p>
          </div>
          <StatusBadge status={pool.status} />
        </div>

        {/* Status timeline */}
        <div className="mt-6 flex items-center gap-0 overflow-x-auto">
          {statusTimeline.map((step, idx) => (
            <div key={step.status} className="flex items-center">
              <div className={`flex flex-col items-center ${idx <= currentIdx ? 'opacity-100' : 'opacity-40'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${step.current ? 'bg-masters-gold text-gray-900' : idx < currentIdx ? 'bg-masters-cream/40 text-white' : 'bg-masters-green-light/30 text-masters-cream/50'}`}>
                  {idx < currentIdx ? '✓' : idx + 1}
                </div>
                <span className="text-xs text-masters-cream/70 mt-1 whitespace-nowrap hidden sm:block">
                  {step.label}
                </span>
              </div>
              {idx < statusTimeline.length - 1 && (
                <div className={`h-0.5 w-8 sm:w-12 mx-1 ${idx < currentIdx ? 'bg-masters-cream/40' : 'bg-masters-green-light/30'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Prize Pot', value: <Money amount={pool.total_pot} className="text-masters-green text-xl font-semibold" /> },
          { label: 'Total Golfers', value: <span className="text-xl font-mono font-semibold text-masters-green">{totalGolfers}</span> },
          { label: 'Golfers Sold', value: <span className="text-xl font-mono font-semibold text-masters-green">{soldGolfers}</span> },
          { label: 'Remaining', value: <span className="text-xl font-mono font-semibold text-masters-green">{totalGolfers - soldGolfers}</span> },
        ].map((stat) => (
          <div key={stat.label} className="card text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{stat.label}</p>
            <div className="mt-1">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Payout Structure */}
      {allRules.length > 0 && (
        <div className="card">
          <h3 className="font-display text-lg text-masters-green mb-4">Payout Structure</h3>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Tournament Finish */}
            {positionRules.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tournament Finish</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-masters-cream-dark">
                      <th className="text-left pb-1.5 font-medium text-gray-600">Position</th>
                      <th className="text-right pb-1.5 font-medium text-gray-600">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionRules.map((rule) => (
                      <tr key={rule.id} className="border-b border-masters-cream-dark last:border-0">
                        <td className="py-2 text-gray-700">
                          {rule.label || `${ordinal(rule.finish_position)} Place`}
                        </td>
                        <td className="py-2 text-right">
                          <span className="font-mono font-semibold text-masters-green">
                            {Number(rule.payout_percentage).toFixed(1)}%
                          </span>
                          {hasPot && (
                            <span className="text-xs text-gray-400 ml-1.5">
                              (${Math.round((Number(rule.payout_percentage) / 100) * pool.total_pot).toLocaleString()})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Special Awards */}
            {specialRules.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Special Awards</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-masters-cream-dark">
                      <th className="text-left pb-1.5 font-medium text-gray-600">Award</th>
                      <th className="text-right pb-1.5 font-medium text-gray-600">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specialRules.map((rule) => (
                      <tr key={rule.id} className="border-b border-masters-cream-dark last:border-0">
                        <td className="py-2 text-gray-700">
                          {rule.label}
                          {rule.round_number !== null && (
                            <span className="text-xs text-gray-400 ml-1">— Day {rule.round_number}</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <span className="font-mono font-semibold text-masters-green">
                            {Number(rule.payout_percentage).toFixed(1)}%
                          </span>
                          {hasPot && (
                            <span className="text-xs text-gray-400 ml-1.5">
                              (${Math.round((Number(rule.payout_percentage) / 100) * pool.total_pot).toLocaleString()})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-masters-cream-dark">
            If golfers tie for a position, payouts for those positions are combined and split evenly among the tied golfers&apos; owners.
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Sales */}
        {recentSales.length > 0 && (
          <div className="card">
            <h3 className="font-display text-lg text-masters-green mb-3">Recent Sales</h3>
            <div className="space-y-2">
              {recentSales.map((sale: any) => (
                <div key={sale.id} className="flex items-center justify-between py-1.5 border-b border-masters-cream-dark last:border-0">
                  <div>
                    <p className="font-medium text-sm">{sale.golfers?.name}</p>
                    <p className="text-xs text-gray-400">{sale.profiles?.display_name}</p>
                  </div>
                  <Money amount={sale.purchase_price} className="text-masters-green text-sm" />
                </div>
              ))}
            </div>
            <Link href={`/pool/${params.id}/field`} className="block mt-3 text-xs text-masters-green hover:underline">
              View full field →
            </Link>
          </div>
        )}

        {/* Mini leaderboard */}
        {leaders.length > 0 && (
          <div className="card">
            <h3 className="font-display text-lg text-masters-green mb-3">Leaderboard</h3>
            <div className="space-y-1">
              {leaders.map((entry: any, i) => (
                <div key={entry.golfer_id} className="flex items-center gap-3 py-1.5 border-b border-masters-cream-dark last:border-0">
                  <span className="text-sm font-mono text-gray-400 w-5">{entry.position_display ?? i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.name}</p>
                    {entry.owner_name && (
                      <p className="text-xs text-gray-400">{entry.owner_name}</p>
                    )}
                  </div>
                  <ScoreDisplay score={entry.total_to_par} />
                </div>
              ))}
            </div>
            {pool.status === 'tournament_active' || pool.status === 'completed' ? (
              <Link href={`/pool/${params.id}/leaderboard`} className="block mt-3 text-xs text-masters-green hover:underline">
                Full leaderboard →
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {/* CTA based on status */}
      {pool.status === 'async_bidding' && (
        <div className="card bg-blue-50 border-blue-200">
          <p className="text-blue-800 font-medium">
            Async bidding is open!{' '}
            <Link href={`/pool/${params.id}/auction/async`} className="underline">
              Place your bids →
            </Link>
          </p>
          {pool.async_bid_deadline && (
            <p className="text-blue-600 text-sm mt-1">
              Deadline: {new Date(pool.async_bid_deadline).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {pool.status === 'live_auction' && (
        <div className="card bg-masters-gold/20 border-masters-gold">
          <p className="text-yellow-900 font-medium">
            Live auction is happening now!{' '}
            <Link href={`/pool/${params.id}/auction/live`} className="underline">
              Join the auction →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
