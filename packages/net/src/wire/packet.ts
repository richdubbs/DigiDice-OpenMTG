/**
 * Datagram layout. Every datagram starts with a 12-byte clear-text header: magic "OM", wire version, packet type, 8-byte connection id.
 *
 *   INIT    guest -> host  header | guest salt (32) | guest X25519 public key (32) | code tag (16) | zero padding up to INIT_BYTES
 *   ACCEPT  host -> guest  header | host salt (32) | host X25519 public key (32) | packet number 0 (8) | sealed("openmtg-accept")
 *                          (proves the host knows the code and holds the private key of its public key)
 *   DATA0   guest -> host  header | guest salt (32) | host salt (32) | guest public key (32) | packet number (8) | sealed(plaintext)
 *   DATA    both ways      header | packet number (8) | sealed(plaintext)
 *
 * The plaintext of DATA and DATA0 starts with a kind byte (PlainKind): a channel payload (frame.ts), or a path challenge or response of the
 * connection (connection.ts, path validation).
 *
 * The host keeps no state per handshake: its salt is a cookie it can check (crypto.ts, hostSaltCookie; bound to the guest's source address), and
 * its X25519 key is one random key pair per second, kept in memory and forgotten once that second's cookies have expired (link/handshake.ts; the
 * forgetting gives forward secrecy). The guest repeats its salt, its public key and the host's salt in clear text (DATA0) until it has heard from
 * the host.
 *
 * The code tag (M12-5a, m12 design 6: one join code per seat) tells a host with several codes which one the guest holds, without naming it
 * (crypto.ts, codeTag: an HMAC under the code of this INIT's connection id, salt and public key, so it is new for every INIT and links nothing). It sits
 * in what was zero padding: a host with one code ignores it (a milestone 9 guest's zeros are fine there), and the INIT keeps its size.
 *
 * INIT is padded so that the host never answers an unauthenticated request with more bytes than it received (no amplification). Everything after
 * the packet number is AES-256-GCM output; the bytes before it are its associated data.
 */
import { PUBLIC_KEY_BYTES, SALT_BYTES, TAG_BYTES } from './crypto';

export const MAGIC = 0x4f4d; // "OM"
/** 2: X25519 key exchange in the handshake, kind byte in the plaintext (audit 2026-10-12, m8 and m10). */
export const WIRE_VERSION = 2;
export const HEADER_BYTES = 12;
export const PN_BYTES = 8;
export const INIT_BYTES = 128;
/** M12-5a: the code tag of an INIT (crypto.ts, codeTag), right after the guest's public key. */
export const CODE_TAG_BYTES = 16;
const CODE_TAG_AT = HEADER_BYTES + SALT_BYTES + PUBLIC_KEY_BYTES;
/** The largest datagram either side sends ("about 1,100 bytes", under typical path MTU), not counting the salts and key of a DATA0. */
export const MAX_DATAGRAM = 1100;
/** The largest channel payload that fits a DATA datagram, after the kind byte (a DATA0 carries the same plus two salts and a key). */
export const MAX_PAYLOAD = MAX_DATAGRAM - HEADER_BYTES - PN_BYTES - TAG_BYTES - 1;
const MAX_DATA0 = MAX_DATAGRAM + 2 * SALT_BYTES + PUBLIC_KEY_BYTES;
export const ACCEPT_PLAIN = Buffer.from('openmtg-accept', 'utf8');

export const PacketType = { Init: 1, Accept: 2, Data: 3, Data0: 4 } as const;
export type PacketType = (typeof PacketType)[keyof typeof PacketType];

/** The first byte of a DATA plaintext. */
export const PlainKind = { Channel: 0, PathChallenge: 1, PathResponse: 2 } as const;

export type Packet =
  | { type: typeof PacketType.Init; connId: Buffer; salt: Buffer; publicKey: Buffer; tag: Buffer }
  | { type: typeof PacketType.Accept; connId: Buffer; salt: Buffer; publicKey: Buffer; pn: bigint; aad: Buffer; sealed: Buffer }
  | { type: typeof PacketType.Data; connId: Buffer; pn: bigint; aad: Buffer; sealed: Buffer }
  | { type: typeof PacketType.Data0; connId: Buffer; guestSalt: Buffer; hostSalt: Buffer; guestPublic: Buffer; pn: bigint; aad: Buffer; sealed: Buffer };

export function header(type: PacketType, connId: Buffer): Buffer {
  const h = Buffer.alloc(HEADER_BYTES);
  h.writeUInt16BE(MAGIC, 0);
  h.writeUInt8(WIRE_VERSION, 2);
  h.writeUInt8(type, 3);
  connId.copy(h, 4, 0, 8);
  return h;
}

/** An INIT; `tag` (M12-5a): the code tag (zeros when left out, as a milestone 9 guest sends). */
export function encodeInit(connId: Buffer, salt: Buffer, publicKey: Buffer, tag?: Buffer): Buffer {
  const b = Buffer.alloc(INIT_BYTES);
  header(PacketType.Init, connId).copy(b, 0);
  salt.copy(b, HEADER_BYTES);
  publicKey.copy(b, HEADER_BYTES + SALT_BYTES);
  tag?.copy(b, CODE_TAG_AT, 0, CODE_TAG_BYTES);
  return b;
}

function pnBytes(pn: bigint): Buffer {
  const b = Buffer.alloc(PN_BYTES);
  b.writeBigUInt64BE(pn);
  return b;
}

/** The associated data of an ACCEPT (everything before the sealed part). */
export function acceptAad(connId: Buffer, salt: Buffer, publicKey: Buffer, pn: bigint): Buffer {
  return Buffer.concat([header(PacketType.Accept, connId), salt, publicKey, pnBytes(pn)]);
}

/** The associated data of a DATA packet (header and packet number). */
export function dataAad(connId: Buffer, pn: bigint): Buffer {
  return Buffer.concat([header(PacketType.Data, connId), pnBytes(pn)]);
}

/** The associated data of a DATA0 packet (header, both salts, the guest's public key and the packet number): all authenticated. */
export function data0Aad(connId: Buffer, guestSalt: Buffer, hostSalt: Buffer, guestPublic: Buffer, pn: bigint): Buffer {
  return Buffer.concat([header(PacketType.Data0, connId), guestSalt, hostSalt, guestPublic, pnBytes(pn)]);
}

/** Parse a datagram's framing (nothing is authenticated yet). Returns null for anything that is not a well-formed OpenMTG packet. */
export function parsePacket(buf: Buffer): Packet | null {
  if (buf.length < HEADER_BYTES || buf.length > MAX_DATA0) return null;
  if (buf.readUInt16BE(0) !== MAGIC || buf.readUInt8(2) !== WIRE_VERSION) return null;
  const type = buf.readUInt8(3);
  const connId = Buffer.from(buf.subarray(4, 12));
  const slice = (from: number, n: number) => Buffer.from(buf.subarray(from, from + n));
  if (type === PacketType.Data0) {
    const at = HEADER_BYTES + 2 * SALT_BYTES + PUBLIC_KEY_BYTES;
    if (buf.length < at + PN_BYTES + TAG_BYTES) return null;
    return {
      type: PacketType.Data0, connId, guestSalt: slice(HEADER_BYTES, SALT_BYTES), hostSalt: slice(HEADER_BYTES + SALT_BYTES, SALT_BYTES),
      guestPublic: slice(HEADER_BYTES + 2 * SALT_BYTES, PUBLIC_KEY_BYTES), pn: buf.readBigUInt64BE(at), aad: buf.subarray(0, at + PN_BYTES), sealed: buf.subarray(at + PN_BYTES),
    };
  }
  if (buf.length > MAX_DATAGRAM) return null;
  if (type === PacketType.Init) {
    if (buf.length !== INIT_BYTES) return null;
    return { type: PacketType.Init, connId, salt: slice(HEADER_BYTES, SALT_BYTES), publicKey: slice(HEADER_BYTES + SALT_BYTES, PUBLIC_KEY_BYTES), tag: slice(CODE_TAG_AT, CODE_TAG_BYTES) };
  }
  if (type === PacketType.Accept) {
    const at = HEADER_BYTES + SALT_BYTES + PUBLIC_KEY_BYTES;
    if (buf.length < at + PN_BYTES + TAG_BYTES) return null;
    return {
      type: PacketType.Accept, connId, salt: slice(HEADER_BYTES, SALT_BYTES), publicKey: slice(HEADER_BYTES + SALT_BYTES, PUBLIC_KEY_BYTES),
      pn: buf.readBigUInt64BE(at), aad: buf.subarray(0, at + PN_BYTES), sealed: buf.subarray(at + PN_BYTES),
    };
  }
  if (type === PacketType.Data) {
    if (buf.length < HEADER_BYTES + PN_BYTES + TAG_BYTES) return null;
    return { type: PacketType.Data, connId, pn: buf.readBigUInt64BE(HEADER_BYTES), aad: buf.subarray(0, HEADER_BYTES + PN_BYTES), sealed: buf.subarray(HEADER_BYTES + PN_BYTES) };
  }
  return null;
}
