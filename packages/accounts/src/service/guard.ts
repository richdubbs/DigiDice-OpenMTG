/**
 * M14-5: the service core's shared checks (design 11.3 ServiceGuard), which the core and every part (moderation, rights, email, providers) use:
 *
 * - `session`: the live session behind an Auth and the account, if its status allows the call (3.8, RESTRICTED_CALLS); else sessionExpired,
 *   sessionRevoked, or the status's code (suspended or banned with the sanction, deletionPending). A session is live while it is not revoked, less
 *   than sessionIdleMs since its last use and before its expiresAt (5.2). Its lastUsedAt is brought up to date at most once a minute.
 * - `proof`: a Proof in the same request (5.2): missing answers reauthRequired; the password (checked against the local credential, the dummy when
 *   there is none) or a one-use reauth ticket of this session (`issueTicket`). A right one sets authAt and clears the session's proofFailures; a
 *   wrong one counts, answers badCredentials, and the `proofFailures`th in a row (5) revokes the session. One proof per session is checked at a time
 *   (a second one meanwhile answers rateLimited), and a password proof counts as a failure before its hash and is cleared only when it was right,
 *   so concurrent wrong proofs each count once and a stolen token gets exactly 5 guesses. The hash runs under the sign-in's limits of 8.1 (2 in
 *   flight per address key, 1 per account and address key) in rule 5's class of the address key (4.1), and the session is read again after it: a
 *   session revoked or expired meanwhile (by a password change elsewhere) passes nothing. `proofChecked` (the core's) also answers the local
 *   credential's PHC string as the store holds it once the proof passed (after its rehash), for a password change's compare-and-set.
 * - `text`: m13's text rules for a string the service takes (src/text.ts): the trimmed text, or null.
 * - `patch`: a self-contained account patch, re-read and retried up to 3 times on a version conflict, then 'conflict'.
 * - `resetAccess`: every session but one revoked, every device proof but one deleted, sessionsRevoked appended (a recovery, an email reset, a password
 *   change).
 *
 * Reauth tickets (3.5, 5.1) live here, in memory: 2 minutes, one use, bound to the session they were issued on. M14-13's provider flows issue them
 * through `issueTicket`; the core issues one to hand a registration's email to the email part without asking for the password twice.
 */
import {
  ACCOUNT_LIMITS, accountStatus, isAccountToken, sanctionRuns, type Account, type AccountResult, type AccountStatus, type SensitiveAction,
} from '../api';
import { codePoints, hostedTextProblem } from '../text';
import { newToken, tokenHash } from '../ids';
import { sanctionView } from '../views';
import { HasherBusyError } from '../crypto/api';
import type { AccountSessionRow, SanctionRow } from '../store/api';
import { RESTRICTED_CALLS, type Auth, type Proof, type RequestContext, type ServiceGuard, type ServiceMethod } from './api';
import { checkAuth, IN_FLIGHT_RETRY_MS, iso, type Core } from './context';
import { fail, ok, Refusal } from './result';

/** What a passed proof answers to the core: the local credential's secret as the store holds it now (null for a ticket). */
export interface CheckedProof {
  /** The PHC string that was verified (or the rehash that replaced it by compare-and-set); null for a reauth ticket. */
  secret: string | null;
}

/** The guard as the core uses it: ServiceGuard, with the reauth tickets and the session check by row. */
export interface CoreGuard extends ServiceGuard {
  /** `proof`, answering what was checked (a password change compares-and-sets on exactly that secret, 4.1). */
  proofChecked(ctx: RequestContext, auth: Auth, proof: Proof | undefined, action: SensitiveAction): Promise<AccountResult<CheckedProof>>;
  /** A one-use reauth ticket for this session (3.5): valid ACCOUNT_TIMING.reauthTicketMs. */
  issueTicket(auth: Auth, now: Date): string;
  /** Whether a session row is live at `now` (not revoked, not idle, not past expiresAt). */
  live(row: AccountSessionRow, now: Date): boolean;
  /** Drops expired tickets. */
  sweep(now: Date): void;
}

const LAST_USED_EVERY_MS = 60_000;
const PATCH_RETRIES = 3;

export function createGuard(core: Core): CoreGuard {
  const tickets = new Map<string, { account: string; session: string; expiresAt: number }>();

  const live = (row: AccountSessionRow, now: Date): boolean => {
    const t = now.getTime();
    return row.revokedAt === null && Date.parse(row.lastUsedAt) + core.timing.sessionIdleMs > t && Date.parse(row.expiresAt) > t;
  };

  /** The running sanction that sets the status (the one that ends last), as the account sees it: with its appeal, as SelfView shows it. */
  async function statusSanction(rows: SanctionRow[], kind: 'ban' | 'suspend', now: string) {
    const running = rows.filter((s) => s.kind === kind && sanctionRuns(s, now));
    running.sort((a, b) => (a.until === null ? 1 : b.until === null ? -1 : Date.parse(a.until) - Date.parse(b.until)));
    const s = running[running.length - 1];
    if (s === undefined) return undefined;
    return sanctionView(s, await core.store.appeal(s.id));
  }

  /** The Auth's session row (one primary-key read), or null when it has none or the row is another account's. */
  async function findSession(auth: Auth): Promise<AccountSessionRow | null> {
    const row = await core.store.sessionById(auth.session);
    return row !== null && row.account === auth.account ? row : null;
  }

  async function session(ctx: RequestContext, auth: Auth, call: ServiceMethod) {
    try {
      checkAuth(auth);
    } catch (e) {
      if (e instanceof Refusal) return e.result;
      throw e;
    }
    const now = ctx.now;
    const row = await findSession(auth);
    if (row === null) return fail('sessionExpired');
    if (row.revokedAt !== null) return fail('sessionRevoked');
    if (!live(row, now)) return fail('sessionExpired');
    const account = await core.store.account(auth.account);
    if (account === null) return fail('sessionExpired');
    const sanctions = await core.store.sanctionsOf(account.id);
    const nowIso = iso(now);
    const status: AccountStatus = accountStatus(sanctions, account.deletion, nowIso);
    if (status !== 'active' && !RESTRICTED_CALLS[status].includes(call)) {
      if (status === 'deleting') return fail('deletionPending');
      const sanction = await statusSanction(sanctions, status === 'banned' ? 'ban' : 'suspend', nowIso);
      return fail(status, sanction !== undefined ? { sanction } : {});
    }
    if (now.getTime() - Date.parse(row.lastUsedAt) >= LAST_USED_EVERY_MS) {
      await core.store.updateSession(row.id, { lastUsedAt: nowIso });
      row.lastUsedAt = nowIso;
    }
    return ok({ account, row, status });
  }

  function consumeTicket(ticket: string, auth: Auth, now: Date): boolean {
    if (!isAccountToken(ticket)) return false;
    const h = tokenHash(ticket);
    const t = tickets.get(h);
    if (t === undefined) return false;
    tickets.delete(h);
    return t.account === auth.account && t.session === auth.session && t.expiresAt > now.getTime();
  }

  async function proofChecked(ctx: RequestContext, auth: Auth, p: Proof | undefined, action: SensitiveAction): Promise<AccountResult<CheckedProof>> {
    if (p === undefined || p === null) return fail('reauthRequired');
    if (typeof p !== 'object' || Array.isArray(p)) return fail('badMessage');
    const keys = Object.keys(p);
    const isPassword = keys.length === 1 && keys[0] === 'password';
    const isTicket = keys.length === 1 && keys[0] === 'ticket';
    if (!isPassword && !isTicket) return fail('badMessage');
    const value = (p as Record<string, unknown>)[keys[0]!];
    if (isPassword && (typeof value !== 'string' || value.length > ACCOUNT_LIMITS.passwordRawMax || hostedTextProblem(value) !== null)) {
      return fail('badMessage');
    }
    if (isTicket && typeof value !== 'string') return fail('badMessage');
    try {
      checkAuth(auth);
    } catch (e) {
      if (e instanceof Refusal) return e.result;
      throw e;
    }
    // one proof of a session at a time, so that each wrong one is counted on the row the next one reads (5.2)
    const lock = `s:${auth.session}`;
    if (!core.locks.enter(lock)) return fail('rateLimited', { retryAfterMs: IN_FLIGHT_RETRY_MS });
    try {
      return await checkProof(ctx, auth, isPassword ? { password: value as string } : { ticket: value as string }, action);
    } finally {
      core.locks.leave(lock);
    }
  }

  const gone = (row: AccountSessionRow | null) => fail(row !== null && row.revokedAt !== null ? 'sessionRevoked' : 'sessionExpired');

  /** The proof's check, holding the session's lock. */
  async function checkProof(
    ctx: RequestContext, auth: Auth, p: { password: string } | { ticket: string }, action: SensitiveAction,
  ): Promise<AccountResult<CheckedProof>> {
    const now = ctx.now;
    const nowIso = iso(now);
    const row = await findSession(auth);
    if (row === null || !live(row, now)) return gone(row);
    let failures = row.proofFailures;
    let right: boolean;
    let secret: string | null = null;
    if ('password' in p) {
      // the hash under the sign-in's limits of 8.1 (2 per address key, 1 per account and address key), in rule 5's class (4.1)
      const pair = `acc:${auth.account}`;
      if (!core.inFlight.enter(ctx.addressKey, pair)) return fail('rateLimited', { retryAfterMs: IN_FLIGHT_RETRY_MS });
      try {
        const local = (await core.store.credentials(auth.account)).find((c) => c.provider === 'local') ?? null;
        // counted before the hash, so a request that never answers still counts; a right proof clears it below
        failures += 1;
        await core.store.updateSession(row.id, { proofFailures: failures });
        let r: { ok: boolean; rehash: typeof local };
        try {
          r = await core.local.verify(local, p.password, { priority: core.rate.signIn.priorityOf(ctx.addressKey, now) });
        } catch (e) {
          // nothing was checked: the attempt is given back
          await core.store.updateSession(row.id, { proofFailures: row.proofFailures }).catch(() => undefined);
          if (e instanceof HasherBusyError) return fail('unavailable', { retryAfterMs: e.retryAfterMs, message: 'The server is busy. Please try again in a moment.' });
          throw e;
        }
        right = r.ok && local !== null;
        if (right && local !== null) {
          secret = local.secret;
          if (r.rehash !== null) {
            // by compare-and-set on the string just verified: a password changed meanwhile keeps its new hash (4.1)
            const rehash = r.rehash;
            if (await core.store.putCredential(rehash, local.secret).then(() => true, () => false)) secret = rehash.secret;
          }
        }
      } finally {
        core.inFlight.leave(ctx.addressKey, pair);
      }
    } else {
      right = consumeTicket(p.ticket, auth, now);
      if (!right) {
        failures += 1;
        await core.store.updateSession(row.id, { proofFailures: failures });
      }
    }
    if (right) {
      // the session again: one revoked or expired while the proof was checked (a password change elsewhere revokes it) passes nothing
      const after = await findSession(auth);
      if (after === null || !live(after, now)) return gone(after);
      await core.store.updateSession(row.id, { authAt: nowIso, proofFailures: 0 });
      core.audit.record(
        {
          kind: 'reauthed', account: auth.account, actor: 'self', session: row.id, addressKey: ctx.addressKey,
          details: { action, via: 'password' in p ? 'password' : 'ticket' },
        },
        now,
      );
      return ok({ secret });
    }
    core.rate.signIn.addressFailed(ctx.addressKey, now);
    core.audit.record(
      { kind: 'reauthFailed', account: auth.account, actor: 'self', session: row.id, addressKey: ctx.addressKey, details: { action, count: failures } },
      now,
    );
    if (failures >= core.limits.proofFailures) {
      // a stolen token is guessing the password (5.2)
      await core.store.revokeSession(auth.account, row.id, 'proofFailed', nowIso);
      await core.changes({ at: nowIso, account: auth.account, kind: 'sessionRevoked', session: row.id });
      core.audit.record(
        { kind: 'sessionRevoked', account: auth.account, actor: 'system', session: row.id, addressKey: ctx.addressKey, details: { reason: 'proofFailed' } },
        now,
      );
    }
    return fail('badCredentials', { message: 'The password is not right.' });
  }

  async function proof(ctx: RequestContext, auth: Auth, p: Proof | undefined, action: SensitiveAction): Promise<AccountResult<void>> {
    const r = await proofChecked(ctx, auth, p, action);
    return r.ok ? ok(undefined) : r;
  }

  function text(s: unknown, max: number): string | null {
    if (typeof s !== 'string' || s.length > 4 * max + 64 || hostedTextProblem(s) !== null) return null;
    const t = s.trim();
    return codePoints(t) <= max ? t : null;
  }

  async function patch(id: Account['id'], f: (a: Account) => Parameters<Core['store']['updateAccount']>[2] | null) {
    for (let attempt = 0; attempt <= PATCH_RETRIES; attempt++) {
      const a = await core.store.account(id);
      if (a === null) return fail('notFound');
      const p = f(a);
      if (p === null) return ok(a);
      try {
        return ok(await core.store.updateAccount(id, a.version, p));
      } catch (e) {
        if ((e as { code?: unknown })?.code === 'conflict') continue;
        throw e;
      }
    }
    return fail('conflict');
  }

  async function resetAccess(account: Account['id'], reason: Parameters<ServiceGuard['resetAccess']>[1], except: string | null, keepDevice: string | null, at: Date) {
    const atIso = iso(at);
    const revoked = await core.store.revokeSessions(account, reason, atIso, except ?? undefined);
    await core.store.deleteDevices(account, keepDevice ?? undefined);
    if (revoked.length > 0) {
      await core.changes({ at: atIso, account, kind: 'sessionsRevoked', ...(except !== null ? { detail: { except } } : {}) });
    }
    core.audit.record({ kind: 'sessionsRevoked', account, actor: 'system', session: except, details: { reason, count: revoked.length } }, at);
  }

  return {
    session,
    proof,
    proofChecked,
    text,
    patch,
    resetAccess,
    live,
    issueTicket(auth, now) {
      const t = newToken(core.random);
      tickets.set(tokenHash(t), { account: auth.account, session: auth.session, expiresAt: now.getTime() + core.timing.reauthTicketMs });
      return t;
    },
    sweep(now) {
      const t = now.getTime();
      for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
    },
  };
}
