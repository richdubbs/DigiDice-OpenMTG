/**
 * Configuration (design 11.7; M14-1): environment variables, validated at start by `loadAccountsConfig` (pure apart from joining paths: the
 * environment comes in as an argument). A value that does not parse is a problem, never silently replaced by a default; a problem names the variable,
 * never its value. Secrets (PASSWORD_PEPPERS, SHOPIFY_CLIENT_SECRET) come only from the environment or a secret store, are never echoed in a problem
 * or a warning, and are hidden by `describeAccountsConfig` (the line a server logs at start). There is no AUDIT_SECRET: the audit month key and the
 * work challenges' key are random and live only in memory (8.4, 8.5).
 */
import { join } from 'node:path';
import {
  ACCOUNT_LIMITS, ACCOUNT_RATE_LIMITS, ACCOUNT_TIMING, accountsEnvName, type AccountRateLimits, type AccountTiming,
} from './api';
import type { AccountRetention } from './store/api';

export interface AccountsConfig {
  enabled: boolean;                                      // ACCOUNTS: on / off (off until the client screens exist)
  // ACCOUNTS_STORE, ACCOUNTS_DATA_DIR. 'file': the development store, PostgreSQL on PGlite in the directory (src/store/pglite.ts)
  store: { kind: 'memory' } | { kind: 'file'; dir: string } | { kind: 'postgres' };
  dataDir: string | null;                                // ACCOUNTS_DATA_DIR: the file store (db/, lock), mail/ and exports/; default <DATA_DIR>/accounts
                                                         // when hosted's DATA_DIR is set (the ladder's file store is <DATA_DIR>/ladder, m15 13.3)
  minAge: number;                                        // MIN_AGE (13)
  passwordMin: number;                                   // PASSWORD_MIN (12), at least 8
  scrypt: { ln: number; r: number; p: number };          // SCRYPT_LN (17); r 8, p 1 (or 16, 8, 2 by M14-3's measurement)
  hashConcurrency: number;                               // HASH_CONCURRENCY (2)
  hashQueue: number;                                     // HASH_QUEUE (64)
  peppers: { id: string; secret: string }[];             // PASSWORD_PEPPERS (secret), newest last; [] in development
  reservedNamesFile: string | null;                      // RESERVED_NAMES_FILE
  moderationWordsFile: string | null;                    // MODERATION_WORDS_FILE (shared with m13)
  verifier: 'work' | 'none';                             // CAPTCHA (work); none for tests and development only
  mailer: 'none' | 'file';                               // MAILER (none)
  privacyUrl: string | null;                             // PRIVACY_URL
  termsUrl: string | null;                               // TERMS_URL
  shopify: { shopId: string; clientId: string; clientSecret: string } | null;   // SHOPIFY_SHOP_ID, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET (secret)
  /** Holders that must be registered and done before a tombstone, and present for a complete export (10.2): [] now; 'hosted' added by M14-10, 'ladder' by M15-8. */
  requiredHolders: string[];                             // ACCOUNTS_REQUIRED_HOLDERS (comma-separated)
  limits: AccountRateLimits;                             // ACCOUNT_RATE_LIMITS, each key overridden by its accountsEnvName variable
  timing: AccountTiming;                                 // ACCOUNT_TIMING, likewise
  retention: AccountRetention;                           // 10.3 (11.2); ACCOUNTS_RETENTION_<KEY> variables
}

const DAY = 86_400_000;
/** 10.3's retention, in milliseconds. securityAuditMs and operatorAuditMs are also floors: purge_audit never deletes younger events (11.5). */
export const DEFAULT_ACCOUNT_RETENTION: Readonly<AccountRetention> = Object.freeze({
  revokedSessionsMs: 7 * DAY,
  deviceIdleMs: 365 * DAY,
  closedReportsMs: 365 * DAY,
  securityAuditMs: 180 * DAY,
  operatorAuditMs: 730 * DAY,
  changesMs: 7 * DAY,
  adminExportMs: DAY,
  inactiveAccountMs: 1_095 * DAY,
});

/** 'revokedSessionsMs' -> 'ACCOUNTS_RETENTION_REVOKED_SESSIONS_MS'. */
export function retentionEnvName(key: keyof AccountRetention): string {
  return accountsEnvName(key).replace(/^ACCOUNTS_/, 'ACCOUNTS_RETENTION_');
}

/** The scrypt parameters SCRYPT_LN selects (4.1): N = 2^17, r = 8, p = 1 (OWASP's minimum, the default), or OWASP's equivalent N = 2^16, r = 8, p = 2. */
const SCRYPT_BY_LN: Readonly<Record<number, { ln: number; r: number; p: number }>> = { 17: { ln: 17, r: 8, p: 1 }, 16: { ln: 16, r: 8, p: 2 } };

/** Every variable loadAccountsConfig reads. */
export const ACCOUNTS_CONFIG_VARIABLES: readonly string[] = Object.freeze([
  'ACCOUNTS', 'ACCOUNTS_STORE', 'ACCOUNTS_DATA_DIR', 'DATA_DIR', 'MIN_AGE', 'PASSWORD_MIN', 'SCRYPT_LN', 'HASH_CONCURRENCY', 'HASH_QUEUE',
  'PASSWORD_PEPPERS', 'RESERVED_NAMES_FILE', 'MODERATION_WORDS_FILE', 'CAPTCHA', 'MAILER', 'PRIVACY_URL', 'TERMS_URL', 'SHOPIFY_SHOP_ID',
  'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET', 'ACCOUNTS_REQUIRED_HOLDERS',
  ...Object.keys(ACCOUNT_RATE_LIMITS).map(accountsEnvName),
  ...Object.keys(ACCOUNT_TIMING).map(accountsEnvName),
  ...(Object.keys(DEFAULT_ACCOUNT_RETENTION) as (keyof AccountRetention)[]).map(retentionEnvName),
]);

const PEPPER_ID = /^[A-Za-z0-9_-]{1,32}$/;
const PEPPER_MIN = 32;
const HOLDER_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const INTEGER = /^[0-9]{1,16}$/;

/** Parses PASSWORD_PEPPERS ("id:secret,id:secret", each secret at least 32 characters, ids unique). */
export function parsePeppers(value: string | undefined): { ok: true; peppers: { id: string; secret: string }[] } | { ok: false; problem: string } {
  if (value === undefined || value.trim() === '') return { ok: true, peppers: [] };
  const peppers: { id: string; secret: string }[] = [];
  const entries = value.split(',');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!.trim();
    const at = `PASSWORD_PEPPERS: entry ${i + 1}`;
    const colon = entry.indexOf(':');
    if (colon < 0) return { ok: false, problem: `${at} is not "id:secret"` };
    const id = entry.slice(0, colon);
    const secret = entry.slice(colon + 1);
    if (!PEPPER_ID.test(id)) return { ok: false, problem: `${at}: the id must be 1-32 characters of A-Z, a-z, 0-9, "_" and "-"` };
    if (peppers.some((p) => p.id === id)) return { ok: false, problem: `${at}: the id is used twice` };
    if (Array.from(secret).length < PEPPER_MIN) return { ok: false, problem: `${at}: the secret is shorter than ${PEPPER_MIN} characters` };
    if (/[\s\u0000-\u001f\u007f-\u009f]/u.test(secret)) return { ok: false, problem: `${at}: the secret holds white space or a control character` };
    peppers.push({ id, secret });
  }
  return { ok: true, peppers };
}

type Env = Readonly<Record<string, string | undefined>>;

/** The value of a variable, or undefined when it is unset or blank. */
function read(env: Env, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

function int(env: Env, name: string, fallback: number, min: number, max: number, problems: string[]): number {
  const v = read(env, name);
  if (v === undefined) return fallback;
  const n = INTEGER.test(v) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    problems.push(`${name}: must be a whole number from ${min} to ${max}`);
    return fallback;
  }
  return n;
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T, problems: string[]): T {
  const v = read(env, name);
  if (v === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(v)) {
    problems.push(`${name}: must be one of ${allowed.join(', ')}`);
    return fallback;
  }
  return v as T;
}

/** A file path: any non-empty text without NUL or a control character. */
function path(env: Env, name: string, problems: string[]): string | null {
  const v = read(env, name);
  if (v === undefined) return null;
  if (/[\u0000-\u001f\u007f]/u.test(v)) {
    problems.push(`${name}: must be a file path without control characters`);
    return null;
  }
  return v;
}

/** An https URL, or http on a loopback host (development); no user name or password in it. */
function url(env: Env, name: string, problems: string[]): string | null {
  const v = read(env, name);
  if (v === undefined) return null;
  let u: URL | null = null;
  try {
    u = v.length <= 2_048 ? new URL(v) : null;
  } catch {
    u = null;
  }
  const loopback = u !== null && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  if (!u || !(u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) || u.username !== '' || u.password !== '') {
    problems.push(`${name}: must be an https URL (http only on a loopback host), without a user name or password`);
    return null;
  }
  return u.href;
}

/** The limits of `defaults`, each overridden by its variable: whole numbers from 0 (`min` per key) up to the largest safe integer. */
function overridable<K extends string>(env: Env, defaults: Readonly<Record<K, number>>, nameOf: (k: K) => string, min: (k: K) => number, problems: string[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(defaults) as K[]) out[k] = int(env, nameOf(k), defaults[k], min(k), Number.MAX_SAFE_INTEGER, problems);
  return out;
}

/** Limits that must be at least 1 (a factor, a burst, a counter that must ever trigger, a map that holds something). */
const LIMITS_AT_LEAST_ONE: ReadonlySet<string> = new Set<keyof AccountRateLimits>([
  'prefix56Factor', 'prefix48Factor', 'signInBurst', 'backoffAfter', 'backoffAfter48', 'backoffBaseMs', 'proofFailures', 'deviceFailures',
  'workBaseBits', 'workMaxBits', 'pressureWorkBits', 'counterEntries', 'counterFullRetryMs',
]);

function checkLimits(l: AccountRateLimits, problems: string[]): void {
  const n = accountsEnvName;
  if (l.prefix48Factor < l.prefix56Factor) problems.push(`${n('prefix48Factor')}: must be at least ${n('prefix56Factor')}`);
  if (l.pressureQueuePercent > 100) problems.push(`${n('pressureQueuePercent')}: must be from 0 to 100`);
  if (l.backoffMaxMs < l.backoffBaseMs) problems.push(`${n('backoffMaxMs')}: must be at least ${n('backoffBaseMs')}`);
  if (l.backoffAfter48 < l.backoffAfter) problems.push(`${n('backoffAfter48')}: must be at least ${n('backoffAfter')}`);
  for (const k of ['workBaseBits', 'workMaxBits', 'pressureWorkBits'] as const) if (l[k] > 32) problems.push(`${n(k)}: must be from 1 to 32`);
  if (l.workMaxBits < l.workBaseBits) problems.push(`${n('workMaxBits')}: must be at least ${n('workBaseBits')}`);
}

function checkTiming(t: AccountTiming, problems: string[]): void {
  const n = accountsEnvName;
  if (t.sessionIdleMs > t.sessionMaxMs) problems.push(`${n('sessionIdleMs')}: must be at most ${n('sessionMaxMs')}`);
  if (t.rotateGraceMs >= t.rotateAfterMs) problems.push(`${n('rotateGraceMs')}: must be shorter than ${n('rotateAfterMs')}`);
  // 6.5: the old key is held longer than the cooldown, so the account can take it back with its next rename
  if (t.renameHoldMs <= t.renameCooldownMs) problems.push(`${n('renameHoldMs')}: must be longer than ${n('renameCooldownMs')}`);
}

/** Validated at start; a problem names the variable, never its value. */
export function loadAccountsConfig(env: Readonly<Record<string, string | undefined>>):
  { ok: true; config: AccountsConfig; warnings: string[] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];

  const enabledText = oneOf(env, 'ACCOUNTS', ['on', 'off', 'true', 'false', '1', '0'] as const, 'off', problems);
  const enabled = enabledText === 'on' || enabledText === 'true' || enabledText === '1';

  const accountsDir = path(env, 'ACCOUNTS_DATA_DIR', problems);
  const hostedDir = path(env, 'DATA_DIR', problems);
  const dataDir = accountsDir ?? (hostedDir !== null ? join(hostedDir, 'accounts') : null);

  const storeKind = oneOf(env, 'ACCOUNTS_STORE', ['memory', 'file', 'postgres'] as const, dataDir !== null ? 'file' : 'memory', problems);
  let store: AccountsConfig['store'] = { kind: 'memory' };
  if (storeKind === 'file') {
    if (dataDir === null) problems.push('ACCOUNTS_STORE: file needs ACCOUNTS_DATA_DIR (or DATA_DIR)');
    else store = { kind: 'file', dir: dataDir };
  } else if (storeKind === 'postgres') store = { kind: 'postgres' };
  else if (enabled) warnings.push('ACCOUNTS_STORE: memory: accounts are lost when the server stops (tests and development only)');

  const minAge = int(env, 'MIN_AGE', ACCOUNT_LIMITS.minAge, 13, 99, problems);
  const passwordMin = int(env, 'PASSWORD_MIN', ACCOUNT_LIMITS.passwordMin, 8, ACCOUNT_LIMITS.passwordMax, problems);
  const ln = int(env, 'SCRYPT_LN', 17, 16, 17, problems);
  const scrypt = { ...(SCRYPT_BY_LN[ln] ?? SCRYPT_BY_LN[17]!) };
  const hashConcurrency = int(env, 'HASH_CONCURRENCY', 2, 1, 16, problems);
  const hashQueue = int(env, 'HASH_QUEUE', 64, 1, 4_096, problems);

  const pp = parsePeppers(env['PASSWORD_PEPPERS']);
  const peppers = pp.ok ? pp.peppers : [];
  if (!pp.ok) problems.push(pp.problem);
  else if (enabled && peppers.length === 0 && store.kind !== 'memory') {
    warnings.push('PASSWORD_PEPPERS: not set: a copy of the account store alone is enough to start guessing passwords');
  }

  const reservedNamesFile = path(env, 'RESERVED_NAMES_FILE', problems);
  const moderationWordsFile = path(env, 'MODERATION_WORDS_FILE', problems);
  const verifier = oneOf(env, 'CAPTCHA', ['work', 'none'] as const, 'work', problems);
  if (verifier === 'none' && enabled) warnings.push('CAPTCHA: none: no proof of work is asked (tests and development only)');
  const mailer = oneOf(env, 'MAILER', ['none', 'file'] as const, 'none', problems);
  if (mailer === 'file' && dataDir === null) problems.push('MAILER: file needs ACCOUNTS_DATA_DIR (or DATA_DIR)');
  const privacyUrl = url(env, 'PRIVACY_URL', problems);
  const termsUrl = url(env, 'TERMS_URL', problems);

  const shopId = read(env, 'SHOPIFY_SHOP_ID');
  const clientId = read(env, 'SHOPIFY_CLIENT_ID');
  const clientSecret = read(env, 'SHOPIFY_CLIENT_SECRET');
  let shopify: AccountsConfig['shopify'] = null;
  const given = [shopId, clientId, clientSecret].filter((v) => v !== undefined).length;
  if (given === 3) {
    if (!/^[0-9]{1,20}$/.test(shopId!)) problems.push('SHOPIFY_SHOP_ID: must be the store\'s numeric id');
    else if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId!)) problems.push('SHOPIFY_CLIENT_ID: must be 1-128 characters of A-Z, a-z, 0-9, "_" and "-"');
    else if (/[\s\u0000-\u001f\u007f-\u009f]/u.test(clientSecret!) || clientSecret!.length > 512) {
      problems.push('SHOPIFY_CLIENT_SECRET: must be at most 512 characters without white space or control characters');
    } else shopify = { shopId: shopId!, clientId: clientId!, clientSecret: clientSecret! };
  } else if (given > 0) problems.push('SHOPIFY_SHOP_ID, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET: set all three or none');

  const requiredHolders: string[] = [];
  const holders = read(env, 'ACCOUNTS_REQUIRED_HOLDERS');
  if (holders !== undefined) {
    for (const h of holders.split(',').map((x) => x.trim())) {
      if (!HOLDER_NAME.test(h)) problems.push('ACCOUNTS_REQUIRED_HOLDERS: each name is 1-32 characters of a-z, 0-9 and "-", starting with a letter');
      else if (requiredHolders.includes(h)) problems.push('ACCOUNTS_REQUIRED_HOLDERS: a name is listed twice');
      else requiredHolders.push(h);
    }
  }

  const limits: AccountRateLimits = overridable<keyof AccountRateLimits>(env, ACCOUNT_RATE_LIMITS, accountsEnvName, (k) => (LIMITS_AT_LEAST_ONE.has(k) ? 1 : 0), problems);
  checkLimits(limits, problems);
  const timing: AccountTiming = overridable<keyof AccountTiming>(env, ACCOUNT_TIMING, accountsEnvName, () => 1, problems);
  checkTiming(timing, problems);
  const retention: AccountRetention = overridable<keyof AccountRetention>(env, DEFAULT_ACCOUNT_RETENTION, retentionEnvName, (k) => {
    // retention may be lengthened, never shortened below what purge_audit keeps anyway (11.5), so every store keeps the same
    if (k === 'securityAuditMs' || k === 'operatorAuditMs') return DEFAULT_ACCOUNT_RETENTION[k];
    return 1;
  }, problems);

  // A misspelt variable would silently keep its default: say so (by name only).
  const known = new Set(ACCOUNTS_CONFIG_VARIABLES);
  for (const k of Object.keys(env).sort()) if (k.startsWith('ACCOUNTS_') && !known.has(k)) warnings.push(`${k}: not a variable accounts reads`);

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    warnings,
    config: {
      enabled, store, dataDir, minAge, passwordMin, scrypt, hashConcurrency, hashQueue, peppers, reservedNamesFile, moderationWordsFile, verifier, mailer,
      privacyUrl, termsUrl, shopify, requiredHolders, limits, timing, retention,
    },
  };
}

/** The configuration as a server logs it at start: secrets as "(set)" or "(none)", never their values. */
export function describeAccountsConfig(c: AccountsConfig): Record<string, unknown> {
  return {
    ...c,
    peppers: c.peppers.map((p) => ({ id: p.id, secret: '(set)' })),
    shopify: c.shopify ? { shopId: c.shopify.shopId, clientId: c.shopify.clientId, clientSecret: '(set)' } : '(none)',
  };
}
