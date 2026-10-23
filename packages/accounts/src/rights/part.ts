/**
 * M14-7: the rights part (design section 10, 11.3 RightsPart), built from PartDeps: the account's export, deletion and cancel; the data holders; the
 * operator's export, delete and purge; and its share of the service's tick.
 *
 * - **exportData** (10.1): the session (a restricted one too, 3.8); `unavailable` while a required holder is not registered (only the operator's
 *   command line gives an export with `missing`); the proof in the same request (5.2, action 'export'); one export a day (`exportsPerDay`: looked
 *   at before the export is built, taken only once it is, so neither a mistyped password nor a failure on the way costs the day's export); the
 *   export (./export.ts); then, if the account is still there (an erasure may have come meanwhile: then nothing is recorded or handed out), the
 *   day's export taken and the export audited (`exported`). Nothing is kept on the server.
 * - **addHolder**: a holder's name is its key in AccountExport.holders and in requiredHolders (1-32 characters of a-z, 0-9 and '-', starting with a
 *   letter, as ACCOUNTS_REQUIRED_HOLDERS takes them); a second holder of one name is refused (a wiring mistake).
 * - **The operator** (9.6): `exportAccount` refuses ('incomplete') unless every required holder is registered or `partial` is set, then writes
 *   ACCOUNTS_DATA_DIR/exports/<account>-<time>.json (mode 0600; adminExportPath gives the path from the export's id and exportedAt; no file
 *   without ACCOUNTS_DATA_DIR) and returns the export, unless the account was erased while it was built or written ('notFound', the file deleted
 *   again); `deleteAccount` requests the deletion with the 7-day grace, or with `now` sets purgeAt to now
 *   (the server's tick then erases it with every holder: the command line never erases or writes a tombstone itself); `purge` runs retention now.
 *   The operator is checked with the audit writer's rules and the event is built before anything runs, and written after it (D16): a command the
 *   audit log could not record is refused ('invalid'), never run unrecorded. `purge` has no audit kind (AUDIT_KINDS has none; reported), and the
 *   deletion's `reason` is checked as text but no record has a field for it (reported).
 * - **tick(now)**: what committed erasures still owe (a snapshot), the due deletions (claim, holders, erase), inactive accounts (both a page a
 *   tick, paged on from tick to tick: Cursors), the export files past their day, and the daily purge (`purged` is null on the ticks that do not run
 *   it). Each step is guarded on its own, so one that fails is logged and never stops the next; a tick while another is still running does nothing.
 */
import { isAccountId, type AccountDataHolder, type AccountExport, type AccountResult, type AuditDetails, type AuditKind } from '../api';
import {
  AccountsAdminError, type Auth, type Operator, type PartDeps, type Proof, type RequestContext, type RightsPart,
} from '../service/api';
import { fail, ok, Refusal, unwrap } from '../service/result';
import type { AccountPurgeReport } from '../store/api';
import { codePoints, hostedTextProblem } from '../text';
import { DAY, errorName, missingHolders, stillThere, type Cursors, type Rights } from './context';
import { cancelDeletion, deleteAccount, eraseDue, finishErasures, requestDeletion, type ErasureCounts, type OwedErasures } from './deletion';
import { buildAccountExport } from './export';
import { removeAdminExport, writeAdminExport } from './files';
import { inactiveAccounts, purgeNow, sweepExports } from './retention';

/** A holder's name (ACCOUNTS_REQUIRED_HOLDERS' rule, and the audit details' `holders`). */
export const HOLDER_NAME = /^[a-z][a-z0-9-]{0,31}$/;
/** The `deleted` event lists at most this many holders (src/audit/details.ts). */
const HOLDERS_MAX = 16;
/** An operator's name (`--as`) and OS user: plain text of at most 64 UTF-16 units (the audit writer's rule; src/service/admin.ts checks the same). */
const OPERATOR_MAX = 64;
/** The operator's reason for a deletion, in code points. */
const REASON_MAX = 500;
/** exportData's retryAfterMs while a required holder is not registered (a deployment that is starting, or waiting for its holder). */
export const MISSING_HOLDER_RETRY_MS = 60_000;

/** The answer to a second export within the day. */
const onceADay = (retryAfterMs: number) => fail('rateLimited', { retryAfterMs, message: 'An account can be exported once a day. Please try again later.' });

/** Runs a flow that may throw a Refusal (unwrap, refuse) and answers its result, so the part answers an AccountResult on its own too. */
async function answer<T>(f: () => Promise<AccountResult<T>>): Promise<AccountResult<T>> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof Refusal) return e.result;
    throw e;
  }
}

function checkOperator(op: Operator): void {
  if (typeof op !== 'object' || op === null || typeof op.name !== 'string' || op.name.trim() === '' || typeof op.osUser !== 'string') {
    throw new AccountsAdminError('invalid', 'the operator needs a name (--as) and an OS user');
  }
  if (op.name.length > OPERATOR_MAX || hostedTextProblem(op.name) !== null) {
    throw new AccountsAdminError('invalid', `the operator's name (--as) must be plain text of at most ${OPERATOR_MAX} characters`);
  }
  if (op.osUser.length > OPERATOR_MAX || hostedTextProblem(op.osUser) !== null) {
    throw new AccountsAdminError('invalid', `the OS user must be plain text of at most ${OPERATOR_MAX} characters`);
  }
}

function checkAccount(account: unknown): void {
  if (!isAccountId(account)) throw new AccountsAdminError('invalid', 'not an account id');
}

export function buildRightsPart(deps: PartDeps): RightsPart {
  const r: Rights = {
    deps, store: deps.store, config: deps.config, log: deps.log, clock: deps.clock ?? (() => new Date()), holders: new Map<string, AccountDataHolder>(),
  };
  const owed: OwedErasures = new Map();
  const cursors: Cursors = { erase: null, inactive: null };
  let lastPurge: number | null = null;
  let ticking = false;

  /** An operator's event, built (and so checked) before the command runs. */
  function operatorEvent<K extends AuditKind>(op: Operator, kind: K, account: Auth['account'], details: AuditDetails[K], at: Date) {
    try {
      return deps.audit.build({ kind, account, actor: `admin:${op.name}`, actorOs: op.osUser, details }, at);
    } catch {
      throw new AccountsAdminError('invalid', 'the command cannot be audited as given');
    }
  }

  async function exportData(ctx: RequestContext, auth: Auth, proof: Proof): Promise<AccountResult<AccountExport>> {
    const s = unwrap(await deps.guard.session(ctx, auth, 'exportData'));
    // only the operator's command line may give an export without a required holder (10.1); the server's waits until it is there
    if (missingHolders(r).length > 0) {
      return fail('unavailable', { retryAfterMs: MISSING_HOLDER_RETRY_MS, message: 'Exports are not available right now. Please try again later.' });
    }
    unwrap(await deps.guard.proof(ctx, auth, proof, 'export'));
    // the day's export is looked at first and taken only once one is built, so a failure on the way costs nothing (review of M14-7)
    const key = { account: auth.account };
    const wait = deps.limitWait?.('export', key, ctx.now) ?? 0;
    if (wait > 0) return onceADay(wait);
    const a = await r.store.account(auth.account);
    if (a === null) return fail('sessionExpired');
    const exp = await buildAccountExport(r, a, { now: ctx.now, session: s.row.id });
    // erased while it was built: nothing of it is recorded or handed out
    if (!(await stillThere(r, a.id))) return fail('sessionExpired');
    const took = deps.limits.take('export', key, ctx.now);
    if (!took.ok) return onceADay(took.retryAfterMs);
    deps.audit.record({ kind: 'exported', account: a.id, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: {} }, ctx.now);
    return ok(exp);
  }

  const admin: RightsPart['admin'] = {
    async exportAccount(op, account, partial) {
      checkOperator(op);
      checkAccount(account);
      if (typeof partial !== 'boolean') throw new AccountsAdminError('invalid', 'partial is true or false');
      const now = r.clock();
      const a = await r.store.account(account);
      if (a === null) throw new AccountsAdminError('notFound', 'no such account');
      const missing = missingHolders(r);
      if (missing.length > 0 && !partial) {
        throw new AccountsAdminError('incomplete', `the export needs every required holder; not present: ${missing.join(', ')} (--partial writes it anyway, marked)`);
      }
      const event = operatorEvent(op, 'adminExported', account, { partial: missing.length > 0 }, now);
      const exp = await buildAccountExport(r, a, { now, session: null });
      // an account erased while its export was built, or while its file was written, leaves no file and no export
      const gone = () => new AccountsAdminError('notFound', 'the account was erased while it was exported');
      if (!(await stillThere(r, account))) throw gone();
      if (r.config.dataDir !== null) {
        await writeAdminExport(r.config.dataDir, exp);
        if (!(await stillThere(r, account))) {
          await removeAdminExport(r.config.dataDir, exp);
          throw gone();
        }
      }
      await r.store.appendAudit([event]);
      return exp;
    },

    async deleteAccount(op, account, reason, now) {
      checkOperator(op);
      checkAccount(account);
      if (typeof reason !== 'string' || reason.trim() === '' || codePoints(reason) > REASON_MAX || hostedTextProblem(reason) !== null) {
        throw new AccountsAdminError('invalid', `the reason must be plain text of 1 to ${REASON_MAX} characters`);
      }
      if (typeof now !== 'boolean') throw new AccountsAdminError('invalid', 'now is true or false');
      const at = r.clock();
      const purgeAt = new Date(now ? at.getTime() : at.getTime() + r.config.timing.deleteGraceMs);
      operatorEvent(op, 'deletionRequested', account, { purgeAt: purgeAt.toISOString() }, at);
      let out;
      try {
        out = await requestDeletion(r, account, { at, purgeAt, keep: null, moveExisting: now, actor: `admin:${op.name}`, actorOs: op.osUser });
      } catch (e) {
        if (e instanceof Refusal) throw new AccountsAdminError('conflict', 'the account changed at the same time: run the command again');
        throw e;
      }
      if (out === null) throw new AccountsAdminError('notFound', 'no such account');
      // a request while one is pending changes nothing (but a sooner purgeAt with --now) and is not recorded again
      if (out.started || out.moved) await r.store.appendAudit([operatorEvent(op, 'deletionRequested', account, { purgeAt: out.purgeAt }, at)]);
      return { purgeAt: out.purgeAt };
    },

    async purge(op): Promise<AccountPurgeReport> {
      checkOperator(op);
      const now = r.clock();
      const report = await purgeNow(r, now);
      lastPurge = now.getTime();
      return report;
    },
  };

  async function step(name: string, f: () => Promise<void>): Promise<void> {
    try {
      await f();
    } catch (e) {
      r.log.event('accounts.rights.tick', { step: name, error: errorName(e) });
    }
  }

  return {
    exportData: (ctx, auth, proof) => answer(() => exportData(ctx, auth, proof)),
    deleteAccount: (ctx, auth, proof) => answer(() => deleteAccount(r, ctx, auth, proof)),
    cancelDeletion: (ctx, auth) => answer(() => cancelDeletion(r, ctx, auth)),

    addHolder(holder) {
      if (typeof holder !== 'object' || holder === null || typeof holder.name !== 'string' || !HOLDER_NAME.test(holder.name)) {
        throw new TypeError('a data holder\'s name is 1-32 characters of a-z, 0-9 and "-", starting with a letter');
      }
      if (typeof holder.exportFor !== 'function' || typeof holder.erase !== 'function') throw new TypeError('a data holder needs exportFor and erase');
      if (r.holders.has(holder.name)) throw new TypeError(`a data holder named ${holder.name} is registered already`);
      if (r.holders.size >= HOLDERS_MAX) throw new TypeError(`at most ${HOLDERS_MAX} data holders`);
      r.holders.set(holder.name, holder);
    },

    admin,

    async tick(now) {
      const report = { erased: 0, erasureRetries: 0, erasureBlocked: 0, inactiveNotified: 0, purged: null as AccountPurgeReport | null };
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('tick: now is not a Date');
      if (ticking) return report;
      ticking = true;
      try {
        const counts: ErasureCounts = report;
        await step('owed', () => finishErasures(r, owed));
        await step('erasure', () => eraseDue(r, now, counts, owed, cursors));
        await step('inactive', async () => {
          report.inactiveNotified = await inactiveAccounts(r, now, cursors);
        });
        await step('exports', async () => {
          await sweepExports(r, now);
        });
        const t = now.getTime();
        if (lastPurge === null || t - lastPurge >= DAY || t < lastPurge) {
          await step('purge', async () => {
            report.purged = await purgeNow(r, now);
            lastPurge = t;
          });
        }
        return report;
      } finally {
        ticking = false;
      }
    },
  };
}
