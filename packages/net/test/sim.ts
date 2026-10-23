/** A simulated network with a fake clock: two Channels joined by a wire with latency and injected faults (loss, duplication, reordering). */
import { Channel, DEFAULT_LINK_OPTIONS, type LinkOptions } from '../src/link/channel';
import { FaultInjector, type FaultConfig } from '../src/link/faults';

interface Scheduled {
  at: number;
  order: number;
  fn: () => void;
}

export class SimNet {
  now = 0;
  private events: Scheduled[] = [];
  private order = 0;

  schedule(fn: () => void, ms: number): void {
    this.events.push({ at: this.now + ms, order: this.order++, fn });
  }

  /** Run due events, oldest first. */
  private runDue(): void {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.events.length; i++) {
        const e = this.events[i]!;
        if (e.at > this.now) continue;
        if (best < 0 || e.at < this.events[best]!.at || (e.at === this.events[best]!.at && e.order < this.events[best]!.order)) best = i;
      }
      if (best < 0) return;
      const [e] = this.events.splice(best, 1);
      e!.fn();
    }
  }

  /** Advance time in steps, ticking the given channels, until `done()` or `maxMs` passed. Returns the time spent. */
  run(channels: Channel[], done: () => boolean, maxMs: number, step = 5): number {
    const start = this.now;
    while (!done() && this.now - start < maxMs) {
      this.now += step;
      this.runDue();
      for (const c of channels) c.tick(this.now);
    }
    return this.now - start;
  }
}

export interface SimEnd {
  channel: Channel;
  received: unknown[];
  dead: string | null;
  faults: FaultInjector;
}

/** Two channels over the simulated net; each direction has its own fault injector (same config, different seeds). */
export function simPair(net: SimNet, faults: FaultConfig, options: Partial<LinkOptions> = {}, latencyMs = 10): { a: SimEnd; b: SimEnd } {
  const opts: LinkOptions = { ...DEFAULT_LINK_OPTIONS, tickMs: 5, ...options };
  const make = (seed: number): SimEnd => {
    const end = { received: [] as unknown[], dead: null as string | null, faults: new FaultInjector({ ...faults, seed }, (fn, ms) => net.schedule(fn, ms)) } as SimEnd;
    return end;
  };
  const a = make(faults.seed ?? 1);
  const b = make((faults.seed ?? 1) + 1000);
  const wire = (from: SimEnd, to: () => SimEnd) =>
    from.faults.wrap((buf: Buffer) => net.schedule(() => to().channel.receive(buf, net.now), latencyMs));
  const sendA = wire(a, () => b);
  const sendB = wire(b, () => a);
  a.channel = new Channel({ transmit: (p) => sendA(p, null), message: (m) => a.received.push(m), dead: (r) => (a.dead = r) }, opts, net.now);
  b.channel = new Channel({ transmit: (p) => sendB(p, null), message: (m) => b.received.push(m), dead: (r) => (b.dead = r) }, opts, net.now);
  return { a, b };
}

/** Deterministic pseudo-random text that zlib cannot shrink much. */
export function noise(bytes: number, seed = 7): string {
  let s = seed >>> 0;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += chars[s >>> 26];
  }
  return out;
}
