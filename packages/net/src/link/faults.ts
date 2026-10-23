/**
 * Fault injection for tests and for trying the link on a bad network (`--loss` in the CLI): wraps a datagram send function and drops,
 * duplicates or delays (and so reorders) datagrams with the given probabilities, from a seeded generator so a failing run can be repeated.
 * `blackhole` drops everything (a cable pulled out).
 */
export interface FaultConfig {
  /** Probability (0..1) that a datagram is dropped. */
  loss?: number;
  /** Probability that a datagram is sent twice. */
  duplicate?: number;
  /** Probability that a datagram is held back for a random time up to maxDelayMs (it then overtakes nothing or is overtaken: reordering). */
  delay?: number;
  maxDelayMs?: number;
  /** Drop every datagram. */
  blackhole?: boolean;
  seed?: number;
}

export interface FaultStats {
  passed: number;
  dropped: number;
  duplicated: number;
  delayed: number;
}

export type Scheduler = (fn: () => void, ms: number) => void;

const defaultScheduler: Scheduler = (fn, ms) => {
  setTimeout(fn, ms).unref();
};

export class FaultInjector {
  readonly stats: FaultStats = { passed: 0, dropped: 0, duplicated: 0, delayed: 0 };
  private state: number;

  constructor(public config: FaultConfig = {}, private readonly schedule: Scheduler = defaultScheduler) {
    this.state = (config.seed ?? 1) >>> 0;
  }

  /** mulberry32 */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  wrap<R>(send: (buf: Buffer, to: R) => void): (buf: Buffer, to: R) => void {
    return (buf, to) => {
      const c = this.config;
      if (c.blackhole || this.random() < (c.loss ?? 0)) {
        this.stats.dropped++;
        return;
      }
      const copies = this.random() < (c.duplicate ?? 0) ? 2 : 1;
      if (copies === 2) this.stats.duplicated++;
      for (let i = 0; i < copies; i++) {
        if (this.random() < (c.delay ?? 0)) {
          this.stats.delayed++;
          const copy = Buffer.from(buf);
          this.schedule(() => send(copy, to), 1 + Math.floor(this.random() * (c.maxDelayMs ?? 50)));
        } else {
          this.stats.passed++;
          send(buf, to);
        }
      }
    };
  }
}
