/**
 * Sliding-window limiter for FAILED attempts (unknown tournament IDs, unknown names…).
 * Successful requests are never counted, so legitimate players are not affected.
 */
export class FailureLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Milliseconds until `key` may try again, or 0 when it is not blocked. */
  blockedFor(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    const oldest = list[list.length - this.max] as number;
    return Math.max(1, oldest + this.windowMs - this.now());
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    // Bound memory: a flood of distinct keys cannot grow the map without limit.
    if (this.hits.size > 10_000) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
  }

  /** Counts an attempt and reports whether it is allowed (for actions limited regardless of outcome). */
  hit(key: string): number {
    const wait = this.blockedFor(key);
    if (wait === 0) this.fail(key);
    return wait;
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}
