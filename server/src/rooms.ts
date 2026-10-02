import type { Rng } from '@domino/shared';
import { cryptoRng, newPlayerId, newRoomId, newToken } from './ids';
import {
  DEFAULT_TIMINGS,
  Room,
  realClock,
  type Clock,
  type Timings,
  type TournamentHooks,
} from './room';

export interface RoomManagerOptions {
  clock?: Clock;
  timings?: Partial<Timings>;
  rng?: Rng;
  onChange: (room: Room) => void;
  /** Called after a room is removed (expired, deleted or disposed). */
  onRemoved?: (room: Room) => void;
}

/**
 * All rooms live in memory. A server restart loses them (by design); what survives is what the
 * tournament recorder already wrote to SQLite when a tournament match finished.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private readonly clock: Clock;
  private readonly timings: Timings;
  private readonly rng: Rng;

  constructor(private readonly options: RoomManagerOptions) {
    this.clock = options.clock ?? realClock;
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.rng = options.rng ?? cryptoRng;
  }

  get size(): number {
    return this.rooms.size;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  create(tournament?: TournamentHooks): Room {
    let id = newRoomId();
    while (this.rooms.has(id)) id = newRoomId();
    const room = new Room(id, {
      clock: this.clock,
      timings: this.timings,
      rng: this.rng,
      newPlayerId,
      newToken,
      onChange: this.options.onChange,
      onExpired: (r) => this.delete(r.id),
      tournament,
    });
    this.rooms.set(id, room);
    return room;
  }

  delete(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    room.dispose();
    this.rooms.delete(id);
    this.options.onRemoved?.(room);
  }

  dispose(): void {
    for (const id of [...this.rooms.keys()]) this.delete(id);
  }
}
