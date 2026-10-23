/**
 * The timer wheel (design 2.1, 4.4): one deadline per table, kept by the main thread, which sets a single real timer for `next()` and, when it fires,
 * sends `tick` to the tables `due(now)` returns (then re-arms each with its clock's `nextDeadline()`). Pure: no timers inside; `now` comes from the
 * caller. Ties are ordered by key, so the order is deterministic.
 *
 * Inputs stamped at an instant go to a table before that instant's tick (the clock's same-instant rule, `table-clock.ts`): the caller delivers the
 * messages it has received before it processes `due(now)`.
 */
interface Entry<K> {
  key: K;
  at: number;
  gen: number;
}

export class TimerWheel<K extends string = string> {
  private readonly current = new Map<K, { at: number; gen: number }>();
  private heap: Entry<K>[] = [];
  private gen = 0;

  /** Sets (or replaces) the key's deadline; null removes it. */
  set(key: K, at: number | null): void {
    if (at === null || !Number.isFinite(at)) {
      this.current.delete(key);
      return;
    }
    const prev = this.current.get(key);
    if (prev && prev.at === at) return;
    const gen = ++this.gen;
    this.current.set(key, { at, gen });
    this.push({ key, at, gen });
    // Lazy deletion leaves stale entries; rebuild when they outnumber the live ones.
    if (this.heap.length > 64 && this.heap.length > 2 * this.current.size) this.rebuild();
  }

  delete(key: K): void {
    this.current.delete(key);
  }

  get(key: K): number | null {
    return this.current.get(key)?.at ?? null;
  }

  get size(): number {
    return this.current.size;
  }

  /** The earliest deadline, or null. */
  next(): number | null {
    this.dropStale();
    return this.heap[0]?.at ?? null;
  }

  /** Removes and returns the keys whose deadline is at or before `now`, earliest first, ties by key. */
  due(now: number): K[] {
    const out: K[] = [];
    for (;;) {
      this.dropStale();
      const top = this.heap[0];
      if (!top || top.at > now) break;
      this.pop();
      this.current.delete(top.key);
      out.push(top.key);
    }
    return out;
  }

  private stale(e: Entry<K>): boolean {
    const c = this.current.get(e.key);
    return !c || c.gen !== e.gen;
  }

  private dropStale(): void {
    while (this.heap.length > 0 && this.stale(this.heap[0]!)) this.pop();
  }

  private rebuild(): void {
    this.heap = [...this.current].map(([key, c]) => ({ key, at: c.at, gen: c.gen }));
    for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) this.down(i);
  }

  private less(a: Entry<K>, b: Entry<K>): boolean {
    return a.at < b.at || (a.at === b.at && a.key < b.key);
  }

  private push(e: Entry<K>): void {
    const h = this.heap;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private pop(): void {
    const h = this.heap;
    const last = h.pop()!;
    if (h.length === 0) return;
    h[0] = last;
    this.down(0);
  }

  private down(i: number): void {
    const h = this.heap;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
      if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }
}
