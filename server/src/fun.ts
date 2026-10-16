import {
  BIG_THROWS,
  BIG_THROW_GAP_MS,
  THROW_COOLDOWN_MS,
  cleanChatText,
  isReaction,
  isThrowable,
  type FunEvent,
} from '@domino/shared';
import type { Room } from './room';

/** Max actions per player inside a sliding window: enough to have fun, not enough to spam. */
const LIMITS = {
  chat: { max: 5, windowMs: 5_000 },
  react: { max: 6, windowMs: 4_000 },
} as const;
const CHAT_LOG = 30;

type Kind = keyof typeof LIMITS;

interface RoomFun {
  seq: number;
  chat: FunEvent[];
  recent: Map<string, number[]>;
  /** `${playerId}:${item}` → when that player may throw it again. */
  cooldowns: Map<string, number>;
  /** When the table may take the next big one (bomb, tornado, quake). */
  bigUntil: number;
}

export type FunResult =
  { ok: true; event: FunEvent } | { ok: false; code: string; retryInMs?: number };

/** Chat, reactions and things thrown at people. Nothing here touches the game. */
export class Fun {
  private readonly rooms = new WeakMap<Room, RoomFun>();

  constructor(private readonly now: () => number = Date.now) {}

  private of(room: Room): RoomFun {
    let f = this.rooms.get(room);
    if (!f) {
      f = { seq: 0, chat: [], recent: new Map(), cooldowns: new Map(), bigUntil: 0 };
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

  /** Something thrown at a player or at a point of the table. Only the looks change. */
  throw(
    room: Room,
    from: string,
    item: unknown,
    target: { to?: unknown; x?: unknown; y?: unknown },
  ): FunResult {
    if (!isThrowable(item)) return { ok: false, code: 'INVALID' };
    const { to, x, y } = target;
    const atPlayer = typeof to === 'string';
    if (atPlayer && (to === from || !room.getPlayer(to))) return { ok: false, code: 'INVALID' };
    if (
      !atPlayer &&
      (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
    ) {
      return { ok: false, code: 'INVALID' };
    }
    const f = this.of(room);
    const t = this.now();
    const key = `${from}:${item}`;
    const mine = (f.cooldowns.get(key) ?? 0) - t;
    if (mine > 0) return { ok: false, code: 'COOLDOWN', retryInMs: mine };
    const big = BIG_THROWS.includes(item);
    if (big && f.bigUntil > t) return { ok: false, code: 'COOLDOWN', retryInMs: f.bigUntil - t };
    f.cooldowns.set(key, t + THROW_COOLDOWN_MS[item]);
    if (big) f.bigUntil = t + BIG_THROW_GAP_MS;
    const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    const where = atPlayer
      ? { to: to as string }
      : { x: clamp(x as number), y: clamp(y as number) };
    return { ok: true, event: { id: ++f.seq, kind: 'throw', from, item, ...where, at: t } };
  }

  log(room: Room): FunEvent[] {
    return [...(this.rooms.get(room)?.chat ?? [])];
  }
}
