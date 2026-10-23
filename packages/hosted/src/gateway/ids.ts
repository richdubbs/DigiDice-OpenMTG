/**
 * Ids and secrets of the gateway (design D6, 3.2, 4.3): guest session tokens (32 random bytes as 64 hex digits, `HOSTED_TOKEN`) stored only as their
 * SHA-256, session and table ids (ULIDs: 48 bits of time and 80 random bits in Crockford base32, sortable by creation), ready-check ids.
 */
import { createHash, randomBytes } from 'node:crypto';
import { HOSTED_TOKEN_BYTES } from '../api';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new guest session token: 32 random bytes, 64 lowercase hex digits. Sent once, in `welcome`; the server keeps only `tokenHash`. */
export function newToken(): string {
  return randomBytes(HOSTED_TOKEN_BYTES).toString('hex');
}

/** SHA-256 of a token (or an invite code), lowercase hex: what the store keeps and is queried by. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** A ULID: 10 characters of time (ms) and 16 of randomness (80 bits), Crockford base32. Ids of sessions and tables (`STORE_ID` accepts them). */
export function ulid(now: number = Date.now()): string {
  let t = Math.max(0, Math.floor(now));
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let bits = 0;
  let acc = 0;
  let rand = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return time + rand;
}

/** A short random id (ready checks): 16 hex digits. */
export function shortId(): string {
  return randomBytes(8).toString('hex');
}
