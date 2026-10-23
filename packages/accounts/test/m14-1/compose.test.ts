/**
 * M14-1: the composition (design 13.3) with fake factories: what each factory receives from the configuration and the host, the local provider first,
 * the three parts passed through, the store opened from the configuration and closed when a later step fails, and "not built yet" naming the
 * package while a stub is still undefined. Also: every stub's export exists under its fixed name (a test that survives its owner filling it).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  builtFactories, composeAccounts, constantTimeEqual, FACTORY_OWNERS, loadAccountsConfig,
  type AccountService, type AccountServiceDeps, type AccountStore, type AccountsConfig, type AccountsFactories, type GuestSessions, type HumanVerifier,
  type IdentityProvider, type Mailer, type NameFilter, type NameRules, type PasswordHasher, type PasswordProvider,
} from '@openmtg/accounts';
import { fixedRandom } from './support';

const config = (env: Record<string, string>): AccountsConfig => {
  const r = loadAccountsConfig(env);
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r.config;
};

const guests: GuestSessions = { proof: async () => null, busy: async () => false, retire: async () => undefined };
const log = { event: () => undefined };

/** Fake factories that record what they were given. */
function fakes() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  let closed = 0;
  const store = { close: async () => { closed++; } } as unknown as AccountStore;
  const hasher = { kind: 'fake-hasher' } as unknown as PasswordHasher;
  const credentials = { kind: 'fake-credentials' } as unknown as ReturnType<AccountsFactories['createCredentialTools']>;
  const names = { kind: 'fake-names' } as unknown as NameRules;
  const filter = { kind: 'fake-filter' } as unknown as NameFilter;
  const work = { kind: 'work', siteKey: null } as unknown as HumanVerifier;
  const none = { kind: 'none', siteKey: null } as unknown as HumanVerifier;
  const noMailer = { kind: 'none' } as unknown as Mailer;
  const fileMailer = { kind: 'file' } as unknown as Mailer;
  const local = { id: 'local', kind: 'password' } as unknown as PasswordProvider;
  const service = { kind: 'fake-service' } as unknown as AccountService;
  const moderation = (() => ({})) as unknown as AccountsFactories['createModerationPart'];
  const rights = (() => ({})) as unknown as AccountsFactories['createRightsPart'];
  const email = (() => ({})) as unknown as AccountsFactories['createEmailPart'];
  const factories: AccountsFactories = {
    createAccountService: (deps) => (record('createAccountService', [deps]), service),
    createLocalProvider: (deps) => (record('createLocalProvider', [deps]), local),
    createMemoryAccountStore: (opts) => (record('createMemoryAccountStore', [opts]), store),
    openFileAccountStore: async (opts) => (record('openFileAccountStore', [opts]), store),
    createCredentialTools: (deps) => (record('createCredentialTools', [deps]), credentials),
    createPasswordHasher: (opts) => (record('createPasswordHasher', [opts]), hasher),
    createNameRules: (opts) => (record('createNameRules', [opts]), names),
    createListNameFilter: (words, rules) => (record('createListNameFilter', [words, rules]), filter),
    createWorkVerifier: (opts) => (record('createWorkVerifier', [opts]), work),
    createNoVerifier: () => (record('createNoVerifier', []), none),
    createNoMailer: () => (record('createNoMailer', []), noMailer),
    createFileMailer: (opts) => (record('createFileMailer', [opts]), fileMailer),
    createModerationPart: moderation,
    createRightsPart: rights,
    createEmailPart: email,
  };
  return { factories, calls, store, hasher, credentials, names, filter, work, none, noMailer, fileMailer, local, service, moderation, rights, email, closed: () => closed };
}

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openmtg-m14-1-'));
  await writeFile(join(dir, 'reserved.txt'), 'acme\nwidgetco\n', 'utf8');
  await writeFile(join(dir, 'words.txt'), 'badword\n!goodbadword\n', 'utf8');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('M14-1: composeAccounts', () => {
  it('wires a memory-store service with the work verifier and NoMailer from the defaults', async () => {
    const f = fakes();
    const random = fixedRandom('compose');
    const c = config({ ACCOUNTS: 'on', PASSWORD_PEPPERS: `k1:${'p'.repeat(40)}` });
    const out = await composeAccounts(c, { guests, log, random, factories: f.factories });
    expect(out).toEqual({ service: f.service, store: f.store });
    expect(f.calls['createMemoryAccountStore']).toEqual([[{ emailResetLiveCodes: 3 }]]);
    expect(f.calls['openFileAccountStore']).toBeUndefined();
    // the store gets the configured live-code cap, so it and the service agree (review of M14-4)
    const g = fakes();
    await composeAccounts(config({ ACCOUNTS_EMAIL_RESET_LIVE_CODES: '5' }), { guests, log, random, factories: g.factories });
    expect(g.calls['createMemoryAccountStore']).toEqual([[{ emailResetLiveCodes: 5 }]]);
    const [tools] = f.calls['createCredentialTools']![0] as [{ random: unknown; equal: unknown; peppers: unknown; passwordMin: number }];
    expect(tools).toEqual({ random, equal: constantTimeEqual, peppers: c.peppers, passwordMin: 12 });
    const [hash] = f.calls['createPasswordHasher']![0] as [{ equal: unknown }];
    // the hasher gets the same one comparison as the credential tools (finding 9; 4.1, 12.1)
    expect(hash).toEqual({ scrypt: { ln: 17, r: 8, p: 1 }, concurrency: 2, queue: 64, peppers: c.peppers, random, equal: constantTimeEqual });
    expect(hash.equal).toBe(tools.equal);
    expect(f.calls['createNameRules']![0]).toEqual([{ reservedNamesText: null }]);
    expect(f.calls['createListNameFilter']![0]).toEqual([null, f.names]);
    expect(f.calls['createWorkVerifier']![0]).toEqual([{ random, challengeMs: 120_000 }]);
    expect(f.calls['createNoVerifier']).toBeUndefined();
    expect(f.calls['createNoMailer']).toHaveLength(1);
    expect(f.calls['createLocalProvider']![0]).toEqual([{ hasher: f.hasher, credentials: f.credentials }]);
    const [deps] = f.calls['createAccountService']![0] as [AccountServiceDeps];
    expect(deps).toMatchObject({
      store: f.store, config: c, hasher: f.hasher, credentials: f.credentials, names: f.names, nameFilter: f.filter, verifier: f.work, mailer: f.noMailer,
      guests, log, random,
    });
    expect(deps.providers).toEqual([f.local]);
    expect(deps.parts).toEqual({ moderation: f.moderation, rights: f.rights, email: f.email });
    expect('breachCheck' in deps).toBe(false);
  });

  it('the file store and FileMailer under the data dir, CAPTCHA=none, the name files read, the host\'s providers after local', async () => {
    const f = fakes();
    const c = config({
      ACCOUNTS_DATA_DIR: join(dir, 'data'), MAILER: 'file', CAPTCHA: 'none', RESERVED_NAMES_FILE: join(dir, 'reserved.txt'),
      MODERATION_WORDS_FILE: join(dir, 'words.txt'),
    });
    const shopify = { id: 'shopify', kind: 'redirect' } as unknown as IdentityProvider;
    const strayLocal = { id: 'local', kind: 'password' } as unknown as IdentityProvider;
    const breachCheck = { breached: async () => 'unknown' as const };
    await composeAccounts(c, { guests, log, providers: [strayLocal, shopify], breachCheck, factories: f.factories });
    expect(f.calls['openFileAccountStore']![0]).toEqual([{ dir: join(dir, 'data'), emailResetLiveCodes: 3 }]);
    expect(f.calls['createFileMailer']![0]).toEqual([{ dir: join(dir, 'data', 'mail'), noticeFileMs: 86_400_000 }]);
    expect(f.calls['createNoVerifier']).toHaveLength(1);
    expect(f.calls['createNameRules']![0]).toEqual([{ reservedNamesText: 'acme\nwidgetco\n' }]);
    expect(f.calls['createListNameFilter']![0]).toEqual(['badword\n!goodbadword\n', f.names]);
    const [deps] = f.calls['createAccountService']![0] as [AccountServiceDeps];
    expect(deps.providers).toEqual([f.local, shopify]);
    expect(deps.breachCheck).toBe(breachCheck);
    expect(deps.verifier).toBe(f.none);
    expect(deps.mailer).toBe(f.fileMailer);
    // node:crypto's randomBytes by default
    expect(deps.random!(16)).toHaveLength(16);
  });

  it('runs on the host\'s store (PostgreSQL at the sync) and never closes it; postgres without one is refused', async () => {
    const f = fakes();
    const hostStore = { close: async () => undefined } as unknown as AccountStore;
    const out = await composeAccounts(config({ ACCOUNTS_STORE: 'postgres' }), { guests, log, store: hostStore, factories: f.factories });
    expect(out.store).toBe(hostStore);
    expect(f.calls['createMemoryAccountStore']).toBeUndefined();
    await expect(composeAccounts(config({ ACCOUNTS_STORE: 'postgres' }), { guests, log, factories: f.factories })).rejects.toThrow(/host\.store/);
  });

  it('a factory still a stub: "not built yet" with its package, and the store it opened is closed', async () => {
    const f = fakes();
    await expect(
      composeAccounts(config({}), { guests, log, factories: { ...f.factories, createAccountService: undefined as never } }),
    ).rejects.toThrow('not built yet: createAccountService (M14-5)');
    expect(f.closed()).toBe(1);
    await expect(
      composeAccounts(config({}), { guests, log, factories: { ...f.factories, createMemoryAccountStore: undefined as never } }),
    ).rejects.toThrow('not built yet: createMemoryAccountStore (M14-4)');
    await expect(
      composeAccounts(config({}), { guests, log, factories: { ...f.factories, createNameRules: undefined as never } }),
    ).rejects.toThrow('not built yet: createNameRules (M14-2)');
    expect(f.closed()).toBe(2);
  });

  it('missing parts are passed as undefined (their methods answer notYet in the service)', async () => {
    const f = fakes();
    await composeAccounts(config({}), {
      guests, log, factories: { ...f.factories, createModerationPart: undefined as never, createRightsPart: undefined as never, createEmailPart: undefined as never },
    });
    const [deps] = f.calls['createAccountService']![0] as [AccountServiceDeps];
    expect(deps.parts).toEqual({ moderation: undefined, rights: undefined, email: undefined });
  });

  it('constantTimeEqual: equal bytes only, false for other lengths', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe('M14-1: the stubs', () => {
  it('every factory is exported under its fixed name (a function once its owner filled it, undefined until then)', () => {
    const built = builtFactories();
    expect(Object.keys(built).sort()).toEqual(Object.keys(FACTORY_OWNERS).sort());
    for (const [name, f] of Object.entries(built)) expect(['function', 'undefined'], name).toContain(typeof f);
  });
});
