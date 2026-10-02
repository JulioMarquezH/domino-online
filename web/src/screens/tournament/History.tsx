import type { TournamentView } from '@domino/shared';
import { formatWhen, pairNames } from './format';

export function History({ view }: { view: TournamentView }) {
  const done = view.jornadas
    .flatMap((j) => j.matches)
    .filter((m) => m.result)
    .sort((a, b) => Date.parse(b.result?.endedAt ?? '') - Date.parse(a.result?.endedAt ?? ''));
  if (done.length === 0) {
    return <p className="muted">Aún no hay partidos terminados.</p>;
  }
  return (
    <ol className="history">
      {done.map((m) => {
        const r = m.result;
        if (!r) return null;
        const [a, b] = m.pairs;
        return (
          <li key={m.number} className="history-item" data-match={m.number}>
            <div className="history-meta">
              <span>
                Partido {m.number} · Jornada {m.jornada}, partido {m.slot}
              </span>
              <time dateTime={r.endedAt}>{formatWhen(r.endedAt)}</time>
            </div>
            <div className="history-body">
              <span className={r.winnerPair === 1 ? 'is-winner' : ''}>
                {pairNames(view.players, a)}
              </span>
              <strong className="history-score">
                {r.scorePair1} – {r.scorePair2}
              </strong>
              <span className={r.winnerPair === 2 ? 'is-winner' : ''}>
                {pairNames(view.players, b)}
              </span>
              {r.shutout && <span className="tag tag-zap">Zapatero</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
