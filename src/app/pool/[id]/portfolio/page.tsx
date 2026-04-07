export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ScoreDisplay, Money, GolferStatusBadge, AmateurBadge } from '@/components/ui';

export default async function PortfolioPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/pool/${params.id}/portfolio`);

  const [ownershipsRes, leaderboardRes] = await Promise.all([
    supabase
      .from('ownership')
      .select('*, golfers(*)')
      .eq('pool_id', params.id)
      .eq('user_id', user.id),
    supabase
      .from('leaderboard')
      .select('*')
      .eq('pool_id', params.id),
  ]);

  const ownerships = ownershipsRes.data ?? [];
  const leaderMap = new Map((leaderboardRes.data ?? []).map((e: any) => [e.golfer_id, e]));

  const totalSpent = ownerships.reduce((sum: number, o: any) => sum + Number(o.purchase_price), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-masters-green">My Portfolio</h2>
        <div className="text-right">
          <p className="text-xs text-gray-400">Total Invested</p>
          <Money amount={totalSpent} className="text-masters-green font-semibold" />
        </div>
      </div>

      {ownerships.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">You don&apos;t own any golfers yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ownerships.map((ownership: any) => {
            const golfer = ownership.golfers;
            const entry = leaderMap.get(ownership.golfer_id);
            return (
              <div
                key={ownership.id}
                className="card border border-masters-cream-dark hover:border-masters-gold/40 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-masters-green">
                      {golfer?.name}<AmateurBadge isAmateur={golfer?.is_amateur ?? false} />
                    </h3>
                    <p className="text-xs text-gray-400">{golfer?.country}</p>
                  </div>
                  <GolferStatusBadge status={golfer?.status ?? 'active'} />
                </div>

                <div className="flex gap-4 mt-3">
                  <div>
                    <p className="text-xs text-gray-400">Paid</p>
                    <Money amount={ownership.purchase_price} className="text-gray-700 font-semibold" />
                  </div>
                  {entry && (
                    <>
                      <div>
                        <p className="text-xs text-gray-400">Score</p>
                        <ScoreDisplay score={entry.total_to_par} />
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Pos</p>
                        <span className="font-mono font-semibold text-masters-green">
                          {entry.position_display ?? '—'}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Thru</p>
                        <span className="font-mono text-gray-600">
                          {entry.thru === 18 ? 'F' : entry.thru ?? '-'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-masters-cream-dark">
                  <span className="text-xs text-gray-400 capitalize">{ownership.acquired_via.replace('_', ' ')}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
