import type { Team } from '@domino/shared';

interface Props {
  scores: [number, number];
  target: number;
  myTeam: Team | null;
  teamLabel: (t: Team) => string;
  teamNames: (t: Team) => string;
  handNumber: number;
}

export function Scoreboard({ scores, target, myTeam, teamLabel, teamNames, handNumber }: Props) {
  const order: Team[] = myTeam === 1 ? [1, 0] : [0, 1];
  return (
    <div className="scoreboard" aria-label="Marcador">
      {order.map((t) => (
        <div key={t} className={`score team-${t}`} title={teamNames(t)}>
          <span className="score-label">
            <span className="label-long">{teamLabel(t)}</span>
            <span className="label-short">
              {teamLabel(t) === 'Nosotros' ? 'Nos.' : teamLabel(t).replace('Pareja ', 'P')}
            </span>
          </span>
          <span className="score-value">{scores[t]}</span>
        </div>
      ))}
      <div className="score-meta">
        <span>a {target}</span>
        <span>mano {handNumber}</span>
      </div>
    </div>
  );
}
