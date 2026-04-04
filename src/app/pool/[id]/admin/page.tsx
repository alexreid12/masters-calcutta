'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import type { Pool, Golfer, PoolStatus } from '@/types/database';
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

  async function load() {
    const [poolRes, golfersRes] = await Promise.all([
      supabase.from('pools').select('*').eq('id', params.id).single(),
      supabase.from('golfers').select('*').eq('pool_id', params.id).order('world_ranking', { nullsFirst: false }),
    ]);
    if (poolRes.data) {
      setPool(poolRes.data);
      if (user && poolRes.data.commissioner_id === user.id) {
        setAuthorized(true);
      }
    }
    setGolfers(golfersRes.data ?? []);
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
            <p className="text-xs text-gray-400 mb-2">Cron polls ESPN every 2 min via Vercel. Force a refresh manually:</p>
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
