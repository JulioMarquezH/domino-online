import type { FunEvent, PublicPlayer } from '@domino/shared';
import { useEffect, useRef } from 'react';
import { sfx } from '../../audio/sfx';
import { onFun, useFun } from '../../net/fun';
import { THROW_ITEMS } from './items';

/**
 * Things thrown at the table (and chat bubbles), drawn imperatively with the Web Animations API
 * on transform/opacity only: React doesn't re-render for any of it. Tiles get knocked around for
 * a few seconds and always glide back: only the looks change, never the game.
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

/** Center of a player's avatar on screen (or the bottom middle if it isn't visible). */
function avatarPoint(playerId: string): { x: number; y: number } {
  const el = document.querySelector<HTMLElement>(`[data-player-id="${playerId}"]`);
  if (!el) return { x: innerWidth / 2, y: innerHeight - 40 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function boardOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.board');
}

function spawn(host: HTMLElement, text: string, cls: string, x: number, y: number) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  host.appendChild(el);
  return el;
}

function fade(el: HTMLElement, frames: Keyframe[], ms: number, easing = 'ease-out') {
  el.animate(frames, { duration: ms, easing }).onfinish = () => el.remove();
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface TileInfo {
  el: HTMLElement;
  face: HTMLElement | null;
  x: number;
  y: number;
}

function tilesOnBoard(): TileInfo[] {
  return [...document.querySelectorAll<HTMLElement>('.board .board-tile')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      el,
      face: el.querySelector<HTMLElement>('.tile-svg'),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  });
}

/** Moves a tile with `translate` (screen space) and spins its face around its own center. */
function knock(
  t: TileInfo,
  moves: { dx: number; dy: number; spin: number; offset?: number }[],
  ms: number,
) {
  const frames = moves.map((m) => ({
    translate: `${m.dx}px ${m.dy}px`,
    ...(m.offset !== undefined ? { offset: m.offset } : {}),
  }));
  t.el.animate([{ translate: '0px 0px' }, ...frames, { translate: '0px 0px' }], {
    duration: ms,
    easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)',
  });
  t.face?.animate(
    [
      { rotate: '0deg' },
      ...moves.map((m) => ({
        rotate: `${m.spin}deg`,
        ...(m.offset !== undefined ? { offset: m.offset } : {}),
      })),
      { rotate: '0deg' },
    ],
    { duration: ms, easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)' },
  );
}

function shake(el: Element | null, strength: number, ms: number) {
  if (!el) return;
  const frames: Keyframe[] = [];
  for (let i = 0; i < 10; i++) {
    const k = strength * (1 - i / 10);
    frames.push({ translate: `${rand(-k, k)}px ${rand(-k, k)}px` });
  }
  frames.push({ translate: '0px 0px' });
  el.animate(frames, { duration: ms });
}

function launch(host: HTMLElement, e: Extract<FunEvent, { kind: 'throw' }>) {
  const board = boardOf();
  if (!board) return;
  const r = board.getBoundingClientRect();
  const to = { x: r.left + e.x * r.width, y: r.top + e.y * r.height };
  const from = avatarPoint(e.from);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(170, 70 + Math.hypot(dx, dy) * 0.25);
  const item = THROW_ITEMS[e.item];
  const el = spawn(host, item.emoji, 'fun-projectile', from.x, from.y);
  sfx.whoosh();
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.6) rotate(0deg)' },
      {
        transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - lift}px)) scale(1.3) rotate(360deg)`,
        offset: 0.5,
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.9) rotate(720deg)`,
      },
    ],
    { duration: 700, easing: 'cubic-bezier(0.3, 0.1, 0.4, 1)' },
  ).onfinish = () => {
    el.remove();
    sfx.hit(e.item);
    land(host, board, e.item, to);
  };
}

function land(host: HTMLElement, board: HTMLElement, item: string, at: { x: number; y: number }) {
  const r = board.getBoundingClientRect();
  const tiles = tilesOnBoard();
  const reach = Math.max(r.width, r.height) * 0.65;

  if (item === 'tomato' || item === 'egg') {
    // A stain on the felt that slowly fades; tiles nearby flinch.
    const stain = spawn(host, '', `splat splat-${item}`, at.x, at.y);
    stain.style.rotate = `${rand(0, 360)}deg`;
    fade(
      stain,
      [
        { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 1, offset: 0.04 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95, offset: 0.08 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.85, offset: 0.75 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      7000,
      'linear',
    );
    for (const t of tiles) {
      const d = Math.hypot(t.x - at.x, t.y - at.y);
      if (d > reach * 0.35) continue;
      const k = 1 - d / (reach * 0.35);
      const ux = (t.x - at.x) / (d || 1);
      const uy = (t.y - at.y) / (d || 1);
      knock(t, [{ dx: ux * 14 * k, dy: uy * 14 * k, spin: rand(-12, 12) * k, offset: 0.3 }], 600);
    }
    return;
  }

  if (item === 'bomb') {
    fade(
      spawn(host, '💥', 'fun-impact impact-bomb', at.x, at.y),
      [
        { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1.7)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 0 },
      ],
      900,
    );
    fade(
      spawn(host, '', 'shockwave', at.x, at.y),
      [
        { transform: 'translate(-50%, -50%) scale(0.1)', opacity: 0.9 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      650,
    );
    shake(board.closest('.rail'), 10, 600);
    for (const t of tiles) {
      const d = Math.hypot(t.x - at.x, t.y - at.y);
      const k = Math.max(0.15, 1 - d / reach);
      const ux = d > 1 ? (t.x - at.x) / d : rand(-1, 1);
      const uy = d > 1 ? (t.y - at.y) / d : rand(-1, 1);
      // Scaled to the felt so the mess stays visible on a phone too.
      const push = Math.min(r.width, r.height) * (0.12 + 0.42 * k);
      const spin = rand(-1, 1) * 400 * k;
      const dx = ux * push + rand(-20, 20);
      const dy = uy * push + rand(-20, 20);
      // Out with the blast, lie scattered, then glide back home.
      knock(
        t,
        [
          { dx, dy, spin, offset: 0.1 },
          { dx: dx * 1.03, dy: dy * 1.03, spin: spin * 1.05, offset: 0.68 },
        ],
        3600,
      );
    }
    return;
  }

  if (item === 'tornado') {
    fade(
      spawn(host, '🌪️', 'fun-impact impact-tornado', at.x, at.y),
      [
        { transform: 'translate(-50%, -50%) scale(0.3) rotate(0deg)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.4) rotate(-360deg)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -50%) scale(1.4) rotate(-1440deg)', opacity: 1, offset: 0.8 },
        { transform: 'translate(-50%, -50%) scale(0.4) rotate(-1800deg)', opacity: 0 },
      ],
      3200,
      'linear',
    );
    for (const t of tiles) {
      const vx = t.x - at.x;
      const vy = t.y - at.y;
      const moves: { dx: number; dy: number; spin: number; offset: number }[] = [];
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
        const turn = (i / steps) * Math.PI * 2.5;
        const squeeze = 1 - 0.45 * Math.sin((i / steps) * Math.PI);
        const nx = (vx * Math.cos(turn) - vy * Math.sin(turn)) * squeeze;
        const ny = (vx * Math.sin(turn) + vy * Math.cos(turn)) * squeeze;
        moves.push({ dx: nx - vx, dy: ny - vy, spin: i * 90, offset: 0.08 + (i / steps) * 0.72 });
      }
      knock(t, moves, 3400);
    }
    return;
  }

  // quake: the whole table trembles and every tile jitters.
  shake(board.closest('.rail'), 12, 1800);
  for (const t of tiles) {
    const moves = Array.from({ length: 9 }, (_, i) => ({
      dx: rand(-9, 9),
      dy: rand(-9, 9),
      spin: rand(-14, 14),
      offset: (i + 1) / 10,
    }));
    knock(t, moves, 1900);
  }
}

function react(host: HTMLElement, from: string, emoji: string) {
  const at = avatarPoint(from);
  for (let i = 0; i < 3; i++) {
    const el = spawn(host, emoji, 'fun-react', at.x + (i - 1) * 14, at.y);
    el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
        { transform: 'translate(-50%, -110%) scale(1.3)', opacity: 1, offset: 0.25 },
        { transform: `translate(calc(-50% + ${(i - 1) * 18}px), -320%) scale(1)`, opacity: 0 },
      ],
      { duration: 1500, delay: i * 140, easing: 'ease-out', fill: 'backwards' },
    ).onfinish = () => el.remove();
  }
}

function bubble(host: HTMLElement, from: string, name: string, text: string) {
  sfx.pop();
  const at = avatarPoint(from);
  const el = document.createElement('div');
  el.className = 'fun-bubble';
  const who = document.createElement('strong');
  who.textContent = name;
  el.append(who, document.createTextNode(` ${text}`));
  // Keep it on screen whatever side the avatar is on.
  el.style.left = `${Math.min(innerWidth - 120, Math.max(120, at.x))}px`;
  el.style.top = `${Math.max(36, at.y - 34)}px`;
  host.appendChild(el);
  el.animate(
    [
      { transform: 'translate(-50%, -100%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -100%) scale(1)', opacity: 1, offset: 0.06 },
      { transform: 'translate(-50%, -100%) scale(1)', opacity: 1, offset: 0.9 },
      { transform: 'translate(-50%, -110%) scale(0.95)', opacity: 0 },
    ],
    { duration: 4200 },
  ).onfinish = () => el.remove();
}
