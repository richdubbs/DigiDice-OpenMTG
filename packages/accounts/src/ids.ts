/**
 * Ids and secrets on the server (design 11.4, D22). Server only (`node:crypto` for SHA-256).
 *
 * - `newAccountId`, `newDeletedPlayerId` and `newFlowId`: a prefix and 26 Crockford base32 characters filled from 128 random bits (the first character
 *   carries 3 bits, so it is 0-7 and `ULID` still matches). No clock argument, no time part, no monotonic generator: ids made in the same millisecond
 *   share no prefix beyond chance, and the ids of one erasure cannot be grouped. `Account.createdAt` keeps the time.
 * - `newUlid(now, random)` for the ids only the account itself or the operator sees (sessions, reports, sanctions, audit events, email codes): a real
 *   ULID, 48 bits of time and 80 random bits, so their time order serves keyset paging.
 * - `newToken` (32 random bytes as 64 lowercase hex digits) and `tokenHash` (SHA-256, hex): tokens and device proofs are found by their hash.
 * - Every id passed in from outside is checked against its pattern before any lookup (`*_ID` below; each also meets m13's store id rule, `STORE_ID`).
 */
import { createHash } from 'node:crypto';
import type { AccountId, DeletedPlayerId } from './api';

/** The random source every generator takes: `n` bytes (node:crypto's randomBytes in the server, a fixed source in tests). */
export type RandomBytes = (n: number) => Uint8Array;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function bytes(random: RandomBytes, n: number): Uint8Array {
  const b = random(n);
  if (!(b instanceof Uint8Array) || b.length < n) throw new RangeError(`the random source gave ${b?.length ?? 0} bytes, not ${n}`);
  return b;
}

/** `digits` Crockford base32 characters of the big-endian number in `b`, most significant first (the leading bits beyond 8 * b.length are zero). */
function base32(b: Uint8Array, digits: number): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let out = '';
  for (let i = 0; i < digits; i++) {
    out = CROCKFORD[Number(n & 31n)]! + out;
    n >>= 5n;
  }
  return out;
}

/** 26 characters in the ULID shape from 128 random bits: no time part. */
function random128(random: RandomBytes): string {
  return base32(bytes(random, 16).subarray(0, 16), 26);
}

/** An account id: "acc_" + 128 random bits in the ULID shape (D22). */
export function newAccountId(random: RandomBytes): AccountId {
  return `acc_${random128(random)}`;
}

/** An anonymised placement's session (10.2): "del_" + 128 random bits; a fresh one per placement. */
export function newDeletedPlayerId(random: RandomBytes): DeletedPlayerId {
  return `del_${random128(random)}`;
}

/** A provider flow (3.5): "pf_" + 128 random bits. */
export function newFlowId(random: RandomBytes): string {
  return `pf_${random128(random)}`;
}

/** The largest time a ULID holds (48 bits of milliseconds). */
const ULID_TIME_MAX = 2 ** 48 - 1;

/** A ULID: 10 characters of time (milliseconds since 1970, 48 bits) and 16 of randomness (80 bits). */
export function newUlid(now: Date, random: RandomBytes): string {
  const t = now.getTime();
  if (!Number.isSafeInteger(t) || t < 0 || t > ULID_TIME_MAX) throw new RangeError('newUlid: the time is outside a ULID');
  let time = '';
  let x = t;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[x % 32]! + time;
    x = Math.floor(x / 32);
  }
  return time + base32(bytes(random, 10).subarray(0, 10), 16);
}

/** An account session (5.2): "as_" + a ULID. */
export function newSessionId(now: Date, random: RandomBytes): string {
  return `as_${newUlid(now, random)}`;
}
/** A player report (9.2): "rep_" + a ULID. */
export function newReportId(now: Date, random: RandomBytes): string {
  return `rep_${newUlid(now, random)}`;
}
/** A sanction (9.3): "san_" + a ULID. */
export function newSanctionId(now: Date, random: RandomBytes): string {
  return `san_${newUlid(now, random)}`;
}
/** An audit event (8.5): "aud_" + a ULID. */
export function newAuditId(now: Date, random: RandomBytes): string {
  return `aud_${newUlid(now, random)}`;
}
/** An email code (3.4): "ec_" + a ULID. */
export function newEmailCodeId(now: Date, random: RandomBytes): string {
  return `ec_${newUlid(now, random)}`;
}

const SHAPE = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
/** The patterns ids from outside are checked against before any lookup (ACCOUNT_ID and DELETED_PLAYER_ID are in ./api). */
export const SESSION_ID = new RegExp(`^as_${SHAPE}$`);
export const REPORT_ID = new RegExp(`^rep_${SHAPE}$`);
export const SANCTION_ID = new RegExp(`^san_${SHAPE}$`);
export const AUDIT_ID = new RegExp(`^aud_${SHAPE}$`);
export const EMAIL_CODE_ID = new RegExp(`^ec_${SHAPE}$`);
export const FLOW_ID = new RegExp(`^pf_${SHAPE}$`);

/** A session token or device proof: 32 random bytes as 64 lowercase hex digits (ACCOUNT_TOKEN). */
export function newToken(random: RandomBytes): string {
  return Buffer.from(bytes(random, 32).subarray(0, 32)).toString('hex');
}

/** SHA-256 of the token's text, as 64 lowercase hex digits: all the store ever keeps of a token or device proof. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
