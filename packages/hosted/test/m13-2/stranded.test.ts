/**
 * The stranded-player exception to the cancel cap (orchestrator decision on the M13-3 review): when the pending cancellable decision offers its player
 * no answer, a cancel past the 3 of the period is allowed, so an honest player is never stranded; such a cancel does not count toward the per-game
 * action cap (the seat's bank keeps running and bounds it), and a table rebuilt from the records counts the same. `offersNoAnswer` is replaced here
 * (vi.mock: a real stranded decision needs a broken card), its own rules are tested in config.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/table/check', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/table/check')>();
  return { ...real, offersNoAnswer: () => true };
});

const { TableActor } = await import('../../src/table');
const { fixtureConfig, Harness, toCast } = await import('./harness');

describe('M13-2: the stranded-player exception', () => {
  it('a cancel past the cap is allowed when the decision offers no answer, and it is not counted toward the action cap', () => {
    const config = fixtureConfig('m13-2-stranded', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Grizzly Bears': 20 });
    const h = new Harness({ config, game: 'stranded' });
    const cast = toCast(h, 'stranded');
    const seat = h.seatOf(h.state.pending!.player);
    const player = h.b(seat).player;
    const counted = h.actor.actions;
    for (let n = 1; n <= 5; n++) {
      expect(h.act(seat, cast.action).reply?.ok).toBe(true);
      const { reply, step } = h.act(seat, { type: 'cancel', player });
      expect(reply?.ok, `cancel ${n}`).toBe(true);
      expect(step.records.map((r) => r.action.type)).toEqual(['cancel']);
    }
    // 5 casts and 5 cancels; the last 2 cancels (past the cap of 3) are not counted
    expect(h.actor.actions).toBe(counted + 5 + 3);
    const last = h.records[h.records.length - 1]!;
    expect(last.clocks.find((c) => c.seat === seat)!.actions).toBe(h.records.filter((r) => r.seat === seat && r.action.type !== 'setStops').length - 2);
    const { actor } = TableActor.recover({ game: 'stranded', config, seating: [1, 2], at: h.at + 1_000, records: h.records });
    expect(actor.actions).toBe(h.actor.actions);
  });

  it('even stranded cancels have a ceiling per control period (10): the bank alone would not bound them under the action cap', () => {
    const config = fixtureConfig('m13-2-stranded-cap', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Grizzly Bears': 20 });
    const h = new Harness({ config, game: 'stranded-cap' });
    const cast = toCast(h, 'stranded-cap');
    const seat = h.seatOf(h.state.pending!.player);
    const player = h.b(seat).player;
    for (let n = 1; n <= 10; n++) {
      expect(h.act(seat, cast.action).reply?.ok).toBe(true);
      expect(h.act(seat, { type: 'cancel', player }).reply?.ok, `cancel ${n}`).toBe(true);
    }
    expect(h.act(seat, cast.action).reply?.ok).toBe(true);
    expect(h.act(seat, { type: 'cancel', player }).reply).toMatchObject({ ok: false, error: { code: 'limitReached' } });
  });
});
