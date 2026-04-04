export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { Money, ScoreDisplay } from '@/components/ui';

export default async function PayoutsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [payoutsRes, poolRes] = await Promise.all([
    supabase
      .from('payouts')
      .select('*, golfers(name, is_amateur), profiles!user_id(display_name), payout_rules(label, rule_type, round_number)')
      .eq('pool_id', params.id)
      .order('finish_position', { ascending: true }),
    supabase.from('pools').select('total_pot').eq('id', params.id).single(),
  ]);

  const payouts = payoutsRes.data ?? [];
  const totalPot = Number(poolRes.data?.total_pot ?? 0);

  const positionPayouts = payouts.filter(
    (p) => (p.rule_type ?? p.payout_rules?.rule_type ?? 'position') === 'position'
  );
  const specialPayouts = payouts.filter(
    (p) => (p.rule_type ?? p.payout_rules?.rule_type ?? 'position') !== 'position'
  );

  // Per-user totals (all payouts combined)
  const userTotals = new Map<string, { name: string; total: number; net: number; golfers: string[] }>();
  for (const p of payouts) {
    const name = p.profiles?.display_name ?? 'Unknown';
    if (!userTotals.has(p.user_id)) {
      userTotals.set(p.user_id, { name, total: 0, net: 0, golfers: [] });
    }
    const entry = userTotals.get(p.user_id)!;
    entry.total += Number(p.payout_amount);
    entry.net += Number(p.net_profit);
    const gname = p.golfers?.name ?? '?';
    if (!entry.golfers.includes(gname)) entry.golfers.push(gname);
  }
  const winners = Array.from(userTotals.values()).sort((a, b) => b.total - a.total);

  function formatPos(pos: number): string {
    if (pos < 0) return '—';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = pos % 100;
    return `${pos}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-masters-green">Payouts</h2>
        <div className="text-right">
          <p className="text-xs text-gray-400">Total Prize Pot</p>
          <Money amount={totalPot} className="text-masters-green font-semibold text-lg" />
        </div>
      </div>

      {payouts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">Payouts have not been calculated yet.</p>
        </div>
      ) : (
        <>
          {/* Winner summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {winners.map((w, i) => (
              <div
                key={w.name}
                className={`card border ${i === 0 ? 'border-masters-gold bg-masters-gold/10' : 'border-masters-cream-dark'}`}
              >
                {i === 0 && <span className="badge-gold mb-2">Top Earner</span>}
                <h3 className="font-display text-lg font-semibold text-masters-green">{w.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{w.golfers.join(', ')}</p>
                <div className="flex gap-4 mt-3">
                  <div>
                    <p className="text-xs text-gray-400">Winnings</p>
                    <Money amount={w.total} className="text-masters-green font-semibold" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Net</p>
                    <Money
                      amount={w.net}
                      className={`font-semibold ${w.net >= 0 ? 'text-green-600' : 'text-red-500'}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Tournament Finish ───────────────────────────────────────────── */}
          {positionPayouts.length > 0 && (
            <div>
              <h3 className="font-display text-xl text-masters-green mb-3">Tournament Finish</h3>
              <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-masters-green text-masters-cream text-left">
                      <th className="px-4 py-3 font-semibold w-16">Pos</th>
                      <th className="px-4 py-3 font-semibold">Golfer</th>
                      <th className="px-4 py-3 font-semibold">Owner</th>
                      <th className="px-4 py-3 font-semibold text-right">Paid</th>
                      <th className="px-4 py-3 font-semibold text-right">Winnings</th>
                      <th className="px-4 py-3 font-semibold text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positionPayouts.map((p) => (
                      <tr key={p.id} className="border-b border-masters-cream-dark last:border-0">
                        <td className="px-4 py-3 font-mono text-gray-500">{formatPos(p.finish_position)}</td>
                        <td className="px-4 py-3 font-medium">
                          {p.golfers?.name}
                          {p.golfers?.is_amateur && (
                            <span className="ml-1 text-xs text-purple-600 font-semibold">(Am)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{p.profiles?.display_name}</td>
                        <td className="px-4 py-3 text-right">
                          <Money amount={p.purchase_price ?? 0} className="text-gray-500 text-xs" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Money amount={p.payout_amount} className="text-masters-green font-semibold" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Money
                            amount={p.net_profit}
                            className={Number(p.net_profit) >= 0 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Special Awards ──────────────────────────────────────────────── */}
          {specialPayouts.length > 0 && (
            <div>
              <h3 className="font-display text-xl text-masters-green mb-3">Special Awards</h3>
              <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-masters-green text-masters-cream text-left">
                      <th className="px-4 py-3 font-semibold">Award</th>
                      <th className="px-4 py-3 font-semibold">Golfer</th>
                      <th className="px-4 py-3 font-semibold text-right">Score</th>
                      <th className="px-4 py-3 font-semibold">Owner</th>
                      <th className="px-4 py-3 font-semibold text-right">Winnings</th>
                      <th className="px-4 py-3 font-semibold text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specialPayouts.map((p) => {
                      const ruleType = p.rule_type ?? p.payout_rules?.rule_type;
                      const label = p.payout_rules?.label ?? ruleType;
                      const roundNum = p.payout_rules?.round_number;

                      return (
                        <tr key={p.id} className="border-b border-masters-cream-dark last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-800">{label}</p>
                            {roundNum && (
                              <p className="text-xs text-gray-400">Round {roundNum}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium">{p.golfers?.name}</td>
                          <td className="px-4 py-3 text-right">
                            <ScoreDisplay score={p.award_score ?? null} />
                          </td>
                          <td className="px-4 py-3 text-gray-600">{p.profiles?.display_name}</td>
                          <td className="px-4 py-3 text-right">
                            <Money amount={p.payout_amount} className="text-masters-green font-semibold" />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Money
                              amount={p.net_profit}
                              className={Number(p.net_profit) >= 0 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
