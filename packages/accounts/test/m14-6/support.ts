/**
 * Shared fixtures of the M14-6 tests (owner rule: in process, a fake clock, fixed inputs). The service is M14-5's test service (../m14-5/support.ts:
 * the memory store, the real name rules and credential tools, a fast hasher) with the real moderation part, given the service's name rules and its
 * fake clock (ModerationDeps). Accounts that need no password (the 500-entry cap, hidden targets) are written into the store directly. A wrapped
 * store (wrappedStore) lets a test fail one store call, run another caller's call just before one (a fixed interleaving), or count them.
 */
import { createHash } from 'node:crypto';
import {
  ACCOUNT_STORE_METHODS, createMemoryAccountStore, createNameRules, DEFAULT_PRIVACY, defaultAvatar, newSessionId, newUlid, type Account,
  type AccountId, type AccountStore, type AuditEvent, type NewAccount, type Operator,
} from '@openmtg/accounts';
import { createModerationPart } from '../../src/moderation/index';
import { Clock, DAY, setup as baseSetup, type Setup, type SetupOptions } from '../m14-5/support';
import { fixedRandom } from '../m14-1/support';

export * from '../m14-5/support';

/** The operator of every test command, and the OS user it runs as. */
export const OP: Operator = { name: 'Mod Alice', osUser: 'tester' };

/** M14-5's setup with the moderation part (given the service's name rules and clock); `moderation: false` leaves it out. */
export function setup(o: SetupOptions & { moderation?: false } = {}): Setup {
  const clock = o.clock ?? new Clock();
  const names = o.names ?? createNameRules({ reservedNamesText: null });
  const parts = { ...o.parts };
  if (o.moderation !== false) parts.moderation = (deps) => createModerationPart({ ...deps, names, now: clock.now });
  return baseSetup({ ...o, clock, names, parts });
}

/** Writes the audit writer's queue to the store (the part's own events are appended at once; the service's are queued). */
export async function flush(s: Setup): Promise<void> {
  await s.partDeps.current!.audit.flush();
}

/** Every audit event in the store, after a flush. */
export async function events(s: Setup): Promise<AuditEvent[]> {
  await flush(s);
  return s.store.audit({ limit: 100_000 });
}

/** A memory store behind a plain object of its methods (as M14-5's race tests wrap one), so a test can replace or count one. */
export function wrappedStore(): AccountStore {
  const inner = createMemoryAccountStore();
  return Object.fromEntries(
    ACCOUNT_STORE_METHODS.map((k) => [k, (...args: unknown[]) => (inner[k] as (...a: unknown[]) => unknown).apply(inner, args)]),
  ) as unknown as AccountStore;
}

type Method = (...args: never[]) => Promise<unknown>;

/** The next call of `method` rejects (a store that fails half-way through a command); the calls after it run as before. */
export function failOnce(store: AccountStore, method: keyof AccountStore): void {
  const slot = store as unknown as Record<string, Method>;
  const original = slot[method]!;
  slot[method] = () => {
    slot[method] = original;
    return Promise.reject(new Error(`the store failed (${method}, a test)`));
  };
}

/** Runs `f` once, before the next call of `method` goes to the store (a fixed interleaving: what another caller does in between). */
export function beforeNext(store: AccountStore, method: keyof AccountStore, f: (...args: unknown[]) => Promise<void>): void {
  const slot = store as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = slot[method]!;
  slot[method] = async (...args: unknown[]) => {
    slot[method] = original;
    await f(...args);
    return original(...args);
  };
}

/** Counts the calls of `method` from now on. */
export function countCalls(store: AccountStore, method: keyof AccountStore): { n: number } {
  const slot = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = slot[method]!;
  const c = { n: 0 };
  slot[method] = (...args: unknown[]) => {
    c.n++;
    return original(...args);
  };
  return c;
}

/** A well-formed account id no account has. */
export const UNKNOWN_ID: AccountId = `acc_7${'Z'.repeat(25)}`;

const seedRandom = fixedRandom('m14-6 seed');

/** An account written straight into the store (no password: it never signs in), under the current name data. */
export async function seedAccount(s: Setup, name: string): Promise<Account> {
  const now = s.clock.now();
  const at = now.toISOString();
  const id = `acc_${'0'}${newUlid(now, seedRandom).slice(1, 26)}` as AccountId;
  const key = s.names.key(name);
  const version = await s.store.nameKeyVersion();
  const account: Account = {
    id, name, nameKey: key, keyVersion: version, avatar: defaultAvatar(id), privacy: { ...DEFAULT_PRIVACY }, email: null,
    ageGate: { minAge: 13, passedAt: at }, createdAt: at, lastSignInAt: null, renamedAt: null, freeRename: false, deletion: null, inactiveNoticeAt: null,
    version: 1,
  };
  const token = createHash('sha256').update(`seed ${id}`).digest('hex');
  const n: NewAccount = {
    account,
    credential: { account: id, provider: 'local', subject: id, secret: '$seed$', meta: {}, createdAt: at, lastUsedAt: null },
    recovery: [],
    history: { account: id, name, key, keyVersion: version, from: at, to: null, cause: 'register', redacted: false },
    claim: null,
    session: {
      id: newSessionId(now, seedRandom), account: id, provider: 'local', client: 'web', createdAt: at, lastUsedAt: at, authAt: at, rotatedAt: at,
      expiresAt: new Date(now.getTime() + 180 * DAY).toISOString(), revokedAt: null, revokeReason: null, tokenHash: token, previousHash: null, rotation: 0,
      device: null, proofFailures: 0,
    },
    device: { hash: createHash('sha256').update(`device ${id}`).digest('hex'), account: id, createdAt: at, lastUsedAt: at, failures: 0 },
    audit: [],
  };
  await s.store.createAccount(n, at);
  return account;
}

/** Letters whose keys are themselves and no other letter's (no i, l, m, n, o, r, u, v, w: the look-alike folds of 6.3). */
const PLAIN = 'abcdefghjkpqstxyz';

/** The i-th of many distinct names whose keys differ too ("Seed" and three plain letters). */
export function seedName(i: number): string {
  const n = PLAIN.length;
  return `Seed${PLAIN[Math.floor(i / (n * n)) % n]}${PLAIN[Math.floor(i / n) % n]}${PLAIN[i % n]}`;
}

/** Erases an account in the store as 10.2 step 5 does (the rights part is M14-7's): only its tombstone and a name hold stay. */
export async function erase(s: Setup, id: AccountId): Promise<void> {
  const at = s.clock.now().toISOString();
  // claimed as tick claims it (10.2 step 3): the store erases only a claimed, due deletion
  const a = (await s.store.account(id))!;
  await s.store.updateAccount(id, a.version, { deletion: { requestedAt: at, purgeAt: at, erasingAt: at, done: [] } });
  await s.store.erase(id, { account: id, deletedAt: at, sanctionUntil: null, holdersDone: [] }, new Date(s.clock.t + 90 * DAY).toISOString());
}

/** A deletion pending (the account is 'deleting'). */
export async function markDeleting(s: Setup, id: AccountId): Promise<void> {
  const a = (await s.store.account(id))!;
  await s.store.updateAccount(id, a.version, {
    deletion: { requestedAt: s.clock.now().toISOString(), purgeAt: new Date(s.clock.t + 7 * DAY).toISOString(), erasingAt: null, done: [] },
  });
}
