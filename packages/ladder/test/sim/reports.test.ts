/**
 * M15-6 (slow suite): M15-5's abuse heuristics over honest simulated play (17.11: "honest simulated play files no oneSided or sandbagging report
 * and fewer than 1 in 1,000 accounts get any report"). With design 11.1's thresholds honest play files reports of several kinds (the
 * small busy ladder of test/sim/service.test.ts files them through the real service; docs/perf/m15-ladder-sim.md counts them at scale). With the
 * recommended thresholds (test/sim/recommend.ts, adopted as ABUSE_RULES) the stationary period of a small 1v1 ladder (500 accounts) and of a small pod ladder (450) files
 * none: small ladders are the hard case for the pair rules, since the same players meet often. The checker is the real one, run inline as the
 * service runs it. The write-up has the larger runs, the smurf rule's rate over newcomers and abusers' detection (scripts/simulate.ts).
 */
import { expect, it } from 'vitest';
import { describeSlow } from '../../../engine/test/slow';
import { honestReportsWith, meetsHonestTarget } from './measure';
import type { SimLadder } from './params';
import { RECOMMENDED } from './recommend';

describeSlow('M15-6: abuse reports over honest play, with the recommended thresholds', () => {
  for (const ladder of ['1v1-standard', 'pod-commander'] as SimLadder[]) {
    it(`${ladder}: no report at all from the stationary period on, in a small ladder`, async () => {
      const { summary, games } = await honestReportsWith(ladder, RECOMMENDED.abuseRules, {
        players: ladder === '1v1-standard' ? 500 : 450, days: 120, seed: 'reports-test',
      });
      expect(games).toBeGreaterThan(ladder === '1v1-standard' ? 30_000 : 15_000);
      expect(summary.latePlayed).toBeGreaterThan(500);
      for (const k of summary.kinds) expect(k.lateReports, k.kind).toBe(0);
      expect(summary.lateAccounts).toBe(0);
      expect(meetsHonestTarget(summary)).toBe(true);
    }, 900_000);
  }
});
