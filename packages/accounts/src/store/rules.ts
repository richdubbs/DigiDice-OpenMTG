/**
 * The rules every account store keeps alike (M14-4; design 11.2), so the memory, file and PostgreSQL stores behave the same under the one contract
 * suite (test/m14-4/contract.ts):
 *
 * - **Exactly the contract's fields.** Every row a store writes is rebuilt here from the caller's object, field by field, into a new object: an extra
 *   property never reaches the store (TypeScript does not stop one at run time), and a caller that changes its object afterwards changes nothing.
 * - **Text** a database would refuse or change (NUL, an unpaired surrogate; src/text.ts, the named copy of m13's store rules) is refused in every
 *   string and every key ('value'), in lookups too, as PostgreSQL refuses such a parameter.
 * - **Ids** meet m13's store id rule (`STORE_ID`, 1-64 characters of `[0-9A-Za-z_-]`).
 * - **Times** parse as ISO-8601 and are kept in their canonical UTC form (`Date.toISOString`), what a `timestamptz` column gives back; a time that
 *   does not parse is refused, so `accountStatus` never meets a damaged one in a stored row.
 * - **Closed sets** (kinds, providers, reasons, statuses) are checked, as the PostgreSQL schema's CHECKs and `audit_kinds` do.
 * - **JSON** fields (`meta`, `details`, `evidence.stats`, `detail`) hold only plain JSON: strings, finite numbers, booleans, null, arrays and plain
 *   objects (jsonb's values).
 */
import {
  AUDIT_KINDS, REPORT_REASONS, isAvatarId,
  type Account, type AccountChange, type AccountId, type AuditEvent, type ChangeKind, type ProviderId, type RelationKind, type ReportStatus,
  type RevokeReason, type SanctionEnd, type SanctionKind, type SanctionReason,
} from '../api';
import { STORE_ID, textProblem } from '../text';
import {
  AccountStoreError,
  type AccountSessionRow, type AppealRow, type ClaimRow, type CredentialRow, type DeviceRow, type EmailCodeRow, type NameEntry, type NameHistoryRow,
  type NameKind, type RecoveryCodeRow, type RelationRow, type ReportRow, type ReporterRef, type ReportTarget, type SanctionRow, type StoreErrorCode,
  type TombstoneRow,
} from './api';

export function storeError(code: StoreErrorCode, message: string): AccountStoreError {
  return new AccountStoreError(code, message);
}

function bad(label: string, why: string): never {
  throw storeError('value', `${label} ${why}`);
}

// ---- scalars ---------------------------------------------------------------------------------------------------------------------------------

/** A string without NUL or unpaired surrogates (the text rule every store keeps). */
export function text(label: string, v: unknown): string {
  if (typeof v !== 'string') bad(label, 'is not a string');
  const p = textProblem(v);
  if (p) bad(label, p === 'nul' ? 'holds a NUL character' : 'holds an unpaired surrogate');
  return v;
}
export function textOrNull(label: string, v: unknown): string | null {
  return v === null ? null : text(label, v);
}
/** A string with at least one character. */
export function word(label: string, v: unknown): string {
  const s = text(label, v);
  if (s.length === 0) bad(label, 'is empty');
  return s;
}
/** An id: m13's store id rule (STORE_ID). */
export function storeId(label: string, v: unknown): string {
  const s = text(label, v);
  if (!STORE_ID.test(s)) bad(label, 'is not 1-64 characters of [0-9A-Za-z_-]');
  return s;
}
export function accountId(label: string, v: unknown): AccountId {
  return storeId(label, v) as AccountId;
}
/**
 * The years a stored time may have, 1000-01-01T00:00:00.000Z to 9999-12-31T23:59:59.999Z: four year digits, which PostgreSQL stores and its drivers read back
 * (PGlite's date reader mistakes years below 1000 for two-digit ones, and a database's own clock never meets them).
 */
const MIN_TIME_MS = -30_610_224_000_000;
const MAX_TIME_MS = 253_402_300_799_999;
/**
 * Milliseconds of an ISO-8601 time, or 'value'. INTERFACE CHANGE (M14-11): a time before year 1000 or after year 9999 is refused by every store (a date
 * the language holds but whose ISO form PostgreSQL does not read: the PostgreSQL store refused it, the memory store did not).
 */
export function ms(label: string, v: unknown): number {
  if (typeof v !== 'string') bad(label, 'is not an ISO 8601 time');
  const t = Date.parse(v);
  if (!Number.isFinite(t)) bad(label, 'is not an ISO 8601 time');
  if (t < MIN_TIME_MS || t > MAX_TIME_MS) bad(label, 'is outside the years 1000 to 9999');
  return t;
}
/** The canonical form of an ISO-8601 time (Date.toISOString), or 'value'. */
export function time(label: string, v: unknown): string {
  return new Date(ms(label, v)).toISOString();
}
export function timeOrNull(label: string, v: unknown): string | null {
  return v === null ? null : time(label, v);
}
/** A safe integer of at least `min`. */
export function int(label: string, v: unknown, min = 0): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) bad(label, `is not an integer of at least ${min}`);
  return v;
}
export function bool(label: string, v: unknown): boolean {
  if (typeof v !== 'boolean') bad(label, 'is not a boolean');
  return v;
}
export function oneOf<T extends string>(label: string, v: unknown, set: readonly T[]): T {
  if (typeof v !== 'string' || !(set as readonly string[]).includes(v)) bad(label, 'is not one of the known values');
  return v as T;
}
function obj(label: string, v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(label, 'is not an object');
  return v as Record<string, unknown>;
}
function list(label: string, v: unknown): readonly unknown[] {
  if (!Array.isArray(v)) bad(label, 'is not an array');
  return v;
}
export function textList(label: string, v: unknown): string[] {
  return list(label, v).map((x, i) => text(`${label}[${i}]`, x));
}
/** A limit: an integer of at least 0. */
export function limitOf(v: unknown): number {
  return int('limit', v, 0);
}
/** A ListCursor (INTERFACE CHANGE (M14-7)): its time in milliseconds and its account id; null when there is none. */
export function cursorOf(v: unknown): { at: number; account: AccountId } | null {
  if (v === undefined) return null;
  const c = obj('after', v);
  return { at: ms('after.at', c['at']), account: accountId('after.account', c['account']) };
}

/**
 * Plain JSON (jsonb's values): strings and keys under the text rule, finite numbers, booleans, null, arrays and plain objects. A property whose value
 * is undefined is left out, as JSON does. Returns a copy.
 */
export function plainJson(label: string, v: unknown, depth = 0): unknown {
  if (depth > 64) bad(label, 'is nested too deep');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'string') return text(label, v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad(label, 'is not a finite number');
    return v;
  }
  if (Array.isArray(v)) return v.map((x, i) => plainJson(`${label}[${i}]`, x, depth + 1));
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v) as unknown;
    if (proto !== Object.prototype && proto !== null) bad(label, 'is not a plain object');
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      text(`${label} key`, k);
      if (x !== undefined) out[k] = plainJson(`${label}.${k}`, x, depth + 1);
    }
    return out;
  }
  bad(label, 'is not JSON');
}

// ---- closed sets -----------------------------------------------------------------------------------------------------------------------------

export const NAME_KINDS: readonly NameKind[] = ['current', 'held', 'reserved', 'banned'];
export const PROVIDERS: readonly ProviderId[] = ['local', 'shopify', 'passkey'];
const CLIENTS = ['desktop', 'web'] as const;
export const REVOKE_REASONS: readonly RevokeReason[] = [
  'signOut', 'signOutEverywhere', 'revoked', 'passwordChanged', 'recovery', 'emailReset', 'reuse', 'proofFailed', 'expired', 'tooMany', 'sanction',
  'deletion', 'admin',
];
export const RELATION_KINDS: readonly RelationKind[] = ['block', 'mute'];
const SANCTION_KINDS: readonly SanctionKind[] = ['warn', 'mute', 'rename', 'unlist', 'suspend', 'ban'];
const SANCTION_REASONS: readonly SanctionReason[] = [...REPORT_REASONS, 'evasion'];
const REPORT_STATUSES: readonly ReportStatus[] = ['new', 'actioned', 'dismissed'];
export const SANCTION_ENDS: readonly SanctionEnd[] = ['lifted', 'expired', 'appeal'];
const CHANGE_KINDS: readonly ChangeKind[] = ['sessionRevoked', 'sessionsRevoked', 'standing', 'renamed', 'avatar', 'deleting', 'deleted'];
export const EMAIL_PURPOSES: readonly EmailCodeRow['purpose'][] = ['verify', 'reset'];
const HISTORY_CAUSES: readonly NameHistoryRow['cause'][] = ['register', 'rename', 'forced'];
const APPEAL_ANSWERS = ['upheld', 'lifted'] as const;

// ---- rows ------------------------------------------------------------------------------------------------------------------------------------

export function accountRow(v: unknown): Account {
  const a = obj('account', v);
  const privacy = obj('account.privacy', a['privacy']);
  const email = a['email'] === null ? null : obj('account.email', a['email']);
  const age = obj('account.ageGate', a['ageGate']);
  const del = a['deletion'] === null ? null : obj('account.deletion', a['deletion']);
  if (!isAvatarId(a['avatar'])) bad('account.avatar', 'is not an avatar id');
  return {
    id: accountId('account.id', a['id']),
    name: word('account.name', a['name']),
    nameKey: word('account.nameKey', a['nameKey']),
    keyVersion: int('account.keyVersion', a['keyVersion']),
    avatar: a['avatar'],
    privacy: {
      history: oneOf('account.privacy.history', privacy['history'], ['public', 'private'] as const),
      leaderboards: bool('account.privacy.leaderboards', privacy['leaderboards']),
      guestsAtMyTables: bool('account.privacy.guestsAtMyTables', privacy['guestsAtMyTables']),
    },
    email: email === null ? null : {
      address: word('account.email.address', email['address']), verifiedAt: timeOrNull('account.email.verifiedAt', email['verifiedAt']),
      // INTERFACE CHANGE (M14-15, review A5): when the address was set; absent on rows written before it
      ...(email['setAt'] !== undefined ? { setAt: time('account.email.setAt', email['setAt']) } : {}),
    },
    ageGate: { minAge: int('account.ageGate.minAge', age['minAge']), passedAt: time('account.ageGate.passedAt', age['passedAt']) },
    createdAt: time('account.createdAt', a['createdAt']),
    lastSignInAt: timeOrNull('account.lastSignInAt', a['lastSignInAt']),
    renamedAt: timeOrNull('account.renamedAt', a['renamedAt']),
    freeRename: bool('account.freeRename', a['freeRename']),
    deletion:
      del === null
        ? null
        : {
            requestedAt: time('account.deletion.requestedAt', del['requestedAt']),
            purgeAt: time('account.deletion.purgeAt', del['purgeAt']),
            erasingAt: timeOrNull('account.deletion.erasingAt', del['erasingAt']),
            done: textList('account.deletion.done', del['done']),
          },
    inactiveNoticeAt: timeOrNull('account.inactiveNoticeAt', a['inactiveNoticeAt']),
    version: int('account.version', a['version']),
  };
}

export function nameEntryRow(v: unknown): NameEntry {
  const e = obj('name entry', v);
  return {
    key: word('name entry key', e['key']),
    keyVersion: int('name entry keyVersion', e['keyVersion']),
    kind: oneOf('name entry kind', e['kind'], NAME_KINDS),
    account: e['account'] === null ? null : accountId('name entry account', e['account']),
    until: timeOrNull('name entry until', e['until']),
    note: textOrNull('name entry note', e['note']),
    createdAt: time('name entry createdAt', e['createdAt']),
    // INTERFACE CHANGE (M14-15, review A7): a reserved key's name, when it has one
    ...(e['name'] !== undefined && e['name'] !== null ? { name: text('name entry name', e['name']) } : {}),
  };
}

export function historyRow(v: unknown): NameHistoryRow {
  const h = obj('name history row', v);
  return {
    account: accountId('name history account', h['account']),
    name: word('name history name', h['name']),
    key: word('name history key', h['key']),
    keyVersion: int('name history keyVersion', h['keyVersion']),
    from: time('name history from', h['from']),
    to: timeOrNull('name history to', h['to']),
    cause: oneOf('name history cause', h['cause'], HISTORY_CAUSES),
    redacted: bool('name history redacted', h['redacted']),
  };
}

export function credentialRow(v: unknown): CredentialRow {
  const c = obj('credential', v);
  const meta = plainJson('credential.meta', obj('credential.meta', c['meta'])) as Record<string, unknown>;
  for (const [k, x] of Object.entries(meta)) {
    if (x !== null && typeof x === 'object') bad(`credential.meta.${k}`, 'is not a string, number, boolean or null');
  }
  return {
    account: accountId('credential.account', c['account']),
    provider: oneOf('credential.provider', c['provider'], PROVIDERS),
    subject: word('credential.subject', c['subject']),
    secret: textOrNull('credential.secret', c['secret']),
    meta: meta as CredentialRow['meta'],
    createdAt: time('credential.createdAt', c['createdAt']),
    lastUsedAt: timeOrNull('credential.lastUsedAt', c['lastUsedAt']),
  };
}

export function recoveryRow(v: unknown): RecoveryCodeRow {
  const r = obj('recovery code', v);
  return {
    account: accountId('recovery code account', r['account']),
    slot: int('recovery code slot', r['slot']),
    hash: word('recovery code hash', r['hash']),
    generation: int('recovery code generation', r['generation']),
    createdAt: time('recovery code createdAt', r['createdAt']),
    usedAt: timeOrNull('recovery code usedAt', r['usedAt']),
  };
}

export function deviceRow(v: unknown): DeviceRow {
  const d = obj('device', v);
  return {
    hash: word('device hash', d['hash']),
    account: accountId('device account', d['account']),
    createdAt: time('device createdAt', d['createdAt']),
    lastUsedAt: time('device lastUsedAt', d['lastUsedAt']),
    failures: int('device failures', d['failures']),
  };
}

export function sessionRow(v: unknown): AccountSessionRow {
  const s = obj('session', v);
  const row: AccountSessionRow = {
    id: storeId('session id', s['id']),
    account: accountId('session account', s['account']),
    provider: oneOf('session provider', s['provider'], PROVIDERS),
    client: oneOf('session client', s['client'], CLIENTS),
    createdAt: time('session createdAt', s['createdAt']),
    lastUsedAt: time('session lastUsedAt', s['lastUsedAt']),
    authAt: time('session authAt', s['authAt']),
    rotatedAt: time('session rotatedAt', s['rotatedAt']),
    expiresAt: time('session expiresAt', s['expiresAt']),
    revokedAt: timeOrNull('session revokedAt', s['revokedAt']),
    revokeReason: s['revokeReason'] === null ? null : oneOf('session revokeReason', s['revokeReason'], REVOKE_REASONS),
    tokenHash: word('session tokenHash', s['tokenHash']),
    previousHash: s['previousHash'] === null ? null : word('session previousHash', s['previousHash']),
    rotation: int('session rotation', s['rotation']),
    device: s['device'] === null ? null : word('session device', s['device']),
    proofFailures: int('session proofFailures', s['proofFailures']),
  };
  if (row.previousHash === row.tokenHash) bad('session previousHash', 'is the current token hash');
  return row;
}

export function claimRow(v: unknown): ClaimRow {
  const c = obj('claim', v);
  return {
    session: storeId('claim session', c['session']),
    account: accountId('claim account', c['account']),
    claimedAt: time('claim claimedAt', c['claimedAt']),
  };
}

export function relationRow(v: unknown): RelationRow {
  const r = obj('relation', v);
  const row: RelationRow = {
    account: accountId('relation account', r['account']),
    other: accountId('relation other', r['other']),
    kind: oneOf('relation kind', r['kind'], RELATION_KINDS),
    createdAt: time('relation createdAt', r['createdAt']),
  };
  if (row.account === row.other) bad('relation other', 'is the account itself');
  return row;
}

export function emailCodeRow(v: unknown): EmailCodeRow {
  const c = obj('email code', v);
  return {
    id: storeId('email code id', c['id']),
    account: accountId('email code account', c['account']),
    purpose: oneOf('email code purpose', c['purpose'], EMAIL_PURPOSES),
    hash: word('email code hash', c['hash']),
    createdAt: time('email code createdAt', c['createdAt']),
    expiresAt: time('email code expiresAt', c['expiresAt']),
    usedAt: timeOrNull('email code usedAt', c['usedAt']),
  };
}

function reporterRef(v: unknown): ReporterRef | null {
  if (v === null) return null;
  const r = obj('report reporter', v);
  switch (r['kind']) {
    case 'account':
      return { kind: 'account', account: accountId('report reporter account', r['account']) };
    case 'guest':
      return { kind: 'guest', session: storeId('report reporter session', r['session']) };
    case 'system':
      return { kind: 'system', source: word('report reporter source', r['source']) };
    default:
      bad('report reporter kind', 'is not account, guest or system');
  }
}

function reportTarget(v: unknown): ReportTarget {
  const t = obj('report target', v);
  if ('account' in t && !('guestSession' in t)) return { account: accountId('report target account', t['account']) };
  if ('guestSession' in t && !('account' in t)) return { guestSession: storeId('report target guestSession', t['guestSession']) };
  bad('report target', 'is neither an account nor a guest session');
}

export function reportRow(v: unknown): ReportRow {
  const r = obj('report', v);
  let evidence: ReportRow['evidence'] = null;
  if (r['evidence'] !== null) {
    const e = obj('report evidence', r['evidence']);
    const stats = obj('report evidence stats', e['stats']);
    const outStats: Record<string, number> = {};
    for (const [k, x] of Object.entries(stats)) {
      text('report evidence stats key', k);
      if (typeof x !== 'number' || !Number.isFinite(x)) bad(`report evidence stats.${k}`, 'is not a finite number');
      outStats[k] = x;
    }
    evidence = { games: list('report evidence games', e['games']).map((g, i) => storeId(`report evidence games[${i}]`, g)), stats: outStats };
  }
  const reporter = reporterRef(r['reporter']);
  const related = list('report related', r['related']).map((x, i) => accountId(`report related[${i}]`, x));
  // `related` and `evidence` come only from a system reporter (9.2): an account or a guest names no other accounts and brings no evidence
  if ((related.length > 0 || evidence !== null) && reporter?.kind !== 'system') {
    bad('report related', 'and evidence come only from a system reporter');
  }
  return {
    id: storeId('report id', r['id']),
    reporter,
    target: reportTarget(r['target']),
    targetName: word('report targetName', r['targetName']),
    reason: oneOf('report reason', r['reason'], REPORT_REASONS),
    game: r['game'] === null ? null : storeId('report game', r['game']),
    text: textOrNull('report text', r['text']),
    related,
    evidence,
    status: oneOf('report status', r['status'], REPORT_STATUSES),
    createdAt: time('report createdAt', r['createdAt']),
    closedAt: timeOrNull('report closedAt', r['closedAt']),
    closedBy: textOrNull('report closedBy', r['closedBy']),
    note: textOrNull('report note', r['note']),
  };
}

export function sanctionRow(v: unknown): SanctionRow {
  const s = obj('sanction', v);
  return {
    id: storeId('sanction id', s['id']),
    account: accountId('sanction account', s['account']),
    kind: oneOf('sanction kind', s['kind'], SANCTION_KINDS),
    reason: oneOf('sanction reason', s['reason'], SANCTION_REASONS),
    message: text('sanction message', s['message']),
    note: textOrNull('sanction note', s['note']),
    createdAt: time('sanction createdAt', s['createdAt']),
    createdBy: word('sanction createdBy', s['createdBy']),
    reports: list('sanction reports', s['reports']).map((x, i) => storeId(`sanction reports[${i}]`, x)),
    since: time('sanction since', s['since']),
    until: timeOrNull('sanction until', s['until']),
    endedAt: timeOrNull('sanction endedAt', s['endedAt']),
    endReason: s['endReason'] === null ? null : oneOf('sanction endReason', s['endReason'], SANCTION_ENDS),
    endedBy: textOrNull('sanction endedBy', s['endedBy']),
    seenAt: timeOrNull('sanction seenAt', s['seenAt']),
  };
}

export function appealRow(v: unknown): AppealRow {
  const a = obj('appeal', v);
  return {
    sanction: storeId('appeal sanction', a['sanction']),
    account: accountId('appeal account', a['account']),
    text: text('appeal text', a['text']),
    createdAt: time('appeal createdAt', a['createdAt']),
    answer: a['answer'] === null ? null : oneOf('appeal answer', a['answer'], APPEAL_ANSWERS),
    answerMessage: textOrNull('appeal answerMessage', a['answerMessage']),
    answeredAt: timeOrNull('appeal answeredAt', a['answeredAt']),
    answeredBy: textOrNull('appeal answeredBy', a['answeredBy']),
  };
}

export function tombstoneRow(v: unknown): TombstoneRow {
  const t = obj('tombstone', v);
  return {
    account: accountId('tombstone account', t['account']),
    deletedAt: time('tombstone deletedAt', t['deletedAt']),
    sanctionUntil: timeOrNull('tombstone sanctionUntil', t['sanctionUntil']),
    holdersDone: textList('tombstone holdersDone', t['holdersDone']),
  };
}

export function auditRow(v: unknown): AuditEvent {
  const e = obj('audit event', v);
  const actor = word('audit actor', e['actor']);
  if (actor !== 'self' && actor !== 'system' && !(actor.startsWith('admin:') && actor.length > 'admin:'.length)) bad('audit actor', 'is not self, system or admin:<name>');
  return {
    id: storeId('audit id', e['id']),
    at: time('audit at', e['at']),
    kind: oneOf('audit kind', e['kind'], AUDIT_KINDS),
    account: e['account'] === null ? null : accountId('audit account', e['account']),
    actor: actor as AuditEvent['actor'],
    actorOs: textOrNull('audit actorOs', e['actorOs']),
    session: e['session'] === null ? null : storeId('audit session', e['session']),
    addressTag: textOrNull('audit addressTag', e['addressTag']),
    details: plainJson('audit details', obj('audit details', e['details'])) as AuditEvent['details'],
  };
}

/** A change as appended (no seq yet): `session` and `detail` only when present, `detail`'s keys likewise (what a jsonb column gives back). */
export function changeRow(v: unknown, seq: number): AccountChange {
  const c = obj('change', v);
  const out: AccountChange = {
    seq,
    at: time('change at', c['at']),
    account: accountId('change account', c['account']),
    kind: oneOf('change kind', c['kind'], CHANGE_KINDS),
  };
  if (c['session'] !== undefined) out.session = storeId('change session', c['session']);
  if (c['detail'] !== undefined) {
    const d = obj('change detail', c['detail']);
    const detail: NonNullable<AccountChange['detail']> = {};
    for (const k of Object.keys(d)) if (k !== 'except' && k !== 'now' && d[k] !== undefined) bad(`change detail.${k}`, 'is not a known key');
    if (d['except'] !== undefined) detail.except = storeId('change detail.except', d['except']);
    if (d['now'] !== undefined) detail.now = bool('change detail.now', d['now']);
    out.detail = detail;
  }
  return out;
}

// ---- keys and order --------------------------------------------------------------------------------------------------------------------------

/** NUL never occurs in a stored string (the text rule), so it separates the parts of a composite key. */
const SEP = '\u0000';
export const nameKeyOf = (key: string, keyVersion: number): string => `${keyVersion}${SEP}${key}`;
export const credentialKeyOf = (provider: string, subject: string): string => `${provider}${SEP}${subject}`;
export const relationKeyOf = (account: string, other: string, kind: string): string => `${account}${SEP}${other}${SEP}${kind}`;

/** Code-point order (UTF-8 byte order, what PostgreSQL's COLLATE "C" gives), not UTF-16 order: keys page alike in every store. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/** Ascending by each key in turn: times by their instant, text by code point, numbers by value. */
export function byKeys<T>(...keys: ((x: T) => string | number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const k of keys) {
      const x = k(a);
      const y = k(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : compareText(String(x), String(y));
      if (c !== 0) return c;
    }
    return 0;
  };
}
