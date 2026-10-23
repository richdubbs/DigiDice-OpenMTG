/**
 * M14-5: what every flow of the service core shares (design 11.3): the dependencies, the clock, the request checks, the name keys under the store's
 * name data version (6.3), and the account's own view (SelfView, built by src/views.ts from the rows).
 */
import {
  accountStatus, isAccountId, type Account, type AccountChange, type AccountId, type AccountRateLimits, type AccountStatus, type AccountTiming,
  type SelfView,
} from '../api';
import type { HumanVerifier, BreachedPasswordCheck } from '../abuse/api';
import type { ServiceRateLimiter } from '../abuse/limiter';
import type { ServiceAuditWriter } from '../audit/writer';
import type { AccountsConfig } from '../config';
import type { CredentialTools, PasswordHasher } from '../crypto/api';
import type { Mailer, MailQueue } from '../email/api';
import type { IdentityProvider, PasswordProvider } from '../identity/api';
import type { NameData, NameFilter, NameRules } from '../names/api';
import type { AccountStore, AppealRow, NameEntry, SanctionRow } from '../store/api';
import { SESSION_ID } from '../ids';
import { hostedTextProblem, STORE_ID } from '../text';
import { selfView } from '../views';
import type { AccountServiceDeps, AccountsLog, Auth, EmailPart, GuestSessions, RequestContext } from './api';
import type { CoreGuard } from './guard';
import { refuse } from './result';

/** The answer to an attempt refused by an in-flight limit (8.1) or a busy lock: try again in a second. */
export const IN_FLIGHT_RETRY_MS = 1_000;

/**
 * A well-formed account id no account has (newAccountId's ids are random). Where a flow has no account it reads this id's rows instead, so that
 * the store calls are the same for every answer 7.3 says must look alike (review A2, M14-15): a hidden account, and a held, banned, reserved,
 * erased or unknown name or id.
 */
export const DUMMY_ACCOUNT: AccountId = 'acc_00000000000000000000000000';

/**
 * AccountServiceDeps and one optional addition: the service's clock. Every call brings its time in `ctx.now`, but the directory's lookups take none
 * (`standing`, `names`, `historyVisible`): they read this clock (the system clock by default; tests pass a fake one).
 */
export interface ServiceDeps extends AccountServiceDeps {
  now?: () => Date;
}

/** Hash jobs in flight per address key and per (name key, address key) (8.1: 2 and 1). */
export interface InFlight {
  /** Takes a slot for the attempt, or answers false when a limit is reached. */
  enter(addressKey: string, nameKey: string | null): boolean;
  leave(addressKey: string, nameKey: string | null): void;
}

/**
 * One attempt in flight per key, in memory: a session's proof (`s:<session id>`, 5.2) and a device proof's sign-in (`d:<device hash>`, 8.2 rule 2),
 * so that each wrong attempt adds exactly one to the counter the store keeps (proofFailures, DeviceRow.failures) and the next attempt sees it. A
 * second attempt while one is in flight is refused (rateLimited), never queued, so the map holds at most the requests in flight.
 */
export interface KeyLocks {
  /** Takes the key, or answers false while another attempt holds it. */
  enter(key: string): boolean;
  leave(key: string): void;
}

/** The connections and guest sessions that failed the age gate, for 24 hours (7.5), in memory only, at most counterEntries keys. */
export interface AgeMarks {
  marked(keys: readonly string[], now: Date): boolean;
  mark(keys: readonly string[], now: Date): void;
  sweep(now: Date): void;
  /** The keys held now (never more than counterEntries). */
  readonly size: number;
}

export interface Core {
  store: AccountStore;
  config: AccountsConfig;
  limits: AccountRateLimits;
  timing: AccountTiming;
  hasher: PasswordHasher;
  credentials: CredentialTools;
  /** The local provider (always first among the providers). */
  local: PasswordProvider;
  providers: readonly IdentityProvider[];
  names: NameRules;
  nameFilter: NameFilter;
  verifier: HumanVerifier;
  mailer: Mailer;
  breachCheck: BreachedPasswordCheck | null;
  guests: GuestSessions;
  log: AccountsLog;
  random: (n: number) => Uint8Array;
  clock: () => Date;
  audit: ServiceAuditWriter;
  rate: ServiceRateLimiter;
  /** Appends a change and tells the onChange listeners. */
  changes(c: Omit<AccountChange, 'seq'>): Promise<number>;
  mail: MailQueue;
  guard: CoreGuard;
  /** The email part once it is built (notices, the registration's address), else null. */
  email: EmailPart | null;
  inFlight: InFlight;
  locks: KeyLocks;
  ageMarks: AgeMarks;
  /** The work challenge's scope for a name key (8.4: a keyed tag of the key, never the key). */
  scope(nameKey: string): string;
}

export const iso = (d: Date): string => d.toISOString();

/** The request context as the host gives it; anything else answers badMessage (the host's error, never a client's). */
export function checkCtx(ctx: RequestContext): void {
  if (typeof ctx !== 'object' || ctx === null) refuse('badMessage');
  if (!(ctx.now instanceof Date) || !Number.isFinite(ctx.now.getTime())) refuse('badMessage');
  if (typeof ctx.connection !== 'string' || ctx.connection.length === 0 || ctx.connection.length > 128) refuse('badMessage');
  if (typeof ctx.addressKey !== 'string' || ctx.addressKey.length === 0 || ctx.addressKey.length > 128) refuse('badMessage');
  if (ctx.guestSession !== null && !(typeof ctx.guestSession === 'string' && STORE_ID.test(ctx.guestSession))) refuse('badMessage');
  if (typeof ctx.guestBusy !== 'boolean') refuse('badMessage');
  if (ctx.client !== 'desktop' && ctx.client !== 'web') refuse('badMessage');
}

/** The shape of an Auth: an account id and a session id; anything else answers badMessage before any lookup. */
export function checkAuth(auth: Auth): void {
  if (typeof auth !== 'object' || auth === null || !isAccountId(auth.account)) refuse('badMessage');
  if (typeof auth.session !== 'string' || !SESSION_ID.test(auth.session)) refuse('badMessage');
}

/** Runs `f` holding a hash slot of the address key (and of the name key with it): 2 and 1 in flight at most (8.1), else rateLimited. */
export async function withSlot<T>(core: Core, addressKey: string, nameKey: string | null, f: () => Promise<T>): Promise<T> {
  if (!core.inFlight.enter(addressKey, nameKey)) refuse('rateLimited', { retryAfterMs: IN_FLIGHT_RETRY_MS });
  try {
    return await f();
  } finally {
    core.inFlight.leave(addressKey, nameKey);
  }
}

/** A string a client sent, under m13's text rules and a length bound (UTF-16 units); anything else answers badMessage. */
export function clientText(v: unknown, maxUnits: number): string {
  if (typeof v !== 'string' || v.length > maxUnits || hostedTextProblem(v) !== null) refuse('badMessage');
  return v;
}

/** An optional string a client sent: undefined, or as clientText. */
export function optionalText(v: unknown, maxUnits: number): string | undefined {
  return v === undefined ? undefined : clientText(v, maxUnits);
}

/** A key is free when it has no entry, or its entry has expired (until at or before now, 6.5). */
export function isFree(e: NameEntry | null, now: Date): boolean {
  if (e === null) return true;
  return e.until !== null && Date.parse(e.until) <= now.getTime();
}

/** The name data the store's keys use now (its nameKeyVersion), and the other version during a rekey (6.3). */
export async function keyData(core: Core): Promise<{ primary: NameData; others: NameData[] }> {
  const v = await core.store.nameKeyVersion();
  const all = [core.names.current, ...(core.names.previous !== null ? [core.names.previous] : [])];
  const primary = all.find((d) => d.version === v);
  if (primary === undefined) {
    core.log.event('accounts.names.versionUnknown', { store: v, current: core.names.current.version });
    return { primary: core.names.current, others: [] };
  }
  return { primary, others: all.filter((d) => d !== primary) };
}

export interface NameKey { key: string; version: number }

/** A display's key under the store's version, and under the other version during a rekey. */
export async function keysOf(core: Core, display: string): Promise<{ primary: NameKey; others: NameKey[] }> {
  const { primary, others } = await keyData(core);
  return {
    primary: { key: core.names.key(display, primary), version: primary.version },
    others: others.map((d) => ({ key: core.names.key(display, d), version: d.version })),
  };
}

/**
 * The names entries a display's keys meet: each of its keys under each version in use. During a rekey (6.3) registration and rename check both keys,
 * and a key made under the new data is looked up among the entries of the old version too (an existing name's new key is unknown until the rekey,
 * and is the same as its old one for every name the new data does not touch), so a name that would fold onto another after the switch cannot slip
 * in between. Outside a rekey this is the one lookup of the key under the store's version.
 */
export async function entriesFor(core: Core, keys: { primary: NameKey; others: NameKey[] }): Promise<NameEntry[]> {
  const versions = [keys.primary.version, ...keys.others.map((k) => k.version)];
  const seen = new Set<string>();
  const out: NameEntry[] = [];
  for (const k of [keys.primary, ...keys.others]) {
    for (const v of versions) {
      const id = `${v}\n${k.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = await core.store.nameEntry(k.key, v);
      if (e !== null) out.push(e);
    }
  }
  return out;
}

/** 6.2's static rules for a key, with the display (an exception counts only inside one word; DisplayAwareNameRules, M14-2). */
export function reserved(core: Core, key: string, display: string): boolean {
  const rp = core.names.reservedProblem as (key: string, display?: string) => 'reserved' | null;
  return rp.call(core.names, key, display) !== null;
}

/**
 * The account a typed name signs in to, found by its key under the current version, then under the other one (6.3). Every name costs the same
 * store calls, whatever its entry (review A2, M14-15; 7.3: a hidden account answers with "the same sign-in behaviour, counters and timing" as a
 * held, banned or reserved key): under each version its entry and one account, the entry's for a current key (or a followed ban) and
 * DUMMY_ACCOUNT's for any other entry or none, and no version is skipped once one has matched.
 *
 * `bans` (sign-in, the recovery-code sign-in and the email reset; review A6): a forced rename's ban keeps the account it was taken from
 * (NameEntry.account), and the old name then still reaches that account while the ban lasts, so an owner signed out everywhere can get back in
 * without knowing the new name. Only the right secret gets anywhere; the store calls, the answers and the counters (by the typed name's key, as
 * every name) are as for any other name. A profile does not follow a ban (7.3: a banned key answers notFound).
 */
export async function findByName(
  core: Core, typed: string, now: Date, opts: { bans: boolean } = { bans: false },
): Promise<{ key: string; known: boolean; account: Account | null }> {
  const { primary, others } = await keysOf(core, typed);
  let known = false;
  let found: Account | null = null;
  for (const k of [primary, ...others]) {
    const e = await core.store.nameEntry(k.key, k.version);
    const live = e !== null && !isFree(e, now);
    if (live) known = true;
    const follow = live && e.account !== null && (e.kind === 'current' || (opts.bans && e.kind === 'banned'));
    const id = found === null && follow ? e.account! : DUMMY_ACCOUNT;
    const a = await core.store.account(id);
    if (id === DUMMY_ACCOUNT || a === null) continue;
    if (e!.kind === 'banned' || (a.nameKey === k.key && a.keyVersion === k.version)) found = a;
  }
  return { key: primary.key, known, account: found };
}

/** Every sanction of the account with its appeal (or null). */
export async function sanctionsWithAppeals(core: Core, id: AccountId): Promise<{ row: SanctionRow; appeal: AppealRow | null }[]> {
  const rows = await core.store.sanctionsOf(id);
  if (rows.length === 0) return [];
  const appeals = await core.store.appeals({ account: id, limit: 10_000 });
  const by = new Map(appeals.map((a) => [a.sanction, a]));
  return rows.map((row) => ({ row, appeal: by.get(row.id) ?? null }));
}

/** The status (D23) at `now`. */
export async function statusOf(core: Core, a: Account, now: Date): Promise<AccountStatus> {
  return accountStatus(await core.store.sanctionsOf(a.id), a.deletion, iso(now));
}

/** What the account itself sees (src/views.ts selfView), from its rows at `now`. */
export async function selfViewOf(core: Core, a: Account, now: Date): Promise<SelfView> {
  const [credentials, recoveryCodes, sanctions] = await Promise.all([
    core.store.credentials(a.id), core.store.recoveryCodes(a.id), sanctionsWithAppeals(core, a.id),
  ]);
  return selfView(a, { now: iso(now), credentials, recoveryCodes, sanctions, renameCooldownMs: core.timing.renameCooldownMs });
}
