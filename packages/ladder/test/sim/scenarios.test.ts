/**
 * M15-6 (slow suite): the gaming scenarios S1-S3 of design section 7 and the season shortfall of 17.11, in both models, at the owner's defaults, on
 * the design's own check model (opponents rated at their true skill and matched at the player's rating; test/sim/solo.ts matchedOpponents). Every
 * bound holds. test/sim/stationary.test.ts runs the same scenarios against the opponents a simulated population's matcher gives.
 * docs/perf/m15-ladder-sim.md has the numbers at the report's sizes (scripts/simulate.ts). Each scenario is its own test, so no test computes for
 * long without a turn of the event loop.
 */
import { expect, it } from 'vitest';
import { describeSlow } from '../../../engine/test/slow';
import { SCENARIO_SIZES, TARGETS } from './measure';
import { DEFAULT_SIM_PARAMS as P, floorsOf } from './params';
import { honestMedianStanding, movement, scenarioS1, scenarioS2, scenarioS3, shortfallTable } from './scenarios';

describeSlow('M15-6: the gaming scenarios and the shortfall at the defaults (matched opponents)', () => {
  for (const model of ['glicko2', 'wenglin'] as const) {
    const sizes = SCENARIO_SIZES.test[model];
    const floors = floorsOf(P, model === 'glicko2' ? '1v1-standard' : 'pod-commander');
    let baseline = Number.NaN;

    it(`${model}: the yardstick, the median final standing of honest true-1675 players at 30 games a month`, () => {
      baseline = honestMedianStanding(model, P, floors, sizes.honest, 'scenarios/honest-1675');
      // a settled active rating less twice its deviation at the season's end (about 75-80): about 1520
      expect(baseline).toBeGreaterThan(1490);
      expect(baseline).toBeLessThan(1560);
    });

    it(`${model}: S1, a lucky true-1500 account that stops (≤ 2%, ≤ 6%, ≤ 1%)`, () => {
      const s1 = scenarioS1(model, P, floors, baseline, sizes.s1, 'scenarios/s1');
      expect(s1.rankAtClose).toBeLessThanOrEqual(TARGETS.s1Rank);
      expect(s1.standingStop).toBeLessThanOrEqual(TARGETS.s1Standing);
      expect(s1.badgeStop).toBeLessThanOrEqual(TARGETS.s1Badge);
      // the design's check (section 7, 1v1): 7-8% of such accounts meet the stopping condition within 200 games
      if (model === 'glicko2') {
        expect(s1.stops).toBeGreaterThan(0.06);
        expect(s1.stops).toBeLessThan(0.09);
      }
    }, 300_000);

    it(`${model}: S2, the best of 5 new true-1500 accounts (≤ 6%, ≤ 5%)`, () => {
      const rows = scenarioS2(model, P, floors, baseline, [3, 5, 10], sizes.s2Groups, 'scenarios/s2');
      const best5 = rows.find((r) => r.k === 5)!;
      expect(best5.leaderboard).toBeLessThanOrEqual(TARGETS.s2Best5Leaderboard);
      expect(best5.badge).toBeLessThanOrEqual(TARGETS.s2Best5Badge);
      // more accounts, more luck
      expect(rows[2]!.badge).toBeGreaterThanOrEqual(rows[0]!.badge);
    }, 300_000);

    it(`${model}: S3, a true-1250 player after the reset plays exactly 5 games (≤ 15%), and the season shortfall`, () => {
      const s3 = scenarioS3(model, P, floors, sizes.s3, 'scenarios/s3');
      expect(s3.exact).toBeLessThanOrEqual(TARGETS.s3Circuit);
      // the bound's scenario starts at exactly 1250; a true-1250 player whose rating moved with its games gets a Circuit badge more often, and
      // nearly as often when it plays its whole month: rating noise more than the reset (docs/perf/m15-ladder-sim.md)
      expect(s3.stationary).toBeGreaterThan(s3.exact);
      const shortfall = shortfallTable(model, P, floors, [5, 10, 30, 100], sizes.shortfall, 1800, 'scenarios/shortfall');
      expect(shortfall.find((r) => r.gpm === 10)!.shortfall).toBeLessThan(TARGETS.shortfall10);
      // the more games a month, the smaller the shortfall (section 7's table)
      expect(shortfall[0]!.shortfall).toBeGreaterThan(shortfall[3]!.shortfall);
    }, 300_000);
  }

  it('glicko2: an active player\'s rating moves as 4.3 says (resting deviation about 61 with several games a day, ±10.5 between equals)', () => {
    const busy = movement('glicko2', P, 300, 'movement', 100);
    expect(busy.restAfterGame).toBeGreaterThan(55);
    expect(busy.restAfterGame).toBeLessThan(66);
    expect(Math.abs(busy.win)).toBeGreaterThanOrEqual(9);
    expect(Math.abs(busy.win)).toBeLessThanOrEqual(12);
    // at one game a day the daily growth (idleVolPerDay) adds as much as the per-game σ0 does: a resting deviation near 77
    const daily = movement('glicko2', P, 30, 'movement', 100);
    expect(daily.restAfterGame).toBeGreaterThan(70);
    expect(daily.restAfterGame).toBeLessThan(85);
  });
});
