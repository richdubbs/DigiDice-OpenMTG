/**
 * Shared fixtures of the M14-8 tests (owner rule: in process, a fake clock, fixed inputs). The service is M14-5's on the memory store with the fast
 * hasher of test/m14-5/support.ts, the email part of src/email and a mailer that records every message (or holds each send until it is let go), so
 * a test reads the codes from the mails as a player would.
 */
import { createListNameFilter, createMemoryAccountStore, createCredentialTools, createNameRules, type AccountId, type AccountService, type AccountsConfig,
  type AccountStore, type LimitRule, type MailKind, type Mailer, type PartDeps, type RequestContext, type SignedIn } from '@openmtg/accounts';
import { buildNoVerifier } from '../../src/abuse/work';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { buildEmailPart, type BuiltEmailPart } from '../../src/email/part';
import { createModerationPart } from '../../src/moderation/index';
import { buildAccountService } from '../../src/service/core';
import {
  addressFor, BIRTH, Clock, configOf, ctxOf, equal, FakeGuests, fastDerive, fixedRandom, inRow, PW, spyHasher, value, type HasherSpy, type LogLine,
} from '../m14-5/support';

export * from '../m14-5/support';

export interface SentMail { to: string; subject: string; text: string; meta: { account: AccountId; kind: MailKind; expiresAt: string | null } }

/** A mailer that records every message; `hold` makes each send wait until `release`. */
export class RecordingMailer implements Mailer {
  readonly sent: SentMail[] = [];
  /** Sends called so far (a held one included). */
  calls = 0;
  hold = false;
  /** Sends that finished (resolved). */
  resolved = 0;
  private held: (() => void)[] = [];
  constructor(readonly kind = 'test') {}
  async send(to: string, message: { subject: string; text: string }, meta: SentMail['meta']): Promise<void> {
    this.calls++;
    this.sent.push({ to, subject: message.subject, text: message.text, meta: { ...meta } });
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
    this.resolved++;
  }
  release(): void {
    this.hold = false;
    const h = this.held;
    this.held = [];
    for (const f of h) f();
  }
  to(address: string): SentMail[] {
    return this.sent.filter((m) => m.to === address);
  }
}

export interface MailSetup {
  service: AccountService;
  store: AccountStore;
  clock: Clock;
  guests: FakeGuests;
  hasher: HasherSpy;
  log: LogLine[];
  config: AccountsConfig;
  mailer: Mailer;
  /** The email part the service built (its idle() waits for the work after an answer and for the mail queue). */
  part: BuiltEmailPart;
  partDeps: PartDeps;
  /** Waits until the email work after every answer so far is done and the queue has sent everything. */
  idle(): Promise<void>;
}

export interface MailSetupOptions {
  env?: Record<string, string>;
  mailer?: Mailer;
  clock?: Clock;
  store?: AccountStore;
  seed?: string;
  /** Replaces what the email part is built on (a test wraps the rate limits to record their calls). */
  deps?: (deps: PartDeps) => PartDeps;
  /** The credential tools' comparison (CryptoDeps.equal, which the core passes on as PartDeps.equal), to count its calls. */
  equal?: (a: Uint8Array, b: Uint8Array) => boolean;
  /** Builds the real moderation part too (given the service's name rules and clock), for the operator's commands and their notices. */
  moderation?: boolean;
}

export function mailSetup(o: MailSetupOptions = {}): MailSetup {
  const clock = o.clock ?? new Clock();
  const config = configOf({ CAPTCHA: 'none', ...o.env });
  const random = fixedRandom(o.seed ?? 'm14-8');
  const store = o.store ?? createMemoryAccountStore({ emailResetLiveCodes: config.limits.emailResetLiveCodes });
  const hasher = spyHasher(
    buildPasswordHasher(
      { scrypt: config.scrypt, concurrency: config.hashConcurrency, queue: config.hashQueue, peppers: config.peppers, random, equal },
      { derive: fastDerive, sleep: async () => undefined },
    ),
  );
  const credentials = createCredentialTools({ random, equal: o.equal ?? equal, peppers: config.peppers, passwordMin: config.passwordMin });
  const names = createNameRules({ reservedNamesText: null });
  const log: LogLine[] = [];
  const mailer = o.mailer ?? new RecordingMailer();
  const guests = new FakeGuests();
  const box: { part: BuiltEmailPart | null; deps: PartDeps | null } = { part: null, deps: null };
  const service = buildAccountService({
    store, config, hasher, credentials, providers: [], names, nameFilter: createListNameFilter(null, names), verifier: buildNoVerifier(), mailer, guests,
    log: { event: (name, fields) => log.push({ name, fields }) }, random, now: clock.now,
    parts: {
      email: (given) => {
        const deps = o.deps !== undefined ? o.deps(given) : given;
        box.deps = deps;
        return (box.part = buildEmailPart(deps));
      },
      ...(o.moderation === true ? { moderation: (deps: PartDeps) => createModerationPart({ ...deps, names, now: clock.now }) } : {}),
    },
  });
  const part = box.part!;
  return { service, store, clock, guests, hasher, log, config, mailer, part, partDeps: box.deps!, idle: () => part.idle() };
}

export interface LimitCall { rule: LimitRule; key: Record<string, unknown>; ok: boolean }

/** For MailSetupOptions.deps: the email part's rate limits, every take pushed onto `calls` in order with its outcome. */
export function recordLimits(calls: LimitCall[]): (d: PartDeps) => PartDeps {
  return (d) => ({
    ...d,
    limits: {
      ...d.limits,
      take(rule, key, now) {
        const r = d.limits.take(rule, key, now);
        calls.push({ rule, key: { ...key }, ok: r.ok });
        return r;
      },
    },
  });
}

type StoreMethod = { [K in keyof AccountStore]: AccountStore[K] extends (...args: never[]) => unknown ? K : never }[keyof AccountStore];
/** A replacement of a store method: it gets the store's own method (bound) and the call's arguments. */
export type StoreHook = (own: (...args: unknown[]) => Promise<unknown>, ...args: unknown[]) => Promise<unknown>;

/** The store with every method call's name pushed onto `calls`, in order; `hooks` replace methods (each gets the store's own). */
export function spyStore(store: AccountStore, calls: string[], hooks: Partial<Record<StoreMethod, StoreHook>> = {}): AccountStore {
  return new Proxy(store, {
    get(target, prop) {
      const v: unknown = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      const own = (...args: unknown[]) => (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
      const hook = hooks[prop as StoreMethod];
      return (...args: unknown[]) => {
        calls.push(String(prop));
        return hook !== undefined ? hook(own, ...args) : own(...args);
      };
    },
  });
}

/** The code a mail carries ("ABCDE-FGHJK"), without the dash. */
export function codeOf(mail: SentMail | undefined): string {
  const m = /\b([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})\b/.exec(mail?.text ?? '');
  if (m === null) throw new Error('no code in the mail');
  return `${m[1]}${m[2]}`;
}

/** Lets the event loop turn until `f` holds (at most `turns` turns): for work that runs after an answer, with a mailer that holds its sends. */
export async function until(f: () => boolean, turns = 200): Promise<void> {
  for (let i = 0; i < turns && !f(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
  if (!f()) throw new Error('the condition never held');
}

/** A context of its own (connection and address key) for `who`. */
export function ctxFor(s: { clock: Clock }, who: string, over: Partial<RequestContext> = {}): RequestContext {
  return ctxOf(s.clock, { connection: `conn-${who}`, guestSession: null, addressKey: addressFor(who), ...over });
}

/** Registers `name`, with `email` when given (its verification mail goes out). */
export async function registerWith(s: MailSetup, name: string, email?: string): Promise<SignedIn> {
  const ctx = ctxFor(s, `register ${name}`);
  const r = value(inRow('register', await s.service.register(ctx, { name, password: PW, birth: BIRTH, claimGuest: false, ...(email !== undefined ? { email } : {}) })));
  await s.idle();
  return r;
}

/** Registers `name` with `email` and verifies it with the code from the mail. */
export async function registerVerified(s: MailSetup & { mailer: RecordingMailer }, name: string, email: string): Promise<SignedIn> {
  const r = await registerWith(s, name, email);
  const mail = s.mailer.sent.filter((m) => m.meta.account === r.auth.account && m.meta.kind === 'verify').at(-1);
  value(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, `register ${name}`), r.auth, codeOf(mail))));
  return r;
}

/** The setup with a RecordingMailer, typed as such. */
export function recordingSetup(o: Omit<MailSetupOptions, 'mailer'> & { kind?: string } = {}): MailSetup & { mailer: RecordingMailer } {
  const mailer = new RecordingMailer(o.kind ?? 'test');
  return mailSetup({ ...o, mailer }) as MailSetup & { mailer: RecordingMailer };
}

/** Flushes the audit queue (the service's tick does) and reads the account's events, or every event. */
export async function auditOf(s: MailSetup, account?: AccountId) {
  await s.service.tick(s.clock.now());
  return s.store.audit({ ...(account !== undefined ? { account } : {}), limit: 10_000 });
}
