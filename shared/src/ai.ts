/**
 * Domino AI that plays fair: it only uses what a player at the table knows — its own tiles,
 * the tiles on the table, how many tiles everyone holds and who passed on which numbers.
 *
 * Decision: "perfect-information Monte Carlo". It deals the hidden tiles many times in ways
 * that are consistent with everything seen so far (a player who passed on a 5 has no 5s),
 * plays each candidate move out to the end of the hand with a sensible playout policy for
 * all four seats, and picks the move with the best average result for its team.
 */
import {
  hasLegalMove,
  legalMoves,
  openEnds,
  type Action,
  type HandState,
  type HistoryEntry,
  type LegalMove,
  type PlacedTile,
} from './hand';
import { shuffle, type Rng } from './rng';
import { SEATS, nextSeat, partnerOf, teamOf, type Seat } from './seats';
import { fullSet, hasPip, isDouble, parseTile, pipSum, type TileId } from './tiles';

/** Everything a player legitimately knows at its turn. */
export interface Knowledge {
  seat: Seat;
  hand: TileId[];
  line: PlacedTile[];
  origin: number;
  starter: Seat;
  history: HistoryEntry[];
  /** Tiles left in each seat's hand. */
  counts: number[];
}

export interface AiOptions {
  /** Upper bound on simulated playouts per decision (spread over the candidate moves). */
  budget?: number;
}

/** Builds the knowledge of `seat` from the full state — the only place hidden info is dropped. */
export function knowledgeOf(state: HandState, seat: Seat): Knowledge {
  return {
    seat,
    hand: [...(state.hands[seat] ?? [])],
    line: state.line,
    origin: state.origin,
    starter: state.starter,
    history: state.history,
    counts: state.hands.map((h) => h.length),
  };
}

/** Numbers each seat is known NOT to hold: at a pass, it had neither open end. */
export function knownVoids(history: HistoryEntry[]): Set<number>[] {
  const voids = SEATS.map(() => new Set<number>());
  for (const h of history) {
    if (h.kind === 'pass' && h.ends) {
      voids[h.seat]?.add(h.ends[0]);
      voids[h.seat]?.add(h.ends[1]);
    }
  }
  return voids;
}

/** Tiles that could be in someone else's hand. */
export function hiddenTiles(k: Knowledge): TileId[] {
  const seen = new Set<TileId>([...k.hand, ...k.line.map((t) => t.tile)]);
  return fullSet().filter((t) => !seen.has(t));
}

/**
 * Deals the hidden tiles to the other three seats, respecting their counts and known voids.
 * If no consistent deal turns up quickly, the voids are relaxed.
 */
export function sampleHands(
  k: Knowledge,
  rng: Rng,
  voids: Set<number>[] = knownVoids(k.history),
): TileId[][] {
  const hidden = hiddenTiles(k);
  const others = SEATS.filter((s) => s !== k.seat);
  for (let attempt = 0; attempt < 30; attempt++) {
    const deal = sampleOnce(k, hidden, others, voids, rng);
    if (deal) return deal;
  }
  // Inconsistent or too constrained: ignore the voids.
  return sampleOnce(
    k,
    hidden,
    others,
    SEATS.map(() => new Set<number>()),
    rng,
  ) as TileId[][];
}

function sampleOnce(
  k: Knowledge,
  hidden: TileId[],
  others: Seat[],
  voids: Set<number>[],
  rng: Rng,
): TileId[][] | null {
  const hands: TileId[][] = SEATS.map((s) => (s === k.seat ? [...k.hand] : []));
  const room = SEATS.map((s) => (s === k.seat ? 0 : (k.counts[s] ?? 0)));
  const allowed = (tile: TileId, s: Seat) => {
    const [a, b] = parseTile(tile);
    const v = voids[s] as Set<number>;
    return !v.has(a) && !v.has(b);
  };
  // Most constrained tiles first, so the greedy deal rarely paints itself into a corner.
  const order = shuffle(hidden, rng).sort(
    (x, y) =>
      others.filter((s) => allowed(x, s)).length - others.filter((s) => allowed(y, s)).length,
  );
  for (const tile of order) {
    const options = others.filter((s) => (room[s] ?? 0) > 0 && allowed(tile, s));
    if (options.length === 0) return null;
    // Weighted by remaining room, like a real shuffle.
    const total = options.reduce<number>((sum, s) => sum + (room[s] ?? 0), 0);
    let pick = rng() * total;
    let chosen = options[0] as Seat;
    for (const s of options) {
      pick -= room[s] ?? 0;
      if (pick <= 0) {
        chosen = s;
        break;
      }
    }
    hands[chosen]?.push(tile);
    room[chosen] = (room[chosen] ?? 0) - 1;
  }
  return hands;
}

/** Quick positional judgement of a move, from the mover's point of view (no hidden info). */
function heuristic(move: LegalMove, hand: TileId[], line: PlacedTile[]): number {
  const [a, b] = parseTile(move.tile);
  let score = pipSum(move.tile) * 0.6; // get rid of heavy tiles
  if (isDouble(move.tile)) score += 4; // doubles are hard to place later
  const rest = hand.filter((t) => t !== move.tile);
  // The number this move leaves open on its end.
  const ends = openEnds(line);
  const newEnd = !ends ? b : move.end === 'left' ? (a === ends[0] ? b : a) : a === ends[1] ? b : a;
  // Keep ends you can follow.
  score += rest.filter((t) => hasPip(t, newEnd)).length * 1.5;
  // Keep a varied hand: prefer not to throw away your last tile of a number.
  for (const n of new Set([a, b])) {
    if (!rest.some((t) => hasPip(t, n))) score -= 0.8;
  }
  return score;
}

/**
 * The playouts run on plain numbers and mutate their own copy of the hands: the same rules,
 * policy and random draws as playing it with `applyHandAction`, without copying the whole hand
 * state at every move (thousands of playouts per decision).
 */
type Pair = readonly [number, number];
const PAIRS = new Map<TileId, Pair>(fullSet().map((t) => [t, parseTile(t)]));
const pairOf = (t: TileId) => PAIRS.get(t) as Pair;

const fits = (t: Pair, n: number) => t[0] === n || t[1] === n;
const BOTH_ENDS = [true, false] as const;

/** `heuristic()` for a tile already on numbers, with the table's open ends known. */
function quickHeuristic(hand: Pair[], i: number, left: boolean, l: number, r: number): number {
  const [a, b] = hand[i] as Pair;
  let score = (a + b) * 0.6;
  if (a === b) score += 4;
  const newEnd = left ? (a === l ? b : a) : a === r ? b : a;
  let follow = 0;
  let keepsA = false;
  let keepsB = false;
  for (let j = 0; j < hand.length; j++) {
    if (j === i) continue;
    const t = hand[j] as Pair;
    if (fits(t, newEnd)) follow++;
    if (fits(t, a)) keepsA = true;
    if (fits(t, b)) keepsB = true;
  }
  score += follow * 1.5;
  if (!keepsA) score -= 0.8;
  if (a !== b && !keepsB) score -= 0.8;
  return score;
}

const pips = (h: Pair[]) => h.reduce((s, t) => s + t[0] + t[1], 0);

/** The hand's result from `team`'s point of view once it is over, or null while it goes on. */
function quickResult(
  hands: Pair[][],
  mover: Seat,
  l: number,
  r: number,
  team: 0 | 1,
): number | null {
  const tp: [number, number] = [0, 0];
  if ((hands[mover] as Pair[]).length === 0) {
    SEATS.forEach((s) => (tp[teamOf(s)] += pips(hands[s] as Pair[])));
    const winner = teamOf(mover);
    const points = tp[winner === 0 ? 1 : 0];
    return winner === team ? points : -points;
  }
  if (hands.some((h) => h.some((t) => fits(t, l) || fits(t, r)))) return null;
  SEATS.forEach((s) => (tp[teamOf(s)] += pips(hands[s] as Pair[])));
  if (tp[0] === tp[1]) return 0;
  const winner = tp[0] < tp[1] ? 0 : 1;
  const points = tp[winner === 0 ? 1 : 0];
  return winner === team ? points : -points;
}

/**
 * Plays the hand to the end; returns the result from `team`'s point of view. Playout policy:
 * the heuristic with a bit of noise so simulations explore.
 */
function playout(hands: Pair[][], l: number, r: number, turn: Seat, team: 0 | 1, rng: Rng): number {
  let s = turn;
  for (let guard = 0; guard < 120; guard++) {
    const hand = hands[s] as Pair[];
    let bestI = -1;
    let bestLeft = true;
    let bestScore = -Infinity;
    // Same order as legalMoves(): each tile, its left end first.
    for (let i = 0; i < hand.length; i++) {
      const t = hand[i] as Pair;
      for (const left of BOTH_ENDS) {
        if (!fits(t, left ? l : r)) continue;
        if (hand.length === 1) {
          if (bestI < 0) {
            bestI = i;
            bestLeft = left;
          }
          continue;
        }
        const score = quickHeuristic(hand, i, left, l, r) + rng() * 2.5;
        if (score > bestScore) {
          bestScore = score;
          bestI = i;
          bestLeft = left;
        }
      }
    }
    if (bestI >= 0) {
      const [a, b] = hand[bestI] as Pair;
      if (bestLeft) l = a === l ? b : a;
      else r = a === r ? b : a;
      hand.splice(bestI, 1);
      const result = quickResult(hands, s, l, r, team);
      if (result !== null) return result;
    }
    s = nextSeat(s);
  }
  return 0;
}

/** Picks the action for the player described by `k`. */
export function chooseAction(k: Knowledge, rng: Rng, options: AiOptions = {}): Action {
  const moves = legalMoves(k.hand, k.line);
  if (moves.length === 0) return { type: 'pass' };
  // Domino if possible.
  if (k.hand.length === 1) return { type: 'play', ...(moves[0] as LegalMove) };
  // On the lead, the ends are symmetric: one candidate per tile.
  const candidates = k.line.length === 0 ? moves : dedupeSymmetric(moves, k.line);
  if (candidates.length === 1) return { type: 'play', ...(candidates[0] as LegalMove) };

  const team = teamOf(k.seat);
  const budget = options.budget ?? 1600;
  const samples = Math.max(8, Math.floor(budget / candidates.length));
  const voids = knownVoids(k.history);
  const totals = candidates.map(() => 0);

  const ends = openEnds(k.line);
  for (let i = 0; i < samples; i++) {
    const dealt = sampleHands(k, rng, voids).map((h) => h.map(pairOf));
    candidates.forEach((m, j) => {
      const hands = dealt.map((h) => h.slice());
      const mine = hands[k.seat] as Pair[];
      const at = mine.findIndex((t) => t === pairOf(m.tile));
      const [a, b] = mine[at] as Pair;
      mine.splice(at, 1);
      // Where the candidate leaves the ends (on the lead, the tile itself is both ends).
      let l = a;
      let r = b;
      if (ends) {
        l = m.end === 'left' ? (a === ends[0] ? b : a) : ends[0];
        r = m.end === 'right' ? (a === ends[1] ? b : a) : ends[1];
      }
      const over = quickResult(hands, k.seat, l, r, team);
      totals[j] = (totals[j] ?? 0) + (over ?? playout(hands, l, r, nextSeat(k.seat), team, rng));
    });
  }

  // Average outcome, with the heuristic as a small tie-breaker and a nudge not to leave
  // the partner stuck on a number they already passed on.
  const partnerVoid = voids[partnerOf(k.seat)] as Set<number>;
  let best = candidates[0] as LegalMove;
  let bestScore = -Infinity;
  candidates.forEach((m, j) => {
    let score = (totals[j] ?? 0) / samples + heuristic(m, k.hand, k.line) * 0.05;
    const after = endsAfter(m, k.line);
    if (after && partnerVoid.has(after[0]) && partnerVoid.has(after[1])) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  });
  return { type: 'play', ...best };
}

function endsAfter(m: LegalMove, line: PlacedTile[]): [number, number] | null {
  const ends = openEnds(line);
  const [a, b] = parseTile(m.tile);
  if (!ends) return [a, b];
  if (m.end === 'left') return [a === ends[0] ? b : a, ends[1]];
  return [ends[0], a === ends[1] ? b : a];
}

/** When both ends show the same number, left and right are equivalent for the game. */
function dedupeSymmetric(moves: LegalMove[], line: PlacedTile[]): LegalMove[] {
  const ends = openEnds(line);
  if (!ends || ends[0] !== ends[1]) return moves;
  const seen = new Set<TileId>();
  return moves.filter((m) => (seen.has(m.tile) ? false : (seen.add(m.tile), true)));
}

/** True if the player can move at all (the AI passes otherwise). */
export function aiMustPass(k: Knowledge): boolean {
  return !hasLegalMove(k.hand, k.line);
}
