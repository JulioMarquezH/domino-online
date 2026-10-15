import type { FunEvent, Throwable } from '@domino/shared';
import { useSyncExternalStore } from 'react';
import { emitAck, getClientState, socket } from './client';

/** Chat messages of the current room, unread count, and a bus for the animations. */
interface FunState {
  roomId: string | null;
  chat: Extract<FunEvent, { kind: 'chat' }>[];
  unread: number;
  open: boolean;
}

let state: FunState = { roomId: null, chat: [], unread: 0, open: false };
const listeners = new Set<() => void>();
const animators = new Set<(e: FunEvent) => void>();

function set(patch: Partial<FunState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useFun(): FunState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Live events (not the backlog) for the flying tomatoes, reactions and chat bubbles. */
export function onFun(fn: (e: FunEvent) => void): () => void {
  animators.add(fn);
  return () => animators.delete(fn);
}

function currentRoom(): string | null {
  const s = getClientState().status;
  return s.kind === 'in' ? s.roomId : null;
}

function forRoom(): void {
  const roomId = currentRoom();
  if (roomId !== state.roomId) set({ roomId, chat: [], unread: 0, open: false });
}

export function setChatOpen(open: boolean): void {
  set({ open, unread: open ? 0 : state.unread });
}

export const sendChat = (text: string) => emitAck('room:chat', { text });
export const sendReaction = (emoji: string) => emitAck('room:react', { emoji });
export const throwAt = (to: string, item: Throwable) => emitAck('room:throw', { to, item });

socket.on('room:funlog', ({ events }) => {
  forRoom();
  set({ chat: events.filter((e) => e.kind === 'chat') });
});

socket.on('room:fun', (e) => {
  forRoom();
  if (e.kind === 'chat') {
    const mine = getClientState().view?.youId === e.from;
    set({
      chat: [...state.chat, e].slice(-60),
      unread: state.open || mine ? state.unread : state.unread + 1,
    });
  }
  animators.forEach((fn) => fn(e));
});
