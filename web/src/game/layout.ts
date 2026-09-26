import { isDouble, type End, type PlacedTile } from '@domino/shared';

/**
 * Snake layout for the line of played tiles, in abstract units where a tile is 1 × 2.
 * The lead tile sits at the origin. The right arm grows rightwards and, at the edge, turns
 * DOWN and comes back; the left arm grows leftwards and turns UP. Doubles lie crosswise.
 * Each tile is described as a vertical 1 × 2 tile (top pip / bottom pip) rotated by `angle`.
 */

export type Angle = 0 | 90 | 180 | 270;

export interface TileBox {
  key: string;
  cx: number;
  cy: number;
  /** Axis-aligned size after rotation. */
  w: number;
  h: number;
  angle: Angle;
  top: number;
  bottom: number;
}

export interface EndTarget {
  end: End;
  cx: number;
  cy: number;
  angle: Angle;
  w: number;
  h: number;
}

export interface SnakeLayout {
  tiles: TileBox[];
  targets: EndTarget[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Piece {
  key: string;
  double: boolean;
  /** Pip facing back toward the lead tile, and the one facing outward. */
  near: number;
  far: number;
}

interface Cursor {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Horizontal direction of the current (or last) row: +1 right, -1 left. */
  h: 1 | -1;
  /** Which way this arm turns at an edge: +1 down, -1 up. */
  v: 1 | -1;
}

/** Rotation that makes the tile's top (its near pip) point back against the flow. */
function angleFor(dx: number, dy: number): Angle {
  if (dx > 0) return 270;
  if (dx < 0) return 90;
  if (dy > 0) return 0;
  return 180;
}

function place(c: Cursor, piece: Piece): TileBox {
  const len = piece.double ? 1 : 2;
  const cx = c.x + (c.dx * len) / 2;
  const cy = c.y + (c.dy * len) / 2;
  c.x += c.dx * len;
  c.y += c.dy * len;
  const horizontalFlow = c.dx !== 0;
  if (piece.double) {
    // Crosswise: perpendicular to the flow.
    return {
      key: piece.key,
      cx,
      cy,
      w: horizontalFlow ? 1 : 2,
      h: horizontalFlow ? 2 : 1,
      angle: horizontalFlow ? 0 : 90,
      top: piece.near,
      bottom: piece.far,
    };
  }
  return {
    key: piece.key,
    cx,
    cy,
    w: horizontalFlow ? 2 : 1,
    h: horizontalFlow ? 1 : 2,
    angle: angleFor(c.dx, c.dy),
    top: piece.near,
    bottom: piece.far,
  };
}

/** Advances one tile, turning at the edge when needed. Mutates the cursor. */
function step(c: Cursor, piece: Piece, limit: number): TileBox {
  if (c.dx !== 0) {
    const len = piece.double ? 1 : 2;
    const fits = c.dx > 0 ? c.x + len <= limit : c.x - len >= -limit;
    // Never turn on a double: it stays crosswise in the row (it's only 1 unit long).
    if (!fits && !piece.double) {
      // Corner: the tile hangs vertically beside the row's end.
      c.x += c.dx * 0.5;
      c.y -= c.v * 0.5;
      c.dx = 0;
      c.dy = c.v;
    }
    return place(c, piece);
  }
  // In a vertical stretch: turn back into a row unless this is a double (which would
  // collide with the corner tile), in which case it continues the vertical stretch.
  if (!piece.double) {
    c.x += c.h * 0.5;
    c.y += c.v * 0.5;
    c.h = c.h === 1 ? -1 : 1;
    c.dx = c.h;
    c.dy = 0;
  }
  return place(c, piece);
}

const PLACEHOLDER = (key: string): Piece => ({ key, double: false, near: -1, far: -1 });

export interface LayoutInput {
  line: readonly Pick<PlacedTile, 'tile' | 'left' | 'right'>[];
  origin: number;
}

export function layoutSnake(input: LayoutInput, limit: number): SnakeLayout {
  const { line, origin } = input;
  const tiles: TileBox[] = [];
  const lead = line[origin];
  if (!lead) {
    const target: EndTarget = { end: 'left', cx: 0, cy: 0, angle: 270, w: 2, h: 1 };
    return { tiles, targets: [target], bounds: { minX: -1, minY: -0.5, maxX: 1, maxY: 0.5 } };
  }
  const leadDouble = isDouble(lead.tile);
  const leadW = leadDouble ? 1 : 2;
  tiles.push({
    key: lead.tile,
    cx: 0,
    cy: 0,
    w: leadW,
    h: leadDouble ? 2 : 1,
    angle: leadDouble ? 0 : 270,
    top: lead.left,
    bottom: lead.right,
  });

  const right: Cursor = { x: leadW / 2, y: 0, dx: 1, dy: 0, h: 1, v: 1 };
  for (let i = origin + 1; i < line.length; i++) {
    const t = line[i] as PlacedTile;
    tiles.push(
      step(right, { key: t.tile, double: isDouble(t.tile), near: t.left, far: t.right }, limit),
    );
  }
  const left: Cursor = { x: -leadW / 2, y: 0, dx: -1, dy: 0, h: -1, v: -1 };
  for (let i = origin - 1; i >= 0; i--) {
    const t = line[i] as PlacedTile;
    tiles.push(
      step(left, { key: t.tile, double: isDouble(t.tile), near: t.right, far: t.left }, limit),
    );
  }

  // Where the next tile would go at each end.
  const targets: EndTarget[] = (
    [
      ['left', left],
      ['right', right],
    ] as const
  ).map(([end, c]) => {
    const box = step({ ...c }, PLACEHOLDER(end), limit);
    return { end, cx: box.cx, cy: box.cy, angle: box.angle, w: box.w, h: box.h };
  });

  return { tiles, targets, bounds: boundsOf([...tiles, ...targets]) };
}

function boundsOf(boxes: { cx: number; cy: number; w: number; h: number }[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.cx - b.w / 2);
    maxX = Math.max(maxX, b.cx + b.w / 2);
    minY = Math.min(minY, b.cy - b.h / 2);
    maxY = Math.max(maxY, b.cy + b.h / 2);
  }
  return { minX, minY, maxX, maxY };
}

/** Synthetic worst-case lines (28 non-doubles, lead at different positions). */
function worstCases(): LayoutInput[] {
  const line = Array.from({ length: 28 }, (_, i) => ({ tile: `x${i}`, left: 0, right: 0 }));
  return [0, 4, 9, 14, 19, 23, 27].map((origin) => ({ line, origin }));
}

// isDouble() would throw on the synthetic ids above, so the planner uses its own copy.
function layoutPlain(input: LayoutInput, limit: number) {
  const pieces = input.line.map((t) => ({ key: t.tile, double: false, near: 0, far: 0 }));
  const boxes: TileBox[] = [
    { key: 'lead', cx: 0, cy: 0, w: 2, h: 1, angle: 270, top: 0, bottom: 0 },
  ];
  const r: Cursor = { x: 1, y: 0, dx: 1, dy: 0, h: 1, v: 1 };
  for (let i = input.origin + 1; i < pieces.length; i++)
    boxes.push(step(r, pieces[i] as Piece, limit));
  const l: Cursor = { x: -1, y: 0, dx: -1, dy: 0, h: -1, v: -1 };
  for (let i = input.origin - 1; i >= 0; i--) boxes.push(step(l, pieces[i] as Piece, limit));
  return boundsOf(boxes);
}

/**
 * Picks the row half-width (in units) that lets a full 28-tile line fit the board with the
 * biggest tiles, for the board's aspect ratio. Fixed for the whole hand so tiles never jump.
 */
export function chooseLimit(boardW: number, boardH: number): number {
  let best = 6;
  let bestUnit = 0;
  for (let limit = 4; limit <= 24; limit++) {
    let unit = Infinity;
    for (const input of worstCases()) {
      const b = layoutPlain(input, limit);
      unit = Math.min(unit, boardW / (b.maxX - b.minX + 1), boardH / (b.maxY - b.minY + 1));
    }
    if (unit > bestUnit) {
      bestUnit = unit;
      best = limit;
    }
  }
  return best;
}
