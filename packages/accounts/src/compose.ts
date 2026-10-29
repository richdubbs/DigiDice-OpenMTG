/**
 * The composition (design 13.3; M14-1's, never edited later): builds a whole AccountService from an AccountsConfig and what the host supplies, out of
 * each part's own index.ts. Every package wires itself in by replacing the `undefined` factory of its own stub; this file already passes the
 * moderation, rights and email parts to createAccountService, whose missing parts answer `notYet`. Server only.
 *
 * At the sync, hosted (the composition root, D2) calls composeAccounts with its GuestSessions, its log and, for ACCOUNTS_STORE=postgres, its
 * PostgresAccountStore (M14-11) as `host.store`; configured external providers (M14-13, M14-14) come in `host.providers`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountsConfig } from './config';
import type { BreachedPasswordCheck, CreateNoVerifier, CreateWorkVerifier, HumanVerifier } from './abuse/api';
import type { CreateCredentialTools, CreatePasswordHasher } from './crypto/api';
import type { CreateFileMailer, CreateNoMailer, Mailer } from './email/api';
import type { CreateLocalProvider, IdentityProvider } from './identity/api';
import type { CreateListNameFilter, CreateNameRules } from './names/api';
import type {
  AccountService, AccountsLog, CreateAccountService, CreateEmailPart, CreateModerationPart, CreateRightsPart, GuestSessions,
} from './service/api';
import type { AccountStore, CreateMemoryAccountStore, OpenFileAccountStore } from './store/api';
import { createListNameFilter, createNameRules } from './names/index';
import { createCredentialTools, createPasswordHasher } from './crypto/index';
import { createNoVerifier, createWorkVerifier } from './abuse/index';
import { createEmailPart, createFileMailer, createNoMailer } from './email/index';
import { createModerationPart } from './moderation/index';
import { createRightsPart } from './rights/index';
import { createAccountService, createLocalProvider } from './service/index';
import { createMemoryAccountStore, openFileAccountStore } from './store/index';

/** Every factory the composition uses, with the package that builds it. */
export interface AccountsFactories {
  createAccountService: CreateAccountService;
  createLocalProvider: CreateLocalProvider;
  createMemoryAccountStore: CreateMemoryAccountStore;
  openFileAccountStore: OpenFileAccountStore;
  createCredentialTools: CreateCredentialTools;
  createPasswordHasher: CreatePasswordHasher;
  createNameRules: CreateNameRules;
  createListNameFilter: CreateListNameFilter;
  createWorkVerifier: CreateWorkVerifier;
  createNoVerifier: CreateNoVerifier;
  createNoMailer: CreateNoMailer;
  createFileMailer: CreateFileMailer;
  createModerationPart: CreateModerationPart;
  createRightsPart: CreateRightsPart;
  createEmailPart: CreateEmailPart;
}
export type BuiltFactories = { [K in keyof AccountsFactories]: AccountsFactories[K] | undefined };

/** Which work package fills each factory (for the "not built yet" message). */
export const FACTORY_OWNERS: Readonly<Record<keyof AccountsFactories, string>> = Object.freeze({
  createAccountService: 'M14-5', createLocalProvider: 'M14-5', createMemoryAccountStore: 'M14-4', openFileAccountStore: 'M14-4',
  createCredentialTools: 'M14-3', createPasswordHasher: 'M14-3', createNameRules: 'M14-2', createListNameFilter: 'M14-2',
  createWorkVerifier: 'M14-5', createNoVerifier: 'M14-5', createNoMailer: 'M14-8', createFileMailer: 'M14-8', createModerationPart: 'M14-6',
  createRightsPart: 'M14-7', createEmailPart: 'M14-8',
});

/** The factories as their part's index.ts exports them now: each is undefined until its owner fills its stub. */
export function builtFactories(): BuiltFactories {
  return {
    createAccountService, createLocalProvider, createMemoryAccountStore, openFileAccountStore, createCredentialTools, createPasswordHasher,
    createNameRules, createListNameFilter, createWorkVerifier, createNoVerifier, createNoMailer, createFileMailer, createModerationPart,
    createRightsPart, createEmailPart,
  };
}

/** What the host supplies. */
export interface AccountsHost {
  /** Hosted's guest sessions (5.5); a fake in tests. */
  guests: GuestSessions;
  log: AccountsLog;
  /** A store the host made (PostgresAccountStore at the sync); otherwise the composition opens config.store's memory or file store (PGlite). */
  store?: AccountStore;
  /** External providers the host configured (shopify, passkey); the local provider always comes first. */
  providers?: IdentityProvider[];
  breachCheck?: BreachedPasswordCheck;
  /** node:crypto's randomBytes by default. */
  random?: (n: number) => Uint8Array;
  /** Factories to use instead of the built ones (tests, and a host that swaps one part). */
  factories?: Partial<AccountsFactories>;
}

export interface ComposedAccounts {
  service: AccountService;
  /** The store the service runs on (the host's, or the one the composition opened: AccountService.close closes it). */
  store: AccountStore;
}

function need<K extends keyof AccountsFactories>(f: BuiltFactories, k: K): AccountsFactories[K] {
  const v = f[k];
  if (v === undefined) throw new Error(`not built yet: ${k} (${FACTORY_OWNERS[k]})`);
  return v as AccountsFactories[K];
}

/** The one secret comparison (4.1): node:crypto's timingSafeEqual, false at once for different lengths (lengths are never secret here). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

const nodeRandom = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

async function openStore(config: AccountsConfig, f: BuiltFactories): Promise<AccountStore> {
  switch (config.store.kind) {
    case 'memory':
      return need(f, 'createMemoryAccountStore')({ emailResetLiveCodes: config.limits.emailResetLiveCodes });
    case 'file':
      return need(f, 'openFileAccountStore')({ dir: config.store.dir, emailResetLiveCodes: config.limits.emailResetLiveCodes });
    case 'postgres':
      throw new Error('ACCOUNTS_STORE=postgres: the host passes its PostgresAccountStore (M14-11) as host.store');
  }
}

/**
 * Builds the service: the store (the host's, or config.store's), the credential tools and the hasher (node:crypto's randomBytes and timingSafeEqual,
 * the configured peppers and scrypt parameters), the name rules and word filter (RESERVED_NAMES_FILE and MODERATION_WORDS_FILE read as UTF-8 text),
 * the verifier (CAPTCHA), the mailer (MAILER; FileMailer under <dataDir>/mail), the local provider first among the providers, and the three parts.
 * Throws "not built yet: <factory> (<package>)" while a factory it needs is still a stub, closing a store it opened.
 */
export async function composeAccounts(config: AccountsConfig, host: AccountsHost): Promise<ComposedAccounts> {
  const f: BuiltFactories = { ...builtFactories(), ...host.factories };
  const random = host.random ?? nodeRandom;
  const opened = host.store === undefined;
  const store = host.store ?? (await openStore(config, f));
  try {
    const credentials = need(f, 'createCredentialTools')({ random, equal: constantTimeEqual, peppers: config.peppers, passwordMin: config.passwordMin });
    const hasher = need(f, 'createPasswordHasher')({
      scrypt: config.scrypt, concurrency: config.hashConcurrency, queue: config.hashQueue, peppers: config.peppers, random, equal: constantTimeEqual,
    });
    const reservedNamesText = config.reservedNamesFile !== null ? await readFile(config.reservedNamesFile, 'utf8') : null;
    const wordsText = config.moderationWordsFile !== null ? await readFile(config.moderationWordsFile, 'utf8') : null;
    const names = need(f, 'createNameRules')({ reservedNamesText });
    const nameFilter = need(f, 'createListNameFilter')(wordsText, names);
    const verifier: HumanVerifier =
      config.verifier === 'work' ? need(f, 'createWorkVerifier')({ random, challengeMs: config.timing.workChallengeMs }) : need(f, 'createNoVerifier')();
    let mailer: Mailer;
    if (config.mailer === 'file') {
      if (config.dataDir === null) throw new Error('MAILER=file needs ACCOUNTS_DATA_DIR');
      mailer = need(f, 'createFileMailer')({ dir: join(config.dataDir, 'mail'), noticeFileMs: config.timing.noticeFileMs });
    } else mailer = need(f, 'createNoMailer')();
    const local = need(f, 'createLocalProvider')({ hasher, credentials });
    const providers: IdentityProvider[] = [local, ...(host.providers ?? []).filter((p) => p.id !== 'local')];
    const service = need(f, 'createAccountService')({
      store, config, hasher, credentials, providers, names, nameFilter, verifier, mailer, guests: host.guests, log: host.log, random,
      ...(host.breachCheck !== undefined ? { breachCheck: host.breachCheck } : {}),
      parts: { moderation: f.createModerationPart, rights: f.createRightsPart, email: f.createEmailPart },
    });
    return { service, store };
  } catch (e) {
    if (opened) await store.close().catch(() => undefined);
    throw e;
  }
}
