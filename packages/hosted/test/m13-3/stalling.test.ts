/**
 * The review's stalling cases (review 1; design D9, D12, 5.1, 5.4): cast-cancel loops never refund the bank, proposals stop the proposer's clock and run
 * every approver's, a rejected proposal gives no new delay, at most two proposals per decision and then notes only.
 */
import { describe, expect, it } from 'vitest';
import { GAME_LIMITS } from '@openmtg/hosted';
import { CLOCK_LIMITS, createTableClock, recoverTableClock } from '../../src/clock';
import { bank, delay, dropRunning, MIN, outs, running, runTo, SEC, seat, tick } from './helpers';

const BANK = 15 * MIN;

describe('M13-3: cancel (CR 733.1) goes on as it was', () => {
  it('a cast-cancel loop never refunds the bank and ends in a time-out', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    let t = 0;
    let last = bank(c, 1);
    let timedOut: string[] = [];
    let refused = 0;
    const real = (xs: string[]): string[] => {
      refused += xs.filter((x) => x.startsWith('cancelRefused')).length;
      return xs.filter((x) => !x.startsWith('cancelRefused'));
    };
    for (let i = 0; i < 1_000 && timedOut.length === 0; i++) {
      // Cast: the cast is an answer, then the targets are the same seat's decision in the same period; then cancel.
      t += 1 * SEC;
      timedOut = real(outs(c.handle({ type: 'answered', at: t, seat: seat(1) })));
      c.handle({ type: 'decision', at: t, seat: seat(1), events: 3 });
      t += 1 * SEC;
      timedOut.push(...real(outs(c.handle({ type: 'cancel', at: t, seat: seat(1) }))));
      c.handle({ type: 'decision', at: t, seat: seat(1), events: 2 });
      expect(delay(c, 1)).toBe(Math.max(0, 5 * SEC - t));
      const now = bank(c, 1);
      expect(now).toBeLessThanOrEqual(last);
      if (t > 5 * SEC && timedOut.length === 0) expect(now).toBe(BANK - (t - 5 * SEC));
      last = now;
      timedOut.push(...tick(c, t));
    }
    expect(timedOut).toEqual([`timeout:1@${5 * SEC + BANK}`]);
    expect(c.isOver()).toBe(true);
    // Only the first CLOCK_LIMITS.cancelsPerPeriod cancels of the period were accepted; the rest were refused.
    expect(refused).toBe(Math.floor((5 * SEC + BANK) / (2 * SEC)) - CLOCK_LIMITS.cancelsPerPeriod);
  });

  it('at most 3 cancels per control period: the 4,000-cancel loop gets 3, the rest are refused (the table refuses them; nothing is logged)', () => {
    expect(CLOCK_LIMITS.cancelsPerPeriod).toBe(3);
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 4_000; i++) {
      // 1 ms per cast-cancel: a script, not a person. Without the cap these 4,000 cancels alone would be 4,000 logged actions in 4 s.
      c.handle({ type: 'answered', at: i, seat: seat(1) });
      c.handle({ type: 'decision', at: i, seat: seat(1) });
      const o = outs(c.handle({ type: 'cancel', at: i, seat: seat(1) }));
      if (o.includes('cancelRefused:1')) refused++;
      else accepted++;
    }
    expect(accepted).toBe(3);
    expect(refused).toBe(3_997);
    // A new step (or control passing from the other seat) gives the next period its own 3 cancels.
    c.handle({ type: 'answered', at: 5_000, seat: seat(1) });
    c.handle({ type: 'decision', at: 5_000, seat: seat(2) });
    c.handle({ type: 'answered', at: 5_001, seat: seat(2) });
    c.handle({ type: 'decision', at: 5_001, seat: seat(1) });
    expect(outs(c.handle({ type: 'cancel', at: 5_002, seat: seat(1) }))).toEqual([]);
  });

  it('a cancel by a seat that is not deciding is ignored: it cannot move the running clock', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(2) });
    expect(c.handle({ type: 'cancel', at: 1 * SEC, seat: seat(1) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
    expect(running(c)).toEqual([2]);
  });

  it('per-seat action counts (answers and accepted cancels) are in the readings and survive a recovery (who drove a game to a cap: M15)', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 1, seat: seat(1) });
    c.handle({ type: 'decision', at: 1, seat: seat(2) });
    c.handle({ type: 'answered', at: 2, seat: seat(2) });
    c.handle({ type: 'decision', at: 2, seat: seat(1) });
    c.handle({ type: 'cancel', at: 3, seat: seat(1) });
    expect(c.readings().map((r) => r.actions)).toEqual([2, 1]);
    const r = recoverTableClock({ seats: 2, at: 100, record: c.logFields(), controller: seat(1) });
    expect(r.readings().map((x) => x.actions)).toEqual([2, 1]);
  });

  it('a cancel after another seat decided inside the action resumes the canceller\'s old period, not a fresh one', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'answered', at: 4 * SEC, seat: seat(1) }); // 1 s of delay left
    c.handle({ type: 'decision', at: 4 * SEC, seat: seat(2) }); // a choice of the other seat during the action: its own period
    expect(delay(c, 2)).toBe(5 * SEC);
    c.handle({ type: 'answered', at: 6 * SEC, seat: seat(2) });
    c.handle({ type: 'cancel', at: 6 * SEC, seat: seat(1) });
    expect(running(c)).toEqual([1]);
    expect(delay(c, 1)).toBe(1 * SEC);
    // The next decision of the same seat continues the same period.
    c.handle({ type: 'decision', at: 6 * SEC, seat: seat(1) });
    expect(delay(c, 1)).toBe(1 * SEC);
    expect(bank(c, 1, 10 * SEC)).toBe(BANK - 3 * SEC);
  });

  it('a cancel by a seat out of the game is ignored', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'seatOut', at: 0, seat: seat(3) });
    expect(c.handle({ type: 'cancel', at: 0, seat: seat(3) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
  });
});

describe('M13-3: proposals and approval clocks (design 5.4, D12)', () => {
  it('proposing stops the proposer\'s clock; the approver gets one free delay, then its bank', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    expect(outs(c.handle({ type: 'propose', at: 2 * SEC, seat: seat(1) }))).toEqual(['opened:1:1>2']);
    expect(running(c)).toEqual([2]);
    expect(delay(c, 1)).toBe(3 * SEC); // shown as it was, stopped
    expect(delay(c, 2)).toBe(5 * SEC);
    expect(bank(c, 1, 62 * SEC)).toBe(BANK);
    expect(delay(c, 1, 62 * SEC)).toBe(3 * SEC);
    expect(bank(c, 2, 62 * SEC)).toBe(BANK - 55 * SEC);
  });

  it('a rejection gives no new delay: the proposer\'s clock resumes as it was', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 8 * SEC, seat: seat(1) }); // the delay is spent, 3 s of bank used
    expect(outs(c.handle({ type: 'vote', at: 20 * SEC, seat: seat(2), approve: false }))).toEqual(['closed:1:rejected']);
    expect(running(c)).toEqual([1]);
    expect(delay(c, 1)).toBe(0);
    expect(bank(c, 1)).toBe(BANK - 3 * SEC);
    expect(bank(c, 1, 21 * SEC)).toBe(BANK - 4 * SEC);
    expect(bank(c, 2)).toBe(BANK - 7 * SEC);
  });

  it('a withdrawal resumes the proposer the same way; only the proposer can withdraw', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 1 * SEC, seat: seat(1) });
    expect(c.handle({ type: 'withdraw', at: 2 * SEC, seat: seat(2) }).outcomes[0]).toMatchObject({ kind: 'ignored' });
    expect(outs(c.handle({ type: 'withdraw', at: 3 * SEC, seat: seat(1) }))).toEqual(['closed:1:withdrawn']);
    expect(delay(c, 1)).toBe(4 * SEC);
    expect(running(c)).toEqual([1]);
  });

  it('at most two proposals per CONTROL PERIOD; then notes only (neither an answer nor a cancel resets the count; a new period does)', () => {
    expect(GAME_LIMITS.proposalsPerDecision).toBe(2);
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    for (let i = 0; i < 2; i++) {
      expect(outs(c.handle({ type: 'propose', at: 1 * SEC, seat: seat(1) }))).toEqual([`opened:${i + 1}:1>2`]);
      c.handle({ type: 'vote', at: 1 * SEC, seat: seat(2), approve: false });
    }
    expect(outs(c.handle({ type: 'propose', at: 1 * SEC, seat: seat(1) }))).toEqual(['refused:1:notesOnly']);
    expect(c.proposalsMade(seat(1))).toBe(2);
    c.handle({ type: 'cancel', at: 2 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 2 * SEC, seat: seat(1) });
    expect(outs(c.handle({ type: 'propose', at: 2 * SEC, seat: seat(1) }))).toEqual(['refused:1:notesOnly']);
    // An answered decision in the same period (cast again) does not reset it either.
    c.handle({ type: 'answered', at: 3 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 3 * SEC, seat: seat(1) });
    expect(outs(c.handle({ type: 'propose', at: 3 * SEC, seat: seat(1) }))).toEqual(['refused:1:notesOnly']);
    // A new step starts a new period: two proposals again.
    c.handle({ type: 'answered', at: 4 * SEC, seat: seat(1) });
    c.handle({ type: 'decision', at: 4 * SEC, seat: seat(1), newStep: true });
    expect(outs(c.handle({ type: 'propose', at: 4 * SEC, seat: seat(1) }))).toEqual(['opened:3:1>2']);
  });

  it("the review's repro: cast, propose, propose, cancel in one period at 10 ms a step cannot drain an honest approver", () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    let t = 0;
    let opened = 0;
    const all: string[] = [];
    for (let i = 0; i < 1_000 && !c.isOver(); i++) {
      t += 10;
      all.push(...outs(c.handle({ type: 'answered', at: t, seat: seat(1) })));
      c.handle({ type: 'decision', at: t, seat: seat(1) });
      for (let k = 0; k < 2; k++) {
        t += 10;
        const o = outs(c.handle({ type: 'propose', at: t, seat: seat(1) }));
        all.push(...o);
        if (o[0]?.startsWith('opened')) {
          opened++;
          t += 6 * SEC; // the approver takes 6 s to read it and reject
          all.push(...outs(c.handle({ type: 'vote', at: t, seat: seat(2), approve: false })));
        }
      }
      t += 10;
      all.push(...outs(c.handle({ type: 'cancel', at: t, seat: seat(1) })));
    }
    expect(opened).toBe(2);
    expect(all.filter((x) => x.startsWith('timeout:2'))).toEqual([]);
    // The approver lost 1 s of bank per proposal (6 s minus its 5 s delay), and only twice.
    expect(bank(c, 2)).toBe(BANK - 2 * SEC);
  });

  it('repeated rejected proposals cost the proposer nothing new and never refresh its delay (bounded by the cap)', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += 4 * SEC;
      c.handle({ type: 'propose', at: t, seat: seat(1) });
      t += 1 * SEC;
      c.handle({ type: 'vote', at: t, seat: seat(2), approve: false });
    }
    // Only two proposals opened; the proposer's own time (4 s each round) ran on its delay, then its bank.
    expect(bank(c, 1)).toBe(BANK - (5 * 4 * SEC - 5 * SEC) - 3 * 1 * SEC);
    expect(delay(c, 1)).toBe(0);
  });

  it('a proposal by a seat that is not deciding, or while one is open, is refused', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    expect(outs(c.handle({ type: 'propose', at: 0, seat: seat(2) }))).toEqual(['refused:2:notDeciding']);
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    expect(outs(c.handle({ type: 'propose', at: 0, seat: seat(1) }))).toEqual(['refused:1:pending']);
    expect(c.handle({ type: 'vote', at: 0, seat: seat(1), approve: true }).outcomes[0]).toMatchObject({ kind: 'ignored' });
  });

  it('a pod: every other player approves, each approver\'s clock runs at the same time; the last approval closes it', () => {
    const c = createTableClock({ seats: 4, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(2) });
    expect(outs(c.handle({ type: 'propose', at: 0, seat: seat(2) }))).toEqual(['opened:1:2>1,3,4']);
    expect(running(c)).toEqual([1, 3, 4]);
    expect(c.view(10 * SEC).seats.map((s) => s.bankMs)).toEqual([20 * MIN - 5 * SEC, 20 * MIN, 20 * MIN - 5 * SEC, 20 * MIN - 5 * SEC]);
    expect(outs(c.handle({ type: 'vote', at: 10 * SEC, seat: seat(1), approve: true }))).toEqual([]);
    expect(running(c)).toEqual([3, 4]);
    expect(outs(c.handle({ type: 'vote', at: 12 * SEC, seat: seat(4), approve: true }))).toEqual([]);
    expect(outs(c.handle({ type: 'vote', at: 13 * SEC, seat: seat(3), approve: true }))).toEqual(['closed:1:approved']);
    expect(running(c)).toEqual([2]);
    expect(c.view().seats.map((s) => s.bankMs)).toEqual([20 * MIN - 5 * SEC, 20 * MIN, 20 * MIN - 8 * SEC, 20 * MIN - 7 * SEC]);
  });

  it('one rejection closes the proposal in a pod', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    c.handle({ type: 'vote', at: 1 * SEC, seat: seat(2), approve: true });
    expect(outs(c.handle({ type: 'vote', at: 2 * SEC, seat: seat(3), approve: false }))).toEqual(['closed:1:rejected']);
  });

  it('an approver who runs out of time times out like any player; in a pod the others\' approvals carry it', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    c.handle({ type: 'vote', at: 1 * SEC, seat: seat(2), approve: true });
    const t = 5 * SEC + 20 * MIN;
    expect(runTo(c, t)).toEqual([`timeout:3@${t}`, 'closed:1:approved']);
    expect(c.isOver()).toBe(false);
    expect(running(c)).toEqual([1]);
  });

  it('1v1: the approver times out, the game is over', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    expect(runTo(c, 5 * SEC + BANK)).toEqual([`timeout:2@${5 * SEC + BANK}`]);
    expect(c.isOver()).toBe(true);
  });

  it('a disconnected approver: the proposal waits within its drop allowance; back, it has the rest of its delay', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    c.handle({ type: 'disconnect', at: 2 * SEC, seat: seat(2) });
    expect(running(c)).toEqual([]);
    expect(dropRunning(c)).toEqual([2]);
    c.handle({ type: 'reconnect', at: 62 * SEC, seat: seat(2) });
    expect(delay(c, 2)).toBe(3 * SEC);
    expect(bank(c, 2)).toBe(BANK);
    expect(c.view().seats[1]!.dropMs).toBe(5 * MIN - 60 * SEC);
    expect(running(c)).toEqual([2]);
  });

  it('the proposer leaving withdraws its proposal', () => {
    const c = createTableClock({ seats: 3, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    expect(outs(c.handle({ type: 'seatOut', at: 1 * SEC, seat: seat(1) }))).toEqual(['closed:1:withdrawn']);
    expect(running(c)).toEqual([]);
  });

  it('the game moving on to another seat closes an open proposal as withdrawn', () => {
    const c = createTableClock({ seats: 2, at: 0 });
    c.handle({ type: 'decision', at: 0, seat: seat(1) });
    c.handle({ type: 'propose', at: 0, seat: seat(1) });
    expect(outs(c.handle({ type: 'decision', at: 1 * SEC, seat: seat(2) }))).toEqual(['closed:1:withdrawn']);
    expect(running(c)).toEqual([2]);
  });
});
