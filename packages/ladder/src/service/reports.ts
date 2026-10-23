/**
 * M15-3: filing abuse reports into the outbox (design 11.2, D18, 8.7). The checks (M15-5, the `AbuseChecker` port) return drafts; this file gives
 * each its id, time, HMAC dedupe key and status 'pending'. Reports only: nothing here bans, mutes, resets or changes a rating, a queue or a
 * leaderboard.
 */
import { createHmac } from 'node:crypto';
import type { AbuseDraft, AbuseReport } from '../abuse/types';
import { newReportId, type RandomBytes } from '../ids';
import { sortAccounts } from '../store/memory';

/** The dedupe window (11.2): one report per kind, ladder and set of accounts per 7 days. */
export const REPORT_WINDOW_MS = 7 * 86_400_000;

/**
 * base64url(HMAC-SHA256(secret, kind | ladder | sorted accounts | the 7-day window it falls in)) (11.2). The window is the number of whole 7-day
 * periods since the epoch at `nowMs`. An HMAC, so a sent report's leftover key holds no account id (8.7).
 */
export function reportDedupeKey(key: Buffer, d: Pick<AbuseDraft, 'kind' | 'ladder' | 'accounts'>, nowMs: number): string {
  const accounts = sortAccounts(d.accounts).map((a) => a ?? '');
  const message = [d.kind, d.ladder ?? '', accounts.join(','), String(Math.floor(nowMs / REPORT_WINDOW_MS))].join('|');
  return createHmac('sha256', key).update(message, 'utf8').digest('base64url');
}

/** The outbox row of a draft (11.2): a fresh ULID, the time, the HMAC dedupe key, the accounts sorted, status 'pending'. */
export function reportOf(key: Buffer, d: AbuseDraft, nowMs: number, random?: RandomBytes): AbuseReport {
  return {
    id: newReportId(nowMs, random),
    kind: d.kind,
    ladder: d.ladder,
    accounts: sortAccounts(d.accounts),
    evidence: { games: [...d.evidence.games], stats: { ...d.evidence.stats } },
    createdAt: new Date(nowMs).toISOString(),
    dedupeKey: reportDedupeKey(key, d, nowMs),
    status: 'pending',
  };
}
