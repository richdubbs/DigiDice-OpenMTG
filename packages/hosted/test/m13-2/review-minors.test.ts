/**
 * M13-2 review minors: a seat that left stays left after a recovery (d); an act id that is not a whole number is refused (e).
 */
import { describe, expect, it } from 'vitest';
import { TableActor } from '../../src/table';
import { fixtureConfig, Harness, replyIn } from './harness';

const config = () => fixtureConfig('m13-2-minors', { Mountain: 20, 'Grizzly Bears': 20 }, { Forest: 20, 'Llanowar Elves': 20 });

describe('M13-2 review minors', () => {
  it('(d) a recovered table keeps the seats that left: a reconnect of such a seat gets nothing', () => {
    const h = new Harness({ config: config(), game: 'minors' });
    h.cmd({ t: 'leave', seat: 1, at: 1_000, id: 1 });
    const { actor } = TableActor.recover({ game: 'minors', config: config(), seating: [1, 2], at: 50_000, records: h.records });
    const step = actor.handle({ t: 'connect', seat: 1, at: 50_001 });
    expect(step.sends.filter((s) => s.seat === 1)).toEqual([]);
    expect(actor.handle({ t: 'connect', seat: 2, at: 50_002 }).sends.some((s) => s.seat === 2 && s.t === 'view')).toBe(true);
  });

  it('(e) an act id that is not a positive whole number is refused (badMessage), and resend detection keeps working', () => {
    const h = new Harness({ config: config(), game: 'minors' });
    const p = h.b(2).player;
    for (const id of [Number.NaN, 1.5, -3, 0, Number.POSITIVE_INFINITY]) {
      const step = h.cmd({ t: 'act', seat: 2, at: 10, id, seq: 0, action: { type: 'setStops', player: p, stops: { ownTurn: ['main1'], opponentTurn: [], fullControl: false } } as never });
      expect(step.records, String(id)).toEqual([]);
      const r = step.sends.filter((s) => s.t === 'reply').map((s) => JSON.parse(s.json));
      expect(r[0], String(id)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    }
    const ok = h.cmd({ t: 'act', seat: 2, at: 11, id: 7, seq: 0, action: { type: 'setStops', player: p, stops: { ownTurn: ['main2'], opponentTurn: [], fullControl: false } } as never });
    expect(replyIn(ok, 2, 7)?.ok).toBe(true);
    expect(ok.records).toHaveLength(1);
  });
});
