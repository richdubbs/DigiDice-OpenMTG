/**
 * M14-7: retention (design 10.3): inactive accounts, and the purge.
 *
 * - **Inactive accounts** (adopted default 15): an account nobody signed in to for `retention.inactiveAccountMs` (3 years; never signed in: since
 *   it was made) is deleted as if it had asked: a deletion with the 7-day grace (10.2), so its owner can still sign in and cancel. One with a
 *   verified email first gets the 'inactive' notice INACTIVE_NOTICE_LEAD_MS (30 days) before, sent once (`inactiveNoticeAt`, which a sign-in clears),
 *   and its deletion waits until 30 days after that notice, even if the notice went out late. Each step re-checks the row in its patch, so a sign-in
 *   that lands meanwhile wins.
 * - **The purge**: AccountStore.purge with the configured retention (sessions, device proofs, email codes, holds, closed reports, audit events by
 *   category, the change feed, tombstones), once a day from tick and on the operator's `purge`; the operator's export files older than a day are
 *   deleted at every tick (and by `purge`).
 */
import type { AccountPurgeReport } from '../store/api';
import { DAY, errorName, iso, type Cursors, type Rights } from './context';
import { notify, requestDeletion } from './deletion';
import { sweepAdminExports } from './files';

/** How long before the deletion an inactive account with a verified email is told (10.3). */
export const INACTIVE_NOTICE_LEAD_MS = 30 * DAY;
/** Inactive accounts looked at per tick (oldest first, paged on from tick to tick). */
export const INACTIVE_BATCH = 200;

/** How long the operator's export files are kept: retention.adminExportMs and ACCOUNT_TIMING.adminExportFileMs both name it; the shorter wins. */
export function adminExportMs(r: Rights): number {
  return Math.min(r.config.retention.adminExportMs, r.config.timing.adminExportFileMs);
}

/**
 * The inactive accounts' notices and deletions due at `now`, for a page of at most INACTIVE_BATCH after `cursors.inactive`; answers the notices sent.
 * The next tick goes on after the page's last account (from the start again after a short page), so a full page of accounts that wait out their 30
 * days never hides the ones after it (review of M14-7).
 */
export async function inactiveAccounts(r: Rights, now: Date, cursors: Cursors): Promise<number> {
  const inactiveMs = r.config.retention.inactiveAccountMs;
  const lead = Math.min(INACTIVE_NOTICE_LEAD_MS, inactiveMs);
  const t = now.getTime();
  const deleteBefore = t - inactiveMs;
  let notified = 0;
  // the store answers accounts with no deletion pending, the longest inactive first
  const page = await r.store.inactiveSince(new Date(t - inactiveMs + lead).toISOString(), INACTIVE_BATCH, cursors.inactive ?? undefined);
  const end = page[page.length - 1];
  cursors.inactive = page.length < INACTIVE_BATCH || end === undefined ? null : { at: end.lastSignInAt ?? end.createdAt, account: end.id };
  for (const a of page) {
    try {
      const last = a.lastSignInAt ?? a.createdAt;
      const unchanged = (cur: typeof a) => cur.deletion === null && (cur.lastSignInAt ?? cur.createdAt) === last;
      const verified = a.email !== null && a.email.verifiedAt !== null;
      if (verified && a.inactiveNoticeAt === null) {
        let sent = false;
        const p = await r.deps.guard.patch(a.id, (cur) => {
          sent = unchanged(cur) && cur.inactiveNoticeAt === null;
          return sent ? { inactiveNoticeAt: iso(now) } : null;
        });
        if (p.ok && sent) {
          await notify(r, a.id, 'inactive');
          notified++;
        }
        continue;
      }
      if (Date.parse(last) >= deleteBefore) continue;
      if (a.inactiveNoticeAt !== null && Date.parse(a.inactiveNoticeAt) + lead > t) continue;
      const out = await requestDeletion(r, a.id, {
        at: now, purgeAt: new Date(t + r.config.timing.deleteGraceMs), keep: null, moveExisting: false, actor: 'system', actorOs: null,
        // a verified address gets its notice first, and its 30 days, even if it was verified a moment ago
        still: (cur) =>
          unchanged(cur) &&
          (cur.inactiveNoticeAt !== null ? Date.parse(cur.inactiveNoticeAt) + lead <= t : cur.email === null || cur.email.verifiedAt === null),
      });
      if (out?.started === true) {
        r.deps.audit.record({ kind: 'deletionRequested', account: a.id, actor: 'system', details: { purgeAt: out.purgeAt } }, now);
      }
    } catch (e) {
      r.log.event('accounts.inactive.failed', { error: errorName(e) });
    }
  }
  return notified;
}

/** The operator's export files past their day; answers how many were deleted (0 without ACCOUNTS_DATA_DIR). */
export async function sweepExports(r: Rights, now: Date): Promise<number> {
  if (r.config.dataDir === null) return 0;
  const n = await sweepAdminExports(r.config.dataDir, now, adminExportMs(r));
  if (n > 0) r.log.event('accounts.purge.exports', { removed: n });
  return n;
}

/** Retention now (10.3): the store's purge and the export files. */
export async function purgeNow(r: Rights, now: Date): Promise<AccountPurgeReport> {
  const report = await r.store.purge(r.config.retention, iso(now));
  await sweepExports(r, now);
  r.log.event('accounts.purge', { ...report });
  return report;
}
