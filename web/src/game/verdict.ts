import type { HandResultView, Team } from '@domino/shared';
import type { Derived } from './derive';

export interface Verdict {
  /** "¡Tranque!" / "Dominó de Ana" */
  kicker: string;
  /** "¡Ganamos la mano!" / "Ganaron Rosa y Tomás" / "Tranque empatado" */
  title: string;
  winner: Team | null;
  /** "+46 para Ellos" or "Nadie anota" */
  points: string;
  explain: string;
}

/** Plain-language outcome of a hand, from the viewer's side of the table. */
export function verdictOf(r: HandResultView, d: Derived): Verdict {
  const kicker =
    r.kind === 'domino'
      ? r.winner === d.mySeat
        ? '¡Dominaste!'
        : `Dominó de ${d.nameAt(r.winner)}`
      : '¡Tranque!';
  if (r.kind === 'tranque-tie') {
    return {
      kicker,
      title: 'Tranque empatado',
      winner: null,
      points: 'Nadie anota · 0–0',
      explain: `Nadie podía jugar y las dos parejas quedaron con ${r.teamPips[0]} puntos en fichas.`,
    };
  }
  const w = r.winnerTeam;
  const weWon = d.myTeam === w;
  const explain =
    r.kind === 'domino'
      ? `${r.winner === d.mySeat ? 'Te quedaste' : `${d.nameAt(r.winner)} se quedó`} sin fichas: ${
          weWon ? 'nos anotamos' : 'se anotan'
        } lo que suman las fichas de ${weWon ? 'ellos' : 'nosotros'}.`
      : 'Nadie podía jugar. Gana la pareja con menos puntos en fichas y se anota los de la otra.';
  return {
    kicker,
    title: weWon ? '¡Ganamos la mano!' : `Ganaron ${d.teamNames(w)}`,
    winner: w,
    points: `+${r.points} para ${d.teamLabel(w)}`,
    explain,
  };
}
