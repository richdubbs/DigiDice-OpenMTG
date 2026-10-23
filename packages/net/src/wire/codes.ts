/**
 * Join codes (docs/design/online.md, "Security"). The host generates a random code; it authenticates the guest and keys the encryption of every
 * datagram. 16 Crockford base32 characters = 80 random bits, shown as four groups ("7KQ2-M9XD-...") so it can be read over the phone. Anyone who can
 * send a datagram to the host's port gets an ACCEPT sealed with a key derived from the code (as does anyone who captures a handshake), and can test
 * guesses of the code against it offline; 80 bits keep that out of reach even though HKDF is fast.
 *
 * That holds only for a random code. A code a person chose ("0000-0000-...", a pattern, the example in the documentation) can be guessed at once, so
 * a chosen code must pass `weakJoinCode` (audit 2026-10-12, m9), and the client's Host screen offers no code field at all: the host always generates
 * the code (a chosen one is for tests and the test CLI).
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
export const JOIN_CODE_LENGTH = 16;
/** Codes printed in the documentation and error messages: public, so never acceptable. */
const PUBLISHED = new Set(['7KQ2M9XD4TRBHC8P']);

function randomCode(): string {
  const bytes = randomBytes(10); // 80 bits = 16 characters of 5 bits
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** A new random join code, formatted in groups of four. Codes `weakJoinCode` would refuse (about 1 in 200) are drawn again. */
export function generateJoinCode(): string {
  for (;;) {
    const code = randomCode();
    if (!weakJoinCode(code)) return formatJoinCode(code);
  }
}

export function formatJoinCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * The canonical form of a typed code: case, spaces and dashes are ignored and the letters Crockford base32 treats as look-alikes are mapped
 * (O -> 0, I/L -> 1). Returns null when the result is not a well-formed code.
 */
export function normalizeJoinCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

/**
 * Why a well-formed code is too guessable to use, or null. A minimum-entropy check for chosen codes (audit m9): it refuses codes with fewer than 9
 * different characters or a character more than 4 times, codes that repeat with a period of up to 8 ("ABCDABCD..."), runs of 5 neighbours in the
 * alphabet ("12345", "ZYXWV") and published example codes. A random code fails it about 4 times in 1,000 (the generator then draws again), so the
 * check costs a random code less than 0.01 bits.
 */
export function weakJoinCode(input: string): string | null {
  const s = normalizeJoinCode(input);
  if (!s) return 'not a join code';
  if (PUBLISHED.has(s)) return 'it is the example code from the documentation';
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (counts.size < 9) return 'it uses too few different characters';
  if (Math.max(...counts.values()) > 4) return 'a character repeats too often';
  for (let p = 1; p <= 8; p++) {
    let repeats = true;
    for (let i = 0; i + p < s.length && repeats; i++) repeats = s[i] === s[i + p];
    if (repeats) return 'it repeats a pattern';
  }
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    run = Math.abs(ALPHABET.indexOf(s[i]!) - ALPHABET.indexOf(s[i - 1]!)) <= 1 ? run + 1 : 1;
    if (run >= 5) return 'it contains a run like 12345';
  }
  return null;
}
