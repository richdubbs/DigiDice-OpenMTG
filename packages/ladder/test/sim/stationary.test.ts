/**
 * M15-6 (slow suite): a population of 1,000 synthetic players per ladder from a cold start through eight monthly seasons (resets on, the real
 * matcher on a fake clock; test/sim/measure.ts `stationary`), against 17.11's targets:
 *  - the median error of the rating after 30 games is under 60 points (1v1) and after 30 pods under 80 shown points, for accounts that joined the
 *    established ladder;
 *  - tier shares by games a month and the cold start's first leaderboard rows are measured (reported in docs/perf/m15-ladder-sim.md);
 *  - the gaming scenarios S1-S3 against the opponents this population's matcher gave (test/sim/solo.ts metOpponents): in pods every bound holds;
 *    in 1v1 the two badge bounds do not hold with the design's 30 career games and do with BADGE_CAREER_GAMES, test/sim/recommend.ts's 55 (owner
 *    decision 2026-10-22). Both are pinned as measured, so a change to the badge rule meets this test and the write-up together (design 19).
 */
import { expect, it } from 'vitest';
import { BADGE_CAREER_GAMES, TIER_IDS } from '../../src/api';
import { describeSlow } from '../../../engine/test/slow';
import { metPool, SCENARIO_SIZES, stationary, TARGETS, type StationaryResult } from './measure';
import { DEFAULT_SIM_PARAMS as P, floorsOf, simParams, type SimLadder } from './params';
import { RECOMMENDED } from './recommend';
import { honestMedianStanding, scenarioS1, scenarioS2, scenarioS3 } from './scenarios';

describeSlow('M15-6: the stationary population (1,000 players, eight seasons, monthly resets on)', () => {
  for (const ladder of ['1v1-standard', 'pod-commander'] as SimLadder[]) {
    const model = ladder === '1v1-standard' ? 'glicko2' : 'wenglin';
    let s: StationaryResult;

    it(`${ladder}: the run`, async () => {
      s = await stationary(ladder, { players: 1000, seed: 'stationary' });
      expect(s.games).toBeGreaterThan(ladder === '1v1-standard' ? 100_000 : 50_000);
      expect(s.drift.map((d) => d.season)).toEqual(['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08']);
    }, 600_000);

    it(`${ladder}: the rating error after 30 ${ladder === '1v1-standard' ? 'games' : 'pods'} is under ${TARGETS.error30[model]} points`, () => {
      const e30 = s.errors.find((e) => e.k === 30)!;
      expect(e30.late.n).toBeGreaterThan(250);
      expect(e30.late.median).toBeLessThan(TARGETS.error30[model]);
      // the error falls with games, and the launch cohort (opponents new too) is no better than later accounts
      const e10 = s.errors.find((e) => e.k === 10)!;
      const e100 = s.errors.find((e) => e.k === 100)!;
      expect(e10.late.median).toBeGreaterThan(e30.late.median);
      expect(e30.late.median).toBeGreaterThan(e100.late.median);
      expect(e30.cold.median).toBeGreaterThanOrEqual(e30.late.median - 5);
      // no bias: the mean signed error is small
      expect(Math.abs(e30.late.meanSigned)).toBeLessThan(15);
    });

    it(`${ladder}: tier shares by games a month, and the drift of the mean`, () => {
      for (const t of s.tiers) {
        expect(t.n).toBeGreaterThan(500);
        expect(t.tiers.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        expect(t.badges.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        // every tier is used, none holds most players
        for (const x of t.tiers) {
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThan(0.5);
        }
      }
      // a 5-game month rarely earns a badge (5 post-placement games and 30 career games); a 100-game month nearly always does
      expect(s.tiers.find((t) => t.gpm === 5)!.badges[TIER_IDS.length]).toBeGreaterThan(0.6);
      expect(s.tiers.find((t) => t.gpm === 100)!.badges[TIER_IDS.length]).toBeLessThan(0.1);
      // the season pull holds the mean near 1500 (risk 5)
      for (const d of s.drift) expect(Math.abs(d.meanDisplay - 1500)).toBeLessThan(25);
    });

    it(`${ladder}: the cold start's first leaderboard rows`, () => {
      expect(s.board.fillHours[0]).not.toBeNull();
      expect(s.board.fillHours[0]!).toBeLessThan(72);
      expect(s.board.fillHours[3]).not.toBeNull();
      // placement (10 games) and the provisional limit come first: about a game (1v1) or a few pods after placement
      expect(s.board.firstGames.median).toBeGreaterThanOrEqual(10);
      expect(s.board.firstGames.median).toBeLessThan(ladder === '1v1-standard' ? 16 : 22);
    });

    it(`${ladder}: S1 and S2 against the opponents its matcher gave`, () => {
      const pool = metPool(s);
      const sizes = SCENARIO_SIZES.sweep[model];
      const floors = floorsOf(P, ladder);
      // the yardstick from the same opponents (honest true-1675 players at 30 games a month); the population's own honest players agree with it
      const baseline = honestMedianStanding(model, P, floors, sizes.honest, 'met/honest-1675', pool);
      expect(Math.abs(baseline - s.baseline.median)).toBeLessThan(40);
      const run = (badgeCareerGames: number) => {
        const p = simParams({ badgeCareerGames });
        const s1 = scenarioS1(model, p, floors, baseline, sizes.s1, 'met/s1', 200, pool);
        const best5 = scenarioS2(model, p, floors, baseline, [5], sizes.s2Groups, 'met/s2', pool)[0]!;
        return { s1, best5 };
      };
      const at = run(BADGE_CAREER_GAMES);
      expect(at.s1.rankAtClose).toBeLessThanOrEqual(TARGETS.s1Rank);
      expect(at.s1.standingStop).toBeLessThanOrEqual(TARGETS.s1Standing);
      expect(at.best5.leaderboard).toBeLessThanOrEqual(TARGETS.s2Best5Leaderboard);
      expect(BADGE_CAREER_GAMES).toBe(RECOMMENDED.badgeCareerGames);
      expect(at.s1.badgeStop).toBeLessThanOrEqual(TARGETS.s1Badge);
      expect(at.best5.badge).toBeLessThanOrEqual(TARGETS.s2Best5Badge);
      if (model === 'glicko2') {
        // measured: at the design's 30 the badge bounds do not hold against these opponents (docs/perf/m15-ladder-sim.md)
        const design = run(30);
        expect(design.s1.badgeStop).toBeGreaterThan(TARGETS.s1Badge);
        expect(design.best5.badge).toBeGreaterThan(TARGETS.s2Best5Badge);
      }
    }, 600_000);

    it(`${ladder}: S3 against the opponents its matcher gave`, () => {
      const s3 = scenarioS3(model, P, floorsOf(P, ladder), SCENARIO_SIZES.sweep[model].s3, 'met/s3', metPool(s));
      expect(s3.exact).toBeLessThanOrEqual(TARGETS.s3Circuit);
    }, 300_000);
  }
});
