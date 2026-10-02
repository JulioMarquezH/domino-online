import type { LetterAssignment, TournamentMatchView, TournamentView } from '@domino/shared';
import { pairNames, scoreText } from './format';

const STATUS_LABEL = {
  pendiente: 'Pendiente',
  jugando: 'Jugando',
  terminado: 'Terminado',
} as const;

export function MatchRow({
  match,
  players,
  canPlay,
  busy,
  onPlay,
}: {
  match: TournamentMatchView;
  players: LetterAssignment[];
  canPlay: boolean;
  busy: boolean;
  onPlay: () => void;
}) {
  const [a, b] = match.pairs;
  const won = match.result?.winnerPair;
  return (
    <li
      className={`match-row status-${match.status}`}
      data-match={match.number}
      data-status={match.status}
    >
      <div className="match-meta">
        <span className="match-number">Partido {match.number}</span>
        <span className={`status-chip ${match.status}`}>{STATUS_LABEL[match.status]}</span>
      </div>
      <div className="match-pairs">
        <span className={`pair ${won === 1 ? 'is-winner' : ''}`}>{pairNames(players, a)}</span>
        <span className="vs">vs</span>
        <span className={`pair ${won === 2 ? 'is-winner' : ''}`}>{pairNames(players, b)}</span>
      </div>
      {match.result && (
        <div className="match-result">
          <strong>{scoreText(match)}</strong>
          {match.result.shutout && <span className="tag tag-zap">Zapatero</span>}
        </div>
      )}
      {canPlay && (
        <button type="button" className="btn primary play-btn" disabled={busy} onClick={onPlay}>
          {busy ? 'Abriendo…' : 'Jugar'}
        </button>
      )}
    </li>
  );
}

/** The jornada being played is open; the earlier ones fold away. */
export function Schedule({
  view,
  busy,
  onPlay,
}: {
  view: TournamentView;
  busy: boolean;
  onPlay: () => void;
}) {
  const current = view.currentJornada ?? view.jornadas.at(-1)?.number ?? 1;
  const ordered = [...view.jornadas].sort((x, y) =>
    x.number === current ? -1 : y.number === current ? 1 : y.number - x.number,
  );
  return (
    <div className="schedule">
      {ordered.map((j) => {
        const isCurrent = j.number === current && view.status === 'active';
        const done = j.matches.filter((m) => m.status === 'terminado').length;
        const list = (
          <ul className="match-list">
            {j.matches.map((m) => (
              <MatchRow
                key={m.number}
                match={m}
                players={view.players}
                canPlay={view.status === 'active' && view.next?.number === m.number}
                busy={busy}
                onPlay={onPlay}
              />
            ))}
          </ul>
        );
        return isCurrent ? (
          <section key={j.number} className="jornada is-current" aria-label={`Jornada ${j.number}`}>
            <h3>
              Jornada {j.number} <span className="muted small">de 4 · {done}/3</span>
            </h3>
            {list}
          </section>
        ) : (
          <details key={j.number} className="jornada">
            <summary>
              Jornada {j.number} <span className="muted small">{done}/3 jugados</span>
            </summary>
            {list}
          </details>
        );
      })}
    </div>
  );
}
