/**
 * RPL-0 (replays design 4, D9): a replay file is gzipped JSON. This module compresses and expands it with the web platform's `CompressionStream` and
 * `DecompressionStream` (every current browser; Node has them too, as globals), so the engine needs no Node module (`zlib` stays out of it).
 *
 * Expanding is bounded: the output is counted as it streams and the stream is cancelled as soon as it passes the bound, so a small file that expands
 * into gigabytes (a "zip bomb") costs at most the bound. Nothing here throws: every failure is a refusal (errors.ts).
 *
 * The streams are reached through `globalThis` with the few members used here typed locally, so this compiles with the DOM's types (the client) and
 * with Node's (the engine's tests) alike.
 */
import { REPLAY_LIMITS, type ReplayLimits } from './bounded';
import { refuse, type Checked } from './errors';
import type { BugReportFile, ReplayFile } from './format';
import { parseBugReport, parseReplay } from './validate';

interface Reader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}
interface Writer {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
interface Transform {
  readonly readable: { getReader(): Reader };
  readonly writable: { getWriter(): Writer };
}
type TransformClass = new (format: 'gzip') => Transform;
interface Codec {
  encode(text: string): Uint8Array;
}
interface Decoder {
  decode(bytes?: Uint8Array, opts?: { stream?: boolean }): string;
}
interface WebGlobals {
  CompressionStream?: TransformClass;
  DecompressionStream?: TransformClass;
  TextEncoder?: new () => Codec;
  TextDecoder?: new (label: string, opts: { fatal: boolean }) => Decoder;
}

const web = globalThis as unknown as WebGlobals;

/** Is this a gzip stream (RFC 1952: the magic bytes 1f 8b)? */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Run `bytes` through a compression or decompression stream, keeping at most `max` bytes of output. Writing and reading run together (a stream holds
 * back its writer until its output is read).
 */
async function pump(stream: Transform, bytes: Uint8Array, max: number): Promise<{ ok: true; out: Uint8Array } | { ok: false; over: boolean; error?: unknown }> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writing = writer.write(bytes).then(() => writer.close());
  writing.catch(() => {}); // a failure is seen by the reader too
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => {});
        await writer.abort().catch(() => {});
        return { ok: false, over: true };
      }
      chunks.push(value);
    }
    await writing;
  } catch (error) {
    return { ok: false, over: false, error };
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { ok: true, out };
}

/** Gzip `bytes`. */
export async function gzipBytes(bytes: Uint8Array): Promise<Checked<Uint8Array>> {
  if (!web.CompressionStream) return refuse('unavailable', 'This browser cannot compress files (no CompressionStream).');
  const r = await pump(new web.CompressionStream('gzip'), bytes, Number.MAX_SAFE_INTEGER);
  return r.ok ? { ok: true, value: r.out } : refuse('badCompression', 'The file could not be compressed.');
}

/** Expand gzip `bytes` to at most `maxBytes`. */
export async function gunzipBytes(bytes: Uint8Array, maxBytes: number): Promise<Checked<Uint8Array>> {
  if (!web.DecompressionStream) return refuse('unavailable', 'This browser cannot read compressed files (no DecompressionStream).');
  const r = await pump(new web.DecompressionStream('gzip'), bytes, maxBytes);
  if (r.ok) return { ok: true, value: r.out };
  return r.over ? refuse('tooLarge', `The file expands to more than ${maxBytes} bytes.`) : refuse('badCompression', 'The file is damaged: its compressed data does not expand.');
}

/** UTF-8 text of `bytes`, refusing anything that is not UTF-8. */
function utf8Text(bytes: Uint8Array): Checked<string> {
  if (!web.TextDecoder) return refuse('unavailable', 'This browser cannot read text files (no TextDecoder).');
  try {
    return { ok: true, value: new web.TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return refuse('badText', 'The file is damaged: it is not UTF-8 text.');
  }
}

/** The JSON text of a stored file: gzipped (as written) or plain, within the bounds. */
export async function fileText(bytes: Uint8Array, limits: ReplayLimits = REPLAY_LIMITS): Promise<Checked<string>> {
  if (bytes.length > limits.maxFileBytes) return refuse('tooLarge', `The file is larger than ${limits.maxFileBytes} bytes.`);
  if (!isGzip(bytes)) return utf8Text(bytes);
  const expanded = await gunzipBytes(bytes, limits.maxTextBytes);
  return expanded.ok ? utf8Text(expanded.value) : expanded;
}

/** Read a replay file (the bytes of a `.openmtg-replay`): expand, parse and check it (validate.ts). */
export async function readReplayFile(bytes: Uint8Array, limits: ReplayLimits = REPLAY_LIMITS): Promise<Checked<ReplayFile>> {
  const text = await fileText(bytes, limits);
  return text.ok ? parseReplay(text.value, limits) : text;
}

/** Read a bug report file. */
export async function readBugReportFile(bytes: Uint8Array, limits: ReplayLimits = REPLAY_LIMITS): Promise<Checked<BugReportFile>> {
  const text = await fileText(bytes, limits);
  return text.ok ? parseBugReport(text.value, limits) : text;
}

/** The bytes of a file to store or export: its JSON, gzipped. */
export async function writeGzippedJson(file: ReplayFile | BugReportFile): Promise<Checked<Uint8Array>> {
  if (!web.TextEncoder) return refuse('unavailable', 'This browser cannot write text files (no TextEncoder).');
  let text: string;
  try {
    text = JSON.stringify(file);
  } catch (e) {
    return refuse('malformed', `The file could not be written: ${e instanceof Error ? e.message : String(e)}`);
  }
  return gzipBytes(new web.TextEncoder().encode(text));
}
