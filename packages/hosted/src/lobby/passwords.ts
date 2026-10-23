/**
 * Table passwords (design 4.3, 11; package M13-8): the tables layer's `PasswordHook` on node:crypto's scrypt (no dependency).
 *
 * - **Hash**: scrypt (N = 2^15, r = 8, p = 1 by default: 60 to 100 ms and 32 MiB a derivation, measured on the development machine; `ScryptSettings`
 *   to change it) of the password after NFKC (a password typed on another keyboard or system may arrive as another Unicode form of the same text), with a
 *   random 16-byte salt per table; the hook answers the 32-byte key and the salt as hex, which the tables layer keeps in the `games` row (`passwordHash`,
 *   `passwordSalt`). The settings are not stored with the hash: changing them (a restart with other settings) makes the passwords of tables still waiting
 *   from before fail, and such a table lives minutes.
 * - **Verify**: derives again with the stored salt and compares in constant time. **The same work whatever the answer**: a wrong password, a stored hash
 *   or salt that is not what `hash` makes (a damaged row) and a text no password can be (longer than any a table takes) each cost one derivation and one
 *   comparison, so neither the time nor a throw tells a right password from a wrong one, or a damaged row from a good one.
 * - **Never leaves**: the hook logs nothing and never throws a password: an error carries a name and a fixed text.
 * - **Bounded work** (design 11): at most `concurrency` derivations run at once (libuv's thread pool has 4 threads and the rest of the server
 *   needs some of them) and at most `queue` wait; past that `PasswordBusyError` is thrown (the tables layer answers that join "busy, try again" and the
 *   connection stays open: M13-8 request 11). The gateway's own limits (join attempts 1 a second per session and per address key, ten failures lock both: design 3.6) come before
 *   the hook is asked, so only an attack from many address keys at once gets here.
 *
 * Attempts, lock-outs and strikes are the gateway's (`JoinGuard`), not the hook's: no per-table or global counter that others could use to lock a table.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { checkPassword, HOSTED_LIMITS } from '../api';
import type { PasswordHook } from '../tables/hooks';

export interface ScryptSettings {
  /** N = 2^ln. */
  ln: number;
  r: number;
  p: number;
}

/** The default cost (design 4.3): short-lived, low-value secrets guarded by the join limits; the CPU is what the settings protect. */
export const TABLE_SCRYPT: Readonly<ScryptSettings> = { ln: 15, r: 8, p: 1 };
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_KEY_BYTES = 32;
/**
 * A password of a table has at most `HOSTED_LIMITS.passwordMax` characters; one of 2 UTF-16 units each is the longest text that can be one. The bound
 * is on the NFKC form, which is what is compared: the same password typed in a decomposed form (NFD Hangul is 3 units a syllable) is longer as typed
 * (M13-8 review, finding 3). What is typed is bounded by the frame (`VERIFY_MAX_TYPED_UNITS`), so normalizing it costs little.
 */
const VERIFY_MAX_UNITS = 2 * HOSTED_LIMITS.passwordMax;
/** A typed text longer than this is no password in any form (NFKC never shortens a text by more than about a factor of 3: Hangul jamo). */
const VERIFY_MAX_TYPED_UNITS = 4 * VERIFY_MAX_UNITS;

/** The key derivation (scrypt by default; the tests count calls and make it cheap). */
export type PasswordDerive = (input: Buffer, salt: Buffer, settings: ScryptSettings) => Promise<Buffer>;

export const scryptDerive: PasswordDerive = (input, salt, s) =>
  new Promise((resolve, reject) => {
    // maxmem: scrypt needs 128 * N * r bytes; twice that is headroom (node's own default of 32 MiB is just what N = 2^15, r = 8 needs)
    scrypt(input, salt, PASSWORD_KEY_BYTES, { N: 2 ** s.ln, r: s.r, p: s.p, maxmem: 256 * 2 ** s.ln * s.r }, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** Too many derivations at once (see the header). Its text holds no password. */
export class PasswordBusyError extends Error {
  constructor() {
    super('Too many password checks at once.');
    this.name = 'PasswordBusyError';
  }
}

export interface ScryptPasswordsOptions {
  scrypt?: ScryptSettings;
  /** Derivations at once (default 2). */
  concurrency?: number;
  /** Derivations that may wait for a slot (default 256, more than any burst of the join limits lets through). */
  queue?: number;
  /** Tests: the key derivation, the random source (salts and the dummy values) and the comparison (constant time by default). */
  derive?: PasswordDerive;
  random?: (bytes: number) => Buffer;
  equal?: (a: Buffer, b: Buffer) => boolean;
}

/** `n` bytes from `hex` (lower-case hex digits, exactly `2 * n` of them), or null. */
function bytesOf(hex: unknown, n: number): Buffer | null {
  return typeof hex === 'string' && hex.length === 2 * n && /^[0-9a-f]+$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

/** At most `concurrency` jobs at once; at most `queue` wait, first come first served; the next one gets a finished job's slot at once. */
class Gate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number, private readonly queue: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      if (this.waiting.length >= this.queue) throw new PasswordBusyError();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.running++;
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }

  load(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }
}

export class ScryptPasswords implements PasswordHook {
  private readonly settings: ScryptSettings;
  private readonly derive: PasswordDerive;
  private readonly random: (bytes: number) => Buffer;
  private readonly equal: (a: Buffer, b: Buffer) => boolean;
  private readonly gate: Gate;
  /** What a verify of unusable stored data derives and compares against, so it costs what any other does. */
  private readonly dummySalt: Buffer;
  private readonly dummyKey: Buffer;

  constructor(o: ScryptPasswordsOptions = {}) {
    this.settings = { ...TABLE_SCRYPT, ...o.scrypt };
    const { ln, r, p } = this.settings;
    if (!Number.isInteger(ln) || ln < 4 || ln > 20 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) {
      throw new RangeError('The scrypt settings are outside what the table passwords accept.');
    }
    const concurrency = o.concurrency ?? 2;
    const queue = o.queue ?? 256;
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(queue) || queue < 0) throw new RangeError('The password gate needs a concurrency of 1 or more and a queue of 0 or more.');
    this.derive = o.derive ?? scryptDerive;
    this.random = o.random ?? randomBytes;
    this.equal = o.equal ?? timingSafeEqual;
    this.gate = new Gate(concurrency, queue);
    this.dummySalt = this.random(PASSWORD_SALT_BYTES);
    this.dummyKey = this.random(PASSWORD_KEY_BYTES);
  }

  async hash(password: string): Promise<{ hash: string; salt: string }> {
    // the tables layer checked it already: a password that is not one is a bug in the caller, never a credential made of it
    const checked = checkPassword(password);
    if (!checked.ok) throw new RangeError(`Not a table password (${checked.reason}).`);
    const salt = this.random(PASSWORD_SALT_BYTES);
    const key = await this.derivation(salt, password);
    return { hash: key.toString('hex'), salt: salt.toString('hex') };
  }

  async verify(password: string, hash: string, salt: string): Promise<boolean> {
    const stored = bytesOf(hash, PASSWORD_KEY_BYTES);
    const saltBytes = bytesOf(salt, PASSWORD_SALT_BYTES);
    const plain = typeof password === 'string' && password.length <= VERIFY_MAX_TYPED_UNITS ? password.normalize('NFKC') : null;
    const usable = plain !== null && plain.length <= VERIFY_MAX_UNITS;
    const key = await this.derivation(saltBytes ?? this.dummySalt, usable ? plain : '');
    // both the comparison and the bookkeeping run whatever was wrong; only then are they combined
    const same = this.equal(key, stored ?? this.dummyKey);
    return same && stored !== null && saltBytes !== null && usable;
  }

  /** Derivations running and waiting now (tests, the operator). */
  load(): { running: number; waiting: number } {
    return this.gate.load();
  }

  private derivation(salt: Buffer, password: string): Promise<Buffer> {
    const input = Buffer.from(password.normalize('NFKC'), 'utf8');
    return this.gate.run(() => this.derive(input, salt, this.settings));
  }
}
