/**
 * `@openmtg/accounts/api`: the browser-safe contract of accounts (milestone 14). Types, constants and pure functions only; no `node:` imports
 * (tsconfig.api.json compiles it without Node's types; test/m14-1/browser-safe.test.ts checks the imports of this file and of ./api/*).
 * Three parts live in files of their own, which M14-1 creates as stubs (the signature and a body that throws "not built yet") and their owners fill:
 *   ./api/names      M14-2   checkAccountName
 *   ./api/passwords  M14-3   passwordShapeProblem, normalizeRecoveryCode, formatRecoveryCode
 *   ./api/email      M14-8   emailProblem
 * They are exposed ONLY through the named re-exports at the end of this file: never `export *`, and never declared here as well, so nothing shadows
 * them. A part takes values only from ./api/limits (ACCOUNT_LIMITS, M14-1's leaf, which imports nothing) or files of its own, and from this file
 * types only (`import type`): this file re-exports the parts, so a value a part read from it at load time would be undefined (test/m14-1/load.test.ts).
 * Everything else is M14-1's. Imported by @openmtg/client, by @openmtg/hosted at the sync, and for types only by @openmtg/ladder.
 *
 * Design: docs/design/m14-accounts.md (private archive), section 11.1. An additive change later is marked here as an INTERFACE CHANGE and reported.
 */

// ---- Ids (11.4) ---------------------------------------------------------------------------------------------------------------------------
/** 26 Crockford base32 characters, the first 0-7: the ULID shape, 128 bits. */
export const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/**
 * An account: "acc_" + 26 characters in the ULID shape, ALL 128 BITS RANDOM: no time part (D22), so nothing can be read from it, not even when it
 * was made (Standing.createdAt is the one source). The pattern is milestone 15's too.
 */
export type AccountId = `acc_${string}`;
export const ACCOUNT_ID = /^acc_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export function isAccountId(x: unknown): x is AccountId {
  return typeof x === 'string' && x.length === 30 && ACCOUNT_ID.test(x);
}
/** An anonymised placement's session (10.2): "del_" + 128 random bits in the same shape, a fresh one per placement; the ids of one erasure share nothing. */
export type DeletedPlayerId = `del_${string}`;
export const DELETED_PLAYER_ID = /^del_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export function isDeletedPlayerId(x: unknown): x is DeletedPlayerId {
  return typeof x === 'string' && x.length === 30 && DELETED_PLAYER_ID.test(x);
}
/** The name of a deleted player's placements (milestone 15 shows the same words). */
export const DELETED_PLAYER_NAME = 'Deleted player';

// ---- Tokens and codes ---------------------------------------------------------------------------------------------------------------------
/** Account session tokens and device proofs: 32 random bytes as 64 lowercase hex digits (m13's HOSTED_TOKEN shape). Only SHA-256 is stored. */
export const ACCOUNT_TOKEN = /^[0-9a-f]{64}$/;
export const ACCOUNT_TOKEN_BYTES = 32;
export function isAccountToken(x: unknown): x is string {
  return typeof x === 'string' && x.length === 2 * ACCOUNT_TOKEN_BYTES && ACCOUNT_TOKEN.test(x);
}
/** A provider confirmation code (3.5): 8 Crockford base32 characters; look-alikes and case are mapped as for recovery codes. */
export const CONFIRM_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** A solved work challenge as the client sends it in `captcha` (8.4). */
export const WORK_ANSWER = /^[A-Za-z0-9_-]{1,400}:[0-9]{1,16}$/;

// ---- Limits and times ---------------------------------------------------------------------------------------------------------------------
/**
 * The field limits (6.1, 4.2, 4.4, 3.4, 9, 5.5, 7.5). INTERFACE CHANGE (layout only; review of M14-1): declared in the leaf ./api/limits.ts, which
 * imports nothing, and re-exported here by name, so the parts in ./api/* can read them at load time without a cycle through this file. Importers
 * see no difference.
 */
export { ACCOUNT_LIMITS } from './api/limits';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
/** Every time of this design. Each key K is overridden by ACCOUNTS_<K in SCREAMING_SNAKE_CASE> (accountsEnvName), e.g. ACCOUNTS_SESSION_IDLE_MS. */
export const ACCOUNT_TIMING = {
  sessionIdleMs: 30 * DAY, sessionMaxMs: 180 * DAY,
  rotateAfterMs: 24 * HOUR, rotateGraceMs: 2 * MINUTE,
  renameCooldownMs: 30 * DAY, renameHoldMs: 60 * DAY, deletedNameHoldMs: 90 * DAY,
  deleteGraceMs: 7 * DAY,
  emailCodeMs: 15 * MINUTE, providerFlowMs: 10 * MINUTE, providerConfirmMs: 2 * MINUTE, reauthTicketMs: 2 * MINUTE, workChallengeMs: 2 * MINUTE,
  ageRetryMs: 24 * HOUR, exportEveryMs: 24 * HOUR,
  deviceIdleMs: 365 * DAY,
  jwksRefetchMs: 5 * MINUTE,
  noticeFileMs: DAY, adminExportFileMs: DAY,
} as const;

/**
 * Every number of 8.1 and 8.2. Each key K is overridden by ACCOUNTS_<K in SCREAMING_SNAKE_CASE> (accountsEnvName(K): registerPerHour ->
 * ACCOUNTS_REGISTER_PER_HOUR). Per-address numbers hold for a /32 (IPv4) or /64 (IPv6) key; IPv6 /56 and /48 keys get prefix56Factor and
 * prefix48Factor times as much. INTERFACE CHANGE (M14-8): emailCodeFailuresPerHour added (every try of an email code, per address key, like
 * recoveryFailuresPerHour), so that tries of codes from fresh address keys are bounded before any per-code counter is made.
 *
 * INTERFACE CHANGE (M14-13, review of M14-13): providerBeginsPerHour, providerCallbacksPerHour and providerFlowsPerAddress, the provider flows'
 * per-address limits (8.1 has no row for them): without them one address key could fill the flow table that every provider sign-in shares, and
 * send the token endpoint one request with the client secret per flow, without end.
 */
export const ACCOUNT_RATE_LIMITS = {
  prefix56Factor: 4, prefix48Factor: 16,
  // per address key (8.1)
  registerPerHour: 3, registerPerDay: 10,
  signInPerMinute: 10, signInBurst: 10,               // not for attempts with a valid device proof
  recoveryFailuresPerHour: 10,
  emailResetRequestsPerHour: 3,
  emailCodeTriesPerAddress: 5,                        // per (code, address key)
  emailCodeFailuresPerHour: 10,                       // every try of an email code, before the code is compared
  hashJobsPerAddress: 2, hashJobsPerNameAndAddress: 1,
  guestReportsPerDay: 3,                              // per guest session and per address key
  providerBeginsPerHour: 30,                          // beginProvider, per address key of the connection
  providerCallbacksPerHour: 30,                       // providerCallback, per address key of the browser that brings it back
  providerFlowsPerAddress: 10,                        // live provider flows at once; never more than a hundredth of the flow table
  // global
  registerGlobalPerMinute: 60,                        // above it, every registration pays pressureWorkBits of work
  registerShedAfter: 2,                               // CAPTCHA=none only: above it, keys (/48, /32) with this many registrations in the hour are shed
  pressureQueuePercent: 50,                           // rule 5 applies while the hashing queue is fuller than this
  // per account
  emailResetRequestsPerDay: 3, emailResetLiveCodes: 3,
  verifyMailsPerDay: 3,
  verifyMailsPerAddressPerDay: 3,                     // per target address, under a keyed hash in memory
  proofFailures: 5,                                   // wrong proofs in a row revoke the session (5.2)
  avatarPerHour: 10, privacyPerHour: 10,
  relationChangesPerHour: 30,
  reportsPerDay: 10, reportsPerTargetPerDay: 1,
  exportsPerDay: 1,
  // back-off and work (8.2)
  backoffAfter: 5, backoffAfter48: 20, backoffBaseMs: 1_000, backoffMaxMs: 900_000,
  deviceFailures: 10,
  workAfterFailures: 20,                              // per name key per hour, attempts without a valid device proof (rule 3)
  workBaseBits: 16, workMaxBits: 22,
  pressureWorkBits: 16,                               // rule 5, and registrations above registerGlobalPerMinute
  noVerifierAllowancePerHour: 3,                      // CAPTCHA=none only (rule 3)
  // memory (8.2 rule 6)
  counterEntries: 100_000, counterFullRetryMs: 60_000,
} as const;
export type AccountRateLimits = { -readonly [K in keyof typeof ACCOUNT_RATE_LIMITS]: number };
export type AccountTiming = { -readonly [K in keyof typeof ACCOUNT_TIMING]: number };
/** 'registerPerHour' -> 'ACCOUNTS_REGISTER_PER_HOUR'. */
export function accountsEnvName(key: string): string {
  return `ACCOUNTS_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
}
/** The overridable limits the server sends in welcome.server.accounts.limits (11.6); the browser checks against these, not the constants. */
export interface ClientLimits { passwordMin: number; minAge: number }

// ---- Small types --------------------------------------------------------------------------------------------------------------------------
export type ProviderId = 'local' | 'shopify' | 'passkey';
export type ProviderIntent = 'signIn' | 'register' | 'link' | 'reauth';
export type ClientKind = 'desktop' | 'web';
/** Worked out by accountStatus, never stored (D23). */
export type AccountStatus = 'active' | 'suspended' | 'banned' | 'deleting';
export type RelationKind = 'block' | 'mute';
export type SanctionKind = 'warn' | 'mute' | 'rename' | 'unlist' | 'suspend' | 'ban';
export const REPORT_REASONS = ['name', 'chat', 'title', 'cheating', 'collusion', 'stalling', 'smurf', 'harassment', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type SanctionReason = ReportReason | 'evasion';
export type ReportStatus = 'new' | 'actioned' | 'dismissed';
export type SanctionEnd = 'lifted' | 'expired' | 'appeal';
/**
 * The changes that need a proof in the same request (5.2). INTERFACE CHANGE (review of M14-1): 'rename' added. Sign-in, recovery and the email reset
 * find an account by its current name only, so a rename by a stolen token alone would keep the owner out (and free the old name after its hold).
 * INTERFACE CHANGE (M14-15, review A3): 'appeal' and 'claim' added. A sanction has one appeal and an account at most 20 guest claims, neither of which
 * can be undone, so a stolen token alone would use up the owner's appeal or fill the history with guest games it controls.
 */
export type SensitiveAction = 'password' | 'recoveryCodes' | 'email' | 'link' | 'unlink' | 'rename' | 'export' | 'delete' | 'appeal' | 'claim';
export type RevokeReason =
  | 'signOut' | 'signOutEverywhere' | 'revoked' | 'passwordChanged' | 'recovery' | 'emailReset' | 'reuse' | 'proofFailed' | 'expired' | 'tooMany'
  | 'sanction' | 'deletion' | 'admin';

// ---- Avatars (7.1) ------------------------------------------------------------------------------------------------------------------------
export const AVATAR_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'chip', 'comet'] as const;
export const AVATAR_TONES = ['blue', 'magenta', 'violet', 'cyan', 'amber', 'white'] as const;
export type AvatarId = `${(typeof AVATAR_SHAPES)[number]}-${(typeof AVATAR_TONES)[number]}`;
/** The 48 ids, shape by shape. */
export const AVATAR_IDS: readonly AvatarId[] = Object.freeze(AVATAR_SHAPES.flatMap((s) => AVATAR_TONES.map((t): AvatarId => `${s}-${t}`)));
const AVATAR_SET: ReadonlySet<string> = new Set(AVATAR_IDS);
export function isAvatarId(x: unknown): x is AvatarId {
  return typeof x === 'string' && AVATAR_SET.has(x);
}
/**
 * A new account's avatar: a fixed function of its id. FNV-1a (32 bits) over the id's UTF-16 code units, modulo the 48 ids: the same id gives the
 * same avatar on every machine and in every release (test/m14-1 pins examples), so it must never change.
 */
export function defaultAvatar(id: AccountId): AvatarId {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AVATAR_IDS[h % AVATAR_IDS.length]!;
}

// ---- Records -------------------------------------------------------------------------------------------------------------------------------
export interface PrivacySettings {
  /** Who may read the account's match history: everyone ('public') or the account alone ('private'). */
  history: 'public' | 'private';
  /** Listed on public leaderboards (milestone 15 reads it). Ranked play and rating work the same either way. Never opens the history. */
  leaderboards: boolean;
  /** Whether guests may sit at tables this account creates (9.1). Not about what others read; kept here so one message sets it. */
  guestsAtMyTables: boolean;
}   // 7.2
/** { history: 'private', leaderboards: true, guestsAtMyTables: true } (frozen: copy it, never change it). */
export const DEFAULT_PRIVACY: PrivacySettings = Object.freeze<PrivacySettings>({ history: 'private', leaderboards: true, guestsAtMyTables: true });

/** The account as the store keeps it (server side). No secret is in it, and no status (D23): credentials, codes, sessions and sanctions are rows of their own. */
export interface Account {
  id: AccountId;
  /** The display form (6.1). */
  name: string;
  /** The canonical key (6.3) under name data `keyVersion`; unique among current, held, reserved and banned keys. */
  nameKey: string;
  keyVersion: number;
  avatar: AvatarId;
  privacy: PrivacySettings;
  /**
   * INTERFACE CHANGE (M14-15, review A5): `setAt`, when this address was set (setEmail; verifying it keeps the time), so a recovery-code sign-in
   * can remove an address set in the 30 days before it (an attacker's, set with a stolen password). Absent on rows written before it; never in a
   * view (SelfView shows the address and whether it is verified).
   */
  email: { address: string; verifiedAt: string | null; setAt?: string } | null;
  /** The outcome of the age gate only (7.5). */
  ageGate: { minAge: number; passedAt: string };
  createdAt: string;
  lastSignInAt: string | null;
  renamedAt: string | null;
  /** One rename without the cooldown (after a forced rename). */
  freeRename: boolean;
  /** A pending deletion (10.2). erasingAt: tick has claimed it, and a cancel is refused from then on. done: the holders whose erase succeeded. */
  deletion: { requestedAt: string; purgeAt: string; erasingAt: string | null; done: string[] } | null;
  /** When the 3-year inactivity notice was sent (10.3), so it is sent once; a sign-in clears it. */
  inactiveNoticeAt: string | null;
  /** Optimistic concurrency: an update names the version it read. */
  version: number;
}

/** What accountStatus and standingOf need of a sanction (the store's SanctionRow has more). */
export interface SanctionSpan { kind: SanctionKind; since: string; until: string | null; endedAt: string | null }

/** Milliseconds of `now`, which is always the server's own time: a value that does not parse is a programming error, never a client's. */
function nowMs(now: string, fn: string): number {
  const t = Date.parse(now);
  if (!Number.isFinite(t)) throw new RangeError(`${fn}: now is not an ISO 8601 time`);
  return t;
}

function runsAt(s: SanctionSpan, t: number): boolean {
  // Stored times always parse (the stores check them). If one ever does not, the sanction keeps running: a damaged row never lifts a ban by itself.
  // So a time that does not parse never ends it: a damaged `since` counts as started, a damaged `endedAt` as not ended, a damaged `until` as no end.
  const since = Date.parse(s.since);
  if (Number.isFinite(since) && since > t) return false;
  if (s.endedAt !== null) {
    const ended = Date.parse(s.endedAt);
    if (Number.isFinite(ended) && ended <= t) return false;
  }
  if (s.until !== null) {
    const until = Date.parse(s.until);
    if (Number.isFinite(until) && until <= t) return false;
  }
  return true;
}

/** Whether it runs at `now`: started, not ended (lifted, expired or lifted on appeal), and `until` not passed. */
export function sanctionRuns(s: SanctionSpan, now: string): boolean {
  return runsAt(s, nowMs(now, 'sanctionRuns'));
}

/** 3.8: 'deleting' while a deletion is pending, else 'banned' while a ban runs, else 'suspended' while a suspension runs, else 'active'. */
export function accountStatus(sanctions: readonly SanctionSpan[], deletion: Account['deletion'], now: string): AccountStatus {
  const t = nowMs(now, 'accountStatus');
  if (deletion !== null) return 'deleting';
  if (sanctions.some((s) => s.kind === 'ban' && runsAt(s, t))) return 'banned';
  if (sanctions.some((s) => s.kind === 'suspend' && runsAt(s, t))) return 'suspended';
  return 'active';
}

/** The latest end among `spans`; null when there is none or one of them is permanent (an `until` that does not parse counts as permanent, as in runsAt). */
function latestEnd(spans: readonly SanctionSpan[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const s of spans) {
    if (s.until === null) return null;
    const u = Date.parse(s.until);
    if (!Number.isFinite(u)) return null;
    if (u > bestMs) {
      bestMs = u;
      best = s.until;
    }
  }
  return best;
}

/**
 * 9.3: the Standing from the same inputs (ranked, listed, chat, until), so every package reads one answer.
 *
 * `until` is when the current limits end: for 'banned' and 'suspended', when the account is active again, the latest end of ALL its running bans
 * and suspensions (a ban that ends before an overlapping suspension leaves the account suspended, so the ban's end alone would be too early); for an
 * active account, the latest end of its running mutes and unlists. Null when one of those is permanent, when nothing limits it, and while a deletion
 * is pending (a deletion is not a sanction). A mute or unlist that outlasts a ban or suspension shows in the Standing of that later time.
 */
export function standingOf(a: Pick<Account, 'id' | 'createdAt' | 'deletion'>, sanctions: readonly SanctionSpan[], now: string): Standing {
  const t = nowMs(now, 'standingOf');
  const running = sanctions.filter((s) => runsAt(s, t));
  const status = accountStatus(running, a.deletion, now);
  const active = status === 'active';
  const unlisted = running.some((s) => s.kind === 'unlist');
  const muted = running.some((s) => s.kind === 'mute');
  let until: string | null = null;
  if (status === 'banned' || status === 'suspended') until = latestEnd(running.filter((s) => s.kind === 'ban' || s.kind === 'suspend'));
  else if (active) until = latestEnd(running.filter((s) => s.kind === 'mute' || s.kind === 'unlist'));
  return { account: a.id, status, ranked: active, listed: active && !unlisted, chat: active && !muted, until, createdAt: a.createdAt };
}

/** What other packages read about an account (AccountDirectory.standing). */
export interface Standing {
  account: AccountId;
  status: AccountStatus;
  /** May queue for ranked play (milestone 15): status 'active'. Never needs an email. */
  ranked: boolean;
  /** May appear on leaderboards at all: status 'active' and no running 'unlist' (9.3). */
  listed: boolean;
  /** May chat and title tables: status 'active' and no running 'mute'. */
  chat: boolean;
  /**
   * When the current limits end (standingOf): banned or suspended, when it is active again (the latest end of its running bans and suspensions);
   * active, when its running mutes and unlists end. Null: none, or permanent.
   */
  until: string | null;
  createdAt: string;
}

// ---- Views (D13): each built by one function in src/views.ts that copies exactly its key list into a new object ----------------------------
/** The public profile (7.3). */
export interface PublicProfile {
  id: AccountId;
  name: string;
  avatar: AvatarId;
  /** The month the account was made, 'YYYY-MM' (not the day). The id carries no time (D22). */
  memberSince: string;
  /** Whether others may read its match history (PrivacySettings.history === 'public'). */
  historyPublic: boolean;
}
export const PUBLIC_PROFILE_KEYS = ['id', 'name', 'avatar', 'memberSince', 'historyPublic'] as const satisfies readonly (keyof PublicProfile)[];

/** A sanction as the account sees it: never the internal note, the operator or the reports it settles. */
export interface SanctionView {
  id: string;
  kind: SanctionKind;
  reason: SanctionReason;
  /** The operator's message to the account. */
  message: string;
  since: string;
  until: string | null;
  ended: { at: string; reason: SanctionEnd } | null;
  appeal: { at: string; answer: 'upheld' | 'lifted' | null; message: string | null } | null;
}
export const SANCTION_VIEW_KEYS = ['id', 'kind', 'reason', 'message', 'since', 'until', 'ended', 'appeal'] as const satisfies readonly (keyof SanctionView)[];

/** What the account itself sees (`me`, `welcome.account`, the export): never nameKey, keyVersion, ageGate or version. */
export interface SelfView {
  id: AccountId;
  name: string;
  avatar: AvatarId;
  status: AccountStatus;
  /** This session is restricted (3.8): only RESTRICTED_CALLS work. */
  restricted: boolean;
  privacy: PrivacySettings;
  email: { address: string; verified: boolean } | null;
  providers: ProviderId[];
  hasPassword: boolean;
  recoveryCodesLeft: number;
  createdAt: string;
  /** When the next rename is possible; null: now. */
  renameAt: string | null;
  /** Running sanctions, and warnings not yet marked seen. */
  sanctions: SanctionView[];
  deletion: { purgeAt: string; cancellable: boolean } | null;
}
export const SELF_VIEW_KEYS = [
  'id', 'name', 'avatar', 'status', 'restricted', 'privacy', 'email', 'providers', 'hasPassword', 'recoveryCodesLeft', 'createdAt', 'renameAt',
  'sanctions', 'deletion',
] as const satisfies readonly (keyof SelfView)[];

/** An account session as the store's row exposes it to the service (5.2); the token hashes are the store's (AccountSessionRow), never part of this. */
export interface AccountSession {
  /** "as_" + a ULID. */
  id: string;
  account: AccountId;
  provider: ProviderId;
  client: ClientKind;
  createdAt: string;
  lastUsedAt: string;
  /** When a password, provider or recovery code was last checked on it. */
  authAt: string;
  rotatedAt: string;
  /** createdAt + 180 days. */
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: RevokeReason | null;
}
/** A session in the sessions list: never a token hash, a device hash or a counter. */
export interface SessionView { id: string; provider: ProviderId; client: ClientKind; createdAt: string; lastUsedAt: string; current: boolean }
export const SESSION_VIEW_KEYS = ['id', 'provider', 'client', 'createdAt', 'lastUsedAt', 'current'] as const satisfies readonly (keyof SessionView)[];
/** A block or mute the account set. */
export interface RelationView { account: AccountId; name: string; kind: RelationKind; since: string }
export const RELATION_VIEW_KEYS = ['account', 'name', 'kind', 'since'] as const satisfies readonly (keyof RelationView)[];
/**
 * A block or mute in the account's export (10.1): the other account by its name, never its id (an export holds no other player's account id; M14-7
 * searches the JSON for one). Built by exportRelation (src/views.ts). INTERFACE CHANGE (review of M14-1): the export carried RelationView, id and all.
 */
export interface ExportRelation { name: string; kind: RelationKind; since: string }
export const EXPORT_RELATION_KEYS = ['name', 'kind', 'since'] as const satisfies readonly (keyof ExportRelation)[];

// ---- Errors -------------------------------------------------------------------------------------------------------------------------------
/** Which method may answer which code: ACCOUNT_METHOD_ERRORS (11.3). */
export const ACCOUNT_ERROR_CODES = [
  'badMessage', 'rateLimited', 'busy', 'notYet', 'notAllowed', 'notFound', 'conflict', 'unavailable',
  'badCredentials', 'reauthRequired', 'sessionExpired', 'sessionRevoked',
  'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'renameCooldown',
  'passwordWeak', 'ageGate',
  'captchaRequired', 'captchaFailed',
  'suspended', 'banned', 'deletionPending',
  'alreadyClaimed', 'limitReached',
  'emailUnavailable', 'emailInvalid', 'emailCodeInvalid',
  'providerUnavailable', 'providerFailed', 'providerLinked',
] as const;
export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];
/** A proof-of-work challenge (8.4), sent with captchaRequired when the verifier's kind is 'work'. */
export interface WorkChallenge { kind: 'work'; challenge: string; bits: number; expiresAt: string }
export interface AccountError {
  code: AccountErrorCode;
  message: string;
  /** rateLimited, busy, unavailable. */
  retryAfterMs?: number;
  /** nameInvalid, passwordWeak, emailInvalid: the problems to show. */
  details?: string[];
  /** suspended, banned: the sanction. */
  sanction?: SanctionView;
  /** captchaRequired with the 'work' verifier. */
  challenge?: WorkChallenge;
}
/**
 * Every service call answers this; nothing a client sends can make it throw (m13's C4 rule). A store or internal failure answers 'unavailable'
 * (with retryAfterMs); a version conflict that survived the service's 3 retries answers 'conflict' (every method that writes the account row has it
 * in its row of ACCOUNT_METHOD_ERRORS).
 */
export type AccountResult<T> = { ok: true; value: T } | { ok: false; error: AccountError };

// ---- Audit (8.5) --------------------------------------------------------------------------------------------------------------------------
export const AUDIT_KINDS = [
  'registered', 'signedIn', 'signInFailed', 'signInThrottled', 'signedOut', 'sessionRevoked', 'sessionsRevoked', 'sessionReuse', 'reauthed',
  'reauthFailed', 'passwordChanged', 'recoveryUsed', 'recoveryFailed', 'recoveryCodesRenewed', 'emailSet', 'emailVerified', 'emailRemoved',
  'emailResetRequested', 'emailResetUsed', 'providerLinked', 'providerUnlinked', 'renamed', 'guestClaimed', 'exported', 'deletionRequested',
  'deletionCancelled', 'deleted', 'captchaRequired',
  'reported', 'appealed', 'sanctioned', 'sanctionLifted', 'sanctionExpired', 'forcedRename', 'reportClosed', 'appealAnswered',
  'adminViewed', 'adminExported', 'nameReserved', 'nameReleased', 'nameRekeyed',
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
export type AuditCategory = 'security' | 'moderation' | 'operator';
/**
 * Each kind's category: its retention (10.3), whether the export carries it (security only, actor self or system), and what purge_audit may remove
 * (11.5, which keeps a copy of this table in the migration). security: 'registered' through 'captchaRequired' in AUDIT_KINDS' order; moderation:
 * 'reported' through 'appealAnswered'; operator: 'adminViewed' through 'nameRekeyed'.
 */
export const AUDIT_CATEGORY: { readonly [K in AuditKind]: AuditCategory } = Object.freeze({
  registered: 'security', signedIn: 'security', signInFailed: 'security', signInThrottled: 'security', signedOut: 'security',
  sessionRevoked: 'security', sessionsRevoked: 'security', sessionReuse: 'security', reauthed: 'security', reauthFailed: 'security',
  passwordChanged: 'security', recoveryUsed: 'security', recoveryFailed: 'security', recoveryCodesRenewed: 'security', emailSet: 'security',
  emailVerified: 'security', emailRemoved: 'security', emailResetRequested: 'security', emailResetUsed: 'security', providerLinked: 'security',
  providerUnlinked: 'security', renamed: 'security', guestClaimed: 'security', exported: 'security', deletionRequested: 'security',
  deletionCancelled: 'security', deleted: 'security', captchaRequired: 'security',
  reported: 'moderation', appealed: 'moderation', sanctioned: 'moderation', sanctionLifted: 'moderation', sanctionExpired: 'moderation',
  forcedRename: 'moderation', reportClosed: 'moderation', appealAnswered: 'moderation',
  adminViewed: 'operator', adminExported: 'operator', nameReserved: 'operator', nameReleased: 'operator', nameRekeyed: 'operator',
});
/** Derived from AUDIT_CATEGORY; a test checks that the three split AUDIT_KINDS exactly (every kind in one, none twice). */
export const SECURITY_AUDIT_KINDS: readonly AuditKind[] = Object.freeze(AUDIT_KINDS.filter((k) => AUDIT_CATEGORY[k] === 'security'));
export const MODERATION_AUDIT_KINDS: readonly AuditKind[] = Object.freeze(AUDIT_KINDS.filter((k) => AUDIT_CATEGORY[k] === 'moderation'));
export const OPERATOR_AUDIT_KINDS: readonly AuditKind[] = Object.freeze(AUDIT_KINDS.filter((k) => AUDIT_CATEGORY[k] === 'operator'));
/**
 * The details each kind carries, and nothing else: never a password, code, token, email address, birth date, internal note, reporter, typed name or
 * another account's id. At most AUDIT_DETAILS_MAX bytes of JSON. nameTag: a keyed tag of a name key under the month key (8.5), only when `account`
 * is null.
 */
export interface AuditDetails {
  registered: { provider: ProviderId; claimed: boolean };
  signedIn: { provider: ProviderId; device: boolean; restricted: boolean };
  signInFailed: { count: number; nameTag: string | null };
  signInThrottled: { rule: 1 | 2 | 3 | 5; nameTag: string | null };
  signedOut: { everywhere: boolean };
  sessionRevoked: { reason: RevokeReason };
  sessionsRevoked: { reason: RevokeReason; count: number };
  sessionReuse: Record<string, never>;
  reauthed: { action: SensitiveAction; via: 'password' | 'ticket' };
  reauthFailed: { action: SensitiveAction; count: number };
  passwordChanged: { via: 'password' | 'recovery' | 'emailReset' };
  recoveryUsed: { left: number };
  recoveryFailed: { count: number };
  recoveryCodesRenewed: Record<string, never>;
  emailSet: Record<string, never>;
  emailVerified: Record<string, never>;
  emailRemoved: Record<string, never>;
  emailResetRequested: { sent: boolean };
  emailResetUsed: Record<string, never>;
  providerLinked: { provider: ProviderId };
  providerUnlinked: { provider: ProviderId };
  renamed: { free: boolean };
  guestClaimed: { guestSession: string; games: number };
  exported: Record<string, never>;
  deletionRequested: { purgeAt: string };
  deletionCancelled: Record<string, never>;
  deleted: { holders: string[] };
  captchaRequired: { rule: 3 | 5 | 'register'; bits: number };
  reported: { report: string; reason: ReportReason };
  appealed: { sanction: string };
  sanctioned: { sanction: string; kind: SanctionKind; reason: SanctionReason; now: boolean };
  sanctionLifted: { sanction: string };
  sanctionExpired: { sanction: string };
  forcedRename: { sanction: string | null };
  reportClosed: { report: string; outcome: 'actioned' | 'dismissed' };
  appealAnswered: { sanction: string; answer: 'upheld' | 'lifted' };
  adminViewed: { what: 'find' | 'show' | 'reports' | 'report' | 'appeals' | 'audit' };
  adminExported: { partial: boolean };
  nameReserved: Record<string, never>;
  nameReleased: Record<string, never>;
  nameRekeyed: { from: number; to: number; changed: number };
}
export const AUDIT_DETAILS_MAX = 1_024;
export interface AuditEvent<K extends AuditKind = AuditKind> {
  id: string;
  at: string;
  kind: K;
  /** The account the event is about; `reported` is filed under the reporter (8.5). */
  account: AccountId | null;
  actor: 'self' | 'system' | `admin:${string}`;
  /** The OS user who ran the admin command (9.6); null for self and system. */
  actorOs: string | null;
  session: string | null;
  /** A tag of the address key under this month's key (8.5); never the address. */
  addressTag: string | null;
  details: AuditDetails[K];
}

// ---- The change feed (9.7) ----------------------------------------------------------------------------------------------------------------
export type ChangeKind = 'sessionRevoked' | 'sessionsRevoked' | 'standing' | 'renamed' | 'avatar' | 'deleting' | 'deleted';
export interface AccountChange {
  seq: number;
  at: string;
  account: AccountId;
  kind: ChangeKind;
  /** sessionRevoked: the revoked session. */
  session?: string;
  /** sessionsRevoked: except = the session that stays (a password change keeps its own). standing: now = concede a running game at once (9.3). */
  detail?: { except?: string; now?: boolean };
}

// ---- Export (10.1) ------------------------------------------------------------------------------------------------------------------------
export interface AccountExport {
  format: 'openmtg-account-export';
  version: 1;
  exportedAt: string;
  /** Required holders that were not present (only from the command line, 9.6); [] for a complete export. */
  missing: string[];
  account: {
    self: SelfView;
    nameHistory: { name: string; from: string; to: string | null; cause: 'register' | 'rename' | 'forced' }[];
    ageGate: { minAge: number; passedAt: string };
    lastSignInAt: string | null;
    sessions: SessionView[];
    devices: { createdAt: string; lastUsedAt: string }[];
    claims: { session: string; claimedAt: string }[];
    /** Its blocks and mutes by the other account's name, never its id (ExportRelation). */
    relations: ExportRelation[];
    /** The target as the display name at the time, never a session or an account id; open or closed, never the outcome (9.2). */
    reportsFiled: { id: string; target: { kind: 'account' | 'guest'; name: string }; reason: ReportReason; text: string | null; createdAt: string; status: 'open' | 'closed' }[];
    /** Closed reports about the account, by reason and month ('YYYY-MM') only. */
    reportsAbout: { reason: ReportReason; month: string }[];
    sanctions: SanctionView[];
    /** SECURITY_AUDIT_KINDS events whose actor is self or system; no address tag, no actor. */
    security: { at: string; kind: AuditKind; session: string | null; details: Record<string, unknown> }[];
  };
  /** One section per AccountDataHolder, by its name ('hosted', 'ladder'). */
  holders: Record<string, unknown>;
}

// ---- What other packages implement or use (types only) ------------------------------------------------------------------------------------
/** Everything a data holder needs to find a player's rows. */
export interface PlayerRef {
  account: AccountId;
  /** The guest sessions the account claimed: their games that ended before `claimedAt` are the account's (5.5). */
  claims: { session: string; claimedAt: string }[];
  /** Every display name the account has had (its name history), for holders that must find names in free JSON (10.2). */
  names: string[];
}

/** A package that holds data about accounts (hosted, ladder) and must export and erase it (10.1, 10.2). */
export interface AccountDataHolder {
  /** Its key in AccountExport.holders, and in AccountsConfig.requiredHolders. */
  readonly name: string;
  /** JSON-safe; only this player's own data (other seats as PUBLIC_PLACEMENT_KEYS). */
  exportFor(ref: PlayerRef): Promise<unknown>;
  /**
   * Erase or anonymise everything of the player, leaving nothing that links to it; running it again finds nothing more. pending: some data is still
   * in use (a running game); the service calls it again at the next tick.
   */
  erase(ref: PlayerRef): Promise<{ removed: number; anonymised: number; pending?: boolean }>;
}

/** Read-only lookups for hosted's tables and matchmaking and for ladder (2.3, 2.4). */
export interface AccountDirectory {
  standing(id: AccountId): Promise<Standing | null>;
  standings(ids: readonly AccountId[]): Promise<Map<AccountId, Standing>>;
  /** Current display names; accounts that are not active, and erased ones, are absent. */
  names(ids: readonly AccountId[]): Promise<Map<AccountId, string>>;
  /** Every pair among `ids` with a block in either direction. */
  blockedAmong(ids: readonly AccountId[]): Promise<[AccountId, AccountId][]>;
  /** Whether `muter` muted or blocked `speaker` (chat delivery). */
  silenced(muter: AccountId, speaker: AccountId): Promise<boolean>;
  privacy(ids: readonly AccountId[]): Promise<Map<AccountId, PrivacySettings>>;
  /**
   * The name a history row shows (6.7). To the account itself (viewer === id): the name at the time, or the current name when that one was redacted.
   * To anyone else, and with no viewer: the account's current name, so old names are never linked to new ones. Erased: DELETED_PLAYER_NAME.
   */
  displayNameAt(id: AccountId, nameAtTheTime: string, viewer?: AccountId | null): Promise<string>;
  /**
   * Whether `viewer` may read `id`'s match history (its own, or public). PrivacySettings.leaderboards never opens it. False to everyone but the
   * account itself while it is not active, and for an erased or unknown id (7.3).
   */
  historyVisible(id: AccountId, viewer: AccountId | null): Promise<boolean>;
}

// ---- Pure checks for the browser and the server -------------------------------------------------------------------------------------------
export type NameProblem = 'type' | 'short' | 'long' | 'character' | 'separator' | 'noLetter' | 'marks' | 'scripts';
export type PasswordProblem =
  | 'type' | 'short' | 'long' | 'character' | 'repeated' | 'sequence' | 'keyboard' | 'containsName' | 'containsEmail' | 'context' | 'common';
export type EmailProblem = 'type' | 'long' | 'syntax' | 'local' | 'domain' | 'nonAscii';

/**
 * 7.5: at least `minAge` full years on `today` (an ISO date), the birthday counted at the end of the birth month. So a player turns `minAge` when the
 * birth month of that year ends: refused for the whole of that month, accepted from the first day of the next. Only the date part of `today`
 * ('YYYY-MM-DD', as written: UTC for a toISOString value) is read. Never throws: a malformed birth, age or date answers false.
 */
export function oldEnough(birth: { year: number; month: number }, minAge: number, today: string): boolean {
  if (typeof birth !== 'object' || birth === null) return false;
  const { year, month } = birth;
  if (!Number.isSafeInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isSafeInteger(minAge) || minAge < 0) return false;
  const m = typeof today === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(today) : null;
  if (!m) return false;
  const ty = Number(m[1]), tm = Number(m[2]), td = Number(m[3]);
  if (tm < 1 || tm > 12 || td < 1 || td > 31) return false;
  return ty * 12 + (tm - 1) > (year + minAge) * 12 + (month - 1);
}

// The parts in files of their own (see the header). Their signatures:
//   checkAccountName(raw: unknown): { ok: true; display: string } | { ok: false; problem: NameProblem; message: string }        6.1, without the key,
//                                                                                                     reserved names or the word filter (server only)
//   passwordShapeProblem(password: unknown, ctx: { name: string | null; emailLocal: string | null }, limits?: Pick<ClientLimits, 'passwordMin'>):
//     PasswordProblem | null                                                                 4.2 without the blocklist; limits from server.accounts
//   normalizeRecoveryCode(input: string): string | null           4.4: 16 characters with look-alikes mapped (also used for CONFIRM_CODE's 8), or null
//   formatRecoveryCode(code: string): string
//   emailProblem(raw: unknown): { ok: true; address: string } | { ok: false; problem: EmailProblem }                 3.4's grammar; the stored form
export { checkAccountName } from './api/names';
export { passwordShapeProblem, normalizeRecoveryCode, formatRecoveryCode } from './api/passwords';
export { emailProblem } from './api/email';
