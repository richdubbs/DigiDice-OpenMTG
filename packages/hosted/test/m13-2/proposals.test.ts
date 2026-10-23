/**
 * By-hand changes (D12, owner M12 Q6): a manualResolve answer that changes the game is a proposal that every other player must approve; each approver
 * reads it as they may know the game (CR 400.2: "a hidden card"); at most two proposals per control period, then notes only (which need no approval);
 * withdrawn when the proposer acts again or the game ends; the proposer's reply waits for the outcome. Fork is fully manual in the fixtures.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ManualOp } from '@openmtg/engine';
import { forkTable, Harness, MIN, replyIn } from './harness';

const MARKER = 'Abzan Charm';

function answer(h: Harness, ops: ManualOp[]): Action {
  const d = h.state.pending!;
  return { type: 'answer', player: h.b(2).player, decisionId: d.id, answer: { kind: 'manualResolve', ops } };
}

const life = (h: Harness, seat: number) => h.state.players.find((p) => p.id === h.b(seat).player)!.life;

describe('M13-2: by-hand change proposals', () => {
  it('approved by every other player: applied with cause "approved", the proposer\'s reply after the change, the voter\'s after it', () => {
    const h = forkTable();
    const seq = h.actor.seq;
    const { step, reply } = h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -1 }]), { id: 300 });
    expect(reply).toBeUndefined(); // waits for the approvals
    expect(step.records).toEqual([]);
    const p = h.sent(step, 1, 'proposal')[0]!.proposal;
    expect(p).toMatchObject({ seat: 2, sourceName: 'Fork', lines: ["Two's life -1."] });
    expect(h.sent(step, 2, 'proposal')).toEqual([]);
    // the approver's clock runs now, the proposer's is stopped
    const clock = h.sent(step, 1, 'clock')[0]!;
    expect(clock.seats.map((s) => [s.seat, s.running])).toEqual([[1, true], [2, false]]);
    // a resend of the proposing act while it waits: nothing
    expect(h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -1 }]), { id: 300 }).step.sends).toEqual([]);
    // the proposer may not vote on its own proposal; an unknown id is refused
    expect(replyIn(h.cmd({ t: 'vote', seat: 2, at: h.at, id: 301, proposal: p.id, accept: true }), 2, 301)).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    expect(replyIn(h.cmd({ t: 'vote', seat: 1, at: h.at, id: 302, proposal: p.id + 7, accept: true }), 1, 302)).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
    const vote = h.cmd({ t: 'vote', seat: 1, at: h.at + 2_000, id: 303, proposal: p.id, accept: true });
    expect(vote.records).toHaveLength(1);
    expect(vote.records[0]).toMatchObject({ seq: seq + 1, seat: 2, cause: 'approved', approvedBy: [1] });
    expect(replyIn(vote, 2, 300)).toEqual({ t: 'reply', id: 300, ok: true });
    expect(replyIn(vote, 1, 303)).toEqual({ t: 'reply', id: 303, ok: true });
    for (const s of [1, 2]) expect(h.sent(vote, s, 'proposalClosed')).toEqual([{ t: 'proposalClosed', proposal: p.id, outcome: 'approved' }]);
    const order = vote.sends.filter((s) => s.seat === 2).map((s) => s.t);
    expect(order.indexOf('patch')).toBeLessThan(order.indexOf('reply'));
    expect(life(h, 2)).toBe(19);
    // answered already
    expect(replyIn(h.cmd({ t: 'vote', seat: 1, at: h.at, id: 304, proposal: p.id, accept: true }), 1, 304)).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
  });

  it("rejected: nothing changes; the proposer hears who rejected and why; each approver reads another seat's hidden cards as \"a hidden card\" (CR 400.2)", () => {
    const h = forkTable();
    const p1Hand = h.state.zones.hand[h.b(1).player]![0]!;
    const p2LibTop = h.state.zones.library[h.b(2).player]![0]!;
    // seat 2 names seat 1's hand card by the alias its own view shows
    const aliasInView = h.b(2).view!.zones.hand[h.b(1).player]![0]!;
    expect(aliasInView).not.toBe(p1Hand);
    const ops: ManualOp[] = [
      { op: 'move', object: p2LibTop, to: 'hand' },
      { op: 'move', object: aliasInView, to: 'exile' },
      { op: 'life', player: h.b(1).player, delta: -100 },
    ];
    const before = JSON.stringify(h.state);
    const { step } = h.act(2, answer(h, ops), { id: 400 });
    const p = h.sent(step, 1, 'proposal')[0]!.proposal;
    expect(p.lines[0]).toMatch(/^Move a hidden card \(Two's library, 1 from the top\) to hand\.$/);
    expect(p.lines[1]).toMatch(new RegExp(`^Move (Forest|${MARKER}) \\(One's hand\\) to exile\\.$`)); // seat 1's own card: it may see it
    expect(p.lines[2]).toBe("One's life -100.");
    const r = h.cmd({ t: 'vote', seat: 1, at: h.at + 1_000, id: 401, proposal: p.id, accept: false, reason: 'Fork does not do that.' });
    expect(r.records).toEqual([]);
    expect(replyIn(r, 2, 400)).toMatchObject({ ok: false, error: { code: 'manualRejected', message: 'Seat 1 did not accept your by-hand changes: Fork does not do that.' } });
    for (const s of [1, 2]) expect(h.sent(r, s, 'proposalClosed')[0]).toMatchObject({ outcome: 'rejected' });
    expect(JSON.stringify(h.state)).toBe(before);
    // a reason that breaks the text rules is refused, the vote not counted
    const { step: s2 } = h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -1 }]), { id: 402 });
    const p2 = h.sent(s2, 1, 'proposal')[0]!.proposal;
    expect(replyIn(h.cmd({ t: 'vote', seat: 1, at: h.at, id: 403, proposal: p2.id, accept: false, reason: 'no‮' }), 1, 403)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
  });

  it('two proposals per control period, then notes only: a third is refused; a notes-only answer needs no approval', () => {
    const h = forkTable('m13-2-fork-cap');
    let id = 500;
    for (let n = 0; n < 2; n++) {
      const { step } = h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -1 }]), { id: ++id });
      const p = h.sent(step, 1, 'proposal')[0]!.proposal;
      h.cmd({ t: 'vote', seat: 1, at: h.at, id: 900 + n, proposal: p.id, accept: false });
    }
    const third = h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -1 }]), { id: ++id });
    expect(third.reply).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
    expect(third.reply!.ok === false && third.reply!.error.message).toMatch(/notes only/);
    expect(h.sent(third.step, 1, 'proposal')).toEqual([]);
    const notes = h.act(2, answer(h, [{ op: 'note', text: 'Fork copies nothing here.' }]), { id: ++id });
    expect(notes.reply?.ok).toBe(true);
    expect(notes.step.records).toHaveLength(1);
    expect(notes.step.records[0]!.cause).toBeUndefined();
  });

  it('withdrawn when the proposer acts again before everyone answered (the first act is refused, the new one applies)', () => {
    const h = forkTable('m13-2-fork-withdraw');
    const { step } = h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -2 }]), { id: 600 });
    const p = h.sent(step, 1, 'proposal')[0]!.proposal;
    const next = h.act(2, answer(h, [{ op: 'note', text: 'never mind' }]), { id: 601 });
    expect(replyIn(next.step, 2, 600)).toMatchObject({ ok: false, error: { code: 'manualRejected', message: expect.stringMatching(/^Withdrawn/) } });
    expect(replyIn(next.step, 2, 601)?.ok).toBe(true);
    expect(h.sent(next.step, 1, 'proposalClosed')).toEqual([{ t: 'proposalClosed', proposal: p.id, outcome: 'withdrawn' }]);
    expect(life(h, 2)).toBe(20);
    expect(replyIn(h.cmd({ t: 'vote', seat: 1, at: h.at, id: 602, proposal: p.id, accept: true }), 1, 602)).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
  });

  it('an approver who reconnects gets the waiting proposal again; one who runs out of time concedes and the proposal ends with the game', () => {
    const h = forkTable('m13-2-fork-away');
    const { step } = h.act(2, answer(h, [{ op: 'life', player: h.b(2).player, delta: -1 }]), { id: 700 });
    const p = h.sent(step, 1, 'proposal')[0]!.proposal;
    h.cmd({ t: 'disconnect', seat: 1, at: h.at + 1_000 });
    const back = h.cmd({ t: 'connect', seat: 1, at: h.at + 2_000 });
    expect(h.sent(back, 1, 'proposal').map((x) => x.proposal)).toEqual([p]);
    // nobody answers: the approver's clock (a free delay per proposal, then the bank) runs out
    const deadline = h.actor.nextDeadline()!;
    expect(deadline).toBeLessThanOrEqual(h.at + 2_000 + 16 * MIN);
    const out = h.cmd({ t: 'tick', at: deadline });
    expect(out.records[0]).toMatchObject({ seat: 1, cause: 'timeout' });
    expect(replyIn(out, 2, 700)).toMatchObject({ ok: false, error: { code: 'manualRejected' } });
    expect(out.end?.seats.find((s) => s.seat === 2)?.place).toBe(1);
  });
});
