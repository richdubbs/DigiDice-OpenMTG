/**
 * M14-8: the email part (design 3.4, 11.3 EmailPart): setEmail, verifyEmail, requestEmailReset, useEmailReset, the security notices and the mail
 * files' tick. It runs on PartDeps (the store, the configuration, the audit writer, the rate limits, the mail queue, the log, the random source and
 * the core's guard) and the members M14-8 added to it: the mailer (PartDeps.mailer; without it MAILER is read from the configuration), the core's
 * sign-in steps (PartDeps.signIn; without them requestEmailReset and useEmailReset answer notYet) and the core's one secret comparison
 * (PartDeps.equal, CredentialTools.equal, for every code; without it node:crypto's timingSafeEqual).
 *
 * - **setEmail** (set, change or remove), in order: the session (3.8: allowed while suspended or banned, not while deleting); the address (the text
 *   rules: badMessage; the grammar of ../api/email.ts: emailInvalid with the problem); emailUnavailable with NoMailer, for an address to set only
 *   (removing one always works); the proof (5.2, on every call: reauthRequired, badCredentials); then, when a verification mail is to go (a new
 *   address, or the unverified one again), the verification limits: 3 a day per account and 3 a day per target address (limitReached). They are
 *   taken after the proof, so that a wrong password spends none of the owner's allowance (and no one's inbox allowance). A new address replaces the
 *   old one unverified and voids every verification and reset code (they were bound to the old address); it gets a code by mail, and the old
 *   address, if it was verified, the emailChanged notice. A removal sends emailRemoved to the old address if it was verified. The same verified
 *   address again changes nothing.
 * - **verifyEmail**: the session; the code (badMessage beyond the text rules); the try per address key (see Codes); emailCodeInvalid for every
 *   other failure; the account's live verification codes for its current address; the code used by compare-and-set and the address marked verified
 *   if it is still the same; the other verification codes voided; emailVerified audited.
 * - **Codes** (./codes.ts): emailCodeMs (15 minutes), one use, at most emailResetLiveCodes live per account and purpose (the store's cap), stored
 *   hashed under the newest pepper when PASSWORD_PEPPERS is set and compared under every configured one. Tries are counted in memory, in the rate
 *   limiter, in two steps (8.1). First per address key, emailCodeFailuresPerHour (10) an hour with the IPv6 /56 and /48 aggregates
 *   (emailCodeFailure), one for every verifyEmail and useEmailReset try that gets past its fields, whatever the name or the code (rateLimited, alike
 *   for every name); so a code's tries from fresh address keys are bounded before any counter of a code is made. Then per (code, address key),
 *   emailCodeTriesPerAddress (5) each, again with the /56 and /48 aggregates (emailCodeTry): each live code gives one try for the address key, and a
 *   code whose tries from there are spent is not compared there. Those counters are forgotten when their code expires (`until`), and their map fails
 *   open: a counter it has no room for is not made and the code is compared, since the try already counted per address key (src/abuse/limiter.ts). So
 *   wrong codes from one place never void or slow a code for anyone else, not even by filling the map, and a code dies only when it is used or
 *   expires.
 * - **requestEmailReset**: the name's text rules and the device proof's shape (badMessage); emailUnavailable with NoMailer; the per-address limit
 *   (3 an hour: rateLimited, alike for every name); then the answer, ok for every name. Everything else runs after the answer, on a later turn of
 *   the event loop: the account by the name's key; for one with a verified address the day's allowance (3 a day: the account's, or, for a request
 *   that carries a valid device proof of the account, that proof's own: review A4, M14-15) and the store's cap of live reset codes, then a new code
 *   and its mail; and emailResetRequested { sent } (a sent: false event at most once a minute per account). So neither the answer nor its timing
 *   shows whether the name exists, has a verified address or was mailed; a new request never voids a live code, and the caps stop new mails, never
 *   a code already sent: an attacker who spends the account's requests by its public name only sends codes to the owner's own inbox, and the
 *   owner, asking from a browser that signed in before (its device proof is kept after a sign-out, 8.3), still gets one.
 * - **useEmailReset** (3.4; the order M14-1 refined for useRecoveryCode and this method): the fields; busy; the try per address key (see Codes);
 *   the new password against the policy WITHOUT the email (the request's name and its key: the same answer for every account); the code against the
 *   account's live reset codes, over a fixed number of slots (an unknown name, or one without a verified address, compares as many dummy hashes);
 *   the email rule once the code matched, so a weak password spends no code and nobody without a valid code learns anything of the address (design
 *   17's F7 case); the new hash; the code used by compare-and-set; the new password set; the other reset codes voided; a new generation of recovery
 *   codes, given once in the answer (SignedIn.recoveryCodes, as registration gives them: review A5, M14-15, so codes an attacker made with a
 *   stolen password die with the reset); a session, with every other session revoked and every device proof but the one sent deleted
 *   (PartSignIn.signIn, 'emailReset'); emailResetUsed, passwordChanged, recoveryCodesRenewed and signedIn audited; the emailResetUsed notice.
 * - **notify** (the core's notices and this part's): queued, only to the account's verified address. `to` is honoured only for emailChanged and
 *   emailRemoved, whose notice goes to the old address (this part passes one only when it was verified). Never throws.
 * - **tick**: the mailer's expired files (FileMailer: a code's at its expiry, a notice's after noticeFileMs) and every file of an account that no
 *   longer exists (its erasure, 10.2).
 * - **Logs and audit** (8.5, 12.1): no address, code, password or typed name in any log line or audit detail: log lines carry ids, codes and kinds.
 */
import { ACCOUNT_LIMITS, isAccountToken, type Account, type AccountError, type AccountId, type AccountResult, type SelfView } from '../api';
import { EMAIL_RAW_MAX, emailProblem } from '../api/email';
import { checkAccountName } from '../api/names';
import { newEmailCodeId } from '../ids';
import type { EmailCodeRow } from '../store/api';
import { hostedTextProblem } from '../text';
import { selfView } from '../views';
import type { Auth, EmailPart, EmailResetUse, PartDeps, PartSignIn, Proof, RequestContext, SignedIn } from '../service/api';
import { BUSY_IN_GAME, fail, ok } from '../service/result';
import type { NoticeKind } from './api';
import {
  EMAIL_CODE_RAW_MAX, emailCodeHash, emailCodeKeys, emailLocalPart, emailTargetKey, matchEmailCode, newEmailCode, normalizeEmailCode,
} from './codes';
import { hasMailFiles } from './mailers';
import { noticeMail, resetMail, verifyMail } from './messages';
import type { BuiltMailQueue } from './queue';

/** The account an unknown name's reset is compared under (no store row has it). */
const DUMMY_ACCOUNT: AccountId = 'acc_00000000000000000000000000';
/** Reset requests waiting to do their work after the answer, at most (beyond it a request is answered and dropped, and logged). */
const LATER_MAX = 1_000;
/** emailResetRequested events with sent: false, at most one per account per minute (8.5's bound on noisy events). */
const QUIET_MS = 60_000;
const QUIET_MAX = 10_000;

/** The part as its factory builds it: EmailPart, and how to wait for the work that runs after an answer. */
export interface BuiltEmailPart extends EmailPart {
  /** Resolves once the reset requests answered so far have done their work, and the mail queue has sent everything. */
  idle(): Promise<void>;
}

const iso = (d: Date): string => d.toISOString();
const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

/** A refused account patch (ServiceGuard.patch): 'conflict' as it is; an account gone meanwhile is the session's end (no notFound in these rows). */
function gone(r: { ok: false; error: AccountError }): { ok: false; error: AccountError } {
  return r.error.code === 'notFound' ? fail('sessionExpired') : r;
}

/** A string a client sent, under m13's text rules and a bound in UTF-16 units; null otherwise. */
function textField(v: unknown, maxUnits: number): string | null {
  return typeof v === 'string' && v.length <= maxUnits && hostedTextProblem(v) === null ? v : null;
}

export function buildEmailPart(deps: PartDeps): BuiltEmailPart {
  const { store, config, audit, limits, mail, log, random, guard, equal } = deps;
  const timing = config.timing;
  /** Codes compared on every try: the store's cap of live codes, so the work does not show how many are live. */
  const slots = Math.max(1, config.limits.emailResetLiveCodes);
  /** The keys of the configured peppers, newest first (a new code's hash uses the first; a try is compared under each): ./codes.ts. */
  const codeKeys = emailCodeKeys(config.peppers);
  const later = new Set<Promise<void>>();
  const quiet = new Map<AccountId, number>();

  const emailOn = (): boolean => (deps.mailer?.kind ?? config.mailer) !== 'none';

  /** What the account itself sees (src/views.ts), from its rows at `now`. */
  async function viewOf(a: Account, now: Date): Promise<SelfView> {
    const [credentials, recoveryCodes, rows] = await Promise.all([store.credentials(a.id), store.recoveryCodes(a.id), store.sanctionsOf(a.id)]);
    const appeals = rows.length > 0 ? await store.appeals({ account: a.id, limit: 10_000 }) : [];
    const by = new Map(appeals.map((x) => [x.sanction, x]));
    return selfView(a, {
      now: iso(now), credentials, recoveryCodes, sanctions: rows.map((row) => ({ row, appeal: by.get(row.id) ?? null })),
      renameCooldownMs: timing.renameCooldownMs,
    });
  }

  /** A new code of `purpose` for `account`, bound to `address`, and its row (not yet stored). */
  function newCode(account: AccountId, purpose: EmailCodeRow['purpose'], address: string, now: Date): { code: string; row: EmailCodeRow } {
    const code = newEmailCode(random);
    return {
      code,
      row: {
        id: newEmailCodeId(now, random), account, purpose, hash: emailCodeHash(purpose, account, address, code, codeKeys[0] ?? null),
        createdAt: iso(now), expiresAt: iso(new Date(now.getTime() + timing.emailCodeMs)), usedAt: null,
      },
    };
  }

  /** A typed code's hash under every key a live code may have been made under (one without peppers). */
  function wantsOf(purpose: EmailCodeRow['purpose'], account: AccountId, address: string, typed: string): string[] {
    if (codeKeys.length === 0) return [emailCodeHash(purpose, account, address, typed)];
    return codeKeys.map((k) => emailCodeHash(purpose, account, address, typed, k));
  }

  /** Stores a code: false when the account already has its cap of live codes of that purpose. */
  async function putCode(row: EmailCodeRow, now: Date): Promise<boolean> {
    try {
      await store.putEmailCode(row, iso(now));
      return true;
    } catch (e) {
      if ((e as { code?: unknown })?.code === 'conflict') return false;
      throw e;
    }
  }

  /** A try of an email code, counted per address key before anything else of it (see the header): the refusal to answer, or null. */
  function tryRefused(ctx: RequestContext): AccountResult<never> | null {
    const took = limits.take('emailCodeFailure', { addressKey: ctx.addressKey }, ctx.now);
    return took.ok ? null : fail('rateLimited', { retryAfterMs: took.retryAfterMs });
  }

  /**
   * The live codes this try may be compared with: one try taken from each for the request's address key (its counters forgotten when the code
   * expires), and those with none left dropped.
   */
  function triable(ctx: RequestContext, live: readonly EmailCodeRow[]): EmailCodeRow[] {
    const out: EmailCodeRow[] = [];
    for (const c of live) {
      if (limits.take('emailCodeTry', { other: c.id, addressKey: ctx.addressKey, until: new Date(c.expiresAt) }, ctx.now).ok) out.push(c);
    }
    return out;
  }

  /** Whether a quiet event of the account may be written now (at most one a minute). */
  function onceAMinute(account: AccountId, now: Date): boolean {
    const t = now.getTime();
    const last = quiet.get(account);
    if (last !== undefined && t - last < QUIET_MS) return false;
    if (quiet.size >= QUIET_MAX) quiet.clear();
    quiet.set(account, t);
    return true;
  }

  /** Runs `f` on a later turn of the event loop, after the answer has gone; a failure is logged by its error's name. */
  function afterAnswer(step: string, f: () => Promise<void>): void {
    if (later.size >= LATER_MAX) {
      log.event('accounts.email.dropped', { step });
      return;
    }
    const p: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(f)
      .catch((e: unknown) => log.event('accounts.email.failed', { step, error: errorName(e) }))
      .finally(() => {
        later.delete(p);
      });
    later.add(p);
  }

  async function notify(account: AccountId, kind: NoticeKind, to?: string): Promise<void> {
    try {
      if (!emailOn()) return;
      const a = await store.account(account);
      if (a === null) return;
      const old = (kind === 'emailChanged' || kind === 'emailRemoved') && typeof to === 'string' ? to : null;
      const address = old ?? (a.email !== null && a.email.verifiedAt !== null ? a.email.address : null);
      if (address === null) return;
      mail.enqueue(address, noticeMail(kind, a.name, timing), { account: a.id, kind: 'notice', expiresAt: null });
    } catch (e) {
      log.event('accounts.email.notice', { account, kind, error: errorName(e) });
    }
  }

  async function setEmail(ctx: RequestContext, auth: Auth, address: string | null, proof: Proof): Promise<AccountResult<SelfView>> {
    const s = await guard.session(ctx, auth, 'setEmail');
    if (!s.ok) return s;
    const now = ctx.now;
    let next: string | null = null;
    if (address !== null) {
      if (textField(address, EMAIL_RAW_MAX) === null) return fail('badMessage');
      if (!emailOn()) return fail('emailUnavailable');
      const e = emailProblem(address);
      if (!e.ok) return fail('emailInvalid', { details: [e.problem] });
      next = e.address;
    }
    const p = await guard.proof(ctx, auth, proof, 'email');
    if (!p.ok) return p;
    const a = await store.account(auth.account);
    if (a === null) return fail('sessionExpired');

    if (next === null) {
      // removing: the old address's codes go with it, and it gets the notice if it was verified
      const box: { old: Account['email'] } = { old: null };
      const r = await guard.patch(a.id, (x) => {
        box.old = x.email;
        return x.email === null ? null : { email: null };
      });
      if (!r.ok) return gone(r);
      const old = box.old;
      if (old !== null) {
        await store.deleteEmailCodes(a.id, 'verify');
        await store.deleteEmailCodes(a.id, 'reset');
        audit.record({ kind: 'emailRemoved', account: a.id, actor: 'self', session: auth.session, addressKey: ctx.addressKey, details: {} }, now);
        if (old.verifiedAt !== null) await notify(a.id, 'emailRemoved', old.address);
      }
      return ok(await viewOf(r.value, now));
    }

    const target = next;
    if (a.email !== null && a.email.address === target && a.email.verifiedAt !== null) return ok(await viewOf(a, now));
    // a verification mail is to go: the limits, after the proof (see the header)
    const byAccount = limits.take('verifyMail', { account: a.id }, now);
    if (!byAccount.ok) return fail('limitReached', { retryAfterMs: byAccount.retryAfterMs });
    const byTarget = limits.take('verifyMailAddress', { other: emailTargetKey(target) }, now);
    if (!byTarget.ok) return fail('limitReached', { retryAfterMs: byTarget.retryAfterMs });
    const box: { old: Account['email']; changed: boolean; verified: boolean } = { old: null, changed: false, verified: false };
    const r = await guard.patch(a.id, (x) => {
      box.old = x.email;
      box.changed = x.email === null || x.email.address !== target;
      box.verified = !box.changed && x.email !== null && x.email.verifiedAt !== null;
      // when it was set (review A5: a recovery-code sign-in removes an address set in the 30 days before it)
      return box.changed ? { email: { address: target, verifiedAt: null, setAt: iso(now) } } : null;
    });
    if (!r.ok) return gone(r);
    // verified meanwhile (another request): nothing to send
    if (box.verified) return ok(await viewOf(r.value, now));
    if (box.changed) {
      await store.deleteEmailCodes(a.id, 'verify');
      await store.deleteEmailCodes(a.id, 'reset');
    }
    const { code, row } = newCode(a.id, 'verify', target, now);
    // the unverified address again, with its cap of live codes already out
    if (!(await putCode(row, now))) return fail('limitReached');
    mail.enqueue(target, verifyMail(code, timing), { account: a.id, kind: 'verify', expiresAt: row.expiresAt });
    audit.record({ kind: 'emailSet', account: a.id, actor: 'self', session: auth.session, addressKey: ctx.addressKey, details: {} }, now);
    const old = box.old;
    if (box.changed && old !== null && old.verifiedAt !== null) await notify(a.id, 'emailChanged', old.address);
    return ok(await viewOf(r.value, now));
  }

  async function verifyEmail(ctx: RequestContext, auth: Auth, code: string): Promise<AccountResult<SelfView>> {
    const s = await guard.session(ctx, auth, 'verifyEmail');
    if (!s.ok) return s;
    const raw = textField(code, EMAIL_CODE_RAW_MAX);
    if (raw === null) return fail('badMessage');
    const refused = tryRefused(ctx);
    if (refused !== null) return refused;
    const now = ctx.now;
    const a = s.value.account;
    const typed = normalizeEmailCode(raw);
    if (typed === null || a.email === null || a.email.verifiedAt !== null) return fail('emailCodeInvalid');
    const address = a.email.address;
    const live = await store.liveEmailCodes(a.id, 'verify', iso(now));
    const hit = matchEmailCode(triable(ctx, live), wantsOf('verify', a.id, address, typed), slots, equal);
    if (hit === null || !(await store.useEmailCode(hit.id, iso(now)))) return fail('emailCodeInvalid');
    const box = { same: false };
    const r = await guard.patch(a.id, (x) => {
      box.same = x.email !== null && x.email.address === address;
      return box.same && x.email!.verifiedAt === null ? { email: { ...x.email!, verifiedAt: iso(now) } } : null;
    });
    if (!r.ok) return gone(r);
    // the address changed while the code was checked: the code was for the old one
    if (!box.same) return fail('emailCodeInvalid');
    await store.deleteEmailCodes(a.id, 'verify');
    audit.record({ kind: 'emailVerified', account: a.id, actor: 'self', session: auth.session, addressKey: ctx.addressKey, details: {} }, now);
    return ok(await viewOf(r.value, now));
  }

  /** A reset request's work after the answer (see the header). */
  async function resetRequested(now: Date, addressKey: string, name: string, device: string | undefined, signIn: PartSignIn): Promise<void> {
    const { account } = await signIn.findByName(name, now);
    if (account === null) return;
    const email = account.email;
    let sent = false;
    // at most 3 requests a day per account, or per valid device proof of it (review A4), and the store's cap of live codes: each stops new mails,
    // never a code already sent (3.4)
    const allowed = async (): Promise<boolean> => {
      const proof = device !== undefined ? await signIn.validDevice(device, account, now) : null;
      return (proof !== null ? limits.take('emailResetDevice', { other: proof }, now) : limits.take('emailResetRequest', { account: account.id }, now)).ok;
    };
    if (email !== null && email.verifiedAt !== null && (await allowed())) {
      const { code, row } = newCode(account.id, 'reset', email.address, now);
      if (await putCode(row, now)) {
        mail.enqueue(email.address, resetMail(account.name, code, timing), { account: account.id, kind: 'reset', expiresAt: row.expiresAt });
        sent = true;
      }
    }
    if (sent || onceAMinute(account.id, now)) {
      audit.record({ kind: 'emailResetRequested', account: account.id, actor: 'self', addressKey, details: { sent } }, now);
    }
  }

  async function requestEmailReset(ctx: RequestContext, name: string, device?: string): Promise<AccountResult<void>> {
    const typed = textField(name, ACCOUNT_LIMITS.nameRawMax);
    if (typed === null) return fail('badMessage');
    if (device !== undefined && !isAccountToken(device)) return fail('badMessage');
    if (!emailOn()) return fail('emailUnavailable');
    const signIn = deps.signIn;
    if (signIn === undefined) return fail('notYet');
    // per address key, alike for every name (8.1)
    const took = limits.take('emailResetRequest', { addressKey: ctx.addressKey }, ctx.now);
    if (!took.ok) return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
    const now = ctx.now;
    const addressKey = ctx.addressKey;
    afterAnswer('reset', () => resetRequested(now, addressKey, typed, device, signIn));
    return ok(undefined);
  }

  async function useEmailReset(ctx: RequestContext, req: EmailResetUse): Promise<AccountResult<SignedIn>> {
    if (typeof req !== 'object' || req === null) return fail('badMessage');
    const name = textField(req.name, ACCOUNT_LIMITS.nameRawMax);
    const codeRaw = textField(req.code, EMAIL_CODE_RAW_MAX);
    const newPassword = textField(req.newPassword, ACCOUNT_LIMITS.passwordRawMax);
    if (name === null || codeRaw === null || newPassword === null) return fail('badMessage');
    const device = req.device;
    if (device !== undefined && !isAccountToken(device)) return fail('badMessage');
    if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });
    const signIn = deps.signIn;
    if (signIn === undefined) return fail('notYet');
    // per address key, alike for every name and code, before the lookup and before any counter of a code (8.1)
    const refused = tryRefused(ctx);
    if (refused !== null) return refused;
    const now = ctx.now;
    const nowIso = iso(now);

    const found = await signIn.findByName(name, now);
    // the new password first, without anything private: the request's name and its key (the same answer for every account)
    const typedName = checkAccountName(name);
    const weak = await signIn.passwordProblem(newPassword, { name: typedName.ok ? typedName.display : name.trim(), key: found.key, emailLocal: null });
    if (weak !== null) return fail('passwordWeak', { details: [weak] });

    // the code, against the live reset codes of the account's verified address; an unknown name compares as many dummy slots
    const account = found.account;
    const address = account !== null && account.email !== null && account.email.verifiedAt !== null ? account.email.address : null;
    const owner = account !== null && address !== null ? account : null;
    const typed = normalizeEmailCode(codeRaw);
    const live = await store.liveEmailCodes(owner?.id ?? DUMMY_ACCOUNT, 'reset', nowIso);
    const wants = wantsOf('reset', owner?.id ?? DUMMY_ACCOUNT, address ?? '', typed ?? '');
    const hit = matchEmailCode(owner !== null && typed !== null ? triable(ctx, live) : [], wants, slots, equal);
    if (hit === null || owner === null || address === null) return fail('emailCodeInvalid');

    // the email rule, now that the code matched and before it is used: a weak password spends no code (7.4)
    const weakNow = await signIn.passwordProblem(newPassword, { name: owner.name, key: owner.nameKey, emailLocal: emailLocalPart(address) });
    if (weakNow !== null) return fail('passwordWeak', { details: [weakNow] });
    const credential = await signIn.enroll(ctx, owner, newPassword);
    // used once, by compare-and-set (a concurrent use, or its expiry meanwhile, wins)
    if (!(await store.useEmailCode(hit.id, nowIso))) return fail('emailCodeInvalid');
    const old = (await store.credentials(owner.id)).find((c) => c.provider === 'local');
    await store.putCredential(old !== undefined ? { ...credential, createdAt: old.createdAt, lastUsedAt: nowIso } : { ...credential, lastUsedAt: nowIso });
    // the password is reset: the account's other reset codes are of no more use
    await store.deleteEmailCodes(owner.id, 'reset');
    // and the recovery codes are made anew (see the header), before the sign-in so its view counts the new ones
    const recoveryCodes = await signIn.newRecoveryCodes(owner, now);
    const signed = await signIn.signIn(ctx, owner, device, 'emailReset');
    const session = signed.auth.session;
    audit.record({ kind: 'emailResetUsed', account: owner.id, actor: 'self', session, addressKey: ctx.addressKey, details: {} }, now);
    audit.record({ kind: 'passwordChanged', account: owner.id, actor: 'self', session, addressKey: ctx.addressKey, details: { via: 'emailReset' } }, now);
    audit.record({ kind: 'recoveryCodesRenewed', account: owner.id, actor: 'self', session, addressKey: ctx.addressKey, details: {} }, now);
    audit.record(
      {
        kind: 'signedIn', account: owner.id, actor: 'self', session, addressKey: ctx.addressKey,
        details: { provider: 'local', device: device !== undefined && signed.device === device, restricted: signed.account.restricted },
      },
      now,
    );
    await notify(owner.id, 'emailResetUsed');
    return ok({ ...signed, recoveryCodes });
  }

  async function tick(now: Date): Promise<{ mailFilesRemoved: number }> {
    const m = deps.mailer;
    if (m === undefined || typeof m.forget !== 'function') return { mailFilesRemoved: 0 };
    let removed = await m.forget(null, now);
    // every file of an account that no longer exists: its erasure (10.2), whoever erased it
    if (hasMailFiles(m)) {
      for (const id of await m.filedAccounts()) if ((await store.account(id)) === null) removed += await m.forget(id, now);
    }
    return { mailFilesRemoved: removed };
  }

  return {
    setEmail,
    verifyEmail,
    requestEmailReset,
    useEmailReset,
    notify,
    tick,
    async idle() {
      while (later.size > 0) await Promise.all([...later]);
      const q = mail as Partial<BuiltMailQueue>;
      if (typeof q.idle === 'function') await q.idle();
    },
  };
}
