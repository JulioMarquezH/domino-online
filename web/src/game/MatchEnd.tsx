import type { RoomView, Team } from '@domino/shared';
import { Fragment, useState } from 'react';
import { actions, leaveRoom } from '../net/client';
import { navigate } from '../net/router';
import { derive } from './derive';
import { HandBreakdown } from './HandBreakdown';
import { verdictOf } from './verdict';

export function MatchEnd({ view }: { view: RoomView }) {
  const d = derive(view);
  const g = view.game;
  const winner = view.matchWinner;
  const [busy, setBusy] = useState(false);
  if (!g || winner === null) return null;
  // Your pair first, like in the hand breakdown.
  const order: Team[] = d.myTeam === 1 ? [1, 0] : [0, 1];
  const weWon = d.myTeam === winner;
  const isHost = d.me?.isHost ?? false;
  const rematch = async (keepTeams: boolean) => {
    setBusy(true);
    await actions.rematch(keepTeams);
    setBusy(false);
  };
  return (
    <div className="overlay match-overlay">
      <div className="card overlay-card match-card" role="dialog" aria-label="Fin de la partida">
        <p className="eyebrow">Fin de la partida · a {g.target}</p>
        <h2 className="title big-title">
          {weWon ? '¡Ganamos!' : `Ganaron ${d.teamNames(winner)}`}
        </h2>
        <div className="final-score">
          {order.map((t, i) => (
            <Fragment key={t}>
              {i === 1 && <span className="final-sep">—</span>}
              <div className={`final team-${t} ${t === winner ? 'is-winner' : ''}`}>
                <span className="final-label">
                  {d.teamLabel(t)}
                  {t === winner && ' · ganan'}
                </span>
                <span className="final-value">{g.scores[t]}</span>
                <span className="final-names">{d.teamNames(t)}</span>
              </div>
            </Fragment>
          ))}
        </div>
        {view.handResult && (
          <div className="last-hand">
            <p className="last-hand-title">
              Última mano · {verdictOf(view.handResult, d).kicker}{' '}
              <strong>{verdictOf(view.handResult, d).points}</strong>
            </p>
            <HandBreakdown result={view.handResult} d={d} />
          </div>
        )}
        <div className="rematch-row">
          {isHost ? (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void rematch(true)}
              >
                Revancha · mismas parejas
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void rematch(false)}
              >
                Revancha · sortear parejas
              </button>
            </>
          ) : (
            <p className="muted">
              Esperando a que {d.host?.name ?? 'el anfitrión'} pida la revancha…
            </p>
          )}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              leaveRoom();
              navigate('/');
            }}
          >
            Salir de la sala
          </button>
        </div>
      </div>
    </div>
  );
}
