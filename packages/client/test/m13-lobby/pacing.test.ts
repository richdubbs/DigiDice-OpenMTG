/**
 * M13-12: the page sends commands no faster than the server takes them (src/hosted/pacing.ts): its table is the server's `COMMAND_LIMITS`
 * (packages/hosted/src/config.ts), each made 5% slower, and the pacer waits for a token, or refuses at once when the wait would be too long.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_LIMITS } from '../../../hosted/src/config';
import { bucketOf, PACE, Pacer } from '../../src/hosted/pacing';

describe('M13-12 pacing', () => {
  it('every paced bucket is the server\'s rate and burst, 5% slower', () => {
    for (const [bucket, pace] of Object.entries(PACE)) {
      const limit = COMMAND_LIMITS[bucket as keyof typeof COMMAND_LIMITS];
      expect(limit, bucket).toBeDefined();
      expect(pace.burst, bucket).toBe(limit.burst);
      expect(pace.everyMs, bucket).toBe(Math.ceil((1000 / limit.rate) * 1.05));
    }
  });

  it('queue and unqueue share a bucket, as on the server; a game\'s actions and chat are not paced here', () => {
    expect(bucketOf('unqueue')).toBe('queue');
    expect(bucketOf('queue')).toBe('queue');
    for (const t of ['act', 'chat', 'sync', 'hello', 'ping'] as const) expect(bucketOf(t), t).toBeNull();
  });

  it('a burst goes at once, the next waits for its token, and a wait past the limit takes nothing', () => {
    let t = 1_000;
    const p = new Pacer(() => t);
    // browse: a burst of 4, then one every 525 ms
    for (let i = 0; i < 4; i++) expect(p.reserve('browse')).toBe(0);
    expect(p.delay('browse')).toBe(525);
    expect(p.reserve('browse')).toBe(525);
    expect(p.reserve('browse')).toBe(1050);
    // report: one a minute; a second within it is refused with the time left, and nothing is taken
    expect(p.reserve('report', 0)).toBe(0);
    expect(p.reserve('report', 0)).toBe(-63_000);
    t += 63_000;
    expect(p.reserve('report', 0)).toBe(0);
    // a clock that goes back refills nothing
    t -= 100_000;
    expect(p.delay('report')).toBe(63_000);
  });
});
