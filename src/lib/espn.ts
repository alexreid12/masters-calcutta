// ============================================================
// ESPN Golf API — free, no auth required
// ============================================================

const SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

export const AUGUSTA_PAR = 72;

// ── ESPN response types ───────────────────────────────────────────────────────

export interface EspnScoreboardResponse {
  events: EspnEvent[];
}

export interface EspnEvent {
  id: string;
  name: string;
  shortName?: string;
  competitions: EspnCompetition[];
}

export interface EspnCompetition {
  competitors: EspnCompetitor[];
}

export interface EspnCompetitor {
  id: string;
  athlete: {
    id: string;
    displayName: string;
    flag?: { alt?: string };
    headshot?: { href: string };
    amateur?: boolean;
  };
  status: {
    position?: { id?: string; displayName?: string; isTied?: boolean };
    thru?: number;
    period?: number;
    type?: { name?: string; description?: string };
  };
  score?: { displayValue?: string };
  linescores?: Array<{ displayValue?: string }>;
}

// ── Fetching ──────────────────────────────────────────────────────────────────

export async function fetchScoreboard(eventId?: string): Promise<EspnScoreboardResponse> {
  const url = eventId
    ? `${SCOREBOARD_URL}?event=${eventId}`
    : SCOREBOARD_URL;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`ESPN scoreboard ${res.status} for URL: ${url}`);
  const data = await res.json();

  // If a specific event ID was requested but returned no competitors, fall back to
  // the general scoreboard so findMastersEvent can search by name.
  if (eventId && (!data.events || data.events.length === 0)) {
    const fallback = await fetch(SCOREBOARD_URL, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });
    if (fallback.ok) return fallback.json();
  }

  return data;
}

/** Find the Masters event in a scoreboard response. */
export function findMastersEvent(data: EspnScoreboardResponse): EspnEvent | null {
  const MASTERS_KEYWORDS = ['masters', 'augusta'];
  return (
    data.events.find((e) => {
      const lower = e.name.toLowerCase();
      return MASTERS_KEYWORDS.some((kw) => lower.includes(kw));
    }) ?? null
  );
}

/** Return all competitors from the first competition in an event. */
export function getCompetitors(event: EspnEvent): EspnCompetitor[] {
  return event.competitions[0]?.competitors ?? [];
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

/**
 * Parse ESPN's score display string to an integer.
 *   "E"  → 0
 *   "-8" → -8
 *   "+2" → +2
 *   "CUT"/ anything non-numeric → null
 */
export function parseScoreToPar(displayValue: string | undefined | null): number | null {
  if (!displayValue) return null;
  const s = displayValue.trim();
  if (s === 'E') return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a raw stroke total string to a score-to-par number.
 * e.g. "68" → 68 - 72 = -4
 */
export function strokesToScoreToPar(displayValue: string | undefined | null): number | null {
  if (!displayValue) return null;
  const strokes = parseInt(displayValue.trim(), 10);
  if (!Number.isFinite(strokes)) return null;
  return strokes - AUGUSTA_PAR;
}

/**
 * Parse position display string to a numeric position.
 * "T5" → 5,  "1" → 1,  "CUT" → null,  "WD" → null
 */
export function parsePosition(displayValue: string | undefined | null): number | null {
  if (!displayValue) return null;
  const s = displayValue.replace(/^T/, ''); // strip leading T for ties
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Determine golfer status from ESPN status type name.
 * Returns 'active' | 'missed_cut' | 'withdrawn'
 */
export function parseGolferStatus(competitor: EspnCompetitor): 'active' | 'missed_cut' | 'withdrawn' {
  const typeName = competitor.status?.type?.name?.toUpperCase() ?? '';
  const typeDesc = competitor.status?.type?.description?.toUpperCase() ?? '';
  const posDisplay = competitor.status?.position?.displayName?.toUpperCase() ?? '';

  if (
    typeName.includes('WITHDRAWN') ||
    typeDesc.includes('WITHDRAWN') ||
    typeName.includes('WD') ||
    posDisplay === 'WD'
  ) return 'withdrawn';

  if (
    typeName.includes('CUT') ||
    typeDesc.includes('CUT') ||
    posDisplay === 'CUT' ||
    posDisplay === 'MC'
  ) return 'missed_cut';

  return 'active';
}

/**
 * Build a lookup map of completed per-round scores from ESPN linescores.
 * Returns an array: index 0 = round 1, index 1 = round 2, etc.
 * Only includes rounds with a parseable stroke total.
 */
export function parseRoundScores(
  competitor: EspnCompetitor
): Array<{ round: number; score_to_par: number; strokes: number }> {
  const linescores = competitor.linescores ?? [];
  const results: Array<{ round: number; score_to_par: number; strokes: number }> = [];
  for (let i = 0; i < linescores.length; i++) {
    const strokes = parseInt(linescores[i].displayValue ?? '', 10);
    if (!Number.isFinite(strokes) || strokes <= 0) continue;
    results.push({
      round: i + 1,
      score_to_par: strokes - AUGUSTA_PAR,
      strokes,
    });
  }
  return results;
}

// ── Name normalization ─────────────────────────────────────────────────────────

/**
 * Normalize a name for fuzzy matching:
 *   - decompose Unicode (NFD) to separate base letters from diacritics
 *   - strip combining marks (diacritics like é → e, ø → o)
 *   - lowercase and trim
 * Handles Ludvig Åberg → ludvig aberg, Nicolai Højgaard → nicolai hojgaard, etc.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, '') // keep letters, spaces, hyphens, apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}
