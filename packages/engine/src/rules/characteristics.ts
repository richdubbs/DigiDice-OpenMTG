/**
 * The characteristics function (CR 109.3): the single source of truth for what an object is.
 * Pure on GameState so the client can call it too. `getChars` / `charsOfObject` apply the continuous effects in layer order (CR 613) through
 * `statics/layers#computeAll`; nothing else may read `state.defs` for rules purposes. The characteristics BEFORE any effect (face selection, face-down,
 * combined split cards) live in rules/base-chars.ts, which the layer system starts from.
 *
 * Two paths, one result (milestone 5, WP9):
 *  - A state in which nothing can change what an object is except the object itself (no static ability with a continuous effect on any object, no resolved
 *    continuous effect: `layerSourcesPresent`) computes ONE object on its own (`intrinsicChars`: its base, the abilities the rules give it, its counters).
 *    That is every state of a game without anthems, Auras that change characteristics, "becomes" effects and the like, and it costs what milestone 4 cost.
 *  - Any other state is computed by `computeAll` for ALL objects together (a filter in layer 4 must see the layer 1-3 results of the others) and the whole map
 *    is cached per state object, keyed by a fingerprint of everything the layers read. See `allChars`.
 *
 * Every call returns a record with its OWN arrays (design 4.3, hazards 2-3): last known information stores the result, and a caller that edits what it got
 * (a test, a layer experiment) must never reach the cache or another caller's answer. The abilities inside are shared, immutable data.
 */
import type { AbilityDef, KeywordAbilityDef } from '../types/ability';
import type { CardDef, CardType, Supertype } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import { manaValue, type Color, type ManaCost } from '../types/mana';
import type { GameObject, GameState } from '../types/state';
import { EngineBug } from '../core/errors';
import type { CharsAdditions } from '../statics/api';
import { printedCharAbilities } from '../statics/abilities';
import { computeAll, intrinsicChars } from '../statics/layers';
import { copyChars } from '../statics/mods';
import { layerSourcesPresent } from '../statics/live';
import { holdStill, installScopeVerifier, stableScopeFor } from '../statics/stable-scope';
import { installLayeredAllProvider } from '../statics/rule-sources';
import { combineSplit, costForManaValue, fromFace } from './base-chars';
import { matchesSnapshot, snapshotOf, type DataSnapshot } from '../util/data-snapshot';

export { faceIndexOf } from './base-chars';
export type { CharAbility } from '../statics/api';

export interface PrintedAbility {
  /** Face the ability is printed on. */
  face: number;
  /** Index in FaceDef.abilities. */
  index: number;
  def: AbilityDef;
}

/**
 * The characteristics BEFORE any continuous effect (rules/base-chars.ts produces them): the starting point of the layer system. `abilities` are the printed
 * ones, without keys; `Chars` (below) is what `getChars` returns.
 */
export interface BaseChars {
  name: string;
  /** Every name the object has (a split card outside the stack has two, CR 709.4a). */
  names: string[];
  /** Face index the characteristics come from (0 for a combined split card). */
  face: number;
  /** True for a split card outside the stack (CR 709.4). */
  combined: boolean;
  manaCost: ManaCost | null;
  manaValue: number;
  colors: Color[];
  supertypes: Supertype[];
  types: CardType[];
  subtypes: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  abilities: PrintedAbility[];
  /** The keyword abilities among `abilities`, in order (CR 702). */
  keywords: KeywordAbilityDef[];
}

/**
 * The characteristics of an object (CR 109.3) after the layers (CR 613). Besides the base record's fields (design 9.2, `CharsAdditions`): the `controller`
 * (layer 2), every ability the object has with a stable key (`abilities`: printed `p:`, keyword-generated `k:`, granted `g:`, rule `r:`), the keyword abilities
 * among them after layer 6 (`keywords`: granted and removed keywords are seen by every `hasKeyword` caller), what the object "can't have" (`cantHave`) and
 * power and toughness after layers 7a-7d as decimal strings (a "*" that no characteristic-defining ability evaluated stays "*": the card is manual then).
 * `controller` is '' on the records `faceChars` and `combinedChars` return: a definition has no controller.
 */
export interface Chars extends Omit<BaseChars, 'abilities' | 'keywords'>, CharsAdditions {}

const PERMANENT_TYPES: readonly CardType[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

// ---- the cache of a layered state ----------------------------------------------------------------------------------------------

interface Layered {
  /** What the layers read when `all` was computed (`layerInputs`), as a data snapshot (util/data-snapshot.ts). */
  snap: DataSnapshot;
  defs: GameState['defs'];
  all: Map<ObjectId, Chars>;
}
const LAYERED = new WeakMap<GameState, Layered>();

/** Observability for tests (never read by the engine): how often a layered state was answered from the cache. */
export const CHARS_CACHE_STATS = { hits: 0, misses: 0 };

/**
 * Everything `computeAll` reads from a state (the "fingerprint"): objects (zone, controller, counters, attachments, links, chosen values, status), the zone lists,
 * players (life, counters, per-turn counts), the turn, combat, the continuous effects and the designations. Card definitions are compared by identity (they are
 * immutable, and the map is replaced when a token definition is added). The log, the RNG, the decision in progress and last known information are not read.
 *
 * Design 9.2 describes a revision counter bumped by the mutators that matter. The mutators belong to milestone 3/4 files and to other work packages of
 * milestone 5, none of which bump anything yet, so the revision is DERIVED from the state itself: the answer can never be stale, whoever changed the state and
 * however (in place during an action, by a test, by hand). The price is one walk of these parts per call on a layered state; states without layer sources never
 * pay it, and a caller that reads many objects of a state it does not change pays it once (`readingStable`). P1 (performance): the walk compares the parts with
 * a data snapshot taken when the entry was computed (util/data-snapshot.ts) instead of serializing them with JSON.stringify and comparing two strings the size of
 * the state, which was a third of the time of a soak game; the answer is the same (the snapshot differs exactly when the JSON would).
 * A real counter (`GameState.revision`) replaces this when the mutators are wired (see the report of WP9).
 */
function layerInputs(s: GameState): unknown[] {
  const parts: unknown[] = LAYER_WALK_ORDER.map((k) => s[k]);
  parts.push(historyKey(s)); // FAST5X E9: the history, when a definition can read it (CR 611.3a "as long as ... this turn")
  return parts;
}

/**
 * FAST5X E9 INTERFACE CHANGE (additive): a static ability may read `GameState.history` ("as long as two or more nonland permanents entered the battlefield under
 * your control this turn", statics/match.ts `happened`, CR 611.3a), so the cache key holds the history in games whose definitions can read it. The history is
 * append-only and its entries are frozen and shared between states (triggers/history.ts#recordHistory, util/clone.ts copies only the array): two histories with
 * the same length and the same last entry OBJECT are the same history, so the key is that length and a serial number of the last entry (O(1), exact: a history
 * rebuilt from JSON has new entry objects, which is only a cache miss). In a game no definition of which mentions a `happened` condition the key is null, so
 * other games pay nothing and never recompute because something happened.
 */
function historyKey(s: GameState): readonly number[] | null {
  if (!defsReadHistory(s.defs)) return null;
  const h = s.history;
  const last = h[h.length - 1];
  if (last === undefined) return [0, 0];
  let n = HISTORY_SERIAL.get(last);
  if (n === undefined) HISTORY_SERIAL.set(last, (n = ++historySerial));
  return [h.length, n];
}
const HISTORY_SERIAL = new WeakMap<object, number>();
let historySerial = 0;
/** Per definition: does its JSON mention a `happened` condition anywhere (its own abilities, granted ones, tokens it creates)? A pure memo of frozen data. */
const DEF_READS_HISTORY = new WeakMap<object, boolean>();
/** Per `defs` map and its size (definitions are only added to it, CR 111.4: a "yes" stays true; statics/rule-sources.ts#defsHaveRuleEffects does the same). */
const DEFS_READ_HISTORY = new WeakMap<GameState['defs'], { v: boolean; n: number }>();
function defsReadHistory(defs: GameState['defs']): boolean {
  const hit = DEFS_READ_HISTORY.get(defs);
  if (hit?.v) return true;
  let n = 0;
  for (const _k in defs) n++;
  if (hit && hit.n === n) return false;
  let v = false;
  for (const k in defs) {
    const d = defs[k]!;
    let r = DEF_READS_HISTORY.get(d);
    // FAST5X E28: and the history filter "attacked this turn" (statics/match.ts reads it, CR 611.3a)
    // CLOUD std-ecl: and the history count "the number of creatures that entered the battlefield under your control this turn" (statics/match.ts `happenedCount`)
    if (r === undefined) { const j = JSON.stringify(d); DEF_READS_HISTORY.set(d, (r = j.includes('"cond":"happened"') || j.includes('"attackedThisTurn":') || j.includes('"countersPutThisTurn":') || j.includes('"q":"happenedCount"'))); }
    if (r) { v = true; break; }
  }
  DEFS_READ_HISTORY.set(defs, { v, n });
  return v;
}

/**
 * The parts of the state the layer system reads (see `layerInputs`), and the ones it does not. Every key of `GameState` is in exactly one list: a test
 * pins that, so a field added to the state forces a decision here instead of silently making the cache stale. When statics/match.ts learns to read more
 * (the history of the turn, for "if a creature died this turn"), the key moves to the first list.
 */
export const FINGERPRINTED: readonly (keyof GameState)[] = ['objects', 'zones', 'players', 'turn', 'combat', 'continuousEffects', 'designations'];
/** Where a key of `FINGERPRINTED` comes in the walk (P1): the small parts that change most often first, so a changed state is told apart early. */
const WALK_RANK: Partial<Record<keyof GameState, number>> = { turn: 0, combat: 1, players: 2, zones: 3, continuousEffects: 4, designations: 5, objects: 6 };
/**
 * `FINGERPRINTED` in the order the snapshot walks it: DERIVED from `FINGERPRINTED` (which the state-key pins check), so a key added there is part of the cache
 * key at once, never left out by a second list. A key without a rank is walked last (correct, only slower to tell apart). Exported for the P1 test that pins it.
 */
export const LAYER_WALK_ORDER: readonly (keyof GameState)[] = [...FINGERPRINTED].sort((a, b) => (WALK_RANK[a] ?? 99) - (WALK_RANK[b] ?? 99));
/** FAST5X E9: `history` is read by the layers only through `historyKey` (a compact exact key, in games whose definitions can read it), never walked whole. */
export const NOT_READ_BY_LAYERS: readonly (keyof GameState)[] = [
  'schema', 'seed', 'rng', 'options', 'defs', 'stage', 'priority', 'pendingTriggers', 'turnActivations', 'delayedTriggers', 'history', 'reminders', 'lki',
  'pending', 'suspended', 'log', 'result', 'counters', 'actionCount',
];

/** The characteristics of every object of a layered state, computed once per distinct state (cache key: the state object plus a snapshot of its layer inputs). */
export function allChars(s: GameState): ReadonlyMap<ObjectId, Chars> {
  const scope = stableScopeFor(s);
  if (scope === null) return checkedAllChars(s);
  let all = scope.memo.get(SCOPE_KEY) as ReadonlyMap<ObjectId, Chars> | undefined;
  if (all === undefined) scope.memo.set(SCOPE_KEY, (all = checkedAllChars(s)));
  return all;
}
const SCOPE_KEY = 'chars';

function checkedAllChars(s: GameState): ReadonlyMap<ObjectId, Chars> {
  const hit = LAYERED.get(s);
  if (hit !== undefined) {
    if (hit.defs === s.defs && matchesSnapshot(hit.snap, layerInputs(s))) {
      CHARS_CACHE_STATS.hits++;
      return hit.all;
    }
  } else {
    const same = RECENT.find((r) => r.defs === s.defs && matchesSnapshot(r.snap, layerInputs(s)));
    if (same !== undefined) {
      LAYERED.set(s, same);
      CHARS_CACHE_STATS.hits++;
      return same.all;
    }
  }
  CHARS_CACHE_STATS.misses++;
  const all = computeAll(s); // pure: it does not change `s`, so the snapshot taken after it is what it read
  const entry: Layered = { snap: snapshotOf(layerInputs(s)), defs: s.defs, all };
  LAYERED.set(s, entry);
  RECENT.unshift(entry);
  if (RECENT.length > RECENT_SIZE) RECENT.pop();
  return all;
}

/**
 * P1 (performance): the last few computed entries, consulted for a state object that has no entry yet. Every action runs on a fresh clone of its input state
 * (core/apply.ts), and the soak, a bot or a UI asking "is this accepted?" applies many actions to the same state, so the first characteristics question of
 * an action used to recompute `computeAll` for a state whose layer inputs are exactly those of a state computed a moment earlier. An entry is reused only when
 * the definitions map is the same object and the layer inputs match its snapshot exactly, so the answer is the one `computeAll` would give (a memo of a pure
 * function of the compared data, like the per-definition templates of statics/layers.ts).
 *
 * Accepted deviation (P1, 2026-10-12; docs/ARCHITECTURE.md lists the allowed pure memos): this outlives the action, which docs/ARCHITECTURE.md ("Never cache anything outside the state across
 * actions") and design m5 8.8 rule 3 (a cache per Game, keyed by a revision counter) do not allow. The argument for it: it is keyed by exact equality of
 * everything `computeAll` reads (the defs map by identity, the layer inputs by `matchesSnapshot`), so it can only ever return what a fresh computation would.
 * Unlike WP32's accepted `RULE_ZONES` (keyed on immutable defs), it compares a snapshot of mutable state. The parse memo (parser/parse-memo.ts), the compile
 * memo (cards/compile-memo.ts) and the grammar memo (parser/chart.ts `BY_CONTENT`) are the same kind of process-wide exact-input memo and wait on the same
 * decision. If it is accepted, ARCHITECTURE.md and design 8.8 rule 3 are amended in the same merge (exact-input memos of pure functions allowed); if not,
 * `RECENT` goes and an action's first characteristics question recomputes again.
 */
const RECENT: Layered[] = [];
const RECENT_SIZE = 4;

// W3b: the rule hooks' view of a layered state reads this cache (one fingerprint and one computeAll per distinct state for both)
installLayeredAllProvider((s) => allChars(s));

/**
 * Run `read`, which reads `s` and DOES NOT CHANGE IT, checking the cache of a layered `s` once instead of once per characteristics call (WP30: the per-call
 * fingerprint of a whole state was 70% of the time of a game with static abilities, because callers such as `legalActions` and the trigger collector read every
 * object in turn). Synchronous and scoped: the SCOPE outlives nothing (its memo is dropped when the call returns). Reads of any other state (a clone a check
 * makes) take the normal path. Nested calls for the same state share the scope. P1: the scope is statics/stable-scope.ts's `holdStill` (shared with the rule
 * hookpoints and other read-only questions); the checked characteristics are memoized in the scope. The entries the cache keeps per state (`LAYERED`) and
 * the few recent ones (`RECENT`, a proposed deviation pending review, see there) do outlive it.
 */
export function readingStable<T>(s: GameState, read: () => T): T {
  return holdStill(s, read);
}

installScopeVerifier((s) => {
  if (!STABLE_READS.verify) return null;
  const before = snapshotOf(layerInputs(s));
  return () => {
    if (!matchesSnapshot(before, layerInputs(s))) throw new EngineBug('readingStable: the read changed the state it promised to hold still');
  };
});

/** Tests set `verify` to make every `readingStable` scope check that it really did not change its state (an EngineBug otherwise). Never set by the engine. */
export const STABLE_READS = { verify: false };

/** An object that is not (or no longer) the one in the state (last known information, a copy): computed as though the state held it. */
function charsOfDetached(s: GameState, o: GameObject): Chars {
  const alt: GameState = { ...s, objects: { ...s.objects, [o.id]: o } };
  return (layerSourcesPresent(alt) ? computeAll(alt).get(o.id) : undefined) ?? intrinsicChars(alt, o); // computeAll's result is private to this call: no copy needed
}

/** Characteristics of an object (CR 109.3), after every continuous effect (CR 613). */
export function charsOfObject(s: GameState, o: GameObject): Chars {
  if (s.objects[o.id] !== o) return charsOfDetached(s, o);
  if (!layerSourcesPresent(s)) return intrinsicChars(s, o);
  const hit = allChars(s).get(o.id);
  return hit ? copyChars(hit) : intrinsicChars(s, o); // a redacted object has no definition: only its own record can be computed (and fails as before)
}

/**
 * Who controls an object (CR 108.4, 613.1b): the controller after layer 2, not the stored `GameObject.controller` (which is the controller the object entered
 * with, or the one a manual or legacy control change gave it). Rules code that asks "does this player control it?" calls this; in a state without layer sources
 * it is the stored field and costs nothing. (Switching the milestone 3/4 call-sites to it is integration work, see the report of WP9.)
 */
export function controllerOf(s: GameState, o: GameObject | ObjectId): PlayerId {
  const obj = typeof o === 'string' ? s.objects[o] : o;
  if (!obj) throw new EngineBug(`controllerOf: no object ${String(o)}`);
  if (s.objects[obj.id] !== obj) return charsOfObject(s, obj).controller; // last known information, a copy
  if (!layerSourcesPresent(s)) return obj.controller;
  return allChars(s).get(obj.id)?.controller ?? obj.controller;
}

export function getChars(s: GameState, id: ObjectId): Chars {
  const o = s.objects[id];
  if (!o) throw new EngineBug(`getChars: no object ${id}`);
  return charsOfObject(s, o);
}

// ---- definitions, numbers, predicates ---------------------------------------------------------------------------------------------

const INTEGER = /^-?\d+$/;

/**
 * Power and toughness as numbers; null when the engine can't evaluate the printed value (a "*" or "1+*" that no characteristic-defining ability set). Rules code
 * treats an unknown power as 0 in damage and never applies toughness-based state-based actions to an unknown toughness.
 */
export function ptNumbers(c: Chars): { power: number | null; toughness: number | null } {
  return {
    power: c.power !== undefined && INTEGER.test(c.power) ? Number(c.power) : null,
    toughness: c.toughness !== undefined && INTEGER.test(c.toughness) ? Number(c.toughness) : null,
  };
}

/** A base record of a definition as `Chars`: printed abilities with keys, no controller (a definition has none), nothing granted. */
function ofDefinition(b: BaseChars): Chars {
  const { abilities: _printed, ...rest } = b;
  return { ...rest, controller: '' as PlayerId, abilities: printedCharAbilities(b), cantHave: [] };
}

/** Characteristics of a split card with both halves combined, as a fused split spell would have them (CR 702.102b, 709.4). */
export function combinedChars(def: CardDef): Chars {
  const c = combineSplit(def);
  c.manaValue = manaValue(c.manaCost, 0);
  return ofDefinition(c);
}

/**
 * `faceChars` of frozen definitions, computed once per face (a pure function of immutable data, like the templates of statics/layers.ts; never game state).
 * Callers get a copy with their own arrays.
 */
const FACE_CHARS = new WeakMap<CardDef, Chars[]>();

/** Characteristics a given face of a definition would have as a spell on the stack (used to check whether it can be cast, CR 601.3). */
export function faceChars(def: CardDef, idx: number): Chars {
  if (!Object.isFrozen(def)) return faceCharsOf(def, idx);
  let byFace = FACE_CHARS.get(def);
  if (!byFace) FACE_CHARS.set(def, (byFace = []));
  return copyChars((byFace[idx] ??= faceCharsOf(def, idx)));
}

function faceCharsOf(def: CardDef, idx: number): Chars {
  const c = fromFace(def.faces[idx]!, idx);
  c.manaValue = manaValue(costForManaValue(def, idx, c.manaCost), 0); // CR 202.3b
  return ofDefinition(c);
}

export const hasType = (c: Chars, t: CardType): boolean => c.types.includes(t);
export const hasSubtype = (c: Chars, t: string): boolean => c.subtypes.includes(t);

/** CR 110.4: permanent types. A card with one of these types becomes a permanent when it resolves (CR 608.3). */
export const isPermanentCard = (c: Chars): boolean => c.types.some((t) => PERMANENT_TYPES.includes(t));

/** Instant or sorcery (so it goes to the graveyard when it resolves, CR 608.2n). */
export const isInstantOrSorcery = (c: Chars): boolean => c.types.includes('Instant') || c.types.includes('Sorcery');

/** True if the object has the keyword (CR 702; multiple instances are redundant for the static keywords the engine implements). */
export function hasKeyword(c: Chars, keyword: string): boolean {
  return c.keywords.some((k) => k.keyword === keyword);
}
