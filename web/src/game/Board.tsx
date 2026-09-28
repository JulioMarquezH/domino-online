import { type End, type PlacedTile, type ScreenPosition, type Seat } from '@domino/shared';
import { useMemo, type CSSProperties } from 'react';
import { useElementSize } from '../ui/hooks';
import { TileFace } from '../ui/Tile';
import { chooseLimit, layoutSnake } from './layout';

interface Props {
  line: PlacedTile[];
  origin: number;
  showTargets: boolean;
  hoverEnd: End | null;
  onTarget: (end: End) => void;
  /** A tap on the felt (not on a target), in client coordinates. */
  onBoardTap: (x: number, y: number) => void;
  positionOf: (seat: Seat) => ScreenPosition;
}

const ENTER_FROM: Record<ScreenPosition, [number, number]> = {
  bottom: [0, 240],
  top: [0, -240],
  left: [-280, 0],
  right: [280, 0],
};

/** The felt with the snake of played tiles, auto-scaled to always fit. */
export function Board({
  line,
  origin,
  showTargets,
  hoverEnd,
  onTarget,
  onBoardTap,
  positionOf,
}: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  // Row width depends only on the board's shape, so tiles never jump during a hand.
  const qw = Math.round(size.w / 16);
  const qh = Math.round(size.h / 16);
  const limit = useMemo(() => (qw && qh ? chooseLimit(qw * 16, qh * 16) : 8), [qw, qh]);
  const layout = useMemo(() => layoutSnake({ line, origin }, limit), [line, origin, limit]);

  const b = layout.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const maxUnit = Math.min(size.h / 5.2, size.w / 9, 46);
  const unit = Math.max(4, Math.min(maxUnit, size.w / (bw + 1), size.h / (bh + 1)));
  const ox = size.w / 2 - ((b.minX + b.maxX) / 2) * unit;
  const oy = size.h / 2 - ((b.minY + b.maxY) / 2) * unit;
  const seatByTile = new Map(line.map((t) => [t.tile, t.seat]));

  const boxStyle = (cx: number, cy: number, angle: number): CSSProperties => ({
    width: unit,
    height: unit * 2,
    transform: `translate(${ox + cx * unit - unit / 2}px, ${oy + cy * unit - unit}px) rotate(${angle}deg)`,
  });

  return (
    <div
      className="board"
      ref={ref}
      data-unit={unit.toFixed(1)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('[data-end-target]'))
          onBoardTap(e.clientX, e.clientY);
      }}
    >
      <div className="snake-layer">
        {size.w > 0 &&
          layout.tiles.map((t) => {
            const seat = seatByTile.get(t.key);
            // Every tile flies in from the player who placed it when it first appears.
            const from = seat !== undefined ? ENTER_FROM[positionOf(seat)] : null;
            return (
              <div
                key={t.key}
                className="board-tile entering"
                style={
                  {
                    ...boxStyle(t.cx, t.cy, t.angle),
                    '--fx': from ? `${from[0]}px` : '0px',
                    '--fy': from ? `${from[1]}px` : '0px',
                  } as CSSProperties
                }
                data-tile={t.key}
              >
                <TileFace top={t.top} bottom={t.bottom} />
              </div>
            );
          })}
      </div>
      {size.w > 0 &&
        showTargets &&
        layout.targets.map((t) => {
          const ends =
            line.length === 0
              ? null
              : t.end === 'left'
                ? line[0]?.left
                : line[line.length - 1]?.right;
          return (
            <button
              key={t.end}
              type="button"
              className={`end-target ${hoverEnd === t.end ? 'hover' : ''}`}
              style={boxStyle(t.cx, t.cy, t.angle)}
              onClick={(e) => {
                e.stopPropagation();
                onTarget(t.end);
              }}
              data-end-target={t.end}
              data-pip={ends ?? ''}
              aria-label={
                line.length === 0
                  ? 'Jugar aquí'
                  : `Jugar en el extremo ${t.end === 'left' ? 'izquierdo' : 'derecho'} (${ends})`
              }
            />
          );
        })}
    </div>
  );
}
