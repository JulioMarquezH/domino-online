import { parseTile, pipSum, type TileId } from './tiles';
import type { Seat } from './seats';

/**
 * House rule for the starter draw: the higher pip SUM wins; on equal sums the tile with the
 * higher single side wins (6-1 beats 5-2). With unique tiles this is a strict total order.
 * Returns a positive number when `a` ranks above `b`.
 */
export function compareDrawTiles(a: TileId, b: TileId): number {
  const bySum = pipSum(a) - pipSum(b);
  if (bySum !== 0) return bySum;
  return parseTile(a)[0] - parseTile(b)[0];
}

export interface DrawPick<P> {
  player: P;
  tile: TileId;
}

/** Picks sorted from highest to lowest tile. */
export function rankDrawPicks<P>(picks: readonly DrawPick<P>[]): DrawPick<P>[] {
  return picks.slice().sort((x, y) => compareDrawTiles(y.tile, x.tile));
}

export interface SortearResult<P> {
  /** Seat assigned to each player. */
  seats: Map<P, Seat>;
  /** Seat of the owner of the highest tile, who leads the first hand. */
  starter: Seat;
}

/**
 * "Sortear" mode: the two highest tiles become partners, the two lowest the other team.
 * Seats are arranged so partners face each other: highest → seat 0 (starts),
 * second → seat 2 (its partner), third → seat 1, lowest → seat 3.
 */
export function assignSortearSeats<P>(picks: readonly DrawPick<P>[]): SortearResult<P> {
  if (picks.length !== 4) throw new Error('The draw needs exactly 4 picks');
  const ranked = rankDrawPicks(picks);
  const order: Seat[] = [0, 2, 1, 3];
  const seats = new Map<P, Seat>();
  ranked.forEach((pick, i) => seats.set(pick.player, order[i] as Seat));
  return { seats, starter: 0 };
}

/** "Manual" mode (or a rematch keeping teams): the draw only decides who leads. */
export function drawStarter(picks: readonly DrawPick<Seat>[]): Seat {
  if (picks.length === 0) throw new Error('No picks');
  return (rankDrawPicks(picks)[0] as DrawPick<Seat>).player;
}
