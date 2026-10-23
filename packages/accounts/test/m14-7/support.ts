/**
 * Shared fixtures of the M14-7 tests (owner rule: in process, a fake clock, fixed inputs). The service of the M14-5 fixtures (the memory store, or a
 * file store under a temporary ACCOUNTS_DATA_DIR; the real name rules, credential tools and a fast hasher) with the real rights part, a fake email
 * part that records the notices it is asked to send, fake data holders whose answers are scripted, and a fake mailer: either one that only records
 * `forget`, or one that files each message under `mail/<account>/` as FileMailer does (M14-8's, not built on this branch), so the erasure's byte
 * search can find what it leaves.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  createCredentialTools, createListNameFilter, createMemoryAccountStore, createNameRules, createRightsPart, FILE_STORE_FILES,
  type AccountDataHolder, type AccountId, type AccountStore, type CreateEmailPart, type Mailer, type NoticeKind, type PartDeps, type PlayerRef,
  type RightsPart,
} from '@openmtg/accounts';
import { buildNoVerifier } from '../../src/abuse/work';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { buildAccountService } from '../../src/service/core';
import { placeOf, placesInTables } from '../m14-4/contract';
import { Clock, configOf, equal, FakeGuests, fastDerive, fixedRandom, spyHasher, type LogLine, type Setup } from '../m14-5/support';

export * from '../m14-5/support';

/** A data holder whose erase answers are scripted, call by call ('ok' once the script is used up); every call recorded. */
export class FakeHolder implements AccountDataHolder {
  readonly exports: PlayerRef[] = [];
  readonly erases: PlayerRef[] = [];
  private gate: Promise<void> | null = null;
  constructor(readonly name: string, readonly script: ('ok' | 'fail' | 'pending')[] = [], readonly section: unknown = { games: [] }) {}
  /** Makes the next erase calls wait until the returned function is called (a fixed interleaving, never a timer). */
  hold(): () => void {
    let open!: () => void;
    this.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return () => {
      this.gate = null;
      open();
    };
  }
  async exportFor(ref: PlayerRef): Promise<unknown> {
    this.exports.push(structuredClone(ref));
    return this.section;
  }
  async erase(ref: PlayerRef): Promise<{ removed: number; anonymised: number; pending?: boolean }> {
    this.erases.push(structuredClone(ref));
    if (this.gate !== null) await this.gate;
    const next = this.script.shift() ?? 'ok';
    if (next === 'fail') throw new Error('the holder failed');
    if (next === 'pending') return { removed: 0, anonymised: 0, pending: true };
    return { removed: 1, anonymised: 2 };
  }
}

/**
 * A mailer standing in for FileMailer (3.4): each message a file under `<dir>/<account>/`, `forget(account)` deletes that folder, every call
 * recorded. With no `dir` it files nothing and only records.
 */
export class FakeMailer implements Mailer {
  readonly kind = 'file';
  readonly sent: { to: string; account: AccountId; kind: string }[] = [];
  readonly forgot: (AccountId | null)[] = [];
  private n = 0;
  constructor(readonly dir: string | null = null) {}
  async send(to: string, message: { subject: string; text: string }, meta: { account: AccountId; kind: 'verify' | 'reset' | 'notice'; expiresAt: string | null }) {
    this.sent.push({ to, account: meta.account, kind: meta.kind });
    if (this.dir === null) return;
    const folder = join(this.dir, meta.account);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(join(folder, `${++this.n}.txt`), `To: ${to}\nSubject: ${message.subject}\n\n${message.text}\n`, { mode: 0o600 });
  }
  async forget(account: AccountId | null): Promise<number> {
    this.forgot.push(account);
    if (this.dir === null || account === null) return 0;
    rmSync(join(this.dir, account), { recursive: true, force: true });
    return 1;
  }
}

export interface RightsSetup extends Setup {
  mailer: FakeMailer;
  /** Every notice the email part was asked to send (PartDeps.notify). */
  notices: { account: AccountId; kind: NoticeKind }[];
  /** The rights part itself (the part the service was given). */
  rights: () => RightsPart;
}

export interface RightsSetupOptions {
  env?: Record<string, string>;
  store?: AccountStore;
  clock?: Clock;
  mailer?: FakeMailer;
  seed?: string;
}

/** The service with the real rights part and a fake email part (notices recorded, the other email calls answer notYet). */
export function rightsSetup(o: RightsSetupOptions = {}): RightsSetup {
  const clock = o.clock ?? new Clock();
  const config = configOf({ CAPTCHA: 'none', ...o.env });
  const random = fixedRandom(o.seed ?? 'm14-7');
  const store = o.store ?? createMemoryAccountStore({ emailResetLiveCodes: config.limits.emailResetLiveCodes });
  const hasher = spyHasher(
    buildPasswordHasher(
      { scrypt: config.scrypt, concurrency: config.hashConcurrency, queue: config.hashQueue, peppers: config.peppers, random, equal },
      { derive: fastDerive, sleep: async () => undefined },
    ),
  );
  const credentials = createCredentialTools({ random, equal, peppers: config.peppers, passwordMin: config.passwordMin });
  const names = createNameRules({ reservedNamesText: null });
  const nameFilter = createListNameFilter(null, names);
  const verifier = buildNoVerifier();
  const guests = new FakeGuests();
  const log: LogLine[] = [];
  const mailer = o.mailer ?? new FakeMailer();
  const notices: RightsSetup['notices'] = [];
  const partDeps: { current: PartDeps | null } = { current: null };
  let part: RightsPart | null = null;
  const rights = (deps: PartDeps): RightsPart => {
    partDeps.current = deps;
    part = createRightsPart!(deps);
    return part;
  };
  const notYet = async () => ({ ok: false as const, error: { code: 'notYet' as const, message: 'fake' } });
  const email: CreateEmailPart = () => ({
    setEmail: notYet, verifyEmail: notYet, requestEmailReset: notYet, useEmailReset: notYet,
    async notify(account, kind) {
      notices.push({ account, kind });
    },
    tick: async () => ({ mailFilesRemoved: 0 }),
  });
  const service = buildAccountService({
    store, config, hasher, credentials, providers: [], names, nameFilter, verifier, mailer, guests,
    log: { event: (name, fields) => log.push({ name, fields }) }, random, now: clock.now, parts: { rights, email },
  });
  return {
    service, store, clock, guests, hasher, log, config, names, verifier, partDeps, mailer, notices,
    rights: () => {
      if (part === null) throw new Error('the rights part was not built');
      return part;
    },
  };
}

/** Waits until `cond` holds, letting the event loop run between looks (a fixed handshake, never a timer). */
export async function until(cond: () => boolean): Promise<void> {
  while (!cond()) await new Promise<void>((resolve) => setImmediate(resolve));
}

const CONSONANTS = 'bcdfghjkmnpqrstvwxz';
/** The n-th of up to 361 distinct valid names: "Player" and two consonants (no digit or vowel for the name key or the word filter to fold). */
export function playerName(n: number): string {
  return `Player${CONSONANTS[Math.floor(n / CONSONANTS.length)]}${CONSONANTS[n % CONSONANTS.length]}`;
}

/** Sets a verified (or unverified) email on an account directly in the store (the email part is a fake here). */
export async function setEmail(s: Setup, id: AccountId, address: string, verified = true): Promise<void> {
  const a = (await s.store.account(id))!;
  await s.store.updateAccount(id, a.version, { email: { address, verifiedAt: verified ? s.clock.now().toISOString() : null } });
}

/** Every file under `dir`, as relative paths. */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p).map((f) => join(e.name, f)));
    else out.push(e.name);
  }
  return out;
}

/**
 * The byte search of ACCOUNTS_DATA_DIR (as M14-4's file-store test does it): every place `needle` occurs in a file under `dir`. A hit in the file
 * store's snapshot or journal is placed under the table of the row it is in (placeOf); a hit in any other file is `file:<relative path>`.
 */
export function placesInDir(dir: string, needle: string): string[] {
  const bytes = Buffer.from(needle, 'utf8');
  const out: string[] = [];
  for (const f of filesUnder(dir)) {
    const buf = readFileSync(join(dir, f));
    if (!buf.includes(bytes)) continue;
    let found: string[] = [];
    if (f === FILE_STORE_FILES.snapshot) {
      found = placesInTables((JSON.parse(buf.toString('utf8')) as { tables: Record<string, [string, unknown][]> }).tables, needle);
    } else if (f === FILE_STORE_FILES.journal) {
      for (const line of buf.toString('utf8').split('\n').filter((l) => l !== '')) {
        for (const m of (JSON.parse(line) as { m: { t: string; k: string; v: unknown }[] }).m) {
          if (JSON.stringify(m).includes(needle)) found.push(m.v === null ? `journal-delete:${m.t}` : placeOf(m.t, m.v, needle));
        }
      }
    }
    out.push(...(found.length > 0 ? found : [`file:${relative(dir, join(dir, f))}`]));
  }
  return out;
}

/** A sanction row written straight to the store (the moderation part, M14-6, is not on this branch). */
export async function sanctionOn(
  s: Setup, account: AccountId, n: number, kind: 'warn' | 'mute' | 'suspend' | 'ban', untilMs: number | null, over: Record<string, unknown> = {},
): Promise<string> {
  const id = `san_01J00000000000000000${String(n).padStart(6, '0')}`;
  const now = s.clock.now().toISOString();
  await s.store.putSanction({
    id, account, kind, reason: 'chat', message: 'Please keep the chat friendly.', note: 'internal: seen in three games', since: now,
    until: untilMs === null ? null : new Date(s.clock.t + untilMs).toISOString(), endedAt: null, endReason: null, endedBy: null, createdAt: now,
    createdBy: 'admin:Moderator Max', reports: [], seenAt: null, ...over,
  });
  return id;
}
