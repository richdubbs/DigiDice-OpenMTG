/**
 * M14-5: the human checks of design 8.4. `WorkVerifier` (kind 'work', the default) is a SHA-256 proof of work with no third party, node:crypto
 * only; `NoVerifier` (kind 'none', CAPTCHA=none) is for tests and development.
 *
 * A challenge is a string the server signs, of base64url characters only (so it fits WORK_ANSWER, `<challenge>:<nonce>`):
 *   base64url(payload) + base64url(first 16 bytes of HMAC-SHA256(key, base64url(payload)))
 * where the payload is: version 1 (1 byte), 16 random bytes, the difficulty in bits (1 byte), the expiry in milliseconds since 1970 (8 bytes, big
 * endian), the action (1 byte: register 1, signIn 2, recover 3), the scope's length (1 byte) and the scope (UTF-8, at most 64 bytes: a tag of the
 * name key, or 'register'). The key is 32 random bytes made at start; it lives only in memory, so a restart only invalidates the challenges then
 * outstanding (the client asks again).
 *
 * The client finds a `nonce` of 1-16 decimal digits such that SHA-256(challenge + ":" + nonce) starts with `bits` zero bits, and sends
 * `captcha: "<challenge>:<nonce>"`. `verify` checks the shape, the tag (in constant time), the version, the expiry, the action and the scope, that
 * the challenge asks at least the bits the attempt needs, the zero bits, and one use: a spent challenge is kept until it expires.
 *
 * **The spent set** (review A1, M14-15) holds at most SPENT_MAX challenges (counterEntries, as every map of 8.2 rule 6). Each is kept until a
 * moment no earlier than its own expiry and no earlier than the one kept before it, so the set is in time order: a verification drops the expired
 * ones from the front and stops at the first live one, and never looks at more than it drops plus one. A set full of live challenges refuses a new
 * solution as 'unavailable' (the service then answers captchaRequired with a fresh challenge) instead of forgetting a live one, which could then be
 * spent again: fail closed, like rule 6. The service limits how often one address key gets here (register looks at its allowance first).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ACCOUNT_LIMITS } from '../api/limits';
import { ACCOUNT_RATE_LIMITS, WORK_ANSWER, type WorkChallenge } from '../api';
import type { HumanVerifier, VerifyAction } from './api';

const VERSION = 1;
const TAG_BYTES = 16;
const TAG_CHARS = 22;
const SCOPE_MAX = 64;
const ACTIONS: readonly VerifyAction[] = ['register', 'signIn', 'recover'];
/** Spent challenges kept at most (see the header): the counterEntries of 8.2 rule 6. */
export const SPENT_MAX = ACCOUNT_RATE_LIMITS.counterEntries;

const b64url = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

/** The number of leading zero bits of `b`. */
export function leadingZeroBits(b: Uint8Array): number {
  let n = 0;
  for (const x of b) {
    if (x === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(x) - 24;
  }
  return n;
}

/** SHA-256(challenge + ":" + nonce): the hash a solution must start with `bits` zero bits of. */
export function workHash(challenge: string, nonce: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`${challenge}:${nonce}`, 'utf8').digest());
}

interface Parsed { random: string; bits: number; expiresAt: number; action: VerifyAction; scope: string }

function parsePayload(bytes: Uint8Array): Parsed | null {
  if (bytes.length < 1 + 16 + 1 + 8 + 1 + 1 || bytes[0] !== VERSION) return null;
  const random = Buffer.from(bytes.subarray(1, 17)).toString('hex');
  const bits = bytes[17]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expiresAt = Number(view.getBigUint64(18));
  const action = ACTIONS[bytes[26]! - 1];
  const len = bytes[27]!;
  if (action === undefined || bytes.length !== 28 + len) return null;
  const scope = Buffer.from(bytes.subarray(28)).toString('utf8');
  return { random, bits, expiresAt, action, scope };
}

/** The work verifier as built: HumanVerifier, and what its spent set holds and has looked at (tests count the work, review A1). */
export interface BuiltWorkVerifier extends HumanVerifier {
  /** Spent challenges held now. */
  readonly held: number;
  /** Entries of the spent set looked at by every verification so far. */
  readonly examined: number;
}

export function buildWorkVerifier(opts: { random: (n: number) => Uint8Array; challengeMs: number; spentMax?: number }): BuiltWorkVerifier {
  const key = opts.random(32);
  if (!(key instanceof Uint8Array) || key.length < 32) throw new RangeError('the work verifier needs 32 random bytes for its key');
  const hmacKey = Buffer.from(key.slice(0, 32));
  const spentMax = opts.spentMax ?? SPENT_MAX;
  /** Spent challenges (by their random part) and the moment each may be forgotten, in time order (see the header). */
  const spent = new Map<string, number>();
  let last = 0;
  let examined = 0;

  const tagOf = (payload: string): string => b64url(createHmac('sha256', hmacKey).update(payload, 'utf8').digest().subarray(0, TAG_BYTES));

  /** Drops the spent challenges whose moment has come, from the front, stopping at the first that is still kept. */
  function pruneSpent(now: number): void {
    for (const [k, until] of spent) {
      examined++;
      if (until > now) return;
      spent.delete(k);
    }
  }

  return {
    get held() {
      return spent.size;
    },
    get examined() {
      return examined;
    },
    kind: 'work',
    siteKey: null,
    challenge(ctx, now): WorkChallenge {
      const scope = Buffer.from(String(ctx.scope), 'utf8');
      if (scope.length > SCOPE_MAX) throw new RangeError('a work challenge scope is at most 64 bytes');
      const bits = Math.trunc(ctx.bits);
      if (!(bits >= 1 && bits <= 32)) throw new RangeError('a work challenge asks 1-32 bits');
      const action = ACTIONS.indexOf(ctx.action);
      if (action < 0) throw new RangeError('unknown work action');
      const expiresAt = now.getTime() + opts.challengeMs;
      const rand = opts.random(16);
      if (!(rand instanceof Uint8Array) || rand.length < 16) throw new RangeError('the random source gave too few bytes');
      const payload = new Uint8Array(28 + scope.length);
      payload[0] = VERSION;
      payload.set(rand.subarray(0, 16), 1);
      payload[17] = bits;
      new DataView(payload.buffer).setBigUint64(18, BigInt(expiresAt));
      payload[26] = action + 1;
      payload[27] = scope.length;
      payload.set(scope, 28);
      const body = b64url(payload);
      return { kind: 'work', challenge: body + tagOf(body), bits, expiresAt: new Date(expiresAt).toISOString() };
    },
    async verify(token, ctx, now) {
      const invalid = { ok: false as const, reason: 'invalid' as const };
      if (typeof token !== 'string' || token.length > ACCOUNT_LIMITS.captchaTokenMax || !WORK_ANSWER.test(token)) return invalid;
      const colon = token.lastIndexOf(':');
      const challenge = token.slice(0, colon);
      const nonce = token.slice(colon + 1);
      if (challenge.length <= TAG_CHARS) return invalid;
      const body = challenge.slice(0, -TAG_CHARS);
      const tag = Buffer.from(challenge.slice(-TAG_CHARS), 'base64url');
      const want = Buffer.from(tagOf(body), 'base64url');
      if (tag.length !== want.length || !timingSafeEqual(tag, want)) return invalid;
      const p = parsePayload(new Uint8Array(Buffer.from(body, 'base64url')));
      const t = now.getTime();
      if (p === null || p.expiresAt <= t || p.action !== ctx.action || p.scope !== ctx.scope || p.bits < ctx.bits) return invalid;
      if (leadingZeroBits(workHash(challenge, nonce)) < p.bits) return invalid;
      pruneSpent(t);
      if (spent.has(p.random)) return invalid;
      if (spent.size >= spentMax) return { ok: false, reason: 'unavailable' };
      // kept until its expiry, and never before the one kept before it: the set stays in time order (see the header)
      last = Math.max(last, p.expiresAt);
      spent.set(p.random, last);
      return { ok: true };
    },
  };
}

/** CAPTCHA=none (tests and development only): never asks for anything, accepts everything. */
export function buildNoVerifier(): HumanVerifier {
  return {
    kind: 'none',
    siteKey: null,
    challenge: () => null,
    verify: async () => ({ ok: true }),
  };
}
