/**
 * Tournament rules as pure functions: names, letters, schedule, scoring and standings.
 *
 * A tournament is a private league of exactly 4 fixed players (letters A–D) who play 12 matches:
 * 4 "jornadas" × 3 matches, each jornada pairing every partner combination once.
 * Everything here is deterministic given its inputs (RNGs are injected), so the server can
 * persist only match records and derive the rest.
 */
import { shuffle, type Rng } from './rng';
import type { Target } from './match';

export const LETTERS = ['A', 'B', 'C', 'D'] as const;
export type Letter = (typeof LETTERS)[number];

export const TOURNAMENT_PLAYERS = 4;
export const JORNADAS = 4;
export const MATCHES_PER_JORNADA = 3;
export const TOTAL_MATCHES = JORNADAS * MATCHES_PER_JORNADA;
/** Every tournament match is played to 100. Never client-supplied. */
export const TOURNAMENT_TARGET: Target = 100;
/** Unguessable: 12 chars of a 31-symbol alphabet ≈ 59 bits. The ID is the tournament's only secret. */
export const TOURNAMENT_ID_LENGTH = 12;
export const TOURNAMENT_NAME_MAX_LENGTH = 20;

export function isLetter(value: unknown): value is Letter {
  return typeof value === 'string' && (LETTERS as readonly string[]).includes(value);
}

// ───────────────────────────── names ─────────────────────────────

/**
 * Comparison key for a player name: lowercase, no diacritics, single spaces.
 * "José" and "  jose " share a key, and so do "Peña" and "pena".
 */
export function normalizeNameKey(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trimmed, single-spaced display name (1–20 chars) or null. */
export function cleanPlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || [...name].length > TOURNAMENT_NAME_MAX_LENGTH) return null;
  if (normalizeNameKey(name) === '') return null;
  return name;
}

export type NamesError =
  | { code: 'NAMES_COUNT' }
  | { code: 'NAME_INVALID'; index: number }
  | { code: 'NAME_DUPLICATE'; index: number };

/** The creator must type exactly 4 distinct names (distinct after normalization). */
export function validateTournamentNames(
  raw: unknown,
): { ok: true; names: string[] } | ({ ok: false } & NamesError) {
  if (!Array.isArray(raw) || raw.length !== TOURNAMENT_PLAYERS) {
    return { ok: false, code: 'NAMES_COUNT' };
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const name = cleanPlayerName(entry);
    if (name === null) return { ok: false, code: 'NAME_INVALID', index };
    const key = normalizeNameKey(name);
    if (seen.has(key)) return { ok: false, code: 'NAME_DUPLICATE', index };
    seen.add(key);
    names.push(name);
  }
  return { ok: true, names };
}

export interface LetterAssignment {
  letter: Letter;
  name: string;
}

/**
 * The draw: a random permutation of A–D over the names. Returned in the order the names were
 * typed, so the client can animate "this name got this letter". The server calls it with the
 * crypto RNG; the client only animates the outcome.
 */
export function assignLetters(names: readonly string[], rng: Rng): LetterAssignment[] {
  if (names.length !== TOURNAMENT_PLAYERS) throw new Error('A tournament has exactly 4 players');
  const letters = shuffle(LETTERS, rng);
  return names.map((name, i) => ({ name, letter: letters[i] as Letter }));
}

// ───────────────────────────── schedule ─────────────────────────────

export const PAIRINGS = ['AB-CD', 'AC-BD', 'AD-BC'] as const;
export type Pairing = (typeof PAIRINGS)[number];

export type Pair = [Letter, Letter];

export function isPairing(value: unknown): value is Pairing {
  return typeof value === 'string' && (PAIRINGS as readonly string[]).includes(value);
}

/** The two partner pairs of a pairing, in order: pair 1 (team 0) and pair 2 (team 1). */
export function pairingPairs(pairing: Pairing): [Pair, Pair] {
  const [a, b] = pairing.split('-') as [string, string];
  return [
    [a[0] as Letter, a[1] as Letter],
    [b[0] as Letter, b[1] as Letter],
  ];
}

export function pairOf(pairing: Pairing, letter: Letter): 1 | 2 {
  return pairingPairs(pairing)[0].includes(letter) ? 1 : 2;
}

/** The order of the three matches of one jornada, drawn when that jornada starts. */
export function shuffleJornadaOrder(rng: Rng): Pairing[] {
  return shuffle(PAIRINGS, rng);
}

/** A full schedule drawn up front (4 jornadas × 3 matches). The server draws jornadas lazily. */
export function generateSchedule(rng: Rng, jornadas = JORNADAS): Pairing[][] {
  return Array.from({ length: jornadas }, () => shuffleJornadaOrder(rng));
}

/** 1..12: the position of a match in the whole tournament. */
export function matchNumber(jornada: number, slot: number): number {
  return (jornada - 1) * MATCHES_PER_JORNADA + slot;
}

export function slotOfNumber(number: number): { jornada: number; slot: number } {
  return {
    jornada: Math.floor((number - 1) / MATCHES_PER_JORNADA) + 1,
    slot: ((number - 1) % MATCHES_PER_JORNADA) + 1,
  };
}

/** The lowest unfinished slot among the 12, or null when all are done. */
export function nextPendingSlot(
  recorded: Iterable<{ jornada: number; slot: number }>,
): { jornada: number; slot: number; number: number } | null {
  const done = new Set<number>();
  for (const m of recorded) done.add(matchNumber(m.jornada, m.slot));
  for (let n = 1; n <= TOTAL_MATCHES; n++) {
    if (!done.has(n)) return { ...slotOfNumber(n), number: n };
  }
  return null;
}

// ───────────────────────────── scoring ─────────────────────────────

/** The slice of a stored match that the standings need. */
export interface PlayedMatch {
  jornada: number;
  slot: number;
  pairing: Pairing;
  winnerPair: 1 | 2;
  scorePair1: number;
  scorePair2: number;
  /** Voided matches are kept in the database but never count. */
  voided?: boolean;
}

/** "Zapatero": the losing pair finished the match with 0 points. */
export function isShutout(
  m: Pick<PlayedMatch, 'winnerPair' | 'scorePair1' | 'scorePair2'>,
): boolean {
  return (m.winnerPair === 1 ? m.scorePair2 : m.scorePair1) === 0;
}

/** Points each of the two winners gets: 1, or 1.5 for a zapatero. Losers get 0. */
export function winnerPoints(m: Pick<PlayedMatch, 'winnerPair' | 'scorePair1' | 'scorePair2'>) {
  return isShutout(m) ? 1.5 : 1;
}

export interface StandingRow {
  letter: Letter;
  name: string;
  /** Competition ranking: tied players share a rank (1, 1, 3, 4). */
  rank: number;
  /** Matches played. */
  pj: number;
  /** Matches won. */
  pg: number;
  /** Zapateros won. */
  zap: number;
  /** Zapateros received. */
  zapReceived: number;
  /** 0.5 steps, exact in floating point. */
  pts: number;
  /** pts ÷ pj, 0 when nobody has played yet. */
  avg: number;
}

type Totals = Omit<StandingRow, 'rank'>;

function compareAvg(a: Totals, b: Totals): number {
  // Cross-multiplied so equal averages compare equal without float noise.
  if (a.pj > 0 && b.pj > 0) return a.pts * b.pj - b.pts * a.pj;
  return a.avg - b.avg;
}

/**
 * Sort comparator: negative when `a` ranks above `b`. Pts, then Avg, then more zapateros won,
 * then fewer zapateros received; the letter only fixes the display order of exact ties.
 */
export function compareStandingRows(a: Totals, b: Totals): number {
  return (
    b.pts - a.pts ||
    -compareAvg(a, b) ||
    b.zap - a.zap ||
    a.zapReceived - b.zapReceived ||
    // Final, display-only order for ties (they keep the same rank).
    a.letter.localeCompare(b.letter)
  );
}

function tiedOnEverything(a: Totals, b: Totals): boolean {
  return (
    a.pts === b.pts && compareAvg(a, b) === 0 && a.zap === b.zap && a.zapReceived === b.zapReceived
  );
}

/**
 * The table, always derived from the match records. Ties after all tie-breakers keep the same
 * rank: there is no 1-vs-1 playoff.
 */
export function computeStandings(
  players: readonly LetterAssignment[],
  matches: readonly PlayedMatch[],
): StandingRow[] {
  const totals = new Map<Letter, Totals>(
    players.map((p) => [
      p.letter,
      { letter: p.letter, name: p.name, pj: 0, pg: 0, zap: 0, zapReceived: 0, pts: 0, avg: 0 },
    ]),
  );
  for (const m of matches) {
    if (m.voided) continue;
    const pairs = pairingPairs(m.pairing);
    const shutout = isShutout(m);
    const pts = winnerPoints(m);
    pairs.forEach((pair, i) => {
      const won = m.winnerPair === i + 1;
      for (const letter of pair) {
        const t = totals.get(letter);
        if (!t) continue;
        t.pj += 1;
        if (won) {
          t.pg += 1;
          t.pts += pts;
          if (shutout) t.zap += 1;
        } else if (shutout) {
          t.zapReceived += 1;
        }
      }
    });
  }
  const rows = [...totals.values()];
  for (const t of rows) t.avg = t.pj > 0 ? t.pts / t.pj : 0;
  rows.sort(compareStandingRows);
  const ranked: StandingRow[] = [];
  rows.forEach((t, i) => {
    const prev = rows[i - 1];
    const prevRank = ranked[i - 1]?.rank ?? 1;
    ranked.push({ ...t, rank: prev && tiedOnEverything(prev, t) ? prevRank : i + 1 });
  });
  return ranked;
}

/** Everyone sharing first place once the tournament is over (several = "Campeones empatados"). */
export function championsOf(rows: readonly StandingRow[]): Letter[] {
  return rows.filter((r) => r.rank === 1).map((r) => r.letter);
}

export const formatAvg = (avg: number): string => avg.toFixed(2);
/** At most one decimal: 3, 3.5. */
export const formatPts = (pts: number): string =>
  Number.isInteger(pts) ? String(pts) : pts.toFixed(1);

/** WhatsApp-ready table, ranked. Bold uses WhatsApp's *asterisks*. */
export function standingsText(rows: readonly StandingRow[], played: number): string {
  const lines = rows.map(
    (r) =>
      `${r.rank}. ${r.name} (${r.letter}) | ${r.pj} | ${r.pg} | ${r.zap} | ${formatPts(r.pts)} | ${formatAvg(r.avg)}`,
  );
  return [
    '📊 *TABLA*',
    'Jugador | PJ | PG | Zap | Pts | Avg',
    ...lines,
    `Partidos: ${played}/${TOTAL_MATCHES}`,
  ].join('\n');
}
