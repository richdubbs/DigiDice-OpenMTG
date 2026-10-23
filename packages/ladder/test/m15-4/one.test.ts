/**
 * M15-4: 1v1 pairing (design 9.2, 9.4, 17.7), with the fake clock and a counter for newMatchId: mutual windows and the everyone override; the
 * lowest-cost partner and every tie rule; placement players preferring each other; no opponent from the last 3 games, and the relaxation when either
 * side has waited 10 minutes; equal address keys never matched; blocked pairs never matched, with the notes' lifetime.
 */
import { describe, expect, it } from 'vitest';
import type { RankedMatch } from '../../src/match/api';
import { acc, harness, MIN, SEC, who } from './helpers';

describe('M15-4: windows (9.2)', () => {
  it('mutual: a long waiter and a newcomer 300 apart wait until the newcomer\'s window reaches 300', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500);
    h.clock.set(t0 + 2 * MIN);
    h.join(2, 1800);
    expect(h.tick()).toEqual([]); // 1's window is 400, 2's is 100
    h.clock.set(t0 + 3 * MIN - 1);
    expect(h.tick()).toEqual([]); // 2's window is 250
    h.clock.set(t0 + 3 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2]]);
    expect(ms[0]).toMatchObject({ match: 'm1', ladder: '1v1-standard', seats: 2, formedAt: t0 + 3 * MIN, spread: 300, relaxed: false });
    expect(h.waiting()).toEqual([]);
  });

  it('mutual, or either has waited 5 minutes: 450 apart (beyond every capped window) they meet at the older one\'s 5 minutes', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500);
    h.clock.set(t0 + MIN);
    h.join(2, 1950);
    h.clock.set(t0 + 5 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 5 * MIN);
    expect(h.tick().map((m) => [who([m])[0], m.spread, m.relaxed])).toEqual([[[1, 2], 450, true]]);
  });

  it('the everyone override: a lone outlier 800 away is matched once it has waited 5 minutes, whatever the newcomer\'s window', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 2300);
    h.clock.set(t0 + 4 * MIN);
    h.join(2, 1500);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 5 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 5 * MIN);
    const [m] = h.tick();
    expect(m).toMatchObject({ spread: 800, relaxed: true });
    expect(who([m!])).toEqual([[1, 2]]);
  });

  it('a pair inside both capped windows is not marked relaxed, even when one has waited 5 minutes', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500);
    h.clock.set(t0 + 6 * MIN);
    h.join(2, 1580);
    expect(h.tick().map((m) => m.relaxed)).toEqual([false]);
  });
});

describe('M15-4: the lowest-cost partner and the tie rules (9.2)', () => {
  it('anchors go oldest first, each taking its own lowest-cost partner', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0 });
    h.join(2, 1540, { enteredAt: t0 + 1 });
    h.join(3, 1570, { enteredAt: t0 + 2 }); // 2's nearest, but 1 chooses first
    expect(who(h.tick())).toEqual([[1, 2]]);
    expect(h.waiting()).toEqual([3]);
  });

  it('the nearest partner wins over an older one further away', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0 });
    h.join(2, 1580, { enteredAt: t0 + 1 });
    h.join(3, 1520, { enteredAt: t0 + 2 });
    expect(who(h.tick())).toEqual([[1, 3]]);
  });

  it('equal cost: the smaller rating distance', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0 });
    h.join(2, 1600, { enteredAt: t0 + 1 }); // cost 100
    h.join(3, 1550, { enteredAt: t0 + 2, placement: true }); // cost 50 + 50
    expect(who(h.tick())).toEqual([[1, 3]]);
  });

  it('equal cost and distance, one above and one below: the older enteredAt', () => {
    for (const [above, below, want] of [[1, 2, 2], [2, 1, 3]] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { enteredAt: t0 });
      h.join(2, 1540, { enteredAt: t0 + above });
      h.join(3, 1460, { enteredAt: t0 + below });
      expect(who(h.tick())).toEqual([[1, want]]);
    }
  });

  it('equal cost, distance and enteredAt: the smaller account id', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0 });
    h.join(5, 1540, { enteredAt: t0 + 1 });
    h.join(3, 1460, { enteredAt: t0 + 1 });
    expect(who(h.tick())).toEqual([[1, 3]]);
  });

  it('equal enteredAt among anchors: the smaller account id anchors first', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(4, 1500, { enteredAt: t0 });
    h.join(2, 1540, { enteredAt: t0 });
    h.join(3, 1570, { enteredAt: t0 + 1 });
    expect(who(h.tick())).toEqual([[2, 3]]); // 2 anchors first: 3 (30) is nearer than 4 (40)
  });
});

describe('M15-4: placement players prefer each other (9.4)', () => {
  it('a placement anchor takes a placement player 70 away over a settled one 30 away (cost 70 against 80)', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0, placement: true });
    h.join(2, 1530, { enteredAt: t0 + 1 });
    h.join(3, 1570, { enteredAt: t0 + 2, placement: true });
    expect(who(h.tick())).toEqual([[1, 3]]);
  });

  it('a settled anchor takes a settled player 60 away over a placement player 20 away (cost 60 against 70)', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0 });
    h.join(2, 1520, { enteredAt: t0 + 1, placement: true });
    h.join(3, 1560, { enteredAt: t0 + 2 });
    expect(who(h.tick())).toEqual([[1, 3]]);
  });

  it('the preference is only a cost: a placement player still meets a settled one when that is all there is', () => {
    const h = harness();
    h.join(1, 1500, { placement: true });
    h.join(2, 1590);
    expect(who(h.tick())).toEqual([[1, 2]]);
  });
});

describe('M15-4: no rematch within the last 3 games, and the relaxation (9.4)', () => {
  it('an opponent of any of the last 3 games, in either one\'s list, is not allowed; the 4th game back is', () => {
    for (const [recent1, recent2, want] of [
      [[[2]], [], [[1, 3]]],
      [[], [[1]], [[1, 3]]],
      [[[7], [8], [2]], [], [[1, 3]]],
      [[[7], [8], [9], [2]], [], [[1, 2]]],
    ] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { enteredAt: t0, recent: recent1.map((g) => [...g]) });
      h.join(2, 1510, { enteredAt: t0 + 1, recent: recent2.map((g) => [...g]) });
      h.join(3, 1590, { enteredAt: t0 + 2 });
      expect(who(h.tick())).toEqual(want);
    }
  });

  it('rematchGames from the policy', () => {
    const h = harness({ rematchGames: 1 });
    h.join(1, 1500, { recent: [[7], [2]] });
    h.join(2, 1510);
    expect(who(h.tick())).toEqual([[1, 2]]);
  });

  it('relaxed once the anchor has waited 10 minutes and nobody else is allowed', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { recent: [[2]] });
    h.clock.set(t0 + MIN);
    h.join(2, 1510);
    h.clock.set(t0 + 10 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 10 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2]]);
    expect(ms[0]!.relaxed).toBe(true);
  });

  it('relaxed once either side has waited 10 minutes: the older one need not be the one who played', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500);
    h.clock.set(t0 + MIN);
    h.join(2, 1510, { recent: [[1]] });
    h.clock.set(t0 + 10 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 10 * MIN);
    expect(h.tick().map((m) => [who([m])[0], m.relaxed])).toEqual([[[1, 2], true]]);
  });

  it('not relaxed while anything else is allowed for the anchor', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { recent: [[2]] });
    h.join(2, 1510, { enteredAt: t0 + 30 * SEC });
    h.clock.set(t0 + 10 * MIN);
    h.join(3, 1580);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 3]]);
    expect(ms[0]!.relaxed).toBe(false);
    expect(h.waiting()).toEqual([2]);
  });

  it('the relaxation lifts the rematch rule only: equal address keys stay apart', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { recent: [[2]], addressKey: 'home' });
    h.join(2, 1510, { addressKey: 'home' });
    h.clock.set(t0 + 60 * MIN);
    expect(h.tick()).toEqual([]);
  });
});

describe('M15-4: address keys and blocks (9.4)', () => {
  it('equal address keys are never matched, however long they wait', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { addressKey: 'home' });
    h.join(2, 1500, { addressKey: 'home' });
    for (const at of [0, 5 * MIN, 10 * MIN, 60 * MIN]) {
      h.clock.set(t0 + at);
      expect(h.tick()).toEqual([]);
    }
    h.join(3, 1550);
    expect(who(h.tick())).toEqual([[1, 3]]);
  });

  it('a pair noted at entry is never matched, in either direction of the note', () => {
    for (const pair of [[acc(1), acc(2)], [acc(2), acc(1)]] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500);
      h.join(2, 1500);
      h.m.noteBlocks([pair]);
      h.clock.set(t0 + 60 * MIN);
      expect(h.tick()).toEqual([]);
      h.join(3, 1990);
      expect(who(h.tick())).toEqual([[1, 3]]);
    }
  });

  it('a block set while both wait is caught at match formation: everyone requeued at the front, the note kept, in either order of the calls', () => {
    const results: unknown[] = [];
    for (const order of ['requeueFirst', 'noteFirst'] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { enteredAt: t0 });
      h.join(2, 1510, { enteredAt: t0 + 1 });
      h.join(3, 1700, { enteredAt: t0 + 2 });
      h.join(4, 1710, { enteredAt: t0 + 3 });
      h.clock.advance(20 * SEC);
      const ms = h.tick();
      expect(who(ms)).toEqual([[1, 2], [3, 4]]);
      // hosted's blockedAmong finds 1 and 2 before it creates the first table
      const blocked: RankedMatch = ms[0]!;
      if (order === 'requeueFirst') {
        h.m.requeueFront(blocked.entries, h.clock.now());
        h.m.noteBlocks([[acc(1), acc(2)]]);
      } else {
        h.m.noteBlocks([[acc(1), acc(2)]]);
        h.m.requeueFront(blocked.entries, h.clock.now());
      }
      expect(h.waiting()).toEqual([1, 2]);
      expect(h.m.window(acc(1), h.clock.now())).toBe(150); // its wait kept
      expect(h.tick()).toEqual([]);
      h.clock.advance(SEC);
      h.join(5, 1515);
      const next = h.tick();
      results.push(next);
      expect(who(next)).toEqual([[1, 5]]); // 1 is the oldest anchor; 2 stays apart from 1
      expect(h.waiting()).toEqual([2]);
    }
    expect(results[0]).toEqual(results[1]);
  });

  it('a note is kept while its accounts are matched and out of the queue', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { enteredAt: t0 });
    h.join(2, 1510, { enteredAt: t0 + 1 });
    h.join(3, 1520, { enteredAt: t0 + 2 });
    h.m.noteBlocks([[acc(1), acc(2)]]);
    const [m] = h.tick();
    expect(who([m!])).toEqual([[1, 3]]); // 2 is nearer, but blocked
    h.m.requeueFront(m!.entries, h.clock.now()); // say 3 dropped out of the start: both go back
    h.m.leave(acc(3));
    expect(h.tick()).toEqual([]);
  });

  it('notes are dropped on leave, on missed and on entering again after a match', () => {
    for (const drop of ['leave', 'missed', 'enter'] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { enteredAt: t0 });
      const two = h.join(2, 1510, { enteredAt: t0 + 1 });
      h.m.noteBlocks([[acc(1), acc(2)]]);
      expect(h.tick()).toEqual([]);
      if (drop === 'leave') {
        expect(h.m.leave(acc(2))).toBe(true);
        h.m.requeueFront([two], h.clock.now()); // requeueFront itself notes nothing and drops nothing
      } else if (drop === 'missed') {
        h.m.leave(acc(2));
        h.m.noteBlocks([[acc(1), acc(2)]]); // noted again while 2 is out (a ready check)
        h.m.missed(acc(2), h.clock.now());
        h.m.requeueFront([two], h.clock.now());
      } else {
        h.join(3, 1610, { enteredAt: t0 + 2 });
        expect(who(h.tick())).toEqual([[2, 3]]); // 1 is blocked with 2 and 110 from 3; the note stays while 2 plays
        h.join(2, 1510, { enteredAt: t0 + 3 }); // entryFor finds no block now: no fresh pairs
      }
      expect(who(h.tick()), drop).toEqual([[1, 2]]);
    }
  });

  it('entryFor\'s fresh pairs hold whether hosted notes them before or after enter, the first time and after a game', () => {
    // review finding: enter dropped every note of the account, so pairs noted just before it were lost and the blocked pair was matched
    const results: unknown[] = [];
    for (const order of ['noteFirst', 'enterFirst'] as const) {
      for (const played of [false, true]) {
        const h = harness();
        const t0 = h.clock.now();
        h.join(1, 1500, { enteredAt: t0 });
        if (played) {
          // 2 queued before, noted with 1, and was matched with 3
          h.join(2, 1510, { enteredAt: t0 + 1 });
          h.m.noteBlocks([[acc(1), acc(2)]]);
          h.join(3, 1610, { enteredAt: t0 + 2 });
          expect(who(h.tick())).toEqual([[2, 3]]);
        }
        h.clock.advance(MIN);
        // hosted: entryFor(2's request, accounts(ladder) = [1]) still finds the block
        const fresh = [[acc(2), acc(1)]] as const;
        if (order === 'noteFirst') {
          h.m.noteBlocks(fresh);
          h.join(2, 1510);
        } else {
          h.join(2, 1510);
          h.m.noteBlocks(fresh);
        }
        const label = `${order}, ${played ? 'after a game' : 'first time'}`;
        expect(h.tick(), label).toEqual([]);
        h.join(4, 1520);
        const ms = h.tick();
        expect(who(ms), label).toEqual([[1, 4]]);
        expect(h.waiting(), label).toEqual([2]);
        results.push([played, ms]);
      }
    }
    expect(results.slice(0, 2)).toEqual(results.slice(2));
  });

  it('a requeued entry was not checked against those who came in while it was out: hosted\'s notes for it hold in either order', () => {
    // accounts(ladder) lists the waiting entries only (13.5), so 2's entryFor did not see 1, who was in a ready check; hosted's blockedAmong
    // check of the formed match (9.4) catches the pair, or hosted notes the requeued entries' pairs with the queue around requeueFront
    for (const order of ['none', 'noteFirst', 'requeueFirst'] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { enteredAt: t0 });
      h.join(3, 1505, { enteredAt: t0 + 1 });
      const [m] = h.tick();
      expect(who([m!])).toEqual([[1, 3]]);
      expect(h.m.accounts('1v1-standard')).toEqual([]);
      h.clock.advance(5 * SEC);
      h.join(2, 1510);
      h.m.missed(acc(3), h.clock.now()); // 3 misses the ready check; 1 goes back to the front
      if (order === 'noteFirst') h.m.noteBlocks([[acc(1), acc(2)]]);
      h.m.requeueFront([m!.entries[0]!], h.clock.now());
      if (order === 'requeueFirst') h.m.noteBlocks([[acc(1), acc(2)]]);
      expect(who(h.tick()), order).toEqual(order === 'none' ? [[1, 2]] : []);
    }
  });

  it('a note of an account with itself, or of an account that never queues, changes nothing', () => {
    const h = harness();
    h.m.noteBlocks([[acc(1), acc(1)], [acc(1), acc(9)]]);
    h.join(1, 1500);
    h.m.noteBlocks([[acc(1), acc(1)], [acc(2), acc(9)]]);
    h.join(2, 1510);
    expect(who(h.tick())).toEqual([[1, 2]]);
    expect(() => h.m.noteBlocks([[acc(1)] as never])).toThrow(TypeError);
  });
});
