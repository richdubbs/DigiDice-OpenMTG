/**
 * The typed walker: visits every object of an ability (or of any sub-tree of one) together with the name of the model type that describes it.
 * Owner: WP1. It is driven by the generated JSON Schema (model/schema.ts), so it covers every node of types/ability.ts without a hand-kept
 * list of fields, and a new field or op is walked the day the schema is regenerated.
 *
 * The walker never validates: a value that no schema alternative describes is skipped together with its children (the validator reports it).
 * Every consumer in model/ (lint, capabilities, degrade, classify, strip, canonical) is built on it.
 */
import { defNode, isRecord, pick, ROOT_DEFINITION, unionOf, type Schema } from './schema';

export interface WalkNode {
  /** The JSON object. */
  value: Record<string, unknown>;
  /** The innermost model type that describes it: 'EffectStep', 'Quantity', 'ObjRef', 'TargetSpec', ...; 'Parent.slot' for an anonymous inline object. */
  def: string;
  /** Every definition name crossed on the way to this object, outermost first ('Count' then 'Quantity'). */
  names: readonly string[];
  /** JSON pointer from the root of the walk ("" for the root; array elements are numeric segments). */
  path: string;
  parent: WalkNode | null;
  /** The property of `parent` that holds this object (or the array that holds it). '' for the root. */
  slot: string;
  /** Index inside the array held by `slot`, or null. */
  index: number | null;
}

/** Return `false` to skip the children of the node. */
export type Visit = (node: WalkNode) => void | false;

const escapeKey = (k: string): string => k.replace(/~/g, '~0').replace(/\//g, '~1');
/** JSON pointer segment for a property name or index. */
export const seg = (k: string | number): string => (typeof k === 'number' ? String(k) : escapeKey(k));

function descend(value: unknown, schema: Schema, parent: WalkNode | null, slot: string, index: number | null, path: string, visit: Visit): void {
  if (value === undefined || value === null) return;
  const p = pick(unionOf(schema), value);
  if (!p.ok) return;
  const s = p.leaf.schema;
  if (Array.isArray(value)) {
    const items = s.items;
    if (items === undefined) return;
    for (let i = 0; i < value.length; i++) descend(value[i], items, parent, slot, i, `${path}/${i}`, visit);
    return;
  }
  if (!isRecord(value)) return;
  const names = p.leaf.names;
  const def = names.length > 0 ? names[names.length - 1]! : `${parent?.def ?? ''}.${slot}`;
  const node: WalkNode = { value, def, names, path, parent, slot, index };
  if (visit(node) === false) return;
  const props = s.properties;
  if (props === undefined) return;
  for (const key of Object.keys(value)) {
    const ps = props[key];
    if (ps !== undefined) descend(value[key], ps, node, key, null, `${path}/${seg(key)}`, visit);
  }
}

/** Walk a value that is an instance of the named model type (default: an AbilityDef). `path` / `parent` let a sub-tree walk continue a larger walk. */
export function walkValue(value: unknown, defName: string, visit: Visit, from: { path?: string; parent?: WalkNode | null; slot?: string } = {}): void {
  descend(value, defNode(defName), from.parent ?? null, from.slot ?? '', null, from.path ?? '', visit);
}

export const walkAbility = (def: unknown, visit: Visit, from: { path?: string; parent?: WalkNode | null; slot?: string } = {}): void =>
  walkValue(def, ROOT_DEFINITION, visit, from);

/** The model types that are abilities (a nested one starts a new scope for names, targets and links). */
export const ABILITY_DEFS: ReadonlySet<string> = new Set([
  'SpellAbilityDef', 'ActivatedAbilityDef', 'TriggeredAbilityDef', 'StaticAbilityDef', 'KeywordAbilityDef', 'ChapterAbilityDef',
  'ClassLevelDef', 'LevelBracketDef', 'CaseDef' /* M6-0 */, 'ManualAbilityDef',
]);

/** True for an ability node that is nested inside another node of the walk (a granted ability, a token's ability, a class level's ability). */
export const isNestedAbility = (n: WalkNode): boolean => ABILITY_DEFS.has(n.def) && n.parent !== null;

/** Ancestors from the parent up to the root. */
export function* ancestors(n: WalkNode): Generator<WalkNode> {
  for (let a = n.parent; a !== null; a = a.parent) yield a;
}

/** The nearest ancestor (excluding the node) with this definition name, stopping at the enclosing ability boundary. */
export function enclosing(n: WalkNode, def: string): WalkNode | null {
  for (const a of ancestors(n)) {
    if (a.def === def) return a;
    if (ABILITY_DEFS.has(a.def)) return null;
  }
  return null;
}
