/**
 * M15-4: pods (design 9.3, 9.4, 17.7), with the fake clock and a counter for newMatchId: pods by spread under every member's window (pods cap at
 * 500), a member's 5 minutes waiving the window rule; the cost (spread, placement mix) and its ties (the older entries, then account ids); the
 * 12-candidate search and its tie rule (distance, then enteredAt, then account id, above and below alike); 3-player pods after the anchor's own 2
 * minutes and never 2 from a pod queue; the rematch rule between any two members and its relaxation (repeated pairs, each with one of its two who
 * has waited 10 minutes, at 100 each, so that a group who just played together meets again); address keys and blocks between any two members.
 */
import { describe, expect, it } from 'vitest';
import type { AccountId } from '../../src/accounts';
import { acc, harness, MIN, POD, SEC, who } from './helpers';

/** Every pair of the given accounts. */
function allPairs(ns: readonly number[]): [AccountId, AccountId][] {
  const out: [AccountId, AccountId][] = [];
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) out.push([acc(ns[i]!), acc(ns[j]!)]);
  return out;
}

describe('M15-4: pods by spread (9.3)', () => {
  it('the set of lowest spread wins; the anchor comes first, then the others by rating', () => {
    const h = harness();
    h.join(1, 1500, POD);
    h.join(2, 1450, POD);
    h.join(3, 1490, POD);
    h.join(4, 1510, POD);
    h.join(5, 1530, POD);
    h.join(6, 1600, POD);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 3, 4, 5]]); // spread 40 (1490..1530); 1450..1510 is 60
    expect(ms[0]).toMatchObject({ match: 'm1', ladder: 'pod-commander', seats: 4, spread: 40, relaxed: false, formedAt: h.clock.now() });
    expect(h.waiting('pod-commander')).toEqual([2, 6]);
  });

  it('the spread must be inside every member\'s window: a newcomer\'s ±100 holds the pod back until it widens', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1550, POD);
    h.join(3, 1600, POD);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 15 * SEC);
    h.join(4, 1640, POD); // spread 140: inside the others' 150, outside its own 100
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 30 * SEC - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 30 * SEC);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2, 3, 4]]);
    expect(ms[0]).toMatchObject({ spread: 140, relaxed: false });
  });

  it('a member who has waited 5 minutes waives the window rule for the pod (relaxed); a pod inside every window is not relaxed', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.clock.set(t0 + 4 * MIN);
    h.join(2, 1800, POD);
    h.join(3, 1900, POD);
    h.join(4, 1950, POD);
    h.clock.set(t0 + 5 * MIN - 1);
    expect(h.tick()).toEqual([]); // the newcomers' windows are 250, and no 3 of the 4 fit them either
    h.clock.set(t0 + 5 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2, 3, 4]]);
    expect(ms[0]).toMatchObject({ spread: 450, relaxed: true });

    const k = harness();
    const s0 = k.clock.now();
    k.join(1, 1500, POD);
    k.clock.set(s0 + 6 * MIN);
    k.join(2, 1520, POD);
    k.join(3, 1540, POD);
    k.join(4, 1560, POD);
    expect(k.tick().map((m) => [m.spread, m.relaxed])).toEqual([[60, false]]);
  });

  it('pods widen to ±500 (1v1 stops at 400): a spread of 480 forms at 120 s, not at 105 s', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1600, POD);
    h.join(3, 1700, POD);
    h.join(4, 1980, POD);
    h.clock.set(t0 + 105 * SEC); // window 450
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 120 * SEC); // window 500; a 4-player pod comes before the 3-player one the anchor may now form
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2, 3, 4]]);
    expect(ms[0]!.spread).toBe(480);
  });
});

describe('M15-4: the pod cost and its ties (9.3)', () => {
  it('placement: +50 for each member whose placement status differs from the anchor\'s', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { ...POD, placement: true });
    h.join(2, 1560, { ...POD, placement: true });
    h.join(3, 1580, { ...POD, placement: true });
    h.join(4, 1620, { ...POD, placement: true });
    h.join(5, 1510, POD);
    h.join(6, 1520, POD);
    h.join(7, 1530, POD);
    h.clock.set(t0 + 30 * SEC);
    // 2, 3, 4: spread 120, cost 120; 5, 6, 7: spread 30, cost 180; 2, 3 and a settled player: cost 80 + 50
    expect(who(h.tick())).toEqual([[1, 2, 3, 4]]);
    expect(h.waiting('pod-commander')).toEqual([5, 6, 7]);
  });

  it('equal cost: the older entries (the smaller sum of enteredAt), then the account ids in order', () => {
    // 1 at 1500 with 2 (1510), 3 (1490) and one of 4 and 5 at distance 20 above or below: spread 30 either way
    for (const [r4, r5, at4, at5, want] of [
      [1520, 1480, 1, 2, [1, 3, 2, 4]],
      [1520, 1480, 2, 1, [1, 5, 3, 2]],
      [1480, 1520, 1, 1, [1, 4, 3, 2]],
      [1520, 1480, 1, 1, [1, 3, 2, 4]],
    ] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { ...POD, enteredAt: t0 });
      h.join(2, 1510, { ...POD, enteredAt: t0 + 3 });
      h.join(3, 1490, { ...POD, enteredAt: t0 + 3 });
      h.join(4, r4, { ...POD, enteredAt: t0 + at4 });
      h.join(5, r5, { ...POD, enteredAt: t0 + at5 });
      expect(who(h.tick())).toEqual([want]);
    }
  });
});

describe('M15-4: the 12-candidate search (9.3)', () => {
  it('only the anchor\'s 12 nearest allowed candidates are tried: past them, a later anchor forms the pod', () => {
    const run = (podCandidates?: number) => {
      const h = harness(podCandidates === undefined ? {} : { podCandidates });
      const t0 = h.clock.now();
      h.join(1, 1500, { ...POD, enteredAt: t0 });
      // 2..13 at 1501, 1499, 1502, 1498, ..., 1506, 1494: equal distances above and below, none of them able to sit with another
      for (let k = 1; k <= 6; k++) {
        h.join(2 * k, 1500 + k, { ...POD, enteredAt: t0 + 2 * k - 1 });
        h.join(2 * k + 1, 1500 - k, { ...POD, enteredAt: t0 + 2 * k });
      }
      h.m.noteBlocks(allPairs([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
      h.join(14, 1520, { ...POD, enteredAt: t0 + 13 });
      h.join(15, 1521, { ...POD, enteredAt: t0 + 14 });
      h.join(16, 1522, { ...POD, enteredAt: t0 + 15 });
      return who(h.tick());
    };
    // 1's 12 nearest are 2..13, among whom no 3 may sit together; 2 (blocked with 3..13) finds 1, 14, 15 (spread 21, older than 14, 15, 16)
    expect(run()).toEqual([[2, 1, 14, 15]]);
    expect(run(12)).toEqual(run());
    // with 15 candidates 1 itself reaches 14 and 15, and takes 2 (1501, the oldest of 1501..1506) with them: spread 21
    expect(run(15)).toEqual([[1, 2, 14, 15]]);
  });

  it('the candidates\' tie rule: distance, then the older enteredAt, then account id, above and below alike', () => {
    // with 3 candidates the pod is the anchor and its 3 nearest: 2 and 3 at distance 10, then 4 or 5 at distance 20
    for (const [r4, r5, at4, at5, want] of [
      [1520, 1480, 1, 2, [1, 3, 2, 4]],
      [1520, 1480, 2, 1, [1, 5, 3, 2]],
      [1480, 1520, 1, 1, [1, 4, 3, 2]],
      [1520, 1480, 1, 1, [1, 3, 2, 4]],
    ] as const) {
      const h = harness({ podCandidates: 3 });
      const t0 = h.clock.now();
      h.join(1, 1500, { ...POD, enteredAt: t0 });
      h.join(2, 1510, { ...POD, enteredAt: t0 + 5 });
      h.join(3, 1490, { ...POD, enteredAt: t0 + 5 });
      h.join(4, r4, { ...POD, enteredAt: t0 + at4 });
      h.join(5, r5, { ...POD, enteredAt: t0 + at5 });
      expect(who(h.tick())).toEqual([want]);
    }
  });

  it('a candidate the anchor may not sit with (address key, block, rematch) does not take one of the 12 places', () => {
    const h = harness({ perAddress: 20 });
    const t0 = h.clock.now();
    h.join(1, 1500, { ...POD, enteredAt: t0, addressKey: 'home', recent: [[2, 3, 4]] });
    for (let n = 2; n <= 13; n++) {
      h.join(n, 1500 + n, { ...POD, enteredAt: t0 + n, addressKey: n >= 5 && n <= 9 ? 'home' : `ip${n}` });
    }
    h.m.noteBlocks(allPairs([1, 10]).concat(allPairs([1, 11]), allPairs([1, 12]), allPairs([1, 13])));
    h.join(14, 1530, { ...POD, enteredAt: t0 + 14 });
    h.join(15, 1531, { ...POD, enteredAt: t0 + 15 });
    h.join(16, 1532, { ...POD, enteredAt: t0 + 16 });
    // 2..13 are all ruled out for 1, so its candidates are 14, 15, 16 (the 13th to 15th nearest)
    expect(who(h.tick())[0]).toEqual([1, 14, 15, 16]);
  });
});

describe('M15-4: 3-player pods, never 2 (9.3)', () => {
  it('three players form a pod once the anchor has waited 2 minutes', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1510, POD);
    h.join(3, 1520, POD);
    h.clock.set(t0 + 2 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 2 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2, 3]]);
    expect(ms[0]).toMatchObject({ seats: 3, spread: 20, relaxed: false });
  });

  it('a 4-player pod comes first while one is allowed, after 2 minutes too', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1510, POD);
    h.join(3, 1520, POD);
    h.clock.set(t0 + 2 * MIN);
    h.join(4, 1530, POD);
    expect(who(h.tick())).toEqual([[1, 2, 3, 4]]);
  });

  it('the anchor\'s own 2 minutes: an older member\'s wait does not let a younger anchor form 3', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.clock.set(t0 + MIN);
    h.join(2, 1510, POD);
    h.join(3, 1520, POD);
    h.join(4, 1530, POD);
    h.m.noteBlocks([[acc(1), acc(2)], [acc(1), acc(3)], [acc(1), acc(4)]]);
    h.clock.set(t0 + 3 * MIN - 1);
    expect(h.tick()).toEqual([]); // 1 sits with nobody; 2 has waited under 2 minutes
    h.clock.set(t0 + 3 * MIN);
    expect(who(h.tick())).toEqual([[2, 3, 4]]);
    expect(h.waiting('pod-commander')).toEqual([1]);
  });

  it('never 2 players from a pod queue, however long they wait', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1500, POD);
    for (const at of [0, 2 * MIN, 5 * MIN, 10 * MIN, 60 * MIN]) {
      h.clock.set(t0 + at);
      expect(h.tick()).toEqual([]);
    }
    expect(h.waiting('pod-commander')).toEqual([1, 2]);
  });
});

describe('M15-4: rematches, address keys and blocks in pods (9.4)', () => {
  it('no two members who were in a pod in either one\'s last 3 pods, whether or not the anchor is one of them', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1510, POD);
    h.join(3, 1520, { ...POD, recent: [[7, 8], [2, 9, 6]] });
    h.join(4, 1530, POD);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 2 * MIN);
    expect(who(h.tick())).toEqual([[1, 2, 4]]); // 2, 4 and 3, 4 both spread 30, equally old: ids 2, 4 first
    expect(h.waiting('pod-commander')).toEqual([3]);
  });

  it('the 4th pod back no longer counts', () => {
    const h = harness();
    h.join(1, 1500, POD);
    h.join(2, 1510, { ...POD, recent: [[7], [8], [9], [3, 1]] });
    h.join(3, 1520, POD);
    h.join(4, 1530, POD);
    expect(who(h.tick())).toEqual([[1, 2, 3, 4]]);
  });

  it('relaxed once one of the repeated pair has waited 10 minutes and nothing else is allowed: the anchor\'s own wait does not relax another pair', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.clock.set(t0 + 5 * MIN);
    h.join(2, 1510, POD);
    h.join(3, 1520, { ...POD, recent: [[2]] });
    h.clock.set(t0 + 10 * MIN);
    expect(h.tick()).toEqual([]); // the anchor has waited 10 minutes, but neither of the pair 2, 3
    h.clock.set(t0 + 15 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 15 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2, 3]]);
    expect(ms[0]).toMatchObject({ seats: 3, relaxed: true });

  });

  it('two repeated pairs: allowed once each of them has one of its two who has waited 10 minutes', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, { ...POD, recent: [[2]] });
    h.clock.set(t0 + 5 * MIN);
    h.join(2, 1510, POD);
    h.join(3, 1520, { ...POD, recent: [[2]] });
    h.clock.set(t0 + 10 * MIN);
    expect(h.tick()).toEqual([]); // 1-2 may repeat (1 has waited 10 minutes), 2-3 not yet
    h.clock.set(t0 + 15 * MIN - 1);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 15 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 2, 3]]);
    expect(ms[0]).toMatchObject({ seats: 3, spread: 20, relaxed: true });
  });

  it('a group who just played a pod together meets again once the relaxation applies: 4, then 3, then 5 regulars', () => {
    // review finding: with one repeated pair at most, each of these waited for ever (their recent games age out only by playing)
    const four = harness();
    const t0 = four.clock.now();
    const others = (n: number, of: readonly number[]) => of.filter((x) => x !== n);
    for (const n of [1, 2, 3, 4]) four.join(n, 1500 + n, { ...POD, enteredAt: t0, recent: [others(n, [1, 2, 3, 4])] });
    four.clock.set(t0 + 10 * MIN - 1);
    expect(four.tick()).toEqual([]);
    four.clock.set(t0 + 10 * MIN);
    const ms = four.tick();
    expect(who(ms)).toEqual([[1, 2, 3, 4]]);
    expect(ms[0]).toMatchObject({ seats: 4, spread: 3, relaxed: true });
    expect(four.waiting('pod-commander')).toEqual([]);

    const three = harness();
    const s0 = three.clock.now();
    for (const n of [1, 2, 3]) three.join(n, 1500 + n, { ...POD, enteredAt: s0, recent: [others(n, [1, 2, 3])] });
    three.clock.set(s0 + 10 * MIN - 1);
    expect(three.tick()).toEqual([]);
    three.clock.set(s0 + 10 * MIN);
    expect(three.tick().map((m) => [who([m])[0], m.seats, m.relaxed])).toEqual([[[1, 2, 3], 3, true]]);

    // pods {1,2,3,4}, {1,2,3,5}, {1,2,4,5}, {1,3,4,5}, {2,3,4,5}: each one's last 3 pods together hold the other 4
    const five = harness();
    const u0 = five.clock.now();
    const recent: Record<number, number[][]> = {
      1: [[3, 4, 5], [2, 4, 5], [2, 3, 5]],
      2: [[3, 4, 5], [1, 4, 5], [1, 3, 5]],
      3: [[2, 4, 5], [1, 4, 5], [1, 2, 5]],
      4: [[2, 3, 5], [1, 3, 5], [1, 2, 5]],
      5: [[2, 3, 4], [1, 3, 4], [1, 2, 4]],
    };
    for (const n of [1, 2, 3, 4, 5]) five.join(n, 1500 + n, { ...POD, enteredAt: u0, recent: recent[n] });
    five.clock.set(u0 + 10 * MIN);
    expect(who(five.tick())).toEqual([[1, 2, 3, 4]]); // every set has 6 repeated pairs: the lowest spread
    expect(five.waiting('pod-commander')).toEqual([5]);
  });

  it('under the relaxation each repeated pair costs 100: fewer repeats against a wider spread', () => {
    // 3 and 4 share an address key, so the only pods are {1, 2, 3} (1-2 repeated) and {1, 2, 4} (1-2 and 2-4): nothing before the relaxation
    for (const [r3, want] of [[1600, [1, 2, 3]], [1620, [1, 2, 3]], [1640, [1, 2, 4]]] as const) {
      const h = harness();
      const t0 = h.clock.now();
      h.join(1, 1500, { ...POD, enteredAt: t0, recent: [[2]] });
      h.join(2, 1510, { ...POD, enteredAt: t0, recent: [[4]] });
      h.join(3, r3, { ...POD, enteredAt: t0, addressKey: 'home' });
      h.join(4, 1520, { ...POD, enteredAt: t0, addressKey: 'home' });
      h.clock.set(t0 + 10 * MIN - 1);
      expect(h.tick(), `${r3}: before the relaxation`).toEqual([]);
      h.clock.set(t0 + 10 * MIN);
      // {1, 2, 4}: spread 20 + 200. {1, 2, 3}: 100 + 100 (1600), 120 + 100 (1620: equal, equally old, ids 2, 3 first), 140 + 100 (1640)
      const ms = h.tick();
      expect(who(ms), String(r3)).toEqual([want]);
      expect(ms[0]).toMatchObject({ seats: 3, relaxed: true });
    }
  });

  it('not relaxed while a pod without a repeat is allowed, of 3 if need be', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1510, { ...POD, recent: [[1]] });
    h.join(3, 1520, POD);
    h.join(4, 1530, POD);
    h.clock.set(t0 + 10 * MIN);
    const ms = h.tick();
    expect(who(ms)).toEqual([[1, 3, 4]]);
    expect(ms[0]!.relaxed).toBe(false);
  });

  it('equal address keys never share a pod, anchor or not, however long they wait', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1510, { ...POD, addressKey: 'home' });
    h.join(3, 1520, { ...POD, addressKey: 'home' });
    h.join(4, 1530, POD);
    h.clock.set(t0 + MIN);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 60 * MIN);
    expect(who(h.tick())).toEqual([[1, 2, 4]]);
    expect(h.waiting('pod-commander')).toEqual([3]);
  });

  it('a block noted between any two members keeps them apart', () => {
    const h = harness();
    const t0 = h.clock.now();
    h.join(1, 1500, POD);
    h.join(2, 1510, POD);
    h.join(3, 1520, POD);
    h.join(4, 1530, POD);
    h.m.noteBlocks([[acc(4), acc(3)]]);
    expect(h.tick()).toEqual([]);
    h.clock.set(t0 + 60 * MIN);
    expect(who(h.tick())).toEqual([[1, 2, 3]]); // 2, 3 (spread 20) over 2, 4 (30)
  });

  it('a pod block found at match formation: everyone requeued at the front keeps their place, the note holds', () => {
    const h = harness();
    const t0 = h.clock.now();
    for (let n = 1; n <= 4; n++) h.join(n, 1500 + 10 * n, { ...POD, enteredAt: t0 + n });
    const [m] = h.tick();
    expect(who([m!])).toEqual([[1, 2, 3, 4]]);
    h.clock.set(t0 + 20 * SEC);
    h.join(5, 1555, POD);
    h.m.noteBlocks([[acc(2), acc(4)]]);
    h.m.requeueFront(m!.entries, h.clock.now());
    expect(h.waiting('pod-commander')).toEqual([1, 2, 3, 4, 5]);
    h.clock.set(t0 + 40 * SEC);
    // 1 anchors first again; 2 and 4 stay apart: 1, 2, 3, 5 (spread 45) or 1, 3, 4, 5 (spread 45): the older, 2 before 4
    expect(who(h.tick())).toEqual([[1, 2, 3, 5]]);
  });
});
