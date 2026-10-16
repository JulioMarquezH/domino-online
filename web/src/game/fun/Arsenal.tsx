import { THROWABLES } from '@domino/shared';
import { useEffect, useRef, useState } from 'react';
import { arm, useFun, waitFor } from '../../net/fun';
import { THROW_ITEMS } from './items';

/** The arsenal: pick something, then tap the table where you want it to land. */
export function ArsenalButton() {
  const { armed } = useFun();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const tick = setInterval(() => setNow(performance.now()), 500);
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => {
      clearInterval(tick);
      window.removeEventListener('pointerdown', close);
    };
  }, [open]);

  return (
    <div className="arsenal" ref={ref}>
      <button
        type="button"
        className={`icon-btn compact arsenal-btn ${armed || open ? 'is-on' : ''}`}
        onClick={() => {
          setNow(performance.now());
          setOpen((o) => !o);
        }}
        aria-label="Lanzar algo a la mesa"
        title="Lanzar algo a la mesa"
      >
        <span aria-hidden="true">💣</span>
      </button>
      {open && (
        <div className="arsenal-pop" role="dialog" aria-label="Lanzar algo a la mesa">
          <span className="picker-title">Lanzar a la mesa</span>
          <ul>
            {THROWABLES.map((t) => {
              const wait = waitFor(t, now);
              return (
                <li key={t}>
                  <button
                    type="button"
                    disabled={wait > 0}
                    className={armed === t ? 'armed' : ''}
                    onClick={() => {
                      arm(t);
                      setOpen(false);
                    }}
                    aria-label={`${THROW_ITEMS[t].label}: ${THROW_ITEMS[t].does}`}
                  >
                    <span className="arsenal-emoji">{THROW_ITEMS[t].emoji}</span>
                    <span className="arsenal-text">
                      <strong>{THROW_ITEMS[t].label}</strong>
                      <small>
                        {wait > 0 ? `en ${Math.ceil(wait / 1000)} s` : THROW_ITEMS[t].does}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** While something is armed: "tap the table" hint with a way out. */
export function ArmedHint() {
  const { armed } = useFun();
  if (!armed) return null;
  return (
    <div className="armed-hint" role="status">
      <span>{THROW_ITEMS[armed].emoji} Toca la mesa donde quieras lanzarlo</span>
      <button type="button" className="btn ghost small" onClick={() => arm(null)}>
        Cancelar
      </button>
    </div>
  );
}
