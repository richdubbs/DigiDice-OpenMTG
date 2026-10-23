/**
 * Size limits after every apply (design 2.2 step 3, D15): an action whose result would pass a limit (objects, log entries, history entries, the
 * serialized size at a checkpoint) is refused with `limitReached` and the state stays as it was; when no continuation that needs no choice (passing,
 * cancelling) fits either, the game is void ("limit"). Tables are rebuilt from a game's records with lowered limits (`TableActor.recover`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAction, createGame, type Action, type GameState } from '@openmtg/engine';
import type { HostedServerMessage } from '@openmtg/hosted/api';
import { checkpointOf, defaultTableLimits, sizeProblem, TableActor, type TableLimits, type TableStep } from '../../src/table';
import { configOf, DECKS, Harness, playAi } from './harness';

const config = configOf('m13-2-lim', DECKS[0]!, DECKS[1]!);
const objects = (s: GameState) => Object.keys(s.objects).length;

/** The first `n` records of the seeded game, and a table rebuilt from them with `limits`, both seats connected. */
function rebuilt(records: Harness['records'], n: number, limits: Partial<TableLimits>): TableActor {
  const { actor } = TableActor.recover({ game: 'lim', config, seating: [1, 2], at: 10_000_000, records: records.slice(0, n), limits });
  actor.handle({ t: 'connect', seat: 1, at: 10_000_001 });
  actor.handle({ t: 'connect', seat: 2, at: 10_000_001 });
  return actor;
}

function reply(step: TableStep, seat: number, id: number): Extract<HostedServerMessage, { t: 'reply' }> | undefined {
  return step.sends.filter((s) => s.seat === seat && s.t === 'reply').map((s) => JSON.parse(s.json) as Extract<HostedServerMessage, { t: 'reply' }>).find((m) => m.id === id);
}

describe('M13-2: size limits', () => {
  let live: Harness;
  beforeAll(() => {
    live = new Harness({ config, game: 'lim', scan: false });
    playAi(live, 'm13-2-lim', 120);
  }, 120_000);

  it('sizeProblem names the limit a state passes; the defaults are the design\'s', () => {
    const s = createGame(config);
    const d = defaultTableLimits(2);
    expect(d).toMatchObject({ actions: 4_000, maxObjects: 5_000, maxLogEntries: 50_000, maxHistoryEntries: 50_000, maxStateBytes: 16 * 1024 * 1024, checkpointEvery: 100 });
    expect(defaultTableLimits(4).actions).toBe(8_000);
    expect(sizeProblem(s, d)).toBeNull();
    expect(sizeProblem(s, { ...d, maxObjects: objects(s) - 1 })).toMatch(/objects/);
    expect(sizeProblem(s, { ...d, maxLogEntries: s.log.length - 1 })).toMatch(/log/);
    expect(sizeProblem({ ...s, history: [{}, {}] as never }, { ...d, maxHistoryEntries: 1 })).toMatch(/history/);
    const cp = checkpointOf(s);
    expect(cp.bytes).toBe(Buffer.byteLength(cp.json));
    expect(JSON.parse(cp.json).defs).toBeUndefined();
  });

  it('an action past the object limit is refused (limitReached), the state unchanged; passing still fits, so the game goes on', () => {
    // find an action at priority that adds an object (an ability on the stack) where passing would not
    let s = createGame(config);
    let at = -1;
    for (const r of live.records) {
      if (s.pending?.kind === 'priority' && r.action.type !== 'pass') {
        const after = applyAction(s, r.action).state;
        const pass = applyAction(s, { type: 'pass', player: s.pending.player }).state;
        if (objects(after) > objects(s) && objects(pass) <= objects(s)) {
          at = r.seq - 1;
          break;
        }
      }
      s = applyAction(s, r.action).state;
    }
    expect(at, 'the seeded game has such an action').toBeGreaterThan(0);
    const actor = rebuilt(live.records, at, { maxObjects: objects(s) });
    const rec = live.records[at]!;
    const seat = rec.seat as 1 | 2;
    const before = JSON.stringify(actor.state);
    const step = actor.handle({ t: 'act', seat, at: 10_000_010, id: 1, seq: actor.seq, action: rec.action });
    expect(reply(step, seat, 1)).toMatchObject({ ok: false, error: { code: 'limitReached', message: expect.stringMatching(/objects/) } });
    expect(step.records).toEqual([]);
    expect(step.end).toBeNull();
    expect(JSON.stringify(actor.state)).toBe(before);
    const pass: Action = { type: 'pass', player: actor.playerOf(seat)! };
    const ok = actor.handle({ t: 'act', seat, at: 10_000_020, id: 2, seq: actor.seq, action: pass });
    expect(reply(ok, seat, 2)?.ok).toBe(true);
    expect(ok.records).toHaveLength(1);
  });

  it('when no continuation fits, the game is void ("limit"): the object limit below the current state', () => {
    let at = 0;
    let s = createGame(config);
    for (const r of live.records) {
      if (s.pending?.kind === 'priority') break;
      s = applyAction(s, r.action).state;
      at = r.seq;
    }
    const actor = rebuilt(live.records, at, { maxObjects: objects(s) - 1 });
    const seat = live.records[at]!.seat as 1 | 2;
    const step = actor.handle({ t: 'act', seat, at: 10_000_010, id: 1, seq: actor.seq, action: { type: 'pass', player: actor.playerOf(seat)! } });
    expect(reply(step, seat, 1)).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    expect(step.end).toMatchObject({ outcome: 'void', reason: 'limit' });
    expect(step.sends.filter((x) => x.t === 'result').map((x) => x.seat)).toEqual([1, 2]);
  });

  it('a concession is never refused for size (CR 104.3a): Leave and the clock\'s time-out still end the game past a limit', () => {
    let at = 0;
    let s = createGame(config);
    for (const r of live.records) {
      if (s.pending?.kind === 'priority') break;
      s = applyAction(s, r.action).state;
      at = r.seq;
    }
    const leave = rebuilt(live.records, at, { maxObjects: objects(s) - 1, maxLogEntries: 1 });
    const left = leave.handle({ t: 'leave', seat: 2, at: 10_000_010, id: 1 });
    expect(left.records.map((r) => [r.seat, r.cause])).toEqual([[2, 'left']]);
    expect(left.end).toMatchObject({ outcome: 'win' });
    const timed = rebuilt(live.records, at, { maxObjects: objects(s) - 1, maxLogEntries: 1 });
    const out = timed.handle({ t: 'tick', at: timed.nextDeadline()! });
    expect(out.records.map((r) => r.cause)).toEqual(['timeout']);
    expect(out.end).toMatchObject({ outcome: 'win' });
  });

  it('the serialized size is measured at each checkpoint: past it, the action is refused, and with nothing that fits the game is void', () => {
    let at = 0;
    let s = createGame(config);
    for (const r of live.records) {
      if (s.pending?.kind === 'priority') break;
      s = applyAction(s, r.action).state;
      at = r.seq;
    }
    const actor = rebuilt(live.records, at, { checkpointEvery: 1, maxStateBytes: 10_000 });
    const seat = live.records[at]!.seat as 1 | 2;
    const step = actor.handle({ t: 'act', seat, at: 10_000_010, id: 1, seq: actor.seq, action: { type: 'pass', player: actor.playerOf(seat)! } });
    expect(reply(step, seat, 1)).toMatchObject({ ok: false, error: { code: 'limitReached', message: expect.stringMatching(/bytes/) } });
    expect(step.checkpoint).toBeNull();
    expect(step.end).toMatchObject({ outcome: 'void', reason: 'limit' });
  });
});
