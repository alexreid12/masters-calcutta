/**
 * One-shot score push script.
 * Run: npx tsx scripts/push-scores.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local manually
const envFile = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ESPN_MASTERS_EVENT_ID = process.env.ESPN_MASTERS_EVENT_ID;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── masters.com fetch ──────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.masters.com/',
};

const AUGUSTA_PAR = 72;

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s'-]/g, '').replace(/\s+/g, ' ').trim();
}

function parseScoreToPar(s?: string | null): number | null {
  if (!s) return null;
  const t = s.trim();
  if (t === 'E') return 0;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

function parsePos(pos: string): number | null {
  const s = pos.replace(/^T/i, '').toUpperCase();
  if (['CUT','MC','WD','DQ'].includes(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function golferStatus(pos: string, status: string): 'active' | 'missed_cut' | 'withdrawn' {
  const p = pos.toUpperCase();
  if (p === 'WD' || p === 'DQ') return 'withdrawn';
  if (p === 'CUT' || p === 'MC') return 'missed_cut';
  return 'active';
}

function parseThru(thru: string | number | undefined): number {
  if (!thru && thru !== 0) return 0;
  const s = String(thru).trim().toUpperCase();
  if (s === 'F') return 18;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function fetchMasters() {
  const res = await fetch('https://www.masters.com/en_US/scores/feeds/2026/scores.json', {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) throw new Error(`masters.com HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error('masters.com returned HTML');
  const data = JSON.parse(text);
  return data.data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // 1. Find tournament_active pools
  const { data: pools, error: poolErr } = await supabase
    .from('pools').select('id, name').eq('status', 'tournament_active');
  if (poolErr) throw poolErr;
  if (!pools?.length) {
    console.log('No tournament_active pools found. Check pool status in admin.');
    process.exit(0);
  }
  console.log(`Found ${pools.length} active pool(s): ${pools.map(p => p.name).join(', ')}`);

  // 2. Fetch masters.com data
  console.log('\nFetching masters.com scores...');
  let mastersData: any;
  try {
    mastersData = await fetchMasters();
    console.log(`  ✓ Got ${mastersData.player.length} players — Round status: ${mastersData.statusRound} @ ${mastersData.wallClockTime}`);
  } catch (err) {
    console.error('  ✗ masters.com failed:', err);
    process.exit(1);
  }

  const players: any[] = mastersData.player;

  // 3. For each pool, match and upsert scores
  for (const pool of pools) {
    console.log(`\n── Pool: ${pool.name} (${pool.id})`);

    const { data: dbGolfers } = await supabase
      .from('golfers').select('id, name, status, is_amateur').eq('pool_id', pool.id);

    if (!dbGolfers?.length) { console.log('  No golfers found'); continue; }

    const byName = new Map(dbGolfers.map(g => [normalizeName(g.name), g]));
    const byLastName = new Map<string, string>();
    for (const g of dbGolfers) {
      const parts = g.name.trim().split(/\s+/);
      const last = normalizeName(parts[parts.length - 1]);
      byLastName.set(last, byLastName.has(last) ? '__dup__' : g.id);
    }

    let updated = 0, skipped = 0, errors = 0;

    for (const player of players) {
      const fullName: string = player.full_name ?? '';
      let dbGolfer = byName.get(normalizeName(fullName)) ?? null;

      // Last-name fallback
      if (!dbGolfer) {
        const nameParts = normalizeName(fullName).split(' ');
        const lastPart = nameParts[nameParts.length - 1];
        const candidate = byLastName.get(lastPart);
        if (candidate && candidate !== '__dup__') {
          dbGolfer = dbGolfers.find(g => g.id === candidate) ?? null;
        }
      }

      if (!dbGolfer) { skipped++; continue; }

      const status = golferStatus(player.pos ?? '', player.status ?? '');
      const totalToPar = parseScoreToPar(player.topar);
      const posDisplay = player.pos || null;
      const position = posDisplay ? parsePos(posDisplay) : null;
      const thru = parseThru(player.thru);

      // Update golfer status
      await supabase.from('golfers').update({ status, is_amateur: player.amateur ?? dbGolfer.is_amateur }).eq('id', dbGolfer.id);

      // Build rounds
      const rounds: Array<{ round: number; scoreToPar: number; strokes: number; isFinished: boolean }> = [];
      for (let r = 1; r <= 4; r++) {
        const rd = player[`round${r}`];
        if (!rd || rd.roundStatus === 'Pre') continue;
        const stp = rd.fantasy;
        if (stp === null || stp === undefined) continue;
        const isFinished = rd.roundStatus === 'Finished';
        const strokes = rd.total !== null && rd.total !== undefined ? Number(rd.total) : AUGUSTA_PAR + Number(stp);
        rounds.push({ round: r, scoreToPar: Number(stp), strokes, isFinished });
      }

      if (rounds.length === 0) { skipped++; continue; }

      const lastRound = rounds[rounds.length - 1].round;

      for (const rs of rounds) {
        const isLast = rs.round === lastRound;
        const { error } = await supabase.from('scores').upsert({
          pool_id: pool.id,
          golfer_id: dbGolfer.id,
          round: rs.round,
          score_to_par: rs.scoreToPar,
          total_to_par: totalToPar,
          thru: rs.isFinished ? 18 : (isLast ? thru : 18),
          position: isLast ? position : null,
          position_display: isLast ? posDisplay : null,
          is_active: status === 'active',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'pool_id,golfer_id,round' });

        if (error) { console.error(`  ERR ${fullName} R${rs.round}: ${error.message}`); errors++; }
        else updated++;
      }
    }

    // Update pool metadata
    await supabase.from('pools').update({
      score_source: 'masters.com',
      score_updated_at: new Date().toISOString(),
    }).eq('id', pool.id);

    console.log(`  ✓ Updated ${updated} score rows, skipped ${skipped} golfers, ${errors} errors`);
  }

  console.log('\n✓ Done.');
}

const LOOP_MINUTES = parseInt(process.argv[2] ?? '0', 10);

async function main() {
  if (LOOP_MINUTES > 0) {
    console.log(`Running every ${LOOP_MINUTES} minute(s). Ctrl+C to stop.\n`);
    while (true) {
      const ts = new Date().toLocaleTimeString();
      console.log(`[${ts}] Running score push...`);
      try { await run(); } catch (err) { console.error(`[${ts}] Error:`, err); }
      console.log(`[${ts}] Sleeping ${LOOP_MINUTES}m...\n`);
      await new Promise(r => setTimeout(r, LOOP_MINUTES * 60 * 1000));
    }
  } else {
    await run();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
