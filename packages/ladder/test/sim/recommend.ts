/**
 * M15-6: what the simulation recommends (docs/perf/m15-ladder-sim.md), in one place for the slow suite and scripts/simulate.ts. The slow suite
 * checks that these values meet the bounds and targets the defaults miss. The abuse thresholds were adopted as ABUSE_RULES (src/abuse/rules.ts,
 * 2026-10-22: design 11.1 has M15-6 tune them); BADGE_CAREER_GAMES stays the owner's default (design 19.7) until the owner decides.
 */
import type { AbuseRules } from '../../src/abuse/types';

/**
 * The abuse thresholds as design 11.1 wrote them, before M15-6's tuning: the write-up's "defaults" rows, the honest-play baseline the candidates
 * are compared with, and the thresholds M15-5's tests pin each rule's mechanics at.
 */
export const DESIGN_ABUSE_RULES: Readonly<AbuseRules> = Object.freeze({
  repeatedPairingPods: 6,
  oneSidedGames: 5, oneSidedWinShare: 0.8, oneSidedQuickShare: 0.5,
  smurfMinGames: 15, smurfWinShare: 0.8, smurfRating: 1800,
  ratingTransferGain: 150, ratingTransferOpponentShare: 0.5,
  sandbaggingFall: 150, sandbaggingQuitShare: 0.5,
});

/**
 * Candidate thresholds for the abuse heuristics (11.1), tried by the report against honest play and against injected abusers. The kinds share no
 * threshold, so each kind's count under a set depends only on that kind's values in it.
 */
export const CANDIDATE_ABUSE_RULES: Readonly<Record<string, Readonly<AbuseRules>>> = Object.freeze({
  mild: Object.freeze({
    smurfRating: 1900, smurfWinShare: 0.85, sandbaggingQuitShare: 0.75, ratingTransferGain: 200, oneSidedGames: 6, oneSidedQuickShare: 0.75,
  }),
  medium: Object.freeze({
    smurfRating: 1950, smurfWinShare: 0.9, smurfMinGames: 20, sandbaggingQuitShare: 0.9, ratingTransferGain: 200, ratingTransferOpponentShare: 0.75,
    oneSidedGames: 6, oneSidedQuickShare: 0.75,
  }),
  strong: Object.freeze({
    smurfRating: 2000, smurfWinShare: 0.9, smurfMinGames: 20, sandbaggingFall: 200, sandbaggingQuitShare: 0.9, ratingTransferGain: 250,
    ratingTransferOpponentShare: 0.75, oneSidedGames: 8, oneSidedWinShare: 0.875, oneSidedQuickShare: 0.75,
  }),
});

export const RECOMMENDED = Object.freeze({
  /**
   * BADGE_CAREER_GAMES: 30 → 55, the smallest tried that meets S1 (c) and S2 (b) against the opponents the matcher gave in the 2,000-account
   * population (40 does in a 1,000-account one); the defaults meet them only against the design's matched opponents.
   */
  badgeCareerGames: 55,
  /**
   * The thresholds that meet 17.11's honest-play target in both models (adopted as ABUSE_RULES): `strong` with `medium`'s rating-transfer gain (200), and pods'
   * repeated pairing at 8 pods in 7 days (6 reports honest regulars of a pod ladder of a few hundred). Each kind's count is that of the set it
   * comes from, since the kinds share no threshold. medium's smurf thresholds report about 1.4% of active honest newcomers (the smurf section),
   * strong's about 0.6%.
   */
  abuseRules: Object.freeze({ ...CANDIDATE_ABUSE_RULES['strong']!, ratingTransferGain: 200, repeatedPairingPods: 8 }) as Readonly<AbuseRules>,
});
