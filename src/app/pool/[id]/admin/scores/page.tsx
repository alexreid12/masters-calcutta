'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import Link from 'next/link';
import type { Golfer, Score } from '@/types/database';

// ── Name normalization (mirrors /lib/espn.ts) ─────────────────────────────────
function normName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Score parsing helpers ─────────────────────────────────────────────────────
function parseScoreStr(s: string): number | null {
  if (!s) return null;
  // Normalize unicode minus (−) to ASCII (-)
  const t = s.trim().replace(/[−–]/g, '-').toUpperCase();
  if (t === 'E') return 0;
  if (['CUT', 'MC', 'WD', 'DQ', '--', '-'].includes(t)) return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function fmtScore(n: number | null): string {
  if (n === null) return '';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

function fmtThru(n: number): string {
  return n === 18 ? 'F' : n === 0 ? '' : String(n);
}

function posToStatus(pos: string): 'active' | 'missed_cut' | 'withdrawn' {
  const p = pos.trim().toUpperCase();
  if (p === 'CUT' || p === 'MC') return 'missed_cut';
  if (p === 'WD' || p === 'DQ') return 'withdrawn';
  return 'active';
}

// ── Paste parser ──────────────────────────────────────────────────────────────
interface ParsedLine {
  displayName: string;
  normalizedName: string;
  pos: string;
  total: string;
  r1: string;
  r2: string;
  r3: string;
  r4: string;
  thru: string;
  status: 'active' | 'missed_cut' | 'withdrawn';
}

const SCORE_RE = /^([+\-−]\d+|E|CUT|MC|WD)$/i;
const THRU_RE = /^(\d{1,2}|F)$/i;
const POS_RE = /^(T?\d+|CUT|MC|WD|DQ)$/i;

function parseLeaderboardText(text: string): ParsedLine[] {
  const results: ParsedLine[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // Split by tab or 2+ consecutive spaces
    const parts = line.split(/\t|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    // First token must look like a position
    if (!POS_RE.test(parts[0])) continue;
    const posRaw = parts[0];

    // Find where scores begin: first token that looks like a score
    let nameEnd = 1;
    for (let i = 1; i < parts.length; i++) {
      if (SCORE_RE.test(parts[i])) {
        nameEnd = i;
        break;
      }
      nameEnd = i + 1;
    }

    const displayName = parts.slice(1, nameEnd).join(' ');
    if (!displayName || displayName.length < 2) continue;

    const remaining = parts.slice(nameEnd);

    // Last token: thru if it looks like F or 1–18
    let thruStr = '';
    let scoreTokens = [...remaining];
    if (scoreTokens.length > 0) {
      const last = scoreTokens[scoreTokens.length - 1];
      if (THRU_RE.test(last)) {
        thruStr = last.toUpperCase() === 'F' ? '18' : last;
        scoreTokens = scoreTokens.slice(0, -1);
      }
    }

    // Remaining tokens: [total] [r1] [r2] [r3?] [r4?]
    const [totalTok, r1Tok, r2Tok, r3Tok, r4Tok] = scoreTokens;

    const totalVal = parseScoreStr(totalTok ?? '');
    const r1Val = parseScoreStr(r1Tok ?? '');
    const r2Val = parseScoreStr(r2Tok ?? '');
    const r3Val = parseScoreStr(r3Tok ?? '');
    const r4Val = parseScoreStr(r4Tok ?? '');

    // Auto-calc total if not provided but rounds are
    const computedTotal =
      totalVal !== null
        ? totalVal
        : [r1Val, r2Val, r3Val, r4Val].filter((v): v is number => v !== null).reduce<number | null>((s, v) => (s ?? 0) + v, null);

    results.push({
      displayName,
      normalizedName: normName(displayName),
      pos: posRaw,
      total: computedTotal !== null ? String(computedTotal) : '',
      r1: r1Val !== null ? String(r1Val) : '',
      r2: r2Val !== null ? String(r2Val) : '',
      r3: r3Val !== null ? String(r3Val) : '',
      r4: r4Val !== null ? String(r4Val) : '',
      thru: thruStr,
      status: posToStatus(posRaw),
    });
  }

  return results;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ScoreEdit = {
  pos: string;
  total: string;
  r1: string;
  r2: string;
  r3: string;
  r4: string;
  thru: string;
  status: 'active' | 'missed_cut' | 'withdrawn';
  dirty: boolean;
};

export default function ManualScoresPage({ params }: { params: { id: string } }) {
  const supabase = useRef(createClient()).current;
  const { user } = useAuth();
  const router = useRouter();

  const [golfers, setGolfers] = useState<Golfer[]>([]);
  const [edits, setEdits] = useState<Record<string, ScoreEdit>>({});
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ text: string; ok: boolean } | null>(null);

  const [pasteText, setPasteText] = useState('');
  const [parseResult, setParseResult] = useState<{ matched: number; unmatched: string[] } | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    const [poolRes, golfersRes, scoresRes] = await Promise.all([
      supabase.from('pools').select('commissioner_id').eq('id', params.id).single(),
      supabase.from('golfers').select('*').eq('pool_id', params.id).order('world_ranking', { nullsFirst: false }),
      supabase.from('scores').select('*').eq('pool_id', params.id),
    ]);

    if (user && poolRes.data?.commissioner_id === user.id) {
      setAuthorized(true);
    } else if (poolRes.data) {
      router.replace(`/pool/${params.id}`);
      return;
    }

    const allGolfers = (golfersRes.data ?? []) as Golfer[];
    const allScores = (scoresRes.data ?? []) as Score[];

    // Build a per-golfer score map: golfer_id → { r1, r2, r3, r4, total, pos, thru }
    const scoreMap = new Map<string, {
      total: number | null;
      pos: string;
      thru: number;
      rounds: Record<number, number>;
    }>();

    for (const s of allScores) {
      if (!scoreMap.has(s.golfer_id)) {
        scoreMap.set(s.golfer_id, { total: null, pos: '', thru: 0, rounds: {} });
      }
      const entry = scoreMap.get(s.golfer_id)!;
      entry.rounds[s.round] = s.score_to_par ?? 0;
      // Keep the row that has a position (last known round)
      if (s.position_display) {
        entry.pos = s.position_display;
        entry.thru = s.thru ?? 0;
        entry.total = s.total_to_par;
      }
    }

    setGolfers(allGolfers);
    setEdits((prev) => {
      const next: Record<string, ScoreEdit> = {};
      for (const g of allGolfers) {
        if (prev[g.id]?.dirty) {
          next[g.id] = prev[g.id];
          continue;
        }
        const existing = scoreMap.get(g.id);
        next[g.id] = {
          pos: existing?.pos ?? '',
          total: existing?.total !== null && existing?.total !== undefined ? String(existing.total) : '',
          r1: existing?.rounds[1] !== undefined ? String(existing.rounds[1]) : '',
          r2: existing?.rounds[2] !== undefined ? String(existing.rounds[2]) : '',
          r3: existing?.rounds[3] !== undefined ? String(existing.rounds[3]) : '',
          r4: existing?.rounds[4] !== undefined ? String(existing.rounds[4]) : '',
          thru: existing?.thru !== undefined ? String(existing.thru) : '',
          status: g.status === 'missed_cut' ? 'missed_cut' : g.status === 'withdrawn' ? 'withdrawn' : 'active',
          dirty: false,
        };
      }
      return next;
    });

    setLoading(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  // ── Field updater ─────────────────────────────────────────────────────────
  function setField(golferId: string, field: keyof Omit<ScoreEdit, 'dirty'>, value: string) {
    setEdits((prev) => ({
      ...prev,
      [golferId]: { ...prev[golferId], [field]: value, dirty: true },
    }));
  }

  // ── Paste parse ───────────────────────────────────────────────────────────
  function handleParse() {
    const parsed = parseLeaderboardText(pasteText);
    if (parsed.length === 0) {
      setParseResult({ matched: 0, unmatched: ['No parseable lines found — check format'] });
      return;
    }

    // Build name lookup maps
    const byNorm = new Map(golfers.map((g) => [normName(g.name), g.id]));

    // Also build last-name-only map for fallback (single word names from copied leaderboards)
    const byLastName = new Map<string, string>();
    for (const g of golfers) {
      const parts = g.name.trim().split(/\s+/);
      const last = normName(parts[parts.length - 1]);
      // Only add if unique
      if (!byLastName.has(last)) {
        byLastName.set(last, g.id);
      } else {
        byLastName.set(last, '__ambiguous__');
      }
    }

    const matched: string[] = [];
    const unmatched: string[] = [];

    setEdits((prev) => {
      const next = { ...prev };

      for (const entry of parsed) {
        // Try exact normalized name first
        let golferId = byNorm.get(entry.normalizedName) ?? null;

        // Try "Last, First" → "First Last" reorder
        if (!golferId && entry.displayName.includes(',')) {
          const [last, first] = entry.displayName.split(',').map((s) => s.trim());
          golferId = byNorm.get(normName(`${first} ${last}`)) ?? null;
        }

        // Last-name-only fallback (for "McIlroy" matching "Rory McIlroy")
        if (!golferId) {
          const nameParts = entry.normalizedName.split(' ');
          const lastPart = nameParts[nameParts.length - 1];
          const candidate = byLastName.get(lastPart);
          if (candidate && candidate !== '__ambiguous__') {
            golferId = candidate;
          }
        }

        if (!golferId) {
          unmatched.push(entry.displayName);
          continue;
        }

        matched.push(entry.displayName);
        next[golferId] = {
          pos: entry.pos,
          total: entry.total,
          r1: entry.r1,
          r2: entry.r2,
          r3: entry.r3,
          r4: entry.r4,
          thru: entry.thru,
          status: entry.status,
          dirty: true,
        };
      }

      return next;
    });

    setParseResult({ matched: matched.length, unmatched });
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function save(golferIds: string[]) {
    const dirtyIds = golferIds.filter((id) => edits[id]?.dirty);
    if (dirtyIds.length === 0) return;

    setSaving(true);
    setSaveResult(null);

    const entries = dirtyIds.map((golferId) => {
      const e = edits[golferId];
      const r1 = parseScoreStr(e.r1);
      const r2 = parseScoreStr(e.r2);
      const r3 = parseScoreStr(e.r3);
      const r4 = parseScoreStr(e.r4);
      const total = parseScoreStr(e.total) ??
        [r1, r2, r3, r4].filter((v): v is number => v !== null).reduce<number | null>((s, v) => (s ?? 0) + v, null);
      const thru = parseInt(e.thru) || 0;

      return {
        golfer_id: golferId,
        position_display: e.pos,
        total_to_par: total,
        r1,
        r2,
        r3,
        r4,
        thru,
        golfer_status: e.status,
      };
    });

    const res = await fetch(`/api/pools/${params.id}/scores`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    const data = await res.json();

    if (!res.ok && res.status !== 207) {
      setSaveResult({ text: data.error ?? 'Save failed', ok: false });
    } else {
      setSaveResult({
        text: `Saved ${data.updated} score row${data.updated !== 1 ? 's' : ''}${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`,
        ok: !data.errors?.length,
      });
      // Clear dirty flags for saved rows
      setEdits((prev) => {
        const next = { ...prev };
        for (const id of dirtyIds) next[id] = { ...next[id], dirty: false };
        return next;
      });
      setTimeout(() => setSaveResult(null), 5000);
    }
    setSaving(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex justify-center py-20"><Spinner className="text-masters-green w-8 h-8" /></div>;
  if (!authorized) return <div className="card text-center py-12 text-gray-400">Commissioner access required.</div>;

  const dirtyCount = Object.values(edits).filter((e) => e.dirty).length;
  const allGolferIds = golfers.map((g) => g.id);

  // Sort: players with a numeric position first, then CUT/WD, then no position
  const sorted = [...golfers].sort((a, b) => {
    const ea = edits[a.id];
    const eb = edits[b.id];
    const pa = parseInt(ea?.pos?.replace(/^T/i, '') || '9999', 10);
    const pb = parseInt(eb?.pos?.replace(/^T/i, '') || '9999', 10);
    if (isNaN(pa) && isNaN(pb)) return (a.world_ranking ?? 999) - (b.world_ranking ?? 999);
    if (isNaN(pa)) return 1;
    if (isNaN(pb)) return -1;
    return pa - pb;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl text-masters-green">Manual Score Entry</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Stopgap for entering scores manually while automated feeds are being fixed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/pool/${params.id}/admin`} className="btn-outline text-sm">
            ← Admin
          </Link>
          <button
            onClick={() => save(allGolferIds)}
            disabled={saving || dirtyCount === 0}
            className="btn-primary flex items-center gap-2"
          >
            {saving && <Spinner className="text-white w-4 h-4" />}
            Save All {dirtyCount > 0 ? `(${dirtyCount})` : ''}
          </button>
        </div>
      </div>

      {saveResult && (
        <div className={`text-sm px-4 py-2 rounded-lg ${saveResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {saveResult.text}
        </div>
      )}

      {/* Paste parser */}
      <div className="card">
        <h3 className="font-display text-lg text-masters-green mb-1">Paste Leaderboard</h3>
        <p className="text-xs text-gray-400 mb-3">
          Copy the leaderboard table from masters.com or another source and paste it below.
          Works best with tab-separated data (copy from a table).
          Expected format per line: <code className="bg-gray-100 px-1 rounded">Pos  Name  Total  R1  R2  Thru</code>
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={`1\tRory McIlroy\t-8\t-5\t-3\t14\nT2\tSam Burns\t-6\t-5\t-1\tF\nCUT\tTiger Woods\t+3\t+2\t+1`}
          className="w-full h-40 input text-xs font-mono resize-y"
        />
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <button
            onClick={handleParse}
            disabled={!pasteText.trim()}
            className="btn-primary text-sm"
          >
            Parse &amp; Fill Table
          </button>
          <button
            onClick={() => { setPasteText(''); setParseResult(null); }}
            className="btn-outline text-sm"
          >
            Clear
          </button>
          {parseResult && (
            <span className={`text-sm ${parseResult.unmatched.length === 0 ? 'text-masters-green' : 'text-amber-600'}`}>
              Matched {parseResult.matched} player{parseResult.matched !== 1 ? 's' : ''}.
              {parseResult.unmatched.length > 0 && (
                <> Not found: <span className="font-mono">{parseResult.unmatched.join(', ')}</span></>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Score table */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-masters-green text-masters-cream text-left">
              <th className="px-3 py-2 font-semibold min-w-[160px]">Golfer</th>
              <th className="px-2 py-2 font-semibold w-16">Pos</th>
              <th className="px-2 py-2 font-semibold w-16">Total</th>
              <th className="px-2 py-2 font-semibold w-14">R1</th>
              <th className="px-2 py-2 font-semibold w-14">R2</th>
              <th className="px-2 py-2 font-semibold w-14">R3</th>
              <th className="px-2 py-2 font-semibold w-14">R4</th>
              <th className="px-2 py-2 font-semibold w-14">Thru</th>
              <th className="px-2 py-2 font-semibold w-28">Status</th>
              <th className="px-2 py-2 font-semibold w-16">Save</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((golfer) => {
              const e = edits[golfer.id];
              if (!e) return null;
              return (
                <tr
                  key={golfer.id}
                  className={`border-b border-gray-100 last:border-0 ${e.dirty ? 'bg-yellow-50' : ''}`}
                >
                  {/* Name */}
                  <td className="px-3 py-1.5 font-medium">
                    {golfer.name}
                    {golfer.is_amateur && (
                      <span className="ml-1 text-[10px] bg-masters-gold/20 text-masters-gold px-1 rounded">AM</span>
                    )}
                  </td>

                  {/* Position */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.pos}
                      onChange={(ev) => setField(golfer.id, 'pos', ev.target.value)}
                      placeholder="T2"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* Total */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.total}
                      onChange={(ev) => setField(golfer.id, 'total', ev.target.value)}
                      placeholder="E"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* R1 */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.r1}
                      onChange={(ev) => setField(golfer.id, 'r1', ev.target.value)}
                      placeholder="-"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* R2 */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.r2}
                      onChange={(ev) => setField(golfer.id, 'r2', ev.target.value)}
                      placeholder="-"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* R3 */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.r3}
                      onChange={(ev) => setField(golfer.id, 'r3', ev.target.value)}
                      placeholder="-"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* R4 */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.r4}
                      onChange={(ev) => setField(golfer.id, 'r4', ev.target.value)}
                      placeholder="-"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* Thru */}
                  <td className="px-2 py-1.5">
                    <input
                      value={e.thru}
                      onChange={(ev) => setField(golfer.id, 'thru', ev.target.value)}
                      placeholder="F"
                      className="w-full border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:border-masters-green"
                    />
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1.5">
                    <select
                      value={e.status}
                      onChange={(ev) => setField(golfer.id, 'status', ev.target.value as ScoreEdit['status'])}
                      className="w-full border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none focus:border-masters-green bg-white"
                    >
                      <option value="active">Active</option>
                      <option value="missed_cut">Missed Cut</option>
                      <option value="withdrawn">Withdrawn</option>
                    </select>
                  </td>

                  {/* Save row */}
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => save([golfer.id])}
                      disabled={saving || !e.dirty}
                      className={`w-full text-xs py-0.5 rounded border transition-colors ${
                        e.dirty
                          ? 'border-masters-green text-masters-green hover:bg-masters-green hover:text-white'
                          : 'border-gray-200 text-gray-300 cursor-not-allowed'
                      }`}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Format reference */}
      <div className="card bg-gray-50 text-xs text-gray-500">
        <p className="font-semibold text-gray-600 mb-1">Paste format reference</p>
        <p>Score fields accept: <code className="bg-white px-1 rounded">-8</code>, <code className="bg-white px-1 rounded">+2</code>, <code className="bg-white px-1 rounded">E</code>, or blank for no data.</p>
        <p className="mt-1">Thru field: <code className="bg-white px-1 rounded">14</code> for 14 holes, <code className="bg-white px-1 rounded">18</code> or <code className="bg-white px-1 rounded">F</code> for finished.</p>
        <p className="mt-1">Position: <code className="bg-white px-1 rounded">1</code>, <code className="bg-white px-1 rounded">T2</code>, <code className="bg-white px-1 rounded">CUT</code>, or <code className="bg-white px-1 rounded">WD</code>. CUT/WD auto-set status.</p>
        <p className="mt-1">If total is blank, it&apos;s calculated from the sum of round scores.</p>
      </div>
    </div>
  );
}
