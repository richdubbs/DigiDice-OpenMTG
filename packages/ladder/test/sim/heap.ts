/**
 * M15-6: the simulation's event queue, a binary heap by (time, class, sequence): events at the same time run in the order they were scheduled,
 * except that `late` events (the matcher's ticks) run after every other event of that millisecond.
 */
export class EventHeap<T> {
  readonly #t: number[] = [];
  readonly #late: boolean[] = [];
  readonly #seq: number[] = [];
  readonly #v: T[] = [];
  #next = 0;

  get size(): number {
    return this.#v.length;
  }

  push(t: number, v: T, late = false): void {
    this.#t.push(t);
    this.#late.push(late);
    this.#seq.push(this.#next++);
    this.#v.push(v);
    this.#up(this.#v.length - 1);
  }

  /** The earliest time, or Infinity when empty. */
  peekTime(): number {
    return this.#v.length === 0 ? Infinity : this.#t[0]!;
  }

  pop(): { t: number; v: T } | undefined {
    if (this.#v.length === 0) return undefined;
    const out = { t: this.#t[0]!, v: this.#v[0]! };
    const last = this.#v.length - 1;
    this.#swap(0, last);
    this.#t.pop();
    this.#late.pop();
    this.#seq.pop();
    this.#v.pop();
    if (this.#v.length > 0) this.#down(0);
    return out;
  }

  #less(i: number, j: number): boolean {
    if (this.#t[i] !== this.#t[j]) return this.#t[i]! < this.#t[j]!;
    if (this.#late[i] !== this.#late[j]) return !this.#late[i];
    return this.#seq[i]! < this.#seq[j]!;
  }

  #swap(i: number, j: number): void {
    [this.#t[i], this.#t[j]] = [this.#t[j]!, this.#t[i]!];
    [this.#late[i], this.#late[j]] = [this.#late[j]!, this.#late[i]!];
    [this.#seq[i], this.#seq[j]] = [this.#seq[j]!, this.#seq[i]!];
    [this.#v[i], this.#v[j]] = [this.#v[j]!, this.#v[i]!];
  }

  #up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(i, p)) return;
      this.#swap(i, p);
      i = p;
    }
  }

  #down(i: number): void {
    const n = this.#v.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.#less(l, m)) m = l;
      if (r < n && this.#less(r, m)) m = r;
      if (m === i) return;
      this.#swap(i, m);
      i = m;
    }
  }
}
