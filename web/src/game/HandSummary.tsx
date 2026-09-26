import {
  SEATS,
  handPips,
  parseTile,
  type HandResultView,
  type RoomView,
  type Seat,
} from '@domino/shared';
import { useState } from 'react';
import { actions } from '../net/client';
import { useCountdown } from '../ui/hooks';
import { TileFace } from '../ui/Tile';
import { derive, resultLine, resultTitle, type Derived } from './derive';

/** Everyone's remaining tiles, face up. */
export function Reveal({ result, d }: { result: HandResultView; d: Derived }) {
  const start = d.mySeat ?? 0;
  const order = SEATS.map((_, i) => ((start + i) % 4) as Seat);
  return (
    <ul className="reveal">
      {order.map((seat) => {
        const hand = result.hands[seat] ?? [];
        const team = seat % 2;
        return (
          <li key={seat} className={`team-${team}`}>
            <span className="reveal-name">{seat === d.mySeat ? 'Tú' : d.nameAt(seat)}</span>
            <span className="reveal-tiles">
              {hand.length === 0 ? (
                <em className="muted">sin fichas</em>
              ) : (
                hand.map((t) => {
                  const [hi, lo] = parseTile(t);
                  return (
                    <span key={t} className="reveal-tile">
                      <TileFace top={hi} bottom={lo} />
                    </span>
                  );
                })
              )}
            </span>
            <span className="reveal-pips">{handPips(hand)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function HandSummary({ view }: { view: RoomView }) {
  const d = derive(view);
  const r = view.handResult;
  const g = view.game;
  const [sent, setSent] = useState(false);
  const left = useCountdown(view.nextHandInMs);
  if (!r || !g) return null;
  const imReady = sent || view.ready.includes(view.youId);
  return (
    <div className="overlay summary-overlay">
      <div className="card overlay-card summary-card" role="dialog" aria-label="Fin de la mano">
        <p className="eyebrow">Mano {g.handNumber}</p>
        <h2 className={`title result-${r.kind}`}>{resultTitle(r, d)}</h2>
        <p className="result-line">{resultLine(r, d)}</p>
        <Reveal result={r} d={d} />
        <div className="summary-score">
          <span className={`team-text-${d.myTeam ?? 0}`}>
            {d.teamLabel((d.myTeam ?? 0) as 0 | 1)} {g.scores[d.myTeam ?? 0]}
          </span>
          <span className="sep">—</span>
          <span className={`team-text-${d.myTeam === 1 ? 0 : 1}`}>
            {d.teamLabel(d.myTeam === 1 ? 0 : 1)} {g.scores[d.myTeam === 1 ? 0 : 1]}
          </span>
          <span className="muted"> · a {g.target}</span>
        </div>
        <div className="summary-actions">
          <button
            type="button"
            className="btn primary"
            disabled={imReady}
            onClick={() => {
              setSent(true);
              void actions.ready();
            }}
          >
            {imReady ? 'Listo ✓' : 'Continuar'}
          </button>
          <span className="muted small">
            {view.ready.length}/4 listos
            {left !== null && ` · siguiente mano en ${Math.ceil(left / 1000)} s`}
          </span>
        </div>
      </div>
    </div>
  );
}
