export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { AmateurBadge } from '@/components/ui';
import type { Golfer } from '@/types/database';

interface HighBid {
  golfer_id: string;
  high_bid: number;
  high_bidder_id: string;
  high_bidder_name: string;
}

export default async function AsyncResultsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [golfersRes, highBidsRes] = await Promise.all([
    supabase
      .from('golfers')
      .select('*')
      .eq('pool_id', params.id)
      .order('world_ranking', { nullsFirst: false }),
    supabase
      .from('async_high_bids')
      .select('golfer_id, high_bid, high_bidder_id, high_bidder_name')
      .eq('pool_id', params.id),
  ]);

  const golfers = (golfersRes.data ?? []) as Golfer[];
  const highBids = (highBidsRes.data ?? []) as HighBid[];

  const highBidMap = new Map(highBids.map((b) => [b.golfer_id, b]));

  // Split into bid / no-bid, sort bid rows descending by amount
  const withBids = golfers
    .filter((g) => highBidMap.has(g.id))
    .sort((a, b) => (highBidMap.get(b.id)?.high_bid ?? 0) - (highBidMap.get(a.id)?.high_bid ?? 0));
  const noBids = golfers.filter((g) => !highBidMap.has(g.id));

  // Summary metrics
  const totalPot = highBids.reduce((s, b) => s + Number(b.high_bid), 0);
  const golfersWithBids = withBids.length;
  const golfersNoBids = noBids.length;

  // By-bidder summary
  const bidderMap = new Map<string, { name: string; golfers: { golferName: string; amount: number }[]; total: number }>();
  for (const bid of highBids) {
    const key = bid.high_bidder_id;
    if (!bidderMap.has(key)) {
      bidderMap.set(key, { name: bid.high_bidder_name, golfers: [], total: 0 });
    }
    const entry = bidderMap.get(key)!;
    const golferName = golfers.find((g) => g.id === bid.golfer_id)?.name ?? bid.golfer_id;
    entry.golfers.push({ golferName, amount: Number(bid.high_bid) });
    entry.total += Number(bid.high_bid);
  }
  const bidderRows = Array.from(bidderMap.values())
    .map((r) => ({ ...r, golfers: r.golfers.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-2xl text-masters-green">Async Bidding Results</h2>
        <p className="text-sm text-gray-500 mt-0.5">Final bids at close of async phase</p>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Async Pot</p>
          <p className="font-display text-xl font-semibold text-masters-green">${totalPot.toLocaleString()}</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Golfers with Bids</p>
          <p className="font-display text-xl font-semibold text-masters-green">{golfersWithBids}</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Golfers with No Bids</p>
          <p className="font-display text-xl font-semibold text-gray-400">{golfersNoBids}</p>
        </div>
      </div>

      {/* Main results table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-masters-green text-masters-cream text-left">
              <th className="px-4 py-3 font-semibold">Golfer</th>
              <th className="px-4 py-3 font-semibold text-center w-16">Rank</th>
              <th className="px-4 py-3 font-semibold">High Bidder</th>
              <th className="px-4 py-3 font-semibold text-right">Winning Bid</th>
            </tr>
          </thead>
          <tbody>
            {withBids.map((g) => {
              const bid = highBidMap.get(g.id)!;
              return (
                <tr key={g.id} className="border-b border-masters-cream-dark last:border-0">
                  <td className="px-4 py-2.5 font-medium">
                    {g.name}<AmateurBadge isAmateur={g.is_amateur} />
                  </td>
                  <td className="px-4 py-2.5 text-center font-mono text-gray-500 text-xs">
                    {g.world_ranking ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="badge-green">{bid.high_bidder_name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-masters-green">
                    ${Number(bid.high_bid).toLocaleString()}
                  </td>
                </tr>
              );
            })}
            {noBids.map((g) => (
              <tr key={g.id} className="border-b border-masters-cream-dark last:border-0 opacity-50">
                <td className="px-4 py-2.5 font-medium">
                  {g.name}<AmateurBadge isAmateur={g.is_amateur} />
                </td>
                <td className="px-4 py-2.5 text-center font-mono text-gray-500 text-xs">
                  {g.world_ranking ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-xs italic">No bids</td>
                <td className="px-4 py-2.5 text-right font-mono text-gray-300">$0</td>
              </tr>
            ))}
            {golfers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-400">
                  No golfers in this pool yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* By-bidder summary */}
      {bidderRows.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-masters-cream-dark">
            <h3 className="font-display text-lg text-masters-green">By Bidder</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-masters-green/10 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-medium">Bidder</th>
                <th className="px-4 py-2 font-medium">Golfers Won</th>
                <th className="px-4 py-2 font-medium text-right">Total Committed</th>
              </tr>
            </thead>
            <tbody>
              {bidderRows.map((row) => (
                <tr key={row.name} className="border-t border-masters-cream-dark hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-semibold text-masters-green whitespace-nowrap">
                    {row.name}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs">
                    {row.golfers.map((g) => `${g.golferName} ($${g.amount})`).join(', ')}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-masters-green whitespace-nowrap">
                    ${row.total.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        These bids became floor prices for the live auction. Winning bids shown are the highest bid per golfer at close of async phase.
      </p>
    </div>
  );
}
