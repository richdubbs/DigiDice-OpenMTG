/**
 * M13-6 review 3: what a connection that was put behind gets when it has drained (design 3.5): its fresh full view is a `sync` with no id, and the clocks go
 * with it (a `clock` message is dropped while behind and is only sent when a clock changes: the catch-up must bring it). Table level: the actor's answer.
 */
import { describe, expect, it } from 'vitest';
import { configOf, DECKS, Harness, MIN } from '../m13-2/harness';

describe('M13-6 the catch-up of a connection that was behind', () => {
  it('a sync with no id sends the full view and the clocks, to the seat that asked', () => {
    const h = new Harness({ config: configOf('catchup-1', DECKS[0]!, DECKS[1]!) });
    // some game time has passed, so the clock reading is not the opening one
    h.at += 3 * MIN;
    const step = h.cmd({ t: 'sync', seat: 1, at: h.at });
    const kinds = step.sends.filter((s) => s.seat === 1).map((s) => s.t);
    expect(kinds.filter((t) => t === 'view')).toHaveLength(1);
    expect(kinds).toContain('clock');
    expect(kinds.indexOf('view')).toBeLessThan(kinds.indexOf('clock'));
    const clock = h.sent(step, 1, 'clock')[0]!;
    expect(clock.at).toBe(h.at);
    expect(clock.seats).toHaveLength(2);
  });

  it('a sync that carries an id is the browser asking for the view again: the view and its reply', () => {
    const h = new Harness({ config: configOf('catchup-2', DECKS[0]!, DECKS[1]!) });
    const step = h.cmd({ t: 'sync', seat: 2, at: h.at, id: 7 });
    expect(h.sent(step, 2, 'view')).toHaveLength(1);
    expect(h.sent(step, 2, 'reply')).toEqual([{ t: 'reply', id: 7, ok: true }]);
  });
});
