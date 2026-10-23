/**
 * Reading of the generated JSON Schema (model/schema.generated.json, generated from types/ability.ts by scripts/gen-ability-schema.ts). Owner: WP1.
 *
 * The validator (model/validate.ts) and the typed walker (model/walk.ts) both need to answer one question about a JSON value: "which schema
 * alternative describes this value?". The generated schema is a tree of `$ref`, `anyOf` (unions), objects with `properties` / `required` /
 * `additionalProperties: false`, arrays, and `const` / `enum` primitives. Every union of objects in the model is discriminated by a short tag
 * (`kind`, `op`, `cond`, `q`, `ref`, `ev`, `s`, `d`, `b`, `layer`, `zone`, ...), so the answer is an O(1) lookup after a one-time index per union.
 * The only ambiguity is `Ref = ObjRef | PlayerRef`: the same tag value can exist in both (`{ref:'target'}`), and `fits` (a shallow structural
 * check) chooses. This module has no dependency and no I/O (the schema is a JSON import).
 */
import schemaJson from './schema.generated.json';

export interface Schema {
  $ref?: string;
  anyOf?: Schema[];
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  not?: Schema;
}

interface RootSchema {
  $ref: string;
  definitions: Record<string, Schema>;
}

const ROOT = schemaJson as unknown as RootSchema;
export const DEFINITIONS: Readonly<Record<string, Schema>> = ROOT.definitions;
/** Name of the root definition ("AbilityDef"). */
export const ROOT_DEFINITION = ROOT.$ref.replace('#/definitions/', '');

/** One concrete (non-union, non-reference) alternative, with the definition names that were crossed to reach it, outermost first. */
export interface Leaf {
  schema: Schema;
  names: readonly string[];
}

export interface Union {
  leaves: Leaf[];
  prims: Leaf[];
  arrays: Leaf[];
  objects: Leaf[];
  nulls: Leaf[];
  /** Property that is a `const` / `enum` in every object alternative (the discriminator), when there are at least two object alternatives. */
  tagKey: string | null;
  byTag: Map<unknown, Leaf[]>;
}

const refName = (ref: string): string => ref.slice(ref.lastIndexOf('/') + 1);

function collect(s: Schema, names: readonly string[], out: Leaf[]): void {
  if (s.$ref !== undefined) {
    const name = refName(s.$ref);
    const target = DEFINITIONS[name];
    if (target === undefined) throw new Error(`model/schema: unknown definition ${name}`);
    collect(target, [...names, name], out);
    return;
  }
  if (s.anyOf !== undefined) {
    for (const a of s.anyOf) collect(a, names, out);
    return;
  }
  out.push({ schema: s, names });
}

const typesOf = (s: Schema): string[] => (s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type]);

/** The values a property can take when it is a literal (const / enum), looking through one chain of references; null if it is not a literal. */
function tagValues(prop: Schema | undefined): unknown[] | null {
  let p = prop;
  while (p?.$ref !== undefined) p = DEFINITIONS[refName(p.$ref)];
  if (p === undefined) return null;
  if (p.const !== undefined) return [p.const];
  if (p.enum !== undefined) return p.enum;
  return null;
}

function buildUnion(s: Schema, names: readonly string[]): Union {
  const leaves: Leaf[] = [];
  collect(s, names, leaves);
  const u: Union = { leaves, prims: [], arrays: [], objects: [], nulls: [], tagKey: null, byTag: new Map() };
  for (const l of leaves) {
    const t = typesOf(l.schema);
    if (t.includes('object')) u.objects.push(l);
    else if (t.includes('array')) u.arrays.push(l);
    else if (t.length === 1 && t[0] === 'null') u.nulls.push(l);
    else u.prims.push(l);
    // a leaf such as ["number","null"] is both a primitive and a null alternative
    if (t.includes('null') && t.length > 1) u.nulls.push(l);
  }
  if (u.objects.length >= 2) {
    const first = u.objects[0]!.schema.properties ?? {};
    for (const key of Object.keys(first)) {
      if (u.objects.every((l) => tagValues(l.schema.properties?.[key]) !== null)) {
        u.tagKey = key;
        break;
      }
    }
    if (u.tagKey !== null) {
      for (const l of u.objects) {
        for (const v of tagValues(l.schema.properties?.[u.tagKey]) ?? []) {
          const list = u.byTag.get(v);
          if (list) list.push(l);
          else u.byTag.set(v, [l]);
        }
      }
    }
  }
  return u;
}

const UNIONS = new WeakMap<Schema, Union>();
const DEF_NODES = new Map<string, Schema>();

/** The (memoized) union index of a schema node. A property schema is always entered with no names crossed yet. */
export function unionOf(s: Schema): Union {
  let u = UNIONS.get(s);
  if (u === undefined) {
    u = buildUnion(s, []);
    UNIONS.set(s, u);
  }
  return u;
}

/** A schema node that refers to the named definition (stable identity, so the union index is memoized). */
export function defNode(name: string): Schema {
  let n = DEF_NODES.get(name);
  if (n === undefined) {
    if (DEFINITIONS[name] === undefined) throw new Error(`model/schema: unknown definition ${name}`);
    n = { $ref: `#/definitions/${name}` };
    DEF_NODES.set(name, n);
  }
  return n;
}

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Does a primitive leaf accept this primitive value? */
export function primAccepts(l: Leaf, value: unknown): boolean {
  const s = l.schema;
  const t = typesOf(s);
  const jsType = value === null ? 'null' : typeof value;
  if (!t.includes(jsType)) return false;
  if (s.const !== undefined && s.const !== value) return false;
  if (s.enum !== undefined && !s.enum.includes(value)) return false;
  return true;
}

/** Shallow structural fit of an object value to an object leaf: every required key present, no key the leaf does not declare. */
export function fits(l: Leaf, value: Record<string, unknown>): boolean {
  const props = l.schema.properties ?? {};
  for (const r of l.schema.required ?? []) if (value[r] === undefined) return false;
  if (l.schema.additionalProperties === false) {
    for (const k of Object.keys(value)) if (value[k] !== undefined && props[k] === undefined) return false;
  }
  for (const [k, p] of Object.entries(props)) {
    const tv = tagValues(p);
    if (tv !== null && value[k] !== undefined && !tv.includes(value[k])) return false;
  }
  return true;
}

export type Pick =
  | { ok: true; leaf: Leaf }
  | { ok: false; reason: 'no-alternative' | 'unknown-tag' | 'missing-tag'; tagKey?: string; tag?: unknown };

/** Choose the alternative of a union that describes `value` (no recursion into children). */
export function pick(u: Union, value: unknown): Pick {
  if (value === null) {
    const l = u.nulls[0];
    return l ? { ok: true, leaf: l } : { ok: false, reason: 'no-alternative' };
  }
  if (Array.isArray(value)) {
    const l = u.arrays[0];
    return l ? { ok: true, leaf: l } : { ok: false, reason: 'no-alternative' };
  }
  if (isRecord(value)) {
    const objs = u.objects;
    if (objs.length === 0) return { ok: false, reason: 'no-alternative' };
    if (objs.length === 1) return { ok: true, leaf: objs[0]! };
    if (u.tagKey === null) {
      const f = objs.find((l) => fits(l, value));
      return { ok: true, leaf: f ?? objs[0]! };
    }
    const tag = value[u.tagKey];
    if (tag === undefined) return { ok: false, reason: 'missing-tag', tagKey: u.tagKey };
    const cands = u.byTag.get(tag);
    if (cands === undefined || cands.length === 0) return { ok: false, reason: 'unknown-tag', tagKey: u.tagKey, tag };
    if (cands.length === 1) return { ok: true, leaf: cands[0]! };
    return { ok: true, leaf: cands.find((l) => fits(l, value)) ?? cands[0]! };
  }
  const p = u.prims.find((l) => primAccepts(l, value));
  return p ? { ok: true, leaf: p } : { ok: false, reason: 'no-alternative' };
}

/** Human description of what a union accepts, for error messages (kept short). */
export function describe(u: Union): string {
  const parts: string[] = [];
  const consts = new Set<string>();
  const kinds = new Set<string>();
  for (const l of u.prims) {
    if (l.schema.const !== undefined) consts.add(JSON.stringify(l.schema.const));
    else if (l.schema.enum !== undefined) for (const v of l.schema.enum) consts.add(JSON.stringify(v));
    else for (const t of typesOf(l.schema)) kinds.add(t);
  }
  if (kinds.size) parts.push([...kinds].join(' or '));
  if (consts.size) parts.push(`one of ${[...consts].slice(0, 12).join(', ')}${consts.size > 12 ? ', ...' : ''}`);
  if (u.arrays.length) parts.push('an array');
  if (u.objects.length) {
    parts.push(u.tagKey !== null ? `an object with "${u.tagKey}"` : 'an object');
  }
  if (u.nulls.length) parts.push('null');
  return parts.join(', or ') || 'nothing';
}

/** The tag values a union knows for its discriminator, for "unknown op" messages. */
export function knownTags(u: Union): unknown[] {
  return [...u.byTag.keys()];
}
