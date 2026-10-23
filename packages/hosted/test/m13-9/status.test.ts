/** Status (design 4.5): how many wait (rounded) and an estimate from the recent match rate; never who. Metrics of the queues. */
import { describe, expect, it } from 'vitest';
import { MATCH_RATE_WINDOW_MS } from '../../src/match';
import { MIN, POD, Rig, SEC, STANDARD } from './helpers';

describe('M13-9: queueStatus numbers', () => {
  it('the count is rounded: as it is up to 5, then to the nearest 5', () => {
    const r = new Rig();
    const seen: [number, number][] = [];
    for (let n = 1; n <= 13; n++) {
      r.join(`s${n}`, { key: POD });
      seen.push([n, r.matcher.status(POD, r.now).waiting]);
    }
    expect(seen).toEqual([
      [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 5], [7, 5], [8, 10], [9, 10], [10, 10], [11, 10], [12, 10], [13, 15],
    ]);
  });

  it('it says how many wait and for how long, and nothing else: never who', () => {
    const r = new Rig();
    r.join('secret-session-name');
    const s = r.matcher.status(STANDARD, r.now);
    expect(Object.keys(s).sort()).toEqual(['estimatedWaitMs', 'waiting']);
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('a queue nobody entered, and a key that is no queue, show nothing', () => {
    const r = new Rig();
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 0, estimatedWaitMs: null });
    expect(r.matcher.status({ format: 'standard', size: 'pod' }, r.now)).toEqual({ waiting: 0, estimatedWaitMs: null });
    expect(r.matcher.status(null as never, r.now)).toEqual({ waiting: 0, estimatedWaitMs: null });
  });

  it('no estimate before the queue has matched anybody; then the waiting over the players matched in the last 10 minutes, times 10 minutes', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c']);
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 3, estimatedWaitMs: null });
    r.tick(); // a and b matched: 2 players in the window; c waits
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 1, estimatedWaitMs: 5 * MIN });
    r.joinAll(['d', 'e', 'f'], { key: STANDARD });
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 4, estimatedWaitMs: 20 * MIN });
  });

  it('an empty queue still counts the player who asks: one more must come', () => {
    const r = new Rig();
    r.joinAll(['a', 'b']);
    r.tick();
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 0, estimatedWaitMs: 5 * MIN });
  });

  it('the match rate is over the last 10 minutes: a match leaves the window after exactly 10 minutes', () => {
    const r = new Rig();
    expect(MATCH_RATE_WINDOW_MS).toBe(10 * MIN);
    r.joinAll(['a', 'b']);
    r.tick();
    r.advance(5 * MIN);
    r.joinAll(['c', 'd']);
    r.tick(); // 4 players in the window
    r.join('e');
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 1, estimatedWaitMs: Math.ceil((1 / 4) * 10 * MIN) });
    r.advance(5 * MIN - 1);
    expect(r.matcher.status(STANDARD, r.now).estimatedWaitMs).toBe(Math.ceil((1 / 4) * 10 * MIN)); // the first match is 9:59.999 old
    r.advance(1);
    expect(r.matcher.status(STANDARD, r.now).estimatedWaitMs).toBe(Math.ceil((1 / 2) * 10 * MIN)); // 10:00: it has left the window
    r.advance(5 * MIN);
    expect(r.matcher.status(STANDARD, r.now).estimatedWaitMs).toBeNull(); // the second one too
  });

  it('every queue has its own rate: a busy queue does not shorten a quiet one', () => {
    const r = new Rig();
    r.joinAll(['a', 'b']);
    r.tick();
    r.join('c', { key: { format: 'pauper', size: 2 } });
    expect(r.matcher.status({ format: 'pauper', size: 2 }, r.now)).toEqual({ waiting: 1, estimatedWaitMs: null });
  });

  it('a pod counts its players: a pod of 4 matched, two waiting: half the window', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd', 'e', 'f'], { key: POD });
    r.tick();
    expect(r.matcher.status(POD, r.now)).toEqual({ waiting: 2, estimatedWaitMs: 5 * MIN });
  });

  it('a failed ready check does not take its match out of the rate (as in the ranked matcher)', () => {
    const r = new Rig();
    r.joinAll(['a', 'b']);
    const [m] = r.tick();
    r.matcher.requeueFront(m!.entries, r.now);
    expect(r.matcher.status(STANDARD, r.now)).toEqual({ waiting: 2, estimatedWaitMs: 10 * MIN });
  });
});

describe('M13-9: metrics', () => {
  it('the queue gauge follows enter, leave and matches, by format and size; the wait is observed per matched entry', () => {
    const r = new Rig();
    const gauge = (format: string, size: string) => r.metrics.values.get(`openmtg_hosted_match_queue{format="${format}",size="${size}"}`);
    r.join('a');
    expect(gauge('standard', '2')).toBe(1);
    r.advance(4 * SEC);
    r.join('b');
    r.join('c');
    expect(gauge('standard', '2')).toBe(3);
    r.matcher.leave('c');
    expect(gauge('standard', '2')).toBe(2);
    r.advance(SEC);
    r.tick();
    expect(gauge('standard', '2')).toBe(0);
    expect(r.metrics.observations.get('openmtg_hosted_match_wait_seconds{format="standard",size="2"}')).toEqual([5, 1]);
    r.join('p', { key: POD });
    expect(gauge('commander', 'pod')).toBe(1);
  });
});
