/**
 * Whole seeded AI-against-AI games through the table actor (in process, fake time): every change's patch rebuilds exactly the seat's next view (the AI
 * chooses from the rebuilt view), every byte sent to each seat passes the hidden-information scan, the records replay to the live state (and rebuild
 * the table), and the same commands give the same payloads byte for byte.
 */
import { describe, expect, it } from 'vitest';
import { replayRecords, TableActor } from '../../src/table';
import { checkpointOf } from '../../src/table/limits';
import { configOf, DECKS, Harness, playAi } from './harness';

const GAMES: [string, number, number][] = [
  ['m13-2-ai-a', 0, 1],
  ['m13-2-ai-b', 1, 0],
  ['m13-2-ai-c', 2, 0],
];

describe('M13-2: whole AI games through the table', () => {
  for (const [seed, d1, d2] of GAMES) {
    it(`${seed}: patches rebuild every view, nothing hidden leaks, the records replay and rebuild the table`, () => {
      const config = configOf(seed, DECKS[d1]!, DECKS[d2]!);
      const h = new Harness({ config, game: `table-${d1}${d2}`, limits: { checkpointEvery: 25 } });
      const moves = playAi(h, seed);
      expect(moves).toBeGreaterThan(30);
      expect(h.oldIdChecks, 'the games cast and play cards from hidden hands').toBeGreaterThan(20);
      const end = h.actor.ended!;
      expect(end, 'the game ended').not.toBeNull();
      expect(end.outcome === 'win' || end.outcome === 'draw').toBe(true);
      // Both seats got the result with public placements only.
      for (const seat of [1, 2]) {
        const r = h.b(seat).inbox.filter((m) => m.t === 'result');
        expect(r).toHaveLength(1);
        const res = r[0] as Extract<typeof r[0], { t: 'result' }>;
        expect(res.placements.map((p) => Object.keys(p).sort().join(','))).toEqual(['loss,lossRule,name,outTurn,place,seat', 'loss,lossRule,name,outTurn,place,seat']);
        expect(res.placements[0]!.place).toBe(1);
      }
      // Records: one per applied action, in order, each with the clocks (after answered and the next decision) and the elapsed time.
      expect(h.records.length).toBe(h.actor.seq);
      for (const r of h.records) {
        expect(r.game).toBe(`table-${d1}${d2}`);
        expect(r.clocks.map((c) => c.seat)).toEqual([1, 2]);
        expect(Number.isFinite(r.elapsedMs)).toBe(true);
      }
      // Checkpoints every 25 records: the hash of the state at that seq.
      const checked = h.records.filter((r) => r.check);
      expect(checked.map((r) => r.seq)).toEqual(h.records.filter((r) => r.seq % 25 === 0).map((r) => r.seq));
      const cps = h.steps.flatMap((s) => (s.checkpoint ? [s.checkpoint] : []));
      expect(cps.map((c) => c.seq)).toEqual(checked.map((r) => r.seq));
      for (const c of cps) expect(Object.keys(JSON.parse(c.stateJson) as object)).not.toContain('defs');
      // Replay from the records: the live state exactly, every checkpoint hash equal.
      const replayed = replayRecords(config, h.records);
      expect(replayed.mismatches).toEqual([]);
      expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(h.state));
      expect(checkpointOf(replayed.state).hash).toBe(checkpointOf(h.state).hash);
      // And the table rebuilt from them (a recovery): the same state, seq and counts; its end is known again.
      const { actor, step } = TableActor.recover({ game: seed, config, seating: [1, 2], at: h.at + 60_000, records: h.records, limits: { checkpointEvery: 25 } });
      expect(JSON.stringify(actor.state)).toBe(JSON.stringify(h.state));
      expect(actor.seq).toBe(h.actor.seq);
      expect(actor.actions).toBe(h.actor.actions);
      expect(step.end?.outcome).toBe(end.outcome);
      expect(step.end?.seats.map((s) => [s.seat, s.place, s.loss])).toEqual(end.seats.map((s) => [s.seat, s.place, s.loss]));
    }, 120_000);
  }

  it('the same commands give the same steps, byte for byte (determinism)', () => {
    const run = () => {
      const h = new Harness({ config: configOf('m13-2-det', DECKS[0]!, DECKS[2]!), game: 'det', scan: false });
      playAi(h, 'm13-2-det', 400);
      return { transcript: h.transcript, records: JSON.stringify(h.records), steps: h.steps.length };
    };
    const a = run();
    const b = run();
    expect(a.steps).toBeGreaterThan(30);
    expect(b.steps).toBe(a.steps);
    expect(b.records).toBe(a.records);
    expect(b.transcript).toEqual(a.transcript);
  }, 120_000);

  it('a table rebuilt in the middle of a game goes on to the same state as the live one', () => {
    const config = configOf('m13-2-mid', DECKS[1]!, DECKS[0]!);
    const live = new Harness({ config, game: 'mid', scan: false });
    playAi(live, 'm13-2-mid', 60);
    expect(live.actor.ended).toBeNull();
    const { actor } = TableActor.recover({ game: 'mid', config, seating: [1, 2], at: live.at + 1_000, records: live.records });
    expect(JSON.stringify(actor.state)).toBe(JSON.stringify(live.state));
    // The recovered table: both seats reconnect and get full views; the next actions apply the same way on both tables.
    const step1 = actor.handle({ t: 'connect', seat: 1, at: live.at + 2_000 });
    const step2 = actor.handle({ t: 'connect', seat: 2, at: live.at + 2_000 });
    const full = [...step1.sends, ...step2.sends].filter((s) => s.t === 'view');
    expect(full.map((s) => s.seat)).toEqual([1, 2]);
    for (let i = 0; i < 20 && !live.actor.ended; i++) {
      const before = live.records.length;
      playAi(live, 'm13-2-mid', 1);
      for (const r of live.records.slice(before)) {
        expect(r.cause).toBeUndefined();
        const s = actor.handle({ t: 'act', seat: r.seat as 1 | 2, at: live.at + 2_000, id: 10_000 + r.seq, seq: actor.seq, action: r.action });
        expect(s.records.map((x) => x.action)).toEqual([r.action]);
      }
    }
    expect(JSON.stringify(actor.state)).toBe(JSON.stringify(live.state));
  }, 120_000);
});
