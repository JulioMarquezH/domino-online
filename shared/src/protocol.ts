/**
 * Wire protocol shared by server and web. The server sends each player their own
 * `RoomView`: other players' hands are never included, only tile counts, until the
 * end-of-hand reveal.
 */
import type { End, GameEvent, PlacedTile, TeamPips } from './hand';
import type { Target } from './match';
import type { Seat, Team } from './seats';
import type { TileId } from './tiles';

/** Unambiguous alphabet: no 0/O/1/I/L. */
export const ROOM_ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_ID_LENGTH = 6;
export const MAX_PLAYERS = 4;
export const NAME_MAX_LENGTH = 20;
export const DRAW_POSITIONS = 28;

const ROOM_ID_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);

export function normalizeRoomId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_RE.test(id);
}

/** Trimmed display name, or null when invalid (must be 1–20 chars after trimming). */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || [...name].length > NAME_MAX_LENGTH) return null;
  return name;
}

export type TeamMode = 'sortear' | 'manual';
export type Phase = 'lobby' | 'draw' | 'playing' | 'handEnd' | 'matchEnd';
/** on = sending audio, muted = self-muted, off = no mic (denied / missing / unplugged). */
export type MicState = 'on' | 'muted' | 'off';

export interface PublicPlayer {
  id: string;
  name: string;
  /** Played by the server's AI. */
  isBot: boolean;
  seat: Seat | null;
  connected: boolean;
  isHost: boolean;
  mic: MicState;
  /** Changes on every (re)connection; peers use it to rebuild their WebRTC connection. */
  voiceSession: string | null;
  /** Tiles left in hand during a hand; 0 otherwise. */
  tileCount: number;
}

export interface DrawPickView {
  playerId: string;
  position: number;
  tile: TileId;
}

export interface DrawView {
  /** 'sortear': the draw also makes the teams; 'starter': teams are fixed, it only picks who leads. */
  mode: 'sortear' | 'starter';
  picks: DrawPickView[];
  /** Set once all four have picked. */
  outcome: {
    /** Player ids from highest to lowest tile. */
    ranking: string[];
    starterId: string;
    /** Seat of every player after the draw. */
    seats: Record<string, Seat>;
  } | null;
}

export type TableEvent = GameEvent & { id: number };

export interface GameView {
  target: Target;
  scores: [number, number];
  handNumber: number;
  starter: Seat;
  turn: Seat;
  line: PlacedTile[];
  origin: number;
  /** Your own tiles only. */
  hand: TileId[];
  lastEvent: TableEvent | null;
}

export type HandResultView =
  | {
      kind: 'domino';
      winnerTeam: Team;
      winner: Seat;
      points: number;
      teamPips: TeamPips;
      hands: TileId[][];
    }
  | { kind: 'tranque'; winnerTeam: Team; points: number; teamPips: TeamPips; hands: TileId[][] }
  | { kind: 'tranque-tie'; winnerTeam: null; points: 0; teamPips: TeamPips; hands: TileId[][] };

export interface PauseEntry {
  playerId: string;
  name: string;
  /** Milliseconds until the host may decide; 0 when expired. */
  remainingMs: number;
  expired: boolean;
  replaceable: boolean;
}

export interface RoomView {
  roomId: string;
  phase: Phase;
  youId: string;
  players: PublicPlayer[];
  target: Target;
  teamMode: TeamMode;
  /** Increments on every game state change; plays and passes must echo it (stale ones are rejected). */
  version: number;
  draw: DrawView | null;
  game: GameView | null;
  handResult: HandResultView | null;
  /** Players who pressed "Continuar" on the end-of-hand summary. */
  ready: string[];
  /** Milliseconds until the next hand starts automatically. */
  nextHandInMs: number | null;
  /** Non-empty while the game is paused waiting for disconnected players. */
  pause: PauseEntry[];
  matchWinner: Team | null;
}

/** What the host can do once a disconnected player's 2 minutes are up. */
export type PauseDecision = 'wait' | 'end' | 'replace' | 'bot';

export const MAX_BOTS = 3;
export const BOT_NAMES = ['Rosa', 'Tomás', 'Lucho', 'Marta', 'Chepe', 'Nena', 'Toño', 'Chela'];

export type JoinErrorCode = 'NOT_FOUND' | 'FULL' | 'NAME_TAKEN' | 'NAME_INVALID' | 'NEED_NAME';
export type ActionErrorCode =
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'WRONG_PHASE'
  | 'STALE'
  | 'PAUSED'
  | 'INVALID'
  | 'NOT_READY'
  | 'NOT_YOUR_TURN'
  | 'TILE_NOT_IN_HAND'
  | 'ILLEGAL_MOVE'
  | 'END_REQUIRED'
  | 'CANNOT_PASS'
  | 'TAKEN';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; code: string };

export interface JoinOk {
  roomId: string;
  playerId: string;
  token: string;
  iceServers: RTCIceServerConfig[];
}

/** Structural copy of RTCIceServer so `shared` needs no DOM types. */
export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SignalPayload {
  description?: { type: string; sdp?: string };
  candidate?: unknown;
  /** Ask the peer to drop the connection and start a fresh one (after a hard failure). */
  reset?: boolean;
}

export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: (r: Ack<JoinOk>) => void) => void;
  'room:join': (
    p: { roomId: string; name?: string; token?: string },
    ack: (r: Ack<JoinOk>) => void,
  ) => void;
  'room:leave': () => void;
  'lobby:target': (p: { target: Target }, ack: (r: Ack) => void) => void;
  'lobby:mode': (p: { mode: TeamMode }, ack: (r: Ack) => void) => void;
  'lobby:sit': (p: { seat: Seat | null }, ack: (r: Ack) => void) => void;
  'lobby:start': (ack: (r: Ack) => void) => void;
  'lobby:addBot': (ack: (r: Ack) => void) => void;
  'lobby:removeBot': (p: { playerId: string }, ack: (r: Ack) => void) => void;
  'draw:pick': (p: { position: number }, ack: (r: Ack) => void) => void;
  'game:play': (p: { tile: TileId; end: End; v: number }, ack: (r: Ack) => void) => void;
  'game:pass': (p: { v: number }, ack: (r: Ack) => void) => void;
  'hand:ready': (ack: (r: Ack) => void) => void;
  'pause:decide': (p: { playerId: string; decision: PauseDecision }, ack: (r: Ack) => void) => void;
  'match:rematch': (p: { keepTeams: boolean }, ack: (r: Ack) => void) => void;
  'voice:mic': (p: { mic: MicState }) => void;
  'rtc:signal': (p: { to: string; toSession: string; data: SignalPayload }) => void;
}

export interface ServerToClientEvents {
  state: (view: RoomView) => void;
  'rtc:signal': (p: { from: string; fromSession: string; data: SignalPayload }) => void;
  /** The room is gone (deleted, match aborted for you, or you opened it elsewhere). */
  'room:closed': (p: { reason: 'deleted' | 'replaced' | 'kicked' }) => void;
}
