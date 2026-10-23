/**
 * M15-5: the thresholds (design 11.1, `ABUSE_RULES` in src/abuse/rules.ts) pinned to the numbers M15-6 tuned them to, their overrides (M15-6 sweeps them), and
 * the reason mapping of 11.2 for every kind (17.8).
 */
import { describe, expect, it } from 'vitest';
import { ABUSE_REPORT_REASON, ABUSE_RULES, createAbuseChecker, resolveAbuseRules, TIER_IDS, type AbuseKind } from '@openmtg/ladder';
import { A, acc, ago, applied, context, FakeAbuseStore, NOW, win } from './fixtures';

describe('M15-5: ABUSE_RULES (11.1)', () => {
  it('holds the thresholds of 11.1 as M15-6 tuned them, frozen', () => {
    expect(ABUSE_RULES).toEqual({
      repeatedPairingDays: 7, repeatedPairingGames: 5, repeatedPairingPods: 8,
      oneSidedDays: 30, oneSidedGames: 8, oneSidedWinShare: 0.875, oneSidedQuickShare: 0.75, oneSidedBeforeTurn: 4,
      earlyConcessionsDays: 7, earlyConcessionsLosses: 5, earlyConcessionsBeforeTurn: 3,
      smurfAccountDays: 30, smurfMaxGames: 30, smurfMinGames: 20, smurfWinShare: 0.9, smurfRating: 2000,
      ratingTransferDays: 7, ratingTransferGain: 200, ratingTransferOpponentShare: 0.75,
      sandbaggingFallDays: 7, sandbaggingFall: 200, sandbaggingQuitShare: 0.9, sandbaggingRiseDays: 7, sandbaggingRise: 100,
      parkedHighTopRank: 100, parkedHighBadgeTier: 4, parkedHighIdleDays: 14, parkedHighAboveMedian: 150,
      capStallDays: 30, capStallGames: 2,
      dodgingHours: 24, dodgingMisses: 6,
    });
    expect(Object.isFrozen(ABUSE_RULES)).toBe(true);
    expect(TIER_IDS[ABUSE_RULES.parkedHighBadgeTier]).toBe('laser');
  });

  it('resolveAbuseRules lays overrides over the defaults and refuses unknown names and bad values', () => {
    const r = resolveAbuseRules({ smurfRating: 1700, dodgingMisses: 4 });
    expect(r).toEqual({ ...ABUSE_RULES, smurfRating: 1700, dodgingMisses: 4 });
    expect(Object.isFrozen(r)).toBe(true);
    expect(resolveAbuseRules()).toEqual(ABUSE_RULES);
    expect(resolveAbuseRules()).not.toBe(ABUSE_RULES);
    expect(() => resolveAbuseRules({ smurfRatng: 1700 })).toThrow(RangeError);
    expect(() => resolveAbuseRules({ smurfRating: -1 })).toThrow(RangeError);
    expect(() => resolveAbuseRules({ smurfRating: Number.NaN })).toThrow(RangeError);
    expect(() => resolveAbuseRules({ smurfRating: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => createAbuseChecker({ nope: 1 })).toThrow(RangeError);
  });

  it('an override changes what a checker drafts (dodging at 4 misses instead of 6)', async () => {
    const store = new FakeAbuseStore();
    const misses = [ago(0.5), ago(0.4), ago(0.3), ago(0.2)];
    expect(await createAbuseChecker().afterMiss(A, misses, context(store))).toEqual([]);
    const drafts = await createAbuseChecker({ dodgingMisses: 4 }).afterMiss(A, misses, context(store));
    expect(drafts.map((d) => d.kind)).toEqual(['dodging']);
  });

  it('a checker is frozen and keeps no state: the same store and time give the same drafts', async () => {
    const checker = createAbuseChecker();
    expect(Object.isFrozen(checker)).toBe(true);
    const store = new FakeAbuseStore();
    for (let i = 0; i < 5; i++) store.add(win(`g${i}`, ago(i), A, acc(9), { loss: 'concession', outTurn: 2 }));
    const g = applied(store.rows[0]!);
    const first = await checker.afterGame(g, context(store, { now: NOW }));
    const again = await checker.afterGame(g, context(store, { now: NOW }));
    expect(first.length).toBeGreaterThan(0);
    expect(again).toEqual(first);
  });
});

describe('M15-5: the reason mapping (11.2)', () => {
  it('maps every kind as 11.2 gives it', () => {
    const KINDS: Record<AbuseKind, string> = {
      repeatedPairing: 'collusion', oneSided: 'collusion', earlyConcessions: 'collusion', ratingTransfer: 'collusion',
      smurf: 'smurf', sandbagging: 'smurf', capStall: 'stalling', dodging: 'other', parkedHigh: 'other',
    };
    expect(ABUSE_REPORT_REASON).toEqual(KINDS);
  });
});
