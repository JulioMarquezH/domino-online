import {
  isValidTournamentId,
  normalizeTournamentId,
  type LetterAssignment,
  type TournamentCreated,
  type TournamentEntered,
  type TournamentExport,
  type TournamentSummary,
  type TournamentView,
} from '@domino/shared';
import { useSyncExternalStore } from 'react';
import { emitAck, socket } from './client';
import { storage } from './storage';

export type TournamentError = 'NOT_FOUND' | 'RATE_LIMITED' | 'FAILED';

export type TournamentStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; id: string }
  | {
      kind: 'needName';
      id: string;
      error: 'NAME_UNKNOWN' | 'NAME_INVALID' | 'RATE_LIMITED' | null;
      /** performance.now() after which a rate-limited visitor may try again. */
      retryAt: number | null;
    }
  | { kind: 'error'; id: string; code: TournamentError }
  | { kind: 'in'; id: string };

export interface TournamentState {
  status: TournamentStatus;
  view: TournamentView | null;
  you: LetterAssignment | null;
}

let state: TournamentState = { status: { kind: 'idle' }, view: null, you: null };
const listeners = new Set<() => void>();

function set(patch: Partial<TournamentState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useTournament(): TournamentState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const labelOf = (players: LetterAssignment[]) => players.map((p) => p.name).join(' · ');

/** Creates a tournament; the server draws the letters, the screen only animates them. */
export async function createTournament(names: string[]) {
  const res = await emitAck<TournamentCreated>('tournament:create', { names });
  if (res.ok) storage.rememberTournament({ id: res.id, label: labelOf(res.players) });
  return res;
}

/** Enters with the stored device token, or with a typed name when there is none. */
export async function enterTournament(rawId: string, name?: string): Promise<void> {
  const id = normalizeTournamentId(rawId);
  if (!isValidTournamentId(id)) {
    set({ status: { kind: 'error', id, code: 'NOT_FOUND' }, view: null, you: null });
    return;
  }
  const s = state.status;
  // Keep the page (and what the visitor typed) while a name attempt is in flight.
  const staying = (s.kind === 'in' || s.kind === 'needName') && s.id === id;
  if (!staying) set({ status: { kind: 'loading', id }, view: null, you: null });
  const token = storage.getTournamentToken(id) ?? undefined;
  const res = await emitAck<TournamentEntered>('tournament:enter', { id, token, name });
  if (res.ok) {
    storage.setTournamentToken(id, res.token);
    storage.rememberTournament({ id, label: labelOf(res.view.players), you: res.you.name });
    set({ status: { kind: 'in', id }, view: res.view, you: res.you });
    return;
  }
  const retryAfterMs = 'retryAfterMs' in res ? (res.retryAfterMs ?? 0) : 0;
  switch (res.code) {
    case 'NEED_NAME':
      // A stale token (e.g. the tournament was reset) is useless: ask for the name.
      if (token) storage.clearTournamentToken(id);
      set({ status: { kind: 'needName', id, error: null, retryAt: null }, view: null, you: null });
      return;
    case 'NAME_UNKNOWN':
    case 'NAME_INVALID':
      set({ status: { kind: 'needName', id, error: res.code, retryAt: null } });
      return;
    case 'RATE_LIMITED':
      set({
        status: {
          kind: 'needName',
          id,
          error: 'RATE_LIMITED',
          retryAt: performance.now() + retryAfterMs,
        },
      });
      return;
    case 'TIMEOUT':
      return; // offline: the reconnect handler tries again
    case 'NOT_FOUND':
      storage.forgetTournament(id);
      set({ status: { kind: 'error', id, code: 'NOT_FOUND' }, view: null, you: null });
      return;
    default:
      set({ status: { kind: 'error', id, code: 'FAILED' }, view: null, you: null });
  }
}

export function leaveTournament(): void {
  socket.emit('tournament:leave');
  set({ status: { kind: 'idle' }, view: null, you: null });
}

/** "Jugar": opens (or returns) the room of the next pending match and remembers whose it is. */
export async function playNext(): Promise<
  { ok: true; roomId: string } | { ok: false; code: string }
> {
  const s = state.status;
  if (s.kind !== 'in') return { ok: false, code: 'NOT_AUTHENTICATED' };
  const res = await emitAck<{ roomId: string }>('tournament:play');
  if (!res.ok) return { ok: false, code: res.code };
  storage.setRoomTournament(res.roomId, s.id);
  return { ok: true, roomId: res.roomId };
}

export async function exportTournament(): Promise<TournamentExport | null> {
  const res = await emitAck<{ data: TournamentExport }>('tournament:export');
  return res.ok ? res.data : null;
}

/** Checks the IDs this device remembers; the dead ones are dropped without a word. */
export async function refreshKnownTournaments(): Promise<TournamentSummary[]> {
  const known = storage.getKnownTournaments();
  if (known.length === 0) return [];
  const res = await emitAck<{ items: TournamentSummary[] }>('tournament:list', {
    ids: known.map((t) => t.id),
  });
  if (!res.ok) return [];
  const alive = new Set(res.items.map((i) => i.id));
  for (const t of known) if (!alive.has(t.id)) storage.forgetTournament(t.id);
  return res.items;
}

socket.on('tournament:state', (view) => {
  const s = state.status;
  if (s.kind === 'in' && s.id === view.id) set({ view });
});

socket.on('connect', () => {
  // After a drop or a server restart the socket is a stranger again: identify with the token.
  const s = state.status;
  if (s.kind === 'in' || s.kind === 'loading') void enterTournament(s.id);
});
