/**
 * Where the rule-affecting effects come from (design 9.2, 9.4: "players and rules are applied after objects", CR 613.10-613.11): the restriction, permission,
 * rule-modification and cost-modification effects (`StaticEffect` kinds `restrict`, `permit`, `rule`, `costMod`) of the static abilities objects have NOW, and
 * the ones resolved spells and abilities left in `GameState.continuousEffects` (CR 611.2; milestone 4's player restrictions since transition T1). Owner: WP16 (an
 * addition to the files of design 5.1, shared by statics/hooks.ts and statics/costmods.ts).
 *
 * Static abilities store nothing (CR 611.3a): every question re-derives the effects from the characteristics, so an ability granted or removed by the layer
 * system is honored (a creature that gained "can't block" in layer 6, Humility removing Thalia's ability).
 *
 * Characteristics. The import rules (design 5.4) keep `statics` from importing `rules/characteristics`, so this module reads characteristics the way the layer
 * system itself does: in a state where nothing can change what an object is (`layerSourcesPresent` false: no anthem, no "becomes", no resolved continuous
 * effect) each object's own characteristics (`intrinsicChars`, computed lazily, only for the objects a question looks at); otherwise `computeAll` over the whole
 * game, cached per state object and keyed by a fingerprint of everything the layers read (the same key rules/characteristics.ts uses; a test pins that the two
 * lists are equal).
 *
 * Cost of the common case. A game whose card definitions contain no rule-affecting effect anywhere (not in a static ability, not in a keyword expansion such as
 * affinity, not in an ability a card grants) and that has no such resolved effect answers every question with "nothing applies" after one memoized look
 * (`ruleSourcesPresent`). Milestone 3 and 4 games never pay more than that.
 */
import { stableScopeFor } from './stable-scope';
import type { AbilityDef, CostModDef, Duration, KeywordAbilityDef, ObjectFilter, ObjRef, PermissionDef, PlayerRef, RestrictionDef, RuleModDef, StaticEffect } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import { manaValue } from '../types/mana';
import { type ContinuousEffectRec, type GameObject, type GameState } from '../types/state';
import type { Chars } from '../rules/characteristics';
import { combineSplit, costForManaValue, fromFace } from '../rules/base-chars';
import { charAbilitiesOfBase, expansionOf, keywordsOfAbilities } from './abilities';
import { computeAll, intrinsicChars } from './layers';
import { layerSourcesPresent, numOf } from './live';
import { suspectedPresent } from './suspect';
import { whileObjectHolds } from './while-object';
import { evalCondition, filterMatches, isPlayerRef, objectsOf, playersOf, type EvalCx } from './match';

/** The `StaticEffect` kinds this module collects. */
export type RuleEffect = RestrictionDef | PermissionDef | RuleModDef | CostModDef;
export const RULE_EFFECT_KINDS: ReadonlySet<string> = new Set(['restrict', 'permit', 'rule', 'costMod']);
export const isRuleEffect = (e: StaticEffect): e is RuleEffect => RULE_EFFECT_KINDS.has(e.s);

/** One rule-affecting effect that functions right now, with what its evaluation needs ("you" is `controller`, `self` is `source`). */
export interface RuleSource {
  readonly effect: RuleEffect;
  /** The object whose static ability generates it, or the source of a resolved effect while it is still the same object (CR 400.7); null otherwise. */
  readonly source: ObjectId | null;
  /** Who "you" is: the source's controller after layer 2 for a static ability, the recorded controller for a resolved effect (CR 109.5). */
  readonly controller: PlayerId;
  /** CR 613.7a-b: the source's timestamp (or the granting effect's if later) for a static ability, the creation time for a resolved effect. */
  readonly timestamp: number;
  /** Total order: timestamp, then statics before resolved effects, then object or effect id, ability position, effect index. */
  readonly order: readonly number[];
  /** For messages: the source's name and the text of the ability (empty for a resolved effect). */
  readonly name: string;
  readonly text: string;
  /** FAST5X E2: the turn a resolved effect began (`ContinuousEffectRec.startedTurn`); absent for a static ability (`PermissionDef.laterTurn`, CR 702.185a). */
  readonly startedTurn?: number;
}

// ---- Does anything in this game produce a rule effect? -------------------------------------------------------------------------------------------------

const KW_CTX = { granted: false, faceName: '', types: [] as string[], keyPrefix: 'k:0:0' };

/** Is there a rule-affecting effect anywhere inside this value (a static ability, an ability granted by a modification, an `effect` step, a keyword expansion)? */
export function containsRuleEffect(v: unknown, depth = 0): boolean {
  if (depth > 40 || v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some((x) => containsRuleEffect(x, depth + 1));
  const r = v as Record<string, unknown>;
  if (typeof r['s'] === 'string' && RULE_EFFECT_KINDS.has(r['s'])) return true;
  if (r['kind'] === 'keyword' && typeof r['keyword'] === 'string') {
    for (const x of expansionOf(r as unknown as KeywordAbilityDef, KW_CTX)) if (containsRuleEffect(x, depth + 1)) return true;
  }
  for (const k in r) if (containsRuleEffect(r[k], depth + 1)) return true;
  return false;
}

/** What a definition can do: does it contain a rule effect anywhere, and in which zones do its own static abilities with one function (keyword expansions included)? */
interface DefRules {
  readonly any: boolean;
  readonly zones: ReadonlySet<string>;
}
const NO_RULES: DefRules = { any: false, zones: new Set() };
const DEF_RULES = new WeakMap<CardDef, DefRules>();

function addZones(a: AbilityDef, zones: Set<string>): void {
  if (a.kind === 'static' && (a.effects.some(isRuleEffect) || (a.otherwise ?? []).some(isRuleEffect))) for (const z of a.zone ?? ['battlefield']) zones.add(z); // CR 113.6, 604.5
  else if (a.kind === 'keyword') for (const x of expansionOf(a, KW_CTX)) addZones(x, zones);
}

/** Memoized per definition (definitions are immutable). */
function defRules(def: CardDef): DefRules {
  let v = DEF_RULES.get(def);
  if (!v) {
    const zones = new Set<string>();
    for (const f of def.faces) for (const a of f.abilities) addZones(a, zones);
    v = def.faces.some((f) => containsRuleEffect(f.abilities)) ? { any: true, zones } : NO_RULES;
    DEF_RULES.set(def, v);
  }
  return v;
}

/** Does this definition contain a rule effect anywhere (its own static abilities, keyword expansions, abilities it grants, effects it creates)? */
export const defHasRuleEffects = (def: CardDef): boolean => defRules(def).any;

/**
 * Memoized per `defs` object AND its size: Game.addDef copies the map once per run and then adds to it in place (a token's definition, CR 111.4), and
 * cloneState shares it, so the identity alone would keep a stale "no rule effect" (CR 611.3a). Definitions are only ever added, so a "yes" stays true.
 */
const DEFS_HAVE = new WeakMap<GameState['defs'], { v: boolean; n: number }>();
function sizeOf(defs: GameState['defs']): number {
  let n = 0;
  for (const _k in defs) n++;
  return n;
}
function defsHaveRuleEffects(defs: GameState['defs']): boolean {
  const hit = DEFS_HAVE.get(defs);
  if (hit?.v) return true;
  const n = sizeOf(defs);
  if (hit && hit.n === n) return false;
  let v = false;
  for (const k in defs) if (defHasRuleEffects(defs[k]!)) { v = true; break; }
  DEFS_HAVE.set(defs, { v, n });
  return v;
}

/**
 * The objects whose own static abilities can produce a rule effect where they are (a Thalia on the battlefield; a spell with affinity or "this spell can't be
 * countered" on the stack; not the same cards in a hand or a library). An object never changes zones without becoming a new object with a new id (CR 400.7),
 * so the list is memoized per state and object counter.
 */
interface Candidates {
  objectCounter: number;
  defs: GameState['defs'];
  defCount: number;
  ids: readonly ObjectId[];
}
const CANDIDATES = new WeakMap<GameState, Candidates>();

/**
 * WP32 (performance): the zones where each definition's own rule-affecting static abilities function, for the definitions that have any, memoized per `defs`
 * map and its size (as `defsHaveRuleEffects`). `candidates` then looks each object up by `defId` instead of asking every definition; a game none of whose
 * definitions has such a static ability skips the objects altogether. The same candidates as the scan of every object; their order may differ, which no
 * caller reads (see `candidates`).
 *
 * Accepted deviation from design 8.8 rule 3 ("no caching across actions outside the state"), declared in the WP32 review: `RULE_ZONES` and `ZONES_OF` outlive
 * an action, but each is a pure function of immutable data compared by identity (a `defs` map and its size, which only grows; CR 111.4), exactly like the
 * WP16 memo `defsHaveRuleEffects` it builds on, so no answer can go stale.
 */
const RULE_ZONES = new WeakMap<GameState['defs'], { n: number; byDef: ReadonlyMap<string, ReadonlySet<string>> }>();
function ruleZonesByDef(defs: GameState['defs'], n: number): ReadonlyMap<string, ReadonlySet<string>> {
  const hit = RULE_ZONES.get(defs);
  if (hit && hit.n === n) return hit.byDef;
  const byDef = new Map<string, ReadonlySet<string>>();
  if (defsHaveRuleEffects(defs)) {
    for (const k in defs) {
      const zones = defRules(defs[k]!).zones;
      if (zones.size > 0) byDef.set(k, zones);
    }
  }
  RULE_ZONES.set(defs, { n, byDef });
  return byDef;
}

/** The zones of all the definitions of `byDef`, once each (memoized with the map). */
const ZONES_OF = new WeakMap<ReadonlyMap<string, ReadonlySet<string>>, readonly string[]>();
function zonesOf(byDef: ReadonlyMap<string, ReadonlySet<string>>): readonly string[] {
  let z = ZONES_OF.get(byDef);
  if (!z) {
    const all = new Set<string>();
    for (const zones of byDef.values()) for (const x of zones) all.add(x);
    z = [...all];
    ZONES_OF.set(byDef, z);
  }
  return z;
}

function candidates(s: GameState): readonly ObjectId[] {
  const hit = CANDIDATES.get(s);
  const n = sizeOf(s.defs);
  if (hit && hit.objectCounter === s.counters.object && hit.defs === s.defs && hit.defCount === n) return hit.ids;
  const ids: ObjectId[] = [];
  const byDef = ruleZonesByDef(s.defs, n);
  if (byDef.size > 0) {
    // Only the zones where such an ability functions are looked at (a Thalia: the battlefield; a cast restriction: the hand and the stack). The order of the
    // ids does not matter: `collectSources` sorts the sources by their total order, and the other caller only counts them.
    const add = (list: readonly ObjectId[] | undefined): void => {
      for (const id of list ?? []) {
        const o = s.objects[id];
        if (!o || o.kind === 'ability') continue;
        if (byDef.get(o.defId)?.has(o.zone) === true) ids.push(id);
      }
    };
    for (const zone of zonesOf(byDef)) {
      if (zone === 'battlefield' || zone === 'stack' || zone === 'exile' || zone === 'command') add(s.zones[zone]);
      else if (zone === 'hand' || zone === 'graveyard' || zone === 'library') for (const p of s.players) add(s.zones[zone][p.id]);
    }
  }
  CANDIDATES.set(s, { objectCounter: s.counters.object, defs: s.defs, defCount: n, ids });
  return ids;
}

const hasRuleRecord = (s: GameState): boolean => s.continuousEffects.some((e) => containsRuleEffect(e.effect));

/**
 * Can anything in this state generate a restriction, permission, rule modification or cost modification right now? An object whose own ability functions
 * where it is, a resolved rule effect, or (in a state the layer system has to compute) a definition that could grant one. False for every milestone 3/4 game.
 */
export function ruleSourcesPresent(s: GameState): boolean {
  if (candidates(s).length > 0 || hasRuleRecord(s)) return true;
  if (suspectedPresent(s)) return true; // FAST5X E12: a suspected permanent's "This creature can't block" (CR 701.60c, statics/suspect.ts)
  return defsHaveRuleEffects(s.defs) && layerSourcesPresent(s);
}

// ---- Characteristics as the layer system sees them ------------------------------------------------------------------------------------------------------

/**
 * The characteristics of the objects of one state, for `EvalCx.all` (statics/match.ts only calls `get` and `has`). Layered states read the result of
 * `computeAll`; other states compute an object's own characteristics the first time it is asked for. `overrides` replace the characteristics of single
 * objects (a card in hand evaluated as the face being cast, CR 601.3e). Iterating it lists only what was computed so far: nothing here iterates it.
 */
export class CharsView extends Map<ObjectId, Chars> {
  constructor(
    readonly s: GameState,
    readonly layered: ReadonlyMap<ObjectId, Chars> | null,
    private readonly overrides: ReadonlyMap<ObjectId, Chars> = new Map(),
  ) {
    super();
  }

  override get(id: ObjectId): Chars | undefined {
    const o = this.overrides.get(id) ?? this.layered?.get(id) ?? super.get(id);
    if (o !== undefined) return o;
    const obj = this.s.objects[id];
    if (!obj || !this.s.defs[obj.defId]) return undefined; // a redacted object (viewFor) has no definition
    const c = intrinsicChars(this.s, obj);
    super.set(id, c);
    return c;
  }

  override has(id: ObjectId): boolean {
    return this.get(id) !== undefined;
  }

  /** The same characteristics over another state (an overlay of this one) with some objects replaced. */
  with(s: GameState, overrides: ReadonlyMap<ObjectId, Chars>): CharsView {
    const v = new CharsView(s, this.layered, overrides);
    if (this.ruleSources !== undefined) v.ruleSources = this.ruleSources; // Cloud C3: an overlay moves a card being cast, never an Aura's attachment
    return v;
  }

  /**
   * Cloud C3 (batch 3): the functioning rule effects of this view's state, set by `ruleContext` once they are collected (absent while they are being
   * collected, and on a view nothing collected them for).
   */
  ruleSources?: readonly RuleSource[];

  /**
   * Cloud C3 (batch 3), CR 701.15a-c: the players who goad this permanent through a static goad (`RestrictionDef.goad`), for the `goaded` filter of
   * statics/match.ts. Only a view of the rule effects has this method: the layer system evaluates its filters over plain maps of the characteristics
   * computed so far, before any rule effect exists (CR 613.10-613.11), so a layer filter "goaded" reads the goad action's entries only (no card has one).
   * Inside the collection of the rule effects themselves (a static ability's own "as long as" condition) the answer is empty: they do not exist yet.
   */
  goadedBy(id: ObjectId): readonly PlayerId[] {
    const sources = this.ruleSources ?? (COLLECTING.has(this.s) ? undefined : ruleContext(this.s)?.sources);
    return sources === undefined ? [] : staticGoaders(this, sources, id);
  }
}

/** Everything `computeAll` reads (rules/characteristics.ts `FINGERPRINTED`; a test pins that the lists are equal). */
export const LAYER_INPUTS: readonly (keyof GameState)[] = ['objects', 'zones', 'players', 'turn', 'combat', 'continuousEffects', 'designations'];

interface Cached {
  /** The characteristics map the view wraps (the layered cache's own map when the provider below is installed). */
  all: ReadonlyMap<ObjectId, Chars>;
  defs: GameState['defs'];
  view: CharsView;
  sources?: RuleSource[];
}
const CACHE = new WeakMap<GameState, Cached>();

/** The characteristics view and the functioning rule effects of a state. */
export interface RuleContext {
  readonly view: CharsView;
  readonly sources: readonly RuleSource[];
}

/** Observability for tests (never read by the engine). */
export const RULE_CONTEXT_STATS = { built: 0, cacheHits: 0 };

/** A layered state's view: `computeAll` is the expensive part, so it is cached per state object (which may be edited in place: the fingerprint decides). */
function layeredEntry(s: GameState): Cached {
  // W3b: inside a readingStable scope the state is held still, so its entry is checked against the cache once per scope (statics/stable-scope.ts)
  const scope = stableScopeFor(s);
  const scoped = scope?.memo.get('rule-sources') as Cached | undefined;
  if (scoped !== undefined && scoped.defs === s.defs) {
    RULE_CONTEXT_STATS.cacheHits++;
    return scoped;
  }
  const entry = layeredEntryChecked(s);
  scope?.memo.set('rule-sources', entry);
  return entry;
}

function layeredEntryChecked(s: GameState): Cached {
  // W3b: the characteristics of a layered state come from the one cache rules/characteristics.ts keeps (its fingerprint check, its computeAll), so a state is
  // serialized and computed once for both readers; the same map object means the state did not change (CR 613: same inputs, same characteristics)
  const all = layeredAllProvider !== null ? layeredAllProvider(s) : computeAll(s);
  const hit = CACHE.get(s);
  if (hit && hit.all === all && hit.defs === s.defs) {
    RULE_CONTEXT_STATS.cacheHits++;
    return hit;
  }
  RULE_CONTEXT_STATS.built++;
  const entry: Cached = { all, defs: s.defs, view: new CharsView(s, all) };
  CACHE.set(s, entry);
  return entry;
}

/** The layered characteristics cache of rules/characteristics.ts (installed there: statics may not import it, design 5.4). */
let layeredAllProvider: ((s: GameState) => ReadonlyMap<ObjectId, Chars>) | null = null;
export function installLayeredAllProvider(f: (s: GameState) => ReadonlyMap<ObjectId, Chars>): void {
  layeredAllProvider = f;
}

/** The characteristics of the objects of a state as the rule hooks read them (see `CharsView`). */
export function charsViewOf(s: GameState): CharsView {
  return layerSourcesPresent(s) ? layeredEntry(s).view : new CharsView(s, null);
}

/** The view and the functioning rule effects of a state, or null when nothing can produce one (`ruleSourcesPresent`). */
export function ruleContext(s: GameState): RuleContext | null {
  if (!ruleSourcesPresent(s)) return null;
  if (!layerSourcesPresent(s)) {
    RULE_CONTEXT_STATS.built++;
    const view = new CharsView(s, null);
    const sources = collectSources(s, view, candidates(s));
    view.ruleSources = sources; // Cloud C3: the `goaded` filter of a rule effect sees the static goads (CharsView#goadedBy)
    return { view, sources };
  }
  const entry = layeredEntry(s);
  entry.sources ??= collectSources(s, entry.view, Object.keys(s.objects)); // a layered state: any object may have been granted an ability
  entry.view.ruleSources ??= entry.sources;
  return { view: entry.view, sources: entry.sources };
}

// ---- Collecting the sources ----------------------------------------------------------------------------------------------------------------------------

/** Cloud C3: the states whose rule effects are being collected right now (CharsView#goadedBy answers nothing for them: no recursion). */
const COLLECTING = new WeakSet<GameState>();

function collectSources(s: GameState, view: CharsView, ids: readonly ObjectId[]): RuleSource[] {
  if (COLLECTING.has(s)) return collectSourcesOf(s, view, ids);
  COLLECTING.add(s);
  try {
    return collectSourcesOf(s, view, ids);
  } finally {
    COLLECTING.delete(s);
  }
}

function collectSourcesOf(s: GameState, view: CharsView, ids: readonly ObjectId[]): RuleSource[] {
  const out: RuleSource[] = [];
  for (const id of ids) {
    const o = s.objects[id];
    if (!o || o.kind === 'ability' || o.phasedOut) continue; // CR 702.26b; an ability on the stack has no abilities
    const c = view.get(id);
    if (!c) continue;
    let cx: EvalCx | undefined;
    c.abilities.forEach((a, pos) => {
      const d = a.def;
      if (d.kind !== 'static' || !(d.zone ?? ['battlefield']).includes(o.zone)) return; // CR 113.6, 604.5: a static ability functions in its zones
      if (!d.effects.some(isRuleEffect) && !(d.otherwise ?? []).some(isRuleEffect)) return;
      let effects = d.effects;
      let base = 0;
      if (d.condition) {
        cx ??= { s, all: view, source: id, controller: c.controller };
        // CR 611.3a: "as long as"; r5-static: while it is false, the `otherwise` effects (ordered after `effects`)
        if (!evalCondition(cx, d.condition)) {
          if (d.otherwise === undefined) return;
          effects = d.otherwise;
          base = d.effects.length;
        }
      }
      const ts = a.grantedAt !== undefined && a.grantedAt > o.timestamp ? a.grantedAt : o.timestamp; // CR 613.7a
      effects.forEach((e, j) => {
        const i = base + j;
        if (!isRuleEffect(e)) return;
        out.push({ effect: e, source: id, controller: c.controller, timestamp: ts, order: [ts, 0, numOf(id), pos, i], name: c.name, text: d.text });
      });
    });
  }
  for (const rec of s.continuousEffects) {
    if (!isRuleEffect(rec.effect) || !durationActive(s, view, rec)) continue;
    const src = rec.source && s.objects[rec.source.id]?.zone === rec.source.zone ? rec.source.id : null; // CR 400.7
    out.push({ effect: rec.effect, source: src, controller: rec.controller, timestamp: rec.timestamp, order: [rec.timestamp, 1, numOf(rec.id), 0, 0], name: rec.sourceName, text: '', startedTurn: rec.startedTurn });
  }
  return out.sort((a, b) => compareOrder(a.order, b.order));
}

function compareOrder(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Is a resolved effect still in force? "Until end of turn / combat" records are removed by core/steps.ts and the other durations by the code that ends them
 * (WP15); "for as long as" (CR 611.2b) is judged here, so a stale record never applies (the same test statics/live.ts makes for continuous effects).
 */
function durationActive(s: GameState, view: CharsView, rec: ContinuousEffectRec): boolean {
  const d: Duration = rec.duration;
  if (d.d === 'asLongAs') return evalCondition({ s, all: view, source: rec.source?.id ?? null, controller: rec.controller }, d.cond);
  if (d.d === 'whileObject') return whileObjectHolds(s, d); // std-rx32 (CR 611.2b)
  // std-control-1 (CR 500.7): dormant in the turn it began in (core/durations.ts#nextTurnBegins); audit-fix-2: with `turn`, during that extra turn only
  if (d.d === 'duringNextTurn') return d.turn === undefined ? s.turn.number > rec.startedTurn : s.turn.extraTurnId === d.turn && s.turn.number > rec.startedTurn;
  if (d.d !== 'whileSource') return true;
  const o = rec.source ? s.objects[rec.source.id] : undefined;
  if (!o || !rec.source || o.zone !== rec.source.zone) return false; // CR 611.2b, 400.7
  switch (d.as) {
    case 'onBattlefield': return o.zone === 'battlefield';
    case 'controlled': return (view.get(o.id)?.controller ?? o.controller) === rec.controller;
    case 'attached': return o.attachedTo !== undefined;
    case 'tapped': return o.tapped;
  }
}

// ---- Evaluation helpers ---------------------------------------------------------------------------------------------------------------------------------

/** The evaluation context of a source: "you" is its controller, `self` its object. */
export const cxOf = (ctx: RuleContext, src: RuleSource): EvalCx => ({ s: ctx.view.s, all: ctx.view, source: src.source, controller: src.controller });

// ---- Static goad (Cloud C3, batch 3) -----------------------------------------------------------------------------------------------------------------------

/** Cloud C3: a static goad ("enchanted creature is goaded", `RestrictionDef.goad`; CR 701.15a-c). */
export const isGoadEffect = (e: StaticEffect): e is RestrictionDef => e.s === 'restrict' && e.goad === true;

/** Is there a static goad anywhere inside this value (as `containsRuleEffect`, for the fast path of `staticGoadPresent`)? */
function containsGoad(v: unknown, depth = 0): boolean {
  if (depth > 40 || v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some((x) => containsGoad(x, depth + 1));
  const r = v as Record<string, unknown>;
  if (r['s'] === 'restrict' && r['goad'] === true) return true;
  for (const k in r) if (containsGoad(r[k], depth + 1)) return true;
  return false;
}
const DEF_GOAD = new WeakMap<CardDef, boolean>();
const DEFS_GOAD = new WeakMap<GameState['defs'], { v: boolean; n: number }>();
function defsHaveGoad(defs: GameState['defs']): boolean {
  const hit = DEFS_GOAD.get(defs);
  if (hit?.v) return true;
  const n = sizeOf(defs);
  if (hit && hit.n === n) return false;
  let v = false;
  for (const k in defs) {
    const def = defs[k]!;
    let d = DEF_GOAD.get(def);
    if (d === undefined) DEF_GOAD.set(def, (d = def.faces.some((f) => containsGoad(f.abilities))));
    if (d) { v = true; break; }
  }
  DEFS_GOAD.set(defs, { v, n });
  return v;
}

/**
 * Cloud C3: can a static goad function in this state? A definition with one (its own ability, an ability it grants, a token it creates; memoized per `defs` map
 * and its size, as `defsHaveRuleEffects`) or a resolved effect that is one. False in every game without such a card, so the last known information of a
 * permanent that leaves (core/zones.ts) costs nothing there.
 */
export function staticGoadPresent(s: GameState): boolean {
  return defsHaveGoad(s.defs) || s.continuousEffects.some((e) => isGoadEffect(e.effect));
}

const GOADERS = new WeakMap<CharsView, Map<ObjectId, readonly PlayerId[]>>();
const NONE: readonly PlayerId[] = Object.freeze([]);

/**
 * Cloud C3 (batch 3), CR 701.15a-c: the players who goad the permanent `id` through the static goads among `sources` (the source's controller, CR 109.5), in
 * source order, each once (CR 701.15d: a player who goads it twice adds nothing), memoized per view (one state, its characteristics and its sources). Only a permanent on the battlefield that is
 * not phased out (CR 701.15b, 702.26b). A goad whose subject reads the goaded designation itself would ask this again: that inner question answers nothing.
 */
export function staticGoaders(view: CharsView, sources: readonly RuleSource[], id: ObjectId): readonly PlayerId[] {
  const o = view.s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.phasedOut) return NONE;
  let memo = GOADERS.get(view);
  if (memo === undefined) GOADERS.set(view, (memo = new Map()));
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  memo.set(id, NONE); // in progress: the inner question of a self-referring subject
  const out: PlayerId[] = [];
  for (const src of sources) {
    const e = src.effect;
    if (!isGoadEffect(e) || out.includes(src.controller)) continue;
    const cx: EvalCx = { s: view.s, all: view, source: src.source, controller: src.controller };
    if (e.when !== undefined && !evalCondition(cx, e.when)) continue; // CR 611.3a
    if (refIncludes(cx, e.subject, id)) out.push(src.controller);
  }
  const v = out.length > 0 ? Object.freeze(out) : NONE;
  memo.set(id, v);
  return v;
}

/** Cloud C3: `staticGoaders` of a state (the functioning rule effects now), or nothing when the state has no static goad. */
export function staticGoadersOf(s: GameState, id: ObjectId): readonly PlayerId[] {
  if (!staticGoadPresent(s)) return NONE;
  const ctx = ruleContext(s);
  return ctx === null ? NONE : staticGoaders(ctx.view, ctx.sources, id);
}

/** Does the reference (a player reference or an object reference) include this player or object? */
export function refIncludes(cx: EvalCx, ref: ObjRef | PlayerRef, who: ObjectId | PlayerId): boolean {
  if (isPlayerRef(ref)) return playersOf(cx, ref).includes(who);
  return objRefIncludes(cx, ref, who);
}

function objRefIncludes(cx: EvalCx, ref: ObjRef, id: ObjectId): boolean {
  switch (ref.ref) {
    case 'each': return cx.s.objects[id] !== undefined && filterMatches(cx, id, ref.filter); // the filter's own zone (default: the battlefield)
    case 'union': return ref.of.some((r) => objRefIncludes(cx, r, id));
    default: return objectsOf(cx, ref).includes(id);
  }
}

/** The filter with "any zone" wherever it names none (the object an action concerns may be a card in hand, a spell, a permanent): `anyOf` and `not` too. */
export function anyZone(f: ObjectFilter): ObjectFilter {
  const out: ObjectFilter = f.zone === undefined ? { ...f, zone: 'any' } : { ...f };
  if (f.anyOf) out.anyOf = f.anyOf.map(anyZone);
  if (f.not) out.not = anyZone(f.not);
  return out;
}

/** Does the player word / reference describe `p`, relative to "you" of `cx`? */
export function playerPredIncludes(cx: EvalCx, pred: 'you' | 'opponent' | 'any' | PlayerRef, p: PlayerId): boolean {
  if (pred === 'any') return true;
  if (pred === 'you') return p === cx.controller;
  if (pred === 'opponent') return p !== cx.controller;
  return playersOf(cx, pred).includes(p);
}

/**
 * The characteristics a card would have as the given face on the stack (CR 601.3e, 709.3a, 712.11, 715.3: only that face is evaluated), with the abilities the
 * keyword library generates from it (affinity). `fused` combines both halves (CR 702.102b).
 */
export function spellFaceChars(s: GameState, o: GameObject, face: number, controller: PlayerId, fused = false): Chars | undefined {
  const def = s.defs[o.defId];
  const f = def?.faces[face];
  if (!def || !f) return undefined;
  const base = fused && def.layout === 'split' ? combineSplit(def) : fromFace(f, face);
  base.manaValue = manaValue(costForManaValue(def, base.face, base.manaCost), 0); // CR 202.3b
  const abilities = charAbilitiesOfBase(base);
  const { abilities: _printed, keywords: _kw, ...rest } = base;
  return { ...rest, controller, abilities, keywords: keywordsOfAbilities(abilities), cantHave: [] };
}

/** An overlay of the state in which one object stands somewhere else (a card in hand evaluated as a spell on the stack, CR 601.2f). */
export function overlayZone(s: GameState, id: ObjectId, zone: GameObject['zone']): GameState {
  const o = s.objects[id];
  if (!o || o.zone === zone) return s;
  // P1: copying the object map is the cost; while `s` is held still (statics/stable-scope.ts) the same overlay is built once (canCast and castsAsInstant of one
  // castCheck both ask for it). Readers never change an overlay: it only stands for "the card as a spell" in a question.
  const scope = stableScopeFor(s);
  const key = `overlay|${id}|${zone}`;
  const hit = scope?.memo.get(key) as GameState | undefined;
  if (hit !== undefined) return hit;
  const out = { ...s, objects: { ...s.objects, [id]: { ...o, zone } } };
  scope?.memo.set(key, out);
  return out;
}

const GRANTS_TO_SPELLS = new WeakMap<CardDef, boolean>();

/**
 * P1 guard of `overlayAsSpell`: could some permanent's static ability change a spell's characteristics (a continuous effect whose set lies on the stack)? A
 * conservative text test of each battlefield definition (memoized per definition): false means no overlay is needed, true only costs the overlay.
 */
function spellGrantsPresent(s: GameState): boolean {
  for (const id of s.zones.battlefield) {
    const def = s.defs[s.objects[id]?.defId ?? ''];
    if (!def) continue;
    let v = GRANTS_TO_SPELLS.get(def);
    if (v === undefined) {
      const text = JSON.stringify(def.faces);
      GRANTS_TO_SPELLS.set(def, (v = text.includes('"continuous"') && text.includes('"zone":"stack"')));
    }
    if (v) return true;
  }
  return false;
}

/**
 * FAST4 T24: an overlay in which a card stands on the stack as a spell its caster controls, and is LISTED there (CR 601.2a), so the layer system's sets of
 * spells ("artifact spells you cast have convoke", statics/match.ts#eachMatching reads the zone lists) include it. For the payment options of a card that is
 * not cast yet (rules/payment-options.ts#payableWithOptions). Readers never change it.
 */
export function overlayAsSpell(s: GameState, id: ObjectId, caster: GameObject['controller']): GameState {
  const o = s.objects[id];
  const riders = nextSpellKeywordRiders(s, caster);
  if (!o || o.zone === 'stack' || (!spellGrantsPresent(s) && riders.length === 0)) return s;
  const scope = stableScopeFor(s);
  const key = `spell|${id}|${caster}`;
  const hit = scope?.memo.get(key) as GameState | undefined;
  if (hit !== undefined) return hit;
  // p2-exile-play-1 (CR 601.2a): the zone it would be cast from, as the cast record says it once cast (statics/match.ts reads `castFrom` there for a card not yet on the
  // stack): "Noncreature spells you cast from exile have convoke" reaches a card in exile
  const from = { ...(o.cast ?? {}), from: o.zone } as NonNullable<GameObject['cast']>;
  let out: GameState = { ...s, objects: { ...s.objects, [id]: { ...o, zone: 'stack' as const, controller: caster, cast: from } }, zones: { ...s.zones, stack: [...s.zones.stack, id] } };
  // std-rx26 (CR 601.2a, 601.2f): the keyword a waiting "the next spell you cast this turn has convoke" rider would give this card as it is put on the stack
  // (core/turn-effects.ts#lockNextSpellKeywords makes the same record when it is cast), so castCheck sees the cost the cast will pay
  if (riders.length > 0) {
    const view = charsViewOf(out);
    const recs: ContinuousEffectRec[] = [];
    for (const r of riders) {
      if (r.filter !== undefined && !filterMatches({ s: out, all: view, source: r.sourceId ?? null, controller: r.controller }, id, r.filter)) continue;
      recs.push({
        id: `e${s.counters.effect + recs.length}`, source: null, sourceName: 'an effect', controller: r.controller, timestamp: s.counters.timestamp + recs.length, startedTurn: s.turn.number,
        duration: { d: 'endOfTurn' }, effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id, zone: 'stack' }] }, mods: [{ layer: 6, add: [r.keyword!] }] },
      });
    }
    if (recs.length > 0) out = { ...out, continuousEffects: [...out.continuousEffects, ...recs] };
  }
  scope?.memo.set(key, out);
  return out;
}

/** std-rx26: the waiting `keyword` riders of `caster` ("the next spell you cast this turn has affinity for artifacts", TurnState.nextSpell). Pure. */
function nextSpellKeywordRiders(s: GameState, caster: GameObject['controller']): NonNullable<GameState['turn']['nextSpell']> {
  return (s.turn.nextSpell ?? []).filter((r) => r.rider === 'keyword' && r.keyword !== undefined && r.player === caster);
}
