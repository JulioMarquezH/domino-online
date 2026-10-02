/** Wire types for the tournament feature (Socket.IO). The client never sends results or schedules. */
import type { Ack } from './protocol';
import type { Letter, LetterAssignment, Pair, Pairing, StandingRow } from './tournament';

export type MatchStatus = 'pendiente' | 'jugando' | 'terminado';

export interface TournamentMatchView {
  /** 1..12 across the whole tournament. */
  number: number;
  jornada: number;
  /** 1..3 inside the jornada. */
  slot: number;
  pairing: Pairing;
  pairs: [Pair, Pair];
  status: MatchStatus;
  result: {
    winnerPair: 1 | 2;
    scorePair1: number;
    scorePair2: number;
    shutout: boolean;
    /** ISO UTC; the client renders it in the viewer's local time. */
    endedAt: string;
  } | null;
}

export interface TournamentView {
  id: string;
  createdAt: string;
  target: number;
  status: 'active' | 'finished';
  players: LetterAssignment[];
  /** Only the jornadas already drawn (the next one appears when the previous finishes). */
  jornadas: { number: number; matches: TournamentMatchView[] }[];
  currentJornada: number | null;
  /** The one match with a "Jugar" button. */
  next: { jornada: number; slot: number; number: number } | null;
  standings: StandingRow[];
  /** Filled once all 12 matches are recorded; several letters = tied champions. */
  champions: Letter[];
  played: number;
}

export interface TournamentCreated {
  id: string;
  /** In the order the names were typed, each with the letter the server drew. */
  players: LetterAssignment[];
}

export interface TournamentEntered {
  id: string;
  /** Stored by the device (localStorage `tournament:<id>`) to skip the name prompt next time. */
  token: string;
  you: LetterAssignment;
  view: TournamentView;
}

export interface TournamentSummary {
  id: string;
  status: 'active' | 'finished';
  played: number;
}

/** Full export for "Descargar respaldo": everything stored, including voided matches. */
export interface TournamentExport {
  format: 'domino-torneo/1';
  exportedAt: string;
  tournament: {
    id: string;
    createdAt: string;
    target: number;
    status: 'active' | 'finished';
    finishedAt: string | null;
  };
  players: LetterAssignment[];
  jornadas: { number: number; matchOrder: Pairing[]; createdAt: string }[];
  matches: {
    id: number;
    jornada: number;
    slot: number;
    pairing: Pairing;
    roomId: string | null;
    startedAt: string | null;
    endedAt: string;
    winnerPair: 1 | 2;
    scorePair1: number;
    scorePair2: number;
    shutout: boolean;
    hands: unknown;
    voidedAt: string | null;
    voidedReason: string | null;
  }[];
}

export type TournamentErrorCode =
  | 'NOT_FOUND'
  | 'NEED_NAME'
  | 'NAME_INVALID'
  | 'NAME_UNKNOWN'
  | 'RATE_LIMITED'
  | 'NOT_AUTHENTICATED'
  | 'FINISHED'
  | 'INVALID'
  | 'NAMES_COUNT'
  | 'NAME_DUPLICATE'
  | 'FAILED';

export interface TournamentClientToServer {
  'tournament:create': (p: { names: string[] }, ack: (r: Ack<TournamentCreated>) => void) => void;
  'tournament:enter': (
    p: { id: string; name?: string; token?: string },
    ack: (r: Ack<TournamentEntered>) => void,
  ) => void;
  /** Validates the IDs a device remembers; unknown ones are simply absent from the answer. */
  'tournament:list': (
    p: { ids: string[] },
    ack: (r: Ack<{ items: TournamentSummary[] }>) => void,
  ) => void;
  /** Opens (or returns the already-open) room of the next pending match. */
  'tournament:play': (ack: (r: Ack<{ roomId: string }>) => void) => void;
  'tournament:export': (ack: (r: Ack<{ data: TournamentExport }>) => void) => void;
  'tournament:leave': () => void;
}

export interface TournamentServerToClient {
  'tournament:state': (view: TournamentView) => void;
}

/** What a tournament room tells its four players about itself. */
export interface TournamentRoomInfo {
  id: string;
  jornada: number;
  slot: number;
  number: number;
  pairing: Pairing;
  /** True once the result is in the database (the room then shows "Partido guardado"). */
  saved: boolean;
}
