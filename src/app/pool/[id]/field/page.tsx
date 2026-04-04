export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { GolferStatusBadge, Money } from '@/components/ui';

export default async function FieldPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [golfersRes, highBidsRes, ownershipsRes] = await Promise.all([
    supabase
      .from('golfers')
      .select('*')
      .eq('pool_id', params.id)
      .order('world_ranking', { ascending: true, nullsFirst: false }),
    supabase
      .from('async_high_bids')
      .select('*')
      .eq('pool_id', params.id),
    supabase
      .from('ownership')
      .select('golfer_id, purchase_price, profiles!user_id(display_name)')
      .eq('pool_id', params.id),
  ]);

  if (golfersRes.error) notFound();

  const golfers = golfersRes.data ?? [];
  const highBids = new Map((highBidsRes.data ?? []).map((b: any) => [b.golfer_id, b.high_bid]));
  const owners = new Map((ownershipsRes.data ?? []).map((o: any) => [o.golfer_id, { price: o.purchase_price, name: o.profiles?.display_name }]));

  return (
    <div>
      <h2 className="font-display text-2xl text-masters-green mb-4">Field</h2>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-masters-green text-masters-cream text-left">
              <th className="px-4 py-3 font-semibold">Rank</th>
              <th className="px-4 py-3 font-semibold">Golfer</th>
              <th className="px-4 py-3 font-semibold">Country</th>
              <th className="px-4 py-3 font-semibold text-right">High Bid</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {golfers.map((golfer, idx) => {
              const owner = owners.get(golfer.id);
              const highBid = highBids.get(golfer.id);
              return (
                <tr
                  key={golfer.id}
                  className={`border-b border-masters-cream-dark last:border-0 ${owner ? 'bg-masters-green/5' : ''}`}
                >
                  <td className="px-4 py-3 font-mono text-gray-400">
                    {golfer.world_ranking ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{golfer.name}</span>
                      <GolferStatusBadge status={golfer.status} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{golfer.country ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {highBid ? (
                      <Money amount={Number(highBid)} className="text-masters-green" />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {owner ? (
                      <span className="badge-green">{owner.name}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {owner ? (
                      <Money amount={owner.price} className="font-semibold text-masters-green" />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {golfers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                  No golfers in the field yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
