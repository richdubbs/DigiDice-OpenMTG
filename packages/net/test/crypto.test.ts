/**
 * Join codes (and their strength, audit 2026-10-12 m9), the X25519 key exchange and key derivation (m8), AES-256-GCM sealing, the host's salt
 * cookie and the replay window (docs/design/online.md, "Security"). Pure functions, called directly: no sockets.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatJoinCode, generateJoinCode, normalizeJoinCode, weakJoinCode } from '../src/wire/codes';
import {
  acceptKey, checkHostSaltCookie, checkProof, deriveKeys, ephemeralFromSeed, helloProof, hostSaltCookie, newEphemeral, open, ReplayWindow, seal,
  sharedSecret, type Handshake,
} from '../src/wire/crypto';
import { dataAad } from '../src/wire/packet';

describe('join codes', () => {
  it('are 16 Crockford base32 characters in groups of four, all different', () => {
    const codes = new Set(Array.from({ length: 200 }, generateJoinCode));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('normalize case, spaces, dashes and look-alike letters', () => {
    expect(normalizeJoinCode('7kq2 m9xd-4trb-hc8p')).toBe('7KQ2M9XD4TRBHC8P');
    expect(normalizeJoinCode('O0IL-AAAA-BBBB-CCCC')).toBe('0011AAAABBBBCCCC');
    expect(normalizeJoinCode('too-short')).toBeNull();
    expect(normalizeJoinCode('UUUU-AAAA-BBBB-CCCC')).toBeNull(); // U is not in the alphabet
    expect(formatJoinCode('7KQ2M9XD4TRBHC8P')).toBe('7KQ2-M9XD-4TRB-HC8P');
  });

  it('audit m9: a chosen code that is easy to guess is refused; generated codes never are', () => {
    expect(weakJoinCode('0000-0000-0000-0000')).toMatch(/few different characters/);
    expect(weakJoinCode('ABCD-ABCD-ABCD-ABCD')).toMatch(/few different characters|pattern/);
    expect(weakJoinCode('0123-4567-89AB-CDEF')).toMatch(/run/);
    expect(weakJoinCode('ZYXW-VTSR-QPNM-KJHG')).toMatch(/run/);
    expect(weakJoinCode('7KQ2-M9XD-4TRB-HC8P')).toMatch(/example/); // printed in the documentation and error messages
    expect(weakJoinCode('A1A2-A3A4-A5B6-B7B8')).toMatch(/repeats too often/);
    expect(weakJoinCode('not a code')).toBe('not a join code');
    expect(weakJoinCode('8RFA-2QXN-K7DM-5WCT')).toBeNull();
    for (let i = 0; i < 500; i++) expect(weakJoinCode(generateJoinCode())).toBeNull();
  });
});

describe('X25519 key exchange and keys (audit m8)', () => {
  const code = '8RFA2QXNK7DM5WCT';
  const connId = randomBytes(8);
  const gs = randomBytes(32);
  const hs = randomBytes(32);
  const guest = newEphemeral();
  const host = newEphemeral();
  const shared = sharedSecret(guest, host.publicKey)!;
  const hsk: Handshake = { code, connId, guestSalt: gs, hostSalt: hs, guestPublic: guest.publicKey, hostPublic: host.publicKey, shared };

  it('both sides compute the same shared secret from the other side\'s 32-byte public key', () => {
    expect(guest.publicKey).toHaveLength(32);
    expect(shared).toHaveLength(32);
    expect(sharedSecret(host, guest.publicKey)!.equals(shared)).toBe(true);
    expect(sharedSecret(newEphemeral(), host.publicKey)!.equals(shared)).toBe(false);
  });

  it('RFC 7748 test vector: known private keys give the published shared secret', () => {
    const alice = ephemeralFromSeed(Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex'));
    const bob = ephemeralFromSeed(Buffer.from('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb', 'hex'));
    expect(alice.publicKey.toString('hex')).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(sharedSecret(alice, bob.publicKey)!.toString('hex')).toBe('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  });

  it('refuses a public key that gives no secret: a low-order point (all-zero result, RFC 7748 section 6.1) or a wrong length', () => {
    expect(sharedSecret(guest, Buffer.alloc(32))).toBeNull();
    expect(sharedSecret(guest, Buffer.from([1, ...Array<number>(31).fill(0)]))).toBeNull();
    expect(sharedSecret(guest, Buffer.alloc(31, 9))).toBeNull();
  });

  it('derives matching keys on both sides, one per direction, from the code AND the shared secret', () => {
    const h = deriveKeys(hsk, 'host');
    const g = deriveKeys(hsk, 'guest');
    expect(h.send.equals(g.recv)).toBe(true);
    expect(h.recv.equals(g.send)).toBe(true);
    expect(h.send.equals(h.recv)).toBe(false);
    // Knowing the code is not enough: another shared secret (someone who only saw the public keys) gives other keys.
    expect(deriveKeys({ ...hsk, shared: randomBytes(32) }, 'host').send.equals(h.send)).toBe(false);
    expect(deriveKeys({ ...hsk, code: '8RFA2QXNK7DM5WCV' }, 'host').send.equals(h.send)).toBe(false);
    expect(deriveKeys({ ...hsk, hostSalt: randomBytes(32) }, 'host').send.equals(h.send)).toBe(false);
    expect(deriveKeys({ ...hsk, connId: randomBytes(8) }, 'host').send.equals(h.send)).toBe(false);
    expect(deriveKeys({ ...hsk, hostPublic: newEphemeral().publicKey }, 'host').send.equals(h.send)).toBe(false);
  });

  it('the ACCEPT key depends on the code and binds both public keys, but needs no key exchange', () => {
    const ctx = { code, connId, guestSalt: gs, hostSalt: hs, guestPublic: guest.publicKey, hostPublic: host.publicKey };
    const k = acceptKey(ctx);
    expect(acceptKey(ctx).equals(k)).toBe(true);
    expect(acceptKey({ ...ctx, code: '8RFA2QXNK7DM5WCV' }).equals(k)).toBe(false);
    expect(acceptKey({ ...ctx, hostPublic: newEphemeral().publicKey }).equals(k)).toBe(false);
    expect(acceptKey({ ...ctx, guestPublic: newEphemeral().publicKey }).equals(k)).toBe(false);
    expect(k.equals(deriveKeys(hsk, 'host').send)).toBe(false);
  });

  it('authenticates ciphertext and header; anything altered or keyed otherwise fails', () => {
    const h = deriveKeys(hsk, 'host');
    const g = deriveKeys(hsk, 'guest');
    const aad = dataAad(connId, 5n);
    const sealed = seal(h.send, 5n, aad, Buffer.from('hello'));
    expect(open(g.recv, 5n, aad, sealed)?.toString()).toBe('hello');
    const flipped = Buffer.from(sealed);
    flipped[0]! ^= 1;
    expect(open(g.recv, 5n, aad, flipped)).toBeNull();
    expect(open(g.recv, 6n, aad, sealed)).toBeNull(); // wrong nonce
    expect(open(g.recv, 5n, dataAad(connId, 6n), sealed)).toBeNull(); // header changed
    expect(open(deriveKeys({ ...hsk, code: 'AAAAAAAAAAAAAAAA' }, 'guest').recv, 5n, aad, sealed)).toBeNull();
  });

  it('hello proof binds the keys to the connection', () => {
    const g = deriveKeys(hsk, 'guest');
    const p = helloProof(g, connId);
    expect(checkProof(deriveKeys(hsk, 'host'), connId, p)).toBe(true);
    expect(checkProof(g, randomBytes(8), p)).toBe(false);
    expect(checkProof(g, connId, 'zz')).toBe(false);
  });

  it('the host salt cookie binds the guest\'s salt, public key and source address (audit m6), and expires', () => {
    const secret = randomBytes(32);
    const c = { connId, guestSalt: gs, guestPublic: guest.publicKey, source: { address: '198.51.100.7', port: 50000 } };
    const cookie = hostSaltCookie(secret, c, 1000);
    expect(checkHostSaltCookie(secret, c, cookie, 1002, 3)).toBe(true);
    expect(checkHostSaltCookie(secret, { ...c, guestPublic: newEphemeral().publicKey }, cookie, 1002, 3)).toBe(false);
    expect(checkHostSaltCookie(secret, { ...c, guestSalt: randomBytes(32) }, cookie, 1002, 3)).toBe(false);
    expect(checkHostSaltCookie(secret, { ...c, source: { address: '198.51.100.8', port: 50000 } }, cookie, 1002, 3)).toBe(false);
    expect(checkHostSaltCookie(secret, { ...c, source: { address: '198.51.100.7', port: 50001 } }, cookie, 1002, 3)).toBe(false);
    expect(checkHostSaltCookie(secret, c, cookie, 1004, 3)).toBe(false); // too old
    expect(checkHostSaltCookie(secret, c, cookie.subarray(0, 31), 1002, 3)).toBe(false);
  });
});

describe('replay window', () => {
  it('accepts each packet number once and drops numbers far below the newest', () => {
    const w = new ReplayWindow(64n);
    expect(w.fresh(1n)).toBe(true);
    w.mark(1n);
    expect(w.fresh(1n)).toBe(false);
    w.mark(100n);
    expect(w.highest).toBe(100n);
    expect(w.fresh(50n)).toBe(true); // within the window, never seen
    expect(w.fresh(30n)).toBe(false); // too old
    expect(w.fresh(101n)).toBe(true);
  });
});
