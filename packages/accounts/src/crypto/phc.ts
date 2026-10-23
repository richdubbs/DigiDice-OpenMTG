/**
 * M14-3: scrypt password hashes as PHC strings (design 4.1): `$scrypt$ln=17,r=8,p=1[,k=<pepper id>]$<salt, base64>$<hash, base64>`, base64 being
 * the standard alphabet without padding (the PHC string format's B64). `ln` is log2 of N (passlib's spelling); `k` names the pepper the input went
 * through (4.1). Server only.
 *
 * Parsing is strict and bounded: a stored string that is not exactly this shape, uses parameters outside SCRYPT_BOUNDS or has a non-canonical
 * base64 part is refused (null), and the hasher then answers "wrong password" after the same work (src/crypto/hasher.ts).
 */
import { Buffer } from 'node:buffer';

export interface ScryptParams { ln: number; r: number; p: number }
export interface ScryptPhc {
  params: ScryptParams;
  /** The pepper id, or null for a hash made without one. */
  pepper: string | null;
  salt: Uint8Array;
  hash: Uint8Array;
}

/** The salt and key sizes of new hashes (4.1). */
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;
/** node:crypto's scrypt memory ceiling for one hash (4.1): N = 2^17, r = 8 needs 128 MiB. */
export const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/** What a parsed string may hold: every value a configuration can choose (SCRYPT_LN 16 or 17) and room to move up later, never more memory than SCRYPT_MAXMEM. */
export const SCRYPT_BOUNDS = { lnMin: 10, lnMax: 20, rMax: 32, pMax: 16, bytesMin: 16, bytesMax: 64 } as const;

/** The memory node:crypto's scrypt asks for (OpenSSL's EVP_PBE_scrypt: 128 * r * (N + 2) for V plus 128 * r * p for B), in bytes. */
export function scryptMemory(params: ScryptParams): number {
  return 128 * params.r * (2 ** params.ln + 2) + 128 * params.r * params.p;
}

/**
 * Whether `params` are usable: integers in SCRYPT_BOUNDS that node:crypto's scrypt accepts, so a string that parses never makes the derivation
 * throw. OpenSSL's rules: N < 2^(16 r) (so ln < 16 r: r = 1 allows ln 15 at most), p * r below 2^30 (always, inside the bounds), and the memory
 * within maxmem (SCRYPT_MAXMEM; strictly below it here).
 */
export function scryptParamsOk(params: ScryptParams): boolean {
  const { ln, r, p } = params;
  return (
    Number.isInteger(ln) && Number.isInteger(r) && Number.isInteger(p) &&
    ln >= SCRYPT_BOUNDS.lnMin && ln <= SCRYPT_BOUNDS.lnMax && r >= 1 && r <= SCRYPT_BOUNDS.rMax && p >= 1 && p <= SCRYPT_BOUNDS.pMax &&
    ln < 16 * r && scryptMemory(params) < SCRYPT_MAXMEM
  );
}

/** A pepper id as PASSWORD_PEPPERS allows it (src/config.ts). */
export const PEPPER_ID = /^[A-Za-z0-9_-]{1,32}$/;

const b64 = (b: Uint8Array): string => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64').replace(/=+$/u, '');

/** The PHC string of a hash. */
export function formatScryptPhc(x: ScryptPhc): string {
  const k = x.pepper !== null ? `,k=${x.pepper}` : '';
  return `$scrypt$ln=${x.params.ln},r=${x.params.r},p=${x.params.p}${k}$${b64(x.salt)}$${b64(x.hash)}`;
}

const PHC = /^\$scrypt\$ln=([1-9][0-9]?),r=([1-9][0-9]?),p=([1-9][0-9]?)(?:,k=([A-Za-z0-9_-]{1,32}))?\$([A-Za-z0-9+/]{22,86})\$([A-Za-z0-9+/]{22,86})$/u;

function unb64(s: string): Uint8Array | null {
  const bytes = Buffer.from(s, 'base64');
  // canonical only: re-encoding gives the same text (no stray trailing bits, no padding)
  if (b64(bytes) !== s) return null;
  if (bytes.length < SCRYPT_BOUNDS.bytesMin || bytes.length > SCRYPT_BOUNDS.bytesMax) return null;
  return new Uint8Array(bytes);
}

/** The parts of a PHC string, or null when it is not a usable scrypt hash of this shape. Never throws. */
export function parseScryptPhc(phc: unknown): ScryptPhc | null {
  if (typeof phc !== 'string' || phc.length > 256) return null;
  const m = PHC.exec(phc);
  if (!m) return null;
  const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  if (!scryptParamsOk(params)) return null;
  const salt = unb64(m[5]!);
  const hash = unb64(m[6]!);
  if (salt === null || hash === null) return null;
  return { params, pepper: m[4] ?? null, salt, hash };
}
