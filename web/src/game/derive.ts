import {
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
        .slice()
        .sort((a, b) => (a === mySeat ? -1 : b === mySeat ? 1 : 0))
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
