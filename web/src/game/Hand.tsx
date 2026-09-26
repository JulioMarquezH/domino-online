import { parseTile, type End, type TileId } from '@domino/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { TileFace } from '../ui/Tile';

interface Props {
  tiles: TileId[];
  selected: TileId | null;
  shake: { tile: TileId; n: number } | null;
  dealKey: number;
  myTurn: boolean;
  onSelect: (tile: TileId | null) => void;
  onDrop: (tile: TileId, end: End) => void;
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

/** Your tiles: tap to select, or drag onto an end. Nothing hints which ones are playable. */
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

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, tile: TileId) => {
    if (e.button !== 0 || dragRef.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
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
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
    const next = { ...d, x: e.clientX, y: e.clientY, active: d.active || moved };
    dragRef.current = next;
    setDrag(next);
    if (next.active) {
      const hover = endAt(e.clientX, e.clientY);
      if (!d.active || hover !== hoverRef.current) {
        hoverRef.current = hover;
        onDragChange(next.tile, hover);
      }
    }
  };

  const finish = (e: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);
    hoverRef.current = null;
    onDragChange(null, null);
    if (!d.active) {
      if (!cancelled) onSelect(selected === d.tile ? null : d.tile);
      return;
    }
    const end = cancelled ? null : endAt(e.clientX, e.clientY);
    if (end) onDrop(d.tile, end);
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
            onPointerMove={onPointerMove}
            onPointerUp={(e) => finish(e, false)}
            onPointerCancel={(e) => finish(e, true)}
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
