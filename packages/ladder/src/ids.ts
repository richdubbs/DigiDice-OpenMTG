/**
 * The ladder's ids (design 2 "Ids", 8.7, 9.6, 11.2). Server only (`node:crypto` for the random bits).
 *
 * - `newUlid(nowMs, random)`: a real ULID, 48 bits of time and 80 random bits, for the ids only the server and moderators see, whose time order
 *   serves keyset paging: ranked match ids (`RankedMatch.match`, `RankedStart.match`; the service hands `newMatchId` to the matcher as
 *   `RankedMatcherContext.newMatchId`, 9.6) and abuse report ids (`AbuseReport.id`, 11.2). Plain ULIDs, so they also meet m13's store id rule
 *   (1-64 characters of [0-9A-Za-z_-]).
 * - `newDeletedSortKey(random)`: the `sortKey` of a closed season's record after its account was deleted (8.7, 13.3): "deleted:" and 128 random bits
 *   in the ULID shape, NO time part (like m14's DeletedPlayerId, m14 D22), one fresh key per row, so the rows of one erasure cannot be grouped or
 *   ordered by when they were made.
 * - Account ids are milestone 14's (`acc_` + 128 random bits); the ladder never makes one and checks their shape with ACCOUNT_ID_SHAPE (13.1).
 *
 * Every generator takes the random source as an argument (node:crypto's randomBytes by default; tests pass a fixed source, so no test depends on
 * chance) and, for the ULIDs, the time in ms since the epoch (LadderClock.now()).
 */
import { randomBytes } from 'node:crypto';

/** The random source every generator takes: `n` bytes. */
export type RandomBytes = (n: number) => Uint8Array;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26 Crockford base32 characters, the first 0-7: the ULID shape, 128 bits (a real ULID, or 128 random bits with no time part). */
export const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** A deleted account's season-record sort key (8.7). */
export const DELETED_SORT_KEY = /^deleted:[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const DELETED_SORT_KEY_PREFIX = 'deleted:';

/** The largest time a ULID holds (48 bits of milliseconds). */
const ULID_TIME_MAX = 2 ** 48 - 1;

export function isUlid(x: unknown): x is string {
  return typeof x === 'string' && x.length === 26 && ULID.test(x);
}

export function isDeletedSortKey(x: unknown): x is string {
  return typeof x === 'string' && x.length === DELETED_SORT_KEY_PREFIX.length + 26 && DELETED_SORT_KEY.test(x);
}

function bytes(random: RandomBytes, n: number): Uint8Array {
  const b = random(n);
  if (!(b instanceof Uint8Array) || b.length < n) throw new RangeError(`the random source gave ${b instanceof Uint8Array ? b.length : 0} bytes, not ${n}`);
  return b.subarray(0, n);
}

/** `digits` Crockford base32 characters of the big-endian number in `b`, most significant first (bits beyond 8 * b.length are zero). */
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

/** A ULID: 10 characters of time (`nowMs`, milliseconds since 1970, 48 bits) and 16 of randomness (80 bits). */
export function newUlid(nowMs: number, random: RandomBytes = randomBytes): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > ULID_TIME_MAX) throw new RangeError('newUlid: the time is outside a ULID');
  let time = '';
  let x = nowMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[x % 32]! + time;
    x = Math.floor(x / 32);
  }
  return time + base32(bytes(random, 10), 16);
}

/** A ranked match id (9.6): a ULID. */
export function newMatchId(nowMs: number, random: RandomBytes = randomBytes): string {
  return newUlid(nowMs, random);
}

/** An abuse report id (11.2): a ULID. */
export function newReportId(nowMs: number, random: RandomBytes = randomBytes): string {
  return newUlid(nowMs, random);
}

/** A deleted account's season-record sort key (8.7): "deleted:" + 128 random bits in the ULID shape, no time part; a fresh one per row. */
export function newDeletedSortKey(random: RandomBytes = randomBytes): string {
  return DELETED_SORT_KEY_PREFIX + base32(bytes(random, 16), 26);
}
