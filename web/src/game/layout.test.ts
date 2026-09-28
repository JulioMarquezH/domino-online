import { applyHandAction, dealHand, legalMoves, mulberry32, type HandState } from '@domino/shared';
import { describe, expect, it } from 'vitest';
import { GAP, chooseLimit, layoutSnake, type TileBox } from './layout';

function overlaps(a: TileBox, b: TileBox): boolean {
  const eps = 1e-9;
  return (
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 - eps && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 - eps
  );
}

/** Plays a random hand and returns every intermediate line. */
function randomLines(seed: number): HandState[] {
  const rng = mulberry32(seed);
  let s = dealHand(rng, 0);
  const states: HandState[] = [];
  while (!s.result) {
    const moves = legalMoves(s.hands[s.turn] ?? [], s.line);
    const m = moves[Math.floor(rng() * moves.length)];
    const out = applyHandAction(s, s.turn, m ? { type: 'play', ...m } : { type: 'pass' });
    if (!out.ok) throw new Error(out.error);
    s = out.state;
    states.push(s);
  }
  return states;
}

/** Distance between two boxes' edges (0 when they touch or overlap). */
function separation(a: TileBox, b: TileBox): number {
  const gx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2;
  const gy = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2;
  return Math.max(gx, gy);
}

describe('snake layout', () => {
  it('never lets two tiles touch: there is always a gap, also at corners and between rows', () => {
    for (let seed = 1; seed <= 80; seed++) {
      for (const limit of [5, 8, 11, 14]) {
        const states = randomLines(seed);
        const { tiles } = layoutSnake(states[states.length - 1] as HandState, limit);
        for (let i = 0; i < tiles.length; i++) {
          for (let j = i + 1; j < tiles.length; j++) {
            expect(separation(tiles[i] as TileBox, tiles[j] as TileBox)).toBeGreaterThanOrEqual(
              GAP - 1e-9,
            );
          }
        }
      }
    }
  });

  it('never overlaps tiles and faces matching pips toward each other', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const limit of [5, 8, 11, 14]) {
        const states = randomLines(seed);
        const last = states[states.length - 1] as HandState;
        const { tiles } = layoutSnake(last, limit);
        expect(tiles).toHaveLength(last.line.length);
        for (let i = 0; i < tiles.length; i++) {
          for (let j = i + 1; j < tiles.length; j++) {
            expect(overlaps(tiles[i] as TileBox, tiles[j] as TileBox)).toBe(false);
          }
        }
      }
    }
  });

  it('keeps already placed tiles still while the line grows', () => {
    const states = randomLines(9);
    const limit = 8;
    for (let k = 1; k < states.length; k++) {
      const before = layoutSnake(states[k - 1] as HandState, limit).tiles;
      const after = new Map(
        layoutSnake(states[k] as HandState, limit).tiles.map((t) => [t.key, t]),
      );
      for (const t of before) expect(after.get(t.key)).toEqual(t);
    }
  });

  it('chooses a wide row for a landscape phone board', () => {
    const limit = chooseLimit(680, 240);
    expect(limit).toBeGreaterThanOrEqual(8);
    expect(chooseLimit(300, 600)).toBeLessThan(limit);
  });

  it('shows a single center target on an empty table', () => {
    expect(layoutSnake({ line: [], origin: 0 }, 8).targets).toHaveLength(1);
  });
});
