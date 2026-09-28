import { parseTile, type End, type TileId } from '@domino/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { TileFace } from '../ui/Tile';

/** Where a dragged tile was released: on an end target, or anywhere on the board. */
export type DropSpot = { kind: 'end'; end: End } | { kind: 'board'; x: number; y: number };

interface Props {
  tiles: TileId[];
  selected: TileId | null;
  shake: { tile: TileId; n: number } | null;
  dealKey: number;
  myTurn: boolean;
  onSelect: (tile: TileId | null) => void;
  onDrop: (tile: TileId, spot: DropSpot) => void;
  onDragChange: (dragging: TileId | null, hover: End | null) => void;
}

interface Drag {
  tile: TileId;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  w: number;
  h: number;
}

const DRAG_THRESHOLD = 8;
const HIT_SLOP = 28;

/** Which drop target (if any) is under the pointer, with generous slop for fingers. */
function endAt(x: number, y: number): End | null {
  let best: { end: End; d: number } | null = null;
  document.querySelectorAll<HTMLElement>('[data-end-target]').forEach((el) => {
    const r = el.getBoundingClientRect();
    const inside =
      x >= r.left - HIT_SLOP &&
      x <= r.right + HIT_SLOP &&
      y >= r.top - HIT_SLOP &&
      y <= r.bottom + HIT_SLOP;
    if (!inside) return;
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (!best || d < best.d) best = { end: el.dataset.endTarget as End, d };
  });
  return (best as { end: End; d: number } | null)?.end ?? null;
}

function overBoard(x: number, y: number): boolean {
  const board = document.querySelector('.board');
  if (!board) return false;
  const r = board.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * Your tiles: tap to select, or drag onto the table. Nothing hints which ones are playable.
 * Drags are tracked with window listeners attached on pointerdown, so a lost pointerup
 * (browser gesture, element re-render…) can never leave the hand stuck.
 */
export function Hand({
  tiles,
  selected,
  shake,
  dealKey,
  myTurn,
  onSelect,
  onDrop,
  onDragChange,
}: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<End | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const props = useRef({ selected, onSelect, onDrop, onDragChange });

  useEffect(() => {
    props.current = { selected, onSelect, onDrop, onDragChange };
  });

  // Never leave listeners behind.
  useEffect(() => () => detachRef.current?.(), []);

  const end = (x: number | null, y: number | null, cancelled: boolean) => {
    const d = dragRef.current;
    detachRef.current?.();
    detachRef.current = null;
    dragRef.current = null;
    hoverRef.current = null;
    setDrag(null);
    if (!d) return;
    const p = props.current;
    if (d.active) p.onDragChange(null, null);
    if (cancelled || x === null || y === null) return;
    if (!d.active) {
      p.onSelect(p.selected === d.tile ? null : d.tile);
      return;
    }
    const target = endAt(x, y);
    if (target) p.onDrop(d.tile, { kind: 'end', end: target });
    else if (overBoard(x, y)) p.onDrop(d.tile, { kind: 'board', x, y });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, tile: TileId) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A previous gesture that never finished is discarded instead of blocking the hand.
    if (dragRef.current) end(null, null, true);
    const r = e.currentTarget.getBoundingClientRect();
    const d: Drag = {
      tile,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      w: r.width,
      h: r.height,
    };
    dragRef.current = d;
    setDrag(d);

    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      const moved = Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) > DRAG_THRESHOLD;
      const next = { ...cur, x: ev.clientX, y: ev.clientY, active: cur.active || moved };
      dragRef.current = next;
      setDrag(next);
      if (next.active) {
        const hover = endAt(ev.clientX, ev.clientY);
        if (!cur.active || hover !== hoverRef.current) {
          hoverRef.current = hover;
          props.current.onDragChange(next.tile, hover);
        }
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === dragRef.current?.pointerId) end(ev.clientX, ev.clientY, false);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === dragRef.current?.pointerId) end(null, null, true);
    };
    const blur = () => end(null, null, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
    };
  };

  return (
    <div className={`hand ${myTurn ? 'my-turn' : ''}`} role="group" aria-label="Tus fichas">
      {tiles.map((tile, i) => {
        const [hi, lo] = parseTile(tile);
        const dragging = drag?.active && drag.tile === tile;
        return (
          <button
            key={`${dealKey}:${tile}`}
            type="button"
            className={[
              'hand-tile',
              selected === tile ? 'selected' : '',
              dragging ? 'dragging' : '',
              shake?.tile === tile ? `shake shake-${shake.n % 2}` : '',
            ].join(' ')}
            style={{ animationDelay: `${i * 70}ms` }}
            data-tile={tile}
            aria-pressed={selected === tile}
            aria-label={`Ficha ${hi} ${lo}`}
            onPointerDown={(e) => onPointerDown(e, tile)}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(selected === tile ? null : tile);
              }
            }}
          >
            <TileFace top={hi} bottom={lo} />
          </button>
        );
      })}
      {drag?.active &&
        createPortal(
          <div
            className="drag-ghost"
            style={{
              width: drag.w,
              height: drag.h,
              transform: `translate(${drag.x - drag.w / 2}px, ${drag.y - drag.h / 2}px) rotate(-6deg)`,
            }}
          >
            <TileFace top={parseTile(drag.tile)[0]} bottom={parseTile(drag.tile)[1]} />
          </div>,
          document.body,
        )}
    </div>
  );
}
