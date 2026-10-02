import type { Clock } from '../src/room';

/** Deterministic clock: timers only fire when the test advances time. */
export class FakeClock implements Clock {
  private t = 1_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

/** Drives a started room to its end with random legal moves for whoever's turn it is. */
export async function playRoomToEnd(
  room: import('../src/room').Room,
  playerIds: string[],
  clock: FakeClock,
  nextHandMs: number,
  rng: () => number,
): Promise<void> {
  const { legalMoves } = await import('@domino/shared');
  for (let guard = 0; guard < 4000 && room.phase !== 'matchEnd'; guard++) {
    if (room.phase === 'handEnd') {
      clock.advance(nextHandMs);
      continue;
    }
    const turn = room.viewFor(playerIds[0] as string).game?.turn;
    const id = playerIds.find((p) => room.getPlayer(p)?.seat === turn) as string;
    const mine = room.viewFor(id).game;
    if (!mine) throw new Error('no game');
    const moves = legalMoves(mine.hand, mine.line);
    const move = moves[Math.floor(rng() * moves.length)];
    const r = move ? room.play(id, move.tile, move.end, room.version) : room.pass(id, room.version);
    if (!r.ok) throw new Error(`move rejected: ${r.code}`);
  }
}
