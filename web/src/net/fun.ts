import {
  BIG_THROWS,
  BIG_THROW_GAP_MS,
  THROW_COOLDOWN_MS,
  type FunEvent,
  type Throwable,
} from '@domino/shared';
import { useSyncExternalStore } from 'react';
import { emitAck, getClientState, socket } from './client';

/** Chat messages of the current room, unread count, and a bus for the animations. */
interface FunState {
  roomId: string | null;
  chat: Extract<FunEvent, { kind: 'chat' }>[];
  unread: number;
  open: boolean;
  /** The thing you picked from the arsenal: your next tap on the table throws it. */
  armed: Throwable | null;
  /** performance.now() until which each thing is still recharging. */
  ready: Partial<Record<Throwable, number>>;
  /** Until when the table rests from bombs, tornados and quakes. */
  bigReady: number;
  /** The arsenal strip is on screen (remembered on this device). */
  tray: boolean;
}

const TRAY_KEY = 'domino:arsenal';
function readTray(): boolean {
  try {
    return localStorage.getItem(TRAY_KEY) !== 'off';
  } catch {
    return true;
  }
}

let state: FunState = {
  roomId: null,
  chat: [],
  unread: 0,
  open: false,
  armed: null,
  ready: {},
  bigReady: 0,
  tray: readTray(),
};
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
  if (roomId !== state.roomId) {
    set({ roomId, chat: [], unread: 0, open: false, armed: null, ready: {}, bigReady: 0 });
  }
}

export function setChatOpen(open: boolean): void {
  set({ open, unread: open ? 0 : state.unread });
}

export const sendChat = (text: string) => emitAck('room:chat', { text });
export const sendReaction = (emoji: string) => emitAck('room:react', { emoji });
export function arm(item: Throwable | null): void {
  set({ armed: item });
}

export function setTray(on: boolean): void {
  try {
    localStorage.setItem(TRAY_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked: still toggles for this visit
  }
  set({ tray: on, armed: on ? state.armed : null });
}

export type ThrowTarget = { to: string } | { x: number; y: number };

/** Milliseconds before `item` can be thrown again (yours, or the table's breather). */
export function waitFor(item: Throwable, now = performance.now()): number {
  const own = (state.ready[item] ?? 0) - now;
  const big = BIG_THROWS.includes(item) ? state.bigReady - now : 0;
  return Math.max(0, own, big);
}

/** Throws something at a player or a point of the table (x, y in 0..1 of the board). */
export async function throwAt(item: Throwable, target: ThrowTarget): Promise<void> {
  set({ armed: null });
  const res = await emitAck('room:throw', { item, ...target });
  const now = performance.now();
  if (res.ok) {
    set({ ready: { ...state.ready, [item]: now + THROW_COOLDOWN_MS[item] } });
  } else if (res.code === 'COOLDOWN' && 'retryAfterMs' in res && res.retryAfterMs) {
    const until = now + res.retryAfterMs;
    if (BIG_THROWS.includes(item)) set({ bigReady: Math.max(state.bigReady, until) });
    else set({ ready: { ...state.ready, [item]: until } });
  }
}

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
  if (e.kind === 'throw' && BIG_THROWS.includes(e.item)) {
    set({ bigReady: performance.now() + BIG_THROW_GAP_MS });
  }
  animators.forEach((fn) => fn(e));
});
