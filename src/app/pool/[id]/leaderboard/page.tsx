'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ScoreDisplay, GolferStatusBadge, Spinner, AmateurBadge } from '@/components/ui';
import { calculatePayouts } from '@/lib/payout-engine';
import type { LeaderboardEntry, PayoutRule, Ownership, Score, Golfer } from '@/types/database';

interface PoolMessage {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  profile: { display_name: string } | null;
}

export default function LeaderboardPage({ params }: { params: { id: string } }) {
  const supabase = useRef(createClient()).current;

  // Leaderboard
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [amateurIds, setAmateurIds] = useState<Set<string>>(new Set());

  // Payouts
  const [payoutMap, setPayoutMap] = useState<Map<string, number>>(new Map());
  const [poolStatus, setPoolStatus] = useState('');

  // Chat
  const [messages, setMessages] = useState<PoolMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });

    loadData();
    loadMessages();

    const scoreChannel = supabase
      .channel(`leaderboard:${params.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `pool_id=eq.${params.id}` }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ownership', filter: `pool_id=eq.${params.id}` }, () => loadData())
      .subscribe();

    const msgChannel = supabase
      .channel(`messages:${params.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pool_messages', filter: `pool_id=eq.${params.id}` }, () => loadMessages())
      .subscribe();

    return () => {
      supabase.removeChannel(scoreChannel);
      supabase.removeChannel(msgChannel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadData() {
    const [leaderboardRes, poolRes, rulesRes, ownershipsRes, scoresRes, golfersRes] = await Promise.all([
      supabase.from('leaderboard').select('*').eq('pool_id', params.id).order('total_to_par', { ascending: true, nullsFirst: false }),
      supabase.from('pools').select('total_pot, status').eq('id', params.id).single(),
      supabase.from('payout_rules').select('*').eq('pool_id', params.id).eq('is_active', true),
      supabase.from('ownership').select('*').eq('pool_id', params.id),
      supabase.from('scores').select('*').eq('pool_id', params.id),
      supabase.from('golfers').select('*').eq('pool_id', params.id),
    ]);

    const data = (leaderboardRes.data ?? []) as LeaderboardEntry[];
    const pool = poolRes.data;
    const rules = (rulesRes.data ?? []) as PayoutRule[];
    const ownerships = (ownershipsRes.data ?? []) as Ownership[];
    const scores = (scoresRes.data ?? []) as Score[];
    const golfers = (golfersRes.data ?? []) as Golfer[];
    setAmateurIds(new Set(golfers.filter((g) => g.is_amateur).map((g) => g.id)));

    setEntries((prev) => {
      const prevMap = new Map(prev.map((e) => [e.golfer_id, e.total_to_par]));
      const changed = new Set<string>();
      data.forEach((e) => {
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

    if (pool) {
      setPoolStatus(pool.status);

      if ((pool.status === 'tournament_active' || pool.status === 'completed') && rules.length > 0) {
        const payouts = calculatePayouts({ totalPot: pool.total_pot, leaderboard: data, rules, ownerships, scores, golfers });
        const map = new Map<string, number>();
        for (const p of payouts) {
          map.set(p.golfer_id, (map.get(p.golfer_id) ?? 0) + p.payout_amount);
        }
        setPayoutMap(map);
      }
    }

    setUpdatedAt(new Date());
    setLoading(false);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('pool_messages')
      .select('id, user_id, message, created_at, profile:profiles(display_name)')
      .eq('pool_id', params.id)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) setMessages(data as unknown as PoolMessage[]);
  }

  async function sendMessage() {
    if (!messageInput.trim() || !currentUserId || sending) return;
    setSending(true);
    await supabase.from('pool_messages').insert({
      pool_id: params.id,
      user_id: currentUserId,
      message: messageInput.trim(),
    });
    setMessageInput('');
    setSending(false);
  }

  const showPayouts = poolStatus === 'tournament_active' || poolStatus === 'completed';

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;

  const leaderboardTable = (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-masters-green text-masters-cream text-left">
            <th className="px-4 py-3 font-semibold w-14">Pos</th>
            <th className="px-4 py-3 font-semibold">Golfer</th>
            <th className="px-4 py-3 font-semibold text-right">To Par</th>
            <th className="px-4 py-3 font-semibold text-center">Thru</th>
            <th className="px-4 py-3 font-semibold">Owner</th>
            {showPayouts && <th className="px-4 py-3 font-semibold text-right">Proj. Payout</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => {
            const isFlashing = flashedIds.has(entry.golfer_id);
            const projPayout = payoutMap.get(entry.golfer_id) ?? 0;
            const netProfit = entry.purchase_price !== null ? projPayout - entry.purchase_price : null;
            return (
              <tr
                key={entry.golfer_id}
                className={`border-b border-masters-cream-dark last:border-0 transition-colors
                  ${isFlashing ? 'score-pulse bg-masters-gold/10' : ''}
                  ${entry.owner_id ? 'bg-masters-green/5' : ''}
                  ${entry.golfer_status !== 'active' ? 'opacity-60' : ''}`}
              >
                <td className="px-4 py-3 font-mono text-gray-500 text-sm">
                  {entry.position_display ?? entry.position ?? idx + 1}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium">{entry.name}</span>
                    <AmateurBadge isAmateur={amateurIds.has(entry.golfer_id)} />
                    <GolferStatusBadge status={entry.golfer_status} />
                    {entry.country && <span className="text-gray-400 text-xs">{entry.country}</span>}
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
                {showPayouts && (
                  <td className="px-4 py-3 text-right">
                    {projPayout > 0 ? (
                      <div>
                        <span className="font-mono font-semibold text-masters-green">
                          ${Math.round(projPayout)}
                        </span>
                        {netProfit !== null && (
                          <span className={`block text-xs font-mono ${netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {netProfit >= 0 ? '+' : ''}${Math.round(netProfit)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={showPayouts ? 6 : 5} className="px-4 py-12 text-center text-gray-400">
                Scores not available yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const chatPanel = (
    <div className="card flex flex-col" style={{ height: 500 }}>
      <h3 className="font-display text-lg text-masters-green font-semibold mb-3">Trash Talk</h3>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No messages yet. Start the trash talk!</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.user_id === currentUserId;
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-gray-400 mb-0.5">
                {msg.profile?.display_name ?? 'Unknown'}
              </span>
              <div className={`rounded-lg px-3 py-2 max-w-[85%] text-sm break-words ${isMe ? 'bg-masters-green text-white' : 'bg-gray-100 text-gray-800'}`}>
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={chatBottomRef} />
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100">
        {currentUserId ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value.slice(0, 500))}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Type a message… (Enter to send)"
              className="flex-1 input text-sm"
            />
            <button
              onClick={sendMessage}
              disabled={!messageInput.trim() || sending}
              className="btn-primary text-sm px-3"
            >
              Send
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center">Sign in to chat</p>
        )}
        <p className="text-right text-xs text-gray-300 mt-1">{messageInput.length}/500</p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl text-masters-green">Leaderboard</h2>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <p className="text-xs text-gray-400">Live · Updated {updatedAt.toLocaleTimeString()}</p>
          )}
          <button
            onClick={() => setChatOpen((o) => !o)}
            className="lg:hidden px-3 py-1.5 rounded border border-masters-green text-masters-green text-sm font-medium hover:bg-masters-green/5 transition-colors"
          >
            {chatOpen ? 'Hide Chat' : '💬 Chat'}
          </button>
        </div>
      </div>

      {chatOpen && (
        <div className="lg:hidden mb-4">{chatPanel}</div>
      )}

      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:gap-4 lg:items-start">
        <div>{leaderboardTable}</div>
        <div className="hidden lg:block lg:sticky lg:top-4">{chatPanel}</div>
      </div>
    </div>
  );
}
