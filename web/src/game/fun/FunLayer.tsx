import type { FunEvent, PublicPlayer } from '@domino/shared';
import { useEffect, useRef } from 'react';
import { sfx } from '../../audio/sfx';
import { onFun, useFun } from '../../net/fun';
import { THROW_ITEMS } from './items';

/**
 * Flying tomatoes, bombs, reactions and chat bubbles over the table. Drawn imperatively with the
 * Web Animations API (transform/opacity only): React doesn't re-render for any of it.
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

/** Center of a player's avatar on screen (or the top middle if it isn't visible). */
function anchor(playerId: string): { x: number; y: number; el: HTMLElement | null } {
  const el = document.querySelector<HTMLElement>(`[data-player-id="${playerId}"]`);
  if (!el) return { x: innerWidth / 2, y: 40, el: null };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
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

function launch(host: HTMLElement, e: Extract<FunEvent, { kind: 'throw' }>) {
  const item = THROW_ITEMS[e.item];
  const from = anchor(e.from);
  const to = anchor(e.to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(160, 60 + Math.hypot(dx, dy) * 0.25);
  const el = spawn(host, item.emoji, 'fun-projectile', from.x, from.y);
  sfx.whoosh();
  const flight = el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.6) rotate(0deg)', offset: 0 },
      {
        transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - lift}px)) scale(1.25) rotate(360deg)`,
        offset: 0.5,
      },
      {
        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(720deg)`,
        offset: 1,
      },
    ],
    { duration: 720, easing: 'cubic-bezier(0.3, 0.1, 0.4, 1)' },
  );
  flight.onfinish = () => {
    el.remove();
    sfx.hit(e.item);
    const boom = spawn(host, item.impact, `fun-impact impact-${e.item}`, to.x, to.y);
    boom.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 0 },
      ],
      { duration: e.item === 'bomb' ? 900 : 1100, easing: 'ease-out' },
    ).onfinish = () => boom.remove();
    if (e.item === 'tomato' || e.item === 'egg') {
      // A stain that stays on the avatar for a moment.
      const stain = spawn(host, e.item === 'tomato' ? '🍅' : '🍳', 'fun-stain', to.x, to.y);
      stain.animate(
        [
          { transform: 'translate(-50%, -50%) scale(1.4) rotate(-12deg)', opacity: 0.95 },
          {
            transform: 'translate(-50%, -40%) scale(1.25) rotate(-12deg)',
            opacity: 0.9,
            offset: 0.8,
          },
          { transform: 'translate(-50%, -20%) scale(1.2) rotate(-12deg)', opacity: 0 },
        ],
        { duration: 2600, easing: 'ease-in' },
      ).onfinish = () => stain.remove();
    }
    if (to.el) {
      const strength = e.item === 'bomb' ? 9 : e.item === 'chancla' ? 6 : 3;
      to.el.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-strength}px, ${strength / 2}px) rotate(-6deg)` },
          { transform: `translate(${strength}px, ${-strength / 2}px) rotate(5deg)` },
          { transform: `translate(${-strength / 2}px, 0) rotate(-3deg)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 450 },
      );
    }
  };
}

function react(host: HTMLElement, from: string, emoji: string) {
  const at = anchor(from);
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
  const at = anchor(from);
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
