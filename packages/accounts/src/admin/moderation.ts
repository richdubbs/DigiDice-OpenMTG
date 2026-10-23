/**
 * M14-6: the operator's moderation commands (design 9.6, 11.3 AccountAdmin): every AccountAdmin method but the data-rights part's (exportAccount,
 * deleteAccount, purge; M14-7) and the core's (rekeyCheck, rekey; M14-5). The service assembles the whole AccountAdmin (src/service/admin.ts).
 *
 * Every command checks the operator first and is audited with the operator's name and OS user, reads included (`adminViewed`, appended before the
 * read: ./operator.ts). The reads:
 * - `find`: the account with that id, or the accounts whose key starts with the key of the text (at most FIND_MAX).
 * - `show`: status, names and name history, providers, sessions (live ones and the last use), sanctions, appeals, reports about it and by it, and
 *   its security events of the last RECENT_MS (at most RECENT_MAX, newest last); null for an id with no account.
 * - `reports` and `appeals` (oldest first, a page of at most PAGE_MAX after `after`: a report id, or the sanction id of an appeal), `showReport` (at
 *   the sync, with the game's log, through hosted's tools), `audit` (the account's events, oldest first, at most AUDIT_MAX from `since`). `show`
 *   and `audit` flush the audit writer's queue first, so they see every event so far.
 * And the writes: `closeReport`, `revokeSessions` (every live session, reason 'admin'), and those of ./sanctions.ts and ./names.ts.
 */
import {
  accountStatus, ACCOUNT_ID, ACCOUNT_LIMITS, isAccountId, SECURITY_AUDIT_KINDS, type Account, type AccountId, type AuditEvent, type ProviderId,
} from '../api';
import { REPORT_ID, SANCTION_ID } from '../ids';
import type { AdminAccountView, ModerationPart, Operator } from '../service/api';
import type { AccountSessionRow, ReportQuery } from '../store/api';
import { hostedTextProblem } from '../text';
import { iso, keysFor, storeCode, type Mod } from '../moderation/context';
import { forceRename, releaseName, reserveName } from './names';
import { actorOf, adminEvent, append, checkOperator, conflict, idOf, invalid, limitOf, notFound, optionalText, viewed } from './operator';
import { answerAppeal, lift, sanction } from './sanctions';

export const FIND_MAX = 50;
export const RECENT_MS = 30 * 86_400_000;
export const RECENT_MAX = 50;
export const AUDIT_MAX = 1_000;
/** The largest page `reports` and `appeals` give. */
export const PAGE_MAX = 1_000;
const ROWS_MAX = 10_000;
const PROVIDER_ORDER: readonly ProviderId[] = ['local', 'shopify', 'passkey'];

export type ModerationAdmin = ModerationPart['admin'];

/** A session is live while it is not revoked, used within sessionIdleMs and before its expiresAt (5.2). */
function live(m: Mod, s: AccountSessionRow, at: Date): boolean {
  const t = at.getTime();
  return s.revokedAt === null && Date.parse(s.lastUsedAt) + m.config.timing.sessionIdleMs > t && Date.parse(s.expiresAt) > t;
}

/** A time the operator gave (`--since`): an ISO 8601 date or time. */
function timeOf(label: string, v: unknown): string {
  const t = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) invalid(`${label} is not an ISO 8601 date or time`);
  return new Date(t).toISOString();
}

export function createModerationAdmin(m: Mod): ModerationAdmin {
  return {
    async find(op: Operator, text: string): Promise<Account[]> {
      checkOperator(op);
      if (typeof text !== 'string' || text.trim() === '' || text.length > ACCOUNT_LIMITS.nameRawMax || hostedTextProblem(text) !== null) {
        invalid('find needs a name, the start of one, or an account id');
      }
      await viewed(m, op, 'find', null);
      if (isAccountId(text.trim())) {
        const a = await m.store.account(text.trim() as AccountId);
        return a === null ? [] : [a];
      }
      const { primary } = await keysFor(m, text);
      if (primary.key === '') return [];
      return (await m.store.findAccounts(primary.key, FIND_MAX)).filter((a) => a.keyVersion === primary.version);
    },

    async show(op: Operator, account: AccountId): Promise<AdminAccountView | null> {
      checkOperator(op);
      const id = idOf<AccountId>('the account', account, ACCOUNT_ID);
      const a = await m.store.account(id);
      await viewed(m, op, 'show', a !== null ? id : null);
      if (a === null) return null;
      const at = m.clock();
      // the service's queued events first, so the read sees everything written until now
      await m.audit.flush();
      const [nameHistory, credentials, sessions, sanctions, appeals, reportsAbout, reportsBy, security] = await Promise.all([
        m.store.nameHistory(id), m.store.credentials(id), m.store.sessionsOf(id), m.store.sanctionsOf(id), m.store.appeals({ account: id, limit: ROWS_MAX }),
        m.store.reports({ target: id, limit: ROWS_MAX }), m.store.reports({ reporter: id, limit: ROWS_MAX }),
        m.store.audit({ account: id, kinds: [...SECURITY_AUDIT_KINDS], since: iso(new Date(at.getTime() - RECENT_MS)), limit: ROWS_MAX }),
      ]);
      const has = new Set(credentials.map((c) => c.provider));
      let lastUsedAt: string | null = null;
      for (const s of sessions) if (lastUsedAt === null || Date.parse(s.lastUsedAt) > Date.parse(lastUsedAt)) lastUsedAt = s.lastUsedAt;
      return {
        account: a,
        status: accountStatus(sanctions, a.deletion, iso(at)),
        nameHistory,
        providers: PROVIDER_ORDER.filter((p) => has.has(p)),
        sessions: { live: sessions.filter((s) => live(m, s, at)).length, lastUsedAt },
        sanctions,
        appeals,
        reportsAbout,
        reportsBy,
        recentSecurity: security.slice(-RECENT_MAX),
      };
    },

    async reports(op, q: ReportQuery) {
      checkOperator(op);
      if (typeof q !== 'object' || q === null) invalid('the query is not an object');
      const query: ReportQuery = { limit: limitOf(q.limit, PAGE_MAX) };
      if (q.status !== undefined) {
        if (q.status !== 'new' && q.status !== 'actioned' && q.status !== 'dismissed') invalid('the status is new, actioned or dismissed');
        query.status = q.status;
      }
      if (q.target !== undefined) query.target = idOf<AccountId>('the target', q.target, ACCOUNT_ID);
      if (q.reporter !== undefined) query.reporter = idOf<AccountId>('the reporter', q.reporter, ACCOUNT_ID);
      if (q.after !== undefined) query.after = idOf('after', q.after, REPORT_ID);
      await viewed(m, op, 'reports', query.target ?? query.reporter ?? null);
      return m.store.reports(query);
    },

    async showReport(op, report) {
      checkOperator(op);
      const id = idOf('the report', report, REPORT_ID);
      const r = await m.store.report(id);
      await viewed(m, op, 'report', r !== null && 'account' in r.target ? r.target.account : null);
      return r;
    },

    async closeReport(op, report, outcome, note) {
      checkOperator(op);
      const id = idOf('the report', report, REPORT_ID);
      if (outcome !== 'actioned' && outcome !== 'dismissed') invalid('the outcome is actioned or dismissed');
      const text = optionalText('the note', note);
      const r = (await m.store.report(id)) ?? notFound('no such report');
      if (r.status !== 'new') conflict('the report is closed already');
      const at = m.clock();
      const event = adminEvent(m, op, 'reportClosed', 'account' in r.target ? r.target.account : null, { report: id, outcome }, at);
      try {
        await m.store.closeReport(id, outcome, actorOf(op), iso(at), text);
      } catch (e) {
        if (storeCode(e) === 'notFound') notFound('no such report');
        if (storeCode(e) === 'conflict') conflict('the report is closed already');
        throw e;
      }
      await append(m, [event]);
    },

    sanction: (op, account, s) => sanction(m, op, account, s),
    lift: (op, id, note) => lift(m, op, id, note),
    forceRename: (op, account, reason, to) => forceRename(m, op, account, reason, to),
    reserveName: (op, name, note) => reserveName(m, op, name, note),
    releaseName: (op, name, keyVersion) => releaseName(m, op, name, keyVersion),

    async revokeSessions(op, account) {
      checkOperator(op);
      const id = idOf<AccountId>('the account', account, ACCOUNT_ID);
      if ((await m.store.account(id)) === null) notFound('no such account');
      const at = m.clock();
      const revoked = await m.store.revokeSessions(id, 'admin', iso(at));
      // on record before the change goes out (./operator.ts)
      await append(m, [adminEvent(m, op, 'sessionsRevoked', id, { reason: 'admin', count: revoked.length }, at)]);
      if (revoked.length > 0) await m.changes({ at: iso(at), account: id, kind: 'sessionsRevoked' });
      return revoked.length;
    },

    async appeals(op, q) {
      checkOperator(op);
      if (typeof q !== 'object' || q === null) invalid('the query is not an object');
      if (q.open !== undefined && typeof q.open !== 'boolean') invalid('open is true or false');
      const query: { open?: boolean; limit: number; after?: string } = { limit: limitOf(q.limit, PAGE_MAX) };
      if (q.open !== undefined) query.open = q.open;
      if (q.after !== undefined) query.after = idOf('after', q.after, SANCTION_ID);
      await viewed(m, op, 'appeals', null);
      return m.store.appeals(query);
    },

    answerAppeal: (op, id, answer, message) => answerAppeal(m, op, id, answer, message),

    async audit(op, account, since): Promise<AuditEvent[]> {
      checkOperator(op);
      const id = idOf<AccountId>('the account', account, ACCOUNT_ID);
      const from = since === undefined ? undefined : timeOf('--since', since);
      const exists = (await m.store.account(id)) !== null;
      await viewed(m, op, 'audit', exists ? id : null);
      await m.audit.flush();
      return m.store.audit({ account: id, limit: AUDIT_MAX, ...(from !== undefined ? { since: from } : {}) });
    },
  };
}
