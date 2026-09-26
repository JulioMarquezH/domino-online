/**
 * Seats are numbered 0..3 in turn order. Turn order goes to the RIGHT
 * (counterclockwise seen from above): the next player is seat + 1.
 * Partners sit opposite each other: seats 0 & 2 are team 0, seats 1 & 3 are team 1.
 */
export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** The player to the right, i.e. the next one to play. */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

export function partnerOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

export function teamOf(seat: Seat): Team {
  return (seat % 2) as Team;
}

export function seatsOfTeam(team: Team): [Seat, Seat] {
  return team === 0 ? [0, 2] : [1, 3];
}

export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

export type ScreenPosition = 'bottom' | 'right' | 'top' | 'left';

/**
 * Where `seat` appears on the screen of the player sitting at `viewer`:
 * you at the bottom, the next player (to your right) on the right, your partner on top.
 */
export function screenPosition(viewer: Seat, seat: Seat): ScreenPosition {
  const rel = (seat - viewer + 4) % 4;
  return (['bottom', 'right', 'top', 'left'] as const)[rel] as ScreenPosition;
}
