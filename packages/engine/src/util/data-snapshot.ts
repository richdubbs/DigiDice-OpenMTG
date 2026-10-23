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

/** The tokens of a plain-data value (see the module comment). */
export function snapshotOf(value: unknown): DataSnapshot {
  const out: unknown[] = [];
  emit(value, out);
  return out;
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

/** Does `value` still produce exactly the tokens of `snap`? */
export function matchesSnapshot(snap: DataSnapshot, value: unknown): boolean {
  const cursor = { snap, i: 0 };
  return same(value, cursor) && cursor.i === snap.length;
}

interface Cursor { readonly snap: DataSnapshot; i: number }

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
