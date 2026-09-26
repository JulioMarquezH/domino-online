import {
  DRAW_POSITIONS,
  parseTile,
  partnerOf,
  pipSum,
  teamOf,
  type RoomView,
} from '@domino/shared';
import { useState } from 'react';
import { unlockAudio } from '../audio/context';
import { sfx } from '../audio/sfx';
import { actions } from '../net/client';
import { Avatar } from '../ui/Avatar';
import { tryLandscape } from '../ui/landscape';
import { TileBack, TileFace } from '../ui/Tile';
import { derive } from './derive';

/** Stable pseudo-random jitter so the face-down pile looks hand-shuffled. */
function jitter(i: number) {
  const r = (n: number) => (((i + 1) * n) % 97) / 97 - 0.5;
  return { rot: r(61) * 26, dx: r(37) * 10, dy: r(53) * 10 };
}

export function DrawScreen({ view }: { view: RoomView }) {
  const draw = view.draw;
  const d = derive(view);
  const [pending, setPending] = useState<number | null>(null);
  if (!draw) return null;
  const byPosition = new Map(draw.picks.map((p) => [p.position, p]));
  const myPick = draw.picks.find((p) => p.playerId === view.youId);
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const outcome = draw.outcome;

  const pick = async (position: number) => {
    unlockAudio();
    void tryLandscape();
    if (myPick || pending !== null || byPosition.has(position) || view.pause.length > 0) return;
    setPending(position);
    const res = await actions.pick(position);
    if (res.ok) sfx.tile();
    setPending(null);
  };

  return (
    <div className="screen draw-screen felt game-screen">
      <header className="draw-head">
        <h1 className="title">{outcome ? 'Así quedó el sorteo' : 'Levanten una ficha'}</h1>
        <p className="muted">
          {draw.mode === 'sortear'
            ? 'La ficha más alta sale y las dos más altas van en pareja.'
            : 'La ficha más alta sale. Las parejas no cambian.'}{' '}
          <span className="rule-note">Gana la mayor suma; si empatan, el lado más alto.</span>
        </p>
      </header>

      <div className="draw-body">
        <div className={`draw-grid ${myPick ? 'picked' : ''}`}>
          {Array.from({ length: DRAW_POSITIONS }, (_, i) => {
            const pickAt = byPosition.get(i);
            const j = jitter(i);
            const [hi, lo] = pickAt ? parseTile(pickAt.tile) : [0, 0];
            const mine = pickAt?.playerId === view.youId;
            return (
              <button
                key={i}
                type="button"
                className={`draw-slot ${pickAt ? 'revealed' : ''} ${mine ? 'mine' : ''} ${pending === i ? 'pending' : ''}`}
                style={{ transform: `translate(${j.dx}px, ${j.dy}px) rotate(${j.rot}deg)` }}
                onClick={() => void pick(i)}
                disabled={Boolean(pickAt) || Boolean(myPick)}
                aria-label={
                  pickAt
                    ? `Ficha ${hi}-${lo} de ${names.get(pickAt.playerId) ?? ''}`
                    : `Ficha boca abajo ${i + 1}`
                }
                data-draw-slot={i}
              >
                <span className="flip">
                  <span className="flip-face flip-back">
                    <TileBack />
                  </span>
                  <span className="flip-face flip-front">
                    <TileFace top={hi} bottom={lo} />
                  </span>
                </span>
                {pickAt && <span className="draw-name">{names.get(pickAt.playerId)}</span>}
              </button>
            );
          })}
        </div>

        <aside className="draw-side">
          {!outcome ? (
            <ul className="draw-players">
              {view.players.map((p) => {
                const pk = draw.picks.find((x) => x.playerId === p.id);
                return (
                  <li key={p.id}>
                    <Avatar player={p} team={null} isSelf={p.id === view.youId} size="sm" />
                    <span className="name">{p.id === view.youId ? 'Tú' : p.name}</span>
                    <span className="state">
                      {pk ? `${pk.tile.replace('-', ' | ')}` : 'eligiendo…'}
                    </span>
                  </li>
                );
              })}
              {!myPick && <li className="your-move">Toca una ficha</li>}
            </ul>
          ) : (
            <div className="draw-outcome">
              <ol className="ranking">
                {outcome.ranking.map((id, idx) => {
                  const pk = draw.picks.find((x) => x.playerId === id);
                  const seat = outcome.seats[id];
                  const team = seat !== undefined ? teamOf(seat) : null;
                  return (
                    <li key={id} className={team !== null ? `team-${team}` : ''}>
                      <span className="rank">{idx + 1}º</span>
                      <span className="name">{id === view.youId ? 'Tú' : names.get(id)}</span>
                      <span className="pips">{pk?.tile.replace('-', ' | ')}</span>
                      <span className="sum" title="Suma">
                        {pk ? pipSum(pk.tile) : ''}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="starter-line">
                Sale{' '}
                <strong>
                  {outcome.starterId === view.youId ? 'tú' : names.get(outcome.starterId)}
                </strong>
              </p>
              {draw.mode === 'sortear' && d.mySeat !== null && (
                <p className="muted">
                  Tu pareja: <strong>{d.nameAt(partnerOf(d.mySeat))}</strong>
                </p>
              )}
              <p className="muted small">Repartiendo…</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
