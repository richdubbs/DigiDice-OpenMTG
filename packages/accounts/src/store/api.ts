/**
 * Storage behind one interface (D18). MemoryAccountStore (unit tests) and PostgresAccountStore (11.5: production, and development, where it runs on
 * PGlite in ACCOUNTS_DATA_DIR behind a lock file against a second process: src/store/pglite.ts; F26 replaced M14-4's journal-and-snapshot file
 * store with it). One contract suite (test/m14-4/contract.ts) runs against both.
 *
 * Rules every implementation keeps:
 * - Timestamps are ISO-8601 UTC strings; durations are in milliseconds. A method that decides by time takes `now`; none reads a clock.
 * - Atomic where sections 4-6 and 10 need it: a name key is claimed once (createAccount, rename); a credential's secret changes by compare-and-set; a
 *   recovery code is spent once and only while its slot holds its hash; a session rotates by compare-and-set; an email code is used once;
 *   updateAccount checks `version`; a sanction ends once; one appeal per sanction.
 * - Ownership: a method that takes an account and the id of one of its rows (revokeSession, putAppeal) touches the row only if it is that account's,
 *   and answers 'notFound' otherwise, the same as for no row.
 * - The change feed is gap-free for readers: changes(after) never returns seq n + 1 while seq n is not yet committed.
 * - Text the PostgreSQL store would refuse (NUL, unpaired surrogates) is refused by all ('value'), as m13's store/rules.ts does (copied, 11.8:
 *   src/text.ts's textProblem and jsonbProblem, and STORE_ID for ids).
 * - Secrets are hashes only. Addresses are never stored (D15).
 * - Audit events are never updated by the service; they are removed only by purge (by AUDIT_CATEGORY, 10.3) and by erase (10.2), which in PostgreSQL
 *   both go through accounts.purge_audit (11.5).
 * - erase leaves no row behind (PostgreSQL keeps the bytes of deleted rows in its files until it reuses the space, as any PostgreSQL database does).
 *
 * Design: docs/design/m14-accounts.md, sections 11.2 and 11.5 (M14-1). The stores themselves are M14-4's (memory) and M14-11's (PostgreSQL).
 */
import type {
  Account, AccountChange, AccountId, AccountSession, AuditEvent, AuditKind, ProviderId, RelationKind, ReportReason, ReportStatus, SanctionEnd,
  SanctionReason, SanctionSpan,
} from '../api';

/**
 * INTERFACE CHANGE (review of M14-4): 'notCompacted', the old file store's answer to an erase or a rekey that was committed but whose snapshot rewrite
 * failed: calling erase again finished it. No store answers it since F26 removed the file store ('corrupt' likewise); the rights part still
 * handles it (src/rights/deletion.ts, OwedErasures). 'locked': the development store's directory is in use by another opener (src/store/lock.ts).
 */
/**
 * INTERFACE CHANGE (M14-11): 'schema', the PostgreSQL store's answer at open to a database whose `accounts` schema is not the version this build needs
 * (ACCOUNTS_SCHEMA_VERSION): not migrated, or migrated by another build. Run the migrate command (hosted's runner, accounts first), then open again.
 */
export type StoreErrorCode = 'notFound' | 'exists' | 'conflict' | 'value' | 'closed' | 'locked' | 'corrupt' | 'notCompacted' | 'schema';
/** A refusal by a store (every method rejects with this, never with anything else, for any refusal the contract names). */
export class AccountStoreError extends Error {
  constructor(readonly code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'AccountStoreError';
  }
}

export type NameKind = 'current' | 'held' | 'reserved' | 'banned';
export interface NameEntry {
  key: string; keyVersion: number; kind: NameKind;
  /**
   * The account for current and held keys, and for a banned key the account it was taken from (a forced rename); null for reserved keys, nobody's
   * holds, and bans put directly or left by an erased account. INTERFACE CHANGE (M14-15, review A6): a forced rename's ban keeps its account, so
   * sign-in, recovery and the email reset still reach the owner by the old name while the ban lasts (9.4); erase sets it to null.
   */
  account: AccountId | null;
  /** Holds: when the key is free again (free once until <= now). */
  until: string | null;
  note: string | null; createdAt: string;
  /**
   * The name a reserved key was made from, as the operator gave it (its display form), so `rekey` keys it again from that name under new data
   * (6.3) rather than from the old key. INTERFACE CHANGE (M14-15, review A7): added; absent on entries made before it and on every other kind.
   * erase drops it when it holds a name or the address of the erased account, as it scrubs a note.
   */
  name?: string;
}
export interface NameHistoryRow {
  account: AccountId; name: string; key: string; keyVersion: number; from: string; to: string | null; cause: 'register' | 'rename' | 'forced';
  redacted: boolean;
}
export interface CredentialRow {
  account: AccountId;
  provider: ProviderId;
  /** The account id (local), the provider's `sub` (shopify), the credential id (passkey). Unique per provider. */
  subject: string;
  /** The PHC string (local), the public key (passkey), null (shopify). */
  secret: string | null;
  /** Small server-built JSON: the passkey's signature counter and transports. */
  meta: Record<string, string | number | boolean | null>;
  createdAt: string;
  lastUsedAt: string | null;
}
export interface RecoveryCodeRow { account: AccountId; slot: number; hash: string; generation: number; createdAt: string; usedAt: string | null }
/** failures: rule 2's counter (8.2), stored; rules 1 and 3 count in memory. */
export interface DeviceRow { hash: string; account: AccountId; createdAt: string; lastUsedAt: string; failures: number }
export interface AccountSessionRow extends AccountSession {
  tokenHash: string;
  previousHash: string | null;
  /** Bumped by every rotation (5.2); the client keeps the token with the highest. Starts at 0. */
  rotation: number;
  /** The hash of the device proof this session signed in with, if any (a password change keeps that one, 8.3). */
  device: string | null;
  /** Wrong proofs in a row (5.2); 5 revoke the session. */
  proofFailures: number;
}
export interface ClaimRow { session: string; account: AccountId; claimedAt: string }
export interface RelationRow { account: AccountId; other: AccountId; kind: RelationKind; createdAt: string }
/** Tries are counted per (code, address key) in memory, never here (D15). */
export interface EmailCodeRow {
  id: string; account: AccountId; purpose: 'verify' | 'reset'; hash: string; createdAt: string; expiresAt: string; usedAt: string | null;
}
export type ReporterRef = { kind: 'account'; account: AccountId } | { kind: 'guest'; session: string } | { kind: 'system'; source: string };
export type ReportTarget = { account: AccountId } | { guestSession: string };
export interface ReportRow {
  id: string;
  /** null: the reporter was deleted (10.2). */
  reporter: ReporterRef | null;
  target: ReportTarget;
  /** The target's display name at the time ("Deleted player" once it is erased): all the reporter's export shows of the target. */
  targetName: string;
  reason: ReportReason; game: string | null; text: string | null;
  /** Only from a `system` reporter (9.2). */
  related: AccountId[];
  evidence: { games: string[]; stats: Record<string, number> } | null;
  status: ReportStatus; createdAt: string; closedAt: string | null; closedBy: string | null; note: string | null;
}
export interface SanctionRow extends SanctionSpan {
  id: string; account: AccountId; reason: SanctionReason; message: string; note: string | null;
  createdAt: string; createdBy: string; reports: string[];
  /** With SanctionSpan.endedAt: how it ended and who ended it (an operator, 'system' for an expiry). */
  endReason: SanctionEnd | null; endedBy: string | null;
  /** `warn`: when the account marked it seen; SelfView lists a warning until then. */
  seenAt: string | null;
}
export interface AppealRow {
  sanction: string; account: AccountId; text: string; createdAt: string;
  answer: 'upheld' | 'lifted' | null; answerMessage: string | null; answeredAt: string | null; answeredBy: string | null;
}
export interface TombstoneRow { account: AccountId; deletedAt: string; sanctionUntil: string | null; holdersDone: string[] }

/** A registration in one atomic step. */
export interface NewAccount {
  account: Account;
  credential: CredentialRow;               // local (a PHC string) or an external provider
  recovery: RecoveryCodeRow[];             // 10, or none for a provider-only account until it asks
  history: NameHistoryRow;
  claim: ClaimRow | null;
  session: AccountSessionRow;
  device: DeviceRow;
  audit: AuditEvent[];
}

export type AccountPatch = Partial<Pick<Account, 'avatar' | 'privacy' | 'email' | 'lastSignInAt' | 'freeRename' | 'deletion' | 'inactiveNoticeAt'>>;

export interface RenameOptions {
  /**
   * The old key becomes 'held' for this account until holdUntil (a rename), or 'banned' (a forced rename, 9.4), with the account too (INTERFACE
   * CHANGE, M14-15: NameEntry.account).
   */
  oldKind: 'held' | 'banned';
  holdUntil: string | null;
  /** Taken keys this rename may claim besides free ones: its own held key (a take-back), a reserved key (the operator's --to). */
  allow: readonly ('ownHeld' | 'reserved')[];
  now: string;
}

export interface AuditQuery { account?: AccountId; kinds?: AuditKind[]; since?: string; before?: string; limit: number }
/**
 * INTERFACE CHANGE (M14-7): `guestSession`, the reports filed by that guest session or about it (an export reads its claimed sessions' reports
 * without the whole table, 10.1).
 */
export interface ReportQuery {
  status?: ReportStatus; target?: AccountId; reporter?: AccountId; guestSession?: string; limit: number; after?: string;
}
/**
 * INTERFACE CHANGE (M14-7): where a listing in time order goes on (inactiveSince, dueDeletions): after the row of `account` at `at` (its time in
 * that listing), the last one a page held, in the listing's order (time, then id). The rights part's tick pages on from tick to tick, so a full page
 * of accounts that wait (an inactive notice's 30 days, a holder that answers pending) never hides the ones after it.
 */
export interface ListCursor { at: string; account: AccountId }

/**
 * Retention (10.3), in milliseconds like every duration in both milestones' records and configuration (the comments give days). purge_audit
 * (11.5) never deletes younger security events or any live account's other events, whatever these say.
 */
export interface AccountRetention {
  revokedSessionsMs: number;       // 7 days
  deviceIdleMs: number;            // 365 days
  closedReportsMs: number;         // 365 days
  securityAuditMs: number;         // 180 days
  operatorAuditMs: number;         // 730 days
  changesMs: number;               // 7 days
  adminExportMs: number;           // 1 day
  inactiveAccountMs: number;       // 1,095 days (the deletion itself goes through the service, 10.2)
}
export interface AccountPurgeReport {
  sessions: number; devices: number; emailCodes: number; names: number; reports: number; audit: number; changes: number; tombstones: number;
}

export interface AccountStore {
  // ---- accounts and names (6.5)
  /** 'exists' unless n.account's key is free: no entry, or an entry with until <= now. */
  createAccount(n: NewAccount, now: string): Promise<void>;
  account(id: AccountId): Promise<Account | null>;
  accounts(ids: readonly AccountId[]): Promise<Map<AccountId, Account>>;
  /** By the current name's key under data version `keyVersion` (sign-in tries the current version, then the other one, 6.3). */
  accountByKey(key: string, keyVersion: number): Promise<Account | null>;
  /** 'conflict' on another version. */
  updateAccount(id: AccountId, version: number, patch: AccountPatch): Promise<Account>;
  /**
   * Claims next.key atomically when it is free (no entry, or until <= opts.now), held by this account ('ownHeld' allowed) or reserved ('reserved'
   * allowed); otherwise 'exists'. Sets name, nameKey, keyVersion and renamedAt, closes the previous name-history row's `to`, writes the old key as
   * opts.oldKind, bumps version ('conflict' on another version). INTERFACE CHANGE (review of M14-4): 'conflict' too when next.from is not later than
   * the last name-history row's from (name_history's key is (account_id, from_at), 11.5), checked after the key.
   */
  rename(id: AccountId, version: number, next: NameHistoryRow, opts: RenameOptions): Promise<Account>;
  nameEntry(key: string, keyVersion: number): Promise<NameEntry | null>;
  /**
   * Reserved or banned keys (the operator); 'conflict' when the key is an account's current key. INTERFACE CHANGE (M14-6): also a hold for nobody
   * (kind 'held', account null, an `until`), as erase leaves: a forced rename turns the keys the account still holds from its own renames into
   * such holds (9.4, 6.5), over the entry that is there.
   */
  putNameEntry(e: NameEntry): Promise<void>;
  /** Frees a reserved, banned or held key; 'conflict' for a current key. */
  deleteNameEntry(key: string, keyVersion: number): Promise<void>;
  nameHistory(id: AccountId): Promise<NameHistoryRow[]>;
  redactName(id: AccountId, key: string): Promise<void>;
  findAccounts(keyPrefix: string, limit: number): Promise<Account[]>;        // the operator's `find`
  /**
   * Accounts last signed in to (never signed in: made) before `before`, with no deletion pending, oldest first (that time, then id); after `after`
   * when given (ListCursor, INTERFACE CHANGE (M14-7)).
   */
  inactiveSince(before: string, limit: number, after?: ListCursor): Promise<Account[]>;
  // ---- name data versions (6.3)
  nameKeyVersion(): Promise<number>;
  /** Every names entry, for `rekey --check`, in key order. */
  nameEntries(after: string | null, limit: number): Promise<NameEntry[]>;
  /** Rewrites every key from version `from` to `to` (`keys`: old key to new key, complete) and the current version, in one transaction; 'conflict' on a collision. */
  rekey(from: number, to: number, keys: ReadonlyMap<string, string>): Promise<void>;
  // ---- credentials, recovery codes, device proofs (4)
  credentials(id: AccountId): Promise<CredentialRow[]>;
  credentialBySubject(provider: ProviderId, subject: string): Promise<CredentialRow | null>;
  /**
   * With expectSecret given (a string or null): a compare-and-set, 'conflict' unless the stored row for (provider, subject) has exactly that secret
   * (the rehash passes the PHC string it verified, 4.1). Without it: an upsert for the same account. 'exists' when the subject belongs to another account.
   */
  putCredential(c: CredentialRow, expectSecret?: string | null): Promise<void>;
  /** 'conflict' when it is the account's last way to sign in. */
  deleteCredential(id: AccountId, provider: ProviderId, subject: string): Promise<void>;
  replaceRecoveryCodes(id: AccountId, rows: RecoveryCodeRow[]): Promise<void>;
  recoveryCodes(id: AccountId): Promise<RecoveryCodeRow[]>;
  /** True exactly once, and only while slot `slot` still holds `hash` (a code of a replaced generation never spends a slot of the new one). */
  spendRecoveryCode(id: AccountId, slot: number, hash: string, at: string): Promise<boolean>;
  putDevice(d: DeviceRow): Promise<void>;
  device(hash: string): Promise<DeviceRow | null>;
  /** INTERFACE CHANGE (M14-7): every device proof of the account, by createdAt, then hash (the export lists them all, 10.1, not its sessions' only). */
  devicesOf(account: AccountId): Promise<DeviceRow[]>;
  updateDevice(hash: string, patch: Partial<Pick<DeviceRow, 'lastUsedAt' | 'failures'>>): Promise<void>;
  deleteDevices(id: AccountId, except?: string): Promise<number>;
  // ---- sessions (5.2)
  putSession(s: AccountSessionRow): Promise<void>;
  sessionByTokenHash(hash: string): Promise<{ row: AccountSessionRow; match: 'current' | 'previous' } | null>;
  /** A normal rotation, compare-and-set on the current hash: previousHash = expectCurrent, rotatedAt = at, rotation + 1. The new rotation, or null. */
  rotateSession(id: string, expectCurrent: string, nextHash: string, at: string): Promise<number | null>;
  /** Inside the grace, compare-and-set on the previous hash: tokenHash = nextHash, rotation + 1; previousHash and rotatedAt unchanged. Or null. */
  rerotateInGrace(id: string, expectPrevious: string, nextHash: string): Promise<number | null>;
  updateSession(id: string, patch: Partial<Pick<AccountSessionRow, 'lastUsedAt' | 'authAt' | 'proofFailures'>>): Promise<void>;
  /** Only a session of `account`; 'notFound' otherwise. */
  revokeSession(account: AccountId, id: string, reason: AccountSession['revokeReason'], at: string): Promise<void>;
  revokeSessions(account: AccountId, reason: AccountSession['revokeReason'], at: string, except?: string): Promise<string[]>;
  sessionsOf(account: AccountId): Promise<AccountSessionRow[]>;
  /** One session by its id (a primary-key read), revoked or not; null for an id with none. The guard checks the row's account against the Auth's. */
  sessionById(id: string): Promise<AccountSessionRow | null>;
  // ---- guest claims (5.5)
  claimGuest(c: ClaimRow): Promise<void>;                                    // 'exists' when the session is claimed
  claimsOf(account: AccountId): Promise<ClaimRow[]>;
  // ---- relations (9.1)
  /**
   * 'notFound' when r.account has no account. INTERFACE CHANGE (M14-15, review A2): a relation to an `other` that has no account (erased, or never
   * made) is dropped, checked in the same transaction: nothing is stored and nothing refused, so the moderation part answers every id alike with
   * one store call (7.3). An entry already there is replaced.
   */
  setRelation(r: RelationRow): Promise<void>;
  deleteRelation(account: AccountId, other: AccountId, kind: RelationKind): Promise<void>;
  relationsOf(account: AccountId): Promise<RelationRow[]>;
  relationsAmong(ids: readonly AccountId[]): Promise<RelationRow[]>;
  // ---- email codes (3.4)
  /** 'conflict' when the account already has emailResetLiveCodes live (unused, unexpired at `now`) codes of that purpose (AccountStoreLimits). */
  putEmailCode(c: EmailCodeRow, now: string): Promise<void>;
  liveEmailCodes(account: AccountId, purpose: EmailCodeRow['purpose'], now: string): Promise<EmailCodeRow[]>;
  /** True exactly once. */
  useEmailCode(id: string, at: string): Promise<boolean>;
  deleteEmailCodes(account: AccountId, purpose: EmailCodeRow['purpose']): Promise<void>;
  // ---- moderation (9)
  /**
   * 'exists' when the id is taken. INTERFACE CHANGE (M14-15, review A2): a report about an account that has none (erased, or never made) is
   * dropped, checked in the same transaction: nothing is stored and nothing refused (9.2, 7.3: one store call for every target).
   */
  putReport(r: ReportRow): Promise<void>;
  report(id: string): Promise<ReportRow | null>;
  reports(q: ReportQuery): Promise<ReportRow[]>;
  closeReport(id: string, status: Exclude<ReportStatus, 'new'>, by: string, at: string, note: string | null): Promise<void>;
  putSanction(s: SanctionRow): Promise<void>;
  /**
   * One sanction by its id, ended or not; null for an id with none. INTERFACE CHANGE (M14-6): the operator's lift and answer name a sanction by its
   * id only, and sanctionsOf needs its account (the moderation part found that through the audit log before).
   */
  sanction(id: string): Promise<SanctionRow | null>;
  sanctionsOf(account: AccountId): Promise<SanctionRow[]>;
  /** The sanctions of many accounts not ended at `now` (for standings and names). */
  runningSanctions(ids: readonly AccountId[], now: string): Promise<Map<AccountId, SanctionRow[]>>;
  /** Records the end once; 'conflict' when it has ended already. */
  endSanction(id: string, at: string, reason: SanctionEnd, by: string): Promise<void>;
  /** Sanctions with until <= at and no endedAt, for `tick`, which records each as expired. */
  sanctionsEndingBy(at: string, limit: number): Promise<SanctionRow[]>;
  /** A warning marked seen; 'notFound' unless the sanction is `account`'s. */
  markSeen(account: AccountId, sanction: string, at: string): Promise<void>;
  /** 'exists': one appeal per sanction; 'notFound' unless the sanction is a.account's. */
  putAppeal(a: AppealRow): Promise<void>;
  /**
   * Oldest first (createdAt, then the sanction id). INTERFACE CHANGE (M14-6): `after`, a sanction id, gives the appeals after that sanction's
   * appeal in this order (the operator's pages, 9.6); none when that sanction has no appeal.
   */
  appeals(q: { open?: boolean; account?: AccountId; limit: number; after?: string }): Promise<AppealRow[]>;
  /** The appeal of one sanction (a primary-key read: one appeal per sanction), answered or not; null when it has none. */
  appeal(sanction: string): Promise<AppealRow | null>;
  answerAppeal(sanction: string, answer: 'upheld' | 'lifted', message: string, by: string, at: string): Promise<void>;
  // ---- the audit log and the change feed (8.5, 9.7)
  /**
   * Every event or none ('exists' when an id is taken). INTERFACE CHANGE (M14-7): an erased account's events (its tombstone is there: a request that
   * was running at its erasure) are kept as erase leaves them, checked in the same transaction: `deleted` as it is, an operator event without its
   * account (null), any other dropped (never refused, so the audit queue is never held up by one).
   */
  appendAudit(events: readonly AuditEvent[]): Promise<void>;
  audit(q: AuditQuery): Promise<AuditEvent[]>;
  /**
   * Appends and returns the seq. Readers never see seq n + 1 before n is committed (11.5 for PostgreSQL). INTERFACE CHANGE (M14-7): a change of an
   * erased account (its tombstone is there) other than `deleted` is refused ('notFound': the account is gone), checked in the same transaction, and
   * nothing is appended (a change answers a seq its listeners are told, so one that is not kept cannot be dropped quietly).
   */
  appendChange(c: Omit<AccountChange, 'seq'>): Promise<number>;
  changes(after: number, limit: number): Promise<AccountChange[]>;
  /** The newest committed seq: a reader that starts fresh begins here instead of replaying 7 days. */
  changesHead(): Promise<number>;
  // ---- deletion and retention (10)
  /** Accounts whose purgeAt has come by `at`, oldest purgeAt first (then id); after `after` when given (ListCursor, INTERFACE CHANGE (M14-7)). */
  dueDeletions(at: string, limit: number, after?: ListCursor): Promise<AccountId[]>;
  /**
   * 10.2 step 5: every row of the account (relations both ways, sanctions and appeals, the closed reports it filed and the closed reports about it,
   * its audit events but `deleted`, its operator events' account id, its changes but `deleted`); its id scrubbed from other reports' `related`;
   * targetName "Deleted player" on open reports about it; its held keys turned into holds for nobody; its current key held until nameHoldUntil; the
   * tombstone written last. INTERFACE CHANGE (review of M14-4): every name it has had and its email address are replaced by "Deleted player" in the free text of every row that stays, whoever's
   * (reports' text and note, sanctions' message and note, appeals' text and answerMessage, names entries' note), and reports filed by or about one
   * of its claimed guest sessions are handled as its own (13.2's byte search: no name or email anywhere).
   */
  erase(id: AccountId, tombstone: TombstoneRow, nameHoldUntil: string): Promise<void>;
  tombstone(id: AccountId): Promise<TombstoneRow | null>;
  purge(policy: AccountRetention, now: string): Promise<AccountPurgeReport>;
  close(): Promise<void>;
}

const STORE_METHODS = [
  'createAccount', 'account', 'accounts', 'accountByKey', 'updateAccount', 'rename', 'nameEntry', 'putNameEntry', 'deleteNameEntry', 'nameHistory',
  'redactName', 'findAccounts', 'inactiveSince',
  'nameKeyVersion', 'nameEntries', 'rekey',
  'credentials', 'credentialBySubject', 'putCredential', 'deleteCredential', 'replaceRecoveryCodes', 'recoveryCodes', 'spendRecoveryCode', 'putDevice',
  'device', 'devicesOf', 'updateDevice', 'deleteDevices',
  'putSession', 'sessionByTokenHash', 'rotateSession', 'rerotateInGrace', 'updateSession', 'revokeSession', 'revokeSessions', 'sessionsOf',
  'sessionById',
  'claimGuest', 'claimsOf',
  'setRelation', 'deleteRelation', 'relationsOf', 'relationsAmong',
  'putEmailCode', 'liveEmailCodes', 'useEmailCode', 'deleteEmailCodes',
  'putReport', 'report', 'reports', 'closeReport', 'putSanction', 'sanction', 'sanctionsOf', 'runningSanctions', 'endSanction', 'sanctionsEndingBy',
  'markSeen', 'putAppeal', 'appeals', 'appeal', 'answerAppeal',
  'appendAudit', 'audit', 'appendChange', 'changes', 'changesHead',
  'dueDeletions', 'erase', 'tombstone', 'purge', 'close',
] as const satisfies readonly (keyof AccountStore)[];
/** Compile-time: every method of AccountStore is listed (a missing one makes this `false` and fails the typecheck). */
const STORE_METHODS_COMPLETE: Exclude<keyof AccountStore, (typeof STORE_METHODS)[number]> extends never ? true : false = true;
void STORE_METHODS_COMPLETE;

/** Pinned against the interface by test/m14-1/store.test.ts; the contract suite covers each. */
export const ACCOUNT_STORE_METHODS: readonly (keyof AccountStore)[] = Object.freeze([...STORE_METHODS]);

// ---- Where the stores come from (M14-1's composition, src/compose.ts; built by M14-4 in src/store/index.ts) --------------------------------------
/**
 * The configured limits a store enforces itself. INTERFACE CHANGE (review of M14-4): the configuration lets ACCOUNTS_EMAIL_RESET_LIVE_CODES
 * override `emailResetLiveCodes` (11.7), so the store takes the configured value instead of the constant and the service and the store agree; a
 * store made without it keeps ACCOUNT_RATE_LIMITS' 3 (11.5's figure). PostgresAccountStore (M14-11) takes the same.
 */
export interface AccountStoreLimits {
  /** putEmailCode's cap: live (unused, unexpired) codes per account and purpose. A whole number from 0. */
  emailResetLiveCodes?: number;
}
/** The memory store (unit tests): `createMemoryAccountStore` of src/store/index.ts. */
export type CreateMemoryAccountStore = (opts?: AccountStoreLimits) => AccountStore;
/**
 * The development store under `dir` (ACCOUNTS_STORE=file, ACCOUNTS_DATA_DIR): `openFileAccountStore` of src/store/index.ts, the PostgreSQL store on
 * PGlite in `<dir>/db` (src/store/pglite.ts). Opening takes the lock file (a second opener is refused, 'locked') and applies the migrations it lacks.
 */
export type OpenFileAccountStore = (opts: { dir: string } & AccountStoreLimits) => Promise<AccountStore>;
/**
 * INTERFACE CHANGE (M14-11): the PostgreSQL store on a migrated database (`openPostgresAccountStore` of src/store/index.ts; 11.5). The host (hosted at the
 * sync, the composition root) makes the `AccountsSql` from its `SqlClient` and passes the store to composeAccounts as `host.store`. Refuses ('schema') a
 * database that is not at ACCOUNTS_SCHEMA_VERSION (and then leaves the `AccountsSql` open: the caller closes it); never runs DDL. Closing the store
 * closes the `AccountsSql`.
 */
export type OpenPostgresAccountStore = (sql: AccountsSql, opts?: AccountStoreLimits) => Promise<AccountStore>;

// ---- The PostgreSQL seam (11.5; PostgresAccountStore is M14-11's, at the sync) --------------------------------------------------------------------
/**
 * The structural interface PostgresAccountStore runs on, so accounts imports nothing of hosted, not even a type (2.1). Hosted's `SqlClient` (m13
 * store/sql.ts) has exactly this shape; a type test at the sync (M14-11) pins the two as compatible.
 */
export interface AccountsSqlResult<R> { rows: R[]; rowCount: number }
export interface AccountsSqlQueryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<AccountsSqlResult<R>>;
  exec(sql: string): Promise<void>;
}
export interface AccountsSql extends AccountsSqlQueryable {
  transaction<T>(fn: (tx: AccountsSqlQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
