import type { RoomView, Team } from '@domino/shared';
import { useState } from 'react';
import { actions, leaveRoom } from '../net/client';
import { navigate } from '../net/router';
import { derive, resultLine, resultTitle } from './derive';
import { Reveal } from './HandSummary';

export function MatchEnd({ view }: { view: RoomView }) {
  const d = derive(view);
  const g = view.game;
  const winner = view.matchWinner;
  const [busy, setBusy] = useState(false);
  if (!g || winner === null) return null;
  const loser: Team = winner === 0 ? 1 : 0;
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
          <div className={`final team-${winner}`}>
            <span className="final-label">{d.teamLabel(winner)}</span>
            <span className="final-value">{g.scores[winner]}</span>
            <span className="final-names">{d.teamNames(winner)}</span>
          </div>
          <span className="final-sep">—</span>
          <div className={`final team-${loser}`}>
            <span className="final-label">{d.teamLabel(loser)}</span>
            <span className="final-value">{g.scores[loser]}</span>
            <span className="final-names">{d.teamNames(loser)}</span>
          </div>
        </div>
        {view.handResult && (
          <details className="last-hand">
            <summary>
              Última mano: {resultTitle(view.handResult, d)} {resultLine(view.handResult, d)}
            </summary>
            <Reveal result={view.handResult} d={d} />
          </details>
        )}
        {isHost ? (
          <div className="rematch-row">
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
          </div>
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
  );
}
