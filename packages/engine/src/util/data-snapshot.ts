/**
 * Exact change detection for plain JSON-like data (package P1, performance). `snapshotOf(v)` records `v` as a flat list of tokens (keys and primitive values in
 * iteration order, with markers for the structure); `matchesSnapshot(snap, v)` walks `v` the same way and compares token by token, stopping at the first
 * difference. It replaces `JSON.stringify(v) === previous` where `v` may have been edited in place: the same answer whenever the strings would differ (key order,
 * values, structure; an `undefined` object property is skipped exactly as JSON skips it) and never "equal" when they differ, but without building and comparing a
 * string the size of the whole state, and without allocating anything while comparing.
 *
 * Stricter than JSON in harmless ways only (a difference JSON would hide, such as NaN against null, is reported as a change: a cache miss, never a stale answer).
 * An unchanged NaN matches itself (NaN !== NaN, so primitives are compared as "=== or both NaN"; -0 and 0 match, as JSON writes both 0): a value holding NaN
 * would otherwise never hit. Pure: no state is kept here.
 */

/** Structure markers: unique objects, so they can never be equal to a key or a primitive value. */
const ARRAY = { marker: 'array' };
const OBJECT = { marker: 'object' };
const END = { marker: 'end' };

export type DataSnapshot = readonly unknown[];

/**
 * Review 2026-10-26 (performance): keys left out of the records of one part. When the value is a list of parts, the part at index `part` is a map (or a list)
 * of records, and each of those records is recorded and compared without the keys in `keys` (rules/characteristics.ts: the objects of a state without the
 * fields the layers did not read). Pass the same omission to `snapshotOf` and `matchesSnapshot`.
 */
export interface Omission {
  readonly part: number;
  /** A few keys (a list: comparing a key with each is faster than a set lookup for so few). */
  readonly keys: readonly string[];
}

/** The tokens of a plain-data value (see the module comment), optionally with an omission. */
export function snapshotOf(value: unknown, omit?: Omission): DataSnapshot {
  const out: unknown[] = [];
  if (omit !== undefined && Array.isArray(value)) {
    out.push(ARRAY, value.length);
    for (let i = 0; i < value.length; i++) {
      if (i === omit.part) emitRecords(value[i], omit.keys, out);
      else emit(value[i], out);
    }
  } else emit(value, out);
  return out;
}

function emitRecords(m: unknown, keys: readonly string[], out: unknown[]): void {
  if (m === null || typeof m !== 'object') return emit(m, out);
  if (Array.isArray(m)) {
    out.push(ARRAY, m.length);
    for (let i = 0; i < m.length; i++) emitRecord(m[i], keys, out);
    return;
  }
  out.push(OBJECT);
  const r = m as Record<string, unknown>;
  for (const k in r) {
    const x = r[k];
    if (x === undefined) continue;
    out.push(k);
    emitRecord(x, keys, out);
  }
  out.push(END);
}

function emitRecord(v: unknown, keys: readonly string[], out: unknown[]): void {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return emit(v, out);
  out.push(OBJECT);
  const r = v as Record<string, unknown>;
  for (const k in r) {
    const x = r[k];
    if (x === undefined || omitted(keys, k)) continue;
    out.push(k);
    emit(x, out);
  }
  out.push(END);
}

function emit(v: unknown, out: unknown[]): void {
  if (v === null || typeof v !== 'object') {
    out.push(v);
    return;
  }
  if (Array.isArray(v)) {
    out.push(ARRAY, v.length);
    for (let i = 0; i < v.length; i++) emit(v[i], out);
    return;
  }
  out.push(OBJECT);
  const r = v as Record<string, unknown>;
  for (const k in r) {
    const x = r[k];
    if (x === undefined) continue; // JSON.stringify leaves such a property out
    out.push(k);
    emit(x, out);
  }
  out.push(END);
}

/** Does `value` still produce exactly the tokens of `snap` (taken with the same omission)? */
export function matchesSnapshot(snap: DataSnapshot, value: unknown, omit?: Omission): boolean {
  const cursor = { snap, i: 0 };
  if (omit === undefined || !Array.isArray(value)) return same(value, cursor) && cursor.i === snap.length;
  if (snap[0] !== ARRAY || snap[1] !== value.length) return false;
  cursor.i = 2;
  for (let i = 0; i < value.length; i++) if (!(i === omit.part ? sameRecords(value[i], omit.keys, cursor) : same(value[i], cursor))) return false;
  return cursor.i === snap.length;
}

interface Cursor { readonly snap: DataSnapshot; i: number }

function sameRecords(m: unknown, keys: readonly string[], c: Cursor): boolean {
  if (m === null || typeof m !== 'object') return same(m, c);
  const t = c.snap;
  if (Array.isArray(m)) {
    if (t[c.i] !== ARRAY || t[c.i + 1] !== m.length) return false;
    c.i += 2;
    for (let i = 0; i < m.length; i++) if (!sameRecord(m[i], keys, c)) return false;
    return true;
  }
  if (t[c.i++] !== OBJECT) return false;
  const r = m as Record<string, unknown>;
  for (const k in r) {
    const x = r[k];
    if (x === undefined) continue;
    if (t[c.i++] !== k) return false;
    if (!sameRecord(x, keys, c)) return false;
  }
  return t[c.i++] === END;
}

function sameRecord(v: unknown, keys: readonly string[], c: Cursor): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return same(v, c);
  const t = c.snap;
  if (t[c.i++] !== OBJECT) return false;
  const r = v as Record<string, unknown>;
  for (const k in r) {
    const x = r[k];
    if (x === undefined || omitted(keys, k)) continue;
    if (t[c.i++] !== k) return false;
    if (!same(x, c)) return false;
  }
  return t[c.i++] === END;
}

function same(v: unknown, c: Cursor): boolean {
  const t = c.snap;
  if (v === null || typeof v !== 'object') {
    const x = t[c.i++];
    return x === v || (x !== x && v !== v); // both NaN: the same value
  }
  if (Array.isArray(v)) {
    if (t[c.i] !== ARRAY || t[c.i + 1] !== v.length) return false;
    c.i += 2;
    for (let i = 0; i < v.length; i++) if (!same(v[i], c)) return false;
    return true;
  }
  if (t[c.i++] !== OBJECT) return false;
  const r = v as Record<string, unknown>;
  for (const k in r) {
    const x = r[k];
    if (x === undefined) continue;
    if (t[c.i++] !== k) return false;
    if (!same(x, c)) return false;
  }
  return t[c.i++] === END;
}

function omitted(keys: readonly string[], k: string): boolean {
  for (let i = 0; i < keys.length; i++) if (keys[i] === k) return true;
  return false;
}
