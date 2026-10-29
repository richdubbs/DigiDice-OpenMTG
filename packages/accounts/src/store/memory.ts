/**
 * `MemoryAccountStore` (M14-4; design 11.2): the account store in plain maps, for the unit tests (an order of magnitude faster than the PostgreSQL
 * store on PGlite, which the contract suite also runs: F26 kept it for that).
 *
 * How a write works. Every write is a plan run against the committed tables through a `Tx`: the plan reads through the transaction (it sees its own
 * writes), checks everything it must refuse first, and records its changes as a list of row mutations (put a row, delete a row) without touching the
 * tables. Only a plan that returns without throwing is committed, by applying its mutations in one synchronous step, so a refused write changes
 * nothing and no reader ever sees half of one.
 *
 * Rows in the tables are never changed in place (a plan builds a new row), every row is built by src/store/rules.ts from exactly the contract's fields,
 * and every answer is a deep copy: no caller can change stored state through an argument or a result.
 *
 * Ordering of lists: by their time, then by id (code-point order), so every store returns the same order; reports and change-feed reads go by their
 * ids and seqs (keyset paging).
 */
import {
  ACCOUNT_RATE_LIMITS, AUDIT_CATEGORY, DELETED_PLAYER_NAME, sanctionRuns, type Account, type AccountChange, type AccountId, type AuditEvent,
  type SanctionEnd,
} from '../api';
import { DEFAULT_ACCOUNT_RETENTION } from '../config';
import type {
  AccountPatch, AccountPurgeReport, AccountRetention, AccountSessionRow, AccountStore, AccountStoreLimits, AppealRow, AuditQuery, ClaimRow,
  CredentialRow, DeviceRow, EmailCodeRow, ListCursor, NameEntry, NameHistoryRow, NewAccount, RecoveryCodeRow, RelationRow, RenameOptions, ReportQuery,
  ReportRow, SanctionRow, TombstoneRow,
} from './api';
import {
  EMAIL_PURPOSES, PROVIDERS, RELATION_KINDS, REVOKE_REASONS, SANCTION_ENDS, accountRow, appealRow, auditRow, bool, byKeys, changeRow,
  claimRow, compareText, credentialKeyOf, credentialRow, cursorOf, deviceRow, emailCodeRow, historyRow, int, limitOf, ms, nameEntryRow, nameKeyOf,
  oneOf,
  recoveryRow, relationKeyOf, relationRow, reportRow, sanctionRow, sessionRow, storeError, text, textOrNull, time, timeOrNull,
  tombstoneRow, word,
} from './rules';

// ---- tables ----------------------------------------------------------------------------------------------------------------------------------

/** A tombstone as the stores keep it: the row, and the end of the name hold its erase wrote (10.3: kept until the hold and any sanction end). */
export interface StoredTombstone { row: TombstoneRow; holdUntil: string }

/** Every table of the store. `meta` holds 'nameVersion' (6.3) and 'changeSeq' (the last seq the change feed gave out). */
export interface StoreTables {
  meta: Map<string, number>;
  accounts: Map<string, Account>;
  /** By nameKeyOf(key, keyVersion). */
  names: Map<string, NameEntry>;
  /** By account: its rows in order. */
  history: Map<string, NameHistoryRow[]>;
  /** By credentialKeyOf(provider, subject). */
  credentials: Map<string, CredentialRow>;
  /** By account: its rows by slot. */
  recovery: Map<string, RecoveryCodeRow[]>;
  devices: Map<string, DeviceRow>;
  sessions: Map<string, AccountSessionRow>;
  /** By guest session. */
  claims: Map<string, ClaimRow>;
  /** By relationKeyOf(account, other, kind). */
  relations: Map<string, RelationRow>;
  emailCodes: Map<string, EmailCodeRow>;
  reports: Map<string, ReportRow>;
  sanctions: Map<string, SanctionRow>;
  /** By sanction. */
  appeals: Map<string, AppealRow>;
  audit: Map<string, AuditEvent>;
  /** By String(seq). */
  changes: Map<string, AccountChange>;
  tombstones: Map<string, StoredTombstone>;
}
export type TableName = keyof StoreTables;
export type RowOf<T extends TableName> = StoreTables[T] extends Map<string, infer R> ? R : never;
export const TABLE_NAMES: readonly TableName[] = Object.freeze([
  'meta', 'accounts', 'names', 'history', 'credentials', 'recovery', 'devices', 'sessions', 'claims', 'relations', 'emailCodes', 'reports',
  'sanctions', 'appeals', 'audit', 'changes', 'tombstones',
] as const);

/** One change to one row: `v` the new row, or null to delete it. */
export type Mutation = { [T in TableName]: { t: T; k: string; v: RowOf<T> | null } }[TableName];

export function emptyTables(): StoreTables {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, new Map()])) as unknown as StoreTables;
}

/** Applies mutations in order (synchronously: nothing can read in between). */
export function applyMutations(tables: StoreTables, muts: readonly Mutation[]): void {
  for (const m of muts) {
    const table = tables[m.t] as Map<string, unknown>;
    if (m.v === null) table.delete(m.k);
    else table.set(m.k, m.v);
  }
}

/** The tables as JSON-safe entries (the memory store's full dump). */
export function tablesToJson(tables: StoreTables): Record<TableName, [string, unknown][]> {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, [...(tables[t] as Map<string, unknown>).entries()]])) as Record<TableName, [string, unknown][]>;
}

/**
 * A plan's view of the tables: reads see the plan's own writes; writes are recorded as mutations and applied only when the plan commits.
 */
export class Tx {
  readonly muts: Mutation[] = [];
  private readonly over = new Map<TableName, Map<string, unknown>>();
  constructor(private readonly base: StoreTables) {}

  get<T extends TableName>(t: T, k: string): RowOf<T> | undefined {
    const o = this.over.get(t);
    if (o?.has(k)) return (o.get(k) ?? undefined) as RowOf<T> | undefined;
    return (this.base[t] as Map<string, RowOf<T>>).get(k);
  }
  put<T extends TableName>(t: T, k: string, v: RowOf<T>): void {
    this.mark(t, k, v);
  }
  del<T extends TableName>(t: T, k: string): void {
    if (this.get(t, k) !== undefined) this.mark(t, k, null);
  }
  /** Every live row of a table: the committed ones as this plan changed them, then the ones it added. */
  *entries<T extends TableName>(t: T): IterableIterator<[string, RowOf<T>]> {
    const o = this.over.get(t);
    for (const [k, v] of this.base[t] as Map<string, RowOf<T>>) {
      if (o?.has(k)) {
        const w = o.get(k);
        if (w !== null && w !== undefined) yield [k, w as RowOf<T>];
      } else yield [k, v];
    }
    if (o) for (const [k, w] of o) if (w !== null && !(this.base[t] as Map<string, unknown>).has(k)) yield [k, w as RowOf<T>];
  }
  *rows<T extends TableName>(t: T): IterableIterator<RowOf<T>> {
    for (const [, v] of this.entries(t)) yield v;
  }
  private mark(t: TableName, k: string, v: unknown): void {
    let o = this.over.get(t);
    if (!o) this.over.set(t, (o = new Map()));
    o.set(k, v);
    this.muts.push({ t, k, v } as Mutation);
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------

const err = storeError;
/** A copy no caller shares with the store (rows are plain JSON; maps and arrays included). */
const clone = <T>(x: T): T => structuredClone(x);
/**
 * A write's arguments, copied when the call is made: plain data (a class instance comes out a plain object, as JSON would store it); what cannot be
 * copied (a function, a symbol) is refused ('value').
 */
export function copyArgs<A extends unknown[]>(args: A): A {
  try {
    return structuredClone(args);
  } catch {
    throw storeError('value', 'an argument is not plain data');
  }
}
const NAME_VERSION = 'nameVersion';
const CHANGE_SEQ = 'changeSeq';
/** A new store's name data version: the first NAME_DATA_VERSION (6.3; M14-2's data starts at 1). */
export const INITIAL_NAME_KEY_VERSION = 1;

/** A names entry is free from its `until` on (6.5); a current key, or any entry without an end, never is. */
function isFree(e: NameEntry | undefined, nowMs: number): boolean {
  return e === undefined || (e.until !== null && Date.parse(e.until) <= nowMs);
}
const tMs = (s: string): number => Date.parse(s);
function idList(label: string, v: unknown): string[] {
  if (!Array.isArray(v)) throw err('value', `${label} is not an array`);
  return v.map((x, i) => text(`${label}[${i}]`, x));
}
function patchObject(label: string, v: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw err('value', `${label} is not an object`);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue;
    if (!allowed.includes(k)) throw err('value', `${label}.${k} cannot be changed here`);
    out[k] = x;
  }
  return out;
}
const ACCOUNT_PATCH_KEYS = ['avatar', 'privacy', 'email', 'lastSignInAt', 'freeRename', 'deletion', 'inactiveNoticeAt'] as const satisfies readonly (keyof AccountPatch)[];

function needAccount(tx: Tx, id: string): Account {
  const a = tx.get('accounts', id);
  if (!a) throw err('notFound', 'no such account');
  return a;
}
/**
 * Replaces each of `words` (an erased account's names and email address) in a text by "Deleted player", ignoring case, the longest first so a name
 * that holds another goes whole. Null stays null.
 */
export function scrubberOf(words: readonly string[]): (s: string | null) => string | null {
  const list = [...new Set(words.filter((w) => w.length > 0))].sort((p, q) => q.length - p.length);
  if (list.length === 0) return (s) => s;
  const re = new RegExp(list.map((w) => w.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')).join('|'), 'giu');
  return (s) => (s === null ? null : s.replace(re, DELETED_PLAYER_NAME));
}
/** The live-code cap of `limits`: emailResetLiveCodes, a whole number from 0, or ACCOUNT_RATE_LIMITS' value when absent (RangeError otherwise). */
export function liveCodesLimit(limits: AccountStoreLimits): number {
  const v = limits.emailResetLiveCodes ?? ACCOUNT_RATE_LIMITS.emailResetLiveCodes;
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError('emailResetLiveCodes must be a whole number from 0');
  return v;
}
function sessionsHolding(tx: Tx, hash: string, exceptId: string | null): boolean {
  for (const s of tx.rows('sessions')) if (s.id !== exceptId && (s.tokenHash === hash || s.previousHash === hash)) return true;
  return false;
}
/** A row at (`t`, `id`) comes after the cursor `c` (ListCursor) in a listing by time, then id; every row does without one. */
function afterCursor(t: number, id: string, c: { at: number; account: string } | null): boolean {
  return c === null || t > c.at || (t === c.at && compareText(id, c.account) > 0);
}
/**
 * An event as the store keeps it (INTERFACE CHANGE (M14-7)): once its account is erased (its tombstone is there), as erase leaves the account's
 * events: `deleted` as it is, an operator event without its account, nothing else (null). Every other event as it is.
 */
function keptEvent(tx: Tx, e: AuditEvent): AuditEvent | null {
  if (e.account === null || e.kind === 'deleted' || !tx.get('tombstones', e.account)) return e;
  return AUDIT_CATEGORY[e.kind] === 'operator' ? { ...e, account: null } : null;
}

// ---- the store -------------------------------------------------------------------------------------------------------------------------------

/** The memory store (design 11.2). `createMemoryAccountStore` in src/store/index.ts makes one. */
export class MemoryAccountStore implements AccountStore {
  private readonly t: StoreTables = emptyTables();
  private closed = false;
  /** putEmailCode's cap (AccountStoreLimits; ACCOUNT_RATE_LIMITS.emailResetLiveCodes unless configured). */
  private readonly liveCodesMax: number;

  constructor(limits: AccountStoreLimits = {}) {
    this.liveCodesMax = liveCodesLimit(limits);
  }

  /** A full dump of every table, for tests that search everything the store holds (the erase test, 13.2 M14-4). */
  dump(): Record<TableName, [string, unknown][]> {
    return clone(tablesToJson(this.t));
  }

  private live(): void {
    if (this.closed) throw err('closed', 'the account store is closed');
  }
  private async read<R>(f: (tx: Tx) => R): Promise<R> {
    this.live();
    return clone(f(new Tx(this.t)));
  }
  /**
   * Runs a plan and commits it. The plan reads only `args`, copied here when the call is made (copyArgs), never the caller's objects: a caller that
   * changes an argument after the call changes nothing, as with the PostgreSQL store (review of M14-4).
   */
  private async write<A extends unknown[], R>(args: [...A], plan: (tx: Tx, ...args: A) => R): Promise<R> {
    const a = copyArgs(args);
    this.live();
    const tx = new Tx(this.t);
    const out = plan(tx, ...a);
    applyMutations(this.t, tx.muts);
    return clone(out);
  }

  // ---- accounts and names (6.5) ----

  createAccount(n: NewAccount, now: string): Promise<void> {
    return this.write([n, now], (tx, n, now) => {
      const at = time('now', now);
      if (typeof n !== 'object' || n === null) throw err('value', 'the new account is not an object');
      const a = accountRow(n.account);
      // INTERFACE CHANGE (M14-11): a new account has no deletion (in PostgreSQL a deletion starts by the database's request_deletion, whose guards the
      // erasure claim rests on), and its name key is made under the current name data version (a rekey that has run leaves no straggler under the old one)
      if (a.deletion !== null) throw err('value', 'a new account has no deletion');
      const current = tx.get('meta', NAME_VERSION) ?? INITIAL_NAME_KEY_VERSION;
      if (a.keyVersion !== current) throw err('conflict', `the current name data version is ${current}, not ${a.keyVersion}`);
      if (tx.get('accounts', a.id) || tx.get('tombstones', a.id)) throw err('exists', 'an account with this id exists or existed');
      const k = nameKeyOf(a.nameKey, a.keyVersion);
      if (!isFree(tx.get('names', k), tMs(at))) throw err('exists', 'the name key is taken');
      const own = (label: string, account: string) => {
        if (account !== a.id) throw err('value', `${label} belongs to another account`);
      };
      const cred = credentialRow(n.credential);
      own('the credential', cred.account);
      if (tx.get('credentials', credentialKeyOf(cred.provider, cred.subject))) throw err('exists', 'the credential subject is taken');
      if (!Array.isArray(n.recovery)) throw err('value', 'recovery is not an array');
      const recovery = n.recovery.map(recoveryRow).sort(byKeys((r) => r.slot));
      recovery.forEach((r, i) => {
        own('a recovery code', r.account);
        if (i > 0 && recovery[i - 1]!.slot === r.slot) throw err('value', `recovery slot ${r.slot} twice`);
      });
      const h = historyRow(n.history);
      own('the name history row', h.account);
      if (h.key !== a.nameKey || h.keyVersion !== a.keyVersion || h.name !== a.name) throw err('value', 'the name history row is not the account name');
      const claim = n.claim === null ? null : claimRow(n.claim);
      if (claim) {
        own('the claim', claim.account);
        if (tx.get('claims', claim.session)) throw err('exists', 'the guest session is claimed');
      }
      const s = sessionRow(n.session);
      own('the session', s.account);
      if (tx.get('sessions', s.id)) throw err('exists', 'the session id exists');
      if (sessionsHolding(tx, s.tokenHash, null) || (s.previousHash !== null && sessionsHolding(tx, s.previousHash, null))) {
        throw err('exists', 'the token hash belongs to another session');
      }
      const d = deviceRow(n.device);
      own('the device proof', d.account);
      if (tx.get('devices', d.hash)) throw err('exists', 'the device proof exists');
      if (!Array.isArray(n.audit)) throw err('value', 'audit is not an array');
      const events = n.audit.map(auditRow);
      const ids = new Set<string>();
      for (const e of events) {
        if (tx.get('audit', e.id) || ids.has(e.id)) throw err('exists', 'the audit event id exists');
        ids.add(e.id);
      }
      tx.put('accounts', a.id, a);
      tx.put('names', k, { key: a.nameKey, keyVersion: a.keyVersion, kind: 'current', account: a.id, until: null, note: null, createdAt: at });
      tx.put('history', a.id, [h]);
      tx.put('credentials', credentialKeyOf(cred.provider, cred.subject), cred);
      if (recovery.length > 0) tx.put('recovery', a.id, recovery);
      if (claim) tx.put('claims', claim.session, claim);
      tx.put('sessions', s.id, s);
      tx.put('devices', d.hash, d);
      for (const e of events) tx.put('audit', e.id, e);
    });
  }

  account(id: AccountId): Promise<Account | null> {
    return this.read((tx) => tx.get('accounts', text('id', id)) ?? null);
  }

  accounts(ids: readonly AccountId[]): Promise<Map<AccountId, Account>> {
    return this.read((tx) => {
      const out = new Map<AccountId, Account>();
      for (const id of idList('ids', ids)) {
        const a = tx.get('accounts', id);
        if (a) out.set(a.id, a);
      }
      return out;
    });
  }

  accountByKey(key: string, keyVersion: number): Promise<Account | null> {
    return this.read((tx) => {
      const e = tx.get('names', nameKeyOf(text('key', key), int('keyVersion', keyVersion)));
      if (!e || e.kind !== 'current' || e.account === null) return null;
      return tx.get('accounts', e.account) ?? null;
    });
  }

  updateAccount(id: AccountId, version: number, patch: AccountPatch): Promise<Account> {
    return this.write([id, version, patch], (tx, id, version, patch) => {
      const a = needAccount(tx, text('id', id));
      int('version', version);
      const p = patchObject('patch', patch, ACCOUNT_PATCH_KEYS);
      if (a.version !== version) throw err('conflict', 'the account changed since it was read');
      const next = accountRow({ ...a, ...p, version: a.version + 1 });
      tx.put('accounts', a.id, next);
      return next;
    });
  }

  rename(id: AccountId, version: number, next: NameHistoryRow, opts: RenameOptions): Promise<Account> {
    return this.write([id, version, next, opts], (tx, id, version, next, opts) => {
      const a = needAccount(tx, text('id', id));
      int('version', version);
      const h = historyRow(next);
      if (h.account !== a.id) throw err('value', 'the name history row belongs to another account');
      if (typeof opts !== 'object' || opts === null) throw err('value', 'the rename options are not an object');
      const now = time('opts.now', opts.now);
      const oldKind = oneOf('opts.oldKind', opts.oldKind, ['held', 'banned'] as const);
      const holdUntil = timeOrNull('opts.holdUntil', opts.holdUntil);
      const allow = idList('opts.allow', opts.allow).map((x) => oneOf('opts.allow', x, ['ownHeld', 'reserved'] as const));
      if (a.version !== version) throw err('conflict', 'the account changed since it was read');
      // INTERFACE CHANGE (M14-11): the new key is made under the current name data version, as a registration's is
      const current = tx.get('meta', NAME_VERSION) ?? INITIAL_NAME_KEY_VERSION;
      if (h.keyVersion !== current) throw err('conflict', `the current name data version is ${current}, not ${h.keyVersion}`);
      const newK = nameKeyOf(h.key, h.keyVersion);
      const oldK = nameKeyOf(a.nameKey, a.keyVersion);
      if (newK === oldK) throw err('exists', 'the name key is the account\'s current one');
      const e = tx.get('names', newK);
      if (!isFree(e, tMs(now))) {
        const ok = (e!.kind === 'held' && e!.account === a.id && allow.includes('ownHeld')) || (e!.kind === 'reserved' && allow.includes('reserved'));
        if (!ok) throw err('exists', 'the name key is taken');
      }
      // name_history's key is (account_id, from_at) (11.5): a row starts after the one before it, as PostgreSQL would insist (review of M14-4)
      const rows0 = tx.get('history', a.id) ?? [];
      const last = rows0[rows0.length - 1];
      if (last !== undefined && tMs(h.from) <= tMs(last.from)) throw err('conflict', 'the name history row does not start after the last one');
      // a ban keeps the account it was taken from (INTERFACE CHANGE, M14-15 review A6: NameEntry.account)
      tx.put('names', oldK, { key: a.nameKey, keyVersion: a.keyVersion, kind: oldKind, account: a.id, until: holdUntil, note: null, createdAt: now });
      tx.put('names', newK, { key: h.key, keyVersion: h.keyVersion, kind: 'current', account: a.id, until: null, note: null, createdAt: now });
      const rows = rows0.map((r) => (r.to === null ? { ...r, to: h.from } : r));
      tx.put('history', a.id, [...rows, h]);
      const out = accountRow({ ...a, name: h.name, nameKey: h.key, keyVersion: h.keyVersion, renamedAt: now, version: a.version + 1 });
      tx.put('accounts', a.id, out);
      return out;
    });
  }

  nameEntry(key: string, keyVersion: number): Promise<NameEntry | null> {
    return this.read((tx) => tx.get('names', nameKeyOf(text('key', key), int('keyVersion', keyVersion))) ?? null);
  }

  putNameEntry(e: NameEntry): Promise<void> {
    return this.write([e], (tx, e) => {
      const row = nameEntryRow(e);
      // a hold for nobody (a forced rename's, M14-6) has an end; reserved and banned keys need none
      const hold = row.kind === 'held' && row.until !== null;
      if (row.kind !== 'reserved' && row.kind !== 'banned' && !hold) throw err('value', 'only reserved, banned and ending held keys are put directly');
      if (row.account !== null) throw err('value', 'a key put directly belongs to no account');
      const k = nameKeyOf(row.key, row.keyVersion);
      if (tx.get('names', k)?.kind === 'current') throw err('conflict', 'the key is an account\'s current name');
      tx.put('names', k, row);
    });
  }

  deleteNameEntry(key: string, keyVersion: number): Promise<void> {
    return this.write([key, keyVersion], (tx, key, keyVersion) => {
      const k = nameKeyOf(text('key', key), int('keyVersion', keyVersion));
      const e = tx.get('names', k);
      if (!e) throw err('notFound', 'no such name entry');
      if (e.kind === 'current') throw err('conflict', 'the key is an account\'s current name');
      tx.del('names', k);
    });
  }

  nameHistory(id: AccountId): Promise<NameHistoryRow[]> {
    return this.read((tx) => tx.get('history', text('id', id)) ?? []);
  }

  redactName(id: AccountId, key: string): Promise<void> {
    return this.write([id, key], (tx, id, key) => {
      const a = needAccount(tx, text('id', id));
      text('key', key);
      const rows = tx.get('history', a.id) ?? [];
      if (!rows.some((r) => r.key === key && !r.redacted)) return;
      tx.put('history', a.id, rows.map((r) => (r.key === key ? { ...r, redacted: true } : r)));
    });
  }

  findAccounts(keyPrefix: string, limit: number): Promise<Account[]> {
    return this.read((tx) => {
      const p = text('keyPrefix', keyPrefix);
      const n = limitOf(limit);
      return [...tx.rows('accounts')].filter((a) => a.nameKey.startsWith(p)).sort(byKeys((a) => a.nameKey, (a) => a.keyVersion, (a) => a.id)).slice(0, n);
    });
  }

  /** Accounts not signed in to (or, never signed in, made) before `before`, with no deletion pending: oldest first, after the cursor `after`. */
  inactiveSince(before: string, limit: number, after?: ListCursor): Promise<Account[]> {
    return this.read((tx) => {
      const b = ms('before', before);
      const n = limitOf(limit);
      const c = cursorOf(after);
      const last = (a: Account) => tMs(a.lastSignInAt ?? a.createdAt);
      return [...tx.rows('accounts')]
        .filter((a) => a.deletion === null && last(a) < b && afterCursor(last(a), a.id, c))
        .sort(byKeys(last, (a) => a.id))
        .slice(0, n);
    });
  }

  // ---- name data versions (6.3) ----

  nameKeyVersion(): Promise<number> {
    return this.read((tx) => tx.get('meta', NAME_VERSION) ?? INITIAL_NAME_KEY_VERSION);
  }

  /**
   * Entries in (key, keyVersion) order, keys after `after` (code-point order). A key's entries under two versions are never split across pages: the
   * page goes on past `limit` until the last key's entries are all in it.
   */
  nameEntries(after: string | null, limit: number): Promise<NameEntry[]> {
    return this.read((tx) => {
      const from = textOrNull('after', after);
      const n = limitOf(limit);
      const all = [...tx.rows('names')].filter((e) => from === null || compareText(e.key, from) > 0).sort(byKeys((e) => e.key, (e) => e.keyVersion));
      if (all.length <= n) return all;
      let end = n;
      if (n > 0) while (end < all.length && all[end]!.key === all[n - 1]!.key) end++;
      return all.slice(0, end);
    });
  }

  rekey(from: number, to: number, keys: ReadonlyMap<string, string>): Promise<void> {
    return this.write([from, to, keys], (tx, from, to, keys) => {
      int('from', from);
      int('to', to);
      if (from === to) throw err('value', 'rekey needs two different versions');
      if (!(keys instanceof Map)) throw err('value', 'keys is not a Map');
      const map = new Map<string, string>();
      for (const [o, n] of keys) map.set(word('an old key', o), word('a new key', n));
      const current = tx.get('meta', NAME_VERSION) ?? INITIAL_NAME_KEY_VERSION;
      if (current !== from) throw err('conflict', `the current name data version is ${current}, not ${from}`);
      const moving = [...tx.entries('names')].filter(([, e]) => e.keyVersion === from);
      const targets = new Map<string, NameEntry>();
      for (const [, e] of moving) {
        const nk = map.get(e.key);
        if (nk === undefined) throw err('conflict', 'the key map is incomplete: a name entry changed since the check');
        const target = nameKeyOf(nk, to);
        if (targets.has(target) || tx.get('names', target) !== undefined) throw err('conflict', 'two names fold to one new key');
        targets.set(target, { ...e, key: nk, keyVersion: to });
      }
      const accounts = [...tx.rows('accounts')].filter((a) => a.keyVersion === from);
      for (const a of accounts) if (!map.has(a.nameKey)) throw err('conflict', 'the key map is incomplete: an account changed since the check');
      for (const [k] of moving) tx.del('names', k);
      for (const [k, e] of targets) tx.put('names', k, e);
      for (const a of accounts) tx.put('accounts', a.id, { ...a, nameKey: map.get(a.nameKey)!, keyVersion: to, version: a.version + 1 });
      for (const [id, rows] of [...tx.entries('history')]) {
        if (!rows.some((r) => r.keyVersion === from && map.has(r.key))) continue;
        tx.put('history', id, rows.map((r) => (r.keyVersion === from && map.has(r.key) ? { ...r, key: map.get(r.key)!, keyVersion: to } : r)));
      }
      tx.put('meta', NAME_VERSION, to);
    });
  }

  // ---- credentials, recovery codes, device proofs (4) ----

  credentials(id: AccountId): Promise<CredentialRow[]> {
    return this.read((tx) => {
      const a = text('id', id);
      return [...tx.rows('credentials')].filter((c) => c.account === a).sort(byKeys((c) => c.provider, (c) => c.subject));
    });
  }

  credentialBySubject(provider: CredentialRow['provider'], subject: string): Promise<CredentialRow | null> {
    return this.read((tx) => tx.get('credentials', credentialKeyOf(oneOf('provider', provider, PROVIDERS), text('subject', subject))) ?? null);
  }

  putCredential(c: CredentialRow, expectSecret?: string | null): Promise<void> {
    return this.write([c, expectSecret], (tx, c, expectSecret) => {
      const row = credentialRow(c);
      const cas = expectSecret !== undefined;
      const expect = cas ? textOrNull('expectSecret', expectSecret) : null;
      needAccount(tx, row.account);
      const k = credentialKeyOf(row.provider, row.subject);
      const cur = tx.get('credentials', k);
      if (cur && cur.account !== row.account) throw err('exists', 'the subject belongs to another account');
      if (cas && (!cur || cur.secret !== expect)) throw err('conflict', 'the credential changed since it was read');
      tx.put('credentials', k, row);
    });
  }

  deleteCredential(id: AccountId, provider: CredentialRow['provider'], subject: string): Promise<void> {
    return this.write([id, provider, subject], (tx, id, provider, subject) => {
      const a = text('id', id);
      const k = credentialKeyOf(oneOf('provider', provider, PROVIDERS), text('subject', subject));
      const cur = tx.get('credentials', k);
      if (!cur || cur.account !== a) throw err('notFound', 'no such credential of this account');
      let count = 0;
      for (const c of tx.rows('credentials')) if (c.account === a) count++;
      if (count <= 1) throw err('conflict', 'it is the account\'s last way to sign in');
      tx.del('credentials', k);
    });
  }

  replaceRecoveryCodes(id: AccountId, rows: RecoveryCodeRow[]): Promise<void> {
    return this.write([id, rows], (tx, id, rows) => {
      const a = needAccount(tx, text('id', id));
      if (!Array.isArray(rows)) throw err('value', 'rows is not an array');
      const list = rows.map(recoveryRow).sort(byKeys((r) => r.slot));
      list.forEach((r, i) => {
        if (r.account !== a.id) throw err('value', 'a recovery code belongs to another account');
        if (i > 0 && list[i - 1]!.slot === r.slot) throw err('value', `recovery slot ${r.slot} twice`);
      });
      if (list.length === 0) tx.del('recovery', a.id);
      else tx.put('recovery', a.id, list);
    });
  }

  recoveryCodes(id: AccountId): Promise<RecoveryCodeRow[]> {
    return this.read((tx) => tx.get('recovery', text('id', id)) ?? []);
  }

  spendRecoveryCode(id: AccountId, slot: number, hash: string, at: string): Promise<boolean> {
    return this.write([id, slot, hash, at], (tx, id, slot, hash, at) => {
      const a = text('id', id);
      int('slot', slot);
      text('hash', hash);
      const when = time('at', at);
      const rows = tx.get('recovery', a) ?? [];
      const row = rows.find((r) => r.slot === slot);
      if (!row || row.hash !== hash || row.usedAt !== null) return false;
      tx.put('recovery', a, rows.map((r) => (r.slot === slot ? { ...r, usedAt: when } : r)));
      return true;
    });
  }

  putDevice(d: DeviceRow): Promise<void> {
    return this.write([d], (tx, d) => {
      const row = deviceRow(d);
      needAccount(tx, row.account);
      const cur = tx.get('devices', row.hash);
      if (cur && cur.account !== row.account) throw err('exists', 'the device proof belongs to another account');
      tx.put('devices', row.hash, row);
    });
  }

  device(hash: string): Promise<DeviceRow | null> {
    return this.read((tx) => tx.get('devices', text('hash', hash)) ?? null);
  }

  devicesOf(account: AccountId): Promise<DeviceRow[]> {
    return this.read((tx) => {
      const a = text('account', account);
      return [...tx.rows('devices')].filter((d) => d.account === a).sort(byKeys((d) => tMs(d.createdAt), (d) => d.hash));
    });
  }

  updateDevice(hash: string, patch: Partial<Pick<DeviceRow, 'lastUsedAt' | 'failures'>>): Promise<void> {
    return this.write([hash, patch], (tx, hash, patch) => {
      const cur = tx.get('devices', text('hash', hash));
      const p = patchObject('patch', patch, ['lastUsedAt', 'failures']);
      if (!cur) throw err('notFound', 'no such device proof');
      tx.put('devices', cur.hash, deviceRow({ ...cur, ...p }));
    });
  }

  deleteDevices(id: AccountId, except?: string): Promise<number> {
    return this.write([id, except], (tx, id, except) => {
      const a = text('id', id);
      const keep = except === undefined ? null : text('except', except);
      let n = 0;
      for (const d of [...tx.rows('devices')]) {
        if (d.account === a && d.hash !== keep) {
          tx.del('devices', d.hash);
          n++;
        }
      }
      return n;
    });
  }

  // ---- sessions (5.2) ----

  putSession(s: AccountSessionRow): Promise<void> {
    return this.write([s], (tx, s) => {
      const row = sessionRow(s);
      needAccount(tx, row.account);
      const cur = tx.get('sessions', row.id);
      if (cur && cur.account !== row.account) throw err('exists', 'the session id belongs to another account');
      if (sessionsHolding(tx, row.tokenHash, row.id) || (row.previousHash !== null && sessionsHolding(tx, row.previousHash, row.id))) {
        throw err('exists', 'the token hash belongs to another session');
      }
      tx.put('sessions', row.id, row);
    });
  }

  sessionByTokenHash(hash: string): Promise<{ row: AccountSessionRow; match: 'current' | 'previous' } | null> {
    return this.read((tx) => {
      const h = text('hash', hash);
      for (const s of tx.rows('sessions')) {
        if (s.tokenHash === h) return { row: s, match: 'current' as const };
        if (s.previousHash === h) return { row: s, match: 'previous' as const };
      }
      return null;
    });
  }

  rotateSession(id: string, expectCurrent: string, nextHash: string, at: string): Promise<number | null> {
    return this.write([id, expectCurrent, nextHash, at], (tx, id, expectCurrent, nextHash, at) => {
      const cur = tx.get('sessions', text('id', id));
      const expect = text('expectCurrent', expectCurrent);
      const next = word('nextHash', nextHash);
      const when = time('at', at);
      if (!cur || cur.revokedAt !== null || cur.tokenHash !== expect) return null;
      if (next === expect || sessionsHolding(tx, next, null)) throw err('exists', 'the new token hash is in use');
      const rotation = cur.rotation + 1;
      tx.put('sessions', cur.id, { ...cur, previousHash: expect, tokenHash: next, rotatedAt: when, rotation });
      return rotation;
    });
  }

  rerotateInGrace(id: string, expectPrevious: string, nextHash: string): Promise<number | null> {
    return this.write([id, expectPrevious, nextHash], (tx, id, expectPrevious, nextHash) => {
      const cur = tx.get('sessions', text('id', id));
      const expect = text('expectPrevious', expectPrevious);
      const next = word('nextHash', nextHash);
      if (!cur || cur.revokedAt !== null || cur.previousHash === null || cur.previousHash !== expect) return null;
      if (next === expect || sessionsHolding(tx, next, null)) throw err('exists', 'the new token hash is in use');
      const rotation = cur.rotation + 1;
      tx.put('sessions', cur.id, { ...cur, tokenHash: next, rotation });
      return rotation;
    });
  }

  updateSession(id: string, patch: Partial<Pick<AccountSessionRow, 'lastUsedAt' | 'authAt' | 'proofFailures'>>): Promise<void> {
    return this.write([id, patch], (tx, id, patch) => {
      const cur = tx.get('sessions', text('id', id));
      const p = patchObject('patch', patch, ['lastUsedAt', 'authAt', 'proofFailures']);
      if (!cur) throw err('notFound', 'no such session');
      tx.put('sessions', cur.id, sessionRow({ ...cur, ...p }));
    });
  }

  revokeSession(account: AccountId, id: string, reason: AccountSessionRow['revokeReason'], at: string): Promise<void> {
    return this.write([account, id, reason, at], (tx, account, id, reason, at) => {
      const a = text('account', account);
      const cur = tx.get('sessions', text('id', id));
      const why = oneOf('reason', reason, REVOKE_REASONS);
      const when = time('at', at);
      if (!cur || cur.account !== a) throw err('notFound', 'no such session of this account');
      if (cur.revokedAt === null) tx.put('sessions', cur.id, { ...cur, revokedAt: when, revokeReason: why });
    });
  }

  revokeSessions(account: AccountId, reason: AccountSessionRow['revokeReason'], at: string, except?: string): Promise<string[]> {
    return this.write([account, reason, at, except], (tx, account, reason, at, except) => {
      const a = text('account', account);
      const why = oneOf('reason', reason, REVOKE_REASONS);
      const when = time('at', at);
      const keep = except === undefined ? null : text('except', except);
      const out: string[] = [];
      for (const s of [...tx.rows('sessions')].sort(byKeys((x) => x.id))) {
        if (s.account !== a || s.revokedAt !== null || s.id === keep) continue;
        tx.put('sessions', s.id, { ...s, revokedAt: when, revokeReason: why });
        out.push(s.id);
      }
      return out;
    });
  }

  sessionsOf(account: AccountId): Promise<AccountSessionRow[]> {
    return this.read((tx) => {
      const a = text('account', account);
      return [...tx.rows('sessions')].filter((s) => s.account === a).sort(byKeys((s) => tMs(s.createdAt), (s) => s.id));
    });
  }

  sessionById(id: string): Promise<AccountSessionRow | null> {
    return this.read((tx) => tx.get('sessions', text('id', id)) ?? null);
  }

  // ---- guest claims (5.5) ----

  claimGuest(c: ClaimRow): Promise<void> {
    return this.write([c], (tx, c) => {
      const row = claimRow(c);
      needAccount(tx, row.account);
      if (tx.get('claims', row.session)) throw err('exists', 'the guest session is claimed');
      tx.put('claims', row.session, row);
    });
  }

  claimsOf(account: AccountId): Promise<ClaimRow[]> {
    return this.read((tx) => {
      const a = text('account', account);
      return [...tx.rows('claims')].filter((c) => c.account === a).sort(byKeys((c) => tMs(c.claimedAt), (c) => c.session));
    });
  }

  // ---- relations (9.1) ----

  setRelation(r: RelationRow): Promise<void> {
    return this.write([r], (tx, r) => {
      const row = relationRow(r);
      needAccount(tx, row.account);
      // INTERFACE CHANGE (M14-15, review A2): an `other` with no account is dropped here, in the same transaction, not refused
      if (!tx.get('accounts', row.other)) return;
      tx.put('relations', relationKeyOf(row.account, row.other, row.kind), row);
    });
  }

  deleteRelation(account: AccountId, other: AccountId, kind: RelationRow['kind']): Promise<void> {
    return this.write([account, other, kind], (tx, account, other, kind) => {
      tx.del('relations', relationKeyOf(text('account', account), text('other', other), oneOf('kind', kind, RELATION_KINDS)));
    });
  }

  relationsOf(account: AccountId): Promise<RelationRow[]> {
    return this.read((tx) => {
      const a = text('account', account);
      return [...tx.rows('relations')].filter((r) => r.account === a).sort(byKeys((r) => tMs(r.createdAt), (r) => r.other, (r) => r.kind));
    });
  }

  relationsAmong(ids: readonly AccountId[]): Promise<RelationRow[]> {
    return this.read((tx) => {
      const set = new Set(idList('ids', ids));
      return [...tx.rows('relations')]
        .filter((r) => set.has(r.account) && set.has(r.other))
        .sort(byKeys((r) => r.account, (r) => r.other, (r) => r.kind));
    });
  }

  // ---- email codes (3.4) ----

  putEmailCode(c: EmailCodeRow, now: string): Promise<void> {
    return this.write([c, now], (tx, c, now) => {
      const row = emailCodeRow(c);
      const t = ms('now', now);
      needAccount(tx, row.account);
      if (tx.get('emailCodes', row.id)) throw err('exists', 'the email code id exists');
      let live = 0;
      for (const x of tx.rows('emailCodes')) {
        if (x.account === row.account && x.purpose === row.purpose && x.usedAt === null && tMs(x.expiresAt) > t) live++;
      }
      // the configured emailResetLiveCodes (3 by default), as PostgreSQL checks it in the inserting transaction (11.5)
      const max = this.liveCodesMax;
      if (live >= max) throw err('conflict', `the account has ${max} live codes of this purpose`);
      tx.put('emailCodes', row.id, row);
    });
  }

  liveEmailCodes(account: AccountId, purpose: EmailCodeRow['purpose'], now: string): Promise<EmailCodeRow[]> {
    return this.read((tx) => {
      const a = text('account', account);
      const p = oneOf('purpose', purpose, EMAIL_PURPOSES);
      const t = ms('now', now);
      return [...tx.rows('emailCodes')]
        .filter((x) => x.account === a && x.purpose === p && x.usedAt === null && tMs(x.expiresAt) > t)
        .sort(byKeys((x) => tMs(x.createdAt), (x) => x.id));
    });
  }

  /** True exactly once, and only before the code expires (at < expiresAt). */
  useEmailCode(id: string, at: string): Promise<boolean> {
    return this.write([id, at], (tx, id, at) => {
      const cur = tx.get('emailCodes', text('id', id));
      const when = time('at', at);
      if (!cur || cur.usedAt !== null || tMs(cur.expiresAt) <= tMs(when)) return false;
      tx.put('emailCodes', cur.id, { ...cur, usedAt: when });
      return true;
    });
  }

  deleteEmailCodes(account: AccountId, purpose: EmailCodeRow['purpose']): Promise<void> {
    return this.write([account, purpose], (tx, account, purpose) => {
      const a = text('account', account);
      const p = oneOf('purpose', purpose, EMAIL_PURPOSES);
      for (const x of [...tx.rows('emailCodes')]) if (x.account === a && x.purpose === p) tx.del('emailCodes', x.id);
    });
  }

  // ---- moderation (9) ----

  putReport(r: ReportRow): Promise<void> {
    return this.write([r], (tx, r) => {
      const row = reportRow(r);
      if (tx.get('reports', row.id)) throw err('exists', 'the report id exists');
      // INTERFACE CHANGE (M14-15, review A2): a report about an account that has none is dropped here, in the same transaction
      if ('account' in row.target && !tx.get('accounts', row.target.account)) return;
      tx.put('reports', row.id, row);
    });
  }

  report(id: string): Promise<ReportRow | null> {
    return this.read((tx) => tx.get('reports', text('id', id)) ?? null);
  }

  /** In id order (report ids are ULIDs: oldest first), after the id `after`; `guestSession`: filed by that guest session or about it. */
  reports(q: ReportQuery): Promise<ReportRow[]> {
    return this.read((tx) => {
      if (typeof q !== 'object' || q === null) throw err('value', 'the query is not an object');
      const n = limitOf(q.limit);
      const status = q.status === undefined ? undefined : oneOf('status', q.status, ['new', 'actioned', 'dismissed'] as const);
      const target = q.target === undefined ? undefined : text('target', q.target);
      const reporter = q.reporter === undefined ? undefined : text('reporter', q.reporter);
      const guest = q.guestSession === undefined ? undefined : text('guestSession', q.guestSession);
      const after = q.after === undefined ? undefined : text('after', q.after);
      return [...tx.rows('reports')]
        .filter(
          (r) =>
            (status === undefined || r.status === status) &&
            (target === undefined || ('account' in r.target && r.target.account === target)) &&
            (reporter === undefined || (r.reporter?.kind === 'account' && r.reporter.account === reporter)) &&
            (guest === undefined ||
              (r.reporter?.kind === 'guest' && r.reporter.session === guest) ||
              ('guestSession' in r.target && r.target.guestSession === guest)) &&
            (after === undefined || compareText(r.id, after) > 0),
        )
        .sort(byKeys((r) => r.id))
        .slice(0, n);
    });
  }

  closeReport(id: string, status: Exclude<ReportRow['status'], 'new'>, by: string, at: string, note: string | null): Promise<void> {
    return this.write([id, status, by, at, note], (tx, id, status, by, at, note) => {
      const cur = tx.get('reports', text('id', id));
      const s = oneOf('status', status, ['actioned', 'dismissed'] as const);
      const who = word('by', by);
      const when = time('at', at);
      const n = textOrNull('note', note);
      if (!cur) throw err('notFound', 'no such report');
      if (cur.status !== 'new') throw err('conflict', 'the report is closed already');
      tx.put('reports', cur.id, { ...cur, status: s, closedAt: when, closedBy: who, note: n });
    });
  }

  putSanction(s: SanctionRow): Promise<void> {
    return this.write([s], (tx, s) => {
      const row = sanctionRow(s);
      needAccount(tx, row.account);
      if (tx.get('sanctions', row.id)) throw err('exists', 'the sanction id exists');
      tx.put('sanctions', row.id, row);
    });
  }

  sanction(id: string): Promise<SanctionRow | null> {
    return this.read((tx) => tx.get('sanctions', text('id', id)) ?? null);
  }

  sanctionsOf(account: AccountId): Promise<SanctionRow[]> {
    return this.read((tx) => {
      const a = text('account', account);
      return [...tx.rows('sanctions')].filter((s) => s.account === a).sort(byKeys((s) => tMs(s.since), (s) => tMs(s.createdAt), (s) => s.id));
    });
  }

  runningSanctions(ids: readonly AccountId[], now: string): Promise<Map<AccountId, SanctionRow[]>> {
    return this.read((tx) => {
      const set = new Set(idList('ids', ids));
      const t = time('now', now);
      const out = new Map<AccountId, SanctionRow[]>();
      for (const s of [...tx.rows('sanctions')].sort(byKeys((x) => tMs(x.since), (x) => tMs(x.createdAt), (x) => x.id))) {
        if (!set.has(s.account) || !sanctionRuns(s, t)) continue;
        const list = out.get(s.account);
        if (list) list.push(s);
        else out.set(s.account, [s]);
      }
      return out;
    });
  }

  endSanction(id: string, at: string, reason: SanctionEnd, by: string): Promise<void> {
    return this.write([id, at, reason, by], (tx, id, at, reason, by) => {
      const cur = tx.get('sanctions', text('id', id));
      const when = time('at', at);
      const why = oneOf('reason', reason, SANCTION_ENDS);
      const who = word('by', by);
      if (!cur) throw err('notFound', 'no such sanction');
      if (cur.endedAt !== null) throw err('conflict', 'the sanction has ended already');
      tx.put('sanctions', cur.id, { ...cur, endedAt: when, endReason: why, endedBy: who });
    });
  }

  sanctionsEndingBy(at: string, limit: number): Promise<SanctionRow[]> {
    return this.read((tx) => {
      const t = ms('at', at);
      const n = limitOf(limit);
      return [...tx.rows('sanctions')]
        .filter((s) => s.endedAt === null && s.until !== null && tMs(s.until) <= t)
        .sort(byKeys((s) => tMs(s.until!), (s) => s.id))
        .slice(0, n);
    });
  }

  markSeen(account: AccountId, sanction: string, at: string): Promise<void> {
    return this.write([account, sanction, at], (tx, account, sanction, at) => {
      const a = text('account', account);
      const cur = tx.get('sanctions', text('sanction', sanction));
      const when = time('at', at);
      if (!cur || cur.account !== a) throw err('notFound', 'no such sanction of this account');
      if (cur.seenAt === null) tx.put('sanctions', cur.id, { ...cur, seenAt: when });
    });
  }

  putAppeal(a: AppealRow): Promise<void> {
    return this.write([a], (tx, a) => {
      const row = appealRow(a);
      const s = tx.get('sanctions', row.sanction);
      if (!s || s.account !== row.account) throw err('notFound', 'no such sanction of this account');
      if (tx.get('appeals', row.sanction)) throw err('exists', 'the sanction has an appeal');
      tx.put('appeals', row.sanction, row);
    });
  }

  /** open true: unanswered only; false: answered only; absent: all. Oldest first. */
  appeals(q: { open?: boolean; account?: AccountId; limit: number; after?: string }): Promise<AppealRow[]> {
    return this.read((tx) => {
      if (typeof q !== 'object' || q === null) throw err('value', 'the query is not an object');
      const n = limitOf(q.limit);
      const open = q.open === undefined ? undefined : bool('open', q.open);
      const account = q.account === undefined ? undefined : text('account', q.account);
      const order = byKeys<AppealRow>((x) => tMs(x.createdAt), (x) => x.sanction);
      const after = q.after === undefined ? undefined : tx.get('appeals', text('after', q.after)) ?? null;
      if (after === null) return [];
      return [...tx.rows('appeals')]
        .filter((x) => (open === undefined || (x.answer === null) === open) && (account === undefined || x.account === account))
        .filter((x) => after === undefined || order(x, after) > 0)
        .sort(order)
        .slice(0, n);
    });
  }

  appeal(sanction: string): Promise<AppealRow | null> {
    return this.read((tx) => tx.get('appeals', text('sanction', sanction)) ?? null);
  }

  answerAppeal(sanction: string, answer: 'upheld' | 'lifted', message: string, by: string, at: string): Promise<void> {
    return this.write([sanction, answer, message, by, at], (tx, sanction, answer, message, by, at) => {
      const cur = tx.get('appeals', text('sanction', sanction));
      const ans = oneOf('answer', answer, ['upheld', 'lifted'] as const);
      const msg = text('message', message);
      const who = word('by', by);
      const when = time('at', at);
      if (!cur) throw err('notFound', 'no such appeal');
      if (cur.answer !== null) throw err('conflict', 'the appeal is answered already');
      tx.put('appeals', cur.sanction, { ...cur, answer: ans, answerMessage: msg, answeredAt: when, answeredBy: who });
    });
  }

  // ---- the audit log and the change feed (8.5, 9.7) ----

  /**
   * Appends every event or none: 'exists' when an id is taken (an event is never replaced). An erased account's events are kept as erase leaves
   * them (keptEvent), so a request that was running at the erasure writes nothing of the account back.
   */
  appendAudit(events: readonly AuditEvent[]): Promise<void> {
    return this.write([events], (tx, events) => {
      if (!Array.isArray(events)) throw err('value', 'events is not an array');
      const rows = events.map(auditRow);
      const ids = new Set<string>();
      for (const e of rows) {
        if (tx.get('audit', e.id) || ids.has(e.id)) throw err('exists', 'the audit event id exists');
        ids.add(e.id);
      }
      for (const e of rows) {
        const kept = keptEvent(tx, e);
        if (kept !== null) tx.put('audit', kept.id, kept);
      }
    });
  }

  /** Oldest first (at, then id); `since` inclusive, `before` exclusive. */
  audit(q: AuditQuery): Promise<AuditEvent[]> {
    return this.read((tx) => {
      if (typeof q !== 'object' || q === null) throw err('value', 'the query is not an object');
      const n = limitOf(q.limit);
      const account = q.account === undefined ? undefined : text('account', q.account);
      const kinds = q.kinds === undefined ? undefined : new Set(idList('kinds', q.kinds));
      const since = q.since === undefined ? undefined : ms('since', q.since);
      const before = q.before === undefined ? undefined : ms('before', q.before);
      return [...tx.rows('audit')]
        .filter(
          (e) =>
            (account === undefined || e.account === account) &&
            (kinds === undefined || kinds.has(e.kind)) &&
            (since === undefined || tMs(e.at) >= since) &&
            (before === undefined || tMs(e.at) < before),
        )
        .sort(byKeys((e) => tMs(e.at), (e) => e.id))
        .slice(0, n);
    });
  }

  /** An erased account's change other than `deleted` is refused ('notFound') and nothing is appended. */
  appendChange(c: Omit<AccountChange, 'seq'>): Promise<number> {
    return this.write([c], (tx, c) => {
      const seq = (tx.get('meta', CHANGE_SEQ) ?? 0) + 1;
      const row = changeRow(c, seq);
      if (row.kind !== 'deleted' && tx.get('tombstones', row.account)) throw err('notFound', 'the account is erased');
      tx.put('meta', CHANGE_SEQ, seq);
      tx.put('changes', String(seq), row);
      return seq;
    });
  }

  changes(after: number, limit: number): Promise<AccountChange[]> {
    return this.read((tx) => {
      const from = int('after', after);
      const n = limitOf(limit);
      return [...tx.rows('changes')].filter((c) => c.seq > from).sort(byKeys((c) => c.seq)).slice(0, n);
    });
  }

  /** The newest seq given out: it never goes back, not even when purge has removed every change. */
  changesHead(): Promise<number> {
    return this.read((tx) => tx.get('meta', CHANGE_SEQ) ?? 0);
  }

  // ---- deletion and retention (10) ----

  /** By purgeAt, then id, after the cursor `after`. */
  dueDeletions(at: string, limit: number, after?: ListCursor): Promise<AccountId[]> {
    return this.read((tx) => {
      const t = ms('at', at);
      const n = limitOf(limit);
      const c = cursorOf(after);
      return [...tx.rows('accounts')]
        .filter((a) => a.deletion !== null && tMs(a.deletion.purgeAt) <= t && afterCursor(tMs(a.deletion.purgeAt), a.id, c))
        .sort(byKeys((a) => tMs(a.deletion!.purgeAt), (a) => a.id))
        .slice(0, n)
        .map((a) => a.id);
    });
  }

  /**
   * 10.2 step 5. Refused ('conflict') unless the account's erasure has been claimed: `deletion.erasingAt` set (10.2 step 3) and `purgeAt` at or
   * before the tombstone's `deletedAt`, the store's "now" here (what purge_audit and erase_player check in PostgreSQL, 11.5). A second call after
   * the tombstone finds nothing more and changes nothing ('notFound' for an id that never existed).
   *
   * Besides 11.2's list (review of M14-4):
   * - **No name or email in any free text that stays** (13.2's byte search: no name or email anywhere). Every name the account has had and its email
   *   address are replaced by "Deleted player", matched without regard to case, in every row that holds typed text, whoever's row it is: reports'
   *   `text` and `note`, sanctions' `message` and `note`, appeals' `text` and `answerMessage`, names entries' `note`, and a reserved key's `name`
   *   (dropped whole, M14-15). A reporter, an operator or another account's appeal that typed the name or the address leaves no copy of it.
   * - **Its claimed guest sessions are the account** (5.5): a report filed by one or about one is handled as one filed by or about the account
   *   (closed: removed; open: no reporter, or `targetName` "Deleted player"), since the guest's name there is usually the player's own.
   * A `targetName` of a report about anyone else is that target's name and stays as it is.
   */
  erase(id: AccountId, tombstone: TombstoneRow, nameHoldUntil: string): Promise<void> {
    return this.write([id, tombstone, nameHoldUntil], (tx, id, tombstone, nameHoldUntil) => {
      const x = text('id', id);
      const ts = tombstoneRow(tombstone);
      const hold = time('nameHoldUntil', nameHoldUntil);
      if (ts.account !== x) throw err('value', 'the tombstone is of another account');
      const a = tx.get('accounts', x);
      if (!a) {
        if (tx.get('tombstones', x)) return;
        throw err('notFound', 'no such account');
      }
      if (a.deletion === null || a.deletion.erasingAt === null || tMs(a.deletion.purgeAt) > tMs(ts.deletedAt)) {
        throw err('conflict', 'the account\'s erasure has not been claimed');
      }
      const scrub = scrubberOf([a.name, ...(tx.get('history', x) ?? []).map((r) => r.name), ...(a.email ? [a.email.address] : [])]);
      // its claimed guest sessions, read before the claims go: reports by or about them are the account's (5.5)
      const guests = new Set<string>();
      for (const c of tx.rows('claims')) if (c.account === x) guests.add(c.session);
      tx.del('accounts', x);
      for (const [k, e] of [...tx.entries('names')]) {
        if (e.account !== x) continue;
        if (e.kind === 'current') tx.put('names', k, { ...e, kind: 'held', account: null, until: hold });
        else tx.put('names', k, { ...e, account: null });
      }
      tx.del('history', x);
      tx.del('recovery', x);
      for (const [k, c] of [...tx.entries('credentials')]) if (c.account === x) tx.del('credentials', k);
      for (const d of [...tx.rows('devices')]) if (d.account === x) tx.del('devices', d.hash);
      for (const s of [...tx.rows('sessions')]) if (s.account === x) tx.del('sessions', s.id);
      for (const c of [...tx.rows('claims')]) if (c.account === x) tx.del('claims', c.session);
      for (const [k, r] of [...tx.entries('relations')]) if (r.account === x || r.other === x) tx.del('relations', k);
      for (const c of [...tx.rows('emailCodes')]) if (c.account === x) tx.del('emailCodes', c.id);
      const gone = new Set<string>();
      for (const s of [...tx.rows('sanctions')]) {
        if (s.account !== x) continue;
        gone.add(s.id);
        tx.del('sanctions', s.id);
      }
      for (const ap of [...tx.rows('appeals')]) if (ap.account === x || gone.has(ap.sanction)) tx.del('appeals', ap.sanction);
      for (const r of [...tx.rows('reports')]) {
        const filed = (r.reporter?.kind === 'account' && r.reporter.account === x) || (r.reporter?.kind === 'guest' && guests.has(r.reporter.session));
        const about = ('account' in r.target && r.target.account === x) || ('guestSession' in r.target && guests.has(r.target.guestSession));
        if ((filed || about) && r.status !== 'new') {
          tx.del('reports', r.id);
          continue;
        }
        const related = r.related.includes(x);
        let next: ReportRow = { ...r, text: scrub(r.text), note: scrub(r.note) };
        if (filed) next = { ...next, reporter: null };
        if (about) next = { ...next, targetName: DELETED_PLAYER_NAME };
        if (related) next = { ...next, related: next.related.filter((y) => y !== x) };
        if (filed || about || related || next.text !== r.text || next.note !== r.note) tx.put('reports', r.id, next);
      }
      // the free text of every other row that stays (other accounts' sanctions and appeals, the operator's notes on names entries)
      for (const s of [...tx.rows('sanctions')]) {
        const message = scrub(s.message)!;
        const note = scrub(s.note);
        if (message !== s.message || note !== s.note) tx.put('sanctions', s.id, { ...s, message, note });
      }
      for (const ap of [...tx.rows('appeals')]) {
        const t = scrub(ap.text)!;
        const answerMessage = scrub(ap.answerMessage);
        if (t !== ap.text || answerMessage !== ap.answerMessage) tx.put('appeals', ap.sanction, { ...ap, text: t, answerMessage });
      }
      for (const [k, e] of [...tx.entries('names')]) {
        const note = scrub(e.note);
        // a reserved key's name (M14-15, review A7) that holds one of them is dropped whole: a scrubbed name would key to something else
        const dropName = e.name !== undefined && scrub(e.name) !== e.name;
        if (note !== e.note || dropName) {
          const { name, ...rest } = e;
          tx.put('names', k, { ...rest, note, ...(name !== undefined && !dropName ? { name } : {}) });
        }
      }
      for (const e of [...tx.rows('audit')]) {
        if (e.account !== x || e.kind === 'deleted') continue;
        if (AUDIT_CATEGORY[e.kind] === 'operator') tx.put('audit', e.id, { ...e, account: null });
        else tx.del('audit', e.id);
      }
      for (const [k, c] of [...tx.entries('changes')]) if (c.account === x && c.kind !== 'deleted') tx.del('changes', k);
      tx.put('tombstones', x, { row: ts, holdUntil: hold });
    });
  }

  tombstone(id: AccountId): Promise<TombstoneRow | null> {
    return this.read((tx) => tx.get('tombstones', text('id', id))?.row ?? null);
  }

  /**
   * Retention (10.3) at `now`: sessions revoked or expired more than revokedSessionsMs ago; device proofs unused for deviceIdleMs; email codes used
   * or expired; names entries whose `until` has passed; reports closed more than closedReportsMs ago; security events older than securityAuditMs
   * (never a `deleted` event while its tombstone stays) and operator events older than operatorAuditMs, neither ever younger than the floors
   * purge_audit keeps (DEFAULT_ACCOUNT_RETENTION: 180 and 730 days), moderation events never; changes older than changesMs; tombstones once the name
   * hold their erase wrote and their sanctionUntil (when set) have both passed. adminExportMs and inactiveAccountMs are the rights part's (files and
   * deletions), not the store's.
   */
  purge(policy: AccountRetention, now: string): Promise<AccountPurgeReport> {
    return this.write([policy, now], (tx, policy, now) => {
      if (typeof policy !== 'object' || policy === null) throw err('value', 'the policy is not an object');
      const t = ms('now', now);
      const p = (k: keyof AccountRetention) => int(`policy.${k}`, policy[k]);
      const report: AccountPurgeReport = { sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 };
      const sessionsMs = p('revokedSessionsMs');
      for (const s of [...tx.rows('sessions')]) {
        const end = s.revokedAt !== null ? Math.min(tMs(s.revokedAt), tMs(s.expiresAt)) : tMs(s.expiresAt);
        if (end + sessionsMs <= t) {
          tx.del('sessions', s.id);
          report.sessions++;
        }
      }
      const deviceMs = p('deviceIdleMs');
      for (const d of [...tx.rows('devices')]) {
        if (tMs(d.lastUsedAt) + deviceMs <= t) {
          tx.del('devices', d.hash);
          report.devices++;
        }
      }
      for (const c of [...tx.rows('emailCodes')]) {
        if (c.usedAt !== null || tMs(c.expiresAt) <= t) {
          tx.del('emailCodes', c.id);
          report.emailCodes++;
        }
      }
      for (const [k, e] of [...tx.entries('names')]) {
        if (e.kind !== 'current' && e.until !== null && tMs(e.until) <= t) {
          tx.del('names', k);
          report.names++;
        }
      }
      const reportsMs = p('closedReportsMs');
      for (const r of [...tx.rows('reports')]) {
        if (r.status !== 'new' && r.closedAt !== null && tMs(r.closedAt) + reportsMs <= t) {
          tx.del('reports', r.id);
          report.reports++;
        }
      }
      for (const [k, ts] of [...tx.entries('tombstones')]) {
        if (tMs(ts.holdUntil) <= t && (ts.row.sanctionUntil === null || tMs(ts.row.sanctionUntil) <= t)) {
          tx.del('tombstones', k);
          report.tombstones++;
        }
      }
      const securityMs = Math.max(p('securityAuditMs'), DEFAULT_ACCOUNT_RETENTION.securityAuditMs);
      const operatorMs = Math.max(p('operatorAuditMs'), DEFAULT_ACCOUNT_RETENTION.operatorAuditMs);
      for (const e of [...tx.rows('audit')]) {
        const cat = AUDIT_CATEGORY[e.kind];
        const age = t - tMs(e.at);
        const old =
          (cat === 'security' && age >= securityMs && !(e.kind === 'deleted' && e.account !== null && tx.get('tombstones', e.account))) ||
          (cat === 'operator' && age >= operatorMs);
        if (old) {
          tx.del('audit', e.id);
          report.audit++;
        }
      }
      const changesMs = p('changesMs');
      for (const [k, c] of [...tx.entries('changes')]) {
        if (tMs(c.at) + changesMs <= t) {
          tx.del('changes', k);
          report.changes++;
        }
      }
      return report;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
