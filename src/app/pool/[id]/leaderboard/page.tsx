'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ScoreDisplay, GolferStatusBadge, Spinner } from '@/components/ui';
import type { LeaderboardEntry } from '@/types/database';

export default function LeaderboardPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  async function loadLeaderboard() {
    const { data } = await supabase
      .from('leaderboard')
      .select('*')
      .eq('pool_id', params.id)
      .order('total_to_par', { ascending: true, nullsFirst: false });

    if (data) {
      setEntries((prev) => {
        // Detect changed scores
        const prevMap = new Map(prev.map((e) => [e.golfer_id, e.total_to_par]));
        const changed = new Set<string>();
        data.forEach((e: LeaderboardEntry) => {
          if (prevMap.has(e.golfer_id) && prevMap.get(e.golfer_id) !== e.total_to_par) {
            changed.add(e.golfer_id);
          }
        });
        if (changed.size > 0) {
          setFlashedIds(changed);
          setTimeout(() => setFlashedIds(new Set()), 2500);
        }
        return data;
      });
      setUpdatedAt(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    loadLeaderboard();

    const channel = supabase
      .channel(`leaderboard:${params.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scores', filter: `pool_id=eq.${params.id}` },
        () => loadLeaderboard()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-masters-green">Leaderboard</h2>
        {updatedAt && (
          <p className="text-xs text-gray-400">
            Live · Updated {updatedAt.toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-masters-green text-masters-cream text-left">
              <th className="px-4 py-3 font-semibold w-14">Pos</th>
              <th className="px-4 py-3 font-semibold">Golfer</th>
              <th className="px-4 py-3 font-semibold text-right">To Par</th>
              <th className="px-4 py-3 font-semibold text-center">Thru</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => {
              const isFlashing = flashedIds.has(entry.golfer_id);
              const isOwned = !!entry.owner_id;
              return (
                <tr
                  key={entry.golfer_id}
                  className={`border-b border-masters-cream-dark last:border-0 transition-colors
                    ${isFlashing ? 'score-pulse bg-masters-gold/10' : ''}
                    ${isOwned ? 'bg-masters-green/5' : ''}
                    ${entry.golfer_status !== 'active' ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-3 font-mono text-gray-500 text-sm">
                    {entry.position_display ?? entry.position ?? idx + 1}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-medium">{entry.name}</span>
                      <GolferStatusBadge status={entry.golfer_status} />
                      {entry.country && (
                        <span className="text-gray-400 text-xs">{entry.country}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ScoreDisplay score={entry.total_to_par} />
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-gray-500">
                    {entry.golfer_status === 'missed_cut' ? 'MC' :
                     entry.golfer_status === 'withdrawn' ? 'WD' :
                     entry.thru === 18 ? 'F' :
                     entry.thru !== null ? `${entry.thru}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {entry.owner_name ? (
                      <span className="badge-green">{entry.owner_name}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                  Scores not available yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
