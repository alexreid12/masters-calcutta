/**
 * masters.com JSON scoring feed — primary data source during The Masters.
 *
 * Two URLs are tried in order:
 *   1. /scores/feeds/2026/scores.json  (full player + round data)
 *   2. /scores/feeds/2026/track/leaderboard.json  (leaderboard subset)
 *
 * Both require browser-like headers or the CDN returns 403/HTML.
 */

import { parseScoreToPar, normalizeName, AUGUSTA_PAR } from '@/lib/espn';

const FEED_URLS = [
  'https://www.masters.com/en_US/scores/feeds/2026/scores.json',
  'https://www.masters.com/en_US/scores/feeds/2026/track/leaderboard.json',
] as const;

const BROWSER_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.masters.com/',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Masters.com response types ────────────────────────────────────────────────

interface MastersRound {
  fantasy: number | null;   // score to par for this round (integer, e.g. -5)
  total: number | null;     // stroke total — null while round is in progress
  roundStatus: string;      // 'Finished' | 'Playing' | 'Pre'
  teetime: string;
  scores: (number | null)[]; // per-hole stroke counts
}

interface MastersPlayer {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  countryCode: string;
  pos: string;              // "1", "T2", "CUT", "WD", "DQ"
  amateur: boolean;
  active: boolean;
  status: string;           // "A" playing, "F" finished round, "C" cut, "W" withdrawn
  topar: string;            // "-8", "+4", "E"
  today: string;            // current-round score string
  thru: string | number;    // "14", "F", "18"
  round1: MastersRound;
  round2: MastersRound;
  round3: MastersRound;
  round4: MastersRound;
}

interface MastersFeed {
  fileEpoch?: string;
  data: {
    currentRound?: string;
    wallClockTime?: string;
    statusRound?: string;
    cutLine?: string;
    player: MastersPlayer[];
  };
}

// ── Parsed output type (shared with score-updater) ────────────────────────────

export interface MastersScoreEntry {
  normalizedName: string;
  fullName: string;
  totalToPar: number | null;
  position: number | null;
  positionDisplay: string | null;
  golferStatus: 'active' | 'missed_cut' | 'withdrawn';
  thru: number;             // 0–18, 18 = finished
  isAmateur: boolean;
  rounds: Array<{
    round: number;
    scoreToPar: number;
    strokes: number;
    thru: number;           // 18 for finished rounds, current hole# for in-progress
  }>;
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function parseThru(thru: string | number | undefined): number {
  if (thru === undefined || thru === null || thru === '') return 0;
  const s = String(thru).trim().toUpperCase();
  if (s === 'F') return 18;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseMastersStatus(
  pos: string,
  status: string
): 'active' | 'missed_cut' | 'withdrawn' {
  const p = (pos ?? '').toUpperCase().trim();
  const s = (status ?? '').toUpperCase().trim();
  if (p === 'WD' || p === 'W' || s === 'W') return 'withdrawn';
  if (p === 'DQ' || p === 'D') return 'withdrawn';
  if (p === 'CUT' || p === 'MC' || p === 'C' || s === 'C') return 'missed_cut';
  return 'active';
}

function parseMastersPosition(pos: string): number | null {
  if (!pos) return null;
  const s = pos.replace(/^T/i, '');
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseMastersPlayer(player: MastersPlayer): MastersScoreEntry {
  const thru = parseThru(player.thru);
  const golferStatus = parseMastersStatus(player.pos, player.status);
  const totalToPar = parseScoreToPar(player.topar);

  const rounds: MastersScoreEntry['rounds'] = [];
  for (let r = 1; r <= 4; r++) {
    const roundData = (player as unknown as Record<string, unknown>)[`round${r}`] as MastersRound | undefined;
    if (!roundData || roundData.roundStatus === 'Pre') continue;

    const scoreToPar = roundData.fantasy;
    if (scoreToPar === null || scoreToPar === undefined) continue;

    const isFinished = roundData.roundStatus === 'Finished';
    // total is stroke count for completed rounds; derive from par + stp for in-progress
    const strokes = roundData.total !== null && roundData.total !== undefined
      ? Number(roundData.total)
      : AUGUSTA_PAR + Number(scoreToPar);

    rounds.push({
      round: r,
      scoreToPar: Number(scoreToPar),
      strokes,
      thru: isFinished ? 18 : thru,
    });
  }

  const posDisplay = player.pos || null;

  return {
    normalizedName: normalizeName(player.full_name),
    fullName: player.full_name,
    totalToPar,
    position: parseMastersPosition(player.pos),
    positionDisplay: posDisplay,
    golferStatus,
    thru,
    isAmateur: player.amateur ?? false,
    rounds,
  };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchMastersData(): Promise<{
  entries: MastersScoreEntry[];
  sourceUrl: string;
} | null> {
  for (const url of FEED_URLS) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        next: { revalidate: 0 },
      });

      if (!res.ok) {
        console.warn(`[masters] HTTP ${res.status} from ${url}`);
        continue;
      }

      const text = await res.text();

      // CDN sometimes returns an HTML error page — detect and skip
      if (text.trimStart().startsWith('<')) {
        console.warn(`[masters] ${url} returned HTML (not JSON), skipping`);
        continue;
      }

      let parsed: MastersFeed;
      try {
        parsed = JSON.parse(text) as MastersFeed;
      } catch {
        console.warn(`[masters] Invalid JSON from ${url}: ${text.slice(0, 500)}`);
        continue;
      }

      const players = parsed?.data?.player;
      if (!Array.isArray(players) || players.length === 0) {
        console.warn(`[masters] No players array found in ${url}`);
        continue;
      }

      console.log(`[masters] Fetched ${players.length} players from ${url}`);
      return { entries: players.map(parseMastersPlayer), sourceUrl: url };
    } catch (err) {
      console.warn(`[masters] Error fetching ${url}:`, err);
    }
  }

  return null;
}
