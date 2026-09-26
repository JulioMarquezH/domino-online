import {
  type HandResultView,
  screenPosition,
  seatsOfTeam,
  teamOf,
  type PublicPlayer,
  type RoomView,
  type ScreenPosition,
  type Seat,
  type Team,
} from '@domino/shared';

export interface Derived {
  me: PublicPlayer;
  mySeat: Seat | null;
  myTeam: Team | null;
  host: PublicPlayer | undefined;
  bySeat: Map<Seat, PublicPlayer>;
  teamLabel: (team: Team) => string;
  teamNames: (team: Team) => string;
  nameAt: (seat: Seat) => string;
  position: (seat: Seat) => ScreenPosition;
}

export function derive(view: RoomView): Derived {
  const me = view.players.find((p) => p.id === view.youId) as PublicPlayer;
  const bySeat = new Map<Seat, PublicPlayer>();
  for (const p of view.players) if (p.seat !== null) bySeat.set(p.seat, p);
  const mySeat = me?.seat ?? null;
  const myTeam = mySeat !== null ? teamOf(mySeat) : null;
  const nameAt = (seat: Seat) => bySeat.get(seat)?.name ?? '—';
  return {
    me,
    mySeat,
    myTeam,
    host: view.players.find((p) => p.isHost),
    bySeat,
    teamLabel: (team) =>
      myTeam === null ? `Pareja ${team + 1}` : team === myTeam ? 'Nosotros' : 'Ellos',
    teamNames: (team) =>
      seatsOfTeam(team)
        .map((s) => (s === mySeat ? 'Tú' : nameAt(s)))
        .join(' y '),
    nameAt,
    position: (seat) => screenPosition(mySeat ?? 0, seat),
  };
}

/** A tiny ticking countdown from a server-provided "ms remaining". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function resultTitle(r: HandResultView, d: Derived): string {
  if (r.kind === 'domino')
    return r.winner === d.mySeat ? '¡Dominó tuyo!' : `¡Dominó de ${d.nameAt(r.winner)}!`;
  if (r.kind === 'tranque') return '¡Tranque!';
  return 'Tranque empatado';
}

export function resultLine(r: HandResultView, d: Derived): string {
  if (r.kind === 'tranque-tie') return `Las dos parejas suman ${r.teamPips[0]}. Nadie anota: 0–0.`;
  const who = d.teamLabel(r.winnerTeam);
  const verb = who === 'Nosotros' ? 'sumamos' : 'suman';
  if (r.kind === 'tranque') {
    return `${who} ${verb} ${r.points}: la pareja con menos puntos gana el tranque (${r.teamPips[r.winnerTeam]} contra ${r.points}).`;
  }
  return `${who} ${verb} ${r.points} puntos.`;
}
