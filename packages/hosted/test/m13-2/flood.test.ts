/**
 * M13-2 review CRITICAL 1: a seat must not be able to fill `state.log` with by-hand notes (no approval needed: one log entry per note, core/manual.ts)
 * and so void the game on demand or leave the other seat stuck to time out. The table bounds by-hand answers (ops and notes per answer, notes per seat
 * per game, no notes past 80% of the log cap), refuses any action that grows the log or history by more than a budget, and voids the game ("limit")
 * instead of letting a player whose answer no longer fits time out. Repros on the Fork table (Fork is fully manual in the fixtures).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type Action, type ManualOp } from '@openmtg/engine';
import { TableActor } from '../../src/table';
import { configOf, DECKS, forkTable, Harness, playAi, type Harness as H } from './harness';

function notes(h: H, n: number, more = false, tag = 'x'): Action {
  const ops: ManualOp[] = Array.from({ length: n }, (_, i) => ({ op: 'note', text: `${tag}${i}` }));
  return { type: 'answer', player: h.b(2).player, decisionId: h.state.pending!.id, answer: { kind: 'manualResolve', ops, ...(more ? { continue: true } : {}) } };
}

describe('M13-2 review CRITICAL 1: log flooding by by-hand notes', () => {
  it('an answer with thousands of notes (the repro) is refused, and so are more than 8 notes or 32 ops in one answer', () => {
    const h = forkTable('m13-2-flood-a');
    const log = h.state.log.length;
    const flood = h.act(2, notes(h, 2_400, true));
    expect(flood.reply).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(h.act(2, notes(h, 9, true)).reply).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(h.state.log.length).toBe(log);
    expect(h.act(2, notes(h, 8, true)).reply?.ok).toBe(true);
  });

  it('notes per seat per game are budgeted (limitReached past it)', () => {
    const h = forkTable('m13-2-flood-b', { limits: { manualNotesPerGame: 20 } } as never);
    expect(h.act(2, notes(h, 8, true, 'a')).reply?.ok).toBe(true);
    expect(h.act(2, notes(h, 8, true, 'b')).reply?.ok).toBe(true);
    const third = h.act(2, notes(h, 8, true, 'c'));
    expect(third.reply).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    expect(h.act(2, notes(h, 4, false, 'd')).reply?.ok).toBe(true); // 20 in all
  });

  it('past 80% of the log cap no notes are taken; an answer without notes still resolves the card', () => {
    const probe = forkTable('m13-2-flood-c');
    const len = probe.state.log.length;
    const h = forkTable('m13-2-flood-c', { limits: { maxLogEntries: Math.ceil(len / 0.85) } });
    expect(h.state.log.length).toBe(len);
    expect(h.act(2, notes(h, 1)).reply).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    const empty = h.act(2, { type: 'answer', player: h.b(2).player, decisionId: h.state.pending!.id, answer: { kind: 'manualResolve', ops: [] } });
    expect(empty.reply?.ok).toBe(true);
    expect(h.actor.ended).toBeNull();
  });

  it("the per-action growth budget applies to by-hand answers only: ordinary play over a tiny budget goes on (an opponent's huge effect never leaves the victim stuck)", () => {
    const h = new Harness({ config: configOf('m13-2-growth', DECKS[0]!, DECKS[1]!), game: 'growth', scan: false, limits: { maxLogGrowth: 1, maxHistoryGrowth: 1 } } as never);
    const moves = playAi(h, 'm13-2-growth', 120); // aiMove fails on any refusal
    expect(moves).toBeGreaterThan(60);
    expect(h.records.filter((r) => r.cause === 'timeout')).toEqual([]);
  }, 120_000);

  it('an action that grows the log past the per-action budget is refused without voiding the game; a smaller one goes through', () => {
    const live = forkTable('m13-2-flood-d');
    const { actor } = TableActor.recover({ game: 'fork', config: live.actor.config, seating: [1, 2], at: 10_000_000, records: live.records, limits: { maxLogGrowth: 3 } });
    actor.handle({ t: 'connect', seat: 2, at: 10_000_001 });
    const reply = (st: ReturnType<typeof actor.handle>, id: number) => st.sends.filter((x) => x.t === 'reply').map((x) => JSON.parse(x.json)).find((m) => m.id === id);
    const big = actor.handle({ t: 'act', seat: 2, at: 10_000_002, id: 1, seq: actor.seq, action: notes(live, 6, true) });
    expect(reply(big, 1)).toMatchObject({ ok: false, error: { code: 'limitReached', message: expect.stringMatching(/log entries/) } });
    expect(big.end).toBeNull();
    const small = actor.handle({ t: 'act', seat: 2, at: 10_000_003, id: 2, seq: actor.seq, action: notes(live, 1, true) });
    expect(reply(small, 2)?.ok).toBe(true);
  });

  it('a player whose answer to a decision that is neither priority nor cancellable no longer fits is not left to time out: the game is void ("limit")', () => {
    const config = configOf('m13-2-stuck', DECKS[0]!, DECKS[1]!);
    const live = new Harness({ config, game: 'stuck', scan: false });
    playAi(live, 'm13-2-stuck', 120);
    let s = createGame(config);
    let at = -1;
    for (const r of live.records) {
      const d = s.pending!;
      const next = applyAction(s, r.action).state;
      if (d.kind !== 'priority' && d.kind !== 'manualResolve' && !d.cancellable && next.log.length > s.log.length && r.seq > 1) {
        at = r.seq - 1;
        break;
      }
      s = next;
    }
    expect(at, 'such a decision in the seeded game').toBeGreaterThan(0);
    const { actor } = TableActor.recover({ game: 'stuck', config, seating: [1, 2], at: 10_000_000, records: live.records.slice(0, at), limits: { maxLogEntries: s.log.length } });
    actor.handle({ t: 'connect', seat: 1, at: 10_000_001 });
    actor.handle({ t: 'connect', seat: 2, at: 10_000_001 });
    const rec = live.records[at]!;
    const step = actor.handle({ t: 'act', seat: rec.seat as 1, at: 10_000_002, id: 1, seq: actor.seq, action: rec.action });
    expect(step.end).toMatchObject({ outcome: 'void', reason: 'limit' });
  });
});
