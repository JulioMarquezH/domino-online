import {
  BIG_THROWS,
  BIG_THROW_GAP_MS,
  THROWABLES,
  THROW_COOLDOWN_MS,
  type Throwable,
} from '@domino/shared';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { arm, throwAt, useFun, waitFor, type ThrowTarget } from '../../net/fun';
import { THROW_ITEMS } from './items';

/** What is under a screen point: another player's avatar, the table, or nothing. */
function targetAt(x: number, y: number, selfId: string): ThrowTarget | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const avatar = (el as HTMLElement).closest?.<HTMLElement>('[data-player-id]');
    const id = avatar?.dataset.playerId;
    if (id && id !== selfId && avatar.closest('.table-screen')) return { to: id };
  }
  const board = document.querySelector('.table-screen .board')?.getBoundingClientRect();
  if (board && x >= board.left && x <= board.right && y >= board.top && y <= board.bottom) {
    return { x: (x - board.left) / board.width, y: (y - board.top) / board.height };
  }
  return null;
}

function markHover(target: ThrowTarget | null) {
  document.querySelectorAll('.throw-hover').forEach((el) => el.classList.remove('throw-hover'));
  if (!target) return;
  const el =
    'to' in target
      ? document.querySelector(`.table-screen [data-player-id="${target.to}"]`)
      : document.querySelector('.table-screen .board');
  el?.classList.add('throw-hover');
}

/** The full wait of an item, for the recharge ring. */
const fullWait = (t: Throwable) =>
  Math.max(THROW_COOLDOWN_MS[t], BIG_THROWS.includes(t) ? BIG_THROW_GAP_MS : 0);

interface Drag {
  pointerId: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * One small button next to your avatar with the thing you picked. Once picked it stays: every
 * tap on another player or the table throws it. Tap the button to pick another (or none), or
 * drag it straight onto a target.
 */
export function ThrowButton({ selfId }: { selfId: string }) {
  const { armed } = useFun();
  const [now, setNow] = useState(() => performance.now());
  // Where the picker opens (the button's box), or null when closed.
  const [picking, setPicking] = useState<DOMRect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [nudge, setNudge] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  const wait = armed ? waitFor(armed, now) : 0;
  const charging = wait > 0;
  // The ring ticks only while the picked thing is recharging.
  useEffect(() => {
    if (!charging) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [charging]);

  // With something picked, a tap on another player or on the table throws it. Taps that play
  // a tile (the end targets, or the table while a tile of yours is picked) are left alone.
  useEffect(() => {
    if (!armed || picking) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      // Only what was tapped itself counts: never through the chat, the summary or a menu.
      if (!el.closest('.table-screen [data-player-id], .table-screen .board')) return;
      if (el.closest('[data-end-target]')) return;
      const target = targetAt(e.clientX, e.clientY, selfId);
      if (!target) return;
      if ('x' in target && document.querySelector('.table-screen .board [data-end-target]')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (waitFor(armed) > 0) {
        setNow(performance.now());
        setNudge((n) => n + 1);
        return;
      }
      void throwAt(armed, target).then(() => setNow(performance.now()));
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [armed, picking, selfId]);

  // The picker closes with a tap anywhere else.
  useEffect(() => {
    if (!picking) return;
    const close = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.throw-picker, .throw-btn')) setPicking(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [picking]);

  // Shakes the button when you tap while it is still recharging.
  useEffect(() => {
    if (nudge)
      btn.current?.animate(
        [
          { rotate: '0deg' },
          { rotate: '-14deg' },
          { rotate: '12deg' },
          { rotate: '-6deg' },
          { rotate: '0deg' },
        ],
        { duration: 360 },
      );
  }, [nudge]);

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = {
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
    if (moved && armed) markHover(targetAt(e.clientX, e.clientY, selfId));
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    markHover(null);
    if (cancelled) return;
    if (!d.moved || !armed) {
      const box = e.currentTarget.getBoundingClientRect();
      setPicking((p) => (p ? null : box));
      return;
    }
    const target = targetAt(e.clientX, e.clientY, selfId);
    if (!target) return;
    if (waitFor(armed) > 0) {
      setNudge((n) => n + 1);
      return;
    }
    void throwAt(armed, target).then(() => setNow(performance.now()));
  };

  const pick = (t: Throwable | null, at: number) => {
    arm(t);
    setNow(at);
    setPicking(null);
  };

  const r = picking;
  const label = armed
    ? `${THROW_ITEMS[armed].label} listo para lanzar${wait > 0 ? `, en ${Math.ceil(wait / 1000)} s` : ''}. Cambiar`
    : 'Elegir algo para lanzar';

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`throw-btn ${armed ? 'armed' : ''} ${wait > 0 ? 'charging' : ''}`}
        style={
          armed
            ? ({ '--left': `${Math.min(1, wait / fullWait(armed))}` } as CSSProperties)
            : undefined
        }
        aria-label={label}
        aria-expanded={picking !== null}
        title={label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e)}
        onPointerCancel={(e) => onUp(e, true)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="throw-emoji">{armed ? THROW_ITEMS[armed].emoji : '🎯'}</span>
        {wait > 0 && <span className="throw-wait">{Math.ceil(wait / 1000)}</span>}
      </button>
      {r &&
        createPortal(
          <div
            className="throw-picker"
            role="menu"
            aria-label="¿Qué lanzas?"
            style={{ left: Math.max(8, r.left - 4), bottom: innerHeight - r.top + 8 }}
          >
            {THROWABLES.map((t) => {
              const w = waitFor(t, now);
              return (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={armed === t}
                  className={`picker-item ${armed === t ? 'armed' : ''} ${w > 0 ? 'charging' : ''}`}
                  style={{ '--left': `${Math.min(1, w / fullWait(t))}` } as CSSProperties}
                  title={`${THROW_ITEMS[t].label}: ${THROW_ITEMS[t].does}`}
                  aria-label={THROW_ITEMS[t].label}
                  onClick={(e) => pick(t, e.timeStamp)}
                >
                  <span className="throw-emoji">{THROW_ITEMS[t].emoji}</span>
                </button>
              );
            })}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={armed === null}
              className={`picker-item picker-none ${armed === null ? 'armed' : ''}`}
              title="Nada: los toques vuelven a ser normales"
              aria-label="Nada"
              onClick={(e) => pick(null, e.timeStamp)}
            >
              ✕
            </button>
          </div>,
          document.body,
        )}
      {drag?.moved &&
        armed &&
        createPortal(
          <div className="throw-ghost" style={{ left: drag.x, top: drag.y }}>
            {THROW_ITEMS[armed].emoji}
          </div>,
          document.body,
        )}
    </>
  );
}
