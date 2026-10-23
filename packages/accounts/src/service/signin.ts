/**
 * M14-5: registration, sign-in and the recovery-code sign-in (design 3.2, 3.3, 4.4, 5.3, 5.5, 6, 7.5, 8.1-8.4).
 *
 * **Register**, in order: the request's fields (badMessage); a busy guest session (busy); the age-gate mark of this connection or guest session
 * (ageGate, 24 hours); the age (oldEnough, MIN_AGE; a refusal marks the connection and the guest session); the name (checkAccountName, the static
 * reserved rules, the word filter: nameInvalid, nameReserved, nameFiltered); the email (emailUnavailable with NoMailer, notYet without the email
 * part, emailInvalid); the password (the local policy with the request's name, key and email: passwordWeak); the name's availability under both key
 * versions during a rekey (nameTaken); the claim (only the connection's own guest session, not busy); then the limits (3 an hour and 10 a day per
 * address key, looked at before the registration pressure of 8.1 and its work, and taken just before the work is checked: review A1); a configured
 * breach check (passwordWeak 'common'; after the limits, since it asks a third party: review A11, so a breached password does cost one); the hash;
 * and one atomic createAccount (account, credential, 10 recovery codes, name history, claim, session, device proof, audit). Validation comes before
 * the limits, so a weak password or a taken name never costs one of the 3 registrations of the hour.
 *
 * **Sign in**: the fields; busy; one attempt in flight per device proof sent (a second one meanwhile answers rateLimited, so each wrong password
 * adds exactly one to DeviceRow.failures and the next attempt's back-off sees it, 8.2 rule 2); the account by the name's key (6.3); a valid device
 * proof (8.3); the guard (8.2: back-off, work, classes; no password check while it refuses); the hash jobs in flight (2 per address key, 1 per name
 * key and address key); the password against the local credential, or the dummy (skipped only for a free name while the hashing queue is under
 * pressure, 4.1); then the outcome: `badCredentials` for every failure, or a session, restricted when the account is not active (3.8, D24).
 *
 * **The audit's noise** (8.5): a failed attempt counts toward one signInFailed or recoveryFailed event a minute per account and address key, and
 * the throttles and work demands are written once a minute per key likewise. For names no account holds every one of them is per address key
 * whatever the names, and all of them together within the audit writer's ANONYMOUS_EVENTS_PER_MINUTE (review A8, M14-15: one event per fresh name
 * grew the security log without bound). The keys of these bounds hold the account id or the audit's address tag, never a typed name or a raw
 * address key, and the writer sweeps them at each tick (review A9).
 *
 * **Recovery** (4.4): the fields; busy; the guard (only the per-address rule 4, whose token the attempt takes at once, and rule 5; a valid device
 * proof gives only the `high` class, and a wrong code never counts on it); the new password against the policy WITHOUT the email
 * (the request's name and its key: the same answer for every account); the code against every unused slot with the injected comparison, no early
 * exit, padded with dummy hashes to ten (an unknown name compares ten dummy hashes: the count never follows the codes left, review A10); the email
 * rule once the code matched (a weak password burns no code); the new hash; the slot spent by compare-and-set; the new password set; an email
 * address set in the RECENT_EMAIL_MS before the recovery (but not by the registration itself) removed, with its codes and the emailRemoved notice to
 * it if it was verified (review A5, M14-15: whoever set it with a stolen password could take the account back by an email reset); a session; every
 * other session revoked and every device proof but the one used deleted; the recovery-code-used notice.
 */
import { createHash } from 'node:crypto';
import {
  ACCOUNT_LIMITS, DEFAULT_PRIVACY, defaultAvatar, oldEnough, type Account, type AccountResult, type AuditEvent, type SelfView,
} from '../api';
import { checkAccountName } from '../api/names';
import { emailProblem } from '../api/email';
import { formatRecoveryCode, normalizeRecoveryCode } from '../api/passwords';
import type { SignInAttempt, VerifyAction } from '../abuse/api';
import { HasherBusyError, type HashPriority } from '../crypto/api';
import { newAccountId, tokenHash } from '../ids';
import type { NameHistoryRow, NewAccount } from '../store/api';
import type { PasswordSignIn, RecoverRequest, RegisterRequest, RequestContext, SignedIn } from './api';
import {
  clientText, DUMMY_ACCOUNT, entriesFor, findByName, IN_FLIGHT_RETRY_MS, isFree, iso, keysOf, optionalText, reserved, selfViewOf, statusOf, withSlot,
  type Core,
} from './context';
import { BUSY_IN_GAME, fail, ok, refuse } from './result';
import {
  checkBreached, checkPassword, checkPolicy, deviceField, emailLocalOf, issueSession, newDeviceRow, newSessionRow, noteSignIn, recoveryRows,
  validDevice,
} from './sessions';

/**
 * An email address set this recently before a recovery-code sign-in is removed by it (review A5): 30 days, the rename cooldown's length. An older
 * one stays: its owner had that long to see the emailChanged notice at the address before it.
 */
export const RECENT_EMAIL_MS = 30 * 86_400_000;

/** A work challenge to send with captchaRequired or captchaFailed (none for a verifier with its own widget). */
function challengeOf(core: Core, action: VerifyAction, scope: string, bits: number, now: Date) {
  const c = core.verifier.challenge({ action, scope, bits }, now);
  return c !== null ? { challenge: c } : {};
}

/** The key of a noisy event (8.5): its kind, the account (or 'anon' for a name no account holds) and the address key's audit tag (review A9). */
function noiseKey(core: Core, kind: string, account: Account | null, addressKey: string, now: Date): string {
  return `${kind}\n${account?.id ?? 'anon'}\n${core.audit.addressTag(addressKey, now) ?? 'none'}`;
}

/**
 * Runs the sign-in guard for an attempt (8.2), paying work when it asks and the attempt carries a solution: the hashing class to use, or a refusal
 * (rateLimited, captchaRequired with a challenge, captchaFailed with a new one).
 */
async function passGuard(core: Core, ctx: RequestContext, attempt: SignInAttempt, captcha: string | undefined, account: Account | null): Promise<HashPriority> {
  const now = ctx.now;
  const action: VerifyAction = attempt.kind === 'recover' ? 'recover' : 'signIn';
  let { decision, rule } = core.rate.signIn.decide(attempt, now);
  const anonymous = account === null;
  const nameTag = anonymous ? core.audit.nameTag(attempt.nameKey, now) : null;
  if (!decision.go && decision.code === 'captchaRequired') {
    const scope = core.scope(attempt.nameKey);
    const bits = decision.bits;
    if (captcha !== undefined) {
      const v = await core.verifier.verify(captcha, { addressKey: ctx.addressKey, action, scope, bits }, now);
      // a verifier that cannot be reached: the attempt counts as unverified and gets a work challenge instead (8.4)
      if (!v.ok) refuse(v.reason === 'unavailable' ? 'captchaRequired' : 'captchaFailed', challengeOf(core, action, scope, bits, now));
      ({ decision, rule } = core.rate.signIn.decide({ ...attempt, workBits: bits }, now));
    }
    if (!decision.go && decision.code === 'captchaRequired') {
      if (core.audit.once(noiseKey(core, 'work', account, ctx.addressKey, now), now, anonymous)) {
        core.audit.record(
          { kind: 'captchaRequired', account: account?.id ?? null, actor: 'self', addressKey: ctx.addressKey, details: { rule: rule === 3 ? 3 : 5, bits: decision.bits } },
          now,
        );
      }
      refuse('captchaRequired', challengeOf(core, action, scope, decision.bits, now));
    }
  }
  if (!decision.go) {
    const retryAfterMs = decision.code === 'rateLimited' ? decision.retryAfterMs : core.limits.counterFullRetryMs;
    if (rule === 6) core.log.event('accounts.signIn.untracked', { rule: 6 });
    if (
      attempt.kind === 'signIn' && (rule === 1 || rule === 2 || rule === 3 || rule === 5) &&
      core.audit.once(noiseKey(core, 'throttle', account, ctx.addressKey, now), now, anonymous)
    ) {
      core.audit.record(
        { kind: 'signInThrottled', account: account?.id ?? null, actor: 'self', addressKey: ctx.addressKey, details: { rule, nameTag } },
        now,
      );
    }
    refuse('rateLimited', { retryAfterMs });
  }
  return decision.priority;
}

/** A full hashing queue answers busy with its retryAfterMs (4.1). */
async function hashing<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof HasherBusyError) refuse('busy', { retryAfterMs: e.retryAfterMs, message: 'The server is busy. Please try again in a moment.' });
    throw e;
  }
}

// ---- register ---------------------------------------------------------------------------------------------------------------------------------

function birthField(v: unknown, now: Date): { year: number; month: number } {
  if (typeof v !== 'object' || v === null) refuse('badMessage');
  const { year, month } = v as { year: unknown; month: unknown };
  if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > now.getUTCFullYear()) refuse('badMessage');
  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) refuse('badMessage');
  return { year: year as number, month: month as number };
}

export async function register(core: Core, ctx: RequestContext, req: RegisterRequest): Promise<AccountResult<SignedIn>> {
  if (typeof req !== 'object' || req === null) return fail('badMessage');
  const now = ctx.now;
  const nameRaw = clientText(req.name, ACCOUNT_LIMITS.nameRawMax);
  const password = clientText(req.password, ACCOUNT_LIMITS.passwordRawMax);
  const birth = birthField(req.birth, now);
  const emailRaw = optionalText(req.email, ACCOUNT_LIMITS.emailMax + 64);
  if (typeof req.claimGuest !== 'boolean') return fail('badMessage');
  const captcha = optionalText(req.captcha, ACCOUNT_LIMITS.captchaTokenMax);
  deviceField(req.device);
  if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });

  // the age gate (7.5): only the outcome is kept; a refusal marks this connection and guest session for 24 hours
  const marks = [`c:${ctx.connection}`, ...(ctx.guestSession !== null ? [`g:${ctx.guestSession}`] : [])];
  if (core.ageMarks.marked(marks, now)) return fail('ageGate');
  if (!oldEnough(birth, core.config.minAge, iso(now))) {
    core.ageMarks.mark(marks, now);
    return fail('ageGate');
  }

  // the name (6.1-6.4)
  const checked = checkAccountName(nameRaw);
  if (!checked.ok) return fail('nameInvalid', { details: [checked.problem], message: checked.message });
  const display = checked.display;
  const keys = await keysOf(core, display);
  for (const k of [keys.primary, ...keys.others]) if (reserved(core, k.key, display)) return fail('nameReserved');
  if (!core.nameFilter.check({ display, key: keys.primary.key }).ok) return fail('nameFiltered');

  // the email (3.4): the email part owns verification
  let email: string | null = null;
  if (emailRaw !== undefined && emailRaw.trim() !== '') {
    if (core.mailer.kind === 'none') return fail('emailUnavailable');
    if (core.email === null) return fail('notYet');
    const e = emailProblem(emailRaw);
    if (!e.ok) return fail('emailInvalid', { details: [e.problem] });
    email = e.address;
  }
  const emailLocal = email !== null ? email.slice(0, email.lastIndexOf('@')) : null;
  // the local policy now; a configured breach check only once the limits let the request through (review A11: it asks a third party)
  checkPolicy(core, password, { name: display, key: keys.primary.key, emailLocal });

  // availability (6.5), under both versions during a rekey
  if ((await entriesFor(core, keys)).some((e) => !isFree(e, now))) return fail('nameTaken');

  // the claim (5.5): only the connection's own guest session, and only when ticked
  const claim = req.claimGuest ? ctx.guestSession : null;
  if (req.claimGuest) {
    if (claim === null) return fail('badMessage');
    if (await core.guests.busy(claim)) return fail('busy', { message: BUSY_IN_GAME });
  }

  // the limits: 3 an hour and 10 a day per address key, looked at first, then the registration pressure of 8.1 (work, or shedding with
  // CAPTCHA=none). Review A1 (M14-15): a request past its allowance is refused before any work is checked (a solution checked for a request the
  // allowance then refused stayed in the verifier's spent set), and the allowance's token is taken just before the work is checked, as rule 4
  // takes a recovery attempt's: a solution that fails has spent it, so one address key has solutions checked at most as often as it may register
  const wait = core.rate.wait('register', { addressKey: ctx.addressKey }, now);
  if (wait > 0) return fail('rateLimited', { retryAfterMs: wait });
  const takeAllowance = (): AccountResult<never> | null => {
    const took = core.rate.take('register', { addressKey: ctx.addressKey }, now);
    return took.ok ? null : fail('rateLimited', { retryAfterMs: took.retryAfterMs });
  };
  let taken = false;
  let decision = core.rate.signIn.registration(ctx.addressKey, 0, now);
  if (!decision.go && decision.code === 'captchaRequired') {
    const bits = decision.bits;
    if (captcha === undefined) {
      if (core.audit.once(noiseKey(core, 'regwork', null, ctx.addressKey, now), now, true)) {
        core.audit.record({ kind: 'captchaRequired', account: null, actor: 'self', addressKey: ctx.addressKey, details: { rule: 'register', bits } }, now);
      }
      return fail('captchaRequired', challengeOf(core, 'register', 'register', bits, now));
    }
    const refused = takeAllowance();
    if (refused !== null) return refused;
    taken = true;
    const v = await core.verifier.verify(captcha, { addressKey: ctx.addressKey, action: 'register', scope: 'register', bits }, now);
    if (!v.ok) return fail(v.reason === 'unavailable' ? 'captchaRequired' : 'captchaFailed', challengeOf(core, 'register', 'register', bits, now));
    decision = core.rate.signIn.registration(ctx.addressKey, bits, now);
  }
  if (!decision.go) {
    return decision.code === 'rateLimited' ? fail('rateLimited', { retryAfterMs: decision.retryAfterMs }) : fail('captchaRequired');
  }
  const priority = decision.priority;
  if (!taken) {
    const refused = takeAllowance();
    if (refused !== null) return refused;
  }
  await checkBreached(core, password);

  const id = newAccountId(core.random);
  const nowIso = iso(now);
  const credential = await withSlot(core, ctx.addressKey, keys.primary.key, () => hashing(() => core.local.enroll(id, password, nowIso, { priority })));
  const codes = core.credentials.newRecoveryCodes();
  const device = core.credentials.newDeviceProof();
  const { row: session, token } = newSessionRow(core, id, 'local', ctx, device.hash);
  const account: Account = {
    id, name: display, nameKey: keys.primary.key, keyVersion: keys.primary.version, avatar: defaultAvatar(id), privacy: { ...DEFAULT_PRIVACY },
    email: null, ageGate: { minAge: core.config.minAge, passedAt: nowIso }, createdAt: nowIso, lastSignInAt: nowIso, renamedAt: null,
    freeRename: false, deletion: null, inactiveNoticeAt: null, version: 1,
  };
  const history: NameHistoryRow = {
    account: id, name: display, key: keys.primary.key, keyVersion: keys.primary.version, from: nowIso, to: null, cause: 'register', redacted: false,
  };
  const audit: AuditEvent[] = [
    core.audit.build({ kind: 'registered', account: id, actor: 'self', session: session.id, addressKey: ctx.addressKey, details: { provider: 'local', claimed: claim !== null } }, now),
  ];
  if (claim !== null) {
    // GuestSessions gives no game count (reported); hosted's history counts them at the sync
    audit.push(core.audit.build({ kind: 'guestClaimed', account: id, actor: 'self', session: session.id, addressKey: ctx.addressKey, details: { guestSession: claim, games: 0 } }, now));
  }
  const n: NewAccount = {
    account, credential, recovery: recoveryRows(core, id, codes, 1, now), history,
    claim: claim !== null ? { session: claim, account: id, claimedAt: nowIso } : null, session, device: newDeviceRow(id, device.hash, now), audit,
  };
  try {
    await core.store.createAccount(n, nowIso);
  } catch (e) {
    if ((e as { code?: unknown })?.code !== 'exists') throw e;
    // a registration racing this one won the key, or the guest session was claimed meanwhile
    if (!isFree(await core.store.nameEntry(keys.primary.key, keys.primary.version), now)) return fail('nameTaken');
    if (claim !== null) return fail('alreadyClaimed');
    throw e;
  }
  core.rate.signIn.registered(ctx.addressKey, now);
  if (claim !== null) {
    await core.guests.retire(claim).catch((err: unknown) => core.log.event('accounts.claim.retire', { account: id, error: err instanceof Error ? err.name : 'error' }));
  }
  const auth = { account: id, session: session.id };
  if (email !== null && core.email !== null) {
    // the email part verifies the address; the password was checked just now, so a one-use ticket of this session is the proof. The account exists
    // now: a refusal or a failure of the email part (a store write of its code) is logged and the registration still answers, so its recovery codes
    // and token reach the player; the address can be set again later (review of M14-8)
    try {
      const r = await core.email.setEmail(ctx, auth, email, { ticket: core.guard.issueTicket(auth, now) });
      if (!r.ok) core.log.event('accounts.register.email', { account: id, code: r.error.code });
    } catch (e) {
      core.log.event('accounts.register.email', { account: id, error: e instanceof Error ? e.name : 'error' });
    }
  }
  const created = (await core.store.account(id)) ?? account;
  const view: SelfView = await selfViewOf(core, created, now);
  return ok({ account: view, auth, token, rotation: 0, device: device.proof, recoveryCodes: codes.map(formatRecoveryCode) });
}

// ---- sign in --------------------------------------------------------------------------------------------------------------------------------

export async function signIn(core: Core, ctx: RequestContext, req: PasswordSignIn): Promise<AccountResult<SignedIn>> {
  if (typeof req !== 'object' || req === null) return fail('badMessage');
  const name = clientText(req.name, ACCOUNT_LIMITS.nameRawMax);
  const password = clientText(req.password, ACCOUNT_LIMITS.passwordRawMax);
  const captcha = optionalText(req.captcha, ACCOUNT_LIMITS.captchaTokenMax);
  const deviceProof = deviceField(req.device);
  if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });
  if (deviceProof === undefined) return signInWith(core, ctx, name, password, captcha, undefined);
  // one attempt per device proof at a time: its failures are counted on the row the next attempt reads (8.2 rule 2)
  const lock = `d:${tokenHash(deviceProof)}`;
  if (!core.locks.enter(lock)) return fail('rateLimited', { retryAfterMs: IN_FLIGHT_RETRY_MS });
  try {
    return await signInWith(core, ctx, name, password, captcha, deviceProof);
  } finally {
    core.locks.leave(lock);
  }
}

async function signInWith(
  core: Core, ctx: RequestContext, name: string, password: string, captcha: string | undefined, deviceProof: string | undefined,
): Promise<AccountResult<SignedIn>> {
  const now = ctx.now;
  // a forced rename's old name still reaches its account (review A6)
  const found = await findByName(core, name, now, { bans: true });
  const account = found.account;
  const device = await validDevice(core, deviceProof, account, now);
  const attempt: SignInAttempt = {
    kind: 'signIn', nameKey: found.key, known: found.known, addressKey: ctx.addressKey,
    device: device !== null && account !== null ? { account: account.id, hash: device.hash, failures: device.failures } : null, workBits: 0,
  };
  const priority = await passGuard(core, ctx, attempt, captcha, account);

  // a name without an account reads a dummy id's credentials (review A2): the same store calls for a hidden account and any other name
  const credentials = await core.store.credentials(account?.id ?? DUMMY_ACCOUNT);
  const local = account !== null ? (credentials.find((c) => c.provider === 'local') ?? null) : null;
  const result = await withSlot(core, ctx.addressKey, found.key, () =>
    hashing(async () => {
      // under pressure a free name (no entry in `names`, which registration shows anyway) is answered without the dummy hash (4.1)
      if (!found.known && account === null && core.rate.signIn.pressure()) return { ok: false, rehash: null };
      return core.local.verify(local, password, { priority });
    }),
  );

  if (!result.ok || account === null) {
    core.rate.signIn.after(attempt, false, now);
    if (device !== null) await core.store.updateDevice(device.hash, { failures: device.failures + 1 }).catch(() => undefined);
    // one event a minute per account and address key; for names no account holds, per address key whatever the names, within the minute's
    // budget (review A8), its name tag kept only while every failure of the minute was for one name
    core.audit.countFailure(
      noiseKey(core, 'signIn', account, ctx.addressKey, now),
      {
        kind: 'signInFailed', account: account?.id ?? null, actor: 'self', addressKey: ctx.addressKey,
        details: { count: 1, nameTag: account === null ? core.audit.nameTag(found.key, now) : null },
      },
      now,
      account === null ? () => core.audit.anonymous(now) : undefined,
    );
    return fail('badCredentials');
  }

  core.rate.signIn.after(attempt, true, now);
  const nowIso = iso(now);
  if (local !== null) {
    // the rehash and the credential's last use, by compare-and-set on the string just verified (4.1)
    const next = { ...(result.rehash ?? local), lastUsedAt: nowIso };
    await core.store.putCredential(next, local.secret).catch(() => undefined);
  }
  const status = await statusOf(core, account, now);
  const issued = await issueSession(core, ctx, account, 'local', device !== null && deviceProof !== undefined ? { proof: deviceProof, row: device } : null);
  const updated = (await noteSignIn(core, account.id, now)) ?? account;
  core.audit.record(
    { kind: 'signedIn', account: account.id, actor: 'self', session: issued.row.id, addressKey: ctx.addressKey, details: { provider: 'local', device: device !== null, restricted: status !== 'active' } },
    now,
  );
  return ok({ account: await selfViewOf(core, updated, now), auth: issued.auth, token: issued.token, rotation: 0, device: issued.device });
}

// ---- the recovery-code sign-in (4.4) ----------------------------------------------------------------------------------------------------------------

export async function useRecoveryCode(core: Core, ctx: RequestContext, req: RecoverRequest): Promise<AccountResult<SignedIn>> {
  if (typeof req !== 'object' || req === null) return fail('badMessage');
  const now = ctx.now;
  const name = clientText(req.name, ACCOUNT_LIMITS.nameRawMax);
  const codeRaw = clientText(req.code, ACCOUNT_LIMITS.recoveryRawMax);
  const newPassword = clientText(req.newPassword, ACCOUNT_LIMITS.passwordRawMax);
  const captcha = optionalText(req.captcha, ACCOUNT_LIMITS.captchaTokenMax);
  const deviceProof = deviceField(req.device);
  if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });

  // a forced rename's old name still reaches its account (review A6)
  const found = await findByName(core, name, now, { bans: true });
  const account = found.account;
  const device = await validDevice(core, deviceProof, account, now);
  const attempt: SignInAttempt = {
    kind: 'recover', nameKey: found.key, known: found.known, addressKey: ctx.addressKey,
    device: device !== null && account !== null ? { account: account.id, hash: device.hash, failures: device.failures } : null, workBits: 0,
  };
  // 4.4's order: the fields, the per-address limit, the new password (without anything private), then the code
  const priority = await passGuard(core, ctx, attempt, captcha, account);
  const typedName = checkAccountName(name);
  await checkPassword(core, newPassword, { name: typedName.ok ? typedName.display : name.trim(), key: found.key, emailLocal: null });

  const code = normalizeRecoveryCode(codeRaw);
  const id = account?.id ?? DUMMY_ACCOUNT;
  // a name without an account reads a dummy id's codes (review A2): the same store calls for a hidden account and any other name
  const rows = await core.store.recoveryCodes(id);
  const slots = account !== null ? rows.filter((r) => r.usedAt === null) : [];
  const want = Buffer.from(core.credentials.recoveryCodeHash(id, code ?? '0'.repeat(ACCOUNT_LIMITS.recoveryCodeLength)), 'hex');
  // every unused slot compared with the one injected comparison, no early exit, padded with dummy hashes to the ten of a generation, so the
  // comparisons do not show how many codes are left (7.4) and an unknown name compares as many (4.4, 12.1; review A10, as the email codes do)
  const compared = [
    ...slots.map((s) => ({ slot: s.slot, hash: s.hash, dummy: false })),
    ...dummySlots(id).slice(slots.length).map((s) => ({ ...s, dummy: true })),
  ];
  let match: { slot: number; hash: string } | null = null;
  for (const s of compared) {
    const same = core.credentials.equal(Buffer.from(s.hash, 'hex'), want);
    if (same && !s.dummy && code !== null && account !== null && match === null) match = s;
  }
  if (match === null || account === null) {
    // rule 4 only: a wrong code counts per address key, never on the device proof (8.2)
    core.rate.signIn.after(attempt, false, now);
    // as a failed sign-in's (review A8): per address key for a name no account holds, within the minute's budget
    core.audit.countFailure(
      noiseKey(core, 'recover', account, ctx.addressKey, now),
      { kind: 'recoveryFailed', account: account?.id ?? null, actor: 'self', addressKey: ctx.addressKey, details: { count: 1 } },
      now,
      account === null ? () => core.audit.anonymous(now) : undefined,
    );
    return fail('badCredentials', { message: 'The name or recovery code is not right.' });
  }

  // the email rule, now that the code matched and before it is spent: a weak password burns no code (7.4)
  await checkPassword(core, newPassword, { name: account.name, key: account.nameKey, emailLocal: emailLocalOf(account) });
  const nowIso = iso(now);
  const credential = await withSlot(core, ctx.addressKey, found.key, () => hashing(() => core.local.enroll(account.id, newPassword, nowIso, { priority })));
  if (!(await core.store.spendRecoveryCode(account.id, match.slot, match.hash, nowIso))) {
    // spent by a concurrent use, or the codes were replaced meanwhile
    return fail('badCredentials', { message: 'The name or recovery code is not right.' });
  }
  core.rate.signIn.after(attempt, true, now);
  const old = (await core.store.credentials(account.id)).find((c) => c.provider === 'local');
  await core.store.putCredential(old !== undefined ? { ...credential, createdAt: old.createdAt, lastUsedAt: nowIso } : { ...credential, lastUsedAt: nowIso });
  const removed = await removeRecentEmail(core, account.id, now);
  const status = await statusOf(core, account, now);
  const issued = await issueSession(core, ctx, account, 'local', device !== null && deviceProof !== undefined ? { proof: deviceProof, row: device } : null);
  await core.guard.resetAccess(account.id, 'recovery', issued.row.id, issued.deviceHash, now);
  const updated = (await noteSignIn(core, account.id, now)) ?? account;
  const left = (await core.store.recoveryCodes(account.id)).filter((r) => r.usedAt === null).length;
  core.audit.record({ kind: 'recoveryUsed', account: account.id, actor: 'self', session: issued.row.id, addressKey: ctx.addressKey, details: { left } }, now);
  if (removed !== null) {
    core.audit.record({ kind: 'emailRemoved', account: account.id, actor: 'self', session: issued.row.id, addressKey: ctx.addressKey, details: {} }, now);
    if (removed.verifiedAt !== null) await core.email?.notify(account.id, 'emailRemoved', removed.address).catch(() => undefined);
  }
  core.audit.record({ kind: 'passwordChanged', account: account.id, actor: 'self', session: issued.row.id, addressKey: ctx.addressKey, details: { via: 'recovery' } }, now);
  core.audit.record(
    { kind: 'signedIn', account: account.id, actor: 'self', session: issued.row.id, addressKey: ctx.addressKey, details: { provider: 'local', device: device !== null, restricted: status !== 'active' } },
    now,
  );
  await core.email?.notify(account.id, 'recoveryUsed').catch(() => undefined);
  return ok({
    account: await selfViewOf(core, updated, now), auth: issued.auth, token: issued.token, rotation: 0, device: issued.device, codesLeft: left,
  });
}

/**
 * Removes the account's email address when it was set in the RECENT_EMAIL_MS before `now` (see the header), with its verification and reset codes:
 * the address removed, or null when there was none to remove. The address the registration itself set (at createdAt) is the registrant's own and
 * stays.
 */
async function removeRecentEmail(core: Core, account: Account['id'], now: Date): Promise<NonNullable<Account['email']> | null> {
  const box: { removed: Account['email'] } = { removed: null };
  const r = await core.guard.patch(account, (a) => {
    box.removed = null;
    const setAt = a.email?.setAt;
    if (a.email === null || setAt === undefined || setAt === a.createdAt || now.getTime() - Date.parse(setAt) >= RECENT_EMAIL_MS) return null;
    box.removed = a.email;
    return { email: null };
  });
  if (!r.ok) {
    core.log.event('accounts.recovery.email', { account, code: r.error.code });
    return null;
  }
  if (box.removed === null) return null;
  await core.store.deleteEmailCodes(account, 'verify');
  await core.store.deleteEmailCodes(account, 'reset');
  return box.removed;
}

/** Ten hashes no code matches: the comparisons of an unknown name, and those that pad an account's unused slots to ten (the same work for all). */
function dummySlots(id: string): { slot: number; hash: string }[] {
  return Array.from({ length: ACCOUNT_LIMITS.recoveryCodes }, (_, slot) => ({
    slot, hash: createHash('sha256').update(`openmtg/recovery/dummy\n${id}\n${slot}`, 'utf8').digest('hex'),
  }));
}
