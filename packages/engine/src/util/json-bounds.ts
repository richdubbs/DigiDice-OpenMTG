/**
 * Bounds on a JSON value that came from outside (a replay file, a guest's action), checked without recursion and without allocating per element
 * (RPL-0 review: a stack entry per element let a flat 60M-element array exhaust the heap before the bound was looked at). The walk keeps one frame per
 * level of nesting, so its own memory is bounded by the depth, and it stops as soon as a bound is passed.
 *
 * Values are counted as JSON counts them: every object, array, string, number, boolean and null (keys are not values). `undefined` counts as a value
 * the way JSON writes it (an object key holding it is left out, an array element becomes null), so a value held in memory before it is serialized
 * measures like its JSON text.
 *
 * Browser-safe: plain values only.
 */

export interface JsonBounds {
  /** Arrays and objects nested in each other, at most (the top-level value is depth 1). */
  maxDepth: number;
  /** Values at most. */
  maxValues: number;
  /** The longest string (a value or a key), in UTF-16 code units; unbounded when absent. */
  maxString?: number;
  /**
   * An upper estimate of the JSON size in bytes, at most (strings and keys by their UTF-16 length plus punctuation, a number as 24, a boolean or null as
   * 5: never below the real UTF-8 size of ASCII text); unbounded when absent.
   */
  maxBytes?: number;
}

/** The first bound a value passes, or null. Functions, symbols and bigints (never produced by JSON.parse) count as over the value bound. */
export type JsonBound = 'depth' | 'values' | 'string' | 'bytes';

type Rec = Record<string, unknown>;

/** Check `value` against `b` (see the file comment). */
export function measureJsonValue(value: unknown, b: JsonBounds): JsonBound | null {
  const maxString = b.maxString ?? Infinity;
  const maxBytes = b.maxBytes ?? Infinity;
  let values = 0;
  let bytes = 0;
  // One frame per open container: the container, its keys (objects) and the index of the next child.
  const containers: (unknown[] | Rec)[] = [];
  const keyLists: (string[] | null)[] = [];
  const next: number[] = [];

  /** Count one value; when it is a container, open a frame for it. Returns the bound passed, or null. */
  const visit = (x: unknown): JsonBound | null => {
    if (++values > b.maxValues) return 'values';
    if (typeof x === 'string') {
      if (x.length > maxString) return 'string';
      bytes += x.length + 2;
    } else if (typeof x === 'number') bytes += 24;
    else if (typeof x === 'boolean' || x === null || x === undefined) bytes += 5;
    else if (typeof x === 'object') {
      if (containers.length + 1 > b.maxDepth) return 'depth';
      bytes += 2;
      if (Array.isArray(x)) {
        // Every element is a value: a list longer than what is left of the bound is over it, whatever it holds.
        if (values + x.length > b.maxValues) return 'values';
        bytes += x.length;
        containers.push(x);
        keyLists.push(null);
      } else {
        const keys = Object.keys(x);
        if (values + keys.length > b.maxValues) return 'values';
        containers.push(x as Rec);
        keyLists.push(keys);
      }
      next.push(0);
    } else return 'values';
    return bytes > maxBytes ? 'bytes' : null;
  };

  const first = visit(value);
  if (first) return first;
  while (containers.length > 0) {
    const top = containers.length - 1;
    const c = containers[top]!;
    const keys = keyLists[top]!;
    const i = next[top]!;
    const size = keys === null ? (c as unknown[]).length : keys.length;
    if (i >= size) {
      containers.pop();
      keyLists.pop();
      next.pop();
      continue;
    }
    next[top] = i + 1;
    let child: unknown;
    if (keys === null) child = (c as unknown[])[i];
    else {
      const k = keys[i]!;
      if (k.length > maxString) return 'string';
      bytes += k.length + 4;
      child = (c as Rec)[k];
    }
    const over = visit(child);
    if (over) return over;
  }
  return null;
}
