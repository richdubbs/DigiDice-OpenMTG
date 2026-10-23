/**
 * How the gateway wires matchmaking in (design 4.5, 4.6), as a small model with a fake clock: `queue` -> `enter`; the timer wheel's tick -> `tick`;
 * each match -> `matchStartRequest` -> capacity admission -> a `MatchReadyCheck` -> the game starts or `settleReadyCheck`. The model is the test's, not the
 * gateway's (M13-6); it shows the calls in the order the gateway makes them, and that the pieces fit together.
 */
import { describe, expect, it } from 'vitest';
import { ImmediateAdmission, type Admission, type AdmissionDecision, type StartRequest } from '../../src/admission/api';
import { MatchReadyCheck, settleReadyCheck, matchStartRequest, type Match, type MatchEntry } from '../../src/match';
import { POD, Rig, SEC, STANDARD } from './helpers';

/** An admission that admits everything and keeps the requests it was asked. */
class RecordingAdmission extends ImmediateAdmission {
  readonly asked: StartRequest[] = [];
  override request(r: StartRequest): AdmissionDecision {
    this.asked.push(r);
    return super.request(r);
  }
}

/** A refusing admission for the path the immediate one cannot show. */
class BusyAdmission extends ImmediateAdmission {
  override request(r: StartRequest): AdmissionDecision {
    void r;
    return { kind: 'refused', reason: 'queueFull', retryAfterMs: 120_000 };
  }
}

class MiniGateway {
  readonly rig: Rig;
  readonly admission: ImmediateAdmission;
  /** The tables of matches: the match, its ready check, and the table's id. */
  readonly tables = new Map<string, { match: Match; check: MatchReadyCheck }>();
  readonly started: string[][] = [];
  readonly told: string[] = [];
  private tableId = 0;

  constructor(admission: ImmediateAdmission = new ImmediateAdmission(), rig = new Rig()) {
    this.admission = admission;
    this.rig = rig;
    // `sessionBusy` is the table registry's: seated at a match's table (a ready check runs) or at a running game
    this.rig.busy.clear();
  }

  private seat(match: Match, on: boolean): void {
    for (const e of match.entries) {
      if (on) this.rig.busy.add(e.session);
      else this.rig.busy.delete(e.session);
    }
  }

  /** The timer wheel's tick (once a second) and the ready checks' deadlines. */
  tick(): void {
    const now = this.rig.now;
    for (const match of this.rig.matcher.tick(now)) {
      const table = `t${++this.tableId}`;
      this.seat(match, true);
      const d = (this.admission as Admission).request(matchStartRequest(match, table, now), now);
      if (d.kind === 'admitted') this.tables.set(table, { match, check: new MatchReadyCheck(match, now) });
      else {
        // `serverBusy` or draining: the table is gone, everybody goes back to the front, nobody missed anything
        this.seat(match, false);
        this.rig.matcher.requeueFront(match.entries, now);
        this.told.push(...match.entries.map((e) => `${e.session}:${d.kind === 'refused' ? d.reason : d.kind}`));
      }
    }
    for (const [table, t] of this.tables) {
      const o = t.check.poll(now);
      if (o === null) continue;
      this.tables.delete(table);
      if (o.kind === 'start') {
        (this.admission as Admission).begun(table, now);
        this.started.push(t.match.entries.map((e) => e.session));
      } else {
        (this.admission as Admission).released(table, now, o.reason === 'timeout' ? 'readyCheck' : 'left');
        this.seat(t.match, false);
        settleReadyCheck(this.rig.matcher, o, now, this.rig.metrics);
        this.told.push(...o.missed.map((e) => `${e.session}:missed`), ...o.requeue.map((e) => `${e.session}:requeued`));
      }
    }
  }

  /** `ready` from a session at a match's table. */
  ready(session: string): void {
    for (const t of this.tables.values()) t.check.confirm(session, this.rig.now);
  }

  /** The game is over: seats free, and the players' `recentOpponents` for their next queue entry. */
  finish(sessions: string[]): Map<string, string[]> {
    const recent = new Map<string, string[]>();
    for (const s of sessions) {
      this.rig.busy.delete(s);
      recent.set(s, sessions.filter((x) => x !== s));
    }
    return recent;
  }
}

describe('M13-9: the gateway\'s flow (a model)', () => {
  it('a match is admitted, its ready check runs, and the game starts when both confirmed', () => {
    const g = new MiniGateway();
    g.rig.join('a');
    g.rig.advance(SEC);
    g.rig.join('b');
    g.tick();
    expect(g.admission.admitted).toEqual(['t1']);
    expect(g.admission.size().reserved).toBe(1); // the 1v1's unit is reserved until it begins
    expect(g.rig.busy.has('a') && g.rig.busy.has('b')).toBe(true);
    g.rig.advance(2 * SEC);
    g.ready('a');
    g.ready('b');
    g.tick();
    expect(g.started).toEqual([['a', 'b']]);
    expect(g.admission.size().reserved).toBe(0);
    // seated players cannot queue
    expect(g.rig.join('a')).toBe('atTable');
  });

  it('a ready check that fails: the confirmer is back at the front and is matched with the next arrival; the one that slept is out', () => {
    const g = new MiniGateway();
    g.rig.join('a');
    g.rig.join('b');
    g.tick();
    g.rig.advance(5 * SEC);
    g.ready('a');
    g.rig.advance(10 * SEC); // the 15 s are up
    g.rig.join('c'); // a newcomer, queued after the check began
    g.tick();
    expect(g.told).toEqual(['b:missed', 'a:requeued']);
    expect(g.admission.size().reserved).toBe(0);
    expect(g.rig.matcher.queued('a')).toEqual(STANDARD);
    expect(g.rig.matcher.queued('b')).toBeNull();
    expect(g.rig.busy.has('a')).toBe(false);
    // a is first in the queue: the next tick matches it with c (the table is new, the ready check starts again)
    g.tick();
    expect([...g.tables.values()].map((t) => t.match.entries.map((e) => e.session))).toEqual([['a', 'c']]);
    expect(g.admission.admitted).toEqual(['t1', 't2']);
    // admission counts the failure (M13-10: one count per failed check; the double of this double is not a CapacityAdmission, so none here)
    expect(g.rig.metrics.values.get('openmtg_hosted_ready_check_failures_total{kind="match"}')).toBeUndefined();
  });

  it('a start that admission refuses: both players go back to the front, nobody missed, and they are matched again later', () => {
    const g = new MiniGateway(new BusyAdmission());
    g.rig.join('a');
    g.rig.advance(SEC);
    g.rig.join('b');
    g.tick();
    expect(g.told).toEqual(['a:queueFull', 'b:queueFull']);
    expect(g.rig.matcher.queued('a')).toEqual(STANDARD);
    expect(g.rig.matcher.cooldownLeftMs('a', g.rig.now)).toBe(0);
    expect(g.rig.busy.size).toBe(0);
  });

  it('after a game the same two queue again: no immediate rematch, so each takes the next arrival (or waits 60 s)', () => {
    const g = new MiniGateway();
    g.rig.join('a');
    g.rig.join('b');
    g.tick();
    g.ready('a');
    g.ready('b');
    g.tick();
    const recent = g.finish(['a', 'b']);
    g.rig.advance(5 * SEC);
    g.rig.join('a', { recent: recent.get('a')! });
    g.rig.join('b', { recent: recent.get('b')! });
    g.tick();
    expect(g.tables.size).toBe(0); // alone, they wait
    g.rig.advance(61 * SEC);
    g.tick();
    expect(g.tables.size).toBe(1); // after more than 60 s, with nobody else, they may play again
  });

  it('a pod of 3 after 90 s asks admission for 4 units, a pod of 4 for 5', () => {
    const admission = new RecordingAdmission();
    const g = new MiniGateway(admission);
    for (const s of ['a', 'b', 'c']) g.rig.join(s, { key: POD });
    g.rig.advance(90 * SEC);
    g.tick();
    expect(admission.asked.map((r) => [r.seats, r.units, r.sessions])).toEqual([[3, 4, ['a', 'b', 'c']]]);
    for (const s of ['d', 'e', 'f', 'g']) g.rig.join(s, { key: POD });
    g.tick();
    expect(admission.asked.map((r) => [r.seats, r.units])).toEqual([[3, 4], [4, 5]]);
  });

  it('a drain: the queued entries come back for their notice, and a table in its ready check is the gateway\'s to close', () => {
    const g = new MiniGateway();
    g.rig.join('a');
    g.rig.join('b');
    g.rig.join('c', { key: POD });
    g.tick(); // a+b are at a table
    const lost: MatchEntry[] = g.rig.matcher.drain();
    expect(lost.map((e) => e.session)).toEqual(['c']);
    g.admission.drain();
    g.rig.advance(20 * SEC);
    g.tick(); // the ready check runs out: a and b missed, and nobody is put back during the drain
    expect(g.rig.matcher.queued('a')).toBeNull();
    expect(g.told).toEqual(['a:missed', 'b:missed']);
  });
});
