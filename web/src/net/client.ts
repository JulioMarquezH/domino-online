import {
  normalizeRoomId,
  type Ack,
  type ClientToServerEvents,
  type JoinOk,
  type RoomView,
  type ServerToClientEvents,
} from '@domino/shared';
import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { voice } from '../voice/voice';
import { navigate, tournamentPath } from './router';
import { storage } from './storage';

export type RoomErrorCode = 'NOT_FOUND' | 'GONE' | 'FULL' | 'REPLACED' | 'RATE_LIMITED';

export type RoomStatus =
  | { kind: 'idle' }
  | { kind: 'joining'; roomId: string }
  | { kind: 'needName'; roomId: string; error: 'NAME_TAKEN' | 'NAME_INVALID' | null }
  | { kind: 'error'; roomId: string; code: RoomErrorCode }
  | { kind: 'in'; roomId: string };

export interface ClientState {
  connected: boolean;
  status: RoomStatus;
  view: RoomView | null;
  /** performance.now() when `view` arrived; countdowns in the view are relative to it. */
  receivedAt: number;
}

type DominoSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: DominoSocket = io({
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});

let state: ClientState = { connected: false, status: { kind: 'idle' }, view: null, receivedAt: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<ClientState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useClient(): ClientState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getClientState = () => state;

export function emitAck<T extends object = object>(
  event: string,
  payload?: unknown,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const s = socket as unknown as {
      timeout: (ms: number) => { emit: (...args: unknown[]) => void };
    };
    const done = (err: unknown, res: Ack<T>) => resolve(err ? { ok: false, code: 'TIMEOUT' } : res);
    if (payload === undefined) s.timeout(8000).emit(event, done);
    else s.timeout(8000).emit(event, payload, done);
  });
}

function onJoined(res: JoinOk, name: string): void {
  storage.setToken(res.roomId, res.token);
  storage.setName(name);
  set({ status: { kind: 'in', roomId: res.roomId } });
  voice.enter({
    selfId: res.playerId,
    iceServers: res.iceServers as RTCIceServer[],
    sendSignal: (to, toSession, data) => socket.emit('rtc:signal', { to, toSession, data }),
    sendMic: (mic) => socket.emit('voice:mic', { mic }),
  });
}

export async function createRoom(name: string): Promise<Ack<JoinOk>> {
  const res = await emitAck<JoinOk>('room:create', { name });
  if (res.ok) {
    set({ view: null });
    onJoined(res, name);
  }
  return res;
}

const inflight = new Map<string, Promise<void>>();

/** Joins (or re-joins) a room using the stored token and name. Concurrent calls share one request. */
export function joinRoom(rawId: string, name?: string): Promise<void> {
  const roomId = normalizeRoomId(rawId);
  const running = inflight.get(roomId);
  if (running && name === undefined) return running;
  const p = doJoin(roomId, name).finally(() => {
    if (inflight.get(roomId) === p) inflight.delete(roomId);
  });
  inflight.set(roomId, p);
  return p;
}

async function doJoin(roomId: string, name?: string): Promise<void> {
  const token = storage.getToken(roomId);
  const savedName = name ?? (storage.getName() || undefined);
  if (state.status.kind !== 'in' || state.status.roomId !== roomId) {
    set({ status: { kind: 'joining', roomId }, view: null });
  }
  // Tournament rooms admit only the device's tournament identity (or the room token it got).
  const tournamentId = storage.getRoomTournament(roomId);
  const res = await emitAck<JoinOk>('room:join', {
    roomId,
    token: token ?? undefined,
    name: tournamentId ? undefined : savedName,
    tt: (tournamentId && storage.getTournamentToken(tournamentId)) || undefined,
  });
  if (res.ok) {
    onJoined(res, savedName ?? storage.getName());
    return;
  }
  const code = res.code;
  voice.leave();
  if (code === 'NEED_NAME' || code === 'NAME_TAKEN' || code === 'NAME_INVALID') {
    set({
      view: null,
      status: { kind: 'needName', roomId, error: code === 'NEED_NAME' ? null : code },
    });
  } else if (code === 'FULL') {
    set({ view: null, status: { kind: 'error', roomId, code: 'FULL' } });
  } else if (code === 'RATE_LIMITED') {
    set({ view: null, status: { kind: 'error', roomId, code: 'RATE_LIMITED' } });
  } else if (code === 'TIMEOUT') {
    // Still offline: the reconnect handler retries.
  } else {
    if (token) storage.clearToken(roomId);
    set({ view: null, status: { kind: 'error', roomId, code: token ? 'GONE' : 'NOT_FOUND' } });
  }
}

export function leaveRoom(): void {
  socket.emit('room:leave');
  const s = state.status;
  if (s.kind === 'in') storage.clearToken(s.roomId);
  voice.leave();
  set({ status: { kind: 'idle' }, view: null });
}

/** Leaves the room: a tournament room goes back to its tournament, a casual one to the home. */
export function exitRoom(): void {
  const tournamentId = state.view?.tournament?.id ?? null;
  leaveRoom();
  navigate(tournamentId ? tournamentPath(tournamentId) : '/');
}

export function resetStatus(): void {
  set({ status: { kind: 'idle' }, view: null });
}

export const actions = {
  setTarget: (target: number) => emitAck('lobby:target', { target }),
  setMode: (mode: 'sortear' | 'manual') => emitAck('lobby:mode', { mode }),
  sit: (seat: number | null) => emitAck('lobby:sit', { seat }),
  start: () => emitAck('lobby:start'),
  addBot: () => emitAck('lobby:addBot'),
  removeBot: (playerId: string) => emitAck('lobby:removeBot', { playerId }),
  pick: (position: number) => emitAck('draw:pick', { position }),
  play: (tile: string, end: 'left' | 'right', v: number) => emitAck('game:play', { tile, end, v }),
  pass: (v: number) => emitAck('game:pass', { v }),
  ready: () => emitAck('hand:ready'),
  decide: (playerId: string, decision: 'wait' | 'end' | 'replace' | 'bot') =>
    emitAck('pause:decide', { playerId, decision }),
  rematch: (keepTeams: boolean) => emitAck('match:rematch', { keepTeams }),
};

socket.on('connect', () => {
  set({ connected: true });
  const s = state.status;
  // After a drop (or a server restart) re-claim the seat with the stored token.
  if (s.kind === 'in' || s.kind === 'joining') void joinRoom(s.roomId);
});

socket.on('disconnect', () => set({ connected: false }));

socket.on('state', (view) => {
  const s = state.status;
  if (s.kind !== 'in' || s.roomId !== view.roomId) return;
  set({ view, receivedAt: performance.now() });
  voice.sync(view.players, view.youId);
});

socket.on('rtc:signal', (msg) => voice.handleSignal(msg.from, msg.fromSession, msg.data));

socket.on('room:closed', ({ reason }) => {
  const s = state.status;
  voice.leave();
  if (s.kind === 'in') {
    set({
      view: null,
      status: {
        kind: 'error',
        roomId: s.roomId,
        code: reason === 'replaced' ? 'REPLACED' : 'GONE',
      },
    });
  }
});
