import { describe, expect, it } from 'vitest';
import {
  JORNADAS,
  LETTERS,
  PAIRINGS,
  TOTAL_MATCHES,
  assignLetters,
  championsOf,
  cleanPlayerName,
  compareStandingRows,
  computeStandings,
  formatAvg,
  formatPts,
  generateSchedule,
  isShutout,
  matchNumber,
  mulberry32,
  nextPendingSlot,
  normalizeNameKey,
  pairOf,
  pairingPairs,
  shuffleJornadaOrder,
  slotOfNumber,
  standingsText,
  validateTournamentNames,
  winnerPoints,
  type LetterAssignment,
  type Pairing,
  type PlayedMatch,
} from '../src/index';

const PLAYERS: LetterAssignment[] = [
  { letter: 'A', name: 'Ana' },
  { letter: 'B', name: 'Beto' },
  { letter: 'C', name: 'Caro' },
  { letter: 'D', name: 'Dani' },
];

function match(
  pairing: Pairing,
  winnerPair: 1 | 2,
  loserScore: number,
  extra: Partial<PlayedMatch> = {},
): PlayedMatch {
  return {
    jornada: 1,
    slot: 1,
    pairing,
    winnerPair,
    scorePair1: winnerPair === 1 ? 100 : loserScore,
    scorePair2: winnerPair === 2 ? 100 : loserScore,
    ...extra,
  };
}

describe('names', () => {
  it('normalizes case, diacritics and spaces', () => {
    expect(normalizeNameKey('José')).toBe('jose');
    expect(normalizeNameKey('  JOSE   Luis ')).toBe('jose luis');
    expect(normalizeNameKey('Peña')).toBe(normalizeNameKey('pena'));
    expect(normalizeNameKey('Ñandú')).toBe('nandu');
  });

  it('cleans display names to 1–20 trimmed characters', () => {
    expect(cleanPlayerName('  Ana   María ')).toBe('Ana María');
    expect(cleanPlayerName('')).toBeNull();
    expect(cleanPlayerName('   ')).toBeNull();
    expect(cleanPlayerName('x'.repeat(21))).toBeNull();
    expect(cleanPlayerName('x'.repeat(20))).not.toBeNull();
    expect(cleanPlayerName(42)).toBeNull();
    expect(cleanPlayerName('́')).toBeNull(); // only a combining mark
  });

  it('requires exactly four names, unique after normalization', () => {
    expect(validateTournamentNames(['a', 'b', 'c'])).toEqual({ ok: false, code: 'NAMES_COUNT' });
    expect(validateTournamentNames('nope')).toEqual({ ok: false, code: 'NAMES_COUNT' });
    expect(validateTournamentNames(['a', 'b', '', 'd'])).toEqual({
      ok: false,
      code: 'NAME_INVALID',
      index: 2,
    });
    expect(validateTournamentNames(['José', 'Beto', 'Caro', ' jose '])).toEqual({
      ok: false,
      code: 'NAME_DUPLICATE',
      index: 3,
    });
    expect(validateTournamentNames([' Ana ', 'Beto', 'Caro', 'Dani'])).toEqual({
      ok: true,
      names: ['Ana', 'Beto', 'Caro', 'Dani'],
    });
  });
});

describe('letter draw', () => {
  it('is a permutation of A–D, deterministic per seed, in typing order', () => {
    const names = ['Ana', 'Beto', 'Caro', 'Dani'];
    const a = assignLetters(names, mulberry32(11));
    expect(a.map((p) => p.name)).toEqual(names);
    expect(a.map((p) => p.letter).sort()).toEqual([...LETTERS]);
    expect(assignLetters(names, mulberry32(11))).toEqual(a);
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      seen.add(
        assignLetters(names, mulberry32(seed))
          .map((p) => p.letter)
          .join(''),
      );
    }
    expect(seen.size).toBeGreaterThan(10); // not stuck on a few permutations
  });

  it('rejects anything but four names', () => {
    expect(() => assignLetters(['a', 'b'], mulberry32(1))).toThrow();
  });
});

describe('schedule', () => {
  it('pairs everybody with everybody once per jornada', () => {
    const order = shuffleJornadaOrder(mulberry32(3));
    expect([...order].sort()).toEqual([...PAIRINGS].sort());
    const partners = new Set<string>();
    for (const p of order) {
      for (const pair of pairingPairs(p)) partners.add([...pair].sort().join(''));
    }
    expect(partners.size).toBe(6); // all six combinations of two letters
  });

  it('every pairing uses all four letters', () => {
    for (const p of PAIRINGS) {
      const letters = pairingPairs(p).flat().sort();
      expect(letters).toEqual([...LETTERS]);
    }
    expect(pairOf('AB-CD', 'A')).toBe(1);
    expect(pairOf('AB-CD', 'D')).toBe(2);
    expect(pairOf('AC-BD', 'B')).toBe(2);
  });

  it('draws 4 jornadas × 3 matches = 12 slots, each jornada complete', () => {
    const schedule = generateSchedule(mulberry32(5));
    expect(schedule).toHaveLength(JORNADAS);
    for (const j of schedule) expect([...j].sort()).toEqual([...PAIRINGS].sort());
    expect(schedule.flat()).toHaveLength(TOTAL_MATCHES);
  });

  it('is seedable and the order really varies', () => {
    expect(generateSchedule(mulberry32(9))).toEqual(generateSchedule(mulberry32(9)));
    const orders = new Set<string>();
    for (let seed = 0; seed < 40; seed++) orders.add(shuffleJornadaOrder(mulberry32(seed)).join());
    expect(orders.size).toBe(6); // all 3! orders show up
  });

  it('numbers slots 1..12 and finds the next pending one', () => {
    expect(matchNumber(1, 1)).toBe(1);
    expect(matchNumber(4, 3)).toBe(12);
    expect(slotOfNumber(7)).toEqual({ jornada: 3, slot: 1 });
    expect(nextPendingSlot([])).toEqual({ jornada: 1, slot: 1, number: 1 });
    expect(
      nextPendingSlot([
        { jornada: 1, slot: 1 },
        { jornada: 1, slot: 2 },
      ]),
    ).toEqual({ jornada: 1, slot: 3, number: 3 });
    // A voided/missing earlier slot is always the next one.
    expect(
      nextPendingSlot([
        { jornada: 1, slot: 2 },
        { jornada: 1, slot: 3 },
      ]),
    ).toEqual({ jornada: 1, slot: 1, number: 1 });
    const all = Array.from({ length: 12 }, (_, i) => slotOfNumber(i + 1));
    expect(nextPendingSlot(all)).toBeNull();
  });
});

describe('scoring', () => {
  it('detects zapateros: the loser finished on 0', () => {
    expect(isShutout(match('AB-CD', 1, 0))).toBe(true);
    expect(isShutout(match('AB-CD', 2, 0))).toBe(true);
    expect(isShutout(match('AB-CD', 1, 5))).toBe(false);
    expect(winnerPoints(match('AB-CD', 1, 0))).toBe(1.5);
    expect(winnerPoints(match('AB-CD', 1, 30))).toBe(1);
  });

  it('gives each winner 1 point (1.5 on a zapatero) and the losers 0', () => {
    const rows = computeStandings(PLAYERS, [match('AB-CD', 1, 40)]);
    const by = Object.fromEntries(rows.map((r) => [r.letter, r]));
    expect(by.A).toMatchObject({ pj: 1, pg: 1, pts: 1, zap: 0, zapReceived: 0, avg: 1 });
    expect(by.B).toMatchObject({ pj: 1, pg: 1, pts: 1 });
    expect(by.C).toMatchObject({ pj: 1, pg: 0, pts: 0, avg: 0 });

    const zap = computeStandings(PLAYERS, [match('AB-CD', 2, 0)]);
    const z = Object.fromEntries(zap.map((r) => [r.letter, r]));
    expect(z.C).toMatchObject({ pg: 1, pts: 1.5, zap: 1, avg: 1.5 });
    expect(z.D).toMatchObject({ pg: 1, pts: 1.5, zap: 1 });
    expect(z.A).toMatchObject({ pg: 0, pts: 0, zapReceived: 1 });
    expect(z.B).toMatchObject({ zapReceived: 1 });
  });

  it('starts with an empty, fully tied table', () => {
    const rows = computeStandings(PLAYERS, []);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1, 1]);
    expect(rows.every((r) => r.avg === 0 && r.pj === 0)).toBe(true);
    expect(rows.map((r) => r.letter)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('excludes voided matches', () => {
    const rows = computeStandings(PLAYERS, [
      match('AB-CD', 1, 0, { voided: true }),
      match('AC-BD', 2, 10, { slot: 2 }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.letter, r]));
    expect(by.A?.pj).toBe(1);
    expect(by.A?.pts).toBe(0);
    expect(by.B?.pts).toBe(1);
    expect(by.A?.zapReceived).toBe(0);
  });

  it('keeps PJ equal for all four players in a partial tournament', () => {
    const rows = computeStandings(PLAYERS, [
      match('AB-CD', 1, 20),
      match('AC-BD', 2, 0, { slot: 2 }),
    ]);
    expect(new Set(rows.map((r) => r.pj))).toEqual(new Set([2]));
  });
});

/** Compact records: "pairing:winnerPair:loserScore", numbered in play order. */
function seq(...codes: string[]): PlayedMatch[] {
  return codes.map((code, i) => {
    const [pairing, winner, loser] = code.split(':') as [Pairing, string, string];
    return match(pairing, Number(winner) as 1 | 2, Number(loser), {
      jornada: Math.floor(i / 3) + 1,
      slot: (i % 3) + 1,
    });
  });
}

describe('ranking and tie-breakers', () => {
  const byLetter = (rows: ReturnType<typeof computeStandings>) =>
    Object.fromEntries(rows.map((r) => [r.letter, r]));

  it('orders by points first', () => {
    // A+B beat C+D; B+D beat A+C: B has 2, A 1, D 1, C 0.
    const rows = computeStandings(PLAYERS, seq('AB-CD:1:10', 'AC-BD:2:10'));
    expect(rows.map((r) => r.letter)).toEqual(['B', 'A', 'D', 'C']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it('tie-breaker 1: the higher Avg wins a points tie', () => {
    // PJ is equal for everybody in a real tournament, so Avg ties exactly when Pts tie; the
    // comparator is still exercised on rows with different PJ.
    const row = (letter: 'A' | 'B', pj: number, pts: number) => ({
      letter,
      name: letter,
      pj,
      pg: 0,
      zap: 0,
      zapReceived: 0,
      pts,
      avg: pj ? pts / pj : 0,
    });
    // A: 3 pts in 2 matches (1.50) beats B: 3 pts in 3 matches (1.00), whatever the letters.
    expect(compareStandingRows(row('A', 2, 3), row('B', 3, 3))).toBeLessThan(0);
    expect(compareStandingRows(row('B', 2, 3), row('A', 3, 3))).toBeLessThan(0);
    expect(compareStandingRows(row('A', 3, 3), row('B', 3, 3))).toBeLessThan(0); // only the letter
  });

  it('tie-breaker 2: more zapateros won ranks higher on equal points', () => {
    // A and C both end on 3 points with the same PJ (and Avg); A got there with two zapateros.
    const rows = computeStandings(
      PLAYERS,
      seq(
        'AB-CD:2:20',
        'AC-BD:2:20',
        'AD-BC:1:0',
        'AB-CD:2:20',
        'AC-BD:2:0',
        'AD-BC:2:20',
        'AB-CD:1:0',
      ),
    );
    const by = byLetter(rows);
    expect(by.A).toMatchObject({ pts: 3, zap: 2, zapReceived: 1 });
    expect(by.C).toMatchObject({ pts: 3, zap: 0, zapReceived: 3 });
    expect(by.A?.pts).toBe(by.C?.pts);
    expect(by.A?.avg).toBe(by.C?.avg);
    expect(rows.map((r) => r.letter)).toEqual(['D', 'B', 'A', 'C']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('tie-breaker 3: fewer zapateros received ranks higher when everything else is equal', () => {
    const base = {
      name: 'x',
      pj: 4,
      pg: 2,
      zap: 1,
      pts: 3.5,
      avg: 3.5 / 4,
    };
    const a = { ...base, letter: 'B' as const, zapReceived: 0 };
    const b = { ...base, letter: 'A' as const, zapReceived: 2 };
    // B outranks A even though A comes first alphabetically.
    expect(compareStandingRows(a, b)).toBeLessThan(0);
    expect([b, a].sort(compareStandingRows).map((r) => r.letter)).toEqual(['B', 'A']);
  });

  it('shows a total tie as the same rank, with no playoff', () => {
    // B and D end identical (1.5 pts, 1 zapatero won, 1 received): both are 2nd.
    const rows = computeStandings(PLAYERS, seq('AB-CD:1:0', 'AC-BD:1:20', 'AD-BC:1:0'));
    expect(rows.map((r) => `${r.letter}:${r.rank}`)).toEqual(['A:1', 'B:2', 'D:2', 'C:4']);
  });

  it('a symmetric finished tournament has several champions', () => {
    // 4 jornadas where each partner pair wins exactly the same number of times: A+B win AB-CD
    // in jornadas 1 and 2 and lose it in 3 and 4, and so on, so all four finish level.
    const wins: Record<Pairing, (1 | 2)[]> = {
      'AB-CD': [1, 1, 2, 2],
      'AC-BD': [1, 2, 1, 2],
      'AD-BC': [1, 2, 2, 1],
    };
    const all: PlayedMatch[] = [];
    for (let j = 1; j <= 4; j++) {
      PAIRINGS.forEach((pairing, i) => {
        all.push(match(pairing, wins[pairing][j - 1] as 1 | 2, 30, { jornada: j, slot: i + 1 }));
      });
    }
    const rows = computeStandings(PLAYERS, all);
    expect(rows.every((r) => r.pj === 12 && r.pts === rows[0]?.pts)).toBe(true);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1, 1]);
    expect(championsOf(rows)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('a finished tournament with a single leader has one champion', () => {
    const rows = computeStandings(PLAYERS, seq('AB-CD:1:5', 'AC-BD:1:5', 'AD-BC:1:5'));
    expect(championsOf(rows)).toEqual(['A']);
  });
});

describe('formatting', () => {
  it('formats Avg to two decimals and Pts to at most one', () => {
    expect(formatAvg(1)).toBe('1.00');
    expect(formatAvg(2.5 / 3)).toBe('0.83');
    expect(formatPts(3)).toBe('3');
    expect(formatPts(3.5)).toBe('3.5');
  });

  it('builds the WhatsApp table ordered by ranking', () => {
    const rows = computeStandings(PLAYERS, [match('AB-CD', 1, 0)]);
    const text = standingsText(rows, 1);
    const lines = text.split('\n');
    expect(lines[0]).toBe('📊 *TABLA*');
    expect(lines[1]).toBe('Jugador | PJ | PG | Zap | Pts | Avg');
    expect(lines[2]).toBe('1. Ana (A) | 1 | 1 | 1 | 1.5 | 1.50');
    expect(lines[3]).toBe('1. Beto (B) | 1 | 1 | 1 | 1.5 | 1.50');
    expect(lines[4]).toBe('3. Caro (C) | 1 | 0 | 0 | 0 | 0.00');
    expect(lines.at(-1)).toBe('Partidos: 1/12');
  });
});
