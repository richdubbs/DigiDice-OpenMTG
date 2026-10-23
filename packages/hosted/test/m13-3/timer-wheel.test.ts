/** The timer wheel (design 2.1, 4.4): one deadline per table, earliest first, ties by key; it drives the table clocks with a fake clock. */
import { describe, expect, it } from 'vitest';
import { createTableClock, TimerWheel, type TableClock } from '../../src/clock';
import { brief, MIN, SEC, seat } from './helpers';

describe('M13-3: TimerWheel', () => {
  it('returns due keys earliest first, ties by key, and removes them', () => {
    const w = new TimerWheel();
    w.set('b', 100);
    w.set('a', 100);
    w.set('c', 50);
    w.set('d', 300);
    expect(w.size).toBe(4);
    expect(w.next()).toBe(50);
    expect(w.due(49)).toEqual([]);
    expect(w.due(100)).toEqual(['c', 'a', 'b']);
    expect(w.due(100)).toEqual([]);
    expect(w.next()).toBe(300);
    expect(w.size).toBe(1);
  });

  it('replacing a deadline (earlier or later), deleting, and null', () => {
    const w = new TimerWheel();
    w.set('a', 100);
    w.set('a', 500);
    w.set('b', 200);
    expect(w.due(300)).toEqual(['b']);
    w.set('a', 10);
    expect(w.get('a')).toBe(10);
    expect(w.next()).toBe(10);
    w.set('a', null);
    expect(w.next()).toBeNull();
    w.set('c', 5);
    w.delete('c');
    expect(w.due(1_000)).toEqual([]);
    w.set('e', Number.POSITIVE_INFINITY);
    expect(w.size).toBe(0);
  });

  it('agrees with a plain model over many updates (stale entries are dropped and rebuilt)', () => {
    const w = new TimerWheel();
    const model = new Map<string, number>();
    let x = 12345;
    const rnd = (n: number): number => {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      return x % n;
    };
    let now = 0;
    for (let i = 0; i < 5_000; i++) {
      const key = `t${rnd(40)}`;
      const op = rnd(10);
      if (op < 6) {
        const at = now + rnd(1_000);
        w.set(key, at);
        model.set(key, at);
      } else if (op < 7) {
        w.delete(key);
        model.delete(key);
      } else {
        now += rnd(300);
        const expected = [...model].filter(([, at]) => at <= now).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
        for (const k of expected) model.delete(k);
        expect(w.due(now)).toEqual(expected);
      }
      const min = model.size === 0 ? null : Math.min(...model.values());
      expect(w.next()).toBe(min);
      expect(w.size).toBe(model.size);
    }
  });

  it('drives several tables\' clocks with a fake clock: each expiry at its own instant', () => {
    const wheel = new TimerWheel();
    const tables = new Map<string, TableClock>();
    const log: string[] = [];
    const arm = (id: string): void => wheel.set(id, tables.get(id)!.nextDeadline());

    const a = createTableClock({ seats: 2, at: 0 });
    a.handle({ type: 'decision', at: 0, seat: seat(1) });
    const b = createTableClock({ seats: 3, at: 0 });
    b.handle({ type: 'decision', at: 0, seat: seat(2) });
    b.handle({ type: 'disconnect', at: 0, seat: seat(3) });
    tables.set('a', a).set('b', b);
    arm('a');
    arm('b');

    // The main thread's loop: wait for the earliest deadline, tick the due tables, re-arm them.
    for (let i = 0; i < 100; i++) {
      const now = wheel.next();
      if (now === null || now > 3 * 60 * MIN) break;
      for (const id of wheel.due(now)) {
        log.push(...brief(tables.get(id)!.handle({ type: 'tick', at: now }).outcomes).map((o) => `${id}:${o}`));
        arm(id);
      }
    }
    expect(log).toEqual([
      `b:forfeit:3@${5 * MIN}`,
      `a:timeout:1@${5 * SEC + 15 * MIN}`,
      `b:timeout:2@${5 * SEC + 20 * MIN}`,
    ]);
    expect(wheel.size).toBe(0);
  });
});
