/**
 * Rate limits (audit 2026-10-12: M4, M5, m6, m7). A token bucket allows a sustained `rate` per second with bursts up to `burst`; time is passed in
 * (milliseconds, any monotonic clock) so the limits are tested with a fake clock.
 */

export interface RateConfig {
  /** Tokens added per second. */
  rate: number;
  /** Tokens held at most (the largest burst). */
  burst: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly config: RateConfig, now: number) {
    this.tokens = config.burst;
    this.last = now;
  }

  private refill(now: number): void {
    if (now > this.last) {
      this.tokens = Math.min(this.config.burst, this.tokens + ((now - this.last) / 1000) * this.config.rate);
      this.last = now;
    }
  }

  /** Take one token if there is one. */
  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Milliseconds until a token is available (0: now). */
  wait(now: number): number {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.config.rate) * 1000);
  }

  /** True when the bucket is full again (nothing taken recently): it can be forgotten. */
  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.config.burst;
  }
}

/**
 * One bucket per key (a source address), plus one bucket shared by every key (source addresses of UDP can be forged). The map is bounded: when it
 * is full, buckets that are full again are forgotten, and if none is, the whole map is (a flood of forged addresses then meets only the shared limit).
 */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly all: TokenBucket;

  constructor(private readonly each: RateConfig, total: RateConfig, now: number, private readonly maxKeys = 4096) {
    this.all = new TokenBucket(total, now);
  }

  take(key: string, now: number): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      b = new TokenBucket(this.each, now);
      this.buckets.set(key, b);
    }
    return b.take(now) && this.all.take(now);
  }

  get size(): number {
    return this.buckets.size;
  }

  prune(now: number): void {
    for (const [k, b] of this.buckets) if (b.full(now)) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}
