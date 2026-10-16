import type { FunEvent, PublicPlayer } from '@domino/shared';
import { useEffect, useRef } from 'react';
import { sfx } from '../../audio/sfx';
import { onFun, useFun } from '../../net/fun';
import { THROW_ITEMS } from './items';

/**
 * Things thrown at the table or at a player (and chat bubbles), drawn imperatively with the Web
 * Animations API on transform/opacity: React doesn't re-render for any of it. Tiles get knocked
 * around for a few seconds and always glide back: only the looks change, never the game.
 */
export function FunLayer({ players, youId }: { players: PublicPlayer[]; youId: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const { open } = useFun();
  const ctx = useRef({ players, youId, open });
  useEffect(() => {
    ctx.current = { players, youId, open };
  });

  useEffect(
    () =>
      onFun((e) => {
        const host = layer.current;
        if (!host) return;
        const { players: ps, youId: me, open: chatOpen } = ctx.current;
        if (e.kind === 'throw') launch(host, e);
        else if (e.kind === 'react') react(host, e.from, e.emoji);
        else if (!chatOpen && e.from !== me) {
          const name = ps.find((p) => p.id === e.from)?.name ?? '';
          bubble(host, e.from, name, e.text);
        }
      }),
    [],
  );

  return <div ref={layer} className="fun-layer" aria-hidden="true" />;
}

// ───────────── helpers ─────────────

type Pt = { x: number; y: number };
const C = 'translate(-50%, -50%)';
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const at = (dx: number, dy: number) => `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

function avatarEl(playerId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.table-screen [data-player-id="${playerId}"]`);
}

function centerOf(el: Element | null, fallback: Pt): Pt {
  if (!el) return fallback;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function spawn(host: HTMLElement, cls: string, p: Pt, text = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  if (text) el.textContent = text;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  host.appendChild(el);
  return el;
}

function sized(el: HTMLElement, w: number, h = w): HTMLElement {
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  return el;
}

/** Runs the animation and removes the element when it ends. */
function play(el: HTMLElement, frames: Keyframe[], ms: number, easing = 'ease-out', delay = 0) {
  const a = el.animate(frames, { duration: ms, easing, delay, fill: 'backwards' });
  a.onfinish = () => el.remove();
  return a;
}

/** Bits flying out of an impact and falling with gravity. */
function burst(
  host: HTMLElement,
  p: Pt,
  o: {
    count: number;
    colors: string[];
    size: [number, number];
    reach: number;
    ms: number;
    up?: number;
  },
) {
  for (let i = 0; i < o.count; i++) {
    const bit = sized(spawn(host, 'fun-bit', p), rand(o.size[0], o.size[1]));
    bit.style.background = o.colors[i % o.colors.length] ?? '#fff';
    const a = (i / o.count) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = o.reach * rand(0.5, 1);
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d - (o.up ?? 0);
    play(
      bit,
      [
        { transform: `${C} scale(1)`, opacity: 1 },
        { transform: `${at(dx, dy)} scale(0.9)`, opacity: 1, offset: 0.55 },
        { transform: `${at(dx * 1.15, dy + d * 0.6)} scale(0.4)`, opacity: 0 },
      ],
      o.ms * rand(0.8, 1.1),
      'cubic-bezier(0.2, 0.7, 0.4, 1)',
    );
  }
}

/** Soft smoke puffs drifting up. */
function smoke(host: HTMLElement, p: Pt, count: number, size: number, ms: number) {
  for (let i = 0; i < count; i++) {
    const s = sized(
      spawn(host, 'fun-smoke', {
        x: p.x + rand(-size / 3, size / 3),
        y: p.y + rand(-size / 4, size / 4),
      }),
      size,
    );
    play(
      s,
      [
        { transform: `${C} scale(0.3)`, opacity: 0 },
        { transform: `${C} scale(1)`, opacity: 0.7, offset: 0.2 },
        { transform: `${at(rand(-30, 30), -size * rand(0.9, 1.6))} scale(1.8)`, opacity: 0 },
      ],
      ms * rand(0.8, 1.2),
      'ease-out',
      i * 70,
    );
  }
}

function flash(host: HTMLElement, p: Pt, size: number) {
  play(
    sized(spawn(host, 'fun-flash', p), size),
    [
      { transform: `${C} scale(0.2)`, opacity: 1 },
      { transform: `${C} scale(1)`, opacity: 0 },
    ],
    420,
  );
}

function shockwave(host: HTMLElement, p: Pt, size: number) {
  play(
    sized(spawn(host, 'fun-shockwave', p), size),
    [
      { transform: `${C} scale(0.1)`, opacity: 0.9 },
      { transform: `${C} scale(1)`, opacity: 0 },
    ],
    600,
  );
}

function big(host: HTMLElement, p: Pt, text: string, cls: string, frames: Keyframe[], ms: number) {
  play(spawn(host, `fun-big ${cls}`, p, text), frames, ms);
}

/** The splat left behind: a blob with drops around it that fades slowly. */
const MAX_TABLE_STAINS = 4;

function stain(host: HTMLElement, p: Pt, kind: string, size: number, ms: number) {
  const blob = sized(spawn(host, `fun-stain stain-${kind}`, p), size);
  // Turned inside the transform: the `rotate` property would spin it off its centre.
  const turned = `translate(-50%, -50%) rotate(${Math.round(rand(0, 360))}deg)`;
  for (let i = 0; i < 7; i++) {
    const drop = document.createElement('span');
    const a = rand(0, Math.PI * 2);
    const d = size * rand(0.45, 0.8);
    const s = size * rand(0.08, 0.18);
    drop.style.left = `${size / 2 + Math.cos(a) * d - s / 2}px`;
    drop.style.top = `${size / 2 + Math.sin(a) * d - s / 2}px`;
    drop.style.width = `${s}px`;
    drop.style.height = `${s}px`;
    blob.appendChild(drop);
  }
  play(
    blob,
    [
      { transform: `${turned} scale(0.2)`, opacity: 1 },
      { transform: `${turned} scale(1.12)`, opacity: 1, offset: 0.03 },
      { transform: `${turned} scale(1)`, opacity: 0.95, offset: 0.06 },
      { transform: `${turned} scale(1)`, opacity: 0.85, offset: 0.78 },
      { transform: `${turned} scale(1)`, opacity: 0 },
    ],
    ms,
    'linear',
  );
}

function shake(el: Element | null, strength: number, ms: number) {
  if (!el) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i < 12; i++) {
    const k = strength * (1 - i / 12);
    frames.push({ translate: `${rand(-k, k)}px ${rand(-k, k)}px` });
  }
  frames.push({ translate: '0px 0px' });
  el.animate(frames, { duration: ms });
}

interface TileOnBoard {
  el: HTMLElement;
  face: HTMLElement | null;
  x: number;
  y: number;
}

function tilesOnBoard(): TileOnBoard[] {
  return [...document.querySelectorAll<HTMLElement>('.board .board-tile')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el,
      face: el.querySelector('.tile-svg'),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  });
}

type Move = { dx: number; dy: number; spin: number; offset?: number };

/** Moves a tile (screen-space translate) and spins its face; it always ends back home. */
function knock(t: TileOnBoard, moves: Move[], ms: number) {
  const o = (m: Move) => (m.offset === undefined ? {} : { offset: m.offset });
  const timing = { duration: ms, easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)' };
  t.el.animate(
    [
      { translate: '0px 0px' },
      ...moves.map((m) => ({ translate: `${m.dx}px ${m.dy}px`, ...o(m) })),
      { translate: '0px 0px' },
    ],
    timing,
  );
  t.face?.animate(
    [
      { rotate: '0deg' },
      ...moves.map((m) => ({ rotate: `${m.spin}deg`, ...o(m) })),
      { rotate: '0deg' },
    ],
    timing,
  );
}

// ───────────── the throw ─────────────

function launch(host: HTMLElement, e: Extract<FunEvent, { kind: 'throw' }>) {
  const board = document.querySelector<HTMLElement>('.table-screen .board');
  const victim = e.to ? avatarEl(e.to) : null;
  let to: Pt;
  if (victim) {
    to = centerOf(victim, { x: innerWidth / 2, y: 60 });
  } else if (board && e.x !== undefined && e.y !== undefined) {
    const r = board.getBoundingClientRect();
    to = { x: r.left + e.x * r.width, y: r.top + e.y * r.height };
  } else {
    return;
  }
  const from = centerOf(avatarEl(e.from), { x: innerWidth / 2, y: innerHeight - 40 });
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(190, 70 + dist * 0.3);
  const ms = Math.min(900, 480 + dist * 0.5);

  // The shadow slides along the ground; the thing itself arcs above it, bigger at the top.
  play(
    spawn(host, 'fun-shadow', from),
    [
      { transform: `${C} scale(0.7)`, opacity: 0.5 },
      { transform: `${at(dx / 2, dy / 2)} scale(0.45)`, opacity: 0.25, offset: 0.5 },
      { transform: `${at(dx, dy)} scale(1)`, opacity: 0.55 },
    ],
    ms,
    'linear',
  );
  const proj = spawn(host, 'fun-projectile', from, THROW_ITEMS[e.item].emoji);
  const spin = e.item === 'tornado' ? 1080 : rand(480, 900) * (dx < 0 ? -1 : 1);
  sfx.whoosh();
  proj.animate(
    [
      { transform: `${C} scale(0.7) rotate(0deg)` },
      {
        transform: `${at(dx * 0.5, dy * 0.5 - lift)} scale(1.45) rotate(${spin / 2}deg)`,
        offset: 0.5,
      },
      { transform: `${at(dx, dy)} scale(1) rotate(${spin}deg)` },
    ],
    { duration: ms, easing: 'cubic-bezier(0.35, 0.05, 0.55, 1)' },
  ).onfinish = () => {
    proj.remove();
    sfx.hit(e.item);
    if (victim) hitPlayer(host, victim, e.item, to);
    else if (board) hitBoard(host, board, e.item, to);
  };
}

const JUICE: Record<string, string[]> = {
  tomato: ['#d9261c', '#b3150e', '#ff4a3a'],
  egg: ['#fffdf4', '#ffc52e', '#f3ead6'],
};
const FIRE = ['#ffdf6b', '#ff9a2e', '#ff5a1f', '#fff3c4'];

function boom(host: HTMLElement, p: Pt, size: number) {
  flash(host, p, size * 1.3);
  shockwave(host, p, size * 1.6);
  big(
    host,
    p,
    '💥',
    'big-boom',
    [
      { transform: `${C} scale(0.3)`, opacity: 1 },
      { transform: `${C} scale(1.5)`, opacity: 1, offset: 0.2 },
      { transform: `${C} scale(1.15)`, opacity: 0 },
    ],
    850,
  );
  burst(host, p, { count: 22, colors: FIRE, size: [3, 8], reach: size * 0.7, ms: 900, up: 30 });
  smoke(host, p, 7, size * 0.32, 1700);
}

function hitBoard(host: HTMLElement, board: HTMLElement, item: string, p: Pt) {
  const r = board.getBoundingClientRect();
  const unit = Math.min(r.width, r.height);
  const tiles = tilesOnBoard();
  const rail = board.closest('.rail');
  const grid = document.querySelector('.table-grid');

  if (item === 'tomato' || item === 'egg') {
    burst(host, p, {
      count: 14,
      colors: JUICE[item] ?? [],
      size: [5, 11],
      reach: unit * 0.28,
      ms: 650,
      up: 10,
    });
    // On the felt under the tiles, and only a few at a time: the game always stays readable.
    const felt = board.querySelector<HTMLElement>('.board-stains');
    if (felt) {
      while (felt.childElementCount >= MAX_TABLE_STAINS) felt.firstElementChild?.remove();
      stain(felt, { x: p.x - r.left, y: p.y - r.top }, item, unit * 0.3, 7500);
    }
    // The nearby tiles jump a little from the splash.
    for (const t of tiles) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d > unit * 0.45) continue;
      const k = 1 - d / (unit * 0.45);
      const ux = (t.x - p.x) / (d || 1);
      const uy = (t.y - p.y) / (d || 1);
      knock(t, [{ dx: ux * 16 * k, dy: uy * 16 * k, spin: rand(-14, 14) * k, offset: 0.25 }], 650);
    }
    return;
  }

  if (item === 'bomb') {
    boom(host, p, unit);
    shake(rail, 12, 650);
    shake(grid, 5, 500);
    const reach = Math.max(r.width, r.height) * 0.65;
    for (const t of tiles) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      const k = Math.max(0.15, 1 - d / reach);
      const ux = d > 1 ? (t.x - p.x) / d : rand(-1, 1);
      const uy = d > 1 ? (t.y - p.y) / d : rand(-1, 1);
      const push = unit * (0.12 + 0.42 * k);
      const spin = rand(-1, 1) * 420 * k;
      const mx = ux * push + rand(-16, 16);
      const my = uy * push + rand(-16, 16);
      // Out with the blast, lying scattered a moment, then gliding back home.
      knock(
        t,
        [
          { dx: mx, dy: my, spin, offset: 0.1 },
          { dx: mx * 1.04, dy: my * 1.04, spin: spin * 1.06, offset: 0.68 },
        ],
        3600,
      );
    }
    return;
  }

  if (item === 'tornado') {
    big(
      host,
      p,
      '🌪️',
      'big-tornado',
      [
        { transform: `${C} scale(0.3) rotate(0deg)`, opacity: 0 },
        { transform: `${C} scale(1.5) rotate(-360deg)`, opacity: 1, offset: 0.18 },
        { transform: `${C} scale(1.5) rotate(-1440deg)`, opacity: 1, offset: 0.8 },
        { transform: `${C} scale(0.4) rotate(-1800deg)`, opacity: 0 },
      ],
      3200,
    );
    for (let i = 0; i < 3; i++) setTimeout(() => smoke(host, p, 4, unit * 0.2, 1200), i * 700);
    for (const t of tiles) {
      const vx = t.x - p.x;
      const vy = t.y - p.y;
      const moves = Array.from({ length: 8 }, (_, j): Move => {
        const k = (j + 1) / 8;
        const turn = k * Math.PI * 2.5;
        const squeeze = 1 - 0.5 * Math.sin(k * Math.PI);
        const nx = (vx * Math.cos(turn) - vy * Math.sin(turn)) * squeeze;
        const ny = (vx * Math.sin(turn) + vy * Math.cos(turn)) * squeeze;
        return {
          dx: nx - vx,
          dy: ny - vy - 18 * Math.sin(k * Math.PI),
          spin: (j + 1) * 95,
          offset: 0.08 + k * 0.72,
        };
      });
      knock(t, moves, 3400);
    }
    return;
  }

  // Quake: everything trembles and dust rises along the felt.
  shake(rail, 13, 1900);
  shake(grid, 4, 1600);
  for (let i = 0; i < 6; i++) {
    smoke(host, { x: r.left + (r.width * (i + 0.5)) / 6, y: r.bottom - 10 }, 1, unit * 0.18, 1400);
  }
  for (const t of tiles) {
    knock(
      t,
      Array.from({ length: 9 }, (_, i) => ({
        dx: rand(-10, 10),
        dy: rand(-10, 10),
        spin: rand(-16, 16),
        offset: (i + 1) / 10,
      })),
      1900,
    );
  }
}

/** A direct hit on someone's avatar. */
function hitPlayer(host: HTMLElement, avatar: HTMLElement, item: string, p: Pt) {
  const size = avatar.getBoundingClientRect().width;
  const seat = avatar.closest('.seat-slot, .self-seat') ?? avatar;

  if (item === 'tomato' || item === 'egg') {
    burst(host, p, {
      count: 12,
      colors: JUICE[item] ?? [],
      size: [4, 9],
      reach: size * 1.1,
      ms: 600,
      up: 6,
    });
    stain(host, p, item, size * 1.15, 4500);
    // Drips running down the face.
    for (let i = 0; i < 4; i++) {
      const drip = spawn(host, `fun-drip drip-${item}`, {
        x: p.x + rand(-size / 3, size / 3),
        y: p.y + rand(0, size / 4),
      });
      play(
        drip,
        [
          { transform: `${C} scaleY(0.4)`, opacity: 0.95 },
          { transform: `${at(0, size * 0.9)} scaleY(1.4)`, opacity: 0.9, offset: 0.8 },
          { transform: `${at(0, size * 1.1)} scaleY(1)`, opacity: 0 },
        ],
        2200,
        'ease-in',
        300 + i * 180,
      );
    }
    shake(seat, 5, 400);
    return;
  }

  if (item === 'bomb') {
    boom(host, p, size * 2.6);
    shake(seat, 11, 600);
    // Left blackened for a moment.
    avatar.animate(
      [
        { filter: 'brightness(0.25) sepia(0.6)' },
        { filter: 'brightness(0.25) sepia(0.6)', offset: 0.7 },
        { filter: 'none' },
      ],
      { duration: 2600, easing: 'ease-in' },
    );
    return;
  }

  if (item === 'tornado') {
    big(
      host,
      p,
      '🌪️',
      'big-tornado-sm',
      [
        { transform: `${C} scale(0.4) rotate(0deg)`, opacity: 0 },
        { transform: `${C} scale(1.2) rotate(-720deg)`, opacity: 1, offset: 0.25 },
        { transform: `${C} scale(1.2) rotate(-1800deg)`, opacity: 1, offset: 0.8 },
        { transform: `${C} scale(0.3) rotate(-2160deg)`, opacity: 0 },
      ],
      2400,
    );
    avatar.animate(
      [
        { translate: '0 0', rotate: '0deg' },
        { translate: '0 -18px', rotate: '540deg', offset: 0.5 },
        { translate: '0 0', rotate: '1080deg' },
      ],
      { duration: 2200, easing: 'ease-in-out' },
    );
    return;
  }

  // Quake on a player: their seat rattles.
  shake(seat, 9, 1700);
  smoke(host, { x: p.x, y: p.y + size / 2 }, 3, size * 0.6, 1200);
}

// ───────────── reactions & chat ─────────────

function react(host: HTMLElement, from: string, emoji: string) {
  const p = centerOf(avatarEl(from), { x: innerWidth / 2, y: innerHeight - 40 });
  for (let i = 0; i < 3; i++) {
    play(
      spawn(host, 'fun-react', { x: p.x + (i - 1) * 14, y: p.y }, emoji),
      [
        { transform: `${C} scale(0.4)`, opacity: 0 },
        { transform: 'translate(-50%, -110%) scale(1.3)', opacity: 1, offset: 0.25 },
        { transform: `translate(calc(-50% + ${(i - 1) * 18}px), -320%) scale(1)`, opacity: 0 },
      ],
      1500,
      'ease-out',
      i * 140,
    );
  }
}

function bubble(host: HTMLElement, from: string, name: string, text: string) {
  sfx.pop();
  const p = centerOf(avatarEl(from), { x: innerWidth / 2, y: 60 });
  const el = document.createElement('div');
  el.className = 'fun-bubble';
  const who = document.createElement('strong');
  who.textContent = name;
  el.append(who, document.createTextNode(` ${text}`));
  // Keep it on screen whatever side the avatar is on.
  el.style.left = `${Math.min(innerWidth - 120, Math.max(120, p.x))}px`;
  el.style.top = `${Math.max(36, p.y - 34)}px`;
  host.appendChild(el);
  play(
    el,
    [
      { transform: 'translate(-50%, -100%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -100%) scale(1)', opacity: 1, offset: 0.06 },
      { transform: 'translate(-50%, -100%) scale(1)', opacity: 1, offset: 0.9 },
      { transform: 'translate(-50%, -110%) scale(0.95)', opacity: 0 },
    ],
    4200,
  );
}
