/**
 * M14-5: the fixed-size counter maps of design 8.2 rule 6. Each map holds at most `max` entries (ACCOUNT_RATE_LIMITS.counterEntries, 100,000). When
 * it is full and a new key needs an entry: idle entries go first (an hour without a failure), then entries not in back-off, oldest first; an entry in
 * back-off is never dropped; if nothing can go, the new key is not tracked (the caller answers rateLimited for a minute and logs it).
 *
 * Entries are kept in the order of their last update (a Map re-inserted on every update), so the oldest are at the front and eviction reads from
 * there. One eviction frees a small batch, so a full map does not scan itself again for every new key.
 */

export interface CounterEntry {
  /** The time of the entry's last failure (milliseconds). */
  lastFailureAt: number;
}

export class CounterMap<V extends CounterEntry> {
  private readonly entries = new Map<string, V>();

  /**
   * @param max entries at most.
   * @param idleMs an entry without a failure for this long is idle (8.2 rule 6: an hour).
   * @param inBackoff whether an entry is in back-off at `now` (never dropped).
   */
  constructor(private readonly max: number, private readonly idleMs: number, private readonly inBackoff: (v: V, now: number) => boolean) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Whether `key` has an entry or one can be made for it now (evicting as rule 6 says when the map is full). */
  room(key: string, now: number): boolean {
    if (this.entries.has(key) || this.entries.size < this.max) return true;
    this.evict(now);
    return this.entries.size < this.max;
  }

  /** Stores `v` under `key` as its newest entry; false (nothing stored) when the map is full and nothing can go. */
  set(key: string, v: V, now: number): boolean {
    if (!this.room(key, now)) return false;
    this.entries.delete(key);
    this.entries.set(key, v);
    return true;
  }

  /** Drops idle entries that are not in back-off (the host's tick keeps the maps small). */
  sweep(now: number): number {
    let n = 0;
    for (const [k, v] of this.entries) {
      if (now - v.lastFailureAt < this.idleMs) break;
      if (this.inBackoff(v, now)) continue;
      this.entries.delete(k);
      n++;
    }
    return n;
  }

  private evict(now: number): void {
    const batch = Math.max(1, Math.floor(this.max / 100));
    let freed = 0;
    // idle entries first (they are at the front: the map is ordered by last update)
    for (const [k, v] of this.entries) {
      if (freed >= batch || now - v.lastFailureAt < this.idleMs) break;
      if (this.inBackoff(v, now)) continue;
      this.entries.delete(k);
      freed++;
    }
    if (freed > 0) return;
    // then entries not in back-off, oldest first
    for (const [k, v] of this.entries) {
      if (freed >= batch) break;
      if (this.inBackoff(v, now)) continue;
      this.entries.delete(k);
      freed++;
    }
  }
}

/**
 * Failures in the last hour, by minute: a short list of [minute, count] pairs (only minutes with failures), so an entry stays small for the names
 * nobody attacks. The count is accurate to a minute.
 */
export class HourCount {
  private readonly minutes: number[] = [];
  private readonly counts: number[] = [];

  constructor(private readonly windowMs = 3_600_000) {}

  add(now: number): void {
    const m = Math.floor(now / 60_000);
    this.prune(now);
    const last = this.minutes.length - 1;
    if (last >= 0 && this.minutes[last] === m) this.counts[last]! += 1;
    else {
      this.minutes.push(m);
      this.counts.push(1);
    }
  }

  count(now: number): number {
    this.prune(now);
    let n = 0;
    for (const c of this.counts) n += c;
    return n;
  }

  private prune(now: number): void {
    const oldest = Math.floor((now - this.windowMs) / 60_000);
    let drop = 0;
    while (drop < this.minutes.length && this.minutes[drop]! <= oldest) drop++;
    if (drop > 0) {
      this.minutes.splice(0, drop);
      this.counts.splice(0, drop);
    }
  }
}
