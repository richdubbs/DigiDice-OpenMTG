/**
 * M13-2 review minors (b) and (c), with module stand-ins (vi.mock; this file runs isolated):
 * (b) a failure after the engine's apply (building a seat's view) leaves the table as it was: no record, the same seq and state, an engineError reply;
 * (c) a cancel refused for size is not counted by the clock (the 3 cancels of the period stay available).
 */
import { describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ viewBoom: false, sizeBoom: 0 }));

vi.mock('@openmtg/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@openmtg/engine')>();
  return { ...real, viewFor: (...a: Parameters<typeof real.viewFor>) => { if (flags.viewBoom) throw new Error('boom'); return real.viewFor(...a); } };
});
vi.mock('../../src/table/limits', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/table/limits')>();
  return { ...real, sizeProblem: (...a: Parameters<typeof real.sizeProblem>) => (flags.sizeBoom > 0 && flags.sizeBoom-- > 0 ? 'too big (test)' : real.sizeProblem(...a)) };
});

const { fixtureConfig, Harness, replyIn, toCast } = await import('./harness');

describe('M13-2 review minors (b) and (c)', () => {
  it('(b) a failure while building the views after the apply rolls the action back', () => {
    const h = new Harness({ config: fixtureConfig('m13-2-rollback', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Grizzly Bears': 20 }), game: 'rb', scan: false });
    toCast(h, 'rb');
    const seat = h.seatOf(h.state.pending!.player);
    const before = JSON.stringify(h.state);
    const seq = h.actor.seq;
    const lastId = h.actor.lastActId(seat);
    flags.viewBoom = true;
    const step = h.actor.handle({ t: 'act', seat, at: h.at + 1, id: 900, seq, action: { type: 'pass', player: h.b(seat).player } });
    flags.viewBoom = false;
    expect(step.records).toEqual([]);
    expect(replyIn(step, seat, 900)).toMatchObject({ ok: false, error: { code: 'engineError' } });
    expect(h.actor.seq).toBe(seq);
    expect(JSON.stringify(h.state)).toBe(before);
    expect(h.actor.lastActId(seat)).toBe(lastId);
    expect(h.act(seat, { type: 'pass', player: h.b(seat).player }, { id: 901 }).reply?.ok).toBe(true);
  });

  it('(c) a cancel refused for size does not use one of the 3 cancels of the period', () => {
    const h = new Harness({ config: fixtureConfig('m13-2-cancel-size', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Grizzly Bears': 20 }), game: 'cs', scan: false });
    const cast = toCast(h, 'cs');
    const seat = h.seatOf(h.state.pending!.player);
    const player = h.b(seat).player;
    expect(h.act(seat, cast.action).reply?.ok).toBe(true);
    flags.sizeBoom = 1; // the cancel itself is refused for size; cancelling still fits afterwards, so the game goes on
    const refused = h.act(seat, { type: 'cancel', player });
    expect(refused.reply).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    expect(refused.step.end).toBeNull();
    for (let n = 1; n <= 3; n++) {
      if (n > 1) expect(h.act(seat, cast.action).reply?.ok).toBe(true);
      expect(h.act(seat, { type: 'cancel', player }).reply?.ok, `cancel ${n}`).toBe(true);
    }
  });
});
