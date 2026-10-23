/**
 * Shared fixtures of the M14-5 tests (owner rule: in process, a fake clock, fixed inputs). The service runs on the memory store, the real name rules
 * and credential tools, and the real hasher with a fast key derivation (HMAC-SHA256 instead of scrypt) and no padding sleep, wrapped in a spy that
 * counts its calls and can report a fuller queue than it has.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { expect } from 'vitest';
import {
  ACCOUNT_METHOD_ERRORS, createCredentialTools, createListNameFilter, createMemoryAccountStore, createNameRules, loadAccountsConfig,
  MemoryAccountStore, type AccountResult, type AccountService, type AccountsConfig, type AccountStore, type CreateEmailPart, type CreateModerationPart,
  type BreachedPasswordCheck, type CreateRightsPart, type GuestSessions, type HashPriority, type HumanVerifier, type NameRules, type PartDeps,
  type PasswordHasher, type RequestContext, type ServiceMethod,
} from '@openmtg/accounts';
import { buildNoVerifier, buildWorkVerifier, leadingZeroBits, workHash } from '../../src/abuse/work';
import { buildPasswordHasher, type Derive } from '../../src/crypto/hasher';
import { buildAccountService } from '../../src/service/core';
import { fixedRandom } from '../m14-1/support';

export { fixedRandom };

export const T0 = Date.parse('2026-10-22T12:00:00.000Z');
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const PW = 'correct horse battery staple';
export const PW2 = 'a different long passphrase';

export class Clock {
  t: number;
  constructor(t = T0) {
    this.t = t;
  }
  now = (): Date => new Date(this.t);
  advance(ms: number): Date {
    this.t += ms;
    return this.now();
  }
}

export const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && timingSafeEqual(a, b);

/** A fast stand-in for scrypt (the parameters still go into the PHC string and the rehash rules). */
export const fastDerive: Derive = async (input, salt, params, keyLength) =>
  new Uint8Array(createHmac('sha256', Buffer.from(salt)).update(Buffer.from(input)).update(`${params.ln},${params.r},${params.p}`).digest().subarray(0, keyLength));

/** The hasher spy: every call counted with its class; `pressure` makes load() report a queue fuller than half. */
export interface HasherSpy extends PasswordHasher {
  calls: { op: 'hash' | 'verify' | 'dummy'; priority: HashPriority }[];
  pressure: boolean;
  /** Throws HasherBusyError-like busy on the next call when set (via the real pool's error type). */
  reset(): void;
}

export function spyHasher(inner: PasswordHasher): HasherSpy {
  const spy: HasherSpy = {
    calls: [],
    pressure: false,
    hash(pw, o) {
      spy.calls.push({ op: 'hash', priority: o.priority });
      return inner.hash(pw, o);
    },
    verify(phc, pw, o) {
      spy.calls.push({ op: 'verify', priority: o.priority });
      return inner.verify(phc, pw, o);
    },
    dummy(pw, o) {
      spy.calls.push({ op: 'dummy', priority: o.priority });
      return inner.dummy(pw, o);
    },
    load() {
      const l = inner.load();
      return spy.pressure ? { ...l, queued: { high: 0, normal: 0, low: l.capacity }, capacity: l.capacity } : l;
    },
    reset() {
      spy.calls = [];
    },
  };
  return spy;
}

export function configOf(env: Record<string, string> = {}): AccountsConfig {
  const r = loadAccountsConfig({ ACCOUNTS: 'on', CAPTCHA: 'none', ...env });
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r.config;
}

/** A fake of hosted's guest sessions: tokens to sessions, busy flags, and every retire recorded. */
export class FakeGuests implements GuestSessions {
  readonly sessions = new Map<string, { session: string; busy: boolean }>();
  readonly busySessions = new Set<string>();
  readonly retired: string[] = [];
  add(token: string, session: string, busy = false): void {
    this.sessions.set(token, { session, busy });
  }
  async proof(token: string) {
    const s = this.sessions.get(token);
    return s === undefined || this.retired.includes(s.session) ? null : { ...s };
  }
  async busy(session: string) {
    return this.busySessions.has(session);
  }
  async retire(session: string) {
    this.retired.push(session);
  }
}

export interface LogLine { name: string; fields: Record<string, string | number | boolean | null> }

export interface Setup {
  service: AccountService;
  store: AccountStore;
  clock: Clock;
  guests: FakeGuests;
  hasher: HasherSpy;
  log: LogLine[];
  config: AccountsConfig;
  names: NameRules;
  verifier: HumanVerifier;
  /** The PartDeps the parts were given (a fake part captures them). */
  partDeps: { current: PartDeps | null };
}

export interface SetupOptions {
  env?: Record<string, string>;
  store?: AccountStore;
  seed?: string;
  names?: NameRules;
  verifier?: 'none' | 'work';
  parts?: { moderation?: CreateModerationPart; rights?: CreateRightsPart; email?: CreateEmailPart };
  mailerKind?: string;
  clock?: Clock;
  /** The credential tools' comparison (CryptoDeps.equal), to count its calls. */
  equal?: (a: Uint8Array, b: Uint8Array) => boolean;
  /** Replaces the hasher spy's inner hasher. */
  hasher?: PasswordHasher;
  guests?: FakeGuests;
  /** A configured breach check (4.2; none by default). */
  breachCheck?: BreachedPasswordCheck;
}

export function setup(o: SetupOptions = {}): Setup {
  const clock = o.clock ?? new Clock();
  const verifierKind = o.verifier ?? 'none';
  const config = configOf({ CAPTCHA: verifierKind, ...o.env });
  const random = fixedRandom(o.seed ?? 'm14-5');
  const store = o.store ?? createMemoryAccountStore({ emailResetLiveCodes: config.limits.emailResetLiveCodes });
  const inner =
    o.hasher ??
    buildPasswordHasher(
      { scrypt: config.scrypt, concurrency: config.hashConcurrency, queue: config.hashQueue, peppers: config.peppers, random, equal },
      { derive: fastDerive, sleep: async () => undefined },
    );
  const hasher = spyHasher(inner);
  const credentials = createCredentialTools({ random, equal: o.equal ?? equal, peppers: config.peppers, passwordMin: config.passwordMin });
  const names = o.names ?? createNameRules({ reservedNamesText: null });
  const nameFilter = createListNameFilter(null, names);
  const verifier = verifierKind === 'work' ? buildWorkVerifier({ random, challengeMs: config.timing.workChallengeMs }) : buildNoVerifier();
  const guests = o.guests ?? new FakeGuests();
  const log: LogLine[] = [];
  const partDeps: { current: PartDeps | null } = { current: null };
  const capture = <F extends (deps: PartDeps) => unknown>(f: F | undefined): F | undefined =>
    f === undefined ? undefined : (((deps: PartDeps) => {
      partDeps.current = deps;
      return f(deps);
    }) as F);
  const service = buildAccountService({
    store, config, hasher, credentials, providers: [], names, nameFilter, verifier,
    mailer: { kind: o.mailerKind ?? 'none', send: async () => undefined }, guests, log: { event: (name, fields) => log.push({ name, fields }) }, random,
    now: clock.now,
    parts: { moderation: capture(o.parts?.moderation), rights: capture(o.parts?.rights), email: capture(o.parts?.email) },
    ...(o.breachCheck !== undefined ? { breachCheck: o.breachCheck } : {}),
  });
  return { service, store, clock, guests, hasher, log, config, names, verifier, partDeps };
}

/** A request context at the clock's time. */
export function ctxOf(clock: Clock, over: Partial<RequestContext> = {}): RequestContext {
  return { now: clock.now(), connection: 'conn-1', addressKey: '203.0.113.7', guestSession: 'gs_guest1', guestBusy: false, client: 'web', ...over };
}

/** Checks a result's code against its method's row of ACCOUNT_METHOD_ERRORS (13.2: every answer's code is in its row). */
export function inRow<T>(method: ServiceMethod, r: AccountResult<T>): AccountResult<T> {
  if (!r.ok) expect(ACCOUNT_METHOD_ERRORS[method], `${method} answered ${r.error.code}`).toContain(r.error.code);
  return r;
}

/** The value of an ok result (fails the test otherwise, naming the code). */
export function value<T>(r: AccountResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

/** The code of a refusal (fails the test on ok). */
export function code<T>(r: AccountResult<T>): string {
  if (r.ok) throw new Error('expected a refusal, got ok');
  return r.error.code;
}

export const BIRTH = { year: 1990, month: 5 };

/** An IPv4 address key of its own for each text (FNV-1a of it), in 10.0.0.0/8. */
export function addressFor(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `10.${(h >>> 16) & 255}.${(h >>> 8) & 255}.${h & 255}`;
}

/** Registers `name` with PW from its own connection and address key. */
export async function registerAs(s: Setup, name: string, over: Partial<RequestContext> = {}, password = PW) {
  const ctx = ctxOf(s.clock, { connection: `conn-${name}`, guestSession: null, addressKey: addressFor(`register ${name}`), ...over });
  return value(inRow('register', await s.service.register(ctx, { name, password, birth: BIRTH, claimGuest: false })));
}

/** A dump of every table of a memory store. */
export function dumpOf(store: AccountStore): Record<string, [string, unknown][]> {
  if (!(store instanceof MemoryAccountStore)) throw new Error('not a memory store');
  return store.dump();
}

/** Solves a work challenge (tests use few bits). */
export function solve(challenge: string, bits: number): string {
  for (let n = 0; n < 10_000_000; n++) {
    if (leadingZeroBits(workHash(challenge, String(n))) >= bits) return `${challenge}:${n}`;
  }
  throw new Error('no solution found');
}
