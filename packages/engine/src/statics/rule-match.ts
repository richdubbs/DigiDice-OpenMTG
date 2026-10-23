/**
 * How the rule hooks match the object an action concerns (design 9.4): the layer system's filter evaluator (statics/match.ts) plus what an object IS as a
 * spell or an ability (`stackKind`, `castFrom`), and what the statics can't evaluate at all, so a caller fails closed instead of reading "does not apply".
 * Owner: WP16 (an addition to the files of design 5.1, shared by statics/hooks.ts and statics/costmods.ts).
 *
 * Rule effects are applied after all layers (CR 613.10-613.11), so the complete characteristics are available; what a spell or ability is comes from where
 * the object stands (a spell or an ability on the stack) or from the question being asked (a card about to be cast, CR 601.2a; the source of an ability, CR
 * 113.7, 602.2a, 603.3). The capability names (design 5.2) are `rfilter:<field>`, `rq:<kind>` and `rcond:<kind>` (model/cap-walk.ts emits them for the nodes
 * inside a rule effect; statics/hooks.ts registers the ones below), so a card that needs anything else stays manual.
 */
import type { ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState, ZoneKind } from '../types/state';
import { intrinsicChars } from './layers';
import { filterMatches, STATIC_CONDITION_KINDS, STATIC_FILTER_FIELDS, STATIC_QUANTITY_KINDS, type EvalCx } from './match';
import { anyZone, type CharsView } from './rule-sources';

/** What the object an action concerns is as a spell or an ability (CR 601.2a, 602.2a, 603.3), for `stackKind` and `castFrom`. */
export interface Actor {
  kind: 'spell' | 'activated' | 'triggered';
  copy?: boolean;
  castFrom?: ZoneKind;
}

/**
 * The `ObjectFilter` fields the rule hooks evaluate (`rfilter:<field>`): the layer system's plus `stackKind` and `castFrom`. History fields and `targets` are not.
 * CMDF: and `commander` (CR 903.3, 903.3d: "commander spells you cast cost {1} less", "commander spells you cast have cascade"): statics/match.ts#filterMatches
 * reads it with statics/commander.ts#isCommander for a card about to be cast from the command zone, a spell on the stack and a permanent alike (the designation
 * is the card's, so a copy of a commander spell is not one, CR 707.10); always false outside a Commander game.
 */
export const RULE_FILTER_FIELDS: ReadonlySet<string> = new Set([...STATIC_FILTER_FIELDS, 'stackKind', 'castFrom', 'commander']);

/** Can the rule hooks evaluate every field of this filter (and of its `anyOf` / `not` branches)? */
export function ruleFilterEvaluable(f: ObjectFilter): boolean {
  for (const [k, v] of Object.entries(f)) if (v !== undefined && !RULE_FILTER_FIELDS.has(k)) return false;
  return (f.anyOf ?? []).every(ruleFilterEvaluable) && (f.not === undefined || ruleFilterEvaluable(f.not));
}

const layerFilterEvaluable = (f: ObjectFilter): boolean =>
  Object.entries(f).every(([k, v]) => v === undefined || STATIC_FILTER_FIELDS.has(k)) && (f.anyOf ?? []).every(layerFilterEvaluable) && (f.not === undefined || layerFilterEvaluable(f.not));

/**
 * Can statics/match.ts evaluate this condition or quantity? A walk over the JSON: every `cond` and `q` kind is one it knows (`extraQ`: the kinds a caller
 * supplies, the cost path's), every filter of a reference has only fields it evaluates. A false here makes the caller fail closed.
 */
export function staticallyEvaluable(v: unknown, extraQ: ReadonlySet<string> = new Set(), depth = 0): boolean {
  if (depth > 40) return false;
  if (Array.isArray(v)) return v.every((x) => staticallyEvaluable(x, extraQ, depth + 1));
  if (v === null || typeof v !== 'object') return true;
  const r = v as Record<string, unknown>;
  if (typeof r['cond'] === 'string' && !STATIC_CONDITION_KINDS.has(r['cond'])) return false;
  if (typeof r['q'] === 'string' && !STATIC_QUANTITY_KINDS.has(r['q']) && !extraQ.has(r['q'])) return false;
  for (const [k, x] of Object.entries(r)) {
    const filter = k === 'filter' && x !== null && typeof x === 'object' && !Array.isArray(x) && !('ref' in x);
    if (filter ? !layerFilterEvaluable(x as ObjectFilter) : !staticallyEvaluable(x, extraQ, depth + 1)) return false;
  }
  return true;
}

/** The object as a spell or an ability, read from where it is: a spell (or a copy, CR 707.10) or an ability on the stack; anything else is neither. */
function actorOf(o: GameObject): Actor | undefined {
  if (o.zone !== 'stack') return undefined;
  if (o.kind === 'ability') return { kind: o.stack?.kind === 'triggered' ? 'triggered' : 'activated' };
  return { kind: 'spell', ...(o.kind === 'spellCopy' || o.stack?.isCopy === true ? { copy: true } : {}), ...(o.stack?.castFrom !== undefined ? { castFrom: o.stack.castFrom } : {}) };
}

function stackKindIs(a: Actor | undefined, k: NonNullable<ObjectFilter['stackKind']>): boolean {
  if (!a) return false;
  switch (k) {
    case 'spell': return a.kind === 'spell';
    case 'copy': return a.kind === 'spell' && a.copy === true;
    case 'ability': return a.kind !== 'spell';
    case 'activatedAbility': return a.kind === 'activated';
    case 'triggeredAbility': return a.kind === 'triggered';
  }
}

function test(cx: EvalCx, id: ObjectId, f: ObjectFilter, actor: Actor | undefined): boolean {
  const { stackKind, castFrom, anyOf, not, ...rest } = f;
  if (!filterMatches(cx, id, rest)) return false;
  if (anyOf && !anyOf.some((x) => test(cx, id, x, actor))) return false;
  if (not && test(cx, id, not, actor)) return false;
  const o = cx.s.objects[id]!;
  const a = actor ?? actorOf(o);
  if (stackKind !== undefined && !stackKindIs(a, stackKind)) return false;
  if (castFrom !== undefined && (a?.castFrom ?? o.cast?.from) !== castFrom) return false; // CR 601.2a: the zone it is (or was) cast from
  return true;
}

/**
 * Does `id` (an object; a player never matches an object filter) satisfy `f` in whatever zone it is, seen from `cx`, as `actor` when given? `undefined` when
 * the filter has a field the rule hooks can't evaluate: the caller fails closed and says so, never a silent "does not apply".
 */
export function objectMatches(cx: EvalCx, id: ObjectId | PlayerId, f: ObjectFilter, actor?: Actor): boolean | undefined {
  if (!ruleFilterEvaluable(f)) return undefined;
  if (cx.s.objects[id] === undefined) return false;
  return test(cx, id, anyZone(f), actor);
}

/** A card about to be cast or a spell on the stack, as a spell (CR 601.2a): where it is cast from. */
export function spellActor(o: GameObject): Actor {
  return o.zone === 'stack' ? actorOf(o) ?? { kind: 'spell' } : { kind: 'spell', castFrom: o.zone };
}

/**
 * The view in which the source of a spell or ability that targets (CR 115.1) is evaluated: the object where it is, or its last known information when it has
 * left (CR 113.7a: a dies trigger's source), controlled by the controller of the spell or ability. With what it is as a spell or an ability:
 *   - an ability on the stack from this source (the one being announced, CR 602.2a, 603.3, or resolving, CR 608.2b): that ability;
 *   - the source itself on the stack: the spell;
 *   - a card in a zone other than the battlefield: the spell about to be cast (castCheck asks before the card moves, CR 601.2a);
 *   - a permanent, or an object that has left with no ability of it on the stack: an activated ability about to be activated (CR 602.2a).
 * Null when nothing is known about the source.
 */
export function sourceView(base: CharsView, source: ObjectId, controller: PlayerId): { view: CharsView; actor: Actor } | null {
  const s: GameState = base.s;
  const live = s.objects[source];
  const lki = live ? undefined : s.lki[source];
  const obj = live ?? lki?.object;
  if (!obj) return null;
  const chars = live ? base.get(source) : lki?.chars ?? (s.defs[obj.defId] ? intrinsicChars(s, obj) : undefined);
  if (!chars) return null;
  let actor: Actor | undefined;
  for (let i = s.zones.stack.length - 1; i >= 0 && !actor; i--) {
    const x = s.objects[s.zones.stack[i]!];
    if (x?.kind === 'ability' && x.stack?.sourceId === source) actor = { kind: x.stack.kind === 'triggered' ? 'triggered' : 'activated' };
  }
  actor ??= actorOf(obj) ?? (live && obj.zone !== 'battlefield' ? { kind: 'spell', castFrom: obj.zone } : { kind: 'activated' });
  const s2: GameState = live ? s : { ...s, objects: { ...s.objects, [source]: obj } };
  return { view: base.with(s2, new Map([[source, { ...chars, controller }]])), actor };
}
