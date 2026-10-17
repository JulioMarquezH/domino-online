/**
 * Tiles are identified by a string "hi-lo" where hi >= lo, e.g. "6-4" or "3-3".
 * Using plain strings keeps them trivially serializable over the wire.
 */
export type TileId = string;

export const MAX_PIP = 6;

export function tileId(a: number, b: number): TileId {
  return a >= b ? `${a}-${b}` : `${b}-${a}`;
}

const TILE_RE = /^([0-6])-([0-6])$/;

export function isTileId(value: unknown): value is TileId {
  if (typeof value !== 'string') return false;
  const m = TILE_RE.exec(value);
  return m !== null && Number(m[1]) >= Number(m[2]);
}

// Parsed once per tile: the AI asks for these numbers millions of times.
const PARSED = new Map<TileId, readonly [number, number]>();

/** Returns [hi, lo]. */
export function parseTile(id: TileId): [number, number] {
  const hit = PARSED.get(id);
  if (hit) return [hit[0], hit[1]];
  const m = TILE_RE.exec(id);
  if (!m) throw new Error(`Invalid tile id: ${id}`);
  const hi = Number(m[1]);
  const lo = Number(m[2]);
  if (hi < lo) throw new Error(`Invalid tile id (not normalized): ${id}`);
  PARSED.set(id, [hi, lo]);
  return [hi, lo];
}

export function pipSum(id: TileId): number {
  const [hi, lo] = parseTile(id);
  return hi + lo;
}

export function isDouble(id: TileId): boolean {
  const [hi, lo] = parseTile(id);
  return hi === lo;
}

export function hasPip(id: TileId, pip: number): boolean {
  const [hi, lo] = parseTile(id);
  return hi === pip || lo === pip;
}

/** The value on the other side of `pip`. Assumes the tile contains `pip`. */
export function otherSide(id: TileId, pip: number): number {
  const [hi, lo] = parseTile(id);
  return hi === pip ? lo : hi;
}

export function handPips(hand: readonly TileId[]): number {
  return hand.reduce((sum, t) => sum + pipSum(t), 0);
}

/** The standard double-six set: 28 tiles. */
export function fullSet(): TileId[] {
  const tiles: TileId[] = [];
  for (let hi = 0; hi <= MAX_PIP; hi++) {
    for (let lo = 0; lo <= hi; lo++) tiles.push(tileId(hi, lo));
  }
  return tiles;
}
