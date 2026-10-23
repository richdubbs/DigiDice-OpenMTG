/**
 * Ready checks (design 4.5): the confirmers of a failed check go back to the FRONT of their queue with their waiting time kept; the others leave it,
 * and two missed checks within 10 minutes mean no queuing for 2 minutes. The check itself (15 s) is `MatchReadyCheck`.
 */
import { describe, expect, it } from 'vitest';
import { HOSTED_TIMING } from '../../src/api';
import { MatchReadyCheck, settleReadyCheck, matchStartRequest, type Match } from '../../src/match';
import { METRICS } from '../../src/obs';
import { MIN, pairs, POD, Rig, SEC, STANDARD, who } from './helpers';

/** The match of a and b, formed at the rig's time. */
function matchOf(r: Rig, ...sessions: string[]): Match {
  r.joinAll(sessions, sessions.length > 2 ? { key: POD } : {});
  const [m] = r.tick();
  return m!;
}

const failedOf = (c: MatchReadyCheck, now: number) => {
  const o = c.poll(now);
  if (o === null || o.kind !== 'failed') throw new Error('the check did not fail');
  return o;
};

describe('M13-9: MatchReadyCheck', () => {
  it('every seat confirms before the deadline: the game starts', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b'), r.now);
    expect(c.deadlineAt).toBe(r.now + HOSTED_TIMING.readyCheckMatchMs);
    expect(c.deadlineAt - r.now).toBe(15 * SEC);
    expect(c.poll(r.now)).toBeNull();
    expect(c.confirm('a', r.now + SEC)).toBe(true);
    expect(c.players()).toEqual([{ session: 'a', ready: true }, { session: 'b', ready: false }]);
    expect(c.poll(r.now + 2 * SEC)).toBeNull();
    expect(c.confirm('b', r.now + 3 * SEC)).toBe(true);
    expect(c.poll(r.now + 3 * SEC)).toEqual({ kind: 'start' });
    // decided: nothing changes it, not even the deadline
    expect(c.poll(r.now + 60 * SEC)).toEqual({ kind: 'start' });
    expect(c.leave('a', r.now + 4 * SEC)).toBe(false);
  });

  it('the deadline passes: the confirmers go back, the others missed', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b'), r.now);
    c.confirm('a', r.now + 5 * SEC);
    expect(c.poll(r.now + 15 * SEC - 1)).toBeNull();
    const o = failedOf(c, r.now + 15 * SEC);
    expect(o.reason).toBe('timeout');
    expect(o.requeue.map((e) => e.session)).toEqual(['a']);
    expect(o.missed.map((e) => e.session)).toEqual(['b']);
  });

  it('a confirm stamped at the deadline counts if it is handled before that instant\'s poll; one after the decision, or past the deadline, does not', () => {
    const r = new Rig();
    const m = matchOf(r, 'a', 'b');
    const at = r.now + 15 * SEC;
    const c1 = new MatchReadyCheck(m, r.now);
    c1.confirm('a', r.now);
    expect(c1.confirm('b', at)).toBe(true);
    expect(c1.poll(at)).toEqual({ kind: 'start' });
    // the poll at the deadline came first: it decided
    const c2 = new MatchReadyCheck(m, r.now);
    c2.confirm('a', r.now);
    expect(failedOf(c2, at).missed.map((e) => e.session)).toEqual(['b']);
    expect(c2.confirm('b', at)).toBe(false);
    // past the deadline before anybody polled: late
    const c3 = new MatchReadyCheck(m, r.now);
    c3.confirm('a', r.now);
    expect(c3.confirm('b', at + 1)).toBe(false);
    expect(failedOf(c3, at + 1).reason).toBe('timeout');
  });

  it('a confirm from a session that is not a seat does not count; a repeated confirm is harmless', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b'), r.now);
    expect(c.confirm('x', r.now)).toBe(false);
    expect(c.confirm('a', r.now)).toBe(true);
    expect(c.confirm('a', r.now + SEC)).toBe(true);
    expect(c.poll(r.now + SEC)).toBeNull();
  });

  it('a seat that leaves fails the check at once: the leaver missed, everybody else goes back, confirmed or not', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b', 'c', 'd'), r.now);
    c.confirm('a', r.now);
    expect(c.leave('c', r.now + SEC)).toBe(true);
    const o = failedOf(c, r.now + SEC);
    expect(o.reason).toBe('left');
    expect(o.requeue.map((e) => e.session)).toEqual(['a', 'b', 'd']); // b had not confirmed yet, and is not blamed
    expect(o.missed.map((e) => e.session)).toEqual(['c']);
    expect(c.confirm('b', r.now + 2 * SEC)).toBe(false);
    expect(c.leave('x', r.now + 2 * SEC)).toBe(false);
  });

  it('a leave after the deadline is a time-out: the leaver was not confirmed either way', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b'), r.now);
    c.confirm('a', r.now);
    expect(c.leave('a', r.now + 20 * SEC)).toBe(false);
    expect(failedOf(c, r.now + 20 * SEC).reason).toBe('timeout');
  });

  it('the duration can be set (a table\'s check is 30 s)', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b'), r.now, HOSTED_TIMING.readyCheckTableMs);
    expect(c.deadlineAt - r.now).toBe(30 * SEC);
  });
});

describe('M13-9: a failed ready check puts the confirmers at the front', () => {
  it('the confirmer keeps its waiting time and its place: ahead of everyone who came later; the non-confirmer is out', () => {
    const r = new Rig();
    const t0 = r.now;
    r.join('a');
    r.advance(SEC);
    r.join('b');
    const [m] = r.tick(); // a+b at t0+1 s; the ready check starts (admission said yes at once)
    const check = new MatchReadyCheck(m!, r.now);
    r.advance(4 * SEC);
    r.join('c'); // arrives during the check
    r.advance(SEC);
    r.join('d');
    check.confirm('a', r.now);
    r.advance(10 * SEC); // the deadline: t0 + 16 s
    settleReadyCheck(r.matcher, check.poll(r.now)!, r.now, r.metrics);

    expect(r.matcher.queued('a')).toEqual(STANDARD);
    expect(r.matcher.queued('b')).toBeNull(); // b left the queue
    // a (waiting since t0) is matched before d, and with c (the older of the others); the match carries its original time
    const [again] = r.tick();
    expect(who(again!)).toEqual(['a', 'c']);
    expect(again!.entries[0]!.enteredAt).toBe(t0);
    expect(r.matcher.queued('d')).toEqual(STANDARD);
    // (M13-10 review) admission counts ready-check failures (`released(table, now, 'readyCheck')`); settling a failure here no longer counts it a second time
    expect(r.metrics.values.get('openmtg_hosted_ready_check_failures_total{kind="match"}')).toBeUndefined();
    expect(METRICS.readyCheckFailures).toBe('openmtg_hosted_ready_check_failures_total');
  });

  it('the front is by waiting time: an older entry stays ahead of the confirmer, a newer one stays behind it', () => {
    const r = new Rig();
    r.join('o');
    r.absent.add('o'); // o is away for now: it keeps its place, and the others are matched
    r.advance(SEC);
    r.join('a');
    r.advance(SEC);
    r.join('b');
    const [m] = r.tick();
    expect(who(m!)).toEqual(['a', 'b']);
    const check = new MatchReadyCheck(m!, r.now);
    check.confirm('a', r.now);
    r.advance(5 * SEC);
    r.join('n'); // newer than a
    r.advance(10 * SEC);
    settleReadyCheck(r.matcher, failedOf(check, r.now), r.now);
    r.absent.delete('o');
    // o (the oldest) is first, then a, then n
    expect(pairs(r.tick())).toEqual(['o+a']);
    expect(r.matcher.queued('n')).toEqual(STANDARD);
  });

  it('a batch keeps its order, and comes before newer entries that share its time', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd'], { key: POD });
    const [m] = r.tick(); // a pod of 4 at the same instant
    r.join('e', { key: POD }); // at the same instant as the batch's time
    r.matcher.requeueFront(m!.entries, r.now);
    expect(r.matcher.tick(r.now).map((x) => who(x).join('+'))).toEqual(['a+b+c+d']);
    expect(r.matcher.queued('e')).toEqual(POD);
  });

  it('a session that queued again meanwhile is skipped; the busy lookup is not asked (the confirmers were in the match)', () => {
    const r = new Rig();
    const m = matchOf(r, 'a', 'b');
    r.join('a'); // a queued again by itself (the gateway should not allow it, but the matcher is safe)
    r.busy.add('b'); // b is still marked as seated at the match's table when the gateway puts it back
    r.matcher.requeueFront(m.entries, r.now);
    expect(r.matcher.queued('a')).toEqual(STANDARD);
    expect(r.matcher.queued('b')).toEqual(STANDARD);
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(2);
  });

  it('a match that capacity admission refused: all its players go back to the front, none missed', () => {
    const r = new Rig();
    const t0 = r.now;
    r.join('a');
    r.advance(SEC);
    r.join('b');
    const [m] = r.tick();
    r.advance(SEC);
    r.join('c');
    // `serverBusy`: nobody missed anything
    r.matcher.requeueFront(m!.entries, r.now);
    expect(r.matcher.cooldownLeftMs('a', r.now)).toBe(0);
    expect(r.matcher.cooldownLeftMs('b', r.now)).toBe(0);
    const [again] = r.tick();
    expect(who(again!)).toEqual(['a', 'b']);
    expect(again!.entries.map((e) => e.enteredAt)).toEqual([t0, t0 + SEC]);
    expect(r.matcher.queued('c')).toEqual(STANDARD);
  });

  it('a pod\'s confirmers go back to the front the same way, and the pod can start with 3 on their old waiting time', () => {
    const r = new Rig();
    r.joinAll(['a', 'b', 'c', 'd'], { key: POD });
    const [m] = r.tick();
    const check = new MatchReadyCheck(m!, r.now);
    for (const s of ['a', 'b', 'c']) check.confirm(s, r.now + SEC);
    r.advance(15 * SEC);
    settleReadyCheck(r.matcher, check.poll(r.now)!, r.now);
    expect(r.matcher.queued('d')).toBeNull();
    // the three have waited 15 s: not due for a pod of 3 yet; at 90 s of their original waiting they are
    expect(r.tick()).toEqual([]);
    expect(r.advance(75 * SEC - 1).tick()).toEqual([]);
    const [again] = r.advance(1).tick();
    expect(who(again!)).toEqual(['a', 'b', 'c']);
    expect(again!.seats).toBe(3);
  });

  it('settling a check that started changes nothing', () => {
    const r = new Rig();
    const c = new MatchReadyCheck(matchOf(r, 'a', 'b'), r.now);
    c.confirm('a', r.now);
    c.confirm('b', r.now);
    settleReadyCheck(r.matcher, c.poll(r.now)!, r.now, r.metrics);
    expect(r.matcher.status(STANDARD, r.now).waiting).toBe(0);
    expect(r.metrics.values.get('openmtg_hosted_ready_check_failures_total{kind="match"}')).toBeUndefined(); // no failure counted
  });
});

describe('M13-9: two missed ready checks within 10 minutes: no queuing for 2 minutes', () => {
  /** A session that misses a check at `r.now`: it was matched, did not confirm, and the check failed. */
  function miss(r: Rig, session: string): void {
    const partner = `${session}-partner`;
    r.joinAll([session, partner]);
    const [m] = r.tick();
    const c = new MatchReadyCheck(m!, r.now);
    c.confirm(partner, r.now);
    settleReadyCheck(r.matcher, failedOf(c, r.now + 15 * SEC), r.now + 15 * SEC);
    r.matcher.leave(partner);
  }

  it('one miss is nothing: the session can queue again at once, at the back', () => {
    const r = new Rig();
    miss(r, 'b');
    expect(r.matcher.cooldownLeftMs('b', r.now)).toBe(0);
    expect(r.join('b')).toBeNull();
  });

  it('the second within 10 minutes starts a cooldown of 2 minutes', () => {
    const r = new Rig();
    miss(r, 'b');
    r.matcher.leave('b');
    r.advance(9 * MIN);
    miss(r, 'b');
    expect(r.join('b')).toBe('cooldown');
    expect(r.matcher.cooldownLeftMs('b', r.now + 15 * SEC)).toBe(2 * MIN);
    expect(r.advance(15 * SEC + 2 * MIN - 1).join('b')).toBe('cooldown');
    expect(r.advance(1).join('b')).toBeNull();
  });

  it('the window is 10 minutes, the second miss at exactly 10 minutes still counts; 1 ms later it does not', () => {
    const inside = new Rig();
    inside.matcher.missed('s', inside.now);
    inside.matcher.missed('s', inside.now + 10 * MIN);
    expect(inside.matcher.cooldownLeftMs('s', inside.now + 10 * MIN)).toBe(2 * MIN);
    const outside = new Rig();
    outside.matcher.missed('s', outside.now);
    outside.matcher.missed('s', outside.now + 10 * MIN + 1);
    expect(outside.matcher.cooldownLeftMs('s', outside.now + 10 * MIN + 1)).toBe(0);
  });

  it('every further miss within the window starts another cooldown', () => {
    const r = new Rig();
    r.matcher.missed('s', r.now);
    r.matcher.missed('s', r.now + SEC);
    const end1 = r.now + SEC + 2 * MIN;
    expect(r.matcher.cooldownLeftMs('s', end1 - 1)).toBe(1);
    expect(r.matcher.cooldownLeftMs('s', end1)).toBe(0);
    r.matcher.missed('s', end1 + MIN); // after the cooldown, within 10 minutes of the one before
    expect(r.matcher.cooldownLeftMs('s', end1 + MIN)).toBe(2 * MIN);
  });

  it('the policy sets the count, the window and the cooldown', () => {
    const r = new Rig({ policy: { missedChecks: 3, missedWindowMs: MIN, cooldownMs: 5 * MIN } });
    r.matcher.missed('s', r.now);
    r.matcher.missed('s', r.now + SEC);
    expect(r.matcher.cooldownLeftMs('s', r.now + SEC)).toBe(0);
    r.matcher.missed('s', r.now + 2 * SEC);
    expect(r.matcher.cooldownLeftMs('s', r.now + 2 * SEC)).toBe(5 * MIN);
  });

  it('a miss removes a session that is still queued, and old misses do not count once the window has passed', () => {
    const r = new Rig();
    r.join('q');
    r.matcher.missed('q', r.now);
    expect(r.matcher.queued('q')).toBeNull();
    r.matcher.missed('s', r.now);
    r.matcher.missed('s', r.now);
    expect(r.matcher.cooldownLeftMs('s', r.now)).toBe(2 * MIN);
    // long after the window and the cooldown, a new miss is a first miss
    r.advance(30 * MIN);
    r.tick();
    r.matcher.missed('s', r.now);
    expect(r.matcher.cooldownLeftMs('s', r.now)).toBe(0);
  });
});

describe('M13-9: the start request for capacity admission', () => {
  it('units from the seats, the sessions and their address keys in match order, `matched` as the source', () => {
    const r = new Rig();
    r.join('a', { address: 'x' });
    r.join('b', { address: 'y' });
    const [duel] = r.tick();
    expect(matchStartRequest(duel!, 'g1', r.now)).toEqual({
      table: 'g1', source: 'matched', seats: 2, units: 1, sessions: ['a', 'b'], addressKeys: ['x', 'y'], since: r.now,
    });
    r.joinAll(['c', 'd', 'e'], { key: POD });
    r.advance(90 * SEC);
    const [three] = r.tick();
    expect(matchStartRequest(three!, 'g2', r.now)).toMatchObject({ seats: 3, units: 4, sessions: ['c', 'd', 'e'] });
    r.joinAll(['f', 'g', 'h', 'i'], { key: POD });
    const [four] = r.tick();
    expect(matchStartRequest(four!, 'g3', r.now, { two: 1, three: 3, four: 6 })).toMatchObject({ seats: 4, units: 6 });
  });
});
