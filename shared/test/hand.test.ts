import { describe, expect, it } from 'vitest';
import {
  applyHandAction,
  canPass,
  dealHand,
  fullSet,
  hasLegalMove,
  legalMoves,
  mulberry32,
  openEnds,
  playableEnds,
  type HandState,
  type PlacedTile,
  type Seat,
  type TileId,
} from '../src';

/** Builds a line whose open ends are `left` and `right` (inner tiles are only filler). */
function lineWithEnds(left: number, right: number, filler: TileId[] = []): PlacedTile[] {
  const line: PlacedTile[] = [{ tile: 'x', left, right: 9, seat: 0 }];
  for (const t of filler) line.push({ tile: t, left: 9, right: 9, seat: 0 });
  line.push({ tile: 'y', left: 9, right, seat: 0 });
  return line;
}

function state(hands: TileId[][], line: PlacedTile[], turn: Seat): HandState {
  return { hands, line, origin: 0, starter: 0, turn, result: null };
}

describe('dealing', () => {
  it('deals all 28 tiles, 7 each, with no boneyard', () => {
    const hand = dealHand(mulberry32(1), 2);
    expect(hand.hands.map((h) => h.length)).toEqual([7, 7, 7, 7]);
    expect(new Set(hand.hands.flat())).toEqual(new Set(fullSet()));
    expect(hand.turn).toBe(2);
    expect(hand.starter).toBe(2);
  });
});

describe('legal moves', () => {
  it('lets the starter lead ANY tile (the double-six is not required)', () => {
    const hand = dealHand(mulberry32(7), 0);
    const lead = hand.hands[0]?.find((t) => t !== '6-6') as TileId;
    const out = applyHandAction(hand, 0, { type: 'play', tile: lead });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.state.line.map((p) => p.tile)).toEqual([lead]);
  });

  it('detects legal moves against both open ends', () => {
    const line = lineWithEnds(4, 2);
    expect(openEnds(line)).toEqual([4, 2]);
    expect(playableEnds('4-2', line)).toEqual(['left', 'right']);
    expect(playableEnds('6-4', line)).toEqual(['left']);
    expect(playableEnds('2-0', line)).toEqual(['right']);
    expect(playableEnds('6-5', line)).toEqual([]);
    expect(legalMoves(['6-5', '2-0', '4-4'], line)).toEqual([
      { tile: '2-0', end: 'right' },
      { tile: '4-4', end: 'left' },
    ]);
    expect(hasLegalMove(['6-5', '3-1'], line)).toBe(false);
  });

  it('only allows passing without a legal move', () => {
    const line = lineWithEnds(4, 2);
    expect(canPass(['6-5', '3-1'], line)).toBe(true);
    expect(canPass(['6-5', '2-1'], line)).toBe(false);

    const blocked = state([['6-5', '3-1'], ['2-1'], [], []], line, 0);
    const ok = applyHandAction(blocked, 0, { type: 'pass' });
    expect(ok.ok && ok.state.turn).toBe(1);
    const denied = applyHandAction({ ...blocked, turn: 1 }, 1, { type: 'pass' });
    expect(denied).toEqual({ ok: false, error: 'CANNOT_PASS' });
  });

  it('rejects out-of-turn plays, tiles not in hand and illegal ends', () => {
    const s = state([['6-4', '3-3'], ['2-0'], [], []], lineWithEnds(4, 2), 0);
    expect(applyHandAction(s, 1, { type: 'play', tile: '2-0', end: 'right' })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    expect(applyHandAction(s, 0, { type: 'play', tile: '2-0', end: 'right' })).toEqual({
      ok: false,
      error: 'TILE_NOT_IN_HAND',
    });
    expect(applyHandAction(s, 0, { type: 'play', tile: '6-4', end: 'right' })).toEqual({
      ok: false,
      error: 'ILLEGAL_MOVE',
    });
    expect(applyHandAction(s, 0, { type: 'play', tile: '3-3', end: 'left' })).toEqual({
      ok: false,
      error: 'ILLEGAL_MOVE',
    });
  });

  it('requires choosing an end when a tile fits both', () => {
    const s = state([['4-2', '0-0'], [], [], []], lineWithEnds(4, 2), 0);
    expect(applyHandAction(s, 0, { type: 'play', tile: '4-2' })).toEqual({
      ok: false,
      error: 'END_REQUIRED',
    });
    const left = applyHandAction(s, 0, { type: 'play', tile: '4-2', end: 'left' });
    expect(left.ok && openEnds(left.state.line)).toEqual([2, 2]);
    const right = applyHandAction(s, 0, { type: 'play', tile: '4-2', end: 'right' });
    expect(right.ok && openEnds(right.state.line)).toEqual([4, 4]);
  });

  it('keeps the origin pointing at the lead tile as the line grows left', () => {
    let s = state([['5-3', '1-1'], ['5-1'], ['3-2'], ['0-0']], [], 0);
    const a = applyHandAction(s, 0, { type: 'play', tile: '5-3' });
    if (!a.ok) throw new Error(a.error);
    s = a.state;
    const b = applyHandAction(s, 1, { type: 'play', tile: '5-1', end: 'left' });
    if (!b.ok) throw new Error(b.error);
    expect(b.state.origin).toBe(1);
    expect(b.state.line[b.state.origin]?.tile).toBe('5-3');
    expect(b.state.line[0]).toMatchObject({ tile: '5-1', left: 1, right: 5 });
  });
});

describe('end of hand', () => {
  it('domino: the team of the player who goes out scores both opponents’ pips', () => {
    const hands = [['6-6', '1-0'], ['6-4'], ['2-2'], ['5-5', '3-0']];
    const s = state(hands, lineWithEnds(4, 2), 1);
    const out = applyHandAction(s, 1, { type: 'play', tile: '6-4', end: 'left' });
    if (!out.ok) throw new Error(out.error);
    expect(out.events.map((e) => e.type)).toEqual(['play', 'domino']);
    expect(out.state.result).toMatchObject({
      kind: 'domino',
      winner: 1,
      winnerTeam: 1,
      points: 12 + 1 + 4, // seats 0 and 2
      teamPips: [17, 13],
    });
  });

  it('tranque: detected right after the blocking play; the lower team total wins', () => {
    // Every other 5 is already on the table: playing 5-3 on the right leaves 5 | 5.
    const filler = ['5-5', '5-0', '5-1', '5-2', '5-4', '6-5'];
    const s = state(
      [['5-3', '6-6'], ['4-4'], ['0-0'], ['1-1', '2-2']],
      lineWithEnds(5, 3, filler),
      0,
    );
    const out = applyHandAction(s, 0, { type: 'play', tile: '5-3', end: 'right' });
    if (!out.ok) throw new Error(out.error);
    expect(out.events.map((e) => e.type)).toEqual(['play', 'tranque']);
    // Team 0: 6-6 + 0-0 = 12; team 1: 4-4 + 1-1 + 2-2 = 14.
    expect(out.state.result).toMatchObject({
      kind: 'tranque',
      winnerTeam: 0,
      points: 14,
      teamPips: [12, 14],
    });
  });

  it('tranque with equal team totals scores 0–0', () => {
    const filler = ['5-5', '5-0', '5-1', '5-2', '5-4', '6-5'];
    const s = state([['5-3', '6-6'], ['4-4'], ['0-0'], ['2-2']], lineWithEnds(5, 3, filler), 0);
    const out = applyHandAction(s, 0, { type: 'play', tile: '5-3', end: 'right' });
    if (!out.ok) throw new Error(out.error);
    expect(out.events).toContainEqual({ type: 'tranque', tie: true });
    expect(out.state.result).toMatchObject({
      kind: 'tranque-tie',
      winnerTeam: null,
      points: 0,
      teamPips: [12, 12],
    });
  });

  it('does not call tranque while someone can still play', () => {
    const s = state([['5-3', '6-6'], ['5-4'], ['0-0'], ['2-2']], lineWithEnds(5, 3), 0);
    const out = applyHandAction(s, 0, { type: 'play', tile: '5-3', end: 'right' });
    expect(out.ok && out.state.result).toBe(null);
  });

  it('rejects actions once the hand is over', () => {
    const s = state([['6-4'], ['1-1'], ['2-2'], ['3-3']], lineWithEnds(4, 2), 0);
    const out = applyHandAction(s, 0, { type: 'play', tile: '6-4', end: 'left' });
    if (!out.ok) throw new Error(out.error);
    expect(applyHandAction(out.state, 1, { type: 'pass' })).toEqual({
      ok: false,
      error: 'HAND_OVER',
    });
  });
});
