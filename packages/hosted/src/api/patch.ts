/**
 * View patches (design D8, 3.4 `patch`, 6.3): the hosted server sends each seat a full view on (re)connect, on `sync` and after a slow connection
 * catches up, and otherwise a patch against the last view that connection received. A full view averages 154 KB, a patch 3.5 KB (design 9.1).
 *
 * The contract:
 * - `diffViews(prev, next)` is a pure diff of two views **of the same seat** (`viewFor(state, seat)` before and after a change). It can carry nothing a
 *   view does not carry: every value in it is a part of `next` (design 6.3).
 * - `applyViewPatch(prev, diffViews(prev, next))` rebuilds `next` exactly: the same JSON text, key order included (pinned on real engine views of
 *   seeded AI-against-AI games, test/m13-1/patch.test.ts).
 * - Values are compared as JSON: the views travel as JSON text, so a key whose value is `undefined` counts as absent and an `undefined` array element as
 *   null. Diff what you serialize; apply to what you parsed.
 * - `applyPatch` never changes its input (the browser keeps its views in React state): it copies the containers on the paths it changes and shares the
 *   rest. It checks every op and throws `PatchError` on anything that does not fit the view (a missing path, a wrong type, a bad index); the browser then
 *   sends `sync` for a full view. Keys are set as own data properties, so a key such as "__proto__" stays a plain key (as `JSON.parse` makes it).
 *
 * Browser-safe: no imports but engine types.
 */
import type { GameView } from '@openmtg/engine';

/** A path from the root: object keys (strings) and array indexes (numbers). */
export type JsonPath = (string | number)[];

export type PatchOp =
  /** Replace the value at `path` (an existing array index, a new or existing object key; `[]`: the whole value). */
  | { op: 'set'; path: JsonPath; value: unknown }
  /** Delete the object key at `path`. */
  | { op: 'del'; path: JsonPath }
  /** In the array at `path`: remove `del` elements at index `at` and insert `add` there. */
  | { op: 'splice'; path: JsonPath; at: number; del: number; add: unknown[] }
  /** Put the object at `path`'s keys in this order (the same keys; JSON key order is part of "exactly"). */
  | { op: 'keys'; path: JsonPath; keys: string[] };

export class PatchError extends Error {
  override readonly name = 'PatchError';
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** JSON's view of a value: `undefined` (in an array) is null. */
const norm = (x: unknown): unknown => (x === undefined ? null : x);

/** An object's keys as JSON sees them (keys whose value is undefined are not written). */
function jsonKeys(o: Obj): string[] {
  return Object.keys(o).filter((k) => o[k] !== undefined);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** JSON equality, key order included. */
export function jsonEqual(x: unknown, y: unknown): boolean {
  const a = norm(x);
  const b = norm(y);
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = jsonKeys(a);
    const kb = jsonKeys(b);
    if (!sameList(ka, kb)) return false;
    for (const k of ka) if (!jsonEqual(a[k], b[k])) return false;
    return true;
  }
  return false; // different primitives (NaN is not JSON)
}

/** An upper estimate of a value's JSON size (bytes for ASCII text), iterative. Used to choose the smaller of two equivalent patches. */
function approxSize(value: unknown): number {
  const stack: unknown[] = [value];
  let n = 0;
  while (stack.length) {
    const x = norm(stack.pop());
    if (typeof x === 'string') n += x.length + 2;
    else if (typeof x === 'number') n += 8;
    else if (typeof x === 'boolean' || x === null) n += 5;
    else if (Array.isArray(x)) {
      n += 2 + x.length;
      for (const v of x) stack.push(v);
    } else if (isObj(x)) {
      n += 2;
      for (const k of jsonKeys(x)) {
        n += k.length + 4;
        stack.push(x[k]);
      }
    }
  }
  return n;
}

function opsSize(ops: readonly PatchOp[]): number {
  let n = 0;
  for (const op of ops) {
    n += 24 + op.path.length * 8;
    if (op.op === 'set') n += approxSize(op.value);
    else if (op.op === 'splice') n += approxSize(op.add);
    else if (op.op === 'keys') n += approxSize(op.keys);
  }
  return n;
}

/** The key order JavaScript gives an object whose keys were inserted in this order (integer-like keys come first, ascending). */
function insertionOrder(keys: readonly string[]): string[] {
  const o: Obj = {};
  for (const k of keys) Object.defineProperty(o, k, { value: 0, enumerable: true, configurable: true, writable: true });
  return Object.keys(o);
}

class Differ {
  readonly ops: PatchOp[] = [];
  private readonly path: (string | number)[] = [];

  at(...tail: (string | number)[]): JsonPath {
    return [...this.path, ...tail];
  }

  any(x: unknown, y: unknown): void {
    const a = norm(x);
    const b = norm(y);
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) return this.array(a, b);
    if (isObj(a) && isObj(b)) return this.object(a, b);
    this.ops.push({ op: 'set', path: this.at(), value: b });
  }

  private child(k: string | number, x: unknown, y: unknown): void {
    this.path.push(k);
    this.any(x, y);
    this.path.pop();
  }

  private object(a: Obj, b: Obj): void {
    const ka = jsonKeys(a);
    const kb = jsonKeys(b);
    const inB = new Set(kb);
    const inA = new Set(ka);
    let deleted = 0;
    for (const k of ka) {
      if (!inB.has(k)) {
        this.ops.push({ op: 'del', path: this.at(k) });
        deleted++;
      }
    }
    const added: string[] = [];
    for (const k of kb) {
      if (inA.has(k)) this.child(k, a[k], b[k]);
      else {
        this.ops.push({ op: 'set', path: this.at(k), value: b[k] });
        added.push(k);
      }
    }
    // Exactly: the keys in next's order. Applying the ops above gives a's remaining keys, then the added ones (as JavaScript orders them).
    const result = deleted === 0 && added.length === 0 ? ka : insertionOrder([...ka.filter((k) => inB.has(k)), ...added]);
    if (!sameList(result, kb)) this.ops.push({ op: 'keys', path: this.at(), keys: kb });
  }

  private array(a: unknown[], b: unknown[]): void {
    const la = a.length;
    const lb = b.length;
    const min = Math.min(la, lb);
    let p = 0;
    while (p < min && jsonEqual(a[p], b[p])) p++;
    let s = 0;
    while (s < min - p && jsonEqual(a[la - 1 - s], b[lb - 1 - s])) s++;
    const ma = la - p - s; // the changed middle of a
    const mb = lb - p - s; // and of b
    if (ma === 0 && mb === 0) return;
    const splice: PatchOp = { op: 'splice', path: this.at(), at: p, del: ma, add: b.slice(p, lb - s) };
    if (ma === 0 || mb === 0) {
      this.ops.push(splice);
      return;
    }
    // Pair the middle's elements one by one (in-place changes), splicing what is left over; or replace the middle: whichever is smaller.
    const pairs = Math.min(ma, mb);
    const sub = new Differ();
    for (const seg of this.path) sub.path.push(seg);
    for (let i = p; i < p + pairs; i++) sub.child(i, a[i], b[i]);
    if (ma !== mb) sub.ops.push({ op: 'splice', path: this.at(), at: p + pairs, del: ma - pairs, add: b.slice(p + pairs, lb - s) });
    if (opsSize(sub.ops) <= opsSize([splice])) for (const op of sub.ops) this.ops.push(op);
    else this.ops.push(splice);
  }
}

/** The ops that turn `prev` into `next` (JSON values). `applyPatch(prev, diffJson(prev, next))` is `next`, exactly. */
export function diffJson(prev: unknown, next: unknown): PatchOp[] {
  const d = new Differ();
  d.any(prev, next);
  return d.ops;
}

/** The ops that turn one view of a seat into the next view of the same seat. Throws if the views are not of the same viewer. */
export function diffViews(prev: GameView, next: GameView): PatchOp[] {
  if (prev.viewer !== next.viewer) throw new Error(`diffViews: views of different viewers (${String(prev.viewer)}, ${String(next.viewer)}).`);
  return diffJson(prev, next);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Applying

function setOwn(o: Obj, k: string, value: unknown): void {
  Object.defineProperty(o, k, { value, enumerable: true, configurable: true, writable: true });
}

function shallowCopy(x: unknown): unknown {
  if (Array.isArray(x)) return x.slice();
  const o: Obj = {};
  for (const k of Object.keys(x as Obj)) setOwn(o, k, (x as Obj)[k]);
  return o;
}

function isIndex(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0;
}

function checkPath(path: unknown): JsonPath {
  if (!Array.isArray(path)) throw new PatchError('A patch path is not a list.');
  for (const seg of path) if (typeof seg !== 'string' && !isIndex(seg)) throw new PatchError('A patch path segment is neither a key nor an index.');
  return path as JsonPath;
}

/**
 * Apply `ops` to `base` and return the result; `base` is never changed (the containers on changed paths are copied once, the rest is shared). Throws
 * `PatchError` when an op does not fit (the caller then asks for a full view).
 */
export function applyPatch<T>(base: T, ops: readonly PatchOp[]): T {
  if (!Array.isArray(ops)) throw new PatchError('The patch is not a list of operations.');
  let root: unknown = base;
  const copied = new Set<unknown>();

  /** The container at the first `n` segments of `path`, copied (once) so that it may be changed. */
  const container = (path: JsonPath, n: number): Obj | unknown[] => {
    if (typeof root !== 'object' || root === null) throw new PatchError('The patch goes into a value that is not an object or a list.');
    if (!copied.has(root)) {
      root = shallowCopy(root);
      copied.add(root);
    }
    let cur = root as Obj | unknown[];
    for (let i = 0; i < n; i++) {
      const seg = path[i]!;
      let next: unknown;
      if (Array.isArray(cur)) {
        if (!isIndex(seg) || seg >= cur.length) throw new PatchError(`No element ${String(seg)} at ${JSON.stringify(path.slice(0, i))}.`);
        next = cur[seg];
      } else {
        if (typeof seg !== 'string' || !own(cur, seg)) throw new PatchError(`No key ${JSON.stringify(seg)} at ${JSON.stringify(path.slice(0, i))}.`);
        next = cur[seg];
      }
      if (typeof next !== 'object' || next === null) throw new PatchError(`${JSON.stringify(path.slice(0, i + 1))} is not an object or a list.`);
      if (!copied.has(next)) {
        next = shallowCopy(next);
        copied.add(next);
        if (Array.isArray(cur)) cur[seg as number] = next;
        else setOwn(cur, seg as string, next);
      }
      cur = next as Obj | unknown[];
    }
    return cur;
  };

  for (const raw of ops) {
    if (!isObj(raw)) throw new PatchError('A patch operation is not an object.');
    const op = raw as PatchOp;
    const path = checkPath(op.path);
    switch (op.op) {
      case 'set': {
        if (!('value' in op)) throw new PatchError('A set operation has no value.');
        if (path.length === 0) {
          root = op.value;
          break;
        }
        const c = container(path, path.length - 1);
        const k = path[path.length - 1]!;
        if (Array.isArray(c)) {
          if (!isIndex(k) || k >= c.length) throw new PatchError(`No element ${String(k)} to set at ${JSON.stringify(path)}.`);
          c[k] = op.value;
        } else {
          if (typeof k !== 'string') throw new PatchError(`An index into an object at ${JSON.stringify(path)}.`);
          if (own(c, k) && c[k] === undefined) delete c[k]; // absent as JSON sees it: a new key goes last, as the diff expects
          setOwn(c, k, op.value);
        }
        break;
      }
      case 'del': {
        if (path.length === 0) throw new PatchError('A delete operation without a key.');
        const c = container(path, path.length - 1);
        const k = path[path.length - 1]!;
        if (Array.isArray(c) || typeof k !== 'string' || !own(c, k)) throw new PatchError(`No key to delete at ${JSON.stringify(path)}.`);
        delete c[k];
        break;
      }
      case 'splice': {
        const c = container(path, path.length);
        if (!Array.isArray(c)) throw new PatchError(`${JSON.stringify(path)} is not a list.`);
        if (!isIndex(op.at) || !isIndex(op.del) || op.at > c.length || op.del > c.length - op.at || !Array.isArray(op.add)) {
          throw new PatchError(`A splice that does not fit the list at ${JSON.stringify(path)}.`);
        }
        // No spread: a call's arguments are capped (near 65,536 in Safari), and a list may grow by more in one patch.
        const tail = c.slice(op.at + op.del);
        c.length = op.at;
        for (const x of op.add) c.push(x);
        for (const x of tail) c.push(x);
        break;
      }
      case 'keys': {
        const c = container(path, path.length);
        if (Array.isArray(c)) throw new PatchError(`${JSON.stringify(path)} is not an object.`);
        const keys = op.keys;
        const current = jsonKeys(c);
        if (!Array.isArray(keys) || keys.length !== current.length || new Set(keys).size !== keys.length || !keys.every((k) => typeof k === 'string' && own(c, k))) {
          throw new PatchError(`A key order that does not fit the object at ${JSON.stringify(path)}.`);
        }
        for (const k of keys) {
          const v = c[k];
          delete c[k];
          setOwn(c, k, v);
        }
        break;
      }
      default:
        throw new PatchError(`Unknown patch operation ${JSON.stringify((op as { op?: unknown }).op)}.`);
    }
  }
  return root as T;
}

/** Apply a view patch (`diffViews`) to this seat's previous view. */
export function applyViewPatch(prev: GameView, ops: readonly PatchOp[]): GameView {
  return applyPatch(prev, ops);
}

/**
 * The browser's step for a `patch` message: the next `{ seq, view }`, or null when the patch's `base` is not the view held, the patch does not fit, or
 * its result is not a view of the same seat (a non-null object, not a list, with the same `viewer`: a patch that sets the root to 42 or null, or to
 * another seat's view, is refused). On null the browser sends `sync` and waits for a full view.
 */
export function nextView(current: { seq: number; view: GameView } | null, patch: { seq: number; base: number; ops: readonly PatchOp[] }): { seq: number; view: GameView } | null {
  if (!current || current.seq !== patch.base || !(patch.seq > patch.base)) return null;
  try {
    const view: unknown = applyViewPatch(current.view, patch.ops);
    if (typeof view !== 'object' || view === null || Array.isArray(view)) return null;
    if ((view as { viewer?: unknown }).viewer !== current.view.viewer) return null;
    return { seq: patch.seq, view: view as GameView };
  } catch (e) {
    if (e instanceof PatchError) return null;
    throw e;
  }
}
