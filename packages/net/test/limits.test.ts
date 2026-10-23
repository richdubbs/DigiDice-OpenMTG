/**
 * Rate limits (audit 2026-10-12, M4, M5, m6, m7): the token bucket, the per-address limiter and the guest's flood gate, driven by a fake clock and
 * fake timers. The gate is called directly with messages: no sockets, no traffic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GUEST_LIMITS, GuestGate, type GateHandlers } from '../src/game/limits';
import { KeyedLimiter, TokenBucket } from '../src/link/ratelimit';
import type { GuestMessage } from '../src/protocol/messages';

describe('token bucket', () => {
  it('allows the burst at once, then the rate; refills with time but never above the burst', () => {
    const b = new TokenBucket({ rate: 2, burst: 3 }, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.wait(0)).toBe(500);
    expect(b.take(499)).toBe(false);
    expect(b.take(500)).toBe(true);
    expect(b.full(10_000)).toBe(true);
    expect([b.take(10_000), b.take(10_000), b.take(10_000), b.take(10_000)]).toEqual([true, true, true, false]);
  });

  it('a clock that goes back adds nothing', () => {
    const b = new TokenBucket({ rate: 1, burst: 1 }, 1000);
    expect(b.take(1000)).toBe(true);
    expect(b.take(0)).toBe(false);
  });
});

describe('keyed limiter (handshakes per source address, audit m6)', () => {
  it('limits each key and all keys together', () => {
    const l = new KeyedLimiter({ rate: 1, burst: 2 }, { rate: 1, burst: 3 }, 0);
    expect([l.take('a', 0), l.take('a', 0), l.take('a', 0)]).toEqual([true, true, false]);
    expect([l.take('b', 0), l.take('c', 0)]).toEqual([true, false]); // the shared bucket is spent
  });

  it('stays bounded: past maxKeys, idle buckets are forgotten, and if none is idle the map is cleared', () => {
    const l = new KeyedLimiter({ rate: 1, burst: 1 }, { rate: 1e9, burst: 1e9 }, 0, 100);
    for (let i = 0; i < 1000; i++) l.take(`k${i}`, 0);
    expect(l.size).toBeLessThanOrEqual(100);
    l.prune(1_000_000);
    expect(l.size).toBe(0);
  });
});

describe('guest flood gate (audit M4, M5)', () => {
  let t = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
  });
  afterEach(() => vi.useRealTimers());

  const action = (id: number): GuestMessage => ({ v: 1, type: 'action', id, seq: 0, action: { type: 'pass', player: 'p2' } }) as GuestMessage;
  const sync = { v: 1, type: 'sync' } as GuestMessage;
  const chat = { v: 1, type: 'chat', text: 'hi' } as GuestMessage;

  /** `throwOn`: the run handler throws for these action ids; `syncThrows`: the sync handler throws. */
  function gate(limits = {}, opts: { throwOn?: number[]; syncThrows?: boolean } = {}) {
    const log = { run: [] as GuestMessage[], refused: [] as string[], syncs: 0, abused: 0, failed: [] as string[] };
    const h: GateHandlers = {
      run: (m) => {
        log.run.push(m);
        if (m.type === 'action' && opts.throwOn?.includes(m.id)) throw new RangeError(`handler failed on ${m.id}`);
      },
      refuse: (m) => void log.refused.push(m.type),
      sync: () => {
        log.syncs++;
        if (opts.syncThrows) throw new Error('view failed');
      },
      abuse: () => void log.abused++,
      fail: (e) => void log.failed.push(e instanceof Error ? e.message : String(e)),
    };
    const advance = (ms: number) => {
      t += ms;
      vi.advanceTimersByTime(ms);
    };
    return { g: new GuestGate({ ...DEFAULT_GUEST_LIMITS, ...limits }, h, () => t), log, advance };
  }

  it('runs actions within the burst at once, queues the next ones in order and runs them as tokens come back', () => {
    const { g, log, advance } = gate({ actions: { rate: 10, burst: 3 }, queue: 5 });
    for (let i = 1; i <= 6; i++) g.offer(action(i));
    expect(log.run.map((m) => (m as { id: number }).id)).toEqual([1, 2, 3]);
    expect(g.queued).toBe(3);
    advance(100);
    expect(log.run).toHaveLength(4);
    advance(250);
    expect(log.run.map((m) => (m as { id: number }).id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(log.refused).toEqual([]);
  });

  it('refuses actions that find the queue full (rateLimited), and closes a connection that keeps it up', () => {
    const { g, log } = gate({ actions: { rate: 1, burst: 1 }, queue: 2, strikes: { rate: 1, burst: 3 } });
    for (let i = 1; i <= 6; i++) g.offer(action(i));
    expect(log.run).toHaveLength(1);
    expect(g.queued).toBe(2);
    expect(log.refused).toEqual(['action', 'action', 'action']);
    expect(log.abused).toBe(0);
    g.offer(action(7)); // the fourth refusal in a burst of three strikes
    expect(log.abused).toBe(1);
    g.offer(action(8)); // a stopped gate takes nothing
    expect(log.run).toHaveLength(1);
  });

  it('answers at most one sync per syncEveryMs: the syncs in between get one answer at its end', () => {
    const { g, log, advance } = gate({ syncEveryMs: 500 });
    g.offer(sync);
    expect(log.syncs).toBe(1);
    for (let i = 0; i < 20; i++) g.offer(sync);
    expect(log.syncs).toBe(1);
    advance(499);
    expect(log.syncs).toBe(1);
    advance(1);
    expect(log.syncs).toBe(2);
    advance(5000);
    expect(log.syncs).toBe(2);
    g.offer(sync);
    expect(log.syncs).toBe(3);
  });

  it('caps chat at a few messages per second; a bye always goes through', () => {
    const { g, log, advance } = gate({ chat: { rate: 2, burst: 3 } });
    for (let i = 0; i < 5; i++) g.offer(chat);
    expect(log.run).toHaveLength(3);
    expect(log.refused).toEqual(['chat', 'chat']);
    advance(500);
    g.offer(chat);
    expect(log.run).toHaveLength(4);
    g.offer({ v: 1, type: 'bye', reason: 'x' } as GuestMessage);
    expect(log.run.at(-1)?.type).toBe('bye');
  });

  it('stop() forgets the queue and cancels the timers', () => {
    const { g, log, advance } = gate({ actions: { rate: 1, burst: 1 }, syncEveryMs: 500 });
    g.offer(action(1));
    g.offer(action(2));
    g.offer(sync);
    g.offer(sync);
    g.stop();
    advance(10_000);
    expect(log.run).toHaveLength(1);
    expect(log.syncs).toBe(1);
  });

  it('C4: a run handler that throws for a queued message closes through fail(); nothing escapes the drain timer', () => {
    const { g, log, advance } = gate({ actions: { rate: 10, burst: 2 }, queue: 5 }, { throwOn: [3] });
    for (let i = 1; i <= 5; i++) g.offer(action(i));
    expect(log.run).toHaveLength(2);
    expect(() => advance(1000)).not.toThrow();
    expect(log.run.map((m) => (m as { id: number }).id)).toEqual([1, 2, 3]); // the gate stopped at the failure
    expect(log.failed).toEqual(['handler failed on 3']);
    g.offer(action(6));
    expect(log.run).toHaveLength(3);
  });

  it('C4: a sync handler that throws from the sync timer closes through fail(); nothing escapes the timer', () => {
    const { g, log, advance } = gate({ syncEveryMs: 500 }, { syncThrows: true });
    g.offer(sync); // answered at once: the failure goes to fail() too
    expect(log.failed).toEqual(['view failed']);
    expect(log.syncs).toBe(1);
    // The delayed answer: the first sync is answered at once without failing, the second one from the timer fails.
    let n = 0;
    const h: GateHandlers = {
      run: () => undefined, refuse: () => undefined, abuse: () => undefined,
      sync: () => {
        if (++n === 2) throw new Error('view failed later');
      },
      fail: (e) => void log.failed.push((e as Error).message),
    };
    const delayed = new GuestGate({ ...DEFAULT_GUEST_LIMITS, syncEveryMs: 500 }, h, () => t);
    delayed.offer(sync);
    delayed.offer(sync);
    expect(() => advance(500)).not.toThrow();
    expect(n).toBe(2);
    expect(log.failed).toEqual(['view failed', 'view failed later']);
    delayed.offer(sync);
    advance(1000);
    expect(n).toBe(2); // stopped
  });

  it('M4: stop changes (setStops) have their own, smaller bucket; past it they are refused as rateLimited', () => {
    const { g, log, advance } = gate({ stops: { rate: 1, burst: 2 } });
    const stops = (id: number) => ({ v: 1, type: 'action', id, seq: 0, action: { type: 'setStops', player: 'p2', stops: { ownTurn: [], opponentTurn: [], fullControl: id % 2 === 0 } } }) as GuestMessage;
    for (let i = 1; i <= 4; i++) g.offer(stops(i));
    expect(log.run).toHaveLength(2);
    expect(log.refused).toEqual(['action', 'action']);
    g.offer(action(5)); // other actions are not affected
    expect(log.run).toHaveLength(3);
    advance(1000);
    g.offer(stops(6));
    expect(log.run).toHaveLength(4);
  });

  it('strike(): messages that fail validation count as strikes, so a connection that keeps sending them is closed', () => {
    const { g, log } = gate({ strikes: { rate: 1, burst: 3 } });
    for (let i = 0; i < 3; i++) g.strike();
    expect(log.abused).toBe(0);
    g.strike();
    expect(log.abused).toBe(1);
    g.strike();
    expect(log.abused).toBe(1);
  });
});
