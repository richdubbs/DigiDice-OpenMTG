/**
 * M15-5: the pair rules of design 11.1 (17.8): `repeatedPairing` (5 rated 1v1 games of a ladder within 7 days, or 6 pods) and `oneSided`
 * (win-trading: 5 meetings within 30 days, one account won at least 80% of them, at least half of them ended by a concession, leave, time-out or
 * disconnect, or before turn 4; in a pod a win is place 1 and the exit that ended the game is the runner-up's). Each fires on a fixture history and
 * stays quiet on a near miss, run as the service runs them: `afterGame` for the game that completes the pattern.
 */
import { describe, expect, it } from 'vitest';
import { createAbuseChecker, type AbuseDraft, type HistoryRow } from '@openmtg/ladder';
import { A, acc, ago, applied, B, C, context, FakeAbuseStore, row, win, type SeatSpec, RULES_11_1 } from './fixtures';

const checker = createAbuseChecker(RULES_11_1);

async function after(rows: HistoryRow[], last = rows[rows.length - 1]!): Promise<AbuseDraft[]> {
  const store = new FakeAbuseStore().add(...rows);
  return checker.afterGame(applied(last), context(store));
}

function only(drafts: AbuseDraft[], kind: AbuseDraft['kind']): AbuseDraft[] {
  return drafts.filter((d) => d.kind === kind);
}

describe('M15-5: repeatedPairing', () => {
  // A and B, winners alternating (so oneSided stays quiet): 3 to 2
  const days = [7, 5, 3, 2, 0];
  const games = (first: number) => [first, ...days.slice(1)].map((d, i) => win(`g${i + 1}`, ago(d), i % 2 === 0 ? A : B, i % 2 === 0 ? B : A));

  it('fires on 5 games of the same pair within 7 days (the window includes its start), with the meetings per day', async () => {
    const drafts = await after(games(7));
    expect(only(drafts, 'repeatedPairing')).toEqual([{
      kind: 'repeatedPairing', ladder: '1v1-standard', accounts: [A, B],
      evidence: {
        games: ['g1', 'g2', 'g3', 'g4', 'g5'],
        stats: { games: 5, 'day.2026-10-08': 1, 'day.2026-10-10': 1, 'day.2026-10-12': 1, 'day.2026-10-13': 1, 'day.2026-10-15': 1 },
      },
    }]);
    expect(only(drafts, 'oneSided')).toEqual([]);
  });

  it('stays quiet when the first game is a moment more than 7 days back (4 in the window)', async () => {
    expect(only(await after(games(7.0001)), 'repeatedPairing')).toEqual([]);
  });

  it('stays quiet on 5 games of a pair spread over several ladders', async () => {
    const rows = games(7).map((r, i) => (i === 2 ? { ...r, ladder: '1v1-pioneer' as const } : r));
    expect(only(await after(rows), 'repeatedPairing')).toEqual([]);
  });

  // A and B in every pod, the other two seats new each time, A and B taking turns ahead of each other
  const pods = (n: number) => Array.from({ length: n }, (_, i) => row(`p${i + 1}`, ago(6 - i), [
    { account: i % 2 === 0 ? A : B, place: 1 },
    { account: i % 2 === 0 ? B : A, place: 2 },
    { account: acc(100 + 2 * i), place: 3 },
    { account: acc(101 + 2 * i), place: 4 },
  ], { ladder: 'pod-commander' }));

  it('pods: fires on the same pair in 6 pods within 7 days, for that pair only', async () => {
    const drafts = only(await after(pods(6)), 'repeatedPairing');
    expect(drafts.map((d) => [d.ladder, d.accounts, d.evidence.games.length, d.evidence.stats['games']])).toEqual([['pod-commander', [A, B], 6, 6]]);
  });

  it('pods: stays quiet on 5 pods (the 1v1 count is not the pod count)', async () => {
    expect(only(await after(pods(5)), 'repeatedPairing')).toEqual([]);
  });
});

describe('M15-5: oneSided (win-trading)', () => {
  // B ahead in 4 of 5 meetings over 25 days (never 5 in 7 days, so repeatedPairing stays quiet)
  const base = () => [
    win('o1', ago(25), B, A, { loss: 'concession', outTurn: 6 }),
    win('o2', ago(20), B, A, { loss: 'left', outTurn: 7 }),
    win('o3', ago(15), B, A, { loss: 'disconnect', outTurn: 8 }),
    win('o4', ago(10), A, B, { loss: 'life', outTurn: 9 }),
    win('o5', ago(0), B, A, { loss: 'life', outTurn: 9 }),
  ];

  it('fires on 5 meetings within 30 days, one ahead in 80%, 3 of 5 ended by a concession, leave or disconnect of the one behind', async () => {
    const drafts = await after(base());
    expect(only(drafts, 'oneSided')).toEqual([{
      kind: 'oneSided', ladder: '1v1-standard', accounts: [A, B],
      evidence: {
        games: ['o1', 'o2', 'o3', 'o4', 'o5'],
        stats: {
          games: 5, 'wins.1': 1, 'wins.2': 4, neither: 0, quick: 3, quits: 3, early: 0,
          'loss.concession': 1, 'loss.left': 1, 'loss.disconnect': 1, 'loss.life': 2,
          'result.1': 2, 'result.2': 2, 'result.3': 2, 'result.4': 1, 'result.5': 2,
          'turn.1': 6, 'turn.2': 7, 'turn.3': 8, 'turn.4': 9, 'turn.5': 9,
        },
      },
    }]);
    expect(only(drafts, 'repeatedPairing')).toEqual([]);
  });

  it('counts a time-out of the one behind as a quick end too', async () => {
    const rows = base();
    rows[2] = win('o3', ago(15), B, A, { loss: 'timeout', outTurn: 8 });
    expect(only(await after(rows), 'oneSided').map((d) => d.evidence.stats['quits'])).toEqual([3]);
  });

  it('stays quiet when the one ahead won only 3 of 5 (60%)', async () => {
    const rows = base();
    rows[4] = win('o5', ago(0), A, B, { loss: 'life', outTurn: 9 });
    expect(only(await after(rows), 'oneSided')).toEqual([]);
  });

  it('stays quiet when only 2 of 5 ended quickly (40%)', async () => {
    const rows = base();
    rows[2] = win('o3', ago(15), B, A, { loss: 'life', outTurn: 8 });
    expect(only(await after(rows), 'oneSided')).toEqual([]);
  });

  it('counts a game whose loser went out before turn 4 as quick, whatever the loss code (turn 3 fires, turn 4 does not)', async () => {
    const at = (outTurn: number) => [25, 20, 15, 10, 0].map((d, i) => win(`t${i + 1}`, ago(d), B, A, { loss: 'life', outTurn: i < 3 ? outTurn : 9, turns: i < 3 ? outTurn : 9 }));
    const fired = only(await after(at(3)), 'oneSided');
    expect(fired.map((d) => [d.evidence.stats['early'], d.evidence.stats['quits'], d.evidence.stats['wins.2']])).toEqual([[3, 0, 5]]);
    expect(only(await after(at(4)), 'oneSided')).toEqual([]);
  });

  it('stays quiet when the first meeting is just over 30 days back (4 in the window)', async () => {
    const rows = base();
    rows[0] = win('o1', ago(30.0001), B, A, { loss: 'concession', outTurn: 6 });
    expect(only(await after(rows), 'oneSided')).toEqual([]);
  });

  it('never pairs a deleted seat, and judges each live pair once', async () => {
    const rows = base().map((r) => ({ ...r, seats: r.seats.map((s) => (s.account === A ? { ...s, account: null } : s)) }));
    expect(await after(rows)).toEqual([]);
    const withC = base();
    withC[4] = row('o5', ago(0), [{ account: B, place: 1 }, { account: A, place: 2, outTurn: 9 }, { account: C, place: 3 }]);
    const drafts = await after(withC);
    expect(drafts.filter((d) => d.kind === 'oneSided').map((d) => d.accounts)).toEqual([[A, B]]);
  });
});

describe("M15-5: oneSided in pods (a win is place 1; the exit that ended the game is the runner-up's)", () => {
  /** 5 pod-commander pods of A and B over 25 days, 12 turns each, the seats of the i-th from `seats(i)`. */
  const pods = (seats: (i: number) => SeatSpec[]) => [25, 20, 15, 10, 0].map((d, i) => row(`w${i + 1}`, ago(d), seats(i), { ladder: 'pod-commander', turns: 12 }));

  it('fires when B won 4 of 5 shared pods and the runner-up conceded or left in 3 of them', async () => {
    const rows = pods((i): SeatSpec[] => (i < 4
      ? [
        { account: B, place: 1 }, { account: acc(100 + i), place: 2, loss: i === 3 ? 'life' : i === 1 ? 'left' : 'concession' },
        { account: A, place: 3, outTurn: 10 }, { account: acc(110 + i), place: 4, outTurn: 8 },
      ]
      : [{ account: acc(100 + i), place: 1 }, { account: A, place: 2 }, { account: B, place: 3, outTurn: 9 }, { account: acc(110 + i), place: 4, outTurn: 7 }]));
    expect(only(await after(rows), 'oneSided')).toEqual([{
      kind: 'oneSided', ladder: 'pod-commander', accounts: [A, B],
      evidence: {
        games: ['w1', 'w2', 'w3', 'w4', 'w5'],
        stats: {
          games: 5, 'wins.1': 0, 'wins.2': 4, neither: 1, quick: 3, quits: 3, early: 0, 'loss.concession': 2, 'loss.left': 1, 'loss.life': 2,
          'result.1': 2, 'result.2': 2, 'result.3': 2, 'result.4': 2, 'result.5': 0, 'turn.1': 12, 'turn.2': 12, 'turn.3': 12, 'turn.4': 12, 'turn.5': 12,
        },
      },
    }]);
  });

  it('stays quiet when B only finished ahead of A and neither won, however often A scooped', async () => {
    // another account wins each pod; B 3rd and A 4th in four of them, A scooping in three; A 3rd in the fifth
    const rows = pods((i): SeatSpec[] => [
      { account: acc(100 + i), place: 1 }, { account: acc(110 + i), place: 2 },
      ...(i < 4
        ? [{ account: B, place: 3, outTurn: 11 }, { account: A, place: 4, loss: i < 3 ? 'concession' : 'life', outTurn: 9 }] satisfies SeatSpec[]
        : [{ account: A, place: 3, outTurn: 11 }, { account: B, place: 4, outTurn: 9 }] satisfies SeatSpec[]),
    ]);
    expect(only(await after(rows), 'oneSided')).toEqual([]);
  });

  it("does not take a pod seat's own scoop for a quick end: the game went on without it", async () => {
    // B wins all 5; A scoops last at turn 5 each time, but the runner-up dies at turn 12
    const rows = pods((i): SeatSpec[] => [
      { account: B, place: 1 }, { account: acc(100 + i), place: 2 }, { account: acc(110 + i), place: 3, outTurn: 9 }, { account: A, place: 4, loss: 'concession', outTurn: 5 },
    ]);
    expect(only(await after(rows), 'oneSided')).toEqual([]);
    // the same pods ended by the runner-up's concession fire
    const quits = pods((i): SeatSpec[] => [
      { account: B, place: 1 }, { account: acc(100 + i), place: 2, loss: 'concession' }, { account: acc(110 + i), place: 3, outTurn: 9 },
      { account: A, place: 4, loss: 'concession', outTurn: 5 },
    ]);
    expect(only(await after(quits), 'oneSided').map((d) => [d.evidence.stats['wins.2'], d.evidence.stats['quits'], d.evidence.stats['loss.concession']])).toEqual([[5, 5, 5]]);
  });
});
