/**
 * M14-1: configuration (design 11.7): the defaults; every ACCOUNT_RATE_LIMITS and ACCOUNT_TIMING key (and every retention key) overridable by its
 * variable; refusals of bad values on a fixed list, each naming its variable; secrets never echoed in a problem, a warning or the described config;
 * parsePeppers.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  ACCOUNTS_CONFIG_VARIABLES, ACCOUNT_RATE_LIMITS, ACCOUNT_TIMING, DEFAULT_ACCOUNT_RETENTION, accountsEnvName, describeAccountsConfig, loadAccountsConfig,
  parsePeppers, retentionEnvName, type AccountRetention, type AccountsConfig,
} from '@openmtg/accounts';

/** Two fixed test peppers of 40 characters (never real secrets). */
const PEPPER_A = 'pepper-secret-AAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const PEPPER_B = 'pepper-secret-BBBBBBBBBBBBBBBBBBBBBBBBBBB2';
const SHOPIFY_SECRET = 'shpss_TESTSECRET0123456789abcdef';

const ok = (env: Record<string, string>): { config: AccountsConfig; warnings: string[] } => {
  const r = loadAccountsConfig(env);
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r;
};
const problems = (env: Record<string, string>): string[] => {
  const r = loadAccountsConfig(env);
  return r.ok ? [] : r.problems;
};

describe('M14-1: loadAccountsConfig defaults', () => {
  it('off, a memory store without a data dir, the design figures', () => {
    const { config: c, warnings } = ok({});
    expect(c).toMatchObject({
      enabled: false, store: { kind: 'memory' }, dataDir: null, minAge: 13, passwordMin: 12, scrypt: { ln: 17, r: 8, p: 1 }, hashConcurrency: 2,
      hashQueue: 64, peppers: [], reservedNamesFile: null, moderationWordsFile: null, verifier: 'work', mailer: 'none', privacyUrl: null, termsUrl: null,
      shopify: null, requiredHolders: [],
    });
    expect(c.limits).toEqual({ ...ACCOUNT_RATE_LIMITS });
    expect(c.timing).toEqual({ ...ACCOUNT_TIMING });
    expect(c.retention).toEqual({ ...DEFAULT_ACCOUNT_RETENTION });
    expect(c.retention).toMatchObject({ revokedSessionsMs: 7 * 86_400_000, securityAuditMs: 180 * 86_400_000, operatorAuditMs: 730 * 86_400_000 });
    expect(warnings).toEqual([]);
    // a fresh object every time: changing one config never changes the constants or another config
    c.limits.registerPerHour = 99;
    expect(ACCOUNT_RATE_LIMITS.registerPerHour).toBe(3);
    expect(ok({}).config.limits.registerPerHour).toBe(3);
  });

  it('the file store under <DATA_DIR>/accounts, or ACCOUNTS_DATA_DIR', () => {
    expect(ok({ DATA_DIR: '/srv/openmtg' }).config).toMatchObject({ dataDir: join('/srv/openmtg', 'accounts'), store: { kind: 'file', dir: join('/srv/openmtg', 'accounts') } });
    expect(ok({ DATA_DIR: '/srv/openmtg', ACCOUNTS_DATA_DIR: '/var/accounts' }).config).toMatchObject({ dataDir: '/var/accounts', store: { kind: 'file', dir: '/var/accounts' } });
    expect(ok({ ACCOUNTS_DATA_DIR: '/var/accounts', ACCOUNTS_STORE: 'memory' }).config.store).toEqual({ kind: 'memory' });
    expect(ok({ ACCOUNTS_STORE: 'postgres' }).config.store).toEqual({ kind: 'postgres' });
  });

  it('a full development environment', () => {
    const { config: c, warnings } = ok({
      ACCOUNTS: 'on', ACCOUNTS_DATA_DIR: '/var/accounts', MIN_AGE: '16', PASSWORD_MIN: '15', SCRYPT_LN: '16', HASH_CONCURRENCY: '4', HASH_QUEUE: '128',
      PASSWORD_PEPPERS: `k1:${PEPPER_A}, k2:${PEPPER_B}`, RESERVED_NAMES_FILE: '/etc/openmtg/reserved.txt', MODERATION_WORDS_FILE: '/etc/openmtg/words.txt',
      CAPTCHA: 'none', MAILER: 'file', PRIVACY_URL: 'https://play.digidice.net/privacy', TERMS_URL: 'http://127.0.0.1:8787/terms',
      SHOPIFY_SHOP_ID: '12345678', SHOPIFY_CLIENT_ID: 'abc-DEF_123', SHOPIFY_CLIENT_SECRET: SHOPIFY_SECRET, ACCOUNTS_REQUIRED_HOLDERS: 'hosted, ladder',
    });
    expect(c).toMatchObject({
      enabled: true, store: { kind: 'file', dir: '/var/accounts' }, minAge: 16, passwordMin: 15, scrypt: { ln: 16, r: 8, p: 2 }, hashConcurrency: 4,
      hashQueue: 128, peppers: [{ id: 'k1', secret: PEPPER_A }, { id: 'k2', secret: PEPPER_B }], reservedNamesFile: '/etc/openmtg/reserved.txt',
      moderationWordsFile: '/etc/openmtg/words.txt', verifier: 'none', mailer: 'file', privacyUrl: 'https://play.digidice.net/privacy',
      termsUrl: 'http://127.0.0.1:8787/terms', shopify: { shopId: '12345678', clientId: 'abc-DEF_123', clientSecret: SHOPIFY_SECRET },
      requiredHolders: ['hosted', 'ladder'],
    });
    expect(warnings.join('\n')).toMatch(/CAPTCHA/);
    for (const v of ['1', 'true']) expect(ok({ ACCOUNTS: v }).config.enabled).toBe(true);
    for (const v of ['0', 'false', 'off']) expect(ok({ ACCOUNTS: v }).config.enabled).toBe(false);
  });

  it('warns, by name only, about a memory store, missing peppers, CAPTCHA=none and unknown ACCOUNTS_ variables', () => {
    expect(ok({ ACCOUNTS: 'on' }).warnings.join('\n')).toMatch(/ACCOUNTS_STORE: memory/);
    expect(ok({ ACCOUNTS: 'on', ACCOUNTS_DATA_DIR: '/var/a' }).warnings.join('\n')).toMatch(/PASSWORD_PEPPERS/);
    const w = ok({ ACCOUNTS_REGISTR_PER_HOUR: 'secret-looking-value' }).warnings;
    expect(w).toEqual(['ACCOUNTS_REGISTR_PER_HOUR: not a variable accounts reads']);
  });
});

describe('M14-1: every limit, time and retention key is overridable by its variable', () => {
  it('ACCOUNT_RATE_LIMITS by accountsEnvName', () => {
    for (const k of Object.keys(ACCOUNT_RATE_LIMITS) as (keyof typeof ACCOUNT_RATE_LIMITS)[]) {
      const name = accountsEnvName(k);
      expect(ACCOUNTS_CONFIG_VARIABLES).toContain(name);
      const c = ok({ [name]: String(ACCOUNT_RATE_LIMITS[k] + 1) }).config;
      expect(c.limits[k], name).toBe(ACCOUNT_RATE_LIMITS[k] + 1);
      for (const other of Object.keys(ACCOUNT_RATE_LIMITS) as (keyof typeof ACCOUNT_RATE_LIMITS)[]) {
        if (other !== k) expect(c.limits[other]).toBe(ACCOUNT_RATE_LIMITS[other]);
      }
    }
    expect(ok({ ACCOUNTS_REGISTER_PER_HOUR: '0' }).config.limits.registerPerHour).toBe(0);
  });

  it('ACCOUNT_TIMING by accountsEnvName', () => {
    for (const k of Object.keys(ACCOUNT_TIMING) as (keyof typeof ACCOUNT_TIMING)[]) {
      const name = accountsEnvName(k);
      expect(ACCOUNTS_CONFIG_VARIABLES).toContain(name);
      // one more millisecond keeps every cross-rule (grace < rotation, hold > cooldown, idle <= max) true
      const value = k === 'sessionIdleMs' || k === 'rotateGraceMs' || k === 'renameCooldownMs' ? ACCOUNT_TIMING[k] - 1 : ACCOUNT_TIMING[k] + 1;
      expect(ok({ [name]: String(value) }).config.timing[k], name).toBe(value);
    }
  });

  it('retention by ACCOUNTS_RETENTION_<KEY>, lengthened freely; the audit floors kept', () => {
    for (const k of Object.keys(DEFAULT_ACCOUNT_RETENTION) as (keyof AccountRetention)[]) {
      const name = retentionEnvName(k);
      expect(name).toMatch(/^ACCOUNTS_RETENTION_[A-Z_]+_MS$/);
      expect(ACCOUNTS_CONFIG_VARIABLES).toContain(name);
      expect(ok({ [name]: String(DEFAULT_ACCOUNT_RETENTION[k] + 1) }).config.retention[k], name).toBe(DEFAULT_ACCOUNT_RETENTION[k] + 1);
    }
    expect(retentionEnvName('revokedSessionsMs')).toBe('ACCOUNTS_RETENTION_REVOKED_SESSIONS_MS');
    expect(ok({ ACCOUNTS_RETENTION_CHANGES_MS: '60000' }).config.retention.changesMs).toBe(60_000);
    expect(problems({ ACCOUNTS_RETENTION_SECURITY_AUDIT_MS: '86400000' }).join()).toMatch(/ACCOUNTS_RETENTION_SECURITY_AUDIT_MS/);
    expect(problems({ ACCOUNTS_RETENTION_OPERATOR_AUDIT_MS: '86400000' }).join()).toMatch(/ACCOUNTS_RETENTION_OPERATOR_AUDIT_MS/);
  });

  it('every variable is listed once', () => {
    expect(new Set(ACCOUNTS_CONFIG_VARIABLES).size).toBe(ACCOUNTS_CONFIG_VARIABLES.length);
  });
});

describe('M14-1: refusals of bad values (a fixed list); a problem names the variable', () => {
  it('refuses instead of defaulting', () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ ACCOUNTS: 'yes' }, /^ACCOUNTS:/], [{ ACCOUNTS_STORE: 'sqlite' }, /ACCOUNTS_STORE/], [{ ACCOUNTS_STORE: 'file' }, /ACCOUNTS_STORE: file needs/],
      [{ ACCOUNTS_DATA_DIR: '/var/a\u0000b' }, /ACCOUNTS_DATA_DIR/], [{ MIN_AGE: '12' }, /MIN_AGE/], [{ MIN_AGE: '13.5' }, /MIN_AGE/], [{ MIN_AGE: '-13' }, /MIN_AGE/],
      [{ MIN_AGE: '1e2' }, /MIN_AGE/], [{ PASSWORD_MIN: '7' }, /PASSWORD_MIN/], [{ PASSWORD_MIN: '129' }, /PASSWORD_MIN/], [{ SCRYPT_LN: '15' }, /SCRYPT_LN/],
      [{ SCRYPT_LN: '18' }, /SCRYPT_LN/], [{ HASH_CONCURRENCY: '0' }, /HASH_CONCURRENCY/], [{ HASH_QUEUE: '0' }, /HASH_QUEUE/], [{ HASH_QUEUE: 'many' }, /HASH_QUEUE/],
      [{ PASSWORD_PEPPERS: 'k1' }, /PASSWORD_PEPPERS: entry 1/], [{ PASSWORD_PEPPERS: 'k1:short' }, /PASSWORD_PEPPERS: entry 1/],
      [{ CAPTCHA: 'turnstile' }, /CAPTCHA/], [{ MAILER: 'smtp' }, /MAILER/], [{ MAILER: 'file' }, /MAILER: file needs/],
      [{ PRIVACY_URL: 'ftp://example.org/privacy' }, /PRIVACY_URL/], [{ PRIVACY_URL: 'http://example.org/privacy' }, /PRIVACY_URL/],
      [{ TERMS_URL: 'https://user:pass@example.org/terms' }, /TERMS_URL/], [{ TERMS_URL: 'not a url' }, /TERMS_URL/],
      [{ SHOPIFY_SHOP_ID: '1234' }, /set all three or none/], [{ SHOPIFY_SHOP_ID: 'x', SHOPIFY_CLIENT_ID: 'y', SHOPIFY_CLIENT_SECRET: 'z' }, /SHOPIFY_SHOP_ID/],
      [{ ACCOUNTS_REQUIRED_HOLDERS: 'hosted,Hosted' }, /ACCOUNTS_REQUIRED_HOLDERS/], [{ ACCOUNTS_REQUIRED_HOLDERS: 'hosted,hosted' }, /listed twice/],
      [{ ACCOUNTS_REQUIRED_HOLDERS: 'hosted,' }, /ACCOUNTS_REQUIRED_HOLDERS/],
      [{ ACCOUNTS_REGISTER_PER_HOUR: '-1' }, /ACCOUNTS_REGISTER_PER_HOUR/], [{ ACCOUNTS_REGISTER_PER_HOUR: '3.5' }, /ACCOUNTS_REGISTER_PER_HOUR/],
      [{ ACCOUNTS_REGISTER_PER_HOUR: '99999999999999999' }, /ACCOUNTS_REGISTER_PER_HOUR/], [{ ACCOUNTS_PREFIX56_FACTOR: '0' }, /ACCOUNTS_PREFIX56_FACTOR/],
      [{ ACCOUNTS_PREFIX48_FACTOR: '2' }, /ACCOUNTS_PREFIX48_FACTOR/], [{ ACCOUNTS_PRESSURE_QUEUE_PERCENT: '101' }, /ACCOUNTS_PRESSURE_QUEUE_PERCENT/],
      [{ ACCOUNTS_WORK_MAX_BITS: '33' }, /ACCOUNTS_WORK_MAX_BITS/], [{ ACCOUNTS_WORK_MAX_BITS: '15' }, /ACCOUNTS_WORK_MAX_BITS/],
      [{ ACCOUNTS_BACKOFF_MAX_MS: '999' }, /ACCOUNTS_BACKOFF_MAX_MS/], [{ ACCOUNTS_COUNTER_ENTRIES: '0' }, /ACCOUNTS_COUNTER_ENTRIES/],
      [{ ACCOUNTS_SESSION_IDLE_MS: '0' }, /ACCOUNTS_SESSION_IDLE_MS/], [{ ACCOUNTS_SESSION_IDLE_MS: String(181 * 86_400_000) }, /ACCOUNTS_SESSION_IDLE_MS/],
      [{ ACCOUNTS_ROTATE_GRACE_MS: String(86_400_000) }, /ACCOUNTS_ROTATE_GRACE_MS/], [{ ACCOUNTS_RENAME_HOLD_MS: String(30 * 86_400_000) }, /ACCOUNTS_RENAME_HOLD_MS/],
      [{ ACCOUNTS_RETENTION_CHANGES_MS: '0' }, /ACCOUNTS_RETENTION_CHANGES_MS/],
    ];
    for (const [env, want] of bad) {
      const p = problems(env);
      expect(p.length, JSON.stringify(env)).toBeGreaterThan(0);
      expect(p.join('\n'), JSON.stringify(env)).toMatch(want);
    }
  });

  it('collects every problem at once', () => {
    expect(problems({ MIN_AGE: 'x', CAPTCHA: 'y', MAILER: 'z' })).toHaveLength(3);
  });
});

describe('M14-1: secrets are never echoed', () => {
  const secretLike = [PEPPER_A, PEPPER_B, SHOPIFY_SECRET, 'k1', 'hunter2-hunter2-hunter2-hunter2-hunter2'];

  it('in problems', () => {
    const envs: Record<string, string>[] = [
      { PASSWORD_PEPPERS: `k1:${PEPPER_A},k1:${PEPPER_B}` }, { PASSWORD_PEPPERS: `k1:${PEPPER_A},${PEPPER_B}` },
      { PASSWORD_PEPPERS: `k1:${PEPPER_A},bad id!:${PEPPER_B}` }, { PASSWORD_PEPPERS: 'k1:hunter2-hunter2 hunter2-hunter2-hunter2' },
      { SHOPIFY_SHOP_ID: '1', SHOPIFY_CLIENT_ID: 'c', SHOPIFY_CLIENT_SECRET: `${SHOPIFY_SECRET} x` }, { SHOPIFY_CLIENT_SECRET: SHOPIFY_SECRET },
      { MIN_AGE: PEPPER_A }, { ACCOUNTS_STORE: PEPPER_A }, { PRIVACY_URL: `ftp://${PEPPER_A}` },
    ];
    for (const env of envs) {
      const p = problems(env);
      expect(p.length, JSON.stringify(Object.keys(env))).toBeGreaterThan(0);
      const text = p.join('\n');
      for (const s of secretLike) if (s !== 'k1') expect(text, JSON.stringify(Object.keys(env))).not.toContain(s);
      expect(text).not.toMatch(/\bk1\b/);
    }
  });

  it('in warnings and the described configuration', () => {
    const { config, warnings } = ok({
      ACCOUNTS: 'on', ACCOUNTS_DATA_DIR: '/var/a', PASSWORD_PEPPERS: `k1:${PEPPER_A}`, SHOPIFY_SHOP_ID: '1', SHOPIFY_CLIENT_ID: 'c',
      SHOPIFY_CLIENT_SECRET: SHOPIFY_SECRET, ACCOUNTS_UNKNOWN: PEPPER_B,
    });
    const shown = JSON.stringify(describeAccountsConfig(config));
    for (const s of [PEPPER_A, PEPPER_B, SHOPIFY_SECRET]) {
      expect(shown).not.toContain(s);
      expect(warnings.join('\n')).not.toContain(s);
    }
    expect(describeAccountsConfig(config)).toMatchObject({ peppers: [{ id: 'k1', secret: '(set)' }], shopify: { clientSecret: '(set)' } });
    expect(describeAccountsConfig(ok({}).config)).toMatchObject({ peppers: [], shopify: '(none)' });
  });
});

describe('M14-1: parsePeppers', () => {
  it('unset or blank: none', () => {
    expect(parsePeppers(undefined)).toEqual({ ok: true, peppers: [] });
    expect(parsePeppers('')).toEqual({ ok: true, peppers: [] });
    expect(parsePeppers('   ')).toEqual({ ok: true, peppers: [] });
  });

  it('"id:secret" pairs, newest last, entries trimmed, a colon allowed in the secret', () => {
    expect(parsePeppers(`old:${PEPPER_A},new:${PEPPER_B}`)).toEqual({ ok: true, peppers: [{ id: 'old', secret: PEPPER_A }, { id: 'new', secret: PEPPER_B }] });
    expect(parsePeppers(` a:${PEPPER_A} , b_2-x:${PEPPER_B} `)).toEqual({ ok: true, peppers: [{ id: 'a', secret: PEPPER_A }, { id: 'b_2-x', secret: PEPPER_B }] });
    expect(parsePeppers(`k:${PEPPER_A}:more`)).toEqual({ ok: true, peppers: [{ id: 'k', secret: `${PEPPER_A}:more` }] });
    expect(parsePeppers(`k:${'x'.repeat(32)}`).ok).toBe(true);
  });

  it('refuses short secrets, bad and repeated ids, missing colons, white space and controls', () => {
    const bad = [
      'k', `:${PEPPER_A}`, `k:${'x'.repeat(31)}`, `k:${PEPPER_A},k:${PEPPER_B}`, `bad id:${PEPPER_A}`, `${'i'.repeat(33)}:${PEPPER_A}`,
      `k:${PEPPER_A} tail`, `k:${PEPPER_A}\u0007`, `k:${PEPPER_A},`, `k:${PEPPER_A},,j:${PEPPER_B}`,
    ];
    for (const v of bad) {
      const r = parsePeppers(v);
      expect(r.ok, JSON.stringify(v)).toBe(false);
      if (!r.ok) {
        expect(r.problem).toMatch(/^PASSWORD_PEPPERS: entry \d+/);
        expect(r.problem).not.toContain(PEPPER_A);
      }
    }
  });
});
