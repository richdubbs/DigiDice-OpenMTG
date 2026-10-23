/**
 * M14-5: the account's own view and settings, names, public profiles and guest claims (design 5.5, 6.5-6.7, 7).
 *
 * - **Rename** (6.5, 5.2): the name's rules (checkAccountName, the static reserved rules, the word filter); a key equal to the current one answers
 *   nameTaken (the store keeps one entry per key, so changing only a name's case is not a rename); the cooldown (renameCooldownMs since the last
 *   rename, unless the account has a free rename after a forced one); the key free, or this account's own held key (a take-back); the proof (the
 *   password, or a reauth ticket: sign-in finds an account by its current name only); then the store's atomic rename, which holds the old key
 *   renameHoldMs for this account. Every unavailable key answers nameTaken alike; only the static rules answer nameReserved. A free rename is used
 *   up before the rename, by a compare-and-set on the account's version (freeRename false), and the rename then runs on the version that wrote; a
 *   rename that fails gives it back. So two renames at once cannot both skip the cooldown on one free rename.
 * - **Profiles** (7.3): only an active account has one; every other id or name (hidden, erased, unknown, held, banned) answers notFound alike,
 *   after the same store calls (review A2: a dummy id's rows read where there is no account).
 * - **nameUnavailable** (6.6): true for every key that is not free, or that 6.2's static rules refuse, alike.
 * - **Claims** (5.5): the guest token proves the guest session (GuestSessions.proof); a busy session (the request's guestBusy, the proof's flag or
 *   GuestSessions.busy) answers busy; one claim per guest session, 20 per account; then the account's proof (5.2, action 'claim': a claim cannot be
 *   undone, review A3, M14-15); GuestSessions.retire is called once the claim is stored.
 */
import {
  ACCOUNT_LIMITS, isAccountId, isAccountToken, isAvatarId, type Account, type AccountResult, type PrivacySettings, type PublicProfile, type SelfView,
} from '../api';
import { checkAccountName } from '../api/names';
import { SANCTION_ID } from '../ids';
import { publicProfile } from '../views';
import type { NameHistoryRow } from '../store/api';
import type { Auth, Proof, RequestContext } from './api';
import { clientText, DUMMY_ACCOUNT, entriesFor, findByName, isFree, iso, keysOf, reserved, selfViewOf, statusOf, type Core } from './context';
import { BUSY_IN_GAME, fail, ok, refuse, unwrap } from './result';

export async function self(core: Core, ctx: RequestContext, auth: Auth): Promise<AccountResult<SelfView>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'self'));
  return ok(await selfViewOf(core, s.account, ctx.now));
}

export async function markSeen(core: Core, ctx: RequestContext, auth: Auth, sanction: string): Promise<AccountResult<SelfView>> {
  unwrap(await core.guard.session(ctx, auth, 'markSeen'));
  if (typeof sanction !== 'string' || !SANCTION_ID.test(sanction)) return fail('badMessage');
  try {
    await core.store.markSeen(auth.account, sanction, iso(ctx.now));
  } catch (e) {
    if ((e as { code?: unknown })?.code === 'notFound') return fail('notFound');
    throw e;
  }
  const a = await core.store.account(auth.account);
  return a === null ? fail('sessionExpired') : ok(await selfViewOf(core, a, ctx.now));
}

const RENAME_RETRIES = 3;

export async function rename(core: Core, ctx: RequestContext, auth: Auth, name: string, proof: Proof): Promise<AccountResult<SelfView>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'rename'));
  const now = ctx.now;
  const raw = clientText(name, ACCOUNT_LIMITS.nameRawMax);
  const checked = checkAccountName(raw);
  if (!checked.ok) return fail('nameInvalid', { details: [checked.problem], message: checked.message });
  const display = checked.display;
  const keys = await keysOf(core, display);
  for (const k of [keys.primary, ...keys.others]) if (reserved(core, k.key, display)) return fail('nameReserved');
  if (!core.nameFilter.check({ display, key: keys.primary.key }).ok) return fail('nameFiltered');

  let a = s.account;
  const cooldown = (): number => {
    if (a.freeRename || a.renamedAt === null) return 0;
    return Date.parse(a.renamedAt) + core.timing.renameCooldownMs - now.getTime();
  };
  const available = async (): Promise<boolean> => {
    if (keys.primary.key === a.nameKey && keys.primary.version === a.keyVersion) return false;
    return (await entriesFor(core, keys)).every((e) => isFree(e, now) || (e.kind === 'held' && e.account === a.id));
  };
  const wait = cooldown();
  if (wait > 0) return fail('renameCooldown', { retryAfterMs: wait });
  if (!(await available())) return fail('nameTaken');
  unwrap(await core.guard.proof(ctx, auth, proof, 'rename'));

  const nowIso = iso(now);
  for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
    const free = a.freeRename;
    // a name-history row starts after the one before it (11.5's key): within the same millisecond as the last change, one millisecond later
    const last = (await core.store.nameHistory(a.id)).at(-1);
    const from = last !== undefined && Date.parse(last.from) >= now.getTime() ? new Date(Date.parse(last.from) + 1).toISOString() : nowIso;
    const row: NameHistoryRow = {
      account: a.id, name: display, key: keys.primary.key, keyVersion: keys.primary.version, from, to: null, cause: 'rename', redacted: false,
    };
    let spent = false;
    try {
      let version = a.version;
      if (free) {
        // the free rename is used up first, on this version: a concurrent rename that read it too now conflicts and meets the cooldown
        version = (await core.store.updateAccount(a.id, a.version, { freeRename: false })).version;
        spent = true;
      }
      const renamed = await core.store.rename(a.id, version, row, {
        oldKind: 'held', holdUntil: new Date(now.getTime() + core.timing.renameHoldMs).toISOString(), allow: ['ownHeld'], now: nowIso,
      });
      spent = false;
      await core.changes({ at: nowIso, account: a.id, kind: 'renamed' });
      core.audit.record({ kind: 'renamed', account: a.id, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { free } }, now);
      return ok(await selfViewOf(core, renamed, now));
    } catch (e) {
      // the rename did not happen: the free rename it took is given back
      if (spent) await giveBackFreeRename(core, a.id);
      const code = (e as { code?: unknown })?.code;
      if (code === 'exists') return fail('nameTaken');
      if (code !== 'conflict') throw e;
      // the account changed meanwhile: read it again and check what may have changed
      const fresh = await core.store.account(a.id);
      if (fresh === null) return fail('sessionExpired');
      a = fresh;
      const w = cooldown();
      if (w > 0) return fail('renameCooldown', { retryAfterMs: w });
      if (!(await available())) return fail('nameTaken');
    }
  }
  return fail('conflict');
}

/** Gives back a free rename that a failed rename took (a patch: the account may have changed meanwhile). A failure is logged, never a refusal. */
async function giveBackFreeRename(core: Core, id: Account['id']): Promise<void> {
  const r = await core.guard.patch(id, (cur) => (cur.freeRename ? null : { freeRename: true })).catch(() => null);
  if (r === null || !r.ok) core.log.event('accounts.rename.freeRename', { account: id, code: r === null ? 'error' : r.error.code });
}

/** A patch's account; an account erased meanwhile answers as for its session (sessionExpired), a lasting conflict 'conflict'. */
function patched(r: AccountResult<Account>): Account {
  if (!r.ok && r.error.code === 'notFound') refuse('sessionExpired');
  return unwrap(r);
}

export async function setAvatar(core: Core, ctx: RequestContext, auth: Auth, avatar: unknown): Promise<AccountResult<SelfView>> {
  unwrap(await core.guard.session(ctx, auth, 'setAvatar'));
  if (!isAvatarId(avatar)) return fail('badMessage');
  const took = core.rate.take('avatar', { account: auth.account }, ctx.now);
  if (!took.ok) return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
  let changed = false;
  const a = patched(await core.guard.patch(auth.account, (cur) => {
    changed = cur.avatar !== avatar;
    return changed ? { avatar } : null;
  }));
  if (changed) await core.changes({ at: iso(ctx.now), account: auth.account, kind: 'avatar' });
  return ok(await selfViewOf(core, a, ctx.now));
}

const PRIVACY_KEYS = ['history', 'leaderboards', 'guestsAtMyTables'] as const;

export async function setPrivacy(core: Core, ctx: RequestContext, auth: Auth, change: Partial<PrivacySettings>): Promise<AccountResult<SelfView>> {
  unwrap(await core.guard.session(ctx, auth, 'setPrivacy'));
  if (typeof change !== 'object' || change === null || Array.isArray(change)) return fail('badMessage');
  const keys = Object.keys(change);
  if (keys.length === 0 || keys.some((k) => !(PRIVACY_KEYS as readonly string[]).includes(k))) return fail('badMessage');
  const c = change as Record<string, unknown>;
  if ('history' in c && c['history'] !== 'public' && c['history'] !== 'private') return fail('badMessage');
  if ('leaderboards' in c && typeof c['leaderboards'] !== 'boolean') return fail('badMessage');
  if ('guestsAtMyTables' in c && typeof c['guestsAtMyTables'] !== 'boolean') return fail('badMessage');
  const took = core.rate.take('privacy', { account: auth.account }, ctx.now);
  if (!took.ok) return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
  const a = patched(await core.guard.patch(auth.account, (cur) => {
    const next: PrivacySettings = {
      history: (c['history'] as PrivacySettings['history'] | undefined) ?? cur.privacy.history,
      leaderboards: (c['leaderboards'] as boolean | undefined) ?? cur.privacy.leaderboards,
      guestsAtMyTables: (c['guestsAtMyTables'] as boolean | undefined) ?? cur.privacy.guestsAtMyTables,
    };
    const same = next.history === cur.privacy.history && next.leaderboards === cur.privacy.leaderboards && next.guestsAtMyTables === cur.privacy.guestsAtMyTables;
    return same ? null : { privacy: next };
  }));
  return ok(await selfViewOf(core, a, ctx.now));
}

export async function profile(core: Core, ctx: RequestContext, who: { account: string } | { name: string }): Promise<AccountResult<PublicProfile>> {
  if (typeof who !== 'object' || who === null) return fail('badMessage');
  const keys = Object.keys(who);
  if (keys.length !== 1) return fail('badMessage');
  let account = null;
  if (keys[0] === 'account') {
    const id = (who as { account: unknown }).account;
    if (!isAccountId(id)) return fail('badMessage');
    account = await core.store.account(id);
  } else if (keys[0] === 'name') {
    const name = clientText((who as { name: unknown }).name, ACCOUNT_LIMITS.nameRawMax);
    account = (await findByName(core, name, ctx.now)).account;
  } else return fail('badMessage');
  // a hidden account (not active), an erased one and one that never existed answer alike (7.3), after the same store calls (review A2): where
  // there is no account, a dummy id's sanctions are read in place of its own
  const status = account !== null ? await statusOf(core, account, ctx.now) : (await core.store.sanctionsOf(DUMMY_ACCOUNT), null);
  if (account === null || status !== 'active') return fail('notFound');
  return ok(publicProfile(account));
}

export async function nameUnavailable(core: Core, name: string): Promise<boolean> {
  try {
    if (typeof name !== 'string' || name.length > ACCOUNT_LIMITS.nameRawMax) return true;
    const now = core.clock();
    const keys = await keysOf(core, name);
    if ([keys.primary, ...keys.others].some((k) => reserved(core, k.key, name))) return true;
    return (await entriesFor(core, keys)).some((e) => !isFree(e, now));
  } catch (e) {
    // when the store cannot answer, the guest gets "Guest NNNN" rather than a name that may be taken (6.6)
    core.log.event('accounts.nameUnavailable.failed', { error: e instanceof Error ? e.name : 'error' });
    return true;
  }
}

export async function claimGuest(
  core: Core, ctx: RequestContext, auth: Auth, guestToken: string, proof: Proof | undefined,
): Promise<AccountResult<{ session: string }>> {
  const s = unwrap(await core.guard.session(ctx, auth, 'claimGuest'));
  if (!isAccountToken(guestToken)) return fail('badMessage');
  if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });
  const p = await core.guests.proof(guestToken);
  if (p === null) return fail('notFound');
  if (p.busy || (await core.guests.busy(p.session))) return fail('busy', { message: BUSY_IN_GAME });
  const claims = await core.store.claimsOf(auth.account);
  if (claims.some((c) => c.session === p.session)) return fail('alreadyClaimed');
  if (claims.length >= ACCOUNT_LIMITS.claimsMax) return fail('limitReached');
  // the proof last (5.2, action 'claim'; review A3): a claim cannot be undone
  unwrap(await core.guard.proof(ctx, auth, proof, 'claim'));
  try {
    await core.store.claimGuest({ session: p.session, account: auth.account, claimedAt: iso(ctx.now) });
  } catch (e) {
    if ((e as { code?: unknown })?.code === 'exists') return fail('alreadyClaimed');
    throw e;
  }
  await core.guests.retire(p.session).catch((err: unknown) =>
    core.log.event('accounts.claim.retire', { account: auth.account, error: err instanceof Error ? err.name : 'error' }),
  );
  // GuestSessions gives no game count (reported): hosted's history counts the games at the sync
  core.audit.record(
    { kind: 'guestClaimed', account: auth.account, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { guestSession: p.session, games: 0 } },
    ctx.now,
  );
  return ok({ session: p.session });
}
