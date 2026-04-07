'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import type { Pool, Golfer, PoolStatus, PoolMember, Profile } from '@/types/database';
import Papa from 'papaparse';
import Link from 'next/link';

const STATUS_TRANSITIONS: Record<PoolStatus, PoolStatus | null> = {
  setup: 'async_bidding',
  async_bidding: 'live_auction',
  live_auction: 'locked',
  locked: 'tournament_active',
  tournament_active: 'completed',
  completed: null,
};

const NEXT_STATUS_LABELS: Record<string, string> = {
  setup: 'Open Async Bidding',
  async_bidding: 'Start Live Auction',
  live_auction: 'Lock Auction',
  locked: 'Start Tournament',
  tournament_active: 'Mark Completed',
  completed: 'Tournament Ended',
};

export default function AdminPage({ params }: { params: { id: string } }) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const { user } = useAuth();
  const router = useRouter();
  const [pool, setPool] = useState<Pool | null>(null);
  const [golfers, setGolfers] = useState<Golfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  // Single add form
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [ranking, setRanking] = useState('');
  const [sportsdataId, setSportsdataId] = useState('');
  const [isAmateur, setIsAmateur] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // CSV bulk add
  const [csvText, setCsvText] = useState('');
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvResult, setCsvResult] = useState('');

  // ESPN field import
  const [espnLoading, setEspnLoading] = useState(false);
  const [espnResult, setEspnResult] = useState<{ text: string; ok: boolean } | null>(null);

  // Manual score refresh
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ text: string; ok: boolean } | null>(null);

  // Status advance
  const [statusLoading, setStatusLoading] = useState(false);

  // Delete pool
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Auction summary
  type AuctionSummaryRow = { user_id: string; display_name: string; golfer_count: number; total_spent: number };
  type BidLeaderRow = { golfer_id: string; golfer_name: string; high_bid: number; high_bidder_name: string };
  type PotBreakdown = { soldTotal: number; soldCount: number; bidTotal: number; bidCount: number };
  const [auctionSummary, setAuctionSummary] = useState<AuctionSummaryRow[]>([]);
  const [bidLeaders, setBidLeaders] = useState<BidLeaderRow[]>([]);
  const [potBreakdown, setPotBreakdown] = useState<PotBreakdown | null>(null);

  // Share & Privacy
  type MemberWithProfile = PoolMember & { profiles: Pick<Profile, 'display_name' | 'email'> | null };
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [isPrivateDraft, setIsPrivateDraft] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  async function load() {
    const [poolRes, golfersRes, membersRes, ownershipRes, bidLeadersRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase.from('golfers').select('*').eq('pool_id', params.id).order('world_ranking', { nullsFirst: false }),
      supabase.from('pool_members').select('*, profiles!user_id(display_name, email)').eq('pool_id', params.id),
      supabase.from('ownership').select('user_id, golfer_id, purchase_price, golfers(name), profiles!user_id(display_name)').eq('pool_id', params.id),
      supabase.from('async_high_bids').select('golfer_id, high_bid, high_bidder_name').eq('pool_id', params.id).order('high_bid', { ascending: false }),
    ]);

    if (poolRes.data) {
      setPool(poolRes.data);
      setIsPrivateDraft(poolRes.data.is_private ?? false);
      setPasswordDraft(poolRes.data.join_password ?? '');
      if (user && poolRes.data.commissioner_id === user.id) {
        setAuthorized(true);
      }
    }
    setGolfers(golfersRes.data ?? []);
    setMembers((membersRes.data as MemberWithProfile[]) ?? []);

    // Build auction summary: group ownership rows by user
    const ownershipRows: any[] = ownershipRes.data ?? [];
    const summaryMap = new Map<string, AuctionSummaryRow>();
    for (const row of ownershipRows) {
      const uid = row.user_id;
      const existing = summaryMap.get(uid);
      if (existing) {
        existing.golfer_count++;
        existing.total_spent += Number(row.purchase_price);
      } else {
        summaryMap.set(uid, {
          user_id: uid,
          display_name: (row.profiles as any)?.display_name ?? 'Unknown',
          golfer_count: 1,
          total_spent: Number(row.purchase_price),
        });
      }
    }
    setAuctionSummary(
      Array.from(summaryMap.values()).sort((a, b) => b.total_spent - a.total_spent)
    );

    // Bid leaders — look up golfer names from already-fetched golfers array
    // (can't use relational select on a view since views have no FK constraints)
    const golferNameMap = new Map((golfersRes.data ?? []).map((g) => [g.id, g.name]));
    const soldGolferIds = new Set(ownershipRows.map((r) => r.golfer_id));
    const bidLeaderRows = (bidLeadersRes.data ?? []).map((r: any) => ({
      golfer_id: r.golfer_id,
      golfer_name: golferNameMap.get(r.golfer_id) ?? 'Unknown',
      high_bid: Number(r.high_bid),
      high_bidder_name: r.high_bidder_name ?? '—',
    }));
    setBidLeaders(bidLeaderRows);

    // Pot breakdown: sold total from ownership, bid total from unsold high bids
    const soldTotal = ownershipRows.reduce((s: number, r: any) => s + Number(r.purchase_price), 0);
    const soldCount = ownershipRows.length;
    const unsoldBids = bidLeaderRows.filter((r) => !soldGolferIds.has(r.golfer_id));
    const bidTotal = unsoldBids.reduce((s, r) => s + r.high_bid, 0);
    const bidCount = unsoldBids.length;
    setPotBreakdown({ soldTotal, soldCount, bidTotal, bidCount });

    setLoading(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function addGolfer(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    const { error } = await supabase.from('golfers').insert({
      pool_id: params.id,
      name: name.trim(),
      country: country.trim() || null,
      world_ranking: ranking ? parseInt(ranking) : null,
      sportsdata_player_id: sportsdataId ? parseInt(sportsdataId) : null,
      is_amateur: isAmateur,
    });
    if (error) {
      setAddError(error.message);
    } else {
      setName(''); setCountry(''); setRanking(''); setSportsdataId(''); setIsAmateur(false);
      await load();
    }
    setAddLoading(false);
  }

  async function removeGolfer(id: string) {
    await supabase.from('golfers').delete().eq('id', id);
    await load();
  }

  async function handleCsvImport() {
    if (!csvText.trim()) return;
    setCsvLoading(true);
    setCsvResult('');

    const result = Papa.parse<Record<string, string>>(csvText.trim(), { header: true, skipEmptyLines: true });
    const rows = result.data;
    let added = 0;
    let failed = 0;

    for (const row of rows) {
      const gname = (row.name || row.Name || row.player || row.Player || '').trim();
      if (!gname) { failed++; continue; }
      const amateurRaw = (row.amateur || row.Amateur || row.is_amateur || '').trim().toLowerCase();
      const rankingStr = (row.ranking || row.Ranking || row.world_ranking || '').trim();
      const espnIdStr = (row.sportsdata_id || row.player_id || '').trim();
      const { error } = await supabase.from('golfers').insert({
        pool_id: params.id,
        name: gname,
        country: (row.country || row.Country || '').trim() || null,
        world_ranking: rankingStr ? parseInt(rankingStr, 10) : null,
        sportsdata_player_id: espnIdStr ? parseInt(espnIdStr, 10) : null,
        is_amateur: amateurRaw === 'true' || amateurRaw === 'yes' || amateurRaw === '1',
      });
      if (error) failed++; else added++;
    }

    setCsvResult(`Added ${added} golfers. ${failed > 0 ? `${failed} failed.` : ''}`);
    setCsvLoading(false);
    setCsvText('');
    await load();
  }

  async function handleEspnImport() {
    setEspnLoading(true);
    setEspnResult(null);
    try {
      const res = await fetch(`/api/pools/${params.id}/import-field`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setEspnResult({ text: data.error ?? 'Import failed', ok: false });
      } else {
        setEspnResult({ text: data.message, ok: true });
        await load();
      }
    } catch {
      setEspnResult({ text: 'Network error — try again', ok: false });
    } finally {
      setEspnLoading(false);
      setTimeout(() => setEspnResult(null), 8000);
    }
  }

  async function handleRefreshScores() {
    setRefreshLoading(true);
    setRefreshResult(null);
    try {
      const res = await fetch(`/api/pools/${params.id}/refresh-scores`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setRefreshResult({ text: data.error ?? 'Refresh failed', ok: false });
      } else {
        setRefreshResult({ text: data.message, ok: true });
      }
    } catch {
      setRefreshResult({ text: 'Network error — try again', ok: false });
    } finally {
      setRefreshLoading(false);
      setTimeout(() => setRefreshResult(null), 6000);
    }
  }

  async function deletePool() {
    const confirmed = window.confirm(
      'Are you sure? This will permanently delete the pool and all associated data.'
    );
    if (!confirmed) return;
    setDeleteLoading(true);
    const { error } = await supabase.from('pools').delete().eq('id', params.id);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      setDeleteLoading(false);
      return;
    }
    router.push('/');
  }

  function copyInviteLink() {
    if (!pool?.invite_code) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${pool.invite_code}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function savePrivacySettings() {
    setSavingPrivacy(true);
    setPrivacyMessage(null);
    const { error } = await supabase
      .from('pools')
      .update({
        is_private: isPrivateDraft,
        join_password: passwordDraft.trim() || null,
      })
      .eq('id', params.id);
    if (error) {
      setPrivacyMessage({ text: error.message, ok: false });
    } else {
      setPrivacyMessage({ text: 'Settings saved.', ok: true });
      await load();
    }
    setSavingPrivacy(false);
    setTimeout(() => setPrivacyMessage(null), 3000);
  }

  async function removeMember(userId: string) {
    setRemovingMember(userId);
    await supabase.from('pool_members').delete().eq('pool_id', params.id).eq('user_id', userId);
    await load();
    setRemovingMember(null);
  }

  async function advanceStatus() {
    if (!pool) return;
    const next = STATUS_TRANSITIONS[pool.status];
    if (!next) return;
    setStatusLoading(true);
    await supabase.from('pools').update({ status: next }).eq('id', pool.id);
    await load();
    setStatusLoading(false);
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;
  if (!authorized) return <div className="card text-center py-12 text-gray-400">Commissioner access required.</div>;

  const nextStatus = pool ? STATUS_TRANSITIONS[pool.status] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-masters-green">Admin</h2>
        <div className="flex items-center gap-3">
          <Link href={`/pool/${params.id}/admin/payouts`} className="btn-outline text-sm">
            Payout Rules →
          </Link>
          <button
            onClick={deletePool}
            disabled={deleteLoading}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {deleteLoading && <Spinner className="text-red-500 w-3.5 h-3.5" />}
            Delete Pool
          </button>
        </div>
      </div>

      {/* Pool status */}
      <div className="card">
        <h3 className="font-display text-lg text-masters-green mb-3">Pool Status</h3>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <p className="text-xs text-gray-400">Current Status</p>
            <p className="font-semibold capitalize">{pool?.status?.replace(/_/g, ' ')}</p>
          </div>
          {nextStatus && (
            <button
              onClick={advanceStatus}
              disabled={statusLoading}
              className="btn-primary flex items-center gap-2"
            >
              {statusLoading && <Spinner className="text-white w-4 h-4" />}
              {NEXT_STATUS_LABELS[pool?.status ?? '']}
            </button>
          )}
        </div>
        {pool?.status === 'tournament_active' && (
          <div className="mt-3 pt-3 border-t border-masters-cream-dark">
            <p className="text-xs text-gray-400 mb-2">Cron refreshes scores once daily (10 PM UTC). Force a refresh manually during tournament rounds:</p>
            <button
              onClick={handleRefreshScores}
              disabled={refreshLoading}
              className="btn-outline text-sm flex items-center gap-2"
            >
              {refreshLoading && <Spinner className="text-masters-green w-4 h-4" />}
              Refresh Scores Now
            </button>
            {refreshResult && (
              <p className={`text-xs mt-2 ${refreshResult.ok ? 'text-masters-green' : 'text-red-500'}`}>
                {refreshResult.text}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Pot Breakdown */}
      {potBreakdown && (
        <div className="card">
          <h3 className="font-display text-lg text-masters-green mb-3">Prize Pot</h3>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total Pot</p>
              <p className="text-2xl font-display font-semibold text-masters-green">
                ${(potBreakdown.soldTotal + potBreakdown.bidTotal).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Sold Golfers</p>
              <p className="text-xl font-mono font-semibold text-gray-700">
                ${potBreakdown.soldTotal.toLocaleString()}
                <span className="text-sm text-gray-400 font-normal ml-1">({potBreakdown.soldCount})</span>
              </p>
            </div>
            {(pool?.status === 'async_bidding' || pool?.status === 'live_auction') && potBreakdown.bidCount > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Active High Bids</p>
                <p className="text-xl font-mono font-semibold text-gray-700">
                  ${potBreakdown.bidTotal.toLocaleString()}
                  <span className="text-sm text-gray-400 font-normal ml-1">({potBreakdown.bidCount} golfers)</span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share & Privacy */}
      <div className="card space-y-4">
        <h3 className="font-display text-lg text-masters-green">Share &amp; Privacy</h3>

        {/* Invite link */}
        {pool?.invite_code && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Invite Link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-gray-700 truncate">
                {typeof window !== 'undefined' ? window.location.origin : ''}/join/{pool.invite_code}
              </code>
              <button onClick={copyInviteLink} className="btn-primary shrink-0 text-sm py-1.5 px-3">
                {linkCopied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Code: <span className="font-mono font-semibold">{pool.invite_code}</span>
            </p>
          </div>
        )}

        {/* Privacy toggle + password */}
        <div className="pt-3 border-t border-masters-cream-dark space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Private Pool</p>
              <p className="text-xs text-gray-400">Hidden from home page; invite-link access only</p>
            </div>
            <button
              type="button"
              onClick={() => setIsPrivateDraft((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                isPrivateDraft ? 'bg-masters-green' : 'bg-gray-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                isPrivateDraft ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Password <span className="text-gray-400">(optional — leave blank for invite-link-only)</span>
            </label>
            <input
              type="text"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              className="input text-sm"
              placeholder="No password"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={savePrivacySettings}
              disabled={savingPrivacy}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {savingPrivacy && <Spinner className="text-white w-3.5 h-3.5" />}
              Save
            </button>
            {privacyMessage && (
              <p className={`text-xs font-medium ${privacyMessage.ok ? 'text-masters-green' : 'text-red-500'}`}>
                {privacyMessage.text}
              </p>
            )}
          </div>
        </div>

        {/* Members list */}
        {members.length > 0 && (
          <div className="pt-3 border-t border-masters-cream-dark">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Members <span className="font-mono text-gray-400">({members.length})</span>
            </p>
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium text-gray-800">
                      {m.profiles?.display_name ?? '—'}
                    </span>
                    {m.user_id === pool?.commissioner_id && (
                      <span className="ml-1.5 text-[10px] font-semibold text-masters-green bg-masters-green/10 px-1.5 py-0.5 rounded">
                        Commissioner
                      </span>
                    )}
                    <p className="text-xs text-gray-400">{m.profiles?.email}</p>
                  </div>
                  {m.user_id !== pool?.commissioner_id && (
                    <button
                      onClick={() => removeMember(m.user_id)}
                      disabled={removingMember === m.user_id}
                      className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-40"
                    >
                      {removingMember === m.user_id ? '…' : 'Remove'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add single golfer */}
      <div className="card">
        <h3 className="font-display text-lg text-masters-green mb-3">Add Golfer</h3>
        <form onSubmit={addGolfer} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Scottie Scheffler" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} className="input" placeholder="USA" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">World Ranking</label>
            <input type="number" value={ranking} onChange={(e) => setRanking(e.target.value)} className="input" placeholder="1" min="1" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ESPN Player ID</label>
            <input type="number" value={sportsdataId} onChange={(e) => setSportsdataId(e.target.value)} className="input" placeholder="Auto-set on import" />
          </div>
          <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
            <input
              type="checkbox"
              id="is-amateur"
              checked={isAmateur}
              onChange={(e) => setIsAmateur(e.target.checked)}
              className="w-4 h-4 accent-masters-green"
            />
            <label htmlFor="is-amateur" className="text-xs font-medium text-gray-600 cursor-pointer">
              Amateur
            </label>
          </div>
          <div className="col-span-2 sm:col-span-1 flex items-end">
            <button type="submit" disabled={addLoading} className="btn-primary flex items-center gap-2 w-full justify-center">
              {addLoading && <Spinner className="text-white w-4 h-4" />}
              Add Golfer
            </button>
          </div>
          {addError && <p className="col-span-4 text-red-500 text-sm">{addError}</p>}
        </form>
      </div>

      {/* Bulk CSV */}
      <div className="card">
        <h3 className="font-display text-lg text-masters-green mb-1">Bulk Import (CSV)</h3>
        <p className="text-xs text-gray-500 mb-3">
          Paste CSV with columns: <code className="bg-gray-100 px-1 rounded">name, country, ranking, sportsdata_id, amateur</code> (amateur = true/yes/false)
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          className="input font-mono text-xs h-32 resize-y"
          placeholder={'name,country,ranking,sportsdata_id,amateur\nScottie Scheffler,USA,1,12345,false\nSam Bennett,USA,,, true'}
        />
        {csvResult && (
          <p className="text-sm text-masters-green mt-2">{csvResult}</p>
        )}
        <button
          onClick={handleCsvImport}
          disabled={csvLoading || !csvText.trim()}
          className="btn-outline mt-3 flex items-center gap-2"
        >
          {csvLoading && <Spinner className="text-masters-green w-4 h-4" />}
          Import CSV
        </button>
      </div>

      {/* ESPN field import */}
      <div className="card bg-masters-green/5 border-masters-green/20">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-display text-lg text-masters-green">Import Masters Field from ESPN</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-lg">
              Pulls the full Masters field directly from ESPN&apos;s free public API — no API key needed.
              Sets ESPN player IDs for accurate score matching during the tournament.
              Safe to run multiple times; existing golfers are updated, not duplicated.
            </p>
          </div>
          <button
            onClick={handleEspnImport}
            disabled={espnLoading}
            className="btn-primary flex items-center gap-2 shrink-0"
          >
            {espnLoading && <Spinner className="text-white w-4 h-4" />}
            Import from ESPN
          </button>
        </div>
        {espnResult && (
          <p className={`text-sm mt-3 font-medium ${espnResult.ok ? 'text-masters-green' : 'text-red-500'}`}>
            {espnResult.text}
          </p>
        )}
      </div>

      {/* Bid Leaders — shown during async_bidding */}
      {pool?.status === 'async_bidding' && bidLeaders.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-masters-cream-dark">
            <h3 className="font-display text-lg text-masters-green">
              Bid Leaders <span className="font-mono text-sm text-gray-400">({bidLeaders.length})</span>
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-masters-green/10 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Golfer</th>
                <th className="px-4 py-2 font-medium text-gray-600 text-right">High Bid</th>
                <th className="px-4 py-2 font-medium text-gray-600">High Bidder</th>
              </tr>
            </thead>
            <tbody>
              {bidLeaders.map((row) => (
                <tr key={row.golfer_id} className="border-b border-masters-cream-dark last:border-0">
                  <td className="px-4 py-2 font-medium">{row.golfer_name}</td>
                  <td className="px-4 py-2 font-mono text-masters-green text-right">${row.high_bid}</td>
                  <td className="px-4 py-2 text-gray-600">{row.high_bidder_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Auction Summary */}
      {auctionSummary.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-masters-cream-dark">
            <h3 className="font-display text-lg text-masters-green">Auction Summary</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-masters-green/10 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Participant</th>
                <th className="px-4 py-2 font-medium text-gray-600 text-right">Golfers</th>
                <th className="px-4 py-2 font-medium text-gray-600 text-right">Total Spent</th>
              </tr>
            </thead>
            <tbody>
              {auctionSummary.map((row) => (
                <tr key={row.user_id} className="border-b border-masters-cream-dark last:border-0">
                  <td className="px-4 py-2 font-medium">{row.display_name}</td>
                  <td className="px-4 py-2 text-gray-600 text-right font-mono">{row.golfer_count}</td>
                  <td className="px-4 py-2 text-masters-green font-mono text-right">${row.total_spent.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="bg-masters-green/5 font-semibold">
                <td className="px-4 py-2 text-gray-700">Total</td>
                <td className="px-4 py-2 text-right font-mono text-gray-700">
                  {auctionSummary.reduce((s, r) => s + r.golfer_count, 0)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-masters-green">
                  ${auctionSummary.reduce((s, r) => s + r.total_spent, 0).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Current field */}
      <div className="card overflow-x-auto p-0">
        <div className="px-4 py-3 border-b border-masters-cream-dark">
          <h3 className="font-display text-lg text-masters-green">
            Current Field <span className="font-mono text-sm text-gray-400">({golfers.length})</span>
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-masters-green/10 text-left">
              <th className="px-4 py-2 font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 font-medium text-gray-600">Country</th>
              <th className="px-4 py-2 font-medium text-gray-600">Rank</th>
              <th className="px-4 py-2 font-medium text-gray-600">ESPN ID</th>
              <th className="px-4 py-2 font-medium text-gray-600">Status</th>
              <th className="px-4 py-2 font-medium text-gray-600">Amateur</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {golfers.map((g) => (
              <tr key={g.id} className="border-b border-masters-cream-dark last:border-0 hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{g.name}</td>
                <td className="px-4 py-2 text-gray-500">{g.country ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-gray-500">{g.world_ranking ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-gray-400 text-xs">{g.sportsdata_player_id ?? '—'}</td>
                <td className="px-4 py-2 capitalize text-xs text-gray-500">{g.status}</td>
                <td className="px-4 py-2 text-center">
                  {g.is_amateur && <span className="badge-gray text-purple-600">Am</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => removeGolfer(g.id)}
                    className="text-red-400 hover:text-red-600 text-xs hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {golfers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No golfers yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
