import { describe, expect, it } from 'vitest';
import {
  applyHandAction,
  chooseAction,
  dealHand,
  hasPip,
  knowledgeOf,
  knownVoids,
  legalMoves,
  mulberry32,
  playableEnds,
  randomInt,
  sampleHands,
  teamOf,
  type Action,
  type HandState,
  type Rng,
  type Seat,
} from '../src';

/** Plays a whole hand; seats in `aiSeats` use the AI, the rest play random legal moves. */
function playHand(seed: number, aiSeats: Seat[], budget = 150) {
  const rng = mulberry32(seed);
  let s = dealHand(rng, (seed % 4) as Seat);
  while (!s.result) {
    const seat = s.turn;
    let action: Action;
    if (aiSeats.includes(seat)) {
      action = chooseAction(knowledgeOf(s, seat), rng, { budget });
      if (action.type === 'play') {
        expect(playableEnds(action.tile, s.line).length).toBeGreaterThan(0);
      }
    } else {
      const moves = legalMoves(s.hands[seat] ?? [], s.line);
      const m = moves[randomInt(rng, moves.length)];
      action = m ? { type: 'play', ...m } : { type: 'pass' };
    }
    const out = applyHandAction(s, seat, action);
    if (!out.ok) throw new Error(`AI made an illegal action: ${out.error}`);
    s = out.state;
  }
  return s;
}

describe('knowledge and inference', () => {
  it('learns from passes which numbers a player does not have', () => {
    const history = [
      { seat: 1 as Seat, kind: 'pass' as const, ends: [5, 3] as [number, number] },
      {
        seat: 2 as Seat,
        kind: 'play' as const,
        tile: '5-5',
        end: 'left' as const,
        ends: [5, 3] as [number, number],
      },
    ];
    const v = knownVoids(history);
    expect([...(v[1] ?? [])].sort()).toEqual([3, 5]);
    expect(v[2]?.size).toBe(0);
  });

  it('deals hidden tiles consistently with counts, the table and known voids', () => {
    let s = dealHand(mulberry32(4), 0);
    const rng = mulberry32(9);
    // Play until someone has passed at least once.
    while (!s.result && !s.history.some((h) => h.kind === 'pass')) {
      const moves = legalMoves(s.hands[s.turn] ?? [], s.line);
      const m = moves[0];
      const out = applyHandAction(s, s.turn, m ? { type: 'play', ...m } : { type: 'pass' });
      if (!out.ok) throw new Error(out.error);
      s = out.state;
    }
    const k = knowledgeOf(s, s.turn);
    const voids = knownVoids(k.history);
    for (let i = 0; i < 50; i++) {
      const hands = sampleHands(k, rng);
      expect(hands[k.seat]).toEqual(k.hand);
      hands.forEach((h, seat) => {
        expect(h.length).toBe(k.counts[seat]);
        for (const t of h) {
          if (seat === k.seat) continue;
          for (const n of voids[seat] ?? []) expect(hasPip(t, n)).toBe(false);
        }
      });
      const all = [...hands.flat(), ...k.line.map((t) => t.tile)];
      expect(new Set(all).size).toBe(28);
    }
  });

  it('never peeks: the same public information gives the same decision', () => {
    const s = dealHand(mulberry32(21), 0);
    const first = applyHandAction(s, 0, { type: 'play', tile: s.hands[0]?.[0] as string });
    if (!first.ok) throw new Error(first.error);
    const real = first.state;
    // Shuffle the hidden tiles of seats 2 and 3 between them: the AI at seat 1 can't tell.
    const swapped: HandState = {
      ...real,
      hands: [real.hands[0] ?? [], real.hands[1] ?? [], real.hands[3] ?? [], real.hands[2] ?? []],
    };
    const a = chooseAction(knowledgeOf(real, 1), mulberry32(5), { budget: 200 });
    const b = chooseAction(knowledgeOf(swapped, 1), mulberry32(5), { budget: 200 });
    expect(a).toEqual(b);
  });

  it('goes out (domino) when it holds a single playable tile', () => {
    const k = {
      seat: 0 as Seat,
      hand: ['6-4'],
      line: [{ tile: '4-2', left: 4, right: 2, seat: 1 as Seat }],
      origin: 0,
      starter: 1 as Seat,
      history: [],
      counts: [1, 5, 5, 5],
    };
    expect(chooseAction(k, mulberry32(1))).toEqual({ type: 'play', tile: '6-4', end: 'left' });
  });
});

describe('strength', () => {
  it('an AI pair clearly beats a random pair', () => {
    let ai = 0;
    let random = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const aiSeats: Seat[] = seed % 2 ? [0, 2] : [1, 3];
      const r = playHand(seed, aiSeats).result;
      if (!r || r.winnerTeam === null) continue;
      const aiTeam = teamOf(aiSeats[0] as Seat);
      if (r.winnerTeam === aiTeam) ai += r.points;
      else random += r.points;
    }
    expect(ai).toBeGreaterThan(random * 1.5);
  });

  it('is fast enough for a 1 vCPU server', () => {
    const s = dealHand(mulberry32(3), 0) as HandState;
    const rng: Rng = mulberry32(8);
    const t0 = Date.now();
    chooseAction(knowledgeOf(s, 0), rng);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
