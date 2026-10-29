/**
 * M14-5: account sessions and device proofs (design 5.1, 5.2, 8.3): issuing them at a sign-in, `resume` with rotation, its grace and reuse,
 * sign-out, the sessions list, revocation, the password change and new recovery codes.
 *
 * - A session is issued with a fresh token (32 random bytes, only its SHA-256 stored), rotation 0, expiresAt = now + sessionMaxMs. A 21st live
 *   session revokes the one used least recently (`lastUsedAt`, reason 'tooMany').
 * - A device proof is the one the attempt sent when it is valid for the account, else a new one; at most devicesMax valid per account, the least
 *   recently used dropped. The cap reads the account's proofs in one call (AccountStore.devicesOf). A dropped (or, after deviceFailures failures,
 *   deleted) proof is marked spent by setting its failures to deviceFailures rather than deleted (the store deletes proofs only all at once,
 *   deleteDevices): no attempt treats it as valid again, and retention purges it after deviceIdleMs. ServiceGuard and revokeSession read one session
 *   by its id (AccountStore.sessionById); only the sessions list and the session cap read all of the account's rows (sessionsOf).
 * - `resume` (a token from `hello`): the current token older than rotateAfterMs is rotated (rotateSession: previous = the hash that was current,
 *   rotatedAt = now, the counter + 1). The previous token within rotateGraceMs of the rotation re-rotates (rerotateInGrace: a fresh current token
 *   with the next counter, previous and rotatedAt unchanged, so the grace never grows); after the grace it is reuse: the session is revoked, the
 *   event audited (sessionReuse), and both holders must sign in again. An intermediate token that is no longer current is simply unknown.
 */
import {
  ACCOUNT_LIMITS, isAccountToken, type Account, type AccountId, type AccountResult, type ProviderId, type SessionView,
} from '../api';
import { formatRecoveryCode } from '../api/passwords';
import { newSessionId, newToken, SESSION_ID, tokenHash } from '../ids';
import { sessionView } from '../views';
import type { AccountSessionRow, DeviceRow, RecoveryCodeRow } from '../store/api';
import type { Auth, Proof, RequestContext, Resumed } from './api';
import { clientText, iso, selfViewOf, withSlot, type Core } from './context';
import { fail, ok, refuse, unwrap } from './result';

/**
 * A device proof the attempt sent, when it is valid for `account` (8.3): known, the account's, not spent, used within deviceIdleMs. A proof sent
 * with a name that has no account is read all the same (review A2: the same store calls for every name).
 */
export async function validDevice(core: Core, proof: string | undefined, account: Account | null, now: Date): Promise<DeviceRow | null> {
  if (proof === undefined) return null;
  const d = await core.store.device(tokenHash(proof));
  if (account === null || d === null || d.account !== account.id || d.failures >= core.limits.deviceFailures) return null;
  if (Date.parse(d.lastUsedAt) + core.timing.deviceIdleMs <= now.getTime()) return null;
  return d;
}

/** The checked `device` field of a request: undefined, or a token of ACCOUNT_TOKEN's shape (else badMessage). */
export function deviceField(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (!isAccountToken(v)) refuse('badMessage');
  return v;
}

/** A new session row (not yet stored) and its token. */
export function newSessionRow(core: Core, account: AccountId, provider: ProviderId, ctx: RequestContext, device: string | null): { row: AccountSessionRow; token: string } {
  const now = iso(ctx.now);
  const token = newToken(core.random);
  const row: AccountSessionRow = {
    id: newSessionId(ctx.now, core.random), account, provider, client: ctx.client, createdAt: now, lastUsedAt: now, authAt: now, rotatedAt: now,
    expiresAt: new Date(ctx.now.getTime() + core.timing.sessionMaxMs).toISOString(), revokedAt: null, revokeReason: null,
    tokenHash: tokenHash(token), previousHash: null, rotation: 0, device, proofFailures: 0,
  };
  return { row, token };
}

/** A device row for a new proof. */
export function newDeviceRow(account: AccountId, hash: string, now: Date): DeviceRow {
  return { hash, account, createdAt: iso(now), lastUsedAt: iso(now), failures: 0 };
}

/** Marks a device proof spent (see the header: the store deletes proofs only all at once). */
export async function spendDevice(core: Core, hash: string): Promise<void> {
  await core.store.updateDevice(hash, { failures: core.limits.deviceFailures }).catch(() => undefined);
}

/** The cap of 20 live sessions (5.2): the least recently used beyond it are revoked ('tooMany'). */
export async function capSessions(core: Core, account: AccountId, keep: string, now: Date): Promise<void> {
  const rows = (await core.store.sessionsOf(account)).filter((r) => core.guard.live(r, now));
  const over = rows.length - ACCOUNT_LIMITS.sessionsMax;
  if (over <= 0) return;
  const victims = rows
    .filter((r) => r.id !== keep)
    .sort((a, b) => Date.parse(a.lastUsedAt) - Date.parse(b.lastUsedAt) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : 1))
    .slice(0, over);
  for (const v of victims) {
    await core.store.revokeSession(account, v.id, 'tooMany', iso(now));
    await core.changes({ at: iso(now), account, kind: 'sessionRevoked', session: v.id });
    core.audit.record({ kind: 'sessionRevoked', account, actor: 'system', session: v.id, details: { reason: 'tooMany' } }, now);
  }
}

/** The cap of 10 valid device proofs (8.3): the least recently used beyond it, but the one just used (`keep`), are spent. */
export async function capDevices(core: Core, account: AccountId, keep: string, now: Date): Promise<void> {
  const t = now.getTime();
  const valid = (await core.store.devicesOf(account)).filter(
    (d) => d.failures < core.limits.deviceFailures && Date.parse(d.lastUsedAt) + core.timing.deviceIdleMs > t,
  );
  const over = valid.length - ACCOUNT_LIMITS.devicesMax;
  if (over <= 0) return;
  valid.sort((a, b) => Date.parse(a.lastUsedAt) - Date.parse(b.lastUsedAt));
  for (const d of valid.filter((r) => r.hash !== keep).slice(0, over)) await spendDevice(core, d.hash);
}

/**
 * Issues a session for a sign-in (password, recovery code, email reset, provider): the device proof (the valid one sent, else a new one), the
 * session row, the caps. Returns what SignedIn carries.
 */
export async function issueSession(
  core: Core, ctx: RequestContext, account: Account, provider: ProviderId, sent: { proof: string; row: DeviceRow } | null,
): Promise<{ auth: Auth; token: string; device: string; deviceHash: string; row: AccountSessionRow }> {
  let device: string;
  let deviceHash: string;
  if (sent !== null) {
    device = sent.proof;
    deviceHash = sent.row.hash;
    await core.store.updateDevice(deviceHash, { lastUsedAt: iso(ctx.now), failures: 0 });
  } else {
    const d = core.credentials.newDeviceProof();
    device = d.proof;
    deviceHash = d.hash;
    await core.store.putDevice(newDeviceRow(account.id, d.hash, ctx.now));
  }
  const { row, token } = newSessionRow(core, account.id, provider, ctx, deviceHash);
  await core.store.putSession(row);
  await capSessions(core, account.id, row.id, ctx.now);
  await capDevices(core, account.id, deviceHash, ctx.now);
  return { auth: { account: account.id, session: row.id }, token, device, deviceHash, row };
}

/** Records the sign-in on the account (lastSignInAt; a sign-in clears the inactivity notice, 10.3). A patch that keeps conflicting is logged, never a refusal. */
export async function noteSignIn(core: Core, account: AccountId, now: Date): Promise<Account | null> {
  const r = await core.guard.patch(account, () => ({ lastSignInAt: iso(now), inactiveNoticeAt: null }));
  if (!r.ok) {
    core.log.event('accounts.signIn.lastSignInAt', { account, code: r.error.code });
    return core.store.account(account);
  }
  return r.value;
}

// ---- resume (5.2) -------------------------------------------------------------------------------------------------------------------------------

export async function resume(core: Core, ctx: RequestContext, token: string): Promise<AccountResult<Resumed>> {
  if (!isAccountToken(token)) return fail('badMessage');
  const now = ctx.now;
  const nowIso = iso(now);
  const hash = tokenHash(token);
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = await core.store.sessionByTokenHash(hash);
    if (found === null) return fail('sessionExpired');
    const { row, match } = found;
    if (row.revokedAt !== null) return fail('sessionRevoked');
    if (!core.guard.live(row, now)) {
      await core.store.revokeSession(row.account, row.id, 'expired', nowIso);
      return fail('sessionExpired');
    }
    const account = await core.store.account(row.account);
    if (account === null) return fail('sessionExpired');
    let next: { token: string; rotation: number } | null = null;
    if (match === 'previous') {
      if (now.getTime() - Date.parse(row.rotatedAt) > core.timing.rotateGraceMs) {
        // reuse: someone holds a copy of the token (5.2)
        await core.store.revokeSession(row.account, row.id, 'reuse', nowIso);
        await core.changes({ at: nowIso, account: row.account, kind: 'sessionRevoked', session: row.id });
        core.audit.record({ kind: 'sessionReuse', account: row.account, actor: 'system', session: row.id, addressKey: ctx.addressKey, details: {} }, now);
        return fail('sessionRevoked');
      }
      const fresh = newToken(core.random);
      const rotation = await core.store.rerotateInGrace(row.id, hash, tokenHash(fresh));
      if (rotation === null) continue;
      next = { token: fresh, rotation };
    } else if (now.getTime() - Date.parse(row.rotatedAt) >= core.timing.rotateAfterMs) {
      const fresh = newToken(core.random);
      const rotation = await core.store.rotateSession(row.id, hash, tokenHash(fresh), nowIso);
      // another tab rotated it first: read again (this token is now the previous one, inside the grace)
      if (rotation === null) continue;
      next = { token: fresh, rotation };
    }
    await core.store.updateSession(row.id, { lastUsedAt: nowIso });
    const view = await selfViewOf(core, account, now);
    const out: Resumed = { account: view, auth: { account: account.id, session: row.id } };
    if (next !== null) {
      out.token = next.token;
      out.rotation = next.rotation;
    }
    return ok(out);
  }
  return fail('sessionExpired');
}

// ---- sign-out, the sessions list, revocation (5.2) ---------------------------------------------------------------------------------------------

export async function signOut(core: Core, ctx: RequestContext, auth: Auth, everywhere: boolean): Promise<AccountResult<void>> {
  if (typeof everywhere !== 'boolean') return fail('badMessage');
  const s = unwrap(await core.guard.session(ctx, auth, 'signOut'));
  const nowIso = iso(ctx.now);
  if (everywhere) {
    const revoked = await core.store.revokeSessions(auth.account, 'signOutEverywhere', nowIso);
    if (revoked.length > 0) await core.changes({ at: nowIso, account: auth.account, kind: 'sessionsRevoked' });
  } else {
    await core.store.revokeSession(auth.account, s.row.id, 'signOut', nowIso);
    await core.changes({ at: nowIso, account: auth.account, kind: 'sessionRevoked', session: s.row.id });
  }
  core.audit.record({ kind: 'signedOut', account: auth.account, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { everywhere } }, ctx.now);
  return ok(undefined);
}

export async function sessions(core: Core, ctx: RequestContext, auth: Auth): Promise<AccountResult<SessionView[]>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'sessions'));
  const rows = (await core.store.sessionsOf(auth.account)).filter((r) => core.guard.live(r, ctx.now));
  rows.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  return ok(rows.map((r) => sessionView(r, r.id === s.row.id)));
}

/**
 * Revokes one of the account's own sessions (anything else answers notFound). A session that is already revoked answers ok and writes nothing: no
 * change and no audit event, so repeating the call cannot grow the change feed or the audit log.
 */
export async function revokeSession(core: Core, ctx: RequestContext, auth: Auth, session: string): Promise<AccountResult<void>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'revokeSession'));
  if (typeof session !== 'string' || !SESSION_ID.test(session)) return fail('badMessage');
  const nowIso = iso(ctx.now);
  const target = await core.store.sessionById(session);
  if (target === null || target.account !== auth.account) return fail('notFound');
  if (target.revokedAt !== null) return ok(undefined);
  try {
    await core.store.revokeSession(auth.account, session, 'revoked', nowIso);
  } catch (e) {
    if ((e as { code?: unknown })?.code === 'notFound') return fail('notFound');
    throw e;
  }
  await core.changes({ at: nowIso, account: auth.account, kind: 'sessionRevoked', session });
  core.audit.record({ kind: 'sessionRevoked', account: auth.account, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { reason: 'revoked' } }, ctx.now);
  return ok(undefined);
}

// ---- the password and the recovery codes (4.2, 4.4, 5.2) -----------------------------------------------------------------------------------------

/** The email's local part, for the policy's containsEmail rule (4.2). */
export function emailLocalOf(a: Account): string | null {
  if (a.email === null) return null;
  const at = a.email.address.lastIndexOf('@');
  return at > 0 ? a.email.address.slice(0, at) : null;
}

/** passwordWeak with the problem of the local policy (4.2, the blocklist included), or nothing. */
export function checkPolicy(core: Core, password: string, ctx: { name: string; key: string; emailLocal: string | null }): void {
  const problem = core.credentials.passwordProblem(password, ctx);
  if (problem !== null) refuse('passwordWeak', { details: [problem] });
}

/**
 * passwordWeak ('common') when the configured breach check finds the password (4.2), or nothing; none is configured by default, and one that
 * cannot answer lets the password through. It is a request to a third party, so a flow runs it only behind its limits (review A11).
 */
export async function checkBreached(core: Core, password: string): Promise<void> {
  if (core.breachCheck === null) return;
  const b = await core.breachCheck.breached(password).catch(() => 'unknown' as const);
  if (b === true) refuse('passwordWeak', { details: ['common'] });
}

/** passwordWeak with the problem, or nothing: the local policy, then the configured breach check. */
export async function checkPassword(core: Core, password: string, ctx: { name: string; key: string; emailLocal: string | null }): Promise<void> {
  checkPolicy(core, password, ctx);
  await checkBreached(core, password);
}

/**
 * The password change (5.2): `current` is the proof. The new credential is written by compare-and-set on exactly the PHC string the proof verified
 * (4.1), so a password changed elsewhere while this request was hashing (by another session, or by the owner's recovery) wins: this request
 * answers badCredentials and revokes nothing. Both hashes run under the in-flight limits of 8.1 in rule 5's class.
 */
export async function changePassword(core: Core, ctx: RequestContext, auth: Auth, current: string, next: string): Promise<AccountResult<void>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'changePassword'));
  clientText(current, ACCOUNT_LIMITS.passwordRawMax);
  clientText(next, ACCOUNT_LIMITS.passwordRawMax);
  const a = s.account;
  // the request's own fields first (without the email: nothing private before the proof), then the proof, then the email rule
  await checkPassword(core, next, { name: a.name, key: a.nameKey, emailLocal: null });
  const checked = unwrap(await core.guard.proofChecked(ctx, auth, { password: current }, 'password'));
  await checkPassword(core, next, { name: a.name, key: a.nameKey, emailLocal: emailLocalOf(a) });
  const verified = (await core.store.credentials(a.id)).find((c) => c.provider === 'local' && c.secret === checked.secret);
  const stale = () => fail('badCredentials', { message: 'The password is not right.' });
  // the credential the proof verified is gone: the password changed meanwhile, and the proof no longer holds
  if (verified === undefined || checked.secret === null) return stale();
  const priority = core.rate.signIn.priorityOf(ctx.addressKey, ctx.now);
  const row = await withSlot(core, ctx.addressKey, `acc:${a.id}`, () => core.local.enroll(a.id, next, iso(ctx.now), { priority }));
  try {
    await core.store.putCredential({ ...row, createdAt: verified.createdAt }, checked.secret);
  } catch (e) {
    // the password changed while the new one was hashing: the proof no longer holds
    if ((e as { code?: unknown })?.code === 'conflict') return stale();
    throw e;
  }
  await core.guard.resetAccess(a.id, 'passwordChanged', s.row.id, s.row.device, ctx.now);
  core.audit.record({ kind: 'passwordChanged', account: a.id, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { via: 'password' } }, ctx.now);
  await core.email?.notify(a.id, 'passwordChanged').catch(() => undefined);
  return ok(undefined);
}

/** New recovery code rows: a new generation of `codes` for `account`. */
export function recoveryRows(core: Core, account: AccountId, codes: readonly string[], generation: number, now: Date): RecoveryCodeRow[] {
  return codes.map((code, slot) => ({
    account, slot, hash: core.credentials.recoveryCodeHash(account, code), generation, createdAt: iso(now), usedAt: null,
  }));
}

/** A new generation of the account's recovery codes, replacing every old one (4.4): the codes, formatted for the player. */
export async function renewRecoveryCodes(core: Core, account: AccountId, now: Date): Promise<string[]> {
  const old = await core.store.recoveryCodes(account);
  const generation = old.reduce((g, r) => Math.max(g, r.generation), 0) + 1;
  const codes = core.credentials.newRecoveryCodes();
  await core.store.replaceRecoveryCodes(account, recoveryRows(core, account, codes, generation, now));
  return codes.map(formatRecoveryCode);
}

export async function newRecoveryCodes(core: Core, ctx: RequestContext, auth: Auth, proof: Proof): Promise<AccountResult<{ codes: string[] }>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'newRecoveryCodes'));
  unwrap(await core.guard.proof(ctx, auth, proof, 'recoveryCodes'));
  const codes = await renewRecoveryCodes(core, s.account.id, ctx.now);
  core.audit.record({ kind: 'recoveryCodesRenewed', account: s.account.id, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: {} }, ctx.now);
  await core.email?.notify(s.account.id, 'recoveryCodesRenewed').catch(() => undefined);
  return ok({ codes });
}
