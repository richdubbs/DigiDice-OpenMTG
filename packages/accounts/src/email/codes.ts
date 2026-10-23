/**
 * M14-8: email codes (design 3.4, 5.1). Server only (`node:crypto`).
 *
 * - **The code**: ACCOUNT_LIMITS.emailCodeLength (10) Crockford base32 characters, 50 random bits, mailed as two groups of five ("7KQ2M-9XD4T").
 *   Typed, case, white space and dashes are ignored and the look-alikes of recovery codes are mapped (O reads as 0, I and L as 1).
 * - **Stored** only as a hash of "openmtg/email-code/v1\n" + purpose + "\n" + account + "\n" + address + "\n" + code: bound to the account (a
 *   stored hash is useless for any other account) and to the address the code was mailed to (a verification code for an old address never verifies
 *   a new one, and a reset code dies with the address it went to). The hash is SHA-256 without a pepper, and with PASSWORD_PEPPERS (config.peppers)
 *   HMAC-SHA256 under a key derived from the newest pepper (`emailCodeKeys`), so that a copy of the database alone no longer lets anyone search a
 *   live code's 50 bits within its 15 minutes (12.1; review of M14-8). A pepper changes only with a restart, and every try is compared under every
 *   configured pepper: a rotation that keeps the old pepper (as it must, for the passwords hashed under it, 4.1) voids no live code. A code made
 *   under a pepper that is no longer configured, or before the first one was set, matches nothing: it would have died within 15 minutes anyway,
 *   its owner asks for another, and until it expires it still counts against the cap of live codes.
 * - **Checked** against every candidate with the one injected comparison (CredentialTools.equal, through PartDeps.equal; node:crypto's
 *   timingSafeEqual on a PartDeps without it) and no early exit, over a fixed number of slots padded with dummy hashes and under every key, so the
 *   work does not depend on how many codes are live or which one matched: slots times the number of peppers (at least one) comparisons a try.
 * - **The target key** of a verification mail (8.1: 3 a day per target address): the address lower-cased and without a "+tag", so case and tags
 *   cannot multiply one inbox's allowance; for gmail.com (and googlemail.com, the same mailboxes) also without the dots of the local part, which
 *   Gmail ignores. Merging keys only makes the limit stricter. The rate limiter keeps it only under its keyed hash (src/abuse/limiter.ts).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ACCOUNT_LIMITS } from '../api/limits';
import { RECOVERY_ALPHABET } from '../api/passwords';
import type { EmailCodeRow } from '../store/api';

/** The most UTF-16 units a typed code may have before any work (the code with dashes and spaces around it). */
export const EMAIL_CODE_RAW_MAX = 32;

const CODE_BITS = 5 * ACCOUNT_LIMITS.emailCodeLength;
const CODE_BYTES = Math.ceil(CODE_BITS / 8);

/** A new code from the random source: the top 50 bits of 7 bytes. */
export function newEmailCode(random: (n: number) => Uint8Array): string {
  const b = random(CODE_BYTES);
  if (!(b instanceof Uint8Array) || b.length < CODE_BYTES) throw new RangeError(`the random source gave ${b?.length ?? 0} bytes, not ${CODE_BYTES}`);
  let n = 0n;
  for (let i = 0; i < CODE_BYTES; i++) n = (n << 8n) | BigInt(b[i]!);
  n >>= BigInt(8 * CODE_BYTES - CODE_BITS);
  let out = '';
  for (let i = 0; i < ACCOUNT_LIMITS.emailCodeLength; i++) {
    out = RECOVERY_ALPHABET[Number(n & 31n)]! + out;
    n >>= 5n;
  }
  return out;
}

/** A typed code in its canonical form (10 characters of the alphabet), or null. */
export function normalizeEmailCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > EMAIL_CODE_RAW_MAX) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== ACCOUNT_LIMITS.emailCodeLength) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}

/** As the mail shows it: two groups of five. */
export function formatEmailCode(code: string): string {
  const half = ACCOUNT_LIMITS.emailCodeLength / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** A secret comparison: constant time on equal lengths (CredentialTools.equal). */
export type SecretEqual = (a: Uint8Array, b: Uint8Array) => boolean;

/** node:crypto's comparison, for a part built on PartDeps without `equal` (false at once for different lengths, which are never secret here). */
const sameBytes: SecretEqual = (a, b) => a.length === b.length && timingSafeEqual(a, b);

/**
 * The keys codes are hashed under: one per configured pepper, newest first, each HMAC-SHA256(pepper, "openmtg/email-code/key/v1"), a key of its
 * own apart from the password hasher's HMAC under the pepper itself (4.1); [] without peppers (plain SHA-256).
 */
export function emailCodeKeys(peppers: readonly { id: string; secret: string }[]): Buffer[] {
  return [...peppers].reverse().map((p) => createHmac('sha256', p.secret).update('openmtg/email-code/key/v1', 'utf8').digest());
}

/** The stored hash of a code (hex): SHA-256, or HMAC-SHA256 under `key` (one of emailCodeKeys). */
export function emailCodeHash(purpose: EmailCodeRow['purpose'], account: string, address: string, code: string, key: Uint8Array | null = null): string {
  const text = `openmtg/email-code/v1\n${purpose}\n${account}\n${address}\n${code}`;
  return (key === null ? createHash('sha256') : createHmac('sha256', key)).update(text, 'utf8').digest('hex');
}

const dummies = new Map<number, Buffer>();
/** A hash no code gives, for the padding slots (a SHA-256 of other text: no input of emailCodeHash's shape makes it). */
function dummyHash(slot: number): Buffer {
  let d = dummies.get(slot);
  if (d === undefined) dummies.set(slot, (d = createHash('sha256').update(`openmtg/email-code/dummy\n${slot}`, 'utf8').digest()));
  return d;
}

function hexBytes(hex: string): Buffer {
  // a damaged stored hash is compared like any other and matches nothing
  return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : Buffer.alloc(32);
}

/**
 * The candidate whose hash is one of `wants` (the typed code under each key), or null: every candidate compared with `equal` against every want
 * whatever matched before, then as many dummy slots as it takes to make `slots` rows in all (more candidates than slots are all compared).
 */
export function matchEmailCode<T extends Pick<EmailCodeRow, 'hash'>>(
  candidates: readonly T[], wants: readonly string[], slots: number, equal: SecretEqual = sameBytes,
): T | null {
  const ws = wants.map(hexBytes);
  let found: T | null = null;
  for (const c of candidates) {
    const h = hexBytes(c.hash);
    for (const w of ws) if (equal(h, w) && found === null) found = c;
  }
  for (let i = candidates.length; i < slots; i++) for (const w of ws) equal(dummyHash(i), w);
  return found;
}

/** The key a verification mail is counted under per target address: lower-cased, without a "+tag", Gmail's without dots (8.1). */
export function emailTargetKey(address: string): string {
  const at = address.lastIndexOf('@');
  let local = address.slice(0, at).toLowerCase();
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  const typedDomain = address.slice(at + 1).toLowerCase();
  const domain = typedDomain === 'googlemail.com' ? 'gmail.com' : typedDomain;
  return `${domain === 'gmail.com' ? local.replace(/\./g, '') : local}@${domain}`;
}

/** The local part of a stored address (the password policy's containsEmail rule, 4.2). */
export function emailLocalPart(address: string): string {
  return address.slice(0, address.lastIndexOf('@'));
}
