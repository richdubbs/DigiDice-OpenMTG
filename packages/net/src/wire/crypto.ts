/**
 * Datagram encryption (docs/design/online.md, "Security"): AES-256-GCM with keys derived by HKDF-SHA256 from the join code and an ephemeral X25519
 * key exchange (PSK-DHE, like TLS 1.3's psk_dhe_ke).
 *
 * - Both sides contribute a random 32-byte salt and an ephemeral X25519 public key in the handshake, so every connection (and every reconnection)
 *   has fresh keys. The keys depend on the join code and on the X25519 shared secret: anyone who knows the code but only records the traffic cannot
 *   read it (audit 2026-10-12, m8). The guest makes a new key pair per handshake; the host one per second, forgotten when its cookies expire (a few
 *   seconds), so recorded traffic stays unreadable even with the code and both machines later (forward secrecy). The ACCEPT is sealed with a key
 *   from the code alone (`acceptKey`), so answering an INIT costs no key exchange. An active attacker who knows the code can still sit in the
 *   middle: the code is the only credential (a PAKE would be the next step if codes ever get shorter).
 * - Each direction has its own key, and the nonce is the sender's packet number (a counter that only goes up, once per datagram sent,
 *   retransmissions included). A nonce is therefore never used twice with the same key.
 * - The connection id and both public keys are bound into the key derivation, and the clear-text packet header is authenticated as associated data.
 * - Packets that fail authentication are dropped; a replay window drops authenticated packets seen before.
 */
import {
  createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, timingSafeEqual,
  type KeyObject,
} from 'node:crypto';

export const SALT_BYTES = 32;
export const TAG_BYTES = 16;
/** An X25519 public key (RFC 7748). */
export const PUBLIC_KEY_BYTES = 32;
const KEY_INFO = 'openmtg-net/v2 keys';
const ACCEPT_INFO = 'openmtg-net/v2 accept';
const TAG_INFO = 'openmtg-net/v2 code tag';
/** M12-5a: bytes of an INIT's code tag (packet.ts, CODE_TAG_BYTES). */
const CODE_TAG_LENGTH = 16;
// DER wrappers of a raw X25519 key (RFC 8410): node:crypto takes keys as DER, PEM or JWK only.
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');

export interface ConnectionKeys {
  /** Key of the datagrams this side sends. */
  send: Buffer;
  /** Key of the datagrams this side receives. */
  recv: Buffer;
  /** Key for the join-code proof carried in `hello`. */
  proof: Buffer;
}

export interface Ephemeral {
  privateKey: KeyObject;
  /** The raw 32-byte public key sent in the handshake. */
  publicKey: Buffer;
}

function rawPublic(k: KeyObject): Buffer {
  return Buffer.from(k.export({ format: 'der', type: 'spki' }).subarray(-PUBLIC_KEY_BYTES));
}

/** A fresh random X25519 key pair (the guest's, one per handshake). */
export function newEphemeral(): Ephemeral {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return { privateKey, publicKey: rawPublic(publicKey) };
}

/** An X25519 key pair from 32 secret bytes (tests: known keys; RFC 7748 clamps them). */
export function ephemeralFromSeed(seed: Buffer): Ephemeral {
  const privateKey = createPrivateKey({ key: Buffer.concat([X25519_PKCS8, seed.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  return { privateKey, publicKey: rawPublic(createPublicKey(privateKey)) };
}

/** The X25519 shared secret with the peer's raw public key; null when it is not usable (a low-order point gives all zeros, RFC 7748 section 6.1). */
export function sharedSecret(own: Ephemeral, peerPublic: Buffer): Buffer | null {
  if (peerPublic.length !== PUBLIC_KEY_BYTES) return null;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([X25519_SPKI, peerPublic]), format: 'der', type: 'spki' });
    const s = diffieHellman({ privateKey: own.privateKey, publicKey });
    return s.every((b) => b === 0) ? null : s;
  } catch {
    return null;
  }
}

/** Everything both sides agree on after the handshake datagrams: the key derivation's input. */
export interface Handshake {
  /** The normalized join code (codes.ts#normalizeJoinCode). */
  code: string;
  connId: Buffer;
  guestSalt: Buffer;
  hostSalt: Buffer;
  guestPublic: Buffer;
  hostPublic: Buffer;
  /** The X25519 shared secret. */
  shared: Buffer;
}

/**
 * The key that seals the host's ACCEPT: from the join code alone (with the salts, the connection id and both public keys as context), so answering an
 * INIT costs no key exchange (the host may get many INITs from forged addresses). The ACCEPT proves that the host knows the code and binds its
 * public key; the connection keys (`deriveKeys`) also need the X25519 shared secret.
 */
export function acceptKey(h: Omit<Handshake, 'shared'>): Buffer {
  const info = Buffer.concat([Buffer.from(ACCEPT_INFO, 'utf8'), h.connId, h.guestPublic, h.hostPublic]);
  return Buffer.from(hkdfSync('sha256', Buffer.from(h.code, 'utf8'), Buffer.concat([h.guestSalt, h.hostSalt]), info, 32));
}

/**
 * M12-5a (m12 design 6: one join code per seat): the code tag of an INIT, which tells a host with several codes which one the guest holds. An HMAC under
 * the code of the INIT's connection id, salt and public key: new for every INIT, so it links nothing, and only a holder of the code can make it. It tells
 * an onlooker no more about the code than the host's ACCEPT does already (both let a guess be checked offline; 80 random bits keep that out of reach,
 * codes.ts). A host with one code does not read it.
 */
export function codeTag(code: string, connId: Buffer, guestSalt: Buffer, guestPublic: Buffer): Buffer {
  return createHmac('sha256', Buffer.from(code, 'utf8')).update(TAG_INFO).update(connId).update(guestSalt).update(guestPublic).digest().subarray(0, CODE_TAG_LENGTH);
}

/** Does an INIT's tag match `code`? Constant-time. */
export function sameCodeTag(tag: Buffer, code: string, connId: Buffer, guestSalt: Buffer, guestPublic: Buffer): boolean {
  const want = codeTag(code, connId, guestSalt, guestPublic);
  return tag.length === want.length && timingSafeEqual(tag, want);
}

/**
 * Derive the keys of one connection. The input keying material is the join code followed by the X25519 shared secret (both are needed); the salts
 * are the guest's then the host's, and the connection id and both public keys are the context. Both sides compute the same material and pick their
 * directions by role.
 */
export function deriveKeys(h: Handshake, role: 'host' | 'guest'): ConnectionKeys {
  const info = Buffer.concat([Buffer.from(KEY_INFO, 'utf8'), h.connId, h.guestPublic, h.hostPublic]);
  const ikm = Buffer.concat([Buffer.from(h.code, 'utf8'), h.shared]);
  const okm = Buffer.from(hkdfSync('sha256', ikm, Buffer.concat([h.guestSalt, h.hostSalt]), info, 96));
  const guestToHost = okm.subarray(0, 32);
  const hostToGuest = okm.subarray(32, 64);
  const proof = okm.subarray(64, 96);
  return role === 'host' ? { send: hostToGuest, recv: guestToHost, proof } : { send: guestToHost, recv: hostToGuest, proof };
}

function nonceFor(pn: bigint): Buffer {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(pn, 4);
  return n;
}

/** Encrypt and authenticate `plain`; returns ciphertext followed by the 16-byte tag. */
export function seal(key: Buffer, pn: bigint, aad: Buffer, plain: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', key, nonceFor(pn), { authTagLength: TAG_BYTES });
  c.setAAD(aad);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

/** Decrypt `sealed` (ciphertext + tag); null when it does not authenticate. */
export function open(key: Buffer, pn: bigint, aad: Buffer, sealed: Buffer): Buffer | null {
  if (sealed.length < TAG_BYTES) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, nonceFor(pn), { authTagLength: TAG_BYTES });
    d.setAAD(aad);
    d.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG_BYTES)), d.final()]);
  } catch {
    return null;
  }
}

/** What a host salt cookie is made for: the guest's INIT and the source (address and port) it came from. */
export interface CookieFor {
  connId: Buffer;
  guestSalt: Buffer;
  guestPublic: Buffer;
  source: { address: string; port: number };
}

/**
 * The host's salt as a stateless cookie (like a DTLS HelloVerifyRequest cookie or a QUIC Retry token): the time bucket it was made in (4 bytes, whole
 * seconds) and an HMAC, under a secret only the host process knows, of that bucket, the connection id, the guest's salt, the guest's public key and
 * the source address and port of the INIT. The host keeps no state per INIT (only one random X25519 key pair per time bucket, handshake.ts); when the
 * guest's first datagram comes back with both salts and its public key (DATA0), the host checks the cookie and its age, and derives the connection
 * keys. Because the source is in the MAC (audit 2026-10-12, m6), a DATA0 with a valid cookie comes from where its INIT came from: only a sender that
 * receives at that address could have read the cookie, so a cookie replayed from forged addresses is worthless.
 */
export function hostSaltCookie(secret: Buffer, c: CookieFor, bucket: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(bucket >>> 0);
  const port = Buffer.alloc(2);
  port.writeUInt16BE(c.source.port & 0xffff);
  // Fixed-length fields first, the address (the only variable-length one) last: no two inputs encode alike.
  const mac = createHmac('sha256', secret).update('openmtg-cookie').update(b).update(c.connId).update(c.guestSalt).update(c.guestPublic).update(port)
    .update(c.source.address).digest();
  return Buffer.concat([b, mac.subarray(0, SALT_BYTES - 4)]);
}

/** Is `hostSalt` a cookie this host made for this INIT and source, at most `maxAge` buckets ago? */
export function checkHostSaltCookie(secret: Buffer, c: CookieFor, hostSalt: Buffer, nowBucket: number, maxAge: number): boolean {
  if (hostSalt.length !== SALT_BYTES) return false;
  const bucket = hostSalt.readUInt32BE(0);
  const age = (nowBucket >>> 0) - bucket;
  if (age < 0 || age > maxAge) return false;
  return timingSafeEqual(hostSalt, hostSaltCookie(secret, c, bucket));
}

/** The join-code proof of a `hello` (hex): HMAC over the connection id, so a hello cannot be moved to another connection. */
export function helloProof(keys: ConnectionKeys, connId: Buffer): string {
  return createHmac('sha256', keys.proof).update('hello').update(connId).digest('hex');
}

export function checkProof(keys: ConnectionKeys, connId: Buffer, proof: unknown): boolean {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false;
  return timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(helloProof(keys, connId), 'hex'));
}

/**
 * Sliding replay window over packet numbers (like DTLS/IPsec): a packet number is accepted once, and only if it is not too far below the highest
 * one seen. `fresh` is checked before decrypting, `mark` only after the packet authenticated (forged packets must not move the window).
 */
export class ReplayWindow {
  private top = -1n;
  private readonly seen = new Set<bigint>();
  constructor(private readonly size = 4096n) {}

  /** The highest packet number marked so far (-1 before the first). */
  get highest(): bigint {
    return this.top;
  }

  fresh(pn: bigint): boolean {
    if (pn > this.top) return true;
    if (this.top - pn >= this.size) return false;
    return !this.seen.has(pn);
  }

  mark(pn: bigint): void {
    this.seen.add(pn);
    if (pn > this.top) {
      this.top = pn;
      if (this.seen.size > Number(this.size) * 2) for (const x of this.seen) if (this.top - x >= this.size) this.seen.delete(x);
    }
  }
}
