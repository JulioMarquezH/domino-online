import type { LetterAssignment, Letter, Pair, TournamentMatchView } from '@domino/shared';

export const nameOf = (players: LetterAssignment[], letter: Letter): string =>
  players.find((p) => p.letter === letter)?.name ?? letter;

export const pairNames = (players: LetterAssignment[], pair: Pair): string =>
  `${nameOf(players, pair[0])} + ${nameOf(players, pair[1])}`;

/** UTC timestamps from the server, shown in the viewer's own time zone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const scoreText = (m: TournamentMatchView): string =>
  m.result ? `${m.result.scorePair1} – ${m.result.scorePair2}` : '';

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
