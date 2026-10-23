/**
 * `PostgresAccountStore` (M14-11; design 11.5): the production account store, on an `AccountsSql` (hosted's `SqlClient` over a `pg` pool, or PGlite in
 * the tests: accounts imports nothing of hosted). Parameterized queries only; every table is qualified (`accounts.<table>`), so no `search_path` is
 * assumed. The schema is migrations/001_accounts.sql, run by hosted's migration runner before this store opens (it never runs DDL, and refuses
 * 'schema' a database that is not at ACCOUNTS_SCHEMA_VERSION). The store is meant to run as the service's role of design 11.5, which the owner makes
 * and gives its rights with `SELECT accounts.grant_service('<role>')` after the migrations (the tests run the whole contract suite as that role).
 *
 * It answers every call as the memory and file stores do (one contract suite, test/m14-4/contract.ts), by the same rules: src/store/rules.ts builds
 * and checks every row and every key first, so a bad value is refused ('value') before the database is touched, and a write copies its arguments when
 * it is called. Then:
 * - **A write is one transaction**, and runs its checks and its changes inside it. A refusal rolls everything back. PostgreSQL's own refusals are
 *   mapped: a unique violation is 'exists', a foreign key violation 'notFound', a CHECK or a malformed value 'value'; anything else (a lost connection,
 *   a deadlock, a serialization failure) is left as it is, and the service answers 'unavailable'.
 * - **Compare-and-set is one UPDATE** where the design says so (the credential's secret, a recovery code, an email code, a sanction's end, a report's
 *   close, an appeal's answer); a read-modify-write under `SELECT ... FOR UPDATE` where the memory store's logic has more to say (a session's
 *   rotation, an account's update and rename, a rekey).
 * - **Lock order** (pinned statement by statement by test/m14-11/locks.test.ts): the name data version (shared; a rekey takes it exclusively), then the
 *   table of names (ROW EXCLUSIVE for a rename, an erase and an audit write about accounts; a rekey takes SHARE ROW EXCLUSIVE), then the account's row,
 *   so a rekey and a writer never wait for each other, and two writers of one key meet on its `names` row before anything else (a registration claims
 *   it first). A writer that attaches a row to an account takes the account's row `FOR KEY SHARE` first (needAccount), so an erase of the account waits
 *   for it and then removes what it wrote, or it finds the account gone: nothing is written for an erased account. An erase takes its own advisory lock
 *   first (erases are rare, so two never meet; the daily purge takes it too, since each deletes rows the other's tables hold), then the account's row
 *   `FOR UPDATE`, then the account's other rows. The change feed's advisory lock comes AFTER the account's row, so a change held up by an erase does not
 *   hold the feed meanwhile.
 * - **The erasure claim cannot be forged** (migration 001): the service's role has no INSERT or UPDATE on accounts.deletion_requested_at, purge_at and
 *   erasing_at. updateAccount maps a patch of `deletion` to one step (request, move, cancel, claim; holders added to `done` is a plain column) and
 *   calls the database's function for it (request_deletion, move_deletion, cancel_deletion, claim_erasure), which checks the step by the database's clock
 *   and the owner's deletion_policy and answers 'conflict' when it refuses; any other change of a deletion is refused ('value'). A new account has none.
 *   purge_audit(account) writes purge_ledger. A block, mute or report of an id with no account writes a pad row (write_pad), as the stored path writes its row.
 * - **The erased-account rule** (INTERFACE CHANGE (M14-7)) is checked in the writing transaction: appendAudit keeps only the `deleted` event and
 *   operator events (without the account) of an account whose tombstone is there, and appendChange refuses everything but `deleted` ('notFound').
 * - **The audit log is append-only for the service's role**: audit events leave only through `accounts.purge_audit`, which enforces the retention
 *   policy itself, by the database's clock (purge's `now` decides everything else). An erase calls it for the account, and refuses ('conflict', nothing
 *   changed) an account the database does not show as claimed and due (`accounts.erasure_claimed`), so the audit events are never left behind.
 * - **The change feed** is gap-free for readers: appendChange takes a transaction-scoped advisory lock (CHANGES_LOCK_KEY), then the next seq from
 *   `change_head`, and holds the lock until it commits, so a second writer (the admin command beside the server) waits, and seq n + 1 is never
 *   visible before n. `changesHead` is `change_head`, which never goes back, even when purge removed every change.
 *
 * Ordering is by time, then id, in code-point order (the id and key columns are COLLATE "C"), as the other stores list. Times are read back as the
 * canonical ISO-8601 UTC of the `timestamptz`.
 */
import { fileURLToPath } from 'node:url';
import { AUDIT_CATEGORY, DELETED_PLAYER_NAME, type Account, type AccountChange, type AccountId, type AuditEvent, type SanctionEnd } from '../api';
import {
  AccountStoreError, type AccountPatch, type AccountPurgeReport, type AccountRetention, type AccountSessionRow, type AccountsSql, type AccountsSqlQueryable,
  type AccountStore, type AccountStoreLimits, type AppealRow, type AuditQuery, type ClaimRow, type CredentialRow, type DeviceRow, type EmailCodeRow,
  type ListCursor, type NameEntry, type NameHistoryRow, type NewAccount, type RecoveryCodeRow, type RelationRow, type RenameOptions, type ReportQuery,
  type ReportRow, type SanctionRow, type StoreErrorCode, type TombstoneRow,
} from './api';
import { copyArgs, INITIAL_NAME_KEY_VERSION, liveCodesLimit, scrubberOf } from './memory';
import {
  EMAIL_PURPOSES, PROVIDERS, RELATION_KINDS, REVOKE_REASONS, SANCTION_ENDS, accountRow, appealRow, auditRow, bool, byKeys, changeRow, claimRow, compareText,
  credentialRow, cursorOf, deviceRow, emailCodeRow, historyRow, int, limitOf, ms, nameEntryRow, oneOf, recoveryRow, relationRow, reportRow, sanctionRow,
  sessionRow, storeError, text, textList, textOrNull, time, timeOrNull, tombstoneRow, word,
} from './rules';

/** The schema of the accounts package; its migrations record themselves in `accounts.schema_migrations` (hosted's runner). */
export const ACCOUNTS_SCHEMA = 'accounts';
/** The version of schema `accounts` this build needs (the newest migration's number, migrations/001_accounts.sql). */
export const ACCOUNTS_SCHEMA_VERSION = 1;
/** The directory of the accounts package's migration files, for hosted's runner: `migrate(sql, { schema: ACCOUNTS_SCHEMA, dir: ACCOUNTS_MIGRATIONS_DIR })`. */
export const ACCOUNTS_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
/** Key of the change feed's transaction-scoped advisory lock ("OMCH"); the migrators' key is hosted's (11.5). */
export const CHANGES_LOCK_KEY = 0x4f4d4348;
/** Key of the advisory lock an erase takes first ("OMER"): erases are rare, so two never run at once and never wait for each other's rows. */
export const ERASE_LOCK_KEY = 0x4f4d4552;

type Row = Record<string, unknown>;
const err = storeError;

// ---- reading rows ----------------------------------------------------------------------------------------------------------------------------

/** The canonical ISO-8601 UTC of a `timestamptz` as a driver gives it (a Date, or its text). */
function iso(v: unknown): string {
  return (v instanceof Date ? v : new Date(String(v))).toISOString();
}
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
/** A number a driver may give as text (bigint). */
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => v as string;
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const strings = (v: unknown): string[] => [...(v as string[])];

const ACCOUNT_COLUMNS =
  'id, name, name_key, key_version, avatar, privacy, email, email_verified_at, email_set_at, age_min, age_passed_at, created_at, last_sign_in_at, ' +
  'renamed_at, free_rename, deletion_requested_at, purge_at, erasing_at, deletion_done, inactive_notice_at, version';

function accountOf(r: Row): Account {
  const p = r['privacy'] as { history: 'public' | 'private'; leaderboards: boolean; guestsAtMyTables: boolean };
  return {
    id: str(r['id']) as AccountId,
    name: str(r['name']),
    nameKey: str(r['name_key']),
    keyVersion: num(r['key_version']),
    avatar: str(r['avatar']) as Account['avatar'],
    privacy: { history: p.history, leaderboards: p.leaderboards, guestsAtMyTables: p.guestsAtMyTables },
    email:
      r['email'] === null
        ? null
        : {
            address: str(r['email']),
            verifiedAt: isoOrNull(r['email_verified_at']),
            ...(r['email_set_at'] !== null ? { setAt: iso(r['email_set_at']) } : {}),
          },
    ageGate: { minAge: num(r['age_min']), passedAt: iso(r['age_passed_at']) },
    createdAt: iso(r['created_at']),
    lastSignInAt: isoOrNull(r['last_sign_in_at']),
    renamedAt: isoOrNull(r['renamed_at']),
    freeRename: r['free_rename'] as boolean,
    deletion:
      r['purge_at'] === null
        ? null
        : {
            requestedAt: iso(r['deletion_requested_at']),
            purgeAt: iso(r['purge_at']),
            erasingAt: isoOrNull(r['erasing_at']),
            done: strings(r['deletion_done']),
          },
    inactiveNoticeAt: isoOrNull(r['inactive_notice_at']),
    version: num(r['version']),
  };
}

/**
 * The columns a registration writes: every column but the erasure claim's three (deletion_requested_at, purge_at, erasing_at), which the service's role may
 * neither insert nor update (only the deletion functions of migration 001 write them), and which a new account has none of.
 */
const ACCOUNT_NEW_COLUMNS =
  'id, name, name_key, key_version, avatar, privacy, email, email_verified_at, email_set_at, age_min, age_passed_at, created_at, last_sign_in_at, ' +
  'renamed_at, free_rename, deletion_done, inactive_notice_at, version';
/** The parameters of ACCOUNT_NEW_COLUMNS, in order. */
function accountNewParams(a: Account): unknown[] {
  return [
    a.id, a.name, a.nameKey, a.keyVersion, a.avatar, JSON.stringify(a.privacy), a.email?.address ?? null, a.email?.verifiedAt ?? null, a.email?.setAt ?? null,
    a.ageGate.minAge, a.ageGate.passedAt, a.createdAt, a.lastSignInAt, a.renamedAt, a.freeRename, [], a.inactiveNoticeAt, a.version,
  ];
}

const NAME_COLUMNS = 'key, key_version, kind, account_id, until, note, created_at, name';
function nameEntryOf(r: Row): NameEntry {
  return {
    key: str(r['key']),
    keyVersion: num(r['key_version']),
    kind: str(r['kind']) as NameEntry['kind'],
    account: strOrNull(r['account_id']) as AccountId | null,
    until: isoOrNull(r['until']),
    note: strOrNull(r['note']),
    createdAt: iso(r['created_at']),
    ...(r['name'] !== null ? { name: str(r['name']) } : {}),
  };
}

const HISTORY_COLUMNS = 'account_id, name, key, key_version, from_at, to_at, cause, redacted';
const historyOf = (r: Row): NameHistoryRow => ({
  account: str(r['account_id']) as AccountId,
  name: str(r['name']),
  key: str(r['key']),
  keyVersion: num(r['key_version']),
  from: iso(r['from_at']),
  to: isoOrNull(r['to_at']),
  cause: str(r['cause']) as NameHistoryRow['cause'],
  redacted: r['redacted'] as boolean,
});

const CREDENTIAL_COLUMNS = 'provider, subject, account_id, secret, meta, created_at, last_used_at';
const credentialOf = (r: Row): CredentialRow => ({
  account: str(r['account_id']) as AccountId,
  provider: str(r['provider']) as CredentialRow['provider'],
  subject: str(r['subject']),
  secret: strOrNull(r['secret']),
  meta: { ...(r['meta'] as CredentialRow['meta']) },
  createdAt: iso(r['created_at']),
  lastUsedAt: isoOrNull(r['last_used_at']),
});

const RECOVERY_COLUMNS = 'account_id, slot, hash, generation, created_at, used_at';
const recoveryOf = (r: Row): RecoveryCodeRow => ({
  account: str(r['account_id']) as AccountId,
  slot: num(r['slot']),
  hash: str(r['hash']),
  generation: num(r['generation']),
  createdAt: iso(r['created_at']),
  usedAt: isoOrNull(r['used_at']),
});

const DEVICE_COLUMNS = 'hash, account_id, created_at, last_used_at, failures';
const deviceOf = (r: Row): DeviceRow => ({
  hash: str(r['hash']),
  account: str(r['account_id']) as AccountId,
  createdAt: iso(r['created_at']),
  lastUsedAt: iso(r['last_used_at']),
  failures: num(r['failures']),
});

const SESSION_COLUMNS =
  'id, account_id, token_hash, previous_hash, rotation, device_hash, provider, client, created_at, last_used_at, auth_at, rotated_at, expires_at, revoked_at, ' +
  'revoke_reason, proof_failures';
const sessionOf = (r: Row): AccountSessionRow => ({
  id: str(r['id']),
  account: str(r['account_id']) as AccountId,
  provider: str(r['provider']) as AccountSessionRow['provider'],
  client: str(r['client']) as AccountSessionRow['client'],
  createdAt: iso(r['created_at']),
  lastUsedAt: iso(r['last_used_at']),
  authAt: iso(r['auth_at']),
  rotatedAt: iso(r['rotated_at']),
  expiresAt: iso(r['expires_at']),
  revokedAt: isoOrNull(r['revoked_at']),
  revokeReason: strOrNull(r['revoke_reason']) as AccountSessionRow['revokeReason'],
  tokenHash: str(r['token_hash']),
  previousHash: strOrNull(r['previous_hash']),
  rotation: num(r['rotation']),
  device: strOrNull(r['device_hash']),
  proofFailures: num(r['proof_failures']),
});
const sessionParams = (s: AccountSessionRow): unknown[] => [
  s.id, s.account, s.tokenHash, s.previousHash, s.rotation, s.device, s.provider, s.client, s.createdAt, s.lastUsedAt, s.authAt, s.rotatedAt, s.expiresAt,
  s.revokedAt, s.revokeReason, s.proofFailures,
];

const CLAIM_COLUMNS = 'session_id, account_id, claimed_at';
const claimOf = (r: Row): ClaimRow => ({ session: str(r['session_id']), account: str(r['account_id']) as AccountId, claimedAt: iso(r['claimed_at']) });

const RELATION_COLUMNS = 'account_id, other_id, kind, created_at';
const relationOf = (r: Row): RelationRow => ({
  account: str(r['account_id']) as AccountId,
  other: str(r['other_id']) as AccountId,
  kind: str(r['kind']) as RelationRow['kind'],
  createdAt: iso(r['created_at']),
});

const EMAIL_CODE_COLUMNS = 'id, account_id, purpose, hash, created_at, expires_at, used_at';
const emailCodeOf = (r: Row): EmailCodeRow => ({
  id: str(r['id']),
  account: str(r['account_id']) as AccountId,
  purpose: str(r['purpose']) as EmailCodeRow['purpose'],
  hash: str(r['hash']),
  createdAt: iso(r['created_at']),
  expiresAt: iso(r['expires_at']),
  usedAt: isoOrNull(r['used_at']),
});

const REPORT_COLUMNS =
  'id, reporter_kind, reporter_account, reporter_session, reporter_source, target_account, target_session, target_name, reason, game_id, text, related, ' +
  'evidence, status, created_at, closed_at, closed_by, note';
function reportOf(r: Row): ReportRow {
  const kind = r['reporter_kind'];
  const ev = r['evidence'] as { games: string[]; stats: Record<string, number> } | null;
  return {
    id: str(r['id']),
    reporter:
      kind === null
        ? null
        : kind === 'account'
          ? { kind: 'account', account: str(r['reporter_account']) as AccountId }
          : kind === 'guest'
            ? { kind: 'guest', session: str(r['reporter_session']) }
            : { kind: 'system', source: str(r['reporter_source']) },
    target: r['target_account'] !== null ? { account: str(r['target_account']) as AccountId } : { guestSession: str(r['target_session']) },
    targetName: str(r['target_name']),
    reason: str(r['reason']) as ReportRow['reason'],
    game: strOrNull(r['game_id']),
    text: strOrNull(r['text']),
    related: strings(r['related']) as AccountId[],
    evidence: ev === null ? null : { games: [...ev.games], stats: { ...ev.stats } },
    status: str(r['status']) as ReportRow['status'],
    createdAt: iso(r['created_at']),
    closedAt: isoOrNull(r['closed_at']),
    closedBy: strOrNull(r['closed_by']),
    note: strOrNull(r['note']),
  };
}
function reportParams(r: ReportRow): unknown[] {
  return [
    r.id, r.reporter?.kind ?? null, r.reporter?.kind === 'account' ? r.reporter.account : null, r.reporter?.kind === 'guest' ? r.reporter.session : null,
    r.reporter?.kind === 'system' ? r.reporter.source : null, 'account' in r.target ? r.target.account : null,
    'guestSession' in r.target ? r.target.guestSession : null, r.targetName, r.reason, r.game, r.text, r.related, r.evidence === null ? null : JSON.stringify(r.evidence),
    r.status, r.createdAt, r.closedAt, r.closedBy, r.note,
  ];
}

const SANCTION_COLUMNS =
  'id, account_id, kind, reason, message, note, created_at, created_by, since, until, ended_at, end_reason, ended_by, seen_at, reports';
const sanctionOf = (r: Row): SanctionRow => ({
  id: str(r['id']),
  account: str(r['account_id']) as AccountId,
  kind: str(r['kind']) as SanctionRow['kind'],
  reason: str(r['reason']) as SanctionRow['reason'],
  message: str(r['message']),
  note: strOrNull(r['note']),
  createdAt: iso(r['created_at']),
  createdBy: str(r['created_by']),
  reports: strings(r['reports']),
  since: iso(r['since']),
  until: isoOrNull(r['until']),
  endedAt: isoOrNull(r['ended_at']),
  endReason: strOrNull(r['end_reason']) as SanctionEnd | null,
  endedBy: strOrNull(r['ended_by']),
  seenAt: isoOrNull(r['seen_at']),
});

const APPEAL_COLUMNS = 'sanction_id, account_id, text, created_at, answer, answer_message, answered_at, answered_by';
const appealOf = (r: Row): AppealRow => ({
  sanction: str(r['sanction_id']),
  account: str(r['account_id']) as AccountId,
  text: str(r['text']),
  createdAt: iso(r['created_at']),
  answer: strOrNull(r['answer']) as AppealRow['answer'],
  answerMessage: strOrNull(r['answer_message']),
  answeredAt: isoOrNull(r['answered_at']),
  answeredBy: strOrNull(r['answered_by']),
});

const AUDIT_COLUMNS = 'id, at, kind, account_id, actor, actor_os, session_id, address_tag, details';
const auditOf = (r: Row): AuditEvent => ({
  id: str(r['id']),
  at: iso(r['at']),
  kind: str(r['kind']) as AuditEvent['kind'],
  account: strOrNull(r['account_id']) as AccountId | null,
  actor: str(r['actor']) as AuditEvent['actor'],
  actorOs: strOrNull(r['actor_os']),
  session: strOrNull(r['session_id']),
  addressTag: strOrNull(r['address_tag']),
  details: structuredClone(r['details']) as AuditEvent['details'],
});

const changeOf = (r: Row): AccountChange => ({
  seq: num(r['seq']),
  at: iso(r['at']),
  account: str(r['account_id']) as AccountId,
  kind: str(r['kind']) as AccountChange['kind'],
  ...(r['session_id'] !== null ? { session: str(r['session_id']) } : {}),
  ...(r['detail'] !== null ? { detail: { ...(r['detail'] as NonNullable<AccountChange['detail']>) } } : {}),
});

// ---- statements ------------------------------------------------------------------------------------------------------------------------------

/** `$from, $from + 1, ...` for `n` parameters. */
const placeholders = (n: number, from = 1): string => Array.from({ length: n }, (_, i) => `$${from + i}`).join(', ');

/** One multi-row INSERT of `rows` (each a list of parameters for `columns`); nothing when there are no rows. `suffix` follows the VALUES. */
async function insertRows(tx: AccountsSqlQueryable, table: string, columns: string, rows: readonly (readonly unknown[])[], suffix = ''): Promise<void> {
  if (rows.length === 0) return;
  const width = rows[0]!.length;
  const params: unknown[] = [];
  const values = rows.map((r) => {
    const ph = `(${placeholders(width, params.length + 1)})`;
    params.push(...r);
    return ph;
  });
  await tx.query(`INSERT INTO accounts.${table} (${columns}) VALUES ${values.join(', ')} ${suffix}`, params);
}

const INSERT_ACCOUNT = `INSERT INTO accounts.accounts (${ACCOUNT_NEW_COLUMNS}) VALUES (${placeholders(18)})`;
const INSERT_SESSION = `INSERT INTO accounts.sessions (${SESSION_COLUMNS}) VALUES (${placeholders(16)})`;
const auditParams = (e: AuditEvent): unknown[] => [e.id, e.at, e.kind, e.account, e.actor, e.actorOs, e.session, e.addressTag, JSON.stringify(e.details)];

/** Locks the account's row against an erase (it waits for this transaction) without blocking other writers; 'notFound' when there is no such account. */
async function needAccount(tx: AccountsSqlQueryable, id: string): Promise<void> {
  const r = await tx.query('SELECT 1 FROM accounts.accounts WHERE id = $1 FOR KEY SHARE', [id]);
  if (r.rows.length === 0) throw err('notFound', 'no such account');
}

/**
 * The name data version (6.3), read shared (FOR SHARE) and held to the end of the transaction. Every writer of a key reads it first, before the table
 * of names and before any account's row, and a rekey takes it exclusively first and then the table: one order, so a rekey and a writer never wait for
 * each other, and a key made under the version a rekey is replacing is refused ('conflict') rather than left under it.
 */
async function nameVersion(tx: AccountsSqlQueryable): Promise<number> {
  const r = await tx.query<{ current_version: unknown }>('SELECT current_version FROM accounts.name_meta FOR SHARE');
  return r.rows[0] ? num(r.rows[0].current_version) : INITIAL_NAME_KEY_VERSION;
}
async function nameVersionIs(tx: AccountsSqlQueryable, version: number): Promise<void> {
  const current = await nameVersion(tx);
  if (current !== version) throw err('conflict', `the current name data version is ${current}, not ${version}`);
}

/** How a patch moves an account's deletion (10.2): each kind but 'none' and 'done' is one of the database's deletion functions (migration 001). */
type DeletionStep =
  | { kind: 'none' }
  | { kind: 'done'; done: string[] }
  | { kind: 'request'; requestedAt: string; purgeAt: string }
  | { kind: 'move'; purgeAt: string }
  | { kind: 'cancel' }
  | { kind: 'claim'; at: string };

/**
 * The step from `cur` to `next`: a request (none pending, the new one unclaimed and with nothing done), a cancel, a claim (erasingAt set, nothing else
 * changed), a move of purgeAt, or holders added to `done`. Any other change of a deletion is refused ('value'): the service makes no other, and the
 * columns the claim rests on are the database's to move.
 */
function deletionStep(cur: Account['deletion'], next: Account['deletion']): DeletionStep {
  if (cur === null && next === null) return { kind: 'none' };
  if (cur === null) {
    if (next!.erasingAt !== null || next!.done.length > 0) throw err('value', 'a deletion starts unclaimed and with nothing done');
    return { kind: 'request', requestedAt: next!.requestedAt, purgeAt: next!.purgeAt };
  }
  if (next === null) return { kind: 'cancel' };
  if (cur.requestedAt !== next.requestedAt) throw err('value', 'a pending deletion keeps the time it was requested');
  const sameDone = cur.done.length === next.done.length && cur.done.every((x, i) => x === next.done[i]);
  if (cur.erasingAt === next.erasingAt) {
    if (cur.purgeAt === next.purgeAt) return sameDone ? { kind: 'none' } : { kind: 'done', done: next.done };
    if (!sameDone) throw err('value', 'a deletion moves or marks holders done, not both');
    return { kind: 'move', purgeAt: next.purgeAt };
  }
  if (next.erasingAt === null) throw err('value', 'a claim is not taken back');
  if (cur.purgeAt !== next.purgeAt || !sameDone) throw err('value', 'a claim changes nothing else');
  return { kind: 'claim', at: next.erasingAt };
}

/** A write that has no stored row to make for an id with no account, so the answer takes as long (a no-op update of write_pad: threat model T2, A2). */
async function padWrite(tx: AccountsSqlQueryable): Promise<void> {
  await tx.query('UPDATE accounts.write_pad SET n = n + 1');
}

/** Whether another session holds `hash` as its current or its previous token hash. */
async function hashHeld(tx: AccountsSqlQueryable, hash: string, exceptId: string | null): Promise<boolean> {
  const r = await tx.query('SELECT 1 FROM accounts.sessions WHERE ($2::text IS NULL OR id <> $2::text) AND (token_hash = $1 OR previous_hash = $1) LIMIT 1', [hash, exceptId]);
  return r.rows.length > 0;
}

/** A time `ms` before `nowMs`, as a timestamptz text; '-infinity' when that is before year 1 (a policy that keeps something for ever). */
function cutoff(nowMs: number, ms: number): string {
  const t = nowMs - ms;
  return t < -62_135_596_800_000 ? '-infinity' : new Date(t).toISOString();
}

/**
 * An event as an erased account's account leaves it (INTERFACE CHANGE (M14-7)): its `deleted` event as it is, an operator event without its account,
 * nothing else (null). `tombs`: the accounts with a tombstone.
 */
function keptEvent(e: AuditEvent, tombs: ReadonlySet<string>): AuditEvent | null {
  if (e.account === null || e.kind === 'deleted' || !tombs.has(e.account)) return e;
  return AUDIT_CATEGORY[e.kind] === 'operator' ? { ...e, account: null } : null;
}

/** How PostgreSQL's own refusals read as the contract's (see the header); `map` overrides a SQLSTATE for one call. */
function refusal(e: unknown, map: Readonly<Record<string, StoreErrorCode>> = {}): unknown {
  if (e instanceof AccountStoreError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return e;
  const why = (c: StoreErrorCode): AccountStoreError => {
    const constraint = (e as { constraint?: unknown }).constraint;
    return err(c, `the database refused it (SQLSTATE ${code}${typeof constraint === 'string' ? `, ${constraint}` : ''})`);
  };
  const mapped = map[code];
  if (mapped !== undefined) return why(mapped);
  if (code === '23505') return why('exists');
  if (code === '23503') return why('notFound');
  // the deletion functions' own refusals (migration 001: request_deletion, move_deletion, cancel_deletion, claim_erasure)
  if (code === 'OM409') return why('conflict');
  if (code === 'OM404') return why('notFound');
  if (code === '23514' || code === '23502' || code.startsWith('22')) return why('value');
  return e;
}

const patchKeys = (label: string, v: unknown, allowed: readonly string[]): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw err('value', `${label} is not an object`);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined) continue;
    if (!allowed.includes(k)) throw err('value', `${label}.${k} cannot be changed here`);
    out[k] = x;
  }
  return out;
};
const ACCOUNT_PATCH_KEYS = ['avatar', 'privacy', 'email', 'lastSignInAt', 'freeRename', 'deletion', 'inactiveNoticeAt'] as const satisfies readonly (keyof AccountPatch)[];

/** The part of a LIKE pattern that matches `prefix` literally. */
const likePrefix = (prefix: string): string => `${prefix.replace(/[\\%_]/g, '\\$&')}%`;

/** A WHERE clause built from conditions that each name their parameter as `?`. */
class Where {
  readonly params: unknown[] = [];
  private readonly parts: string[] = [];
  add(cond: string, ...values: unknown[]): void {
    let i = 0;
    this.parts.push(cond.replace(/\?/g, () => `$${this.params.length + 1 + Math.min(i++, values.length - 1)}`));
    this.params.push(...values);
  }
  get sql(): string {
    return this.parts.length === 0 ? '' : `WHERE ${this.parts.join(' AND ')}`;
  }
  /** The next parameter's placeholder after `add`s, for a LIMIT. */
  push(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

// ---- the store -------------------------------------------------------------------------------------------------------------------------------

/** The PostgreSQL store (design 11.5). `openPostgresAccountStore` in src/store/index.ts opens one. */
export class PostgresAccountStore implements AccountStore {
  private closed = false;
  /** putEmailCode's cap (AccountStoreLimits; ACCOUNT_RATE_LIMITS.emailResetLiveCodes unless configured). */
  private readonly liveCodesMax: number;

  private constructor(
    private readonly sql: AccountsSql,
    limits: AccountStoreLimits,
  ) {
    this.liveCodesMax = liveCodesLimit(limits);
  }

  /** Opens the store on a migrated database; refuses ('schema') one that is not at ACCOUNTS_SCHEMA_VERSION (run hosted's migrate command first). */
  static async open(sql: AccountsSql, limits: AccountStoreLimits = {}): Promise<PostgresAccountStore> {
    const store = new PostgresAccountStore(sql, limits);
    const t = await sql.query<{ t: string | null }>(`SELECT to_regclass('accounts.schema_migrations')::text AS t`);
    const v = t.rows[0]?.t == null ? 0 : num((await sql.query<{ v: number | null }>('SELECT max(version) AS v FROM accounts.schema_migrations')).rows[0]?.v ?? 0);
    if (v !== ACCOUNTS_SCHEMA_VERSION) {
      throw err('schema', `the accounts schema is version ${v}; this build needs ${ACCOUNTS_SCHEMA_VERSION} (run the migrate command: accounts first)`);
    }
    return store;
  }

  private live(): void {
    if (this.closed) throw err('closed', 'the account store is closed');
  }

  /** A read: `f` runs its statements on the connection pool, after the arguments were checked. */
  private async read<R>(f: (q: AccountsSqlQueryable) => Promise<R>): Promise<R> {
    this.live();
    try {
      return await f(this.sql);
    } catch (e) {
      throw refusal(e);
    }
  }

  /**
   * A write: copies its arguments when it is called (a caller that changes one afterwards changes nothing), checks them (`prepare` throws 'value'
   * before the database is touched), then runs the step it returns in one transaction.
   */
  private async write<A extends unknown[], R>(
    args: [...A],
    prepare: (...args: A) => (tx: AccountsSqlQueryable) => Promise<R>,
    map?: Readonly<Record<string, StoreErrorCode>>,
  ): Promise<R> {
    const a = copyArgs(args);
    this.live();
    const step = prepare(...a);
    try {
      return await this.sql.transaction(step);
    } catch (e) {
      throw refusal(e, map);
    }
  }

  // ---- accounts and names (6.5) ----

  createAccount(n: NewAccount, now: string): Promise<void> {
    return this.write([n, now], (n, now) => {
      const at = time('now', now);
      if (typeof n !== 'object' || n === null) throw err('value', 'the new account is not an object');
      const a = accountRow(n.account);
      // INTERFACE CHANGE (M14-11): a new account has no deletion (a pending deletion starts by request_deletion, whose guards the claim rests on)
      if (a.deletion !== null) throw err('value', 'a new account has no deletion');
      const own = (label: string, account: string) => {
        if (account !== a.id) throw err('value', `${label} belongs to another account`);
      };
      const cred = credentialRow(n.credential);
      own('the credential', cred.account);
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
      if (claim) own('the claim', claim.account);
      const s = sessionRow(n.session);
      own('the session', s.account);
      const d = deviceRow(n.device);
      own('the device proof', d.account);
      if (!Array.isArray(n.audit)) throw err('value', 'audit is not an array');
      const events = n.audit.map(auditRow);
      if (new Set(events.map((e) => e.id)).size !== events.length) throw err('exists', 'the audit event id exists');
      return async (tx) => {
        // the name data version first, shared: a rekey (which holds it exclusively) neither begins while this runs nor is outrun by a key made under the
        // version it is replacing
        await nameVersionIs(tx, a.keyVersion);
        // the name key next: every writer of a key meets the others on this row before anything else (an expired hold is free)
        const claimed = await tx.query(
          `INSERT INTO accounts.names (key, key_version, kind, account_id, until, note, created_at, name)
           VALUES ($1, $2, 'current', $3, NULL, NULL, $4::timestamptz, NULL)
           ON CONFLICT (key, key_version) DO UPDATE
             SET kind = 'current', account_id = EXCLUDED.account_id, until = NULL, note = NULL, created_at = EXCLUDED.created_at, name = NULL
             WHERE accounts.names.until IS NOT NULL AND accounts.names.until <= $4::timestamptz
           RETURNING 1`,
          [a.nameKey, a.keyVersion, a.id, at],
        );
        if (claimed.rows.length === 0) throw err('exists', 'the name key is taken');
        const tomb = await tx.query('SELECT 1 FROM accounts.tombstones WHERE account_id = $1', [a.id]);
        if (tomb.rows.length > 0) throw err('exists', 'an account with this id existed');
        await tx.query(INSERT_ACCOUNT, accountNewParams(a)); // a taken id, or a name key an account holds: a unique violation, 'exists'
        await tx.query(`INSERT INTO accounts.credentials (${CREDENTIAL_COLUMNS}) VALUES (${placeholders(7)})`, [
          cred.provider, cred.subject, cred.account, cred.secret, JSON.stringify(cred.meta), cred.createdAt, cred.lastUsedAt,
        ]);
        await insertRows(tx, 'recovery_codes', RECOVERY_COLUMNS, recovery.map((r) => [r.account, r.slot, r.hash, r.generation, r.createdAt, r.usedAt]));
        await tx.query(`INSERT INTO accounts.name_history (${HISTORY_COLUMNS}) VALUES (${placeholders(8)})`, [
          h.account, h.name, h.key, h.keyVersion, h.from, h.to, h.cause, h.redacted,
        ]);
        if (claim) await tx.query(`INSERT INTO accounts.guest_claims (${CLAIM_COLUMNS}) VALUES ($1, $2, $3)`, [claim.session, claim.account, claim.claimedAt]);
        if ((await hashHeld(tx, s.tokenHash, null)) || (s.previousHash !== null && (await hashHeld(tx, s.previousHash, null)))) {
          throw err('exists', 'the token hash belongs to another session');
        }
        await tx.query(INSERT_SESSION, sessionParams(s));
        await tx.query(`INSERT INTO accounts.devices (${DEVICE_COLUMNS}) VALUES (${placeholders(5)})`, [d.hash, d.account, d.createdAt, d.lastUsedAt, d.failures]);
        await insertRows(tx, 'audit', AUDIT_COLUMNS, events.map(auditParams));
      };
    });
  }

  account(id: AccountId): Promise<Account | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE id = $1`, [text('id', id)]);
      return r.rows[0] ? accountOf(r.rows[0]) : null;
    });
  }

  accounts(ids: readonly AccountId[]): Promise<Map<AccountId, Account>> {
    return this.read(async (q) => {
      const list = textList('ids', ids);
      const out = new Map<AccountId, Account>();
      if (list.length === 0) return out;
      const r = await q.query<Row>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE id = ANY($1::text[])`, [list]);
      const found = new Map(r.rows.map((x) => [str(x['id']), accountOf(x)] as const));
      for (const id of list) {
        const a = found.get(id);
        if (a) out.set(a.id, a);
      }
      return out;
    });
  }

  accountByKey(key: string, keyVersion: number): Promise<Account | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE name_key = $1 AND key_version = $2`, [
        text('key', key), int('keyVersion', keyVersion),
      ]);
      return r.rows[0] ? accountOf(r.rows[0]) : null;
    });
  }

  updateAccount(id: AccountId, version: number, patch: AccountPatch): Promise<Account> {
    return this.write([id, version, patch], (id, version, patch) => {
      const x = text('id', id);
      int('version', version);
      const p = patchKeys('patch', patch, ACCOUNT_PATCH_KEYS);
      return async (tx) => {
        // FOR NO KEY UPDATE: two updates of one account wait for each other, and writers that attach rows to it (KEY SHARE) do not wait
        const cur = await tx.query<Row>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE id = $1 FOR NO KEY UPDATE`, [x]);
        if (!cur.rows[0]) throw err('notFound', 'no such account');
        const a = accountOf(cur.rows[0]);
        if (a.version !== version) throw err('conflict', 'the account changed since it was read');
        const next = accountRow({ ...a, ...p, version: a.version + 1 });
        const step = deletionStep(a.deletion, next.deletion);
        await tx.query(
          `UPDATE accounts.accounts SET avatar = $2, privacy = $3, email = $4, email_verified_at = $5, email_set_at = $6, last_sign_in_at = $7,
             free_rename = $8, deletion_done = $9, inactive_notice_at = $10, version = $11
           WHERE id = $1`,
          [
            next.id, next.avatar, JSON.stringify(next.privacy), next.email?.address ?? null, next.email?.verifiedAt ?? null, next.email?.setAt ?? null,
            next.lastSignInAt, next.freeRename, step.kind === 'done' ? step.done : (a.deletion?.done ?? []), next.inactiveNoticeAt, next.version,
          ],
        );
        // the erasure claim's columns change only through the database's functions, each of which checks the step against the database's clock and policy
        switch (step.kind) {
          case 'request':
            await tx.query('SELECT accounts.request_deletion($1::text, $2::timestamptz, $3::timestamptz)', [a.id, step.requestedAt, step.purgeAt]);
            break;
          case 'move':
            await tx.query('SELECT accounts.move_deletion($1::text, $2::timestamptz)', [a.id, step.purgeAt]);
            break;
          case 'cancel':
            await tx.query('SELECT accounts.cancel_deletion($1::text)', [a.id]);
            break;
          case 'claim':
            await tx.query('SELECT accounts.claim_erasure($1::text, $2::timestamptz)', [a.id, step.at]);
            break;
          default:
            break;
        }
        return next;
      };
    });
  }

  rename(id: AccountId, version: number, next: NameHistoryRow, opts: RenameOptions): Promise<Account> {
    return this.write([id, version, next, opts], (id, version, next, opts) => {
      const x = text('id', id);
      int('version', version);
      const h = historyRow(next);
      if (typeof opts !== 'object' || opts === null) throw err('value', 'the rename options are not an object');
      const now = time('opts.now', opts.now);
      const oldKind = oneOf('opts.oldKind', opts.oldKind, ['held', 'banned'] as const);
      const holdUntil = timeOrNull('opts.holdUntil', opts.holdUntil);
      const allow = textList('opts.allow', opts.allow).map((v) => oneOf('opts.allow', v, ['ownHeld', 'reserved'] as const));
      return async (tx) => {
        // the order every writer of names keeps: the name data version (shared), the table of names, then the account's row; a rekey takes the first two
        // exclusively before it touches an account
        const current = await nameVersion(tx);
        await tx.exec('LOCK TABLE accounts.names IN ROW EXCLUSIVE MODE');
        // FOR UPDATE: the account's key columns change, so this is the lock that update takes anyway
        const cur = await tx.query<Row>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE id = $1 FOR UPDATE`, [x]);
        if (!cur.rows[0]) throw err('notFound', 'no such account');
        const a = accountOf(cur.rows[0]);
        if (h.account !== a.id) throw err('value', 'the name history row belongs to another account');
        if (a.version !== version) throw err('conflict', 'the account changed since it was read');
        if (h.keyVersion !== current) throw err('conflict', `the current name data version is ${current}, not ${h.keyVersion}`);
        if (h.key === a.nameKey && h.keyVersion === a.keyVersion) throw err('exists', 'the name key is the account\'s current one');
        // the new key, claimed atomically: free (an expired hold too), the account's own hold, or reserved, as `allow` says
        const claimed = await tx.query(
          `INSERT INTO accounts.names (key, key_version, kind, account_id, until, note, created_at, name)
           VALUES ($1, $2, 'current', $3, NULL, NULL, $4::timestamptz, NULL)
           ON CONFLICT (key, key_version) DO UPDATE
             SET kind = 'current', account_id = EXCLUDED.account_id, until = NULL, note = NULL, created_at = EXCLUDED.created_at, name = NULL
             WHERE accounts.names.kind <> 'current' AND (
               (accounts.names.until IS NOT NULL AND accounts.names.until <= $4::timestamptz)
               OR (accounts.names.kind = 'held' AND accounts.names.account_id = $3 AND $5::boolean)
               OR (accounts.names.kind = 'reserved' AND $6::boolean))
           RETURNING 1`,
          [h.key, h.keyVersion, a.id, now, allow.includes('ownHeld'), allow.includes('reserved')],
        );
        if (claimed.rows.length === 0) throw err('exists', 'the name key is taken');
        // name_history's key is (account_id, from_at): a row starts after the one before it
        const last = await tx.query<{ from_at: unknown }>('SELECT from_at FROM accounts.name_history WHERE account_id = $1 ORDER BY from_at DESC LIMIT 1', [a.id]);
        if (last.rows[0] && Date.parse(h.from) <= new Date(iso(last.rows[0].from_at)).getTime()) {
          throw err('conflict', 'the name history row does not start after the last one');
        }
        // the old key, held for the account (or banned, keeping its account: 9.4)
        await tx.query(
          `INSERT INTO accounts.names (key, key_version, kind, account_id, until, note, created_at, name)
           VALUES ($1, $2, $3, $4, $5::timestamptz, NULL, $6::timestamptz, NULL)
           ON CONFLICT (key, key_version) DO UPDATE
             SET kind = EXCLUDED.kind, account_id = EXCLUDED.account_id, until = EXCLUDED.until, note = NULL, created_at = EXCLUDED.created_at, name = NULL`,
          [a.nameKey, a.keyVersion, oldKind, a.id, holdUntil, now],
        );
        await tx.query('UPDATE accounts.name_history SET to_at = $2 WHERE account_id = $1 AND to_at IS NULL', [a.id, h.from]);
        await tx.query(`INSERT INTO accounts.name_history (${HISTORY_COLUMNS}) VALUES (${placeholders(8)})`, [
          h.account, h.name, h.key, h.keyVersion, h.from, h.to, h.cause, h.redacted,
        ]);
        const out = accountRow({ ...a, name: h.name, nameKey: h.key, keyVersion: h.keyVersion, renamedAt: now, version: a.version + 1 });
        await tx.query('UPDATE accounts.accounts SET name = $2, name_key = $3, key_version = $4, renamed_at = $5, version = $6 WHERE id = $1', [
          out.id, out.name, out.nameKey, out.keyVersion, out.renamedAt, out.version,
        ]);
        return out;
      };
    });
  }

  nameEntry(key: string, keyVersion: number): Promise<NameEntry | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${NAME_COLUMNS} FROM accounts.names WHERE key = $1 AND key_version = $2`, [text('key', key), int('keyVersion', keyVersion)]);
      return r.rows[0] ? nameEntryOf(r.rows[0]) : null;
    });
  }

  putNameEntry(e: NameEntry): Promise<void> {
    return this.write([e], (e) => {
      const row = nameEntryRow(e);
      // a hold for nobody (a forced rename's, M14-6) has an end; reserved and banned keys need none
      const hold = row.kind === 'held' && row.until !== null;
      if (row.kind !== 'reserved' && row.kind !== 'banned' && !hold) throw err('value', 'only reserved, banned and ending held keys are put directly');
      if (row.account !== null) throw err('value', 'a key put directly belongs to no account');
      return async (tx) => {
        const put = await tx.query(
          `INSERT INTO accounts.names (${NAME_COLUMNS}) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
           ON CONFLICT (key, key_version) DO UPDATE
             SET kind = EXCLUDED.kind, account_id = NULL, until = EXCLUDED.until, note = EXCLUDED.note, created_at = EXCLUDED.created_at, name = EXCLUDED.name
             WHERE accounts.names.kind <> 'current'
           RETURNING 1`,
          [row.key, row.keyVersion, row.kind, row.until, row.note, row.createdAt, row.name ?? null],
        );
        if (put.rows.length === 0) throw err('conflict', 'the key is an account\'s current name');
      };
    });
  }

  deleteNameEntry(key: string, keyVersion: number): Promise<void> {
    return this.write([key, keyVersion], (key, keyVersion) => {
      const k = text('key', key);
      const v = int('keyVersion', keyVersion);
      return async (tx) => {
        const cur = await tx.query<{ kind: string }>('SELECT kind FROM accounts.names WHERE key = $1 AND key_version = $2 FOR UPDATE', [k, v]);
        if (!cur.rows[0]) throw err('notFound', 'no such name entry');
        if (cur.rows[0].kind === 'current') throw err('conflict', 'the key is an account\'s current name');
        await tx.query('DELETE FROM accounts.names WHERE key = $1 AND key_version = $2', [k, v]);
      };
    });
  }

  nameHistory(id: AccountId): Promise<NameHistoryRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${HISTORY_COLUMNS} FROM accounts.name_history WHERE account_id = $1 ORDER BY from_at`, [text('id', id)]);
      return r.rows.map(historyOf);
    });
  }

  redactName(id: AccountId, key: string): Promise<void> {
    return this.write([id, key], (id, key) => {
      const x = text('id', id);
      const k = text('key', key);
      return async (tx) => {
        await needAccount(tx, x);
        await tx.query('UPDATE accounts.name_history SET redacted = true WHERE account_id = $1 AND key = $2 AND NOT redacted', [x, k]);
      };
    });
  }

  findAccounts(keyPrefix: string, limit: number): Promise<Account[]> {
    return this.read(async (q) => {
      const p = text('keyPrefix', keyPrefix);
      const n = limitOf(limit);
      const r = await q.query<Row>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE name_key LIKE $1 ORDER BY name_key, key_version, id LIMIT $2`,
        [likePrefix(p), n],
      );
      return r.rows.map(accountOf);
    });
  }

  /** Accounts not signed in to (or, never signed in, made) before `before`, with no deletion pending: oldest first, after the cursor `after`. */
  inactiveSince(before: string, limit: number, after?: ListCursor): Promise<Account[]> {
    return this.read(async (q) => {
      const b = ms('before', before);
      const n = limitOf(limit);
      const c = cursorOf(after);
      const w = new Where();
      w.add('purge_at IS NULL');
      w.add('coalesce(last_sign_in_at, created_at) < ?::timestamptz', new Date(b).toISOString());
      if (c) w.add('(coalesce(last_sign_in_at, created_at), id) > (?::timestamptz, ?::text)', new Date(c.at).toISOString(), c.account);
      const r = await q.query<Row>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts ${w.sql} ORDER BY coalesce(last_sign_in_at, created_at), id LIMIT ${w.push(n)}`,
        w.params,
      );
      return r.rows.map(accountOf);
    });
  }

  // ---- name data versions (6.3) ----

  nameKeyVersion(): Promise<number> {
    return this.read(async (q) => {
      const r = await q.query<{ current_version: number }>('SELECT current_version FROM accounts.name_meta');
      return r.rows[0] ? num(r.rows[0].current_version) : INITIAL_NAME_KEY_VERSION;
    });
  }

  /**
   * Entries in (key, keyVersion) order, keys after `after` (code-point order). A key's entries under two versions are never split across pages: the
   * page goes on past `limit` until the last key's entries are all in it.
   */
  nameEntries(after: string | null, limit: number): Promise<NameEntry[]> {
    return this.read(async (q) => {
      const from = textOrNull('after', after);
      const n = limitOf(limit);
      const r = await q.query<Row>(
        `SELECT ${NAME_COLUMNS} FROM accounts.names
         WHERE ($1::text IS NULL OR key > $1::text)
           AND key <= (SELECT max(f.key) FROM (SELECT key FROM accounts.names WHERE $1::text IS NULL OR key > $1::text ORDER BY key, key_version LIMIT $2) f)
         ORDER BY key, key_version`,
        [from, n],
      );
      return r.rows.map(nameEntryOf);
    });
  }

  rekey(from: number, to: number, keys: ReadonlyMap<string, string>): Promise<void> {
    return this.write(
      [from, to, keys],
      (from, to, keys) => {
        int('from', from);
        int('to', to);
        if (from === to) throw err('value', 'rekey needs two different versions');
        if (!(keys instanceof Map)) throw err('value', 'keys is not a Map');
        const olds: string[] = [];
        const news: string[] = [];
        for (const [o, n] of keys) {
          olds.push(word('an old key', o));
          news.push(word('a new key', n));
        }
        return async (tx) => {
          const cur = await tx.query<{ current_version: number }>('SELECT current_version FROM accounts.name_meta FOR UPDATE');
          const current = cur.rows[0] ? num(cur.rows[0].current_version) : INITIAL_NAME_KEY_VERSION;
          if (current !== from) throw err('conflict', `the current name data version is ${current}, not ${from}`);
          // no writer of a key commits between the checks below and this commit (every one of them writes `names`, and waits here): a registration made
          // meanwhile would stay under the old version, which the map does not know. A writer that has begun finishes first.
          await tx.exec('LOCK TABLE accounts.names IN SHARE ROW EXCLUSIVE MODE');
          // the map must be complete: every entry and every account of version `from` is in it
          const names = await tx.query('SELECT 1 FROM accounts.names n WHERE n.key_version = $1 AND n.key <> ALL($2::text[]) LIMIT 1', [from, olds]);
          if (names.rows.length > 0) throw err('conflict', 'the key map is incomplete: a name entry changed since the check');
          const accounts = await tx.query('SELECT 1 FROM accounts.accounts a WHERE a.key_version = $1 AND a.name_key <> ALL($2::text[]) LIMIT 1', [from, olds]);
          if (accounts.rows.length > 0) throw err('conflict', 'the key map is incomplete: an account changed since the check');
          // a collision (two names folding to one key, or a key already there under `to`) is a primary key or unique violation: 'conflict' (the map of this call)
          await tx.query(
            `UPDATE accounts.names n SET key = m.new_key, key_version = $3
             FROM unnest($1::text[], $2::text[]) AS m(old_key, new_key) WHERE n.key_version = $4 AND n.key = m.old_key`,
            [olds, news, to, from],
          );
          await tx.query(
            `UPDATE accounts.accounts a SET name_key = m.new_key, key_version = $3, version = a.version + 1
             FROM unnest($1::text[], $2::text[]) AS m(old_key, new_key) WHERE a.key_version = $4 AND a.name_key = m.old_key`,
            [olds, news, to, from],
          );
          await tx.query(
            `UPDATE accounts.name_history h SET key = m.new_key, key_version = $3
             FROM unnest($1::text[], $2::text[]) AS m(old_key, new_key) WHERE h.key_version = $4 AND h.key = m.old_key`,
            [olds, news, to, from],
          );
          await tx.query('UPDATE accounts.name_meta SET current_version = $1', [to]);
        };
      },
      { '23505': 'conflict' },
    );
  }

  // ---- credentials, recovery codes, device proofs (4) ----

  credentials(id: AccountId): Promise<CredentialRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${CREDENTIAL_COLUMNS} FROM accounts.credentials WHERE account_id = $1 ORDER BY provider, subject`, [text('id', id)]);
      return r.rows.map(credentialOf);
    });
  }

  credentialBySubject(provider: CredentialRow['provider'], subject: string): Promise<CredentialRow | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${CREDENTIAL_COLUMNS} FROM accounts.credentials WHERE provider = $1 AND subject = $2`, [
        oneOf('provider', provider, PROVIDERS), text('subject', subject),
      ]);
      return r.rows[0] ? credentialOf(r.rows[0]) : null;
    });
  }

  putCredential(c: CredentialRow, expectSecret?: string | null): Promise<void> {
    return this.write([c, expectSecret], (c, expectSecret) => {
      const row = credentialRow(c);
      const cas = expectSecret !== undefined;
      const expect = cas ? textOrNull('expectSecret', expectSecret) : null;
      const params = [row.provider, row.subject, row.account, row.secret, JSON.stringify(row.meta), row.createdAt, row.lastUsedAt];
      return async (tx) => {
        await needAccount(tx, row.account);
        if (cas) {
          // the compare-and-set of design 11.5: one UPDATE, on the account's own credential holding exactly the secret the caller verified
          const u = await tx.query(
            `UPDATE accounts.credentials SET secret = $4, meta = $5, created_at = $6, last_used_at = $7
             WHERE provider = $1 AND subject = $2 AND account_id = $3 AND secret IS NOT DISTINCT FROM $8::text RETURNING 1`,
            [...params, expect],
          );
          if (u.rows.length === 1) return;
          const cur = await tx.query<{ account_id: string }>('SELECT account_id FROM accounts.credentials WHERE provider = $1 AND subject = $2', [row.provider, row.subject]);
          if (cur.rows[0] && cur.rows[0].account_id !== row.account) throw err('exists', 'the subject belongs to another account');
          throw err('conflict', 'the credential changed since it was read');
        }
        const put = await tx.query(
          `INSERT INTO accounts.credentials (${CREDENTIAL_COLUMNS}) VALUES (${placeholders(7)})
           ON CONFLICT (provider, subject) DO UPDATE
             SET secret = EXCLUDED.secret, meta = EXCLUDED.meta, created_at = EXCLUDED.created_at, last_used_at = EXCLUDED.last_used_at
             WHERE accounts.credentials.account_id = EXCLUDED.account_id
           RETURNING 1`,
          params,
        );
        if (put.rows.length === 0) throw err('exists', 'the subject belongs to another account');
      };
    });
  }

  deleteCredential(id: AccountId, provider: CredentialRow['provider'], subject: string): Promise<void> {
    return this.write([id, provider, subject], (id, provider, subject) => {
      const a = text('id', id);
      const p = oneOf('provider', provider, PROVIDERS);
      const s = text('subject', subject);
      return async (tx) => {
        // every credential of the account locked: two deletions of its last two cannot both pass the count below
        const mine = await tx.query<{ provider: string; subject: string }>('SELECT provider, subject FROM accounts.credentials WHERE account_id = $1 FOR UPDATE', [a]);
        if (!mine.rows.some((c) => c.provider === p && c.subject === s)) throw err('notFound', 'no such credential of this account');
        if (mine.rows.length <= 1) throw err('conflict', 'it is the account\'s last way to sign in');
        await tx.query('DELETE FROM accounts.credentials WHERE provider = $1 AND subject = $2', [p, s]);
      };
    });
  }

  replaceRecoveryCodes(id: AccountId, rows: RecoveryCodeRow[]): Promise<void> {
    return this.write([id, rows], (id, rows) => {
      const a = text('id', id);
      if (!Array.isArray(rows)) throw err('value', 'rows is not an array');
      const list = rows.map(recoveryRow).sort(byKeys((r) => r.slot));
      list.forEach((r, i) => {
        if (r.account !== a) throw err('value', 'a recovery code belongs to another account');
        if (i > 0 && list[i - 1]!.slot === r.slot) throw err('value', `recovery slot ${r.slot} twice`);
      });
      return async (tx) => {
        await needAccount(tx, a);
        await tx.query('DELETE FROM accounts.recovery_codes WHERE account_id = $1', [a]);
        await insertRows(tx, 'recovery_codes', RECOVERY_COLUMNS, list.map((r) => [r.account, r.slot, r.hash, r.generation, r.createdAt, r.usedAt]));
      };
    });
  }

  recoveryCodes(id: AccountId): Promise<RecoveryCodeRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${RECOVERY_COLUMNS} FROM accounts.recovery_codes WHERE account_id = $1 ORDER BY slot`, [text('id', id)]);
      return r.rows.map(recoveryOf);
    });
  }

  /** The design's statement: true for exactly one caller, and only while the slot still holds the hash (a replaced generation's code never spends one). */
  spendRecoveryCode(id: AccountId, slot: number, hash: string, at: string): Promise<boolean> {
    return this.write([id, slot, hash, at], (id, slot, hash, at) => {
      const a = text('id', id);
      const s = int('slot', slot);
      const h = text('hash', hash);
      const when = time('at', at);
      return async (tx) => {
        const u = await tx.query('UPDATE accounts.recovery_codes SET used_at = $4 WHERE account_id = $1 AND slot = $2 AND hash = $3 AND used_at IS NULL RETURNING 1', [a, s, h, when]);
        return u.rows.length === 1;
      };
    });
  }

  putDevice(d: DeviceRow): Promise<void> {
    return this.write([d], (d) => {
      const row = deviceRow(d);
      return async (tx) => {
        await needAccount(tx, row.account);
        const put = await tx.query(
          `INSERT INTO accounts.devices (${DEVICE_COLUMNS}) VALUES (${placeholders(5)})
           ON CONFLICT (hash) DO UPDATE SET created_at = EXCLUDED.created_at, last_used_at = EXCLUDED.last_used_at, failures = EXCLUDED.failures
             WHERE accounts.devices.account_id = EXCLUDED.account_id
           RETURNING 1`,
          [row.hash, row.account, row.createdAt, row.lastUsedAt, row.failures],
        );
        if (put.rows.length === 0) throw err('exists', 'the device proof belongs to another account');
      };
    });
  }

  device(hash: string): Promise<DeviceRow | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${DEVICE_COLUMNS} FROM accounts.devices WHERE hash = $1`, [text('hash', hash)]);
      return r.rows[0] ? deviceOf(r.rows[0]) : null;
    });
  }

  devicesOf(account: AccountId): Promise<DeviceRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${DEVICE_COLUMNS} FROM accounts.devices WHERE account_id = $1 ORDER BY created_at, hash`, [text('account', account)]);
      return r.rows.map(deviceOf);
    });
  }

  updateDevice(hash: string, patch: Partial<Pick<DeviceRow, 'lastUsedAt' | 'failures'>>): Promise<void> {
    return this.write([hash, patch], (hash, patch) => {
      const h = text('hash', hash);
      const p = patchKeys('patch', patch, ['lastUsedAt', 'failures']);
      const lastUsedAt = p['lastUsedAt'] === undefined ? null : time('device lastUsedAt', p['lastUsedAt']);
      const failures = p['failures'] === undefined ? null : int('device failures', p['failures']);
      return async (tx) => {
        const u = await tx.query(
          'UPDATE accounts.devices SET last_used_at = coalesce($2::timestamptz, last_used_at), failures = coalesce($3::bigint, failures) WHERE hash = $1 RETURNING 1',
          [h, lastUsedAt, failures],
        );
        if (u.rows.length === 0) throw err('notFound', 'no such device proof');
      };
    });
  }

  deleteDevices(id: AccountId, except?: string): Promise<number> {
    return this.write([id, except], (id, except) => {
      const a = text('id', id);
      const keep = except === undefined ? null : text('except', except);
      return async (tx) => {
        const d = await tx.query('DELETE FROM accounts.devices WHERE account_id = $1 AND ($2::text IS NULL OR hash <> $2::text) RETURNING 1', [a, keep]);
        return d.rows.length;
      };
    });
  }

  // ---- sessions (5.2) ----

  putSession(s: AccountSessionRow): Promise<void> {
    return this.write([s], (s) => {
      const row = sessionRow(s);
      return async (tx) => {
        await needAccount(tx, row.account);
        const cur = await tx.query<{ account_id: string }>('SELECT account_id FROM accounts.sessions WHERE id = $1 FOR UPDATE', [row.id]);
        if (cur.rows[0] && cur.rows[0].account_id !== row.account) throw err('exists', 'the session id belongs to another account');
        if ((await hashHeld(tx, row.tokenHash, row.id)) || (row.previousHash !== null && (await hashHeld(tx, row.previousHash, row.id)))) {
          throw err('exists', 'the token hash belongs to another session');
        }
        const put = await tx.query(
          `${INSERT_SESSION} ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash, previous_hash = EXCLUDED.previous_hash,
             rotation = EXCLUDED.rotation, device_hash = EXCLUDED.device_hash, provider = EXCLUDED.provider, client = EXCLUDED.client,
             created_at = EXCLUDED.created_at, last_used_at = EXCLUDED.last_used_at, auth_at = EXCLUDED.auth_at, rotated_at = EXCLUDED.rotated_at,
             expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at, revoke_reason = EXCLUDED.revoke_reason, proof_failures = EXCLUDED.proof_failures
             WHERE accounts.sessions.account_id = EXCLUDED.account_id
           RETURNING 1`,
          sessionParams(row),
        );
        // another account's session of that id (made between the check above and this insert) is never overwritten
        if (put.rows.length === 0) throw err('exists', 'the session id belongs to another account');
      };
    });
  }

  sessionByTokenHash(hash: string): Promise<{ row: AccountSessionRow; match: 'current' | 'previous' } | null> {
    return this.read(async (q) => {
      const h = text('hash', hash);
      const r = await q.query<Row>(`SELECT ${SESSION_COLUMNS}, (token_hash = $1) AS is_current FROM accounts.sessions WHERE token_hash = $1 OR previous_hash = $1`, [h]);
      const x = r.rows[0];
      return x ? { row: sessionOf(x), match: x['is_current'] === true ? ('current' as const) : ('previous' as const) } : null;
    });
  }

  /** A normal rotation, compare-and-set on the current hash (the design's UPDATE, under `FOR UPDATE` so the memory store's refusals read alike). */
  rotateSession(id: string, expectCurrent: string, nextHash: string, at: string): Promise<number | null> {
    return this.write([id, expectCurrent, nextHash, at], (id, expectCurrent, nextHash, at) => {
      const sid = text('id', id);
      const expect = text('expectCurrent', expectCurrent);
      const next = word('nextHash', nextHash);
      const when = time('at', at);
      return async (tx) => {
        const cur = await tx.query<Row>(`SELECT ${SESSION_COLUMNS} FROM accounts.sessions WHERE id = $1 FOR UPDATE`, [sid]);
        const s = cur.rows[0] ? sessionOf(cur.rows[0]) : null;
        if (!s || s.revokedAt !== null || s.tokenHash !== expect) return null;
        // the session's own previous hash is in use too (the memory store's rule)
        if (next === expect || (await hashHeld(tx, next, null))) throw err('exists', 'the new token hash is in use');
        const rotation = s.rotation + 1;
        await tx.query('UPDATE accounts.sessions SET previous_hash = $2, token_hash = $3, rotated_at = $4, rotation = $5 WHERE id = $1', [sid, expect, next, when, rotation]);
        return rotation;
      };
    });
  }

  /** Inside the grace, compare-and-set on the previous hash: previousHash and rotatedAt stay, the counter rises. */
  rerotateInGrace(id: string, expectPrevious: string, nextHash: string): Promise<number | null> {
    return this.write([id, expectPrevious, nextHash], (id, expectPrevious, nextHash) => {
      const sid = text('id', id);
      const expect = text('expectPrevious', expectPrevious);
      const next = word('nextHash', nextHash);
      return async (tx) => {
        const cur = await tx.query<Row>(`SELECT ${SESSION_COLUMNS} FROM accounts.sessions WHERE id = $1 FOR UPDATE`, [sid]);
        const s = cur.rows[0] ? sessionOf(cur.rows[0]) : null;
        if (!s || s.revokedAt !== null || s.previousHash === null || s.previousHash !== expect) return null;
        if (next === expect || (await hashHeld(tx, next, null))) throw err('exists', 'the new token hash is in use');
        const rotation = s.rotation + 1;
        await tx.query('UPDATE accounts.sessions SET token_hash = $2, rotation = $3 WHERE id = $1', [sid, next, rotation]);
        return rotation;
      };
    });
  }

  updateSession(id: string, patch: Partial<Pick<AccountSessionRow, 'lastUsedAt' | 'authAt' | 'proofFailures'>>): Promise<void> {
    return this.write([id, patch], (id, patch) => {
      const sid = text('id', id);
      const p = patchKeys('patch', patch, ['lastUsedAt', 'authAt', 'proofFailures']);
      const lastUsedAt = p['lastUsedAt'] === undefined ? null : time('session lastUsedAt', p['lastUsedAt']);
      const authAt = p['authAt'] === undefined ? null : time('session authAt', p['authAt']);
      const failures = p['proofFailures'] === undefined ? null : int('session proofFailures', p['proofFailures']);
      return async (tx) => {
        const u = await tx.query(
          `UPDATE accounts.sessions SET last_used_at = coalesce($2::timestamptz, last_used_at), auth_at = coalesce($3::timestamptz, auth_at),
             proof_failures = coalesce($4::bigint, proof_failures) WHERE id = $1 RETURNING 1`,
          [sid, lastUsedAt, authAt, failures],
        );
        if (u.rows.length === 0) throw err('notFound', 'no such session');
      };
    });
  }

  revokeSession(account: AccountId, id: string, reason: AccountSessionRow['revokeReason'], at: string): Promise<void> {
    return this.write([account, id, reason, at], (account, id, reason, at) => {
      const a = text('account', account);
      const sid = text('id', id);
      const why = oneOf('reason', reason, REVOKE_REASONS);
      const when = time('at', at);
      return async (tx) => {
        const own = await tx.query('SELECT revoked_at FROM accounts.sessions WHERE id = $1 AND account_id = $2 FOR UPDATE', [sid, a]);
        if (own.rows.length === 0) throw err('notFound', 'no such session of this account');
        // the first revocation is kept
        await tx.query('UPDATE accounts.sessions SET revoked_at = $3, revoke_reason = $4 WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL', [sid, a, when, why]);
      };
    });
  }

  revokeSessions(account: AccountId, reason: AccountSessionRow['revokeReason'], at: string, except?: string): Promise<string[]> {
    return this.write([account, reason, at, except], (account, reason, at, except) => {
      const a = text('account', account);
      const why = oneOf('reason', reason, REVOKE_REASONS);
      const when = time('at', at);
      const keep = except === undefined ? null : text('except', except);
      return async (tx) => {
        const r = await tx.query<{ id: string }>(
          `UPDATE accounts.sessions SET revoked_at = $2, revoke_reason = $3
           WHERE account_id = $1 AND revoked_at IS NULL AND ($4::text IS NULL OR id <> $4::text) RETURNING id`,
          [a, when, why, keep],
        );
        return r.rows.map((x) => x.id).sort(compareText);
      };
    });
  }

  sessionsOf(account: AccountId): Promise<AccountSessionRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${SESSION_COLUMNS} FROM accounts.sessions WHERE account_id = $1 ORDER BY created_at, id`, [text('account', account)]);
      return r.rows.map(sessionOf);
    });
  }

  // ---- guest claims (5.5) ----

  claimGuest(c: ClaimRow): Promise<void> {
    return this.write([c], (c) => {
      const row = claimRow(c);
      return async (tx) => {
        await needAccount(tx, row.account);
        await tx.query(`INSERT INTO accounts.guest_claims (${CLAIM_COLUMNS}) VALUES ($1, $2, $3)`, [row.session, row.account, row.claimedAt]); // claimed: 'exists'
      };
    });
  }

  claimsOf(account: AccountId): Promise<ClaimRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${CLAIM_COLUMNS} FROM accounts.guest_claims WHERE account_id = $1 ORDER BY claimed_at, session_id`, [text('account', account)]);
      return r.rows.map(claimOf);
    });
  }

  // ---- relations (9.1) ----

  setRelation(r: RelationRow): Promise<void> {
    return this.write([r], (r) => {
      const row = relationRow(r);
      return async (tx) => {
        await needAccount(tx, row.account);
        // INTERFACE CHANGE (M14-15, review A2): an `other` with no account is dropped here, in the same transaction, not refused; its row is locked
        // against an erase until this commits
        const other = await tx.query('SELECT 1 FROM accounts.accounts WHERE id = $1 FOR KEY SHARE', [row.other]);
        // and it writes as the stored path does, so a block or mute of an id with no account answers in the time of one that has (threat model T2)
        if (other.rows.length === 0) return padWrite(tx);
        await tx.query(
          `INSERT INTO accounts.relations (${RELATION_COLUMNS}) VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id, other_id, kind) DO UPDATE SET created_at = EXCLUDED.created_at`,
          [row.account, row.other, row.kind, row.createdAt],
        );
      };
    });
  }

  deleteRelation(account: AccountId, other: AccountId, kind: RelationRow['kind']): Promise<void> {
    return this.write([account, other, kind], (account, other, kind) => {
      const a = text('account', account);
      const o = text('other', other);
      const k = oneOf('kind', kind, RELATION_KINDS);
      return async (tx) => {
        await tx.query('DELETE FROM accounts.relations WHERE account_id = $1 AND other_id = $2 AND kind = $3', [a, o, k]);
      };
    });
  }

  relationsOf(account: AccountId): Promise<RelationRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${RELATION_COLUMNS} FROM accounts.relations WHERE account_id = $1 ORDER BY created_at, other_id, kind`, [text('account', account)]);
      return r.rows.map(relationOf);
    });
  }

  relationsAmong(ids: readonly AccountId[]): Promise<RelationRow[]> {
    return this.read(async (q) => {
      const list = textList('ids', ids);
      if (list.length === 0) return [];
      const r = await q.query<Row>(
        `SELECT ${RELATION_COLUMNS} FROM accounts.relations WHERE account_id = ANY($1::text[]) AND other_id = ANY($1::text[]) ORDER BY account_id, other_id, kind`,
        [list],
      );
      return r.rows.map(relationOf);
    });
  }

  // ---- email codes (3.4) ----

  putEmailCode(c: EmailCodeRow, now: string): Promise<void> {
    return this.write([c, now], (c, now) => {
      const row = emailCodeRow(c);
      const t = time('now', now);
      const max = this.liveCodesMax;
      return async (tx) => {
        await needAccount(tx, row.account);
        // the cap is checked in this transaction, so the inserts of one account and purpose take turns
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`accounts.email_codes:${row.account}:${row.purpose}`]);
        const taken = await tx.query('SELECT 1 FROM accounts.email_codes WHERE id = $1', [row.id]);
        if (taken.rows.length > 0) throw err('exists', 'the email code id exists');
        const live = await tx.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM accounts.email_codes WHERE account_id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > $3::timestamptz',
          [row.account, row.purpose, t],
        );
        if (num(live.rows[0]?.n ?? 0) >= max) throw err('conflict', `the account has ${max} live codes of this purpose`);
        await tx.query(`INSERT INTO accounts.email_codes (${EMAIL_CODE_COLUMNS}) VALUES (${placeholders(7)})`, [
          row.id, row.account, row.purpose, row.hash, row.createdAt, row.expiresAt, row.usedAt,
        ]);
      };
    });
  }

  liveEmailCodes(account: AccountId, purpose: EmailCodeRow['purpose'], now: string): Promise<EmailCodeRow[]> {
    return this.read(async (q) => {
      const a = text('account', account);
      const p = oneOf('purpose', purpose, EMAIL_PURPOSES);
      const t = new Date(ms('now', now)).toISOString();
      const r = await q.query<Row>(
        `SELECT ${EMAIL_CODE_COLUMNS} FROM accounts.email_codes WHERE account_id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > $3::timestamptz
         ORDER BY created_at, id`,
        [a, p, t],
      );
      return r.rows.map(emailCodeOf);
    });
  }

  /** True exactly once, and only before the code expires (at < expiresAt). */
  useEmailCode(id: string, at: string): Promise<boolean> {
    return this.write([id, at], (id, at) => {
      const x = text('id', id);
      const when = time('at', at);
      return async (tx) => {
        const u = await tx.query('UPDATE accounts.email_codes SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2::timestamptz RETURNING 1', [x, when]);
        return u.rows.length === 1;
      };
    });
  }

  deleteEmailCodes(account: AccountId, purpose: EmailCodeRow['purpose']): Promise<void> {
    return this.write([account, purpose], (account, purpose) => {
      const a = text('account', account);
      const p = oneOf('purpose', purpose, EMAIL_PURPOSES);
      return async (tx) => {
        await tx.query('DELETE FROM accounts.email_codes WHERE account_id = $1 AND purpose = $2', [a, p]);
      };
    });
  }

  // ---- moderation (9) ----

  putReport(r: ReportRow): Promise<void> {
    return this.write([r], (r) => {
      const row = reportRow(r);
      return async (tx) => {
        const taken = await tx.query('SELECT 1 FROM accounts.reports WHERE id = $1', [row.id]);
        if (taken.rows.length > 0) throw err('exists', 'the report id exists');
        // INTERFACE CHANGE (M14-15, review A2): a report about an account that has none is dropped here, in the same transaction; the account's row
        // is locked against an erase until this commits
        if ('account' in row.target) {
          const target = await tx.query('SELECT 1 FROM accounts.accounts WHERE id = $1 FOR KEY SHARE', [row.target.account]);
          if (target.rows.length === 0) return padWrite(tx);
        }
        await tx.query(`INSERT INTO accounts.reports (${REPORT_COLUMNS}) VALUES (${placeholders(18)})`, reportParams(row));
      };
    });
  }

  report(id: string): Promise<ReportRow | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${REPORT_COLUMNS} FROM accounts.reports WHERE id = $1`, [text('id', id)]);
      return r.rows[0] ? reportOf(r.rows[0]) : null;
    });
  }

  /** In id order (report ids are ULIDs: oldest first), after the id `after`; `guestSession`: filed by that guest session or about it. */
  reports(q: ReportQuery): Promise<ReportRow[]> {
    return this.read(async (db) => {
      if (typeof q !== 'object' || q === null) throw err('value', 'the query is not an object');
      const n = limitOf(q.limit);
      const w = new Where();
      if (q.status !== undefined) w.add('status = ?', oneOf('status', q.status, ['new', 'actioned', 'dismissed'] as const));
      if (q.target !== undefined) w.add('target_account = ?', text('target', q.target));
      if (q.reporter !== undefined) w.add('reporter_account = ?', text('reporter', q.reporter));
      if (q.guestSession !== undefined) w.add('(reporter_session = ? OR target_session = ?)', text('guestSession', q.guestSession));
      if (q.after !== undefined) w.add('id > ?', text('after', q.after));
      const r = await db.query<Row>(`SELECT ${REPORT_COLUMNS} FROM accounts.reports ${w.sql} ORDER BY id LIMIT ${w.push(n)}`, w.params);
      return r.rows.map(reportOf);
    });
  }

  closeReport(id: string, status: Exclude<ReportRow['status'], 'new'>, by: string, at: string, note: string | null): Promise<void> {
    return this.write([id, status, by, at, note], (id, status, by, at, note) => {
      const x = text('id', id);
      const s = oneOf('status', status, ['actioned', 'dismissed'] as const);
      const who = word('by', by);
      const when = time('at', at);
      const n = textOrNull('note', note);
      return async (tx) => {
        const u = await tx.query(
          `UPDATE accounts.reports SET status = $2, closed_at = $3, closed_by = $4, note = $5 WHERE id = $1 AND status = 'new' RETURNING 1`,
          [x, s, when, who, n],
        );
        if (u.rows.length === 1) return;
        const cur = await tx.query('SELECT 1 FROM accounts.reports WHERE id = $1', [x]);
        throw cur.rows.length === 0 ? err('notFound', 'no such report') : err('conflict', 'the report is closed already');
      };
    });
  }

  putSanction(s: SanctionRow): Promise<void> {
    return this.write([s], (s) => {
      const row = sanctionRow(s);
      return async (tx) => {
        await needAccount(tx, row.account);
        await tx.query(`INSERT INTO accounts.sanctions (${SANCTION_COLUMNS}) VALUES (${placeholders(15)})`, [
          row.id, row.account, row.kind, row.reason, row.message, row.note, row.createdAt, row.createdBy, row.since, row.until, row.endedAt, row.endReason,
          row.endedBy, row.seenAt, row.reports,
        ]);
      };
    });
  }

  sanction(id: string): Promise<SanctionRow | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${SANCTION_COLUMNS} FROM accounts.sanctions WHERE id = $1`, [text('id', id)]);
      return r.rows[0] ? sanctionOf(r.rows[0]) : null;
    });
  }

  sanctionsOf(account: AccountId): Promise<SanctionRow[]> {
    return this.read(async (q) => {
      const r = await q.query<Row>(`SELECT ${SANCTION_COLUMNS} FROM accounts.sanctions WHERE account_id = $1 ORDER BY since, created_at, id`, [text('account', account)]);
      return r.rows.map(sanctionOf);
    });
  }

  runningSanctions(ids: readonly AccountId[], now: string): Promise<Map<AccountId, SanctionRow[]>> {
    return this.read(async (q) => {
      const list = textList('ids', ids);
      const t = time('now', now);
      const out = new Map<AccountId, SanctionRow[]>();
      if (list.length === 0) return out;
      // sanctionRuns (src/api.ts): started, not ended, `until` not passed
      const r = await q.query<Row>(
        `SELECT ${SANCTION_COLUMNS} FROM accounts.sanctions
         WHERE account_id = ANY($1::text[]) AND since <= $2::timestamptz AND (ended_at IS NULL OR ended_at > $2::timestamptz) AND (until IS NULL OR until > $2::timestamptz)
         ORDER BY since, created_at, id`,
        [list, t],
      );
      for (const x of r.rows) {
        const s = sanctionOf(x);
        const l = out.get(s.account);
        if (l) l.push(s);
        else out.set(s.account, [s]);
      }
      return out;
    });
  }

  endSanction(id: string, at: string, reason: SanctionEnd, by: string): Promise<void> {
    return this.write([id, at, reason, by], (id, at, reason, by) => {
      const x = text('id', id);
      const when = time('at', at);
      const why = oneOf('reason', reason, SANCTION_ENDS);
      const who = word('by', by);
      return async (tx) => {
        const u = await tx.query('UPDATE accounts.sanctions SET ended_at = $2, end_reason = $3, ended_by = $4 WHERE id = $1 AND ended_at IS NULL RETURNING 1', [x, when, why, who]);
        if (u.rows.length === 1) return;
        const cur = await tx.query('SELECT 1 FROM accounts.sanctions WHERE id = $1', [x]);
        throw cur.rows.length === 0 ? err('notFound', 'no such sanction') : err('conflict', 'the sanction has ended already');
      };
    });
  }

  sanctionsEndingBy(at: string, limit: number): Promise<SanctionRow[]> {
    return this.read(async (q) => {
      const t = new Date(ms('at', at)).toISOString();
      const n = limitOf(limit);
      const r = await q.query<Row>(
        `SELECT ${SANCTION_COLUMNS} FROM accounts.sanctions WHERE ended_at IS NULL AND until IS NOT NULL AND until <= $1::timestamptz ORDER BY until, id LIMIT $2`,
        [t, n],
      );
      return r.rows.map(sanctionOf);
    });
  }

  markSeen(account: AccountId, sanction: string, at: string): Promise<void> {
    return this.write([account, sanction, at], (account, sanction, at) => {
      const a = text('account', account);
      const s = text('sanction', sanction);
      const when = time('at', at);
      return async (tx) => {
        const own = await tx.query('SELECT 1 FROM accounts.sanctions WHERE id = $1 AND account_id = $2 FOR UPDATE', [s, a]);
        if (own.rows.length === 0) throw err('notFound', 'no such sanction of this account');
        await tx.query('UPDATE accounts.sanctions SET seen_at = $2 WHERE id = $1 AND seen_at IS NULL', [s, when]);
      };
    });
  }

  putAppeal(a: AppealRow): Promise<void> {
    return this.write([a], (a) => {
      const row = appealRow(a);
      return async (tx) => {
        // the account's row first, as an erase takes it (the insert's own foreign keys would take the sanction's row before it, and an erase of the account
        // deletes that sanction after: two transactions each waiting for the other); no account is no sanction of it
        await needAccount(tx, row.account);
        // the design's statement: only for a sanction of the appealing account (otherwise nothing is inserted: 'notFound'); a second appeal is a primary key violation: 'exists'
        const put = await tx.query(
          `INSERT INTO accounts.appeals (${APPEAL_COLUMNS})
           SELECT $1::text, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::timestamptz, $8::text WHERE EXISTS (SELECT 1 FROM accounts.sanctions WHERE id = $1 AND account_id = $2)
           RETURNING 1`,
          [row.sanction, row.account, row.text, row.createdAt, row.answer, row.answerMessage, row.answeredAt, row.answeredBy],
        );
        if (put.rows.length === 0) throw err('notFound', 'no such sanction of this account');
      };
    });
  }

  /** open true: unanswered only; false: answered only; absent: all. Oldest first (createdAt, then the sanction id), after the appeal of sanction `after`. */
  appeals(q: { open?: boolean; account?: AccountId; limit: number; after?: string }): Promise<AppealRow[]> {
    return this.read(async (db) => {
      if (typeof q !== 'object' || q === null) throw err('value', 'the query is not an object');
      const n = limitOf(q.limit);
      const w = new Where();
      if (q.open !== undefined) w.add(bool('open', q.open) ? 'answer IS NULL' : 'answer IS NOT NULL');
      if (q.account !== undefined) w.add('account_id = ?', text('account', q.account));
      // none after a sanction that has no appeal: the comparison with no row is null
      if (q.after !== undefined) w.add('(created_at, sanction_id) > (SELECT created_at, sanction_id FROM accounts.appeals WHERE sanction_id = ?)', text('after', q.after));
      const r = await db.query<Row>(`SELECT ${APPEAL_COLUMNS} FROM accounts.appeals ${w.sql} ORDER BY created_at, sanction_id LIMIT ${w.push(n)}`, w.params);
      return r.rows.map(appealOf);
    });
  }

  answerAppeal(sanction: string, answer: 'upheld' | 'lifted', message: string, by: string, at: string): Promise<void> {
    return this.write([sanction, answer, message, by, at], (sanction, answer, message, by, at) => {
      const s = text('sanction', sanction);
      const ans = oneOf('answer', answer, ['upheld', 'lifted'] as const);
      const msg = text('message', message);
      const who = word('by', by);
      const when = time('at', at);
      return async (tx) => {
        const u = await tx.query(
          'UPDATE accounts.appeals SET answer = $2, answer_message = $3, answered_at = $4, answered_by = $5 WHERE sanction_id = $1 AND answer IS NULL RETURNING 1',
          [s, ans, msg, when, who],
        );
        if (u.rows.length === 1) return;
        const cur = await tx.query('SELECT 1 FROM accounts.appeals WHERE sanction_id = $1', [s]);
        throw cur.rows.length === 0 ? err('notFound', 'no such appeal') : err('conflict', 'the appeal is answered already');
      };
    });
  }

  // ---- the audit log and the change feed (8.5, 9.7) ----

  /**
   * Appends every event or none: 'exists' when an id is taken (an event is never replaced). An erased account's events are kept as erase leaves them
   * (keptEvent), checked in this transaction: the live accounts' rows are locked first, so an erase of one waits for this write and removes what it
   * wrote, or this write finds the tombstone.
   */
  appendAudit(events: readonly AuditEvent[]): Promise<void> {
    return this.write([events], (events) => {
      if (!Array.isArray(events)) throw err('value', 'events is not an array');
      const rows = events.map(auditRow);
      if (new Set(rows.map((e) => e.id)).size !== rows.length) throw err('exists', 'the audit event id exists');
      return async (tx) => {
        if (rows.length === 0) return;
        const taken = await tx.query('SELECT 1 FROM accounts.audit WHERE id = ANY($1::text[]) LIMIT 1', [rows.map((e) => e.id)]);
        if (taken.rows.length > 0) throw err('exists', 'the audit event id exists');
        const about = [...new Set(rows.filter((e) => e.account !== null && e.kind !== 'deleted').map((e) => e.account!))].sort(compareText);
        let tombs: Set<string> = new Set();
        if (about.length > 0) {
          // names before account rows, the one order of every writer that has both (a rekey takes them in it)
          await tx.exec('LOCK TABLE accounts.names IN ROW EXCLUSIVE MODE');
          await tx.query('SELECT id FROM accounts.accounts WHERE id = ANY($1::text[]) ORDER BY id FOR KEY SHARE', [about]);
          const t = await tx.query<{ account_id: string }>('SELECT account_id FROM accounts.tombstones WHERE account_id = ANY($1::text[])', [about]);
          tombs = new Set(t.rows.map((x) => x.account_id));
        }
        const kept = rows.map((e) => keptEvent(e, tombs)).filter((e): e is AuditEvent => e !== null);
        await insertRows(tx, 'audit', AUDIT_COLUMNS, kept.map(auditParams));
      };
    });
  }

  /** Oldest first (at, then id); `since` inclusive, `before` exclusive. */
  audit(q: AuditQuery): Promise<AuditEvent[]> {
    return this.read(async (db) => {
      if (typeof q !== 'object' || q === null) throw err('value', 'the query is not an object');
      const n = limitOf(q.limit);
      const w = new Where();
      if (q.account !== undefined) w.add('account_id = ?', text('account', q.account));
      if (q.kinds !== undefined) w.add('kind = ANY(?::text[])', textList('kinds', q.kinds));
      if (q.since !== undefined) w.add('at >= ?::timestamptz', new Date(ms('since', q.since)).toISOString());
      if (q.before !== undefined) w.add('at < ?::timestamptz', new Date(ms('before', q.before)).toISOString());
      const r = await db.query<Row>(`SELECT ${AUDIT_COLUMNS} FROM accounts.audit ${w.sql} ORDER BY at, id LIMIT ${w.push(n)}`, w.params);
      return r.rows.map(auditOf);
    });
  }

  /** An erased account's change other than `deleted` is refused ('notFound') and nothing is appended. */
  appendChange(c: Omit<AccountChange, 'seq'>): Promise<number> {
    return this.write([c], (c) => {
      const row = changeRow(c, 1);
      return async (tx) => {
        // the account's row first (the erased-account rule, as appendAudit): an erase of the account holds it, and a writer waiting for it must not
        // hold the feed's lock meanwhile, or every other change would queue behind the erase
        if (row.kind !== 'deleted') {
          await tx.query('SELECT 1 FROM accounts.accounts WHERE id = $1 FOR KEY SHARE', [row.account]);
          const tomb = await tx.query('SELECT 1 FROM accounts.tombstones WHERE account_id = $1', [row.account]);
          if (tomb.rows.length > 0) throw err('notFound', 'the account is erased');
        }
        // then the feed's lock (a reader never sees seq n + 1 before n)
        await tx.query('SELECT pg_advisory_xact_lock($1)', [CHANGES_LOCK_KEY]);
        const head = await tx.query<{ last_seq: unknown }>('UPDATE accounts.change_head SET last_seq = last_seq + 1 RETURNING last_seq');
        const seq = num(head.rows[0]!.last_seq);
        await tx.query('INSERT INTO accounts.changes (seq, at, account_id, kind, session_id, detail) VALUES ($1, $2, $3, $4, $5, $6)', [
          seq, row.at, row.account, row.kind, row.session ?? null, row.detail === undefined ? null : JSON.stringify(row.detail),
        ]);
        return seq;
      };
    });
  }

  changes(after: number, limit: number): Promise<AccountChange[]> {
    return this.read(async (q) => {
      const from = int('after', after);
      const n = limitOf(limit);
      const r = await q.query<Row>('SELECT seq, at, account_id, kind, session_id, detail FROM accounts.changes WHERE seq > $1 ORDER BY seq LIMIT $2', [from, n]);
      return r.rows.map(changeOf);
    });
  }

  /** The newest seq given out: it never goes back, not even when purge has removed every change. */
  changesHead(): Promise<number> {
    return this.read(async (q) => {
      const r = await q.query<{ last_seq: unknown }>('SELECT last_seq FROM accounts.change_head');
      return num(r.rows[0]?.last_seq ?? 0);
    });
  }

  // ---- deletion and retention (10) ----

  /** By purgeAt, then id, after the cursor `after`. */
  dueDeletions(at: string, limit: number, after?: ListCursor): Promise<AccountId[]> {
    return this.read(async (q) => {
      const t = ms('at', at);
      const n = limitOf(limit);
      const c = cursorOf(after);
      const w = new Where();
      w.add('purge_at IS NOT NULL');
      w.add('purge_at <= ?::timestamptz', new Date(t).toISOString());
      if (c) w.add('(purge_at, id) > (?::timestamptz, ?::text)', new Date(c.at).toISOString(), c.account);
      const r = await q.query<{ id: string }>(`SELECT id FROM accounts.accounts ${w.sql} ORDER BY purge_at, id LIMIT ${w.push(n)}`, w.params);
      return r.rows.map((x) => x.id as AccountId);
    });
  }

  /**
   * 10.2 step 5, as the memory store's erase (its comment lists what goes and what is scrubbed), in one transaction: refused ('conflict') unless the
   * account's erasure has been claimed (deletion.erasingAt set, purgeAt at or before the tombstone's deletedAt) **and the database's clock agrees**
   * (accounts.erasure_claimed: the rule purge_audit enforces itself), so the audit events are never left behind; a second call after the tombstone finds
   * nothing more ('notFound' for an id that never existed). The audit events go through `purge_audit(account)`, called while the account row still
   * shows the claim; the tombstone is written last.
   *
   * The free text of rows that stay (other accounts' reports, sanctions, appeals, names notes) is scrubbed by the same JavaScript as the memory store's
   * (scrubberOf: Unicode case folding is the language's, not the database's), over every row that holds typed text, in id order and in batches. That
   * is a scan of those tables per erase: erases are rare, and one at a time (ERASE_LOCK_KEY).
   */
  erase(id: AccountId, tombstone: TombstoneRow, nameHoldUntil: string): Promise<void> {
    return this.write([id, tombstone, nameHoldUntil], (id, tombstone, nameHoldUntil) => {
      const x = text('id', id);
      const ts = tombstoneRow(tombstone);
      const hold = time('nameHoldUntil', nameHoldUntil);
      if (ts.account !== x) throw err('value', 'the tombstone is of another account');
      return async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock($1)', [ERASE_LOCK_KEY]);
        // names before account rows, the one order of every writer that has both
        await tx.exec('LOCK TABLE accounts.names IN ROW EXCLUSIVE MODE');
        const cur = await tx.query<Row>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts.accounts WHERE id = $1 FOR UPDATE`, [x]);
        if (!cur.rows[0]) {
          const done = await tx.query('SELECT 1 FROM accounts.tombstones WHERE account_id = $1', [x]);
          if (done.rows.length > 0) return;
          throw err('notFound', 'no such account');
        }
        const a = accountOf(cur.rows[0]);
        if (a.deletion === null || a.deletion.erasingAt === null || Date.parse(a.deletion.purgeAt) > Date.parse(ts.deletedAt)) {
          throw err('conflict', 'the account\'s erasure has not been claimed');
        }
        const claimed = await tx.query<{ ok: boolean }>('SELECT accounts.erasure_claimed($1::text) AS ok', [x]);
        if (claimed.rows[0]?.ok !== true) throw err('conflict', 'the database does not show the account\'s erasure as claimed and due');
        const history = await tx.query<{ name: string }>('SELECT name FROM accounts.name_history WHERE account_id = $1', [x]);
        const scrub = scrubberOf([a.name, ...history.rows.map((r) => r.name), ...(a.email ? [a.email.address] : [])]);
        // its claimed guest sessions, read before the claims go: reports by or about them are the account's (5.5)
        const guests = (await tx.query<{ session_id: string }>('SELECT session_id FROM accounts.guest_claims WHERE account_id = $1', [x])).rows.map((r) => r.session_id);

        // names: its current key held for nobody until `hold`; every other key it holds, or banned, for nobody
        await tx.query(`UPDATE accounts.names SET kind = 'held', account_id = NULL, until = $2 WHERE account_id = $1 AND kind = 'current'`, [x, hold]);
        await tx.query('UPDATE accounts.names SET account_id = NULL WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.name_history WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.recovery_codes WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.credentials WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.devices WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.sessions WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.guest_claims WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.relations WHERE account_id = $1 OR other_id = $1', [x]);
        await tx.query('DELETE FROM accounts.email_codes WHERE account_id = $1', [x]);
        await tx.query('DELETE FROM accounts.appeals WHERE account_id = $1 OR sanction_id IN (SELECT id FROM accounts.sanctions WHERE account_id = $1)', [x]);
        await tx.query('DELETE FROM accounts.sanctions WHERE account_id = $1', [x]);
        // reports: the closed ones it filed or is the target of go; the open ones lose the reporter, or the target's name; its id leaves `related`
        await tx.query(
          `DELETE FROM accounts.reports WHERE status <> 'new'
             AND (reporter_account = $1 OR target_account = $1 OR reporter_session = ANY($2::text[]) OR target_session = ANY($2::text[]))`,
          [x, guests],
        );
        await tx.query(
          `UPDATE accounts.reports SET reporter_kind = NULL, reporter_account = NULL, reporter_session = NULL, reporter_source = NULL
           WHERE reporter_account = $1 OR reporter_session = ANY($2::text[])`,
          [x, guests],
        );
        await tx.query(`UPDATE accounts.reports SET target_name = $3 WHERE target_account = $1 OR target_session = ANY($2::text[])`, [x, guests, DELETED_PLAYER_NAME]);
        await tx.query('UPDATE accounts.reports SET related = array_remove(related, $1::text) WHERE $1::text = ANY(related)', [x]);
        await scrubTexts(tx, scrub);
        // the audit log: its events but `deleted`, its operator events' account id (the function checks the claim itself)
        await tx.query('SELECT accounts.purge_audit($1::text)', [x]);
        await tx.query(`DELETE FROM accounts.changes WHERE account_id = $1 AND kind <> 'deleted'`, [x]);
        await tx.query('DELETE FROM accounts.accounts WHERE id = $1', [x]);
        await tx.query('INSERT INTO accounts.tombstones (account_id, deleted_at, sanction_until, hold_until, holders_done) VALUES ($1, $2, $3, $4, $5)', [
          ts.account, ts.deletedAt, ts.sanctionUntil, hold, ts.holdersDone,
        ]);
      };
    });
  }

  tombstone(id: AccountId): Promise<TombstoneRow | null> {
    return this.read(async (q) => {
      const r = await q.query<Row>('SELECT account_id, deleted_at, sanction_until, holders_done FROM accounts.tombstones WHERE account_id = $1', [text('id', id)]);
      const x = r.rows[0];
      return x
        ? { account: str(x['account_id']) as AccountId, deletedAt: iso(x['deleted_at']), sanctionUntil: isoOrNull(x['sanction_until']), holdersDone: strings(x['holders_done']) }
        : null;
    });
  }

  /**
   * Retention (10.3) at `now`, as the memory store's: sessions revoked or expired more than revokedSessionsMs ago; device proofs unused for deviceIdleMs;
   * email codes used or expired; names entries whose `until` has passed; reports closed more than closedReportsMs ago; tombstones once the name hold
   * their erase wrote and their sanctionUntil (when set) have both passed; changes older than changesMs. Audit events go only through
   * `purge_audit`, which enforces the policy's floors itself by the database's clock and takes the configured retention as "keep at least this long"
   * (never shorter than the floors, so a policy cannot make it delete anything younger); its count is the report's `audit`. The tombstones go before
   * the audit events, so a `deleted` event whose tombstone this purge removed is old enough to go in the same run.
   */
  purge(policy: AccountRetention, now: string): Promise<AccountPurgeReport> {
    return this.write([policy, now], (policy, now) => {
      if (typeof policy !== 'object' || policy === null) throw err('value', 'the policy is not an object');
      const t = ms('now', now);
      const p = (k: keyof AccountRetention) => int(`policy.${k}`, policy[k]);
      const sessionsMs = p('revokedSessionsMs');
      const deviceMs = p('deviceIdleMs');
      const reportsMs = p('closedReportsMs');
      const securityMs = p('securityAuditMs');
      const operatorMs = p('operatorAuditMs');
      const changesMs = p('changesMs');
      const nowIso = new Date(t).toISOString();
      return async (tx) => {
        // an erase and this purge each delete rows of the other's tables (an expired key an account held, its old sessions): one at a time, in one order
        await tx.query('SELECT pg_advisory_xact_lock($1)', [ERASE_LOCK_KEY]);
        const count = async (sql: string, params: unknown[]): Promise<number> => (await tx.query(`${sql} RETURNING 1`, params)).rows.length;
        const report: AccountPurgeReport = { sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 };
        report.sessions = await count('DELETE FROM accounts.sessions WHERE least(revoked_at, expires_at) <= $1::timestamptz', [cutoff(t, sessionsMs)]);
        report.devices = await count('DELETE FROM accounts.devices WHERE last_used_at <= $1::timestamptz', [cutoff(t, deviceMs)]);
        report.emailCodes = await count('DELETE FROM accounts.email_codes WHERE used_at IS NOT NULL OR expires_at <= $1::timestamptz', [nowIso]);
        report.names = await count(`DELETE FROM accounts.names WHERE kind <> 'current' AND until IS NOT NULL AND until <= $1::timestamptz`, [nowIso]);
        report.reports = await count(`DELETE FROM accounts.reports WHERE status <> 'new' AND closed_at IS NOT NULL AND closed_at <= $1::timestamptz`, [cutoff(t, reportsMs)]);
        report.tombstones = await count('DELETE FROM accounts.tombstones WHERE hold_until <= $1::timestamptz AND (sanction_until IS NULL OR sanction_until <= $1::timestamptz)', [nowIso]);
        const audit = await tx.query<{ n: unknown }>('SELECT accounts.purge_audit(NULL::text, $1::bigint, $2::bigint) AS n', [securityMs, operatorMs]);
        report.audit = num(audit.rows[0]?.n ?? 0);
        report.changes = await count('DELETE FROM accounts.changes WHERE at <= $1::timestamptz', [cutoff(t, changesMs)]);
        return report;
      };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sql.close();
  }
}

/** The rows per page of erase's scan of typed text. */
export const SCRUB_PAGE = 500;

/**
 * Replaces the erased account's names and address in the free text of every row that stays (reports' text and note, sanctions' message and note,
 * appeals' text and answer message, names entries' note, and a reserved key's name, dropped whole: a scrubbed name would key to something else), by
 * `scrub`, in id order and in pages, writing back only the rows that changed.
 */
async function scrubTexts(tx: AccountsSqlQueryable, scrub: (s: string | null) => string | null): Promise<void> {
  const pages = async (sql: string, each: (r: Row) => Promise<void>): Promise<void> => {
    let last: string | null = null;
    for (;;) {
      const r: { rows: Row[] } = await tx.query<Row>(sql, [last, SCRUB_PAGE]);
      for (const row of r.rows) await each(row);
      if (r.rows.length < SCRUB_PAGE) return;
      last = str(r.rows[r.rows.length - 1]!['id']);
    }
  };
  await pages(
    'SELECT id, text, note FROM accounts.reports WHERE (text IS NOT NULL OR note IS NOT NULL) AND ($1::text IS NULL OR id > $1::text) ORDER BY id LIMIT $2',
    async (r) => {
      const t = scrub(strOrNull(r['text']));
      const n = scrub(strOrNull(r['note']));
      if (t !== r['text'] || n !== r['note']) await tx.query('UPDATE accounts.reports SET text = $2, note = $3 WHERE id = $1', [r['id'], t, n]);
    },
  );
  await pages('SELECT id, message, note FROM accounts.sanctions WHERE ($1::text IS NULL OR id > $1::text) ORDER BY id LIMIT $2', async (r) => {
    const m = scrub(str(r['message']))!;
    const n = scrub(strOrNull(r['note']));
    if (m !== r['message'] || n !== r['note']) await tx.query('UPDATE accounts.sanctions SET message = $2, note = $3 WHERE id = $1', [r['id'], m, n]);
  });
  await pages(
    `SELECT sanction_id AS id, text, answer_message FROM accounts.appeals WHERE ($1::text IS NULL OR sanction_id > $1::text) ORDER BY sanction_id LIMIT $2`,
    async (r) => {
      const t = scrub(str(r['text']))!;
      const a = scrub(strOrNull(r['answer_message']));
      if (t !== r['text'] || a !== r['answer_message']) await tx.query('UPDATE accounts.appeals SET text = $2, answer_message = $3 WHERE sanction_id = $1', [r['id'], t, a]);
    },
  );
  // names entries have a two-part key: page by key, then every version of it
  let last: string | null = null;
  for (;;) {
    const r: { rows: Row[] } = await tx.query<Row>(
      `SELECT key, key_version, note, name FROM accounts.names WHERE (note IS NOT NULL OR name IS NOT NULL) AND ($1::text IS NULL OR key > $1::text)
         AND key <= coalesce((SELECT max(f.key) FROM (SELECT key FROM accounts.names WHERE (note IS NOT NULL OR name IS NOT NULL) AND ($1::text IS NULL OR key > $1::text)
                                                    ORDER BY key LIMIT $2) f), '')
       ORDER BY key, key_version`,
      [last, SCRUB_PAGE],
    );
    for (const row of r.rows) {
      const note = scrub(strOrNull(row['note']));
      const nm = strOrNull(row['name']);
      const dropName = nm !== null && scrub(nm) !== nm;
      if (note !== row['note'] || dropName) {
        await tx.query('UPDATE accounts.names SET note = $3, name = $4 WHERE key = $1 AND key_version = $2', [row['key'], row['key_version'], note, dropName ? null : nm]);
      }
    }
    if (r.rows.length === 0) return;
    last = str(r.rows[r.rows.length - 1]!['key']);
  }
}

