/**
 * M15-5: the rules over one account's games of design 11.1 (17.8): `earlyConcessions`, `smurf`, `ratingTransfer` and `sandbagging`. Each fires on
 * a fixture history and stays quiet on a near miss, run through `afterGame` for the game that completes the pattern.
 */
import { describe, expect, it } from 'vitest';
import type { AccountId } from '@openmtg/accounts/api';
import { createAbuseChecker, type AbuseDraft, type HistoryRow, type LossCode, type Place } from '@openmtg/ladder';
import { A, acc, ago, applied, B, C, context, D, E, F, FakeAbuseStore, row, win, RULES_11_1 } from './fixtures';

const checker = createAbuseChecker(RULES_11_1);

async function after(rows: HistoryRow[], o: { created?: Partial<Record<AccountId, string>>; last?: HistoryRow } = {}): Promise<AbuseDraft[]> {
  const store = new FakeAbuseStore().add(...rows);
  return checker.afterGame(applied(o.last ?? rows[rows.length - 1]!), context(store, { created: o.created }));
}

function only(drafts: AbuseDraft[], kind: AbuseDraft['kind']): AbuseDraft[] {
  return drafts.filter((d) => d.kind === kind);
}

describe('M15-5: earlyConcessions', () => {
  // A loses to five different opponents (so no pair rule can fire), by concession or leave before turn 3
  const opponents = [B, C, D, E, F];
  const base = () => opponents.map((o, i) => win(`e${i + 1}`, ago(6 - i), o, A, { loss: i % 2 === 0 ? 'concession' : 'left', outTurn: i % 2 === 0 ? 1 : 2, turns: 2 }));

  it('fires on 5 rated games lost by concession or leave before turn 3 within 7 days, naming the account only', async () => {
    expect(only(await after(base()), 'earlyConcessions')).toEqual([{
      kind: 'earlyConcessions', ladder: '1v1-standard', accounts: [A],
      evidence: {
        games: ['e1', 'e2', 'e3', 'e4', 'e5'],
        stats: { losses: 5, concessions: 3, leaves: 2, opponents: 5, mostToOneOpponent: 1, 'turn.1': 1, 'turn.2': 2, 'turn.3': 1, 'turn.4': 2, 'turn.5': 1 },
      },
    }]);
  });

  it('stays quiet when one of them went out on turn 3', async () => {
    const rows = base();
    rows[2] = win('e3', ago(4), D, A, { loss: 'concession', outTurn: 3, turns: 3 });
    expect(only(await after(rows), 'earlyConcessions')).toEqual([]);
  });

  it('stays quiet when one of them was a time-out (only concessions and leaves count)', async () => {
    const rows = base();
    rows[2] = win('e3', ago(4), D, A, { loss: 'timeout', outTurn: 1, turns: 1 });
    expect(only(await after(rows), 'earlyConcessions')).toEqual([]);
  });

  it('stays quiet when the first of them is more than 7 days before the game the check runs after', async () => {
    const rows = base();
    rows[0] = win('e1', ago(9.01), B, A, { loss: 'concession', outTurn: 1, turns: 2 }); // 7.01 days before the last, at 2 days back
    expect(only(await after(rows), 'earlyConcessions')).toEqual([]);
  });

  it('counts a pod seat that conceded early, at its own out turn', async () => {
    const pods = opponents.map((o, i) => row(`q${i + 1}`, ago(6 - i), [
      { account: o, place: 1 }, { account: acc(50 + i), place: 2 }, { account: acc(60 + i), place: 3 }, { account: A, place: 4, loss: 'concession', outTurn: 2 },
    ], { ladder: 'pod-commander', turns: 14 }));
    expect(only(await after(pods), 'earlyConcessions').map((d) => d.evidence.stats['losses'])).toEqual([5]);
  });
});

describe('M15-5: smurf', () => {
  const NEW = acc(42);
  const made = (days: number) => ({ [NEW]: ago(days) });
  /**
   * n games of the new account against different opponents, 6 hours apart and the last one now, `wins` of them won (the first ones), its rating
   * after each from `path`, the first `placement` of them in placement (hidden after each but the last of them, as M15-3 applies them).
   */
  const career = (n: number, wins: number, path: (i: number) => number, placement = 10) => Array.from({ length: n }, (_, i) => {
    const before = i === 0 ? 1500 : path(i - 1);
    const mine = { from: before, to: path(i), placement: i < placement - 1 ? true : i === placement - 1 ? ('ends' as const) : false };
    const opp = acc(200 + i);
    return i < wins
      ? row(`s${i + 1}`, ago((n - 1 - i) * 0.25), [{ account: NEW, place: 1, ...mine }, { account: opp, place: 2 }])
      : row(`s${i + 1}`, ago((n - 1 - i) * 0.25), [{ account: opp, place: 1 }, { account: NEW, place: 2, ...mine }]);
  });
  const flat = () => 1600;

  it('fires on an account 10 days old that won 12 of its 15 games (80%), with its rating path', async () => {
    const drafts = only(await after(career(15, 12, flat), { created: made(10) }), 'smurf');
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect([d.ladder, d.accounts, d.evidence.games.length]).toEqual(['1v1-standard', [NEW], 15]);
    expect(d.evidence.stats).toMatchObject({ games: 15, wins: 12, winRate: 0.8, byWins: 1, byRating: 0, ageDays: 10, peak: 1600, 'rating.1': 1600, 'rating.15': 1600 });
  });

  it('stays quiet on 11 wins of 15 (73%), and on 14 wins of 14 games (fewer than 15)', async () => {
    expect(only(await after(career(15, 11, flat), { created: made(10) }), 'smurf')).toEqual([]);
    expect(only(await after(career(14, 14, flat), { created: made(10) }), 'smurf')).toEqual([]);
  });

  it('never fires on a hidden placement rating; fires on the first shown one of 1800, after the 10th game', async () => {
    const climb = (i: number) => 1500 + 40 * (i + 1); // 1540, 1580, ..., 1820 after the 8th game, 1900 after the 10th
    // 9 games: 1820 and 1860 hidden, nothing shown yet
    expect(only(await after(career(9, 9, climb), { created: made(5) }), 'smurf')).toEqual([]);
    // the 10th ends placement: 1900 shown. The hidden path stays in the evidence, marked as hidden
    const drafts = only(await after(career(10, 10, climb), { created: made(5) }), 'smurf');
    const stats = (d: AbuseDraft) => d.evidence.stats;
    expect(drafts.map((d) => [stats(d)['byRating'], stats(d)['byWins'], stats(d)['reachedAt'], stats(d)['peak'], stats(d)['hiddenGames'], stats(d)['hiddenPeak']]))
      .toEqual([[1, 0, 10, 1900, 9, 1860]]);
    expect([drafts[0]!.evidence.stats['rating.8'], drafts[0]!.evidence.stats['rating.10']]).toEqual([1820, 1900]);
  });

  it('fires on a shown rating of 1800 reached at the 30th game, not on 1799', async () => {
    // placement ends at 1700 (hidden at most 1720), shown 1700 until the 30th game; 15 wins of 30 (byWins stays quiet)
    const placement = [1600, 1650, 1700, 1680, 1720, 1700, 1690, 1710, 1700, 1700];
    const path = (last: number) => (i: number) => (i < 10 ? placement[i]! : i < 29 ? 1700 : last);
    const drafts = only(await after(career(30, 15, path(1800)), { created: made(10) }), 'smurf');
    expect(drafts.map((d) => [d.evidence.stats['byRating'], d.evidence.stats['byWins'], d.evidence.stats['reachedAt'], d.evidence.stats['peak']])).toEqual([[1, 0, 30, 1800]]);
    expect(only(await after(career(30, 15, path(1799)), { created: made(10) }), 'smurf')).toEqual([]);
  });

  it('stays quiet on an honest 3-0 start in placement (hidden 1662, 1751, 1809) that settles at 1660, and on its shown games after', async () => {
    // the Glicko-2 path of a 1500/350 account beating three fresh 1500/350 accounts (rateOneVsOne), against other placement players
    const hidden = [1662, 1751, 1809, 1760, 1720, 1690, 1700, 1670, 1680, 1660];
    const shown = [1690, 1720, 1750, 1790, 1760];
    const results = [1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0];
    const path = [...hidden, ...shown];
    const rows = path.map((to, i) => {
      const mine = { from: i === 0 ? 1500 : path[i - 1]!, to, placement: i < 9 ? true : i === 9 ? ('ends' as const) : false };
      const opp = { account: acc(200 + i), placement: i < 10 };
      return results[i] === 1
        ? row(`s${i + 1}`, ago((14 - i) * 0.25), [{ account: NEW, place: 1, ...mine }, { ...opp, place: 2 }])
        : row(`s${i + 1}`, ago((14 - i) * 0.25), [{ ...opp, place: 1 }, { account: NEW, place: 2, ...mine }]);
    });
    for (const n of [3, 10, 15]) expect(only(await after(rows.slice(0, n), { created: made(4) }), 'smurf')).toEqual([]);
  });

  it('stays quiet on an account more than 30 days old, and on one with more than 30 games', async () => {
    expect(only(await after(career(15, 15, flat), { created: made(30.01) }), 'smurf')).toEqual([]);
    expect(only(await after(career(15, 15, flat), { created: made(30) }), 'smurf')).toHaveLength(1);
    const many = Array.from({ length: 31 }, (_, i) => row(`m${i + 1}`, ago((30 - i) * 0.25), [{ account: NEW, place: 1, from: 1600, to: 1600 }, { account: acc(300 + i), place: 2 }]));
    expect(only(await after(many, { created: made(10) }), 'smurf')).toEqual([]);
    expect(only(await after(many.slice(1), { created: made(10) }), 'smurf')).toHaveLength(1);
  });

  it('counts only the games of the ladder, and a draw is no win', async () => {
    const rows = career(15, 12, flat);
    rows[0] = { ...rows[0]!, ladder: '1v1-pioneer' };
    expect(only(await after(rows, { created: made(10) }), 'smurf')).toEqual([]);
    const draws = career(15, 12, flat);
    draws[0] = row('s1', ago(3.5), [{ account: NEW, place: 1, from: 1500, to: 1600, placement: true }, { account: acc(200), place: 1 }]);
    expect(only(await after(draws, { created: made(10) }), 'smurf')).toEqual([]);
  });
});

describe('M15-5: ratingTransfer', () => {
  /** A's shown games of the last 7 days: [opponent, change] each, A winning when the change is positive. */
  const games = (list: [AccountId, number][]) => {
    let r = 1600;
    return list.map(([o, change], i) => {
      const from = r;
      r += change;
      return change >= 0
        ? win(`r${i + 1}`, ago(6 - i), A, o, { w: [from, r] })
        : win(`r${i + 1}`, ago(6 - i), o, A, { l: [from, r] });
    });
  };

  it('fires on a gain of 150 within 7 days with at least half of it from one opponent, naming both', async () => {
    const drafts = only(await after(games([[B, 40], [C, 15], [B, 45], [D, 12], [B, 40]])), 'ratingTransfer');
    expect(drafts).toEqual([{
      kind: 'ratingTransfer', ladder: '1v1-standard', accounts: [A, B],
      evidence: { games: ['r1', 'r3', 'r5'], stats: { gain: 152, opponentGain: 125, games: 5, opponentGames: 3, 'gain.1': 40, 'gain.2': 45, 'gain.3': 40 } },
    }]);
  });

  it('stays quiet on a gain of 149', async () => {
    expect(only(await after(games([[B, 40], [C, 12], [B, 45], [D, 12], [B, 40]])), 'ratingTransfer')).toEqual([]);
  });

  it('stays quiet when no opponent gave half of the gain', async () => {
    expect(only(await after(games([[B, 40], [C, 50], [B, 30], [D, 40]])), 'ratingTransfer')).toEqual([]);
  });

  it('counts losses against the others: the net gain is what is judged', async () => {
    // +125 from B, then -30 against C: a gain of 95 in all
    expect(only(await after(games([[B, 40], [B, 45], [C, -30], [B, 40]])), 'ratingTransfer')).toEqual([]);
  });

  it('ignores placement games (a hidden, fast-moving rating)', async () => {
    const rows = [B, C, B, D, B].map((o, i) => win(`h${i + 1}`, ago(6 - i), A, o, { w: [1500 + 100 * i, 1600 + 100 * i], placement: 'winner' }));
    expect(only(await after(rows), 'ratingTransfer')).toEqual([]);
  });

  /** A's pods of the last 7 days: [seats in place order (A among them), A's change] each; places 1, 2, ... in that order. */
  const pods = (list: [AccountId[], number][]) => {
    let r = 1600;
    return list.map(([order, change], i) => {
      const from = r;
      r += change;
      const seats = order.map((o, p) => ({ account: o, place: (p + 1) as Place, ...(o === A ? { from, to: r } : {}) }));
      return row(`k${i + 1}`, ago(6 - i), seats, { ladder: 'pod-commander' });
    });
  };

  it('pods: never names an opponent who finished ahead of the account, nor several opponents for the same pods', async () => {
    // A gains 155 in 5 pods: 2nd behind X in three of them (Y and Z behind it), 1st among fresh opponents in two
    const X = acc(70);
    const Y = acc(71);
    const Z = acc(72);
    const rows = pods([
      [[X, A, Y, Z], 35], [[A, acc(80), acc(81), acc(82)], 25], [[X, A, Z, Y], 35], [[A, acc(83), acc(84), acc(85)], 25], [[X, A, Y, Z], 35],
    ]);
    expect(only(await after(rows), 'ratingTransfer')).toEqual([]);
    // each pod's gain is split between the opponents behind A: 17.5 each to Y and Z from each of the three (52.5 of 155), nothing to X
    const loose = createAbuseChecker({ ...RULES_11_1, ratingTransferOpponentShare: 0.3 });
    const drafts = only(await loose.afterGame(applied(rows[4]!), context(new FakeAbuseStore().add(...rows))), 'ratingTransfer');
    expect(drafts.map((d) => [d.accounts, d.evidence.games, d.evidence.stats])).toEqual([Y, Z].map((o) => [
      [A, o], ['k1', 'k3', 'k5'], { gain: 155, opponentGain: 52.5, games: 5, opponentGames: 3, 'gain.1': 17.5, 'gain.2': 17.5, 'gain.3': 17.5 },
    ]));
  });

  it('pods: names the opponent behind the account who gave it half of its gain', async () => {
    // three-player pods: A first, B and a fresh opponent behind, +40 each; half of each gain came from B: 80 of 160
    const three = pods([0, 1, 2, 3].map((i): [AccountId[], number] => [[A, i % 2 === 0 ? B : acc(90 + i), i % 2 === 0 ? acc(90 + i) : B], 40]));
    expect(only(await after(three), 'ratingTransfer')).toEqual([{
      kind: 'ratingTransfer', ladder: 'pod-commander', accounts: [A, B],
      evidence: { games: ['k1', 'k2', 'k3', 'k4'], stats: { gain: 160, opponentGain: 80, games: 4, opponentGames: 4, 'gain.1': 20, 'gain.2': 20, 'gain.3': 20, 'gain.4': 20 } },
    }]);
    // with a fourth seat behind A too, B's part is a third (53.33 of 160): exactly a third, so a share of 1/3 names it
    const four = pods([0, 1, 2, 3].map((i): [AccountId[], number] => [[A, B, acc(90 + i), acc(95 + i)], 40]));
    expect(only(await after(four), 'ratingTransfer')).toEqual([]);
    const third = createAbuseChecker({ ...RULES_11_1, ratingTransferOpponentShare: 1 / 3 });
    const drafts = only(await third.afterGame(applied(four[3]!), context(new FakeAbuseStore().add(...four))), 'ratingTransfer');
    expect(drafts.map((d) => [d.accounts, d.evidence.stats['opponentGain'], d.evidence.stats['gain.1']])).toEqual([[[A, B], 53.33, 13.33]]);
  });

  it('pods: a fall comes from the opponents ahead of the account', async () => {
    // three-player pods: A first ahead of B four times, +60 each (half of it from B: 120 of 240)
    const gains = [0, 1, 2, 3].map((i): [AccountId[], number] => [[A, B, acc(90 + i)], 60]);
    expect(only(await after(pods(gains)), 'ratingTransfer').map((d) => [d.accounts, d.evidence.stats['opponentGain']])).toEqual([[[A, B], 120]]);
    // then second behind B, -30, all of it from B: 90 of 210 (were it from the seat behind A, B would keep 120 of 210)
    const rows = pods([...gains, [[B, A, acc(94)], -30]]);
    expect(only(await after(rows), 'ratingTransfer')).toEqual([]);
    const loose = createAbuseChecker({ ...RULES_11_1, ratingTransferOpponentShare: 0.4 });
    const drafts = only(await loose.afterGame(applied(rows[4]!), context(new FakeAbuseStore().add(...rows))), 'ratingTransfer');
    expect(drafts.map((d) => [d.accounts, d.evidence.stats['gain'], d.evidence.stats['opponentGain'], d.evidence.stats['gain.5']])).toEqual([[[A, B], 210, 90, -30]]);
  });
});

describe('M15-5: sandbagging', () => {
  /**
   * A, established at 1700: a fall through losses to players near its rating, then a rise against much weaker players. `fall` and `rise` are
   * [change, loss code] lists; the fall's games end 12-9 days back, the rise's 8-4 days back.
   */
  const story = (fall: [number, LossCode | null][], rise: number[], o: { riseFrom?: number } = {}) => {
    const rows: HistoryRow[] = [];
    let r = 1700;
    fall.forEach(([change, loss], i) => {
      const from = r;
      r += change;
      const opp = acc(400 + i);
      rows.push(change < 0
        ? win(`f${i + 1}`, ago(12 - i), opp, A, { loss: loss ?? 'life', outTurn: 10, turns: 10, l: [from, r], w: [1710, 1720] })
        : win(`f${i + 1}`, ago(12 - i), A, opp, { w: [from, r], l: [1710, 1700] }));
    });
    rise.forEach((change, i) => {
      const from = r;
      r += change;
      rows.push(win(`u${i + 1}`, ago((o.riseFrom ?? 8) - i * 2), A, acc(500 + i), { w: [from, r], l: [1400, 1390] }));
    });
    return rows;
  };
  const fall: [number, LossCode | null][] = [[-40, 'concession'], [-40, 'life'], [-40, 'timeout'], [-40, 'life']];

  it('fires on a fall of 160 in 4 losses (half by concession or time-out, at turn 10) and a rise of 105 within the next 7 days', async () => {
    const drafts = only(await after(story(fall, [35, 35, 35])), 'sandbagging');
    expect(drafts).toEqual([{
      kind: 'sandbagging', ladder: '1v1-standard', accounts: [A],
      evidence: {
        games: ['f1', 'f2', 'f3', 'f4', 'u1', 'u2', 'u3'],
        stats: {
          fall: 160, rise: 105, fallGames: 4, riseGames: 3, losses: 4, quits: 2, ratingStart: 1700, ratingLow: 1540, ratingEnd: 1645,
          'loss.concession': 1, 'loss.life': 2, 'loss.timeout': 1, fallOpponents: 1710, riseOpponents: 1400,
          'rating.1': 1660, 'rating.2': 1620, 'rating.3': 1580, 'rating.4': 1540, 'rating.5': 1575, 'rating.6': 1610, 'rating.7': 1645,
        },
      },
    }]);
    // none of the other rules sees it: the concessions came late in the game, the gain is under 150 and spread over three opponents
    expect((await after(story(fall, [35, 35, 35]))).map((d) => d.kind)).toEqual(['sandbagging']);
  });

  it('stays quiet when only 1 of the 4 losses was a concession, leave or time-out', async () => {
    expect(only(await after(story([[-40, 'concession'], [-40, 'life'], [-40, 'life'], [-40, 'life']], [35, 35, 35])), 'sandbagging')).toEqual([]);
  });

  it('a disconnect is not a quit here', async () => {
    expect(only(await after(story([[-40, 'concession'], [-40, 'life'], [-40, 'disconnect'], [-40, 'life']], [35, 35, 35])), 'sandbagging')).toEqual([]);
  });

  it('stays quiet on a fall of 145, and on a rise of 99', async () => {
    expect(only(await after(story([[-40, 'concession'], [-40, 'life'], [-25, 'timeout'], [-40, 'life']], [35, 35, 35])), 'sandbagging')).toEqual([]);
    expect(only(await after(story(fall, [33, 33, 33])), 'sandbagging')).toEqual([]);
  });

  it('stays quiet when the rise comes more than 7 days after the fall', async () => {
    // the fall ends 9 days back; a rise of 105 in one game 1.9 days back is 7.1 days later
    expect(only(await after(story(fall, [105], { riseFrom: 1.9 })), 'sandbagging')).toEqual([]);
    expect(only(await after(story(fall, [105], { riseFrom: 2.1 })), 'sandbagging')).toHaveLength(1);
  });

  it('takes the fall from the losses: a win at its start is not part of it', async () => {
    const drafts = only(await after(story([[30, null], ...fall], [35, 35, 35])), 'sandbagging');
    expect(drafts.map((d) => [d.evidence.games[0], d.evidence.stats['fall'], d.evidence.stats['ratingStart']])).toEqual([['f2', 160, 1730]]);
  });
});
