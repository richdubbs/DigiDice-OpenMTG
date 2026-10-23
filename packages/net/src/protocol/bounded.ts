/**
 * Bounds on JSON from the network (audit 2026-10-12, C4). Recursive helpers such as `JSON.stringify` throw RangeError on deeply nested input (about
 * 5,000 levels, about 10 KB of JSON), and an exception there took the host process down. Everything here is iterative and stops as soon as a bound
 * is passed, so a hostile message costs at most the bounds, never a stack overflow.
 *
 * - `jsonTextDepth` checks the raw JSON text before it is parsed (codec.ts).
 * - `measureJson` checks a parsed value (messages.ts, checkAction): depth, number of values, and an upper estimate of its JSON size.
 */

export interface JsonBounds {
  /** Arrays and objects nested in each other, at most (the top-level value is depth 1). */
  maxDepth: number;
  /** Values (objects, arrays, strings, numbers, booleans, nulls) at most. */
  maxNodes: number;
  /** Estimated JSON size in bytes at most (UTF-16 length of strings and keys plus punctuation: never below the real UTF-8 size for ASCII text). */
  maxBytes: number;
}

const OPEN_BRACE = 0x7b;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACE = 0x7d;
const CLOSE_BRACKET = 0x5d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

/**
 * The deepest nesting of arrays and objects in a JSON text (UTF-8), or null as soon as it passes `maxDepth`. Brackets inside strings are not counted
 * (multibyte UTF-8 sequences never contain ASCII bytes, so a byte scan is exact). Malformed text is left to JSON.parse.
 */
export function jsonTextDepth(text: Buffer, maxDepth: number): number | null {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === BACKSLASH) i++;
      else if (c === QUOTE) inString = false;
      continue;
    }
    if (c === QUOTE) inString = true;
    else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
      if (++depth > maxDepth) return null;
      if (depth > deepest) deepest = depth;
    } else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) depth--;
  }
  return deepest;
}

/** Check a parsed JSON value against the bounds without recursion. Returns the first bound passed ('depth', 'nodes' or 'bytes'), or null. */
export function measureJson(value: unknown, b: JsonBounds): 'depth' | 'nodes' | 'bytes' | null {
  const stack: [unknown, number][] = [[value, 1]];
  let nodes = 0;
  let bytes = 0;
  while (stack.length) {
    const [x, depth] = stack.pop()!;
    if (++nodes > b.maxNodes) return 'nodes';
    if (typeof x === 'string') bytes += x.length + 2;
    else if (typeof x === 'number') bytes += 24;
    else if (typeof x === 'boolean' || x === null || x === undefined) bytes += 5;
    else if (typeof x === 'object') {
      if (depth > b.maxDepth) return 'depth';
      bytes += 2;
      if (Array.isArray(x)) {
        bytes += x.length;
        for (const item of x) stack.push([item, depth + 1]);
      } else {
        for (const key of Object.keys(x)) {
          bytes += key.length + 4;
          stack.push([(x as Record<string, unknown>)[key], depth + 1]);
        }
      }
    } else return 'nodes'; // functions, symbols, bigints: never produced by JSON.parse
    if (bytes > b.maxBytes) return 'bytes';
    if (stack.length > b.maxNodes) return 'nodes';
  }
  return null;
}
