/**
 * M14-5: the account service (design 11.3, `createAccountService`): the core's methods (./signin.ts, ./sessions.ts, ./profile.ts, ./directory.ts,
 * ./admin.ts) and the parts the service takes as optional dependencies (moderation M14-6, data rights M14-7, email M14-8; the provider methods of
 * ./providers.ts, M14-13). The core builds what it hands each part (PartDeps): the store, the configuration, the audit writer (src/audit), the rate
 * limits (src/abuse), the change feed, the mail queue, the log, the random source and the shared checks (./guard.ts); and, added by M14-8, the
 * mailer, the steps of a recovery-code sign-in that the email reset takes (PartSignIn, `partSignIn`), the email part's notices for every part and
 * the credential tools' one secret comparison (CredentialTools.equal).
 *
 * - **Answers.** Every method answers an AccountResult and never throws for anything a client sends: a refusal answers its code; a full hashing
 *   queue answers `busy` where the method's row has it, else `unavailable`; a store's refusal of a value answers `badMessage`; anything else answers
 *   `unavailable` with retryAfterMs and is logged by its error's name only (12.1).
 * - **Missing parts.** A method of a part that is not built answers `notYet`, after the session check when it takes an Auth (so a restricted session
 *   still gets its status's code for a call outside RESTRICTED_CALLS). The operator's commands of a missing part throw AccountsAdminError('incomplete').
 * - **The change feed** (9.7): `changes(c)` appends to the store and then tells every onChange listener (a listener that throws is logged and
 *   ignored).
 * - **tick(now)**: the parts' ticks (sanction ends, erasure and retention, mail files), the core's housekeeping (the audit month keys, failure
 *   counts and once-a-minute keys, idle rate-limit counters, reauth tickets, age-gate marks), and the audit queue flushed.
 * - **close()**: flushes the audit queue and closes the store (ComposedAccounts: AccountService.close closes it).
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { AccountChange, AccountDataHolder, AccountErrorCode, AccountResult } from '../api';
import { addressKeys } from '../abuse/address';
import { buildRateLimiter } from '../abuse/limiter';
import { buildAuditWriter } from '../audit/writer';
import { HasherBusyError } from '../crypto/api';
import type { Mailer, MailQueue } from '../email/api';
import { createMailQueue } from '../email/index';
import { buildLocalProvider } from '../identity/local';
import type { PasswordProvider } from '../identity/api';
import { AccountStoreError } from '../store/api';
import {
  ACCOUNT_METHOD_ERRORS, type AccountService, type AccountsLog, type Auth, type EmailPart, type ModerationPart, type PartDeps, type PartSignIn,
  type RequestContext, type RightsPart, type ServiceMethod, type TickReport,
} from './api';
import { createAdmin } from './admin';
import {
  checkCtx, findByName, iso, selfViewOf, withSlot, type AgeMarks, type Core, type InFlight, type KeyLocks, type ServiceDeps,
} from './context';
import { createDirectory } from './directory';
import { createGuard } from './guard';
import { claimGuest, markSeen, nameUnavailable, profile, rename, self, setAvatar, setPrivacy } from './profile';
import { createProviderPart } from './providers';
import { fail, Refusal } from './result';
import {
  changePassword, issueSession, newRecoveryCodes, noteSignIn, renewRecoveryCodes, resume, revokeSession, sessions, signOut, validDevice,
} from './sessions';
import { register, signIn, useRecoveryCode } from './signin';

const UNAVAILABLE_RETRY_MS = 1_000;
const MAIL_QUEUE_MAX = 1_000;

function createInFlight(perAddress: number, perPair: number): InFlight {
  const addresses = new Map<string, number>();
  const pairs = new Map<string, number>();
  const keysOf = (addressKey: string, nameKey: string | null) => {
    const a = addressKeys(addressKey).key;
    return { a, p: nameKey !== null ? `${nameKey}\n${a}` : null };
  };
  const dec = (m: Map<string, number>, k: string) => {
    const n = (m.get(k) ?? 0) - 1;
    if (n > 0) m.set(k, n);
    else m.delete(k);
  };
  return {
    enter(addressKey, nameKey) {
      const { a, p } = keysOf(addressKey, nameKey);
      if ((addresses.get(a) ?? 0) >= perAddress) return false;
      if (p !== null && (pairs.get(p) ?? 0) >= perPair) return false;
      addresses.set(a, (addresses.get(a) ?? 0) + 1);
      if (p !== null) pairs.set(p, (pairs.get(p) ?? 0) + 1);
      return true;
    },
    leave(addressKey, nameKey) {
      const { a, p } = keysOf(addressKey, nameKey);
      dec(addresses, a);
      if (p !== null) dec(pairs, p);
    },
  };
}

function createKeyLocks(): KeyLocks {
  const held = new Set<string>();
  return {
    enter(key) {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    leave(key) {
      held.delete(key);
    },
  };
}

/**
 * The age-gate marks (7.5): at most `max` keys (counterEntries, like every other map of 8.2 rule 6). Marks are kept in the order they were set, and
 * every mark lives the same `ms`, so the oldest are at the front and are also the first to expire: a full map drops its oldest marks (expired or
 * not) before it takes a new one, without scanning the rest. A mark that goes early only lets one connection answer its birth date again sooner;
 * the client's own flag stays.
 */
export function createAgeMarks(ms: number, max: number): AgeMarks {
  const marks = new Map<string, number>();
  return {
    marked(keys, now) {
      return keys.some((k) => (marks.get(k) ?? 0) > now.getTime());
    },
    mark(keys, now) {
      for (const k of keys) {
        marks.delete(k);
        for (const old of marks.keys()) {
          if (marks.size < max) break;
          marks.delete(old);
        }
        marks.set(k, now.getTime() + ms);
      }
    },
    sweep(now) {
      for (const [k, until] of marks) if (until <= now.getTime()) marks.delete(k);
    },
    get size() {
      return marks.size;
    },
  };
}

/** The mail queue while M14-8's createMailQueue is not built: bounded, in memory, sending one message at a time after the answer. */
function fallbackMailQueue(mailer: Mailer, log: AccountsLog): MailQueue {
  const queue: Parameters<MailQueue['enqueue']>[] = [];
  let running = false;
  async function pump(): Promise<void> {
    running = true;
    while (queue.length > 0) {
      const [to, message, meta] = queue.shift()!;
      try {
        await mailer.send(to, message, meta);
      } catch (e) {
        log.event('accounts.mail.failed', { kind: meta.kind, error: e instanceof Error ? e.name : 'error' });
      }
    }
    running = false;
  }
  return {
    enqueue(to, message, meta) {
      if (queue.length >= MAIL_QUEUE_MAX) {
        // a full queue drops the oldest notice first, never a code (3.4)
        const i = queue.findIndex((m) => m[2].kind === 'notice');
        if (i < 0) {
          log.event('accounts.mail.dropped', { kind: meta.kind });
          return;
        }
        queue.splice(i, 1);
      }
      queue.push([to, message, meta]);
      if (!running) setImmediate(() => void pump());
    },
  };
}

/** PartDeps.signIn (M14-8's email reset): the steps of a recovery-code sign-in (./signin.ts), on the core's own helpers. */
function partSignIn(core: Core): PartSignIn {
  return {
    async findByName(name, now) {
      // the email reset reaches an account by a forced rename's old name too, as sign-in does (review A6)
      const f = await findByName(core, name, now, { bans: true });
      return { key: f.key, account: f.account };
    },
    async validDevice(proof, account, now) {
      return (await validDevice(core, proof, account, now))?.hash ?? null;
    },
    async passwordProblem(password, ctx) {
      const problem = core.credentials.passwordProblem(password, ctx);
      if (problem !== null || core.breachCheck === null) return problem;
      return (await core.breachCheck.breached(password).catch(() => 'unknown' as const)) === true ? 'common' : null;
    },
    enroll(ctx, account, password) {
      const priority = core.rate.signIn.priorityOf(ctx.addressKey, ctx.now);
      return withSlot(core, ctx.addressKey, account.nameKey, () => core.local.enroll(account.id, password, iso(ctx.now), { priority }));
    },
    async signIn(ctx, account, device, reason) {
      const sent = await validDevice(core, device, account, ctx.now);
      const issued = await issueSession(core, ctx, account, 'local', sent !== null && device !== undefined ? { proof: device, row: sent } : null);
      await core.guard.resetAccess(account.id, reason, issued.row.id, issued.deviceHash, ctx.now);
      const updated = (await noteSignIn(core, account.id, ctx.now)) ?? account;
      return { account: await selfViewOf(core, updated, ctx.now), auth: issued.auth, token: issued.token, rotation: 0, device: issued.device };
    },
    newRecoveryCodes(account, now) {
      return renewRecoveryCodes(core, account.id, now);
    },
  };
}

export function buildAccountService(deps: ServiceDeps): AccountService {
  const random = deps.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const clock = deps.now ?? (() => new Date());
  const { store, config, hasher, credentials, log } = deps;
  const local: PasswordProvider =
    (deps.providers.find((p) => p.id === 'local' && p.kind === 'password') as PasswordProvider | undefined) ?? buildLocalProvider({ hasher, credentials });
  const audit = buildAuditWriter({ store, log, random });
  const rate = buildRateLimiter({ limits: config.limits, verifier: deps.verifier.kind, hashLoad: () => hasher.load() });
  const listeners = new Set<(c: AccountChange) => void>();
  const scopeKey = Buffer.from(random(32).slice(0, 32));

  const core = {
    store, config, limits: config.limits, timing: config.timing, hasher, credentials, local, providers: deps.providers, names: deps.names,
    nameFilter: deps.nameFilter, verifier: deps.verifier, mailer: deps.mailer, breachCheck: deps.breachCheck ?? null, guests: deps.guests, log,
    random, clock, audit, rate,
    async changes(c: Omit<AccountChange, 'seq'>): Promise<number> {
      const seq = await store.appendChange(c);
      const full: AccountChange = { ...c, seq };
      for (const l of listeners) {
        try {
          l(full);
        } catch (e) {
          log.event('accounts.changes.listener', { error: e instanceof Error ? e.name : 'error' });
        }
      }
      return seq;
    },
    mail: createMailQueue !== undefined ? createMailQueue({ mailer: deps.mailer, log }) : fallbackMailQueue(deps.mailer, log),
    email: null,
    inFlight: createInFlight(config.limits.hashJobsPerAddress, config.limits.hashJobsPerNameAndAddress),
    locks: createKeyLocks(),
    ageMarks: createAgeMarks(config.timing.ageRetryMs, config.limits.counterEntries),
    scope: (nameKey: string) => createHmac('sha256', scopeKey).update(nameKey, 'utf8').digest('hex').slice(0, 16),
  } as Omit<Core, 'guard'> as Core;
  core.guard = createGuard(core);

  const partDeps: PartDeps = {
    store, config, audit, limits: rate, changes: (c) => core.changes(c), mail: core.mail, log, random, guard: core.guard,
    // INTERFACE CHANGE (M14-7, M14-8): the clock, the mailer, the sign-in steps of the email reset, the email part's notices (the part is built
    // after these deps, so it is looked up at the call) and the one comparison
    clock, mailer: deps.mailer, signIn: partSignIn(core),
    notify: (account, kind, to) => (core.email !== null ? core.email.notify(account, kind, to) : Promise.resolve()),
    equal: (a, b) => credentials.equal(a, b),
    // INTERFACE CHANGE (M14-7, review): a limit's wait, and the account's events still queued
    limitWait: (rule, key, now) => rate.wait(rule, key, now), auditQueued: (account) => audit.queued(account),
  };
  const moderation: ModerationPart | null = deps.parts?.moderation?.(partDeps) ?? null;
  const rights: RightsPart | null = deps.parts?.rights?.(partDeps) ?? null;
  const email: EmailPart | null = deps.parts?.email?.(partDeps) ?? null;
  core.email = email;
  // INTERFACE CHANGE (M14-13): the provider part gets the core itself (ProviderPartDeps.core, ./providers.ts), whose session, name and registration
  // steps the provider flows share; PartDeps alone has no name rules, word filter, guest sessions or session issuing
  const providers = createProviderPart({ ...partDeps, providers: deps.providers, core });
  const directory = createDirectory(core);
  const admin = createAdmin(core, { moderation, rights });
  const pendingHolders: AccountDataHolder[] = [];
  let closed = false;

  /** Runs a method's flow and answers every outcome as an AccountResult (see the header). */
  async function run<T>(method: ServiceMethod, ctx: RequestContext | null, f: () => Promise<AccountResult<T>>): Promise<AccountResult<T>> {
    try {
      if (closed) return fail('unavailable', { retryAfterMs: UNAVAILABLE_RETRY_MS });
      if (ctx !== null) checkCtx(ctx);
      return await f();
    } catch (e) {
      if (e instanceof Refusal) return e.result;
      const codes: readonly AccountErrorCode[] = ACCOUNT_METHOD_ERRORS[method];
      if (e instanceof HasherBusyError) {
        return fail(codes.includes('busy') ? 'busy' : 'unavailable', { retryAfterMs: e.retryAfterMs, message: 'The server is busy. Please try again in a moment.' });
      }
      if (e instanceof AccountStoreError && e.code === 'value') {
        log.event('accounts.refusedValue', { method });
        return fail('badMessage');
      }
      log.event('accounts.failed', { method, error: e instanceof AccountStoreError ? `store:${e.code}` : e instanceof Error ? e.name : 'error' });
      return fail('unavailable', { retryAfterMs: UNAVAILABLE_RETRY_MS });
    }
  }

  /** A missing part's method: the session first (when it takes an Auth), then notYet. */
  async function missing(method: ServiceMethod, ctx: RequestContext, auth: Auth | null): Promise<AccountResult<never>> {
    if (auth !== null) {
      const s = await core.guard.session(ctx, auth, method);
      if (!s.ok) return s;
    }
    return fail('notYet');
  }

  const service: AccountService = {
    register: (ctx, req) => run('register', ctx, () => register(core, ctx, req)),
    signIn: (ctx, req) => run('signIn', ctx, () => signIn(core, ctx, req)),
    resume: (ctx, token) => run('resume', ctx, () => resume(core, ctx, token)),
    signOut: (ctx, auth, everywhere) => run('signOut', ctx, () => signOut(core, ctx, auth, everywhere)),
    sessions: (ctx, auth) => run('sessions', ctx, () => sessions(core, ctx, auth)),
    revokeSession: (ctx, auth, session) => run('revokeSession', ctx, () => revokeSession(core, ctx, auth, session)),
    changePassword: (ctx, auth, current, next) => run('changePassword', ctx, () => changePassword(core, ctx, auth, current, next)),
    useRecoveryCode: (ctx, req) => run('useRecoveryCode', ctx, () => useRecoveryCode(core, ctx, req)),
    newRecoveryCodes: (ctx, auth, proof) => run('newRecoveryCodes', ctx, () => newRecoveryCodes(core, ctx, auth, proof)),

    setEmail: (ctx, auth, address, proof) => run('setEmail', ctx, () => (email ? email.setEmail(ctx, auth, address, proof) : missing('setEmail', ctx, auth))),
    verifyEmail: (ctx, auth, code) => run('verifyEmail', ctx, () => (email ? email.verifyEmail(ctx, auth, code) : missing('verifyEmail', ctx, auth))),
    // INTERFACE CHANGE (M14-15, review A4): requestEmailReset's `device` passed on
    requestEmailReset: (ctx, name, device) =>
      run('requestEmailReset', ctx, () => (email ? email.requestEmailReset(ctx, name, device) : missing('requestEmailReset', ctx, null))),
    useEmailReset: (ctx, req) => run('useEmailReset', ctx, () => (email ? email.useEmailReset(ctx, req) : missing('useEmailReset', ctx, null))),

    beginProvider: (ctx, provider, intent, auth, proof) => run('beginProvider', ctx, () => providers.beginProvider(ctx, provider, intent, auth, proof)),
    providerCallback: (input) => run('providerCallback', null, () => providers.providerCallback(input)),
    // INTERFACE CHANGE (M14-13, review of M14-13): confirmProvider's `device` passed on
    confirmProvider: (ctx, auth, flow, code, device) => run('confirmProvider', ctx, () => providers.confirmProvider(ctx, auth, flow, code, device)),
    registerWithProvider: (ctx, flow, req) => run('registerWithProvider', ctx, () => providers.registerWithProvider(ctx, flow, req)),
    unlinkProvider: (ctx, auth, provider, proof) => run('unlinkProvider', ctx, () => providers.unlinkProvider(ctx, auth, provider, proof)),

    claimGuest: (ctx, auth, token, proof) => run('claimGuest', ctx, () => claimGuest(core, ctx, auth, token, proof)),
    nameUnavailable: (name) => nameUnavailable(core, name),
    self: (ctx, auth) => run('self', ctx, () => self(core, ctx, auth)),
    markSeen: (ctx, auth, sanction) => run('markSeen', ctx, () => markSeen(core, ctx, auth, sanction)),
    rename: (ctx, auth, name, proof) => run('rename', ctx, () => rename(core, ctx, auth, name, proof)),
    setAvatar: (ctx, auth, avatar) => run('setAvatar', ctx, () => setAvatar(core, ctx, auth, avatar)),
    setPrivacy: (ctx, auth, change) => run('setPrivacy', ctx, () => setPrivacy(core, ctx, auth, change)),
    profile: (ctx, who) => run('profile', ctx, () => profile(core, ctx, who)),

    block: (ctx, auth, other, on) => run('block', ctx, () => (moderation ? moderation.block(ctx, auth, other, on) : missing('block', ctx, auth))),
    mute: (ctx, auth, other, on) => run('mute', ctx, () => (moderation ? moderation.mute(ctx, auth, other, on) : missing('mute', ctx, auth))),
    relations: (ctx, auth) => run('relations', ctx, () => (moderation ? moderation.relations(ctx, auth) : missing('relations', ctx, auth))),
    report: (ctx, reporter, report) =>
      run('report', ctx, () =>
        moderation ? moderation.report(ctx, reporter, report) : missing('report', ctx, typeof reporter === 'object' && reporter?.kind === 'account' ? reporter.auth : null),
      ),
    appeal: (ctx, auth, sanction, text, proof) =>
      run('appeal', ctx, () => (moderation ? moderation.appeal(ctx, auth, sanction, text, proof) : missing('appeal', ctx, auth))),

    exportData: (ctx, auth, proof) => run('exportData', ctx, () => (rights ? rights.exportData(ctx, auth, proof) : missing('exportData', ctx, auth))),
    deleteAccount: (ctx, auth, proof) => run('deleteAccount', ctx, () => (rights ? rights.deleteAccount(ctx, auth, proof) : missing('deleteAccount', ctx, auth))),
    cancelDeletion: (ctx, auth) => run('cancelDeletion', ctx, () => (rights ? rights.cancelDeletion(ctx, auth) : missing('cancelDeletion', ctx, auth))),

    directory,
    admin,
    addHolder(holder) {
      if (typeof holder !== 'object' || holder === null || typeof holder.name !== 'string') throw new TypeError('a data holder needs a name');
      if (rights) rights.addHolder(holder);
      else pendingHolders.push(holder);
    },
    changes: (after, limit) => store.changes(after, limit),
    changesHead: () => store.changesHead(),
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async tick(now) {
      const report: TickReport = { erased: 0, erasureRetries: 0, erasureBlocked: 0, sanctionsEnded: 0, inactiveNotified: 0, mailFilesRemoved: 0, purged: null };
      const part = async <T>(name: string, f: (() => Promise<T>) | null, take: (r: T) => void) => {
        if (f === null) return;
        try {
          take(await f());
        } catch (e) {
          log.event('accounts.tick.failed', { part: name, error: e instanceof Error ? e.name : 'error' });
        }
      };
      await part('moderation', moderation ? () => moderation.tick(now) : null, (r) => {
        report.sanctionsEnded = r.sanctionsEnded;
      });
      await part('rights', rights ? () => rights.tick(now) : null, (r) => {
        report.erased = r.erased;
        report.erasureRetries = r.erasureRetries;
        report.erasureBlocked = r.erasureBlocked;
        report.inactiveNotified = r.inactiveNotified;
        report.purged = r.purged;
      });
      await part('email', email ? () => email.tick(now) : null, (r) => {
        report.mailFilesRemoved = r.mailFilesRemoved;
      });
      core.audit.sweep(now);
      core.rate.sweep(now);
      core.guard.sweep(now);
      core.ageMarks.sweep(now);
      await core.audit.flush().catch(() => undefined);
      return report;
    },
    async close() {
      if (closed) return;
      closed = true;
      await core.audit.flush().catch(() => undefined);
      await store.close();
    },
  };
  return service;
}
