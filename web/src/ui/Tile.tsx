import { memo } from 'react';

/**
 * A domino drawn as a vertical 1:2 SVG (top half / bottom half). Ivory with a faint
 * marble vein, black pips and a brass spinner. Rotation is applied by the parent.
 */

type Pt = [number, number];
const PIPS: Record<number, Pt[]> = {
  0: [],
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [25, 25],
    [50, 50],
    [75, 75],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [29, 23],
    [29, 50],
    [29, 77],
    [71, 23],
    [71, 50],
    [71, 77],
  ],
};

/** Deterministic vein per tile so every piece looks slightly different. */
function vein(seed: number): string {
  const a = 20 + ((seed * 37) % 60);
  const b = 60 + ((seed * 53) % 80);
  const c = 110 + ((seed * 29) % 70);
  return `M -5 ${a} C 30 ${a + 25}, 60 ${b - 30}, 105 ${b} M -5 ${c} C 40 ${c - 20}, 55 ${c + 30}, 105 ${c + 12}`;
}

function Half({ value, y }: { value: number; y: number }) {
  return (
    <g transform={`translate(0 ${y})`}>
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy + 1.2} r={9.6} fill="rgba(255,255,255,0.75)" />
          <circle cx={cx} cy={cy} r={9.4} fill="url(#pip-grad)" />
        </g>
      ))}
    </g>
  );
}

export const TileFace = memo(function TileFace({ top, bottom }: { top: number; bottom: number }) {
  const seed = top * 7 + bottom + 3;
  return (
    <svg className="tile-svg" viewBox="0 0 100 200" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="97" height="197" rx="13" fill="url(#ivory-grad)" />
      <path d={vein(seed)} stroke="rgba(150,128,90,0.13)" strokeWidth="1.6" fill="none" />
      <rect
        x="1.5"
        y="1.5"
        width="97"
        height="197"
        rx="13"
        fill="none"
        stroke="url(#bevel-grad)"
        strokeWidth="3"
      />
      <line x1="14" y1="100" x2="86" y2="100" stroke="#2a241b" strokeWidth="2.6" />
      <line x1="14" y1="101.8" x2="86" y2="101.8" stroke="rgba(255,255,255,0.7)" strokeWidth="1" />
      <Half value={top} y={0} />
      <Half value={bottom} y={100} />
      <circle cx="50" cy="100" r="5.2" fill="url(#brass-grad)" stroke="#6b4d17" strokeWidth="0.8" />
    </svg>
  );
});

export const TileBack = memo(function TileBack() {
  return (
    <svg className="tile-svg" viewBox="0 0 100 200" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="97" height="197" rx="13" fill="url(#back-grad)" />
      <rect
        x="10"
        y="10"
        width="80"
        height="180"
        rx="8"
        fill="none"
        stroke="rgba(214,173,92,0.55)"
        strokeWidth="1.6"
      />
      <path
        d="M50 76 L62 100 L50 124 L38 100 Z"
        fill="none"
        stroke="rgba(214,173,92,0.7)"
        strokeWidth="1.8"
      />
      <circle cx="50" cy="100" r="3.2" fill="rgba(214,173,92,0.85)" />
      <rect
        x="1.5"
        y="1.5"
        width="97"
        height="197"
        rx="13"
        fill="none"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="2"
      />
    </svg>
  );
});

/** Shared gradients, rendered once per document. */
export function TileDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="ivory-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.55" stopColor="#f5ecd8" />
          <stop offset="1" stopColor="#e6d8ba" />
        </linearGradient>
        <linearGradient id="bevel-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="0.5" stopColor="rgba(210,196,166,0.6)" />
          <stop offset="1" stopColor="rgba(120,100,70,0.75)" />
        </linearGradient>
        <radialGradient id="pip-grad" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#3b3833" />
          <stop offset="0.6" stopColor="#12110f" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <radialGradient id="brass-grad" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.45" stopColor="#d6ad5c" />
          <stop offset="1" stopColor="#7d5a1c" />
        </radialGradient>
        <linearGradient id="back-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a1c1f" />
          <stop offset="0.5" stopColor="#2f1013" />
          <stop offset="1" stopColor="#1c0709" />
        </linearGradient>
      </defs>
    </svg>
  );
}
