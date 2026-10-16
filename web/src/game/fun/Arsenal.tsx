import {
  BIG_THROWS,
  BIG_THROW_GAP_MS,
  THROWABLES,
  THROW_COOLDOWN_MS,
  type Throwable,
} from '@domino/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { arm, setTray, throwAt, useFun, waitFor, type ThrowTarget } from '../../net/fun';
import { THROW_ITEMS } from './items';

/** 💣 in the controls: shows or hides the arsenal strip. */
export function ArsenalButton() {
  const { tray } = useFun();
  return (
    <button
      type="button"
      className={`icon-btn compact arsenal-btn ${tray ? 'is-on' : ''}`}
      onClick={() => setTray(!tray)}
      aria-pressed={tray}
      aria-label={tray ? 'Ocultar el arsenal' : 'Mostrar el arsenal'}
      title="Arsenal"
    >
      <span aria-hidden="true">💣</span>
    </button>
  );
}

/** What is under a screen point: another player's avatar, the table, or nothing. */
function targetAt(x: number, y: number, selfId: string): ThrowTarget | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const avatar = (el as HTMLElement).closest?.<HTMLElement>('[data-player-id]');
    const id = avatar?.dataset.playerId;
    if (id && id !== selfId && avatar.closest('.table-screen')) return { to: id };
  }
  const board = document.querySelector('.board')?.getBoundingClientRect();
  if (board && x >= board.left && x <= board.right && y >= board.top && y <= board.bottom) {
    return { x: (x - board.left) / board.width, y: (y - board.top) / board.height };
  }
  return null;
}

function markHover(target: ThrowTarget | null) {
  document.querySelectorAll('.throw-hover').forEach((el) => el.classList.remove('throw-hover'));
  if (!target) return;
  if ('to' in target) {
    document
      .querySelector(`.table-screen [data-player-id="${target.to}"]`)
      ?.classList.add('throw-hover');
  } else {
    document.querySelector('.board')?.classList.add('throw-hover');
  }
}

const CORNERS = ['bl', 'br', 'tr', 'tl'] as const;
type Corner = (typeof CORNERS)[number];
const GAP = 10;

/**
 * The corner of the table where the tray covers the fewest tiles (ends you can play on count
 * the most), so it never hides the game.
 */
function freeCorner(tray: HTMLElement): Corner {
  const rail = tray.offsetParent?.getBoundingClientRect();
  if (!rail) return 'bl';
  const w = tray.offsetWidth;
  const h = tray.offsetHeight;
  const things = [
    ...[...document.querySelectorAll('.table-screen .board .board-tile')].map((el) => ({
      r: el.getBoundingClientRect(),
      weight: 1,
    })),
    ...[...document.querySelectorAll('.table-screen .board [data-end-target]')].map((el) => ({
      r: el.getBoundingClientRect(),
      weight: 10,
    })),
  ];
  let best: Corner = 'bl';
  let bestCost = Infinity;
  for (const c of CORNERS) {
    const left = c.endsWith('l') ? rail.left + GAP : rail.right - GAP - w;
    const top = c.startsWith('t') ? rail.top + GAP : rail.bottom - GAP - h;
    const cost = things.reduce(
      (sum, { r, weight }) =>
        r.right > left && r.left < left + w && r.bottom > top && r.top < top + h
          ? sum + weight
          : sum,
      0,
    );
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
    if (cost === 0) break;
  }
  return best;
}

interface Drag {
  item: Throwable;
  pointerId: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * The arsenal strip at a corner of the table. One gesture: drag a thing onto a player or any
 * point of the table and let go. Or tap it, then tap where it goes.
 */
export function ThrowTray({ selfId }: { selfId: string }) {
  const { tray, armed } = useFun();
  const [now, setNow] = useState(() => performance.now());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Corner>('bl');

  // Moves out of the way whenever the tiles on the table change (or the screen does).
  useLayoutEffect(() => {
    const tray = trayRef.current;
    const board = document.querySelector('.table-screen .board');
    if (!tray || !board) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCorner(freeCorner(tray)));
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(board, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [tray]);

  // Recharge rings tick only while something is recharging.
  const anyWaiting = THROWABLES.some((t) => waitFor(t, now) > 0);
  useEffect(() => {
    if (!tray) return;
    const id = setInterval(() => setNow(performance.now()), anyWaiting ? 250 : 1000);
    return () => clearInterval(id);
  }, [tray, anyWaiting]);

  // Armed by a tap: the next tap on a player or the table throws it (and nothing else happens).
  useEffect(() => {
    if (!armed) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('.throw-tray')) return;
      e.preventDefault();
      e.stopPropagation();
      const target = targetAt(e.clientX, e.clientY, selfId);
      if (target) void throwAt(armed, target);
      else arm(null);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [armed, selfId]);

  if (!tray) return null;

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, item: Throwable) => {
    if (waitFor(item) > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = {
      item,
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    dragRef.current = d;
    setDrag(d);
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 10;
    const next = { ...d, x: e.clientX, y: e.clientY, moved };
    dragRef.current = next;
    setDrag(next);
    if (moved) markHover(targetAt(e.clientX, e.clientY, selfId));
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    markHover(null);
    if (cancelled) return;
    if (!d.moved) {
      arm(armed === d.item ? null : d.item);
      return;
    }
    const target = targetAt(e.clientX, e.clientY, selfId);
    if (target) void throwAt(d.item, target);
  };

  return (
    <div
      ref={trayRef}
      className={`throw-tray at-${corner}`}
      role="toolbar"
      aria-label="Arsenal: arrastra a un jugador o a la mesa"
    >
      {THROWABLES.map((t) => {
        const wait = waitFor(t, now);
        const full = Math.max(THROW_COOLDOWN_MS[t], BIG_THROWS.includes(t) ? BIG_THROW_GAP_MS : 0);
        return (
          <button
            key={t}
            type="button"
            className={`tray-item ${armed === t ? 'armed' : ''} ${wait > 0 ? 'charging' : ''}`}
            style={{ '--left': `${Math.min(1, wait / Math.max(full, wait, 1))}` } as CSSProperties}
            aria-label={`${THROW_ITEMS[t].label}${wait > 0 ? `, listo en ${Math.ceil(wait / 1000)} s` : ''}`}
            title={THROW_ITEMS[t].label}
            disabled={wait > 0}
            onPointerDown={(e) => onDown(e, t)}
            onPointerMove={onMove}
            onPointerUp={(e) => onUp(e)}
            onPointerCancel={(e) => onUp(e, true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="tray-emoji">{THROW_ITEMS[t].emoji}</span>
            {wait > 0 && <span className="tray-wait">{Math.ceil(wait / 1000)}</span>}
          </button>
        );
      })}
      {armed && (
        <div className="armed-hint" role="status">
          <span>Toca a un jugador o la mesa</span>
          <button type="button" className="btn ghost small" onClick={() => arm(null)}>
            Cancelar
          </button>
        </div>
      )}
      {drag?.moved &&
        createPortal(
          <div className="throw-ghost" style={{ left: drag.x, top: drag.y }}>
            {THROW_ITEMS[drag.item].emoji}
          </div>,
          document.body,
        )}
    </div>
  );
}
