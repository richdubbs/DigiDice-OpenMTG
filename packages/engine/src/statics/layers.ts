/**
 * computeAll: the characteristics of every relevant object, layer by layer across ALL objects (CR 613), with the started set (613.6),
 * dependency by trial application (613.8) and timestamps (613.7). Owner: WP9. Contract: statics/api.ts#ComputeAll (design 9.2, sketch 8.3).
 *
 * How a computation goes (design 9.2):
 *   1. Every object starts from its characteristics BEFORE any effect (rules/base-chars: its face, a face-down 2/2, a combined split card) with the
 *      abilities its printed text and the keyword library give it (`p:` and `k:` keys) and the controller it has (CR 613.1).
 *   2. The layers run in order, each over ALL objects together, so a filter in layer N sees the layer 1-(N-1) results of every other object (CR 613.1, 613.5).
 *      Layers 2, 4, 5, 6, 7a-7d are implemented (`LAYER_TABLE`); 1a, 1b and 3 arrive with milestone 6.
 *   3. At the start of each layer the effects that can apply come from three places: the static abilities objects have RIGHT NOW (CR 611.3a; `live.ts`), the
 *      resolved effects stored in the state (CR 611.2) and the effects of counters (CR 122.1, 613.4c). An effect that already started to apply in an earlier layer is
 *      CARRIED to the same set of objects (CR 613.6) even if its source has lost the ability meanwhile.
 *   4. Inside a layer (or sublayer) characteristic-defining effects go first (CR 613.3, 613.4a), then the rest in timestamp order (CR 613.7); a dependency
 *      overrides the timestamp (CR 613.8), found by trial application; a dependency loop is ignored.
 *   5. Before layer 6 the objects get the abilities the rules give them (the mana ability of a basic land type, CR 305.6: key `r:basic:<C>`), so "loses all
 *      abilities" takes them away like any other ability.
 *
 * Everything here is a pure function of the state. No game state is cached in this file (the cache of a layered state lives in rules/characteristics.ts); the
 * starting characteristics of a frozen card definition are memoized per definition (WP30, `templateFor`): a pure function of immutable data. That memo assumes the
 * keyword library does not change while the process runs; a rules pack that adds keyword data at run time (WP27) must be loaded before the first game.
 */
import type { Layer } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import { baseChars, baseManaValue, baseSource, sourceChars } from '../rules/base-chars';
import type { Chars } from '../rules/characteristics';
import { charAbilitiesOfBase, keywordsOfAbilities, mayHaveRuleAbilities, ruleAbilitiesFor } from './abilities';
import type { ApplyMods, CharAbility, ComputeAll, LiveEffect, ModContext, Order1a } from './api';
import { LAYERS } from './api';
import { counterEffects, counterMods, hasLayer, resolvedEffects, staticEffectsOf } from './live';
import { evalCondition, evalQuantity, isPlayerRef, objectsOf, playerOf, type EvalCx } from './match';
import { applyMods, layerApplier } from './mods';
import { LAYER_1A } from './copy';
import { FACE_DOWN_INTRINSIC, FACE_DOWN_RULE_EFFECTS, LAYER_1B } from './face-down';
import { LAYER_3 } from './text-change';
import { MERGE_INTRINSIC, MERGE_RULE_EFFECTS } from './merge';
import { SUSPECT_RULE_EFFECTS } from './suspect';
import { HONE_RULE_EFFECTS } from './hone';

export { LAYERS } from './api';

// ---- M6-0 registries (m6 design 2.6, E16): the appliers of the early layers and the rule-generated effects, each in its owner's file ---------------------

/** M6-0: the layer 1a (statics/copy.ts, M6-2), 1b (statics/face-down.ts, M6-3) and 3 (statics/text-change.ts, M6-8) appliers; null until their owner lands. */
export { LAYER_1A, LAYER_1B, LAYER_3 };

/**
 * M6-0: the rule-generated continuous effects `computeAll` adds to the standing (resolved and counter) effects: the 1b effect of each face-down permanent or
 * spell (M6-3) and the 1a effect of each merged permanent (M6-9). Empty in M6-0.
 */
export const RULE_EFFECTS: readonly ((s: GameState) => LiveEffect[])[] = [...FACE_DOWN_RULE_EFFECTS, ...MERGE_RULE_EFFECTS, ...SUSPECT_RULE_EFFECTS, ...HONE_RULE_EFFECTS]; // FAST5X E12: suspected (CR 701.60c); std-ra: hone counters (CR 122.1, 613.4c)

/**
 * M6-0 (E16): applied by `intrinsicChars` (the fast path, no layer source in the state) after the base and before counters: the face-down profile (M6-3), a
 * merged permanent (M6-9). Empty in M6-0, so the fast path is unchanged.
 */
export const INTRINSIC_PARTS: readonly ((s: GameState, o: GameObject, c: Chars) => Chars)[] = [...FACE_DOWN_INTRINSIC, ...MERGE_INTRINSIC];

/** Layers this engine build implements (capability names `layer:<layer>` are built from the keys, design 5.2). M6-0: 1a, 1b and 3 join when their applier exists. */
export const LAYER_TABLE: Readonly<Record<string, ApplyMods>> = {
  ...(LAYER_1A ? { '1a': LAYER_1A } : {}),
  ...(LAYER_1B ? { '1b': LAYER_1B } : {}),
  '2': layerApplier(2),
  ...(LAYER_3 ? { '3': LAYER_3 } : {}),
  '4': layerApplier(4),
  '5': layerApplier(5),
  '6': layerApplier(6),
  '7a': layerApplier('7a'),
  '7b': layerApplier('7b'),
  '7c': layerApplier('7c'),
  '7d': layerApplier('7d'),
};

/** Features this module implements (design 5.2; the capability is `feature:<name>`): `dependency`, the trial-application ordering of CR 613.8. */
export const FEATURES: readonly string[] = ['dependency', 'layer6.addActivatedOf', 'layer6.addActivatedOf.limit', 'layer6.addActivatedOf.triggered' /* std-cardcopy-9 */]; // r5-static: "has all activated abilities of ..." (statics/mods.ts); std-craft-2: "... only once each turn"

const NO_CHARS: ReadonlyMap<ObjectId, Chars> = new Map();

// ---- the starting point of one object --------------------------------------------------------------------------------------

/**
 * An object's characteristics before any effect: base values, printed and keyword-generated abilities, its own controller. `baseChars` returns a record that
 * is fresh on every call, so it is converted in place (this runs for every `getChars` call: copying the record again costs a measurable share of a game).
 */
export function startingChars(s: GameState, o: GameObject): Chars {
  const t = templateFor(s, o);
  if (t) return fromTemplate(t.chars, t.chars.abilities, o, s.defs[o.defId]!);
  return withAbilities(baseChars(s, o), o);
}

/** Turn a fresh base record into a starting `Chars` in place (see `startingChars`). */
function withAbilities(base: ReturnType<typeof baseChars>, o: GameObject): Chars {
  const printed = base.abilities.length;
  const abilities = o.kind === 'ability' ? [] : charAbilitiesOfBase(base);
  const c = base as unknown as Chars;
  c.controller = o.baseController ?? o.controller; // MX2: layer 2 starts from the controller before control-changing effects (core/control.ts)
  c.abilities = abilities;
  c.cantHave = [];
  if (abilities.length !== printed) c.keywords = keywordsOfAbilities(abilities); // what the keyword library generated could itself be a keyword ability (rare)
  return c;
}

// ---- starting points computed once per card definition (performance, WP30) -------------------------------------------------------------------------------
//
// The starting characteristics of a face (or of a combined split card) and the abilities the rules give it (CR 305.6) depend on the definition ALONE, and they
// are the most expensive part of a characteristics call (the keyword library expands every keyword). So they are computed once per FROZEN definition and copied
// for each call. This is a memo of a pure function of immutable data, not a cache of game state: a definition is deep-frozen when a game is created
// (docs/ARCHITECTURE.md, principle 2) and is never edited, so the template can never be stale. An unfrozen definition (a test that edits definitions in place)
// is always computed from scratch. What depends on the object (its controller, the X of a spell on the stack, counters) is applied to the copy.

interface Template {
  /** `controller` '' and `manaValue` 0 are placeholders, set per object. Never handed out: every caller gets a copy with its own arrays. */
  chars: Chars;
  /** `chars.abilities` plus the abilities of its basic land types (CR 305.6), computed on first use. */
  withRule?: readonly CharAbility[];
}

/** Per frozen definition: index `n` is face `n`, index `faces.length` the combined split card. */
const TEMPLATES = new WeakMap<CardDef, (Template | undefined)[]>();

function templateFor(s: GameState, o: GameObject): Template | undefined {
  const def = s.defs[o.defId];
  if (!def || !Object.isFrozen(def)) return undefined;
  const src = baseSource(def, o);
  if (src.kind !== 'face' && src.kind !== 'combined') return undefined; // face down and abilities on the stack: cheap, and not a function of the definition
  const slot = src.kind === 'face' ? src.face : def.faces.length;
  let byDef = TEMPLATES.get(def);
  if (!byDef) TEMPLATES.set(def, (byDef = []));
  return (byDef[slot] ??= { chars: withAbilities(sourceChars(def, src), TEMPLATE_OWNER) });
}

/** What `withAbilities` reads of an object for a template: it is not an ability on the stack, and it has no controller yet. */
const TEMPLATE_OWNER = { kind: 'card', controller: '' as PlayerId } as GameObject;

/** A copy of a template for `o`: every array is the caller's own (design 4.3: callers and the layers edit what they get); abilities themselves are shared, immutable data. */
function fromTemplate(t: Chars, abilities: readonly CharAbility[], o: GameObject, def: CardDef): Chars {
  return {
    ...t,
    names: t.names.slice(), colors: t.colors.slice(), supertypes: t.supertypes.slice(), types: t.types.slice(), subtypes: t.subtypes.slice(),
    abilities: abilities.slice(), keywords: t.keywords.slice(), cantHave: [],
    controller: o.baseController ?? o.controller, // MX2: layer 2 starts from the controller before control-changing effects (core/control.ts)
    manaValue: baseManaValue(def, t, o),
  };
}

/**
 * The characteristics of ONE object when no other object or effect can change it: its own base, the abilities the rules give it, its counters. This is
 * exactly what `computeAll` gives the object in a state without static abilities or resolved effects, computed without looking at any other object.
 */
export function intrinsicChars(s: GameState, o: GameObject): Chars {
  let c: Chars;
  const t = templateFor(s, o);
  if (t) {
    t.withRule ??= [...t.chars.abilities, ...ruleAbilitiesFor(t.chars)];
    c = fromTemplate(t.chars, t.withRule, o, s.defs[o.defId]!);
  } else {
    c = startingChars(s, o);
    if (mayHaveRuleAbilities(c)) { // M6-6 INTERFACE CHANGE: a land (CR 305.6) or a Saga (CR 714.3a-b)
      const rule = ruleAbilitiesFor(c);
      if (rule.length > 0) c = { ...c, abilities: [...c.abilities, ...rule] };
    }
  }
  for (const part of INTRINSIC_PARTS) c = part(s, o, c); // M6-0 (E16): face-down profile, merged permanent; before counters (empty in M6-0)
  const mods = counterMods(o);
  if (mods.length > 0) c = applyMods(c, mods, o.id, s, NO_CHARS, { id: `ctr:${o.id}`, source: o.id, controller: o.controller, timestamp: o.timestamp });
  return c;
}

// ---- effects: contexts, affected sets, existence ---------------------------------------------------------------------------

/** Who "you" is for an effect: its source's CURRENT controller for a static ability, the recorded controller for a resolved effect. */
function fxOf(s: GameState, e: LiveEffect, chars: ReadonlyMap<ObjectId, Chars>): ModContext {
  const src = e.origin?.source.id ?? e.source?.id ?? null;
  const controller = (e.origin && src ? chars.get(src)?.controller : undefined) ?? e.controller ?? (src ? s.objects[src]?.controller : undefined) ?? s.turn.activePlayer;
  // M6-0 (m6 design 2.5): a 1a effect's copiable values and a 1b effect's profile travel to the applier with the effect
  return { id: e.id, source: src, controller, timestamp: e.timestamp, ...(e.copy ? { copy: e.copy } : {}), ...(e.faceDown ? { faceDown: e.faceDown } : {}) };
}

/** The applier of one layer: the milestone 6 appliers for 1a, 1b and 3 (their owner's files), `applyMods` for the others (unchanged since milestone 5). */
const applierOf = (layer: Layer): ApplyMods => (layer === '1a' || layer === '1b' || layer === 3 ? LAYER_TABLE[String(layer)] ?? applyMods : applyMods);

const cxOf = (s: GameState, e: LiveEffect, chars: ReadonlyMap<ObjectId, Chars>): EvalCx => {
  const fx = fxOf(s, e, chars);
  return { s, all: chars, source: fx.source, controller: fx.controller };
};

/** The objects an effect affects right now (CR 611.3a: a static ability is re-evaluated). Players are handled after objects (CR 613.10) and are not here. */
export function matchSet(s: GameState, e: LiveEffect, chars: ReadonlyMap<ObjectId, Chars>): ObjectId[] {
  const aff = e.effect.affects;
  return isPlayerRef(aff) ? [] : objectsOf(cxOf(s, e, chars), aff);
}

/**
 * Does the effect still exist? A static ability's effect exists while its source object still has the ability, in a zone it functions in, with its condition
 * true (CR 604.1, 611.3a); this is what lets Blood Moon remove the ability that generates an effect before that effect is applied (CR 613.8a). Resolved effects
 * and counter effects exist until their duration ends.
 */
export function stillExists(s: GameState, e: LiveEffect, chars: ReadonlyMap<ObjectId, Chars>): boolean {
  if (!e.origin) return true;
  const id = e.origin.source.id;
  const c = chars.get(id);
  const o = s.objects[id];
  if (!c || !o || o.phasedOut) return false;
  const a = c.abilities.find((x) => x.key === e.origin!.abilityKey);
  if (!a || a.def.kind !== 'static') return false;
  if (!(a.def.zone ?? ['battlefield']).includes(o.zone) && e.effect.cda !== true) return false;
  const holds = !a.def.condition || evalCondition({ s, all: chars, source: id, controller: c.controller }, a.def.condition);
  return e.origin.effectIndex >= a.def.effects.length ? !holds : holds; // r5-static (CR 611.3a): an `otherwise` effect exists while the condition is false
}

// ---- dependency (CR 613.8) -------------------------------------------------------------------------------------------------

type Started = Map<string, { e: LiveEffect; set: ObjectId[] }>;

/** Observability for tests (never read by the engine): how many trial applications the dependency check made. */
export const LAYER_STATS = { trials: 0 };

/** What an effect's modifications in one layer can change: the classes of characteristic, and whether it can take away an ability (so end the effect it generates). */
interface Writes {
  classes: ReadonlySet<string>;
  denies: boolean;
}
const writesMemo = new WeakMap<object, Map<string, Writes>>();

/**
 * The classes of characteristic the modifications of `e` in `layer` can write. Layer 6 writes abilities (granting changes what "has flying" matches; removing or
 * refusing also ends the effects those abilities generate: `denies`). Layer 4 writes types, and abilities only when it SETS a land type (CR 305.7). Layer 2
 * writes the controller, layer 5 the colors, layers 7a-7d power and toughness.
 */
function writesOf(e: LiveEffect, layer: Layer): Writes {
  let byLayer = writesMemo.get(e.effect);
  if (!byLayer) writesMemo.set(e.effect, (byLayer = new Map()));
  const key = String(layer);
  let w = byLayer.get(key);
  if (w) return w;
  const classes = new Set<string>();
  let denies = false;
  for (const m of e.effect.mods) {
    if (m.layer !== layer) continue;
    switch (m.layer) {
      case 2: classes.add('controller'); break;
      case 4:
        if (m.types || m.subtypes || m.supertypes || m.named !== undefined) classes.add('types');
        if (m.subtypes?.set || m.subtypes?.chosenSets) { classes.add('abilities'); denies = true; } // FAST3 T13: a chosen basic land type is set too (CR 305.7)
        break;
      case 5: classes.add('colors'); break;
      case 6:
        if ((m.add && m.add.length > 0) || m.addActivatedOf !== undefined) classes.add('abilities'); // r5-static: and the abilities it copies
        if (m.removeAll || (m.remove && m.remove.length > 0) || (m.cantHave && m.cantHave.length > 0)) { classes.add('abilities'); denies = true; }
        break;
      case '7a': case '7b': case '7c': case '7d': classes.add('pt'); break;
      default: break;
    }
  }
  w = { classes, denies };
  byLayer.set(key, w);
  return w;
}

/** Words that appear in an effect's filters, quantities and condition -> the class of characteristic they read. */
const READS: Record<string, readonly string[]> = {
  controller: ['controller'], controllerOf: ['controller'], you: ['controller'], opponent: ['controller'], anOpponent: ['controller'], devotion: ['controller'],
  types: ['types'], allTypes: ['types'], notTypes: ['types'], subtypes: ['types'], allSubtypes: ['types'], notSubtypes: ['types'], supertypes: ['types'], notSupertypes: ['types'],
  distinct: ['types', 'colors'], sharesWith: ['types', 'colors'],
  colors: ['colors'], notColors: ['colors'], colorless: ['colors'], multicolored: ['colors'], monocolored: ['colors'],
  power: ['pt'], toughness: ['pt'],
  keyword: ['abilities'], notKeyword: ['abilities'], hasAbility: ['abilities'],
};

const readsMemo = new WeakMap<object, ReadonlySet<string>>();
const NO_READS: ReadonlySet<string> = new Set();

function readsOfJson(parts: unknown, into: Set<string>): void {
  for (const m of JSON.stringify(parts).matchAll(/"([A-Za-z]+)"/g)) for (const k of READS[m[1]!] ?? []) into.add(k);
}

/**
 * The classes of characteristic an effect reads through its filter, its quantities and, for a layer 2 modification, the player it names ("you control that
 * creature" reads who "you" is: CR 613.8a). The words of a modification's own fields, such as "power" in {layer:'7c', power:1}, are what it WRITES, not what it reads.
 */
function readsOf(e: LiveEffect): ReadonlySet<string> {
  let base = readsMemo.get(e.effect);
  if (!base) {
    const set = new Set<string>();
    const parts: unknown[] = [e.effect.affects];
    for (const m of e.effect.mods) {
      if (m.layer === '7a' || m.layer === '7b' || m.layer === '7c') parts.push(m.power, m.toughness);
      else if (m.layer === 2) parts.push(m.controller);
      // r5-static (CR 613.8a): "has all activated abilities of <objects>" reads which objects those are and the abilities they have
      else if (m.layer === 6 && m.addActivatedOf !== undefined) { parts.push(m.addActivatedOf); set.add('abilities'); }
    }
    readsOfJson(parts, set);
    base = set.size === 0 ? NO_READS : set;
    readsMemo.set(e.effect, base);
  }
  return base;
}

const conditionReadsMemo = new WeakMap<object, ReadonlySet<string>>();

/** The classes the condition of the static ability that generates `e` reads ("as long as ..."). */
function conditionReadsOf(e: LiveEffect, chars: ReadonlyMap<ObjectId, Chars>): ReadonlySet<string> {
  if (!e.origin) return NO_READS;
  const def = chars.get(e.origin.source.id)?.abilities.find((x) => x.key === e.origin!.abilityKey)?.def;
  if (def?.kind !== 'static' || !def.condition) return NO_READS;
  let r = conditionReadsMemo.get(def.condition);
  if (!r) {
    const set = new Set<string>();
    readsOfJson(def.condition, set);
    conditionReadsMemo.set(def.condition, (r = set));
  }
  return r;
}

/**
 * Could `b` change anything `a` looks at? A cheap test that never runs a trial: `b` writes a class of characteristic that `a`'s filter, quantities or condition
 * read, or `b` can take away an ability and `a` is generated by one (the existence of a static ability's effect is itself read, CR 613.8a). An effect that only
 * ADDS abilities cannot make another effect stop existing, so lords piling on keywords never trigger the expensive check.
 */
function mayDepend(a: LiveEffect, b: LiveEffect, layer: Layer, chars: ReadonlyMap<ObjectId, Chars>): boolean {
  const w = writesOf(b, layer);
  if (w.classes.size === 0) return false;
  if (a.origin && w.denies) return true;
  const reads = readsOf(a);
  for (const c of w.classes) if (reads.has(c)) return true;
  if (a.origin) {
    const cond = conditionReadsOf(a, chars);
    for (const c of w.classes) if (cond.has(c)) return true;
  }
  return false;
}

const setOfEffect = (s: GameState, e: LiveEffect, chars: ReadonlyMap<ObjectId, Chars>, started: Started): ObjectId[] => started.get(e.id)?.set ?? matchSet(s, e, chars);

/**
 * What effect `a` is, to the dependency check (CR 613.8a): whether it exists, what it applies to, and what it does to each of those. "What it does" is its
 * modifications with every value that is computed from the game worked out for that object (the number in "+X/+X where X is the number of ...", the player in
 * "you control that creature"): an effect that adds, sets or removes a constant does the same thing whatever happened before, so it never depends on another
 * for that (a type added before or after "becomes an artifact" is the timestamp's business). A different RESULT is not a different effect.
 */
function signature(s: GameState, a: LiveEffect, layer: Layer, chars: ReadonlyMap<ObjectId, Chars>, started: Started): string {
  if (!started.has(a.id) && !stillExists(s, a, chars)) return 'gone';
  const mods = a.effect.mods.filter((m) => m.layer === layer);
  const fx = fxOf(s, a, chars);
  return setOfEffect(s, a, chars, started)
    .map((id) => {
      const cx: EvalCx = { s, all: chars, source: fx.source, controller: fx.controller, subject: id };
      const params = mods.map((m) => {
        switch (m.layer) {
          case 2: return playerOf(cx, m.controller);
          case '7a': case '7b': case '7c': return [m.power === undefined ? null : evalQuantity(cx, m.power) ?? null, m.toughness === undefined ? null : evalQuantity(cx, m.toughness) ?? null];
          default: return null;
        }
      });
      return `${id}:${JSON.stringify(params)}`;
    })
    .join('|');
}

/**
 * The dependency relation among the effects still waiting to be applied in a layer (CR 613.8a): trial application of `b` on a scratch copy of the characteristics,
 * compared through `signature`. The "before" signature of each effect and the scratch copy of each `b` are computed once per round (the order is re-evaluated after
 * every application, CR 613.8c, so a round is one choice of the next effect). A pair is only tried when `mayDepend` says `b` could change what `a` looks at.
 */
function dependencyCheck(s: GameState, layer: Layer, chars: ReadonlyMap<ObjectId, Chars>, started: Started): (a: LiveEffect, b: LiveEffect) => boolean {
  const before = new Map<LiveEffect, string>();
  const trials = new Map<LiveEffect, Map<ObjectId, Chars>>();
  const trialOf = (b: LiveEffect): Map<ObjectId, Chars> => {
    let t = trials.get(b);
    if (!t) {
      LAYER_STATS.trials++;
      t = new Map(chars);
      const mods = b.effect.mods.filter((m) => m.layer === layer);
      const fx = fxOf(s, b, chars);
      const apply = applierOf(layer);
      for (const id of setOfEffect(s, b, chars, started)) t.set(id, apply(chars.get(id)!, mods, id, s, chars, fx));
      trials.set(b, t);
    }
    return t;
  };
  return (a, b) => {
    if (!mayDepend(a, b, layer, chars)) return false; // b cannot change anything a looks at
    let was = before.get(a);
    if (was === undefined) { was = signature(s, a, layer, chars, started); before.set(a, was); }
    return was !== signature(s, a, layer, trialOf(b), started);
  };
}

/** CR 613.8a: does A depend on B in this layer? Trial application on a scratch copy, including "B changes whether A exists" (Blood Moon vs a land-type granter). */
export function dependsOn(s: GameState, a: LiveEffect, b: LiveEffect, layer: Layer, all: Map<ObjectId, Chars>): boolean {
  return dependencyCheck(s, layer, all, new Map())(a, b);
}

// ---- the layers --------------------------------------------------------------------------------------------------------------

const cmpNumbers = (a: readonly number[] = [], b: readonly number[] = []): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -Infinity) - (b[i] ?? -Infinity);
    if (d !== 0 && !Number.isNaN(d)) return d;
  }
  return 0;
};

/**
 * Timestamp order (CR 613.7); on a tie the effect's `rank`: a static ability's effect before a resolved one (613.7n), the effects of one object in the order they
 * had (an object's own abilities first, then the granted ones in the order they were granted: 613.7a), objects and resolved effects by the NUMBER in their ids
 * (creation order). The id as a string is the last resort.
 */
const byTimestamp = (a: LiveEffect, b: LiveEffect): number => a.timestamp - b.timestamp || cmpNumbers(a.rank, b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * CR 613.8b: every effect still waiting depends on another one: there is a loop (or an effect that waits for one). Only the effects IN a loop are applied in
 * timestamp order, so take the earliest effect of a component of the dependency graph that depends on nothing outside itself (a sink of the condensation); an
 * effect that merely depends on the loop waits until the loop has been applied.
 */
function pickFromLoop(remaining: readonly LiveEffect[], depends: (a: LiveEffect, b: LiveEffect) => boolean): LiveEffect {
  const n = remaining.length;
  const edge = remaining.map((a) => remaining.map((b) => a !== b && depends(a, b))); // edge[i][j]: i depends on j
  // Tarjan's strongly connected components.
  const index: number[] = Array(n).fill(-1);
  const low: number[] = Array(n).fill(0);
  const onStack: boolean[] = Array(n).fill(false);
  const comp: number[] = Array(n).fill(-1);
  const stack: number[] = [];
  let counter = 0;
  let components = 0;
  const visit = (v: number): void => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (let w = 0; w < n; w++) {
      if (!edge[v]![w]) continue;
      if (index[w] === -1) {
        visit(w);
        low[v] = Math.min(low[v]!, low[w]!);
      } else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
    }
    if (low[v] === index[v]) {
      for (;;) {
        const w = stack.pop()!;
        onStack[w] = false;
        comp[w] = components;
        if (w === v) break;
      }
      components++;
    }
  };
  for (let v = 0; v < n; v++) if (index[v] === -1) visit(v);
  const leaves = Array(components).fill(true) as boolean[];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (edge[i]![j] && comp[i] !== comp[j]) leaves[comp[i]!] = false;
  const pick = remaining.findIndex((_, i) => leaves[comp[i]!]);
  return remaining[pick === -1 ? 0 : pick]!;
}

/**
 * Timestamp order, with dependency overriding it (CR 613.7, 613.8). Applied one at a time: the order is re-evaluated after each (CR 613.8c).
 * `discover` finds effects that appeared because of what was just applied (an ability granted in this layer whose own effect is in this layer, CR 613.7a); they join
 * the queue in timestamp order.
 */
function applyGroup(s: GameState, input: LiveEffect[], layer: Layer, chars: Map<ObjectId, Chars>, started: Started, discover?: () => LiveEffect[], trace?: Trace): void {
  let remaining = [...input].sort(byTimestamp);
  const queued = new Set(remaining.map((e) => e.id));
  while (remaining.length > 0) {
    // CR 613.8b: an effect that depends on an effect not yet applied waits. A dependency loop is ignored (timestamp order inside the loop only).
    const depends = remaining.length === 1 ? undefined : dependencyCheck(s, layer, chars, started);
    const free = depends ? remaining.filter((a) => !remaining.some((b) => b !== a && depends(a, b))) : remaining;
    const next = free[0] ?? pickFromLoop(remaining, depends!);
    remaining = remaining.filter((x) => x !== next);
    // CR 613.8a/c: an effect whose ability was taken away by an effect applied before it never begins to apply. One that already started is carried (CR 613.6).
    if (!started.has(next.id) && !stillExists(s, next, chars)) continue;
    const set = setOfEffect(s, next, chars, started); // the set is fixed once the effect has started (CR 613.6)
    started.set(next.id, { e: next, set });
    const mods = next.effect.mods.filter((m) => m.layer === layer);
    const fx = fxOf(s, next, chars);
    const apply = applierOf(layer);
    const updates = set.map((id) => [id, apply(chars.get(id)!, mods, id, s, chars, fx)] as const); // computed against the state BEFORE this effect (CR 613.8c)
    trace?.(layer, next, set);
    for (const [id, c] of updates) chars.set(id, c);
    if (discover && mods.some((m) => m.layer === 6 && m.add !== undefined && m.add.length > 0)) {
      const more = discover().filter((e) => !queued.has(e.id) && !started.has(e.id));
      if (more.length > 0) {
        for (const e of more) queued.add(e.id);
        remaining = [...remaining, ...more].sort(byTimestamp);
      }
    }
  }
}

const NOT_NUMBER = /^-?\d+$/;
const bare = (v: string | undefined): boolean => v !== undefined && !NOT_NUMBER.test(v);

/** Which of power and toughness a characteristic-defining ability among these abilities defines (CR 604.3, 613.4a). */
function definedBy(abilities: readonly CharAbility[]): { power: boolean; toughness: boolean } {
  const out = { power: false, toughness: false };
  for (const a of abilities) {
    if (a.def.kind !== 'static') continue;
    for (const e of a.def.effects) {
      if (e.s !== 'continuous' || e.cda !== true) continue;
      for (const m of e.mods) {
        if (m.layer !== '7a') continue;
        if (m.power !== undefined) out.power = true;
        if (m.toughness !== undefined) out.toughness = true;
      }
    }
  }
  return out;
}

/**
 * CR 208.5, 208.2a: a creature whose power or toughness is "*" and that LOST the characteristic-defining ability that defined it (it is not among the effects that
 * began to apply in 7a) has no value there, and no value is 0. A "*" that never had such an ability among the abilities the engine understands stays "*": the card
 * has text the engine could not read, it is manual (never silently 0/0). `before` holds the abilities of the objects that start with a "*".
 */
function withoutValue(chars: Map<ObjectId, Chars>, started: Started, before: ReadonlyMap<ObjectId, readonly CharAbility[]>): void {
  if (before.size === 0) return;
  const power = new Set<ObjectId>();
  const toughness = new Set<ObjectId>();
  for (const { e, set } of started.values()) {
    for (const m of e.effect.mods) {
      if (m.layer !== '7a') continue;
      for (const id of set) {
        if (m.power !== undefined) power.add(id);
        if (m.toughness !== undefined) toughness.add(id);
      }
    }
  }
  for (const [id, abilities] of before) {
    const c = chars.get(id)!;
    const had = definedBy(abilities);
    const zeroPower = had.power && bare(c.power) && !power.has(id);
    const zeroToughness = had.toughness && bare(c.toughness) && !toughness.has(id);
    if (zeroPower || zeroToughness) chars.set(id, { ...c, ...(zeroPower ? { power: '0' } : {}), ...(zeroToughness ? { toughness: '0' } : {}) });
  }
}

/** M6-0: told of each effect as it is applied, with the layer and the set it applies to (`order1a` reads the 1a order with it). */
type Trace = (layer: Layer, e: LiveEffect, set: readonly ObjectId[]) => void;

/**
 * The whole computation for one set of standing (resolved, counter and rule-generated) effects. M6-0: `stopAfter` ends it after that layer (the characteristics
 * are then partial: only `order1a` uses it), `trace` sees every application.
 */
function computeWith(s: GameState, standing: readonly LiveEffect[], stopAfter?: Layer, trace?: Trace): Map<ObjectId, Chars> {
  const chars = new Map<ObjectId, Chars>();
  const starsAtStart = new Map<ObjectId, readonly CharAbility[]>();
  for (const id in s.objects) {
    const o = s.objects[id]!;
    if (!s.defs[o.defId]) continue; // a redacted object (viewFor) has no definition: it is not in the map
    const c = startingChars(s, o);
    chars.set(id, c);
    if (bare(c.power) || bare(c.toughness)) starsAtStart.set(id, c.abilities);
  }

  // CR 613.6: once an effect has started to apply in one layer, it keeps applying to the SAME set in the later layers it has modifications in, even if its
  // source loses the ability meanwhile.
  const started: Started = new Map();

  for (const layer of LAYERS) {
    if (LAYER_TABLE[String(layer)] === undefined) {
      if (layer === stopAfter) break;
      continue; // 1a, 1b, 3: until their appliers exist (M6-2, M6-3, M6-8)
    }
    if (layer === 6) {
      // CR 305.6: the abilities of basic land types are generated from the types after layer 4.
      for (const [id, c] of chars) {
        const rule = ruleAbilitiesFor(c);
        if (rule.length > 0) chars.set(id, { ...c, abilities: [...c.abilities, ...rule] });
      }
    }
    // New effects come from the abilities objects have NOW (after the layers before this one): an ability granted in layer 6 produces layer 7 effects; one removed
    // in layer 6 produces none unless it already started.
    const fresh = [...staticEffectsOf(s, chars, layer), ...standing].filter((e) => hasLayer(e, layer) && !started.has(e.id));
    const carried = [...started.values()].map((x) => x.e).filter((e) => hasLayer(e, layer));
    const here = [...carried, ...fresh];
    // An ability granted by a layer 6 effect may have a layer 6 effect of its own (Rune of Flight on Colossus Hammer, CR 613.7a): look again after each grant.
    const discoverFor = (cda: boolean): (() => LiveEffect[]) | undefined =>
      layer === 6 ? () => staticEffectsOf(s, chars, layer).filter((e) => hasLayer(e, layer) && (e.effect.cda === true) === cda) : undefined;
    // CR 613.3 / 613.4a: characteristic-defining effects first. CR 613.8a(c): a dependency exists only between two CDAs or two non-CDAs.
    applyGroup(s, here.filter((e) => e.effect.cda === true), layer, chars, started, discoverFor(true), trace);
    applyGroup(s, here.filter((e) => e.effect.cda !== true), layer, chars, started, discoverFor(false), trace);
    if (layer === '7a') withoutValue(chars, started, starsAtStart);
    if (layer === stopAfter) break;
  }

  for (const [id, c] of chars) chars.set(id, { ...c, keywords: keywordsOfAbilities(c.abilities) });
  return chars;
}

/** M6-0: the effects that do not depend on characteristics: resolved effects (CR 611.2), counters (CR 613.4c) and the rule-generated ones (`RULE_EFFECTS`). */
function standingEffects(s: GameState): LiveEffect[] {
  const out = [...resolvedEffects(s), ...counterEffects(s)];
  for (const f of RULE_EFFECTS) out.push(...f(s));
  return out;
}

/**
 * M6-0 (statics/api.ts#Order1a, m6 design 2.5): the 1a effects that apply to an object, in the order layer 1a applies them (CR 613.8 dependency, then timestamp,
 * CR 613.7): exactly the order `computeAll` uses, read from the same computation stopped after layer 1a. Empty until a 1a applier exists (M6-2).
 */
export const order1a: Order1a = (s, id) => {
  if (!LAYER_TABLE['1a']) return [];
  const out: LiveEffect[] = [];
  computeWith(s, standingEffects(s), '1a', (layer, e, set) => {
    if (layer === '1a' && set.includes(id)) out.push(e);
  });
  return out;
};

/**
 * std-rx11 (CR 208.1, 613.4a-b): the characteristics of every object through layer 7b, before the modifications of 7c (effects that raise or lower power and
 * toughness, and counters, CR 613.4c) and the switching of 7d: power and toughness there are the BASE values (printed, or as a characteristic-defining ability or
 * an effect that sets them made them). Only rules/filter.ts reads it ("a creature with power greater than its base power"). Pure, computed per call.
 */
export function charsThroughLayer7b(s: GameState): Map<ObjectId, Chars> {
  return computeWith(s, standingEffects(s), '7b');
}

export const computeAll: ComputeAll = (s) => {
  const standing = standingEffects(s); // they do not depend on characteristics
  // CR 611.2b: "for as long as you control X" is judged with the controller AFTER layer 2 (CR 613.1b). An effect found over ends for good and the whole
  // computation is redone without it (it can only happen where such an effect exists, and each round ends at least one effect).
  const ended = new Set<string>();
  for (;;) {
    const chars = computeWith(s, ended.size === 0 ? standing : standing.filter((e) => !ended.has(e.id)));
    let more = false;
    for (const e of standing) {
      const w = e.endsUnlessControlled;
      if (!w || ended.has(e.id)) continue;
      if ((chars.get(w.object)?.controller ?? s.objects[w.object]?.controller) !== w.by) {
        ended.add(e.id);
        more = true;
      }
    }
    if (!more) return chars;
  }
};
