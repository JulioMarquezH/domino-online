import {
  cleanChatText,
  isReaction,
  isThrowable,
  type FunEvent,
  type Throwable,
} from '@domino/shared';
import type { Room } from './room';

/** Max actions per player inside a sliding window: enough to have fun, not enough to spam. */
const LIMITS = {
  chat: { max: 5, windowMs: 5_000 },
  react: { max: 6, windowMs: 4_000 },
  throw: { max: 4, windowMs: 4_000 },
} as const;
const CHAT_LOG = 30;

type Kind = keyof typeof LIMITS;

interface RoomFun {
  seq: number;
  chat: FunEvent[];
  recent: Map<string, number[]>;
}

export type FunResult = { ok: true; event: FunEvent } | { ok: false; code: string };

/** Chat, reactions and things thrown at people. Nothing here touches the game. */
export class Fun {
  private readonly rooms = new WeakMap<Room, RoomFun>();

  constructor(private readonly now: () => number = Date.now) {}

  private of(room: Room): RoomFun {
    let f = this.rooms.get(room);
    if (!f) {
      f = { seq: 0, chat: [], recent: new Map() };
      this.rooms.set(room, f);
    }
    return f;
  }

  private allowed(f: RoomFun, playerId: string, kind: Kind): boolean {
    const { max, windowMs } = LIMITS[kind];
    const key = `${kind}:${playerId}`;
    const t = this.now();
    const times = (f.recent.get(key) ?? []).filter((x) => t - x < windowMs);
    if (times.length >= max) {
      f.recent.set(key, times);
      return false;
    }
    times.push(t);
    f.recent.set(key, times);
    return true;
  }

  chat(room: Room, from: string, raw: unknown): FunResult {
    const text = cleanChatText(raw);
    if (!text) return { ok: false, code: 'INVALID' };
    const f = this.of(room);
    if (!this.allowed(f, from, 'chat')) return { ok: false, code: 'SLOW_DOWN' };
    const event: FunEvent = { id: ++f.seq, kind: 'chat', from, text, at: this.now() };
    f.chat.push(event);
    if (f.chat.length > CHAT_LOG) f.chat.splice(0, f.chat.length - CHAT_LOG);
    return { ok: true, event };
  }

  react(room: Room, from: string, emoji: unknown): FunResult {
    if (!isReaction(emoji)) return { ok: false, code: 'INVALID' };
    const f = this.of(room);
    if (!this.allowed(f, from, 'react')) return { ok: false, code: 'SLOW_DOWN' };
    return { ok: true, event: { id: ++f.seq, kind: 'react', from, emoji, at: this.now() } };
  }

  throw(room: Room, from: string, to: unknown, item: unknown): FunResult {
    if (typeof to !== 'string' || to === from || !room.getPlayer(to) || !isThrowable(item)) {
      return { ok: false, code: 'INVALID' };
    }
    const f = this.of(room);
    if (!this.allowed(f, from, 'throw')) return { ok: false, code: 'SLOW_DOWN' };
    return {
      ok: true,
      event: { id: ++f.seq, kind: 'throw', from, to, item: item as Throwable, at: this.now() },
    };
  }

  log(room: Room): FunEvent[] {
    return [...(this.rooms.get(room)?.chat ?? [])];
  }
}
