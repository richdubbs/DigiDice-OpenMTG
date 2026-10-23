/**
 * The abuse heuristics' contract (design 11, 13.4, D18). Server only. M15-5 builds the checks (`createAbuseChecker`, src/abuse/index.ts, and the
 * thresholds `ABUSE_RULES` in src/abuse/rules.ts); the service (M15-3) calls them through the `AbuseChecker` port and files what they return. Reports
 * only: nothing here bans, mutes, resets or changes a rating, a queue or a leaderboard.
 */
import type { AccountDirectory, AccountId, ReportReason } from '../accounts';
import type { LadderId, SeasonId } from '../api';
import type { AppliedGame, LadderStore } from '../store/api';

export type AbuseKind =
  | 'repeatedPairing' | 'oneSided' | 'earlyConcessions' | 'smurf' | 'ratingTransfer' | 'sandbagging' | 'parkedHigh' | 'capStall' | 'dodging';

/** One report of the ladder's outbox (11.2). */
export interface AbuseReport {
  /** ULID. */
  id: string;
  kind: AbuseKind;
  ladder: LadderId | null;
  /** Sorted; null after a deletion. */
  accounts: (AccountId | null)[];
  evidence: { games: string[]; stats: Record<string, number> };
  createdAt: string;
  /**
   * base64url(HMAC-SHA256(LadderConfig.secret, kind | ladder | sorted accounts | the 7-day window it falls in)): one report per key. An HMAC, so a
   * sent report's leftover key holds no account id (8.7).
   */
  dedupeKey: string;
  /** The outbox state: 'pending' until the moderation sink accepted it, then 'sent' (and stripped to its key, kind and time). */
  status: 'pending' | 'sent';
}

/** What a check returns; the service adds id, createdAt, the HMAC dedupeKey and status 'pending'. */
export type AbuseDraft = Pick<AbuseReport, 'kind' | 'ladder' | 'accounts' | 'evidence'>;
/** The thresholds of 11.1; values in src/abuse/rules.ts (M15-5). */
export interface AbuseRules { readonly [rule: string]: number }
export interface AbuseContext {
  store: Pick<LadderStore, 'pairGames' | 'history' | 'gamesSince' | 'capEvents' | 'penalties' | 'seasonRecord' | 'seasonRecordsOf'>;
  accounts: Pick<AccountDirectory, 'standings'>;
  now: string;
}
/** The heuristics of 11.1 (M15-5 builds them; the service calls them, so M15-3 tests with a fake). */
export interface AbuseChecker {
  /** After each applied game, for its accounts. */
  afterGame(g: AppliedGame, ctx: AbuseContext): Promise<AbuseDraft[]>;
  /** After a missed ready check (dodging). */
  afterMiss(account: AccountId, misses: readonly string[], ctx: AbuseContext): Promise<AbuseDraft[]>;
  /** Once per UTC day: the 30-day rules over gamesSince, and parkedHigh over seasons closed since the last run. */
  daily(closedSeasons: readonly { ladder: LadderId; season: SeasonId }[], ctx: AbuseContext): Promise<AbuseDraft[]>;
}

/** Files nothing: the service's default until M15-5 lands. */
export const NO_ABUSE_CHECKS: AbuseChecker = Object.freeze({
  afterGame: async () => [],
  afterMiss: async () => [],
  daily: async () => [],
});

/** Where reports go (11.2): at sync, hosted's adapter over milestone 14's AccountService.report as a `system` reporter (m14 2.4). */
export interface ModerationSink { submit(r: AbuseReport): Promise<void> }

/** 11.2's mapping to milestone 14's report reasons (ReportReason: a type of @openmtg/accounts/api, through src/accounts.ts); m14 2.4 gives the call. */
export const ABUSE_REPORT_REASON: Readonly<Record<AbuseKind, ReportReason>> = Object.freeze({
  repeatedPairing: 'collusion', oneSided: 'collusion', earlyConcessions: 'collusion', ratingTransfer: 'collusion',
  smurf: 'smurf', sandbagging: 'smurf', capStall: 'stalling', dodging: 'other', parkedHigh: 'other',
});
