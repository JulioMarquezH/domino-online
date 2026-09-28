import { shuffle, type Rng } from './rng';
import { SEATS, nextSeat, teamOf, type Seat, type Team } from './seats';
import { fullSet, handPips, hasPip, isTileId, otherSide, parseTile, type TileId } from './tiles';

export type End = 'left' | 'right';

export const TILES_PER_HAND = 7;

/** A tile on the table. `left`/`right` are its pips in line order (left end → right end). */
export interface PlacedTile {
  tile: TileId;
  left: number;
  right: number;
  seat: Seat;
}

export type TeamPips = [number, number];

export type HandResult =
  | {
      kind: 'domino';
      winnerTeam: Team;
      /** Player who played their last tile. */
      winner: Seat;
      points: number;
      teamPips: TeamPips;
      hands: TileId[][];
    }
  | {
      kind: 'tranque';
      winnerTeam: Team;
      points: number;
      teamPips: TeamPips;
      hands: TileId[][];
    }
  | {
      kind: 'tranque-tie';
      winnerTeam: null;
      points: 0;
      teamPips: TeamPips;
      hands: TileId[][];
    };

/** Public record of the hand: every player at the table sees it happen. */
export interface HistoryEntry {
  seat: Seat;
  kind: 'play' | 'pass';
  tile?: TileId;
  end?: End;
  /** Open ends right before the action (null on the lead). */
  ends: [number, number] | null;
}

export interface HandState {
  /** Remaining tiles, indexed by seat. */
  hands: TileId[][];
  /** Played tiles in line order, from the left end to the right end. */
  line: PlacedTile[];
  /** Index in `line` of the lead tile (the snake grows from it in both directions). */
  origin: number;
  starter: Seat;
  turn: Seat;
  result: HandResult | null;
  history: HistoryEntry[];
}

export type Action = { type: 'play'; tile: TileId; end?: End } | { type: 'pass' };

export type GameEvent =
  | { type: 'play'; seat: Seat; tile: TileId; end: End }
  | { type: 'pass'; seat: Seat }
  | { type: 'domino'; seat: Seat }
  | { type: 'tranque'; tie: boolean };

export type ActionError =
  | 'HAND_OVER'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ACTION'
  | 'TILE_NOT_IN_HAND'
  | 'ILLEGAL_MOVE'
  | 'END_REQUIRED'
  | 'CANNOT_PASS';

export type ActionOutcome<S> =
  { ok: true; state: S; events: GameEvent[] } | { ok: false; error: ActionError };

/** Shuffle the full set and deal all 28 tiles, 7 per player. There is no boneyard. */
export function dealHand(rng: Rng, starter: Seat): HandState {
  const deck = shuffle(fullSet(), rng);
  const hands = SEATS.map((s) => deck.slice(s * TILES_PER_HAND, (s + 1) * TILES_PER_HAND));
  return { hands, line: [], origin: 0, starter, turn: starter, result: null, history: [] };
}

/** [leftPip, rightPip] of the open ends, or null when nothing has been played. */
export function openEnds(line: readonly PlacedTile[]): [number, number] | null {
  const first = line[0];
  const last = line[line.length - 1];
  if (!first || !last) return null;
  return [first.left, last.right];
}

export function fitsEnd(tile: TileId, end: End, line: readonly PlacedTile[]): boolean {
  const ends = openEnds(line);
  if (!ends) return true;
  return hasPip(tile, end === 'left' ? ends[0] : ends[1]);
}

/** The ends where `tile` can be played ([] if none). An empty table accepts anything. */
export function playableEnds(tile: TileId, line: readonly PlacedTile[]): End[] {
  if (line.length === 0) return ['left'];
  return (['left', 'right'] as const).filter((end) => fitsEnd(tile, end, line));
}

export interface LegalMove {
  tile: TileId;
  end: End;
}

export function legalMoves(hand: readonly TileId[], line: readonly PlacedTile[]): LegalMove[] {
  return hand.flatMap((tile) => playableEnds(tile, line).map((end) => ({ tile, end })));
}

export function hasLegalMove(hand: readonly TileId[], line: readonly PlacedTile[]): boolean {
  return hand.some((tile) => playableEnds(tile, line).length > 0);
}

/** Passing is legal only when the player has no legal move. */
export function canPass(hand: readonly TileId[], line: readonly PlacedTile[]): boolean {
  return !hasLegalMove(hand, line);
}

export function teamPips(hands: readonly TileId[][]): TeamPips {
  const pips: TeamPips = [0, 0];
  SEATS.forEach((s) => {
    pips[teamOf(s)] += handPips(hands[s] ?? []);
  });
  return pips;
}

/** A blocked game: nobody can play. */
export function isBlocked(hands: readonly TileId[][], line: readonly PlacedTile[]): boolean {
  return line.length > 0 && SEATS.every((s) => !hasLegalMove(hands[s] ?? [], line));
}

function placeTile(line: PlacedTile[], tile: TileId, end: End, seat: Seat): PlacedTile {
  const ends = openEnds(line);
  if (!ends) {
    const [hi, lo] = parseTile(tile);
    return { tile, left: hi, right: lo, seat };
  }
  if (end === 'left') {
    return { tile, left: otherSide(tile, ends[0]), right: ends[0], seat };
  }
  return { tile, left: ends[1], right: otherSide(tile, ends[1]), seat };
}

function dominoResult(hands: TileId[][], winner: Seat): HandResult {
  const pips = teamPips(hands);
  const winnerTeam = teamOf(winner);
  return {
    kind: 'domino',
    winner,
    winnerTeam,
    points: pips[winnerTeam === 0 ? 1 : 0],
    teamPips: pips,
    hands,
  };
}

function tranqueResult(hands: TileId[][]): HandResult {
  const pips = teamPips(hands);
  if (pips[0] === pips[1]) {
    return { kind: 'tranque-tie', winnerTeam: null, points: 0, teamPips: pips, hands };
  }
  const winnerTeam: Team = pips[0] < pips[1] ? 0 : 1;
  return {
    kind: 'tranque',
    winnerTeam,
    points: pips[winnerTeam === 0 ? 1 : 0],
    teamPips: pips,
    hands,
  };
}

/** Validates and applies an action. Never mutates `state`. */
export function applyHandAction(
  state: HandState,
  seat: Seat,
  action: Action,
): ActionOutcome<HandState> {
  if (state.result) return { ok: false, error: 'HAND_OVER' };
  if (seat !== state.turn) return { ok: false, error: 'NOT_YOUR_TURN' };
  const hand = state.hands[seat] ?? [];

  if (action.type === 'pass') {
    if (!canPass(hand, state.line)) return { ok: false, error: 'CANNOT_PASS' };
    return {
      ok: true,
      state: {
        ...state,
        turn: nextSeat(seat),
        history: [...state.history, { seat, kind: 'pass', ends: openEnds(state.line) }],
      },
      events: [{ type: 'pass', seat }],
    };
  }

  if (action.type !== 'play' || !isTileId(action.tile)) {
    return { ok: false, error: 'INVALID_ACTION' };
  }
  if (action.end !== undefined && action.end !== 'left' && action.end !== 'right') {
    return { ok: false, error: 'INVALID_ACTION' };
  }
  const { tile } = action;
  if (!hand.includes(tile)) return { ok: false, error: 'TILE_NOT_IN_HAND' };

  const ends = playableEnds(tile, state.line);
  if (ends.length === 0) return { ok: false, error: 'ILLEGAL_MOVE' };
  let end: End;
  if (state.line.length === 0) {
    end = 'left';
  } else if (action.end === undefined) {
    if (ends.length > 1) return { ok: false, error: 'END_REQUIRED' };
    end = ends[0] as End;
  } else {
    if (!ends.includes(action.end)) return { ok: false, error: 'ILLEGAL_MOVE' };
    end = action.end;
  }

  const placed = placeTile(state.line, tile, end, seat);
  const line =
    end === 'left' && state.line.length > 0 ? [placed, ...state.line] : [...state.line, placed];
  const origin = end === 'left' && state.line.length > 0 ? state.origin + 1 : state.origin;
  const hands = state.hands.map((h, s) => (s === seat ? h.filter((t) => t !== tile) : h.slice()));
  const events: GameEvent[] = [{ type: 'play', seat, tile, end }];

  let result: HandResult | null = null;
  if ((hands[seat] ?? []).length === 0) {
    result = dominoResult(hands, seat);
    events.push({ type: 'domino', seat });
  } else if (isBlocked(hands, line)) {
    result = tranqueResult(hands);
    events.push({ type: 'tranque', tie: result.kind === 'tranque-tie' });
  }

  return {
    ok: true,
    state: {
      hands,
      line,
      origin,
      starter: state.starter,
      turn: result ? seat : nextSeat(seat),
      result,
      history: [...state.history, { seat, kind: 'play', tile, end, ends: openEnds(state.line) }],
    },
    events,
  };
}
