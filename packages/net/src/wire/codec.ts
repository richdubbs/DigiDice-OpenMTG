/**
 * Message bodies: JSON, compressed with zlib (raw deflate) when that pays off. The first byte says which: 0 = UTF-8 JSON, 1 = deflated JSON.
 * Decompression is capped so a small hostile message cannot expand into gigabytes, and the nesting depth of the JSON text is checked before it is
 * parsed (audit C4: deeply nested JSON crashed the host in recursive code after parsing).
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { jsonTextDepth } from '../protocol/bounded';

const RAW = 0;
const DEFLATE = 1;
/** Bodies shorter than this are sent as they are. */
export const COMPRESS_THRESHOLD = 512;
/** The largest JSON text a message may expand to. */
export const MAX_JSON_BYTES = 32 * 1024 * 1024;
/** The deepest nesting of arrays and objects a message may have (views with compiled card definitions stay far below it). */
export const MAX_JSON_DEPTH = 256;

export function encodeBody(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  if (json.length > MAX_JSON_BYTES) throw new RangeError(`Message too large (${json.length} bytes)`);
  if (json.length >= COMPRESS_THRESHOLD) {
    const z = deflateRawSync(json);
    if (z.length < json.length) return Buffer.concat([Buffer.from([DEFLATE]), z]);
  }
  return Buffer.concat([Buffer.from([RAW]), json]);
}

/**
 * Decode a body of at most `maxBytes` of JSON nested at most `maxDepth` deep (the receiver's limits, MAX_JSON_BYTES and MAX_JSON_DEPTH at most);
 * throws on anything malformed, larger or deeper.
 */
export function decodeBody(body: Buffer, maxBytes = MAX_JSON_BYTES, maxDepth = MAX_JSON_DEPTH): unknown {
  if (body.length < 1) throw new Error('empty message');
  const limit = Math.min(maxBytes, MAX_JSON_BYTES);
  const kind = body[0];
  const rest = body.subarray(1);
  let json: Buffer;
  if (kind === RAW) json = rest;
  else if (kind === DEFLATE) {
    try {
      json = inflateRawSync(rest, { maxOutputLength: limit });
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new Error('message too large');
      throw e;
    }
  } else throw new Error(`unknown message encoding ${kind}`);
  if (json.length > limit) throw new Error('message too large');
  if (jsonTextDepth(json, Math.min(maxDepth, MAX_JSON_DEPTH)) === null) throw new Error('message too deeply nested');
  return JSON.parse(json.toString('utf8')) as unknown;
}
