/**
 * RPL-0 (replays design 4, "Compression and limits"): bounds on a replay file before and after it is parsed, the way packages/net bounds JSON from the
 * network (`protocol/bounded.ts`, audit 2026-10-12 C4). A replay comes from a file anyone can hand a player, so nothing here recurses or throws: recursive
 * code (`JSON.stringify` among it) overflows the stack on deeply nested input, and every check stops as soon as its bound is passed.
 *
 * Browser-safe: strings and plain values only (net's version reads Node `Buffer`s).
 */
import { measureJsonValue } from '../util/json-bounds';

export interface ReplayLimits {
  /** The file as stored (gzipped), in bytes: 8 MB (the largest measured replay is 140 KB, design 12). */
  maxFileBytes: number;
  /** The JSON text it expands to, in bytes (UTF-8): 128 MB. */
  maxTextBytes: number;
  /** Arrays and objects nested in each other, at most (the top-level value is depth 1); net's MAX_JSON_DEPTH. */
  maxDepth: number;
  /** The longest string (a value or a key), in UTF-16 code units. */
  maxString: number;
  /**
   * Values (objects, arrays, strings, numbers, booleans, nulls) at most: 10M. A view's JSON holds a value per 14 bytes (measured on an AI game's last
   * view, 505 KB and 36K values), so 128 MB of real views is about 9.6M values; only text made up to be dense (a flat list of zeros) holds more. It is
   * counted in the text before JSON.parse builds anything (`scanJsonText`), so the work and the memory a file can cost are those of 10M values.
   */
  maxValues: number;
}

const MB = 1024 * 1024;

export const REPLAY_LIMITS: Readonly<ReplayLimits> = Object.freeze({
  maxFileBytes: 8 * MB,
  maxTextBytes: 128 * MB,
  maxDepth: 256,
  maxString: 1 * MB,
  maxValues: 10_000_000,
});

const OPEN_BRACE = 0x7b;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACE = 0x7d;
const CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

/**
 * The bound a JSON text passes before it is parsed: its nesting ('depth') or its number of values ('values'), or null. One pass over the text, nothing
 * allocated, so a file of millions of values is refused before JSON.parse builds them (RPL-0 review: a 114 KB gzipped file of 60M zeros parsed into
 * 579 MB of heap first). Brackets and commas inside strings are not counted. For valid JSON the count is exact, the count `measureValue` makes of the
 * parsed value: the top-level value, one more for every comma, and one for the first element of every container that is not empty. Malformed text is
 * left to JSON.parse.
 */
export function scanJsonText(text: string, limits: Pick<ReplayLimits, 'maxDepth' | 'maxValues'>): 'depth' | 'values' | null {
  let depth = 0;
  let values = 1;
  let inString = false;
  /** The last character that is not white space opened a container. */
  let opened = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === BACKSLASH) i++;
      else if (c === QUOTE) inString = false;
      continue;
    }
    if (c === SPACE || c === LF || c === CR || c === TAB) continue;
    if (opened && c !== CLOSE_BRACE && c !== CLOSE_BRACKET && ++values > limits.maxValues) return 'values';
    opened = false;
    if (c === QUOTE) inString = true;
    else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
      if (++depth > limits.maxDepth) return 'depth';
      opened = true;
    } else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) depth--;
    else if (c === COMMA && ++values > limits.maxValues) return 'values';
  }
  if (values > limits.maxValues) return 'values';
  return null;
}

/**
 * The first bound a parsed value passes: its nesting, its number of values or the length of one of its strings; null when it is within all of them.
 * Iterative, with one frame per level of nesting (util/json-bounds.ts): nothing is allocated per element, so a value of any size costs at most the bounds.
 */
export function measureValue(value: unknown, limits: Pick<ReplayLimits, 'maxDepth' | 'maxString' | 'maxValues'>): 'depth' | 'values' | 'string' | null {
  const over = measureJsonValue(value, { maxDepth: limits.maxDepth, maxValues: limits.maxValues, maxString: limits.maxString });
  return over === 'bytes' ? null : over; // no byte bound is given
}
