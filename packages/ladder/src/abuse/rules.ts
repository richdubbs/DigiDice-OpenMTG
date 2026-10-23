/**
 * M15-5: the thresholds of the abuse heuristics (design 11.1, D18), one constant, `ABUSE_RULES`, so M15-6's simulation can sweep them and the owner
 * can change them in one place. Server only. Every rule stays report-only: a threshold decides whether a report is filed, never an action.
 *
 * Units are in each name: `...Days` and `...Hours` are window lengths (a window ends at the check's time and includes both ends), `...Share` a
 * fraction of a count (inclusive: 0.8 means "at least 80%"), `...BeforeTurn` a turn a seat must have gone out before (strictly), the rest counts
 * or shown rating points (the one scale of both models, 5.2).
 */
import type { AbuseRules } from './types';

export type AbuseRuleName =
  | 'repeatedPairingDays' | 'repeatedPairingGames' | 'repeatedPairingPods'
  | 'oneSidedDays' | 'oneSidedGames' | 'oneSidedWinShare' | 'oneSidedQuickShare' | 'oneSidedBeforeTurn'
  | 'earlyConcessionsDays' | 'earlyConcessionsLosses' | 'earlyConcessionsBeforeTurn'
  | 'smurfAccountDays' | 'smurfMaxGames' | 'smurfMinGames' | 'smurfWinShare' | 'smurfRating'
  | 'ratingTransferDays' | 'ratingTransferGain' | 'ratingTransferOpponentShare'
  | 'sandbaggingFallDays' | 'sandbaggingFall' | 'sandbaggingQuitShare' | 'sandbaggingRiseDays' | 'sandbaggingRise'
  | 'parkedHighTopRank' | 'parkedHighBadgeTier' | 'parkedHighIdleDays' | 'parkedHighAboveMedian'
  | 'capStallDays' | 'capStallGames'
  | 'dodgingHours' | 'dodgingMisses';

/** Every threshold, resolved: what the checks read. */
export type ResolvedAbuseRules = Readonly<Record<AbuseRuleName, number>>;

/**
 * The thresholds of 11.1, as M15-6's simulation tuned them so that honest simulated play files almost none (docs/perf/m15-ladder-sim.md: from
 * 2027-03 on, 0 of 1,956 honest 1v1 accounts and 1 of 1,306 pod accounts reported, and no oneSided or sandbagging report; the defaults of 11.1
 * reported 3.7% and 3.9%). Changed from 11.1: repeatedPairingPods 6 -> 8; oneSidedGames 5 -> 8, oneSidedWinShare 0.8 -> 0.875,
 * oneSidedQuickShare 0.5 -> 0.75; smurfMinGames 15 -> 20, smurfWinShare 0.8 -> 0.9, smurfRating 1800 -> 2000; ratingTransferGain 150 -> 200,
 * ratingTransferOpponentShare 0.5 -> 0.75; sandbaggingFall 150 -> 200, sandbaggingQuitShare 0.5 -> 0.9. The owner may set any back.
 */
export const ABUSE_RULES: ResolvedAbuseRules = Object.freeze({
  // repeatedPairing: the same two accounts met in at least 5 rated games of a ladder within 7 days (pods: the same pair in at least 8 pods).
  repeatedPairingDays: 7,
  repeatedPairingGames: 5,
  repeatedPairingPods: 8,
  // oneSided (win-trading): at least 8 meetings within 30 days, one account won at least 87.5% of them (in a pod, finishing ahead of the other is
  // no win), and at least three in four of them ended by a concession, leave, time-out or disconnect (the exit that ended the game), or before turn 4.
  oneSidedDays: 30,
  oneSidedGames: 8,
  oneSidedWinShare: 0.875,
  oneSidedQuickShare: 0.75,
  oneSidedBeforeTurn: 4,
  // earlyConcessions: at least 5 rated games lost by concession or leave before turn 3 within 7 days.
  earlyConcessionsDays: 7,
  earlyConcessionsLosses: 5,
  earlyConcessionsBeforeTurn: 3,
  // smurf: an account at most 30 days old with at most 30 rated games in a ladder that won at least 90% of at least 20 of them, or reached a shown
  // rating of 2000 within them (shown: after placement; a hidden placement rating never counts).
  smurfAccountDays: 30,
  smurfMaxGames: 30,
  smurfMinGames: 20,
  smurfWinShare: 0.9,
  smurfRating: 2000,
  // ratingTransfer: a gain of at least 200 shown points within 7 days, at least three quarters of it from the games against one opponent.
  ratingTransferDays: 7,
  ratingTransferGain: 200,
  ratingTransferOpponentShare: 0.75,
  // sandbagging: a fall of at least 200 shown points within 7 days through losses, at least 90% of those losses by concession, leave or time-out
  // (at any turn), then a rise of at least 100 within the next 7 days.
  sandbaggingFallDays: 7,
  sandbaggingFall: 200,
  sandbaggingQuitShare: 0.9,
  sandbaggingRiseDays: 7,
  sandbaggingRise: 100,
  // parkedHigh, at a season's close: a final rank in the top 100, or a badge of Laser (TIER_IDS index 4) or better; the last rated game of the
  // season at least 14 days before its end; the rating after it at least 150 above the season's median.
  parkedHighTopRank: 100,
  parkedHighBadgeTier: 4,
  parkedHighIdleDays: 14,
  parkedHighAboveMedian: 150,
  // capStall: in at least 2 ranked games that reached a per-game cap within 30 days, as the driver or in a void without one (8.5).
  capStallDays: 30,
  capStallGames: 2,
  // dodging: at least 6 missed ranked ready checks within 24 hours (8.6).
  dodgingHours: 24,
  dodgingMisses: 6,
});

const NAMES = new Set(Object.keys(ABUSE_RULES));

/**
 * ABUSE_RULES with `overrides` laid over it (M15-6 sweeps a few thresholds at a time). Throws a RangeError on a name that is not a rule (a typo
 * would otherwise leave the rule at its default unseen) and on a value that is not a finite number of at least 0. A new frozen object.
 */
export function resolveAbuseRules(overrides?: Readonly<AbuseRules>): ResolvedAbuseRules {
  const out: Record<string, number> = { ...ABUSE_RULES };
  for (const [name, value] of Object.entries(overrides ?? {})) {
    if (!NAMES.has(name)) throw new RangeError(`abuse: ${name} is not an abuse rule (ABUSE_RULES)`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`abuse: rule ${name} must be a finite number of at least 0 (${String(value)})`);
    }
    out[name] = value;
  }
  return Object.freeze(out) as ResolvedAbuseRules;
}
