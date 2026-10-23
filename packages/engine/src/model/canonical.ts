/**
 * The canonical form of an ability: one JSON per meaning (design 5.3). Owner: WP1. Contract: model/api.ts#Canonicalize.
 *
 * Used by the cache, the diff tools, the corpus snapshot and the "two LLM runs agree" check (design 11.3). What it does, node by node (the node types
 * come from the generated schema, so a new field is canonicalized with its container):
 *   - key order: the discriminator first (`kind`, `op`, `cond`, `q`, `ref`, `ev`, `s`, `d`, `b`, `layer`, `at`), then the other keys alphabetically;
 *     `undefined` values are dropped;
 *   - defaults removed, only where the type has one (design 3.2): a filter's zone `battlefield`, a library destination's position `top`, a
 *     chooser that is the controller, an optional flag that is `false` (never inside an ObjectFilter or EventPattern, where `false` is meaningful);
 *     NOTHING is removed from `who`, `source`, `caster`, `payer` or a battlefield `controller`;
 *   - arrays whose order is meaningless are sorted and deduplicated (types, subtypes, colors in WUBRG order, keywords, zones, `anyOf`, the operands of
 *     `all`/`any`, the operands of commutative `math`); a one-element list that has a scalar form takes it (`keyword:["flying"]` is `keyword:"flying"`);
 *   - `all`/`any` of one condition is that condition, nested `all` in `all` (and `any` in `any`) is flattened, `not not c` is `c`; the same for a lone
 *     `anyOf` filter and a commutative `math` with one operand;
 *   - the zone of a zone-change pattern's subject is dropped (design 3.3: it is ignored there); so is an ability's own `zone` when it is the default
 *     battlefield (CR 113.6);
 *   - `addMana.units`: each unit's types and the units themselves in WUBRG-then-colorless order; `delay.capture` as a set.
 * It never touches display data (`text`, `span`, `label`), `src`, `prov` or the order of anything that is executed (steps, cost parts, mana symbols).
 * Idempotent and pure: the input is not modified.
 */
import type { AbilityDef } from '../types/ability';
import type { Canonicalize } from './api';
import { defNode, isRecord, pick, ROOT_DEFINITION, unionOf, type Schema } from './schema';

type Rec = Record<string, unknown>;

const TAG_KEYS = ['kind', 'op', 'cond', 'q', 'ref', 'ev', 's', 'd', 'b', 'layer', 'at'];
const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const MANA_ORDER = [...WUBRG, 'C'];
/** Abilities whose `zone` defaults to the battlefield (types/ability.ts, CR 113.6): the default is not written. */
const BATTLEFIELD_DEFAULT: ReadonlySet<string> = new Set(['ActivatedAbilityDef', 'TriggeredAbilityDef', 'StaticAbilityDef']);

/** Optional flags whose absence means `false`, by the model type that owns them. */
const FALSE_IS_ABSENT: Readonly<Record<string, readonly string[]>> = {
  ActivatedAbilityDef: ['isMana', 'isLoyalty', 'sorcerySpeed'],
  EffectStep: ['unpreventable', 'random', 'reveal', 'tapped', 'attacking', 'manifest', 'free', 'optional', 'mandatory'],
  CostPart: ['random', 'self', 'hand', 'other'],
  ModeSpec: ['allowRepeat'],
  ReplacementDef: ['optional', 'selfReplacement'],
  AdditionalCostDef: ['optional', 'repeatable'],
  ContinuousEffectDef: ['cda'],
  TriggerDef: ['batch'],
  Destination: ['tapped', 'faceDown', 'transformed', 'attacking'],
};

/** String sets (order is meaningless), by `def.key`; colors sort in WUBRG order. */
const SET_FIELDS: Readonly<Record<string, readonly string[]>> = {
  ObjectFilter: ['types', 'allTypes', 'notTypes', 'subtypes', 'notSubtypes', 'supertypes', 'notSupertypes', 'colors', 'notColors', 'keyword', 'notKeyword', 'zone'],
  TokenDef: ['colors', 'supertypes', 'types', 'subtypes', 'keywords'],
  TypeChange: ['add', 'set', 'remove'],
  'Modification.colors': ['set', 'add', 'remove'],
  Modification: ['remove', 'cantHave'],
  TargetSpec: ['distinctFrom'],
  EventPattern: ['from', 'to'],
};
const ZONE_ARRAYS: ReadonlySet<string> = new Set(['SpellAbilityDef', 'ActivatedAbilityDef', 'TriggeredAbilityDef', 'StaticAbilityDef']);
const COMMUTATIVE: ReadonlySet<unknown> = new Set(['+', '*', 'min', 'max']);

const json = (v: unknown): string => JSON.stringify(v);

function sortedObject(o: Rec): Rec {
  const keys = Object.keys(o).filter((k) => o[k] !== undefined);
  keys.sort((a, b) => {
    const ia = TAG_KEYS.indexOf(a);
    const ib = TAG_KEYS.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const out: Rec = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

/** A copy with sorted keys of a value the schema does not describe (kept, never dropped). */
function plain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(plain);
  if (isRecord(v)) {
    const o: Rec = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = plain(v[k]);
    return sortedObject(o);
  }
  return v;
}

function uniqueSorted(list: unknown[], color: boolean): unknown[] {
  const seen = new Set<string>();
  const out = list.filter((x) => (seen.has(json(x)) ? false : (seen.add(json(x)), true)));
  if (color && out.every((x) => typeof x === 'string' && WUBRG.includes(x))) return out.sort((a, b) => WUBRG.indexOf(a as string) - WUBRG.indexOf(b as string));
  return out.sort((a, b) => (typeof a === 'string' && typeof b === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : json(a) < json(b) ? -1 : 1));
}

function sortSets(def: string, o: Rec): void {
  for (const key of SET_FIELDS[def] ?? []) {
    const v = o[key];
    if (!Array.isArray(v)) continue;
    const list = uniqueSorted(v, key === 'colors' || key === 'notColors' || key === 'set' || key === 'add' || key === 'remove');
    // `keyword` and `zone` also have a scalar form
    o[key] = list.length === 1 && (key === 'keyword' || key === 'notKeyword' || key === 'zone' || key === 'from' || key === 'to') ? list[0] : list;
  }
}

function finish(def: string, o: Rec, parent: string, slot: string): unknown {
  for (const k of FALSE_IS_ABSENT[def] ?? []) if (o[k] === false) delete o[k];
  sortSets(def, o);
  switch (def) {
    case 'ObjectFilter': {
      if (o['zone'] === 'battlefield') delete o['zone'];
      if (parent === 'EventPattern' && slot === 'subject') delete o['zone'];
      const any = o['anyOf'];
      if (Array.isArray(any)) {
        const list = uniqueSorted(any, false);
        o['anyOf'] = list;
        if (list.length === 1 && Object.keys(o).length === 1) return list[0];
      }
      const not = o['not'];
      if (isRecord(not) && Object.keys(o).length === 1 && Object.keys(not).length === 1 && isRecord(not['not'])) return not['not'];
      break;
    }
    case 'Condition': {
      const kind = o['cond'];
      if ((kind === 'all' || kind === 'any') && Array.isArray(o['of'])) {
        const flat: unknown[] = [];
        for (const c of o['of']) {
          if (isRecord(c) && c['cond'] === kind && Array.isArray(c['of'])) flat.push(...c['of']);
          else flat.push(c);
        }
        const list = uniqueSorted(flat, false);
        if (list.length === 1) return list[0];
        o['of'] = list;
      }
      if (kind === 'not' && isRecord(o['of']) && o['of']['cond'] === 'not') return o['of']['of'];
      break;
    }
    case 'Quantity':
      if (o['q'] === 'math' && COMMUTATIVE.has(o['op']) && Array.isArray(o['args'])) {
        const args = [...o['args']].sort((a, b) => (json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0));
        if (args.length === 1) return args[0];
        o['args'] = args;
      }
      break;
    case 'Destination':
      if (o['zone'] === 'library' && o['position'] === 'top') delete o['position'];
      break;
    case 'ModeSpec':
    case 'TargetSpec':
      if (isRecord(o['chooser']) && o['chooser']['ref'] === 'you') delete o['chooser'];
      break;
    case 'EffectStep':
      if (o['op'] === 'addMana' && Array.isArray(o['units'])) {
        // each unit is the set of types one mana may be, and the units themselves are a multiset: one order for both (WUBRG, then colorless)
        const rank = (t: unknown): number => MANA_ORDER.indexOf(t as string);
        const units = o['units'].map((u) => (Array.isArray(u) ? [...new Set(u as unknown[])].sort((a, b) => rank(a) - rank(b)) : u));
        const first = (u: unknown): number => (Array.isArray(u) ? rank(u[0]) : 99);
        o['units'] = units.sort((a, b) => first(a) - first(b) || (json(a) < json(b) ? -1 : json(a) > json(b) ? 1 : 0));
      }
      if (o['op'] === 'delay' && Array.isArray(o['capture'])) o['capture'] = uniqueSorted(o['capture'], false); // the names a delayed trigger keeps are a set
      break;
    default:
      if (ZONE_ARRAYS.has(def) && Array.isArray(o['zone'])) {
        const zones = uniqueSorted(o['zone'], false);
        if (BATTLEFIELD_DEFAULT.has(def) && zones.length === 1 && zones[0] === 'battlefield') delete o['zone'];
        else o['zone'] = zones;
      }
  }
  return sortedObject(o);
}

function canon(value: unknown, schema: Schema, parent: string, slot: string): unknown {
  if (value === undefined) return undefined;
  const p = pick(unionOf(schema), value);
  if (!p.ok) return plain(value);
  const s = p.leaf.schema;
  if (Array.isArray(value)) {
    const items = s.items;
    return value.map((v) => (items === undefined ? plain(v) : canon(v, items, parent, slot)));
  }
  if (!isRecord(value)) return value;
  const names = p.leaf.names;
  const def = names.length > 0 ? names[names.length - 1]! : `${parent}.${slot}`;
  const props = s.properties ?? {};
  const out: Rec = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (v === undefined) continue;
    const ps = props[key];
    out[key] = ps === undefined ? plain(v) : canon(v, ps, def, key);
  }
  return finish(def, out, parent, slot);
}

export const canonicalize: Canonicalize = (def) => canon(def, defNode(ROOT_DEFINITION), '', '') as AbilityDef;
