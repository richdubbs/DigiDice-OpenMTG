/**
 * M14-3: the scrypt password hasher (design 4.1, D5) in its priority pool (./pool.ts). Server only.
 *
 * - **scrypt** from node:crypto, the asynchronous call (libuv's thread pool, never the event loop), with the configured N = 2^ln, r and p
 *   (SCRYPT_LN: 17, 8, 1 by default, or 16, 8, 2), a 16-byte random salt, a 32-byte key and maxmem 256 MiB.
 *   Measured by M14-3 on 2026-10-21 (Node 22.22, a shared 2.1 GHz Xeon cloud machine, 4 vCPUs): N = 2^17, r = 8, p = 1 took 390-445 ms a hash,
 *   two at once 475 ms; N = 2^16, r = 8, p = 2 took 350-375 ms. Under the 500 ms mark of 4.1, so the default stays at 2^17.
 * - **The input** is the password after NFKC, as UTF-8; with a pepper (PASSWORD_PEPPERS, newest last) it is HMAC-SHA256(pepper secret, that
 *   UTF-8) and the PHC string names the pepper (`k=<id>`). New hashes use the newest pepper, or none when the list is empty.
 * - **verify** recomputes with the string's own parameters and compares with the one injected comparison (`opts.equal`). `needsRehash` is true
 *   only for a right password whose string has other parameters, another pepper (or none while one is configured, or one while none is), or another
 *   salt or key size than new hashes get; the service then rehashes by compare-and-set (putCredential with expectSecret, 11.2).
 * - **The same work for every failure**: a string that does not parse, or names a pepper that is no longer configured (a lost pepper: those passwords
 *   are unusable, 4.1), is answered `ok: false` after a derivation and a comparison against the dummy, exactly what `dummy` does for an unknown name:
 *   NFKC, the newest pepper's HMAC, scrypt with the current parameters, one comparison. The dummy is a random salt and key made at start (a fixed
 *   dummy for the process's life), so no scrypt runs at start.
 * - **The same time for every failure, across parameter sets** (review of M14-3): after the operator switches SCRYPT_LN, an account that has not
 *   signed in since keeps a string with the old parameters, and its failing verify takes another time than the dummy (about 40 ms between the two
 *   supported settings), which would tell an account's name from a held, banned or hidden one (7.3, 8.2 rule 6). So the hasher keeps a moving
 *   average of the derivation's time per parameter set, and every failure (a wrong password, the dummy, a string it cannot use) answers no sooner
 *   than the slowest of those averages after its derivation began: the derivation, then a timer for the rest (outside the pool, so no worker
 *   waits). The wait is at most PAD_FACTOR_MAX times the current parameters' average, so one corrupt string of costly parameters cannot slow every
 *   failure down. A parameter set is known only once one derivation with it finished in this process, so the first failure for a stale string
 *   after a start is not padded to it (one sample); a right password is never padded.
 * - Each hash, verify and dummy is one job of the pool, in the caller's class; HasherBusyError when the queue has no room for it.
 * - Only a string of at most ACCOUNT_LIMITS.passwordRawMax UTF-16 units is a password here: `hash` refuses anything else (TypeError), `verify`
 *   answers it `ok: false` after the dummy's work, so no megabyte of text is ever normalized and no credential is made for a non-string.
 */
import { createHmac, scrypt } from 'node:crypto';
import type { HashPriority, PasswordHasher, PasswordHasherOptions, Pepper } from './api';
import { ACCOUNT_LIMITS } from '../api/limits';
import { formatScryptPhc, KEY_BYTES, parseScryptPhc, PEPPER_ID, SALT_BYTES, SCRYPT_MAXMEM, scryptParamsOk, type ScryptParams } from './phc';
import { createHashPool, type HashPoolLoad } from './pool';

/** The key derivation: scrypt by default. Tests pass a fake to drive the pool and count the work. */
export type Derive = (input: Uint8Array, salt: Uint8Array, params: ScryptParams, keyLength: number) => Promise<Uint8Array>;

export const scryptDerive: Derive = (input, salt, params, keyLength) =>
  new Promise((resolve, reject) => {
    scrypt(input, salt, keyLength, { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(new Uint8Array(key.buffer, key.byteOffset, key.byteLength));
    });
  });

/** What tests may replace; createPasswordHasher uses the defaults. */
export interface HasherInternals {
  derive?: Derive;
  /** Milliseconds, for the duration estimates behind retryAfterMs and the failures' padding (performance.now by default). */
  now?: () => number;
  /** Waits this many milliseconds (a timer by default): the padding of a failure. */
  sleep?: (ms: number) => Promise<void>;
}

/** The time a hash is assumed to take before one was measured (4.1: about 300 ms). */
const INITIAL_HASH_MS = 300;
/** A failure waits for at most this many times the current parameters' average derivation (the header). */
export const PAD_FACTOR_MAX = 2;
/** The weight of a new measurement in the moving averages. */
const AVERAGE_WEIGHT = 0.2;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const paramsKey = (p: ScryptParams): string => `${p.ln},${p.r},${p.p}`;
/** The bounds of a retryAfterMs answer. */
const RETRY_MIN_MS = 250;
const RETRY_MAX_MS = 60_000;

const utf8 = new TextEncoder();

function checkOptions(opts: PasswordHasherOptions): void {
  if (!scryptParamsOk(opts.scrypt)) throw new RangeError('the scrypt parameters are outside what the hasher accepts');
  if (typeof opts.random !== 'function' || typeof opts.equal !== 'function') throw new TypeError('the hasher needs random and equal');
  const ids = new Set<string>();
  for (const p of opts.peppers) {
    if (!PEPPER_ID.test(p.id) || ids.has(p.id) || typeof p.secret !== 'string' || p.secret.length === 0) {
      throw new RangeError('PASSWORD_PEPPERS: an id is malformed or used twice, or a secret is empty');
    }
    ids.add(p.id);
  }
}

function randomBytesOf(random: (n: number) => Uint8Array, n: number): Uint8Array {
  const b = random(n);
  if (!(b instanceof Uint8Array) || b.length < n) throw new RangeError(`the random source gave ${b?.length ?? 0} bytes, not ${n}`);
  return b.slice(0, n);
}

/** The scrypt input for a password and a pepper (or none). */
function inputOf(password: string, pepper: Pepper | null): Uint8Array {
  const bytes = utf8.encode(password.normalize('NFKC'));
  if (pepper === null) return bytes;
  return new Uint8Array(createHmac('sha256', pepper.secret).update(bytes).digest());
}

/** The hasher, with the parts tests replace. */
export function buildPasswordHasher(opts: PasswordHasherOptions, internals: HasherInternals = {}): PasswordHasher {
  checkOptions(opts);
  const derive = internals.derive ?? scryptDerive;
  const now = internals.now ?? (() => performance.now());
  const params: ScryptParams = { ln: opts.scrypt.ln, r: opts.scrypt.r, p: opts.scrypt.p };
  const peppers = opts.peppers.map((p) => ({ id: p.id, secret: p.secret }));
  const current: Pepper | null = peppers.length > 0 ? peppers[peppers.length - 1]! : null;
  const dummySalt = randomBytesOf(opts.random, SALT_BYTES);
  const dummyKey = randomBytesOf(opts.random, KEY_BYTES);

  let hashMs = INITIAL_HASH_MS;
  const retryAfterMs = (load: HashPoolLoad): number => {
    const ahead = load.running + load.queued.high + load.queued.normal + load.queued.low;
    return Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, Math.ceil((hashMs * (ahead + 1)) / opts.concurrency)));
  };
  const pool = createHashPool({ concurrency: opts.concurrency, queue: opts.queue, retryAfterMs });

  const sleep = internals.sleep ?? realSleep;
  /** Per parameter set (paramsKey), the moving average of a derivation's milliseconds, from the first one measured. */
  const averages = new Map<string, number>();
  const currentKey = paramsKey(params);

  /** One timed derivation: the key, when it began, and the moving averages updated. */
  async function timed(input: Uint8Array, salt: Uint8Array, p: ScryptParams, keyLength: number): Promise<{ key: Uint8Array; began: number }> {
    const began = now();
    const key = await derive(input, salt, p, keyLength);
    const ms = now() - began;
    if (Number.isFinite(ms) && ms >= 0) {
      hashMs = (1 - AVERAGE_WEIGHT) * hashMs + AVERAGE_WEIGHT * ms;
      const k = paramsKey(p);
      const before = averages.get(k);
      averages.set(k, before === undefined ? ms : (1 - AVERAGE_WEIGHT) * before + AVERAGE_WEIGHT * ms);
    }
    return { key, began };
  }

  /** How long a failure takes at least, from its derivation's start: the slowest average, capped (the header). */
  function failureFloor(): number {
    let slowest = 0;
    for (const ms of averages.values()) slowest = Math.max(slowest, ms);
    const base = averages.get(currentKey) ?? hashMs;
    return Math.min(slowest, PAD_FACTOR_MAX * base);
  }

  /** Waits out the rest of the failure floor for a failure whose derivation began at `began`. */
  async function padFailure(began: number): Promise<void> {
    const rest = Math.round(failureFloor() - (now() - began));
    if (Number.isFinite(rest) && rest >= 1) await sleep(rest);
  }

  /** The dummy's work: what verify does for a current-parameter string, against the dummy key. Returns when its derivation began. */
  async function dummyWork(password: string): Promise<number> {
    const { key, began } = await timed(inputOf(password, current), dummySalt, params, KEY_BYTES);
    opts.equal(key, dummyKey);
    return began;
  }

  const priorityOf = (o: { priority: HashPriority } | undefined): HashPriority => o?.priority ?? 'low';
  /** A password the policy could have let through: a string of at most ACCOUNT_LIMITS.passwordRawMax UTF-16 units. */
  const usable = (password: unknown): password is string => typeof password === 'string' && password.length <= ACCOUNT_LIMITS.passwordRawMax;

  return {
    hash(password, o) {
      // never a credential for something the policy refuses before it looks at the text (the service checks the policy first)
      if (!usable(password)) return Promise.reject(new TypeError('the password to hash must be a string of at most 512 UTF-16 units'));
      const pw = password;
      return pool.run(priorityOf(o), async () => {
        const salt = randomBytesOf(opts.random, SALT_BYTES);
        const { key: hash } = await timed(inputOf(pw, current), salt, params, KEY_BYTES);
        return formatScryptPhc({ params, pepper: current?.id ?? null, salt, hash });
      });
    },
    async verify(phc, password, o) {
      // a password no hash can hold (not a string, or longer than any the policy allows) is wrong, after the same work as any other
      const pw = usable(password) ? password : null;
      const { answer, began } = await pool.run(priorityOf(o), async () => {
        const parsed = parseScryptPhc(phc);
        const pepper = parsed?.pepper == null ? null : peppers.find((p) => p.id === parsed.pepper) ?? undefined;
        if (pw === null || parsed === null || pepper === undefined) {
          return { answer: { ok: false, needsRehash: false }, began: await dummyWork(pw ?? '') };
        }
        const derived = await timed(inputOf(pw, pepper), parsed.salt, parsed.params, parsed.hash.length);
        const ok = opts.equal(derived.key, parsed.hash);
        const stale =
          parsed.params.ln !== params.ln || parsed.params.r !== params.r || parsed.params.p !== params.p ||
          parsed.pepper !== (current?.id ?? null) || parsed.salt.length !== SALT_BYTES || parsed.hash.length !== KEY_BYTES;
        return { answer: { ok, needsRehash: ok && stale }, began: derived.began };
      });
      if (!answer.ok) await padFailure(began);
      return answer;
    },
    async dummy(password, o) {
      const pw = usable(password) ? password : '';
      await padFailure(await pool.run(priorityOf(o), () => dummyWork(pw)));
    },
    load: () => pool.load(),
  };
}

