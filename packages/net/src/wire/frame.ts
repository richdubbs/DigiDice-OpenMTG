/**
 * The plaintext inside a DATA datagram (the reliability layer's unit):
 *
 *   flags u8 | cumulative ack u32 | sack bytes u8 | sack bitmap | [frame: seq u32 | message id u32 | index u16 | count u16 | bytes]
 *
 * `cumulative ack` = the next fragment sequence number the sender of this payload expects (everything below it arrived). The selective-ack bitmap
 * covers the SACK_SPAN sequence numbers above it: bit i (byte i >> 3, bit i & 7) set = fragment `cum + 1 + i` arrived out of order. It says
 * everything about the window behind a hole, however many holes there are; the sender keeps every fragment it sends inside that span (channel.ts),
 * so after a loss it resends only what was lost. A frame is one fragment of a message: message `id` was split into `count` fragments with
 * consecutive sequence numbers.
 */
import { MAX_PAYLOAD } from './packet';

export const Flag = { Frame: 1, Ping: 2, Bye: 4 } as const;
/** Sequence numbers above the cumulative ack that a selective ack covers. */
export const SACK_SPAN = 512;
const SACK_BYTES = SACK_SPAN / 8;
const FRAME_HEADER = 12;
const ACK_BYTES = 1 + 4 + 1 + SACK_BYTES;
/** Bytes of message data in one fragment (fits MAX_PAYLOAD with the largest ack block). */
export const FRAGMENT_BYTES = 960;
if (ACK_BYTES + FRAME_HEADER + FRAGMENT_BYTES > MAX_PAYLOAD) throw new Error('FRAGMENT_BYTES does not fit a datagram');

export interface Fragment {
  seq: number;
  msgId: number;
  index: number;
  count: number;
  data: Buffer;
}

export interface Payload {
  flags: number;
  cum: number;
  /** Selective-ack bitmap above `cum` (trailing zero bytes left out). */
  sack: Buffer;
  frame?: Fragment;
}

const EMPTY = Buffer.alloc(0);

/** The bitmap of the received sequence numbers in (cum, cum + SACK_SPAN]. */
export function sackBitmap(cum: number, received: Iterable<number>): Buffer {
  let b: Buffer | null = null;
  let last = -1;
  for (const seq of received) {
    const i = seq - cum - 1;
    if (i < 0 || i >= SACK_SPAN) continue;
    b ??= Buffer.alloc(SACK_BYTES);
    b[i >> 3]! |= 1 << (i & 7);
    last = Math.max(last, i >> 3);
  }
  return b ? b.subarray(0, last + 1) : EMPTY;
}

/** Does this ack say that `seq` arrived? */
export function isAcked(p: Pick<Payload, 'cum' | 'sack'>, seq: number): boolean {
  if (seq < p.cum) return true;
  const i = seq - p.cum - 1;
  return i >= 0 && (i >> 3) < p.sack.length && (p.sack[i >> 3]! & (1 << (i & 7))) !== 0;
}

export function encodePayload(p: Payload): Buffer {
  const sack = p.sack.subarray(0, SACK_BYTES);
  const frame = p.frame;
  const b = Buffer.alloc(6 + sack.length + (frame ? FRAME_HEADER + frame.data.length : 0));
  let o = 0;
  o = b.writeUInt8((p.flags & ~Flag.Frame) | (frame ? Flag.Frame : 0), o);
  o = b.writeUInt32BE(p.cum, o);
  o = b.writeUInt8(sack.length, o);
  o += sack.copy(b, o);
  if (frame) {
    o = b.writeUInt32BE(frame.seq, o);
    o = b.writeUInt32BE(frame.msgId, o);
    o = b.writeUInt16BE(frame.index, o);
    o = b.writeUInt16BE(frame.count, o);
    frame.data.copy(b, o);
  }
  return b;
}

/** Decode a payload; null if it is malformed (the peer has the key, so this means a bug or a hostile peer). */
export function decodePayload(b: Buffer): Payload | null {
  if (b.length < 6) return null;
  const flags = b.readUInt8(0);
  const cum = b.readUInt32BE(1);
  const n = b.readUInt8(5);
  if (n > SACK_BYTES || b.length < 6 + n) return null;
  const sack = Buffer.from(b.subarray(6, 6 + n));
  const o = 6 + n;
  if (!(flags & Flag.Frame)) return o === b.length ? { flags, cum, sack } : null;
  if (b.length < o + FRAME_HEADER) return null;
  const frame: Fragment = {
    seq: b.readUInt32BE(o),
    msgId: b.readUInt32BE(o + 4),
    index: b.readUInt16BE(o + 8),
    count: b.readUInt16BE(o + 10),
    data: Buffer.from(b.subarray(o + FRAME_HEADER)),
  };
  if (frame.count === 0 || frame.index >= frame.count || frame.data.length > FRAGMENT_BYTES) return null;
  return { flags, cum, sack, frame };
}
