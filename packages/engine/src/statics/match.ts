/**
 * Questions the layer system asks while it is still computing characteristics: which objects does an effect affect, which players, what number is a
 * quantity, is a condition true. Owner: WP9 (an addition to the files of design 5.1).
 *
 * Why this is not `rules/filter.ts` / `effects/eval.ts`: those read characteristics through `getChars`, which is `computeAll`. A filter in layer N must see the
 * results of layers < N for ALL objects (CR 613.1, 613.5) and nothing later, so the layer system evaluates filters over the characteristics computed so far
 * (`EvalCx.all`) and never recurses into itself. The import rules (design 5.4) keep `statics` from importing `rules/filter` anyway.
 *
 * Scope. Every `ObjectFilter` field with a defined meaning on the battlefield and in the other zones is evaluated (`STATIC_FILTER_FIELDS`); the history fields
 * (`enteredThisTurn`, `dealtDamageThisTurn`, ...), `targets` are not (`stackKind` is, since FAST4 T24, and `castFrom`, since std-rf) (they belong to the trigger and interpreter side), and a
 * filter that uses one NEVER matches, exactly like `rules/filter.ts` (a static ability that cannot be evaluated affects nothing instead of affecting the wrong
 * things; the capability tables keep such text out of automated cards). Quantities and conditions that need an event, a variable, an announced X or a step
 * result (`var`, `eventAmount`, `resultCount`, `did`, `happened`...) do not exist in a static ability and evaluate to "unknown" (`undefined` / false).
 */
import { isPlayerOnlyRef, isPrime, type Condition, type NumberCmp, type ObjectFilter, type ObjRef, type PlayerPred, type PlayerRef, type Quantity } from '../types/ability';
import { seatNeighbor } from './seats';
import { attachedPlayer } from './attached-player';
import type { ObjectId, PlayerId } from '../types/ids';
import type { Color } from '../types/mana';
import { COLORS, spentAtLeast } from '../types/mana';
import type { GameObject, GameState, ObjHandle } from '../types/state';
import type { Chars } from '../rules/characteristics';
import { commanderCastsOf, isCommander } from './commander';
import { partyCreatureOf, partySize, type PartyCreature } from './party';
import { readLink } from './links';
import { CREATURE_TYPES, LAND_TYPES, PERMANENT_TYPES, subtypeClass } from './subtypes';
import { hasSharedTypeLine, unlockedHalves } from '../rules/base-chars';

/** p2-graveyard-1: the method a spell was cast with is `via`, or its copy for another zone (`<via>:2`, as triggers/match.ts#castVia reads it). */
const viaOf = (paid: string | undefined, via: string): boolean => paid !== undefined && (paid === via || paid.startsWith(`${via}:`));

/** Everything an evaluation needs. `all` holds the characteristics computed so far (an object that is missing from it does not exist for the layer system). */
export interface EvalCx {
  readonly s: GameState;
  /**
   * Cloud C3 (batch 3) INTERFACE CHANGE (optional member): a view of the rule effects (statics/rule-sources.ts#CharsView) also tells who goads a permanent
   * through a static goad (CR 701.15a-c), for the `goaded` filter; the layer system's plain maps never do (no rule effect exists while layers apply).
   */
  readonly all: ReadonlyMap<ObjectId, Chars> & { goadedBy?(id: ObjectId): readonly PlayerId[] };
  /** The source of the effect ("this creature", "enchanted creature", "other"), or null for an effect whose source is gone. */
  readonly source: ObjectId | null;
  /** Who "you" is (CR 109.5). */
  readonly controller: PlayerId;
  /** The object being modified, for `{ref:'subject'}` ("its mana value"). */
  readonly subject?: ObjectId;
  /**
   * FAST3 T16 (INTERFACE CHANGE, optional): the defending player of the action being asked, for `{ref:'defending'}` (CR 506.2). Set only by the rule hooks for
   * an attack (statics/hooks.ts#canAttack: the player the creature would attack, or the controller of the planeswalker / protector of the battle), so "can't
   * attack unless defending player controls an Island" is judged per possible defender (CR 508.1c), in any number of players. FAST4 T33: also set for a block
   * (statics/hooks.ts#canBlock: the blocker's controller, CR 509.1a), for "~ can't be blocked as long as defending player controls an artifact". Elsewhere
   * `defending` stays unresolved (no players), as before.
   */
  readonly defending?: PlayerId;
}

/** The `ObjectFilter` fields this module evaluates (design 5.2: the layer system's side of `filter:<field>`). */
export const STATIC_FILTER_FIELDS: ReadonlySet<string> = new Set([
  'anyOf', 'not', 'zone', 'controller', 'owner', 'types', 'allTypes', 'notTypes', 'subtypes', 'allSubtypes', 'notSubtypes', 'supertypes', 'notSupertypes', 'colors',
  'notColors', 'colorless', 'multicolored', 'monocolored', 'name', 'notName', 'nameless', 'manaValue', 'power', 'toughness', 'keyword', 'notKeyword', 'hasAbility',
  'tapped', 'token', 'isCard', 'faceDown', 'transformed', 'attacking', 'blocking', 'blocked', 'self', 'is', 'other', 'attached', 'attachedToSource',
  'counters', 'sharesWith', 'chosen',
  'attachedToObject', // FAST4 T22
  'attachedToPlayer', // p2-damage-2 (CR 303.4, 702.5d), as rules/filter.ts reads it
  'equipped', 'modified', // FAST4 T33
  'enchanted', // FAST5 T39 (CR 303.4b)
  'enchantedBy', // FAST5 T68 (CR 303.4b, 109.4)
  'adventure', // FAST5 T68 (CR 715.1), as rules/filter.ts reads it
  'saddled', 'saddledThisTurn', // FAST5X E3: CR 702.171b-c, as rules/filter.ts reads them
  'crewedThisTurn', // r5-fxb: CR 702.122, as rules/filter.ts reads it
  'wasAttachedTo', // r5-fxb: CR 603.10a, as rules/filter.ts reads it
  'suspected', // FAST5X E12: CR 701.60b, as rules/filter.ts reads it
  'monstrous', // std-rx34: CR 701.37b, as rules/filter.ts reads it
  'goaded', // M12-3: CR 701.15b, as rules/filter.ts reads it
  'renowned', // std-ry8: CR 702.112b, as rules/filter.ts reads it
  'ringBearer', // MX3 (CR 701.54e)
  'attackingAlone', // CLOUD std-msh (CR 506.5), as rules/filter.ts reads it
  'toughnessGreaterThanPower', // std-rx16: CR 208.1, as rules/filter.ts reads it ("each creature spell you cast with toughness greater than its power")
  'stackKind', // FAST4 T24: "spells you cast" (CR 601.2a, 707.10), as rules/filter.ts reads it
  'castFrom', // std-rf: "spells you cast from your hand" (CR 601.2a, 707.10), as rules/filter.ts reads it
  'countersPutThisTurn', // std-rx12: "that you've put one or more +1/+1 counters on this turn" (CR 122.6, 611.3a), as rules/filter.ts reads it
  'blockingObject', 'blockedByObject', 'blockingOrBlockedBy', // p2-combat-flow-1: CR 509.1g-h, 506.4, as rules/filter.ts reads them
  'attackedThisTurn', // FAST5X E28: "creatures that attacked this turn", "as long as ~ attacked this turn" (CR 508.1, 611.3a), as rules/filter.ts reads it
]);

/**
 * M6-0 (m6 design 2.1): the designation and status fields, evaluated here too; the builder (model/capabilities.ts) advertises `sfilter:<field>` only for the
 * fields some package's mechanism sets (rules/registries.ts#FILTER_PARTS), like `filter:<field>`, so they are kept apart from the always-advertised list above.
 */
export const STATIC_STATUS_FIELDS: ReadonlySet<string> = new Set(['solved', 'prepared', 'prototyped', 'flipped', 'commander' /* M11-0, CR 903.3 */, 'harnessed' /* cloud r3-mech, CR 701.64 */]);

const KEY_OF: Record<Color, string[]> = { W: ['W', 'white'], U: ['U', 'blue'], B: ['B', 'black'], R: ['R', 'red'], G: ['G', 'green'] };

/** A color as a link stores it ("R" or "red", any case) -> the color symbol. */
export function colorFromWord(w: string): Color | undefined {
  const x = w.trim();
  return COLORS.find((c) => KEY_OF[c].some((k) => k.toLowerCase() === x.toLowerCase()));
}

/** The kinds of `Quantity` (`q`; `number` for a plain number), `Condition` (`cond`) and `ObjRef` (`ref`) this module evaluates. Anything else is "unknown" here (design 5.2: a card that needs it cannot be automated by the layers). */
export const STATIC_QUANTITY_KINDS: ReadonlySet<string> = new Set([
  'number', 'count', 'countPlayers', 'stat', 'life', 'zoneSize', 'counters', 'devotion', 'partySize', 'distinct', 'math', 'live', 'turnNumber', 'cardsDrawnThisTurn', 'spellsCastThisTurn',
  'lifeGainedThisTurn',
  'lifeLostThisTurn', // Cloud std-woe (CR 119.3, 120.3a): "where X is the amount of life you lost this turn"
  'descendedThisTurn', // FAST5X E22 (CR 700.11)
  'turnsBegun', // std-r9 (CR 500.7, 500.11): "You can't cast ~ during your first, second, or third turns of the game"
  'startingLife', // FAST5 T60 (CR 103.4): "as long as you have at least 7 life more than your starting life total"
  'unlockedDoors', // r4-static (CR 709.5c): "as long as there are two or more unlocked doors among Rooms you control"
  'costCount', // std-costs-1 (CR 601.2b, 601.2f): "for each permanent sacrificed this way" (the number announced for an optional cost)
  'kickCount', // M6-0 (CR 702.33d-e); faceUpX (CR 702.37f) is read by the interpreter only until M6-3 needs it in a static ability
  'commanderCasts', // M11-0 (CR 903.8): Commander's Insignia
  'speed', // FAST5X-4 (CR 702.179f): "where X is your speed"
  'unspentMana', // FAST5X E19 (CR 106.4): "as long as you have six or more unspent mana"
  'happenedCount', // CLOUD std-ecl (CR 611.3a): "where X is the number of creatures that entered the battlefield under your control this turn"
]);
export const STATIC_CONDITION_KINDS: ReadonlySet<string> = new Set(['all', 'any', 'not', 'compare', 'exists', 'matches', 'turnOf', 'wasCast', 'designation', 'chosen', 'classLevel' /* M6-0, CR 716.2a */, 'completedDungeon' /* MX4, CR 309.7 */,
  'happened' /* FAST5X E9, CR 611.3a, 603.4-style history: rules/characteristics.ts keys its cache on the history when a definition reads it */, 'prime' /* std-rx1 */]);
export const STATIC_OBJREF_KINDS: ReadonlySet<string> = new Set(['self', 'subject', 'attachedTo', 'each', 'fixed', 'union', 'linked']);

/** The layouts of a double-faced card or token (CR 712.1: nonmodal and modal double-faced cards; CR 111.13 double-faced tokens). Meld cards are not here:
 * a melded permanent is never a transformed permanent (CR 701.27g); a battle's layout is `transform`. */
const DOUBLE_FACED_LAYOUTS: ReadonlySet<string> = new Set(['transform', 'modal_dfc', 'double_faced_token']);

/**
 * CR 701.27g: a "transformed permanent" is a double-faced permanent on the battlefield with its back face up, whichever kind of double-faced card it is
 * (a modal double-faced card played as its back face is one, CR 712.1); never a melded or merged permanent. Shared by the layer system and rules/filter.ts.
 */
export function isTransformedPermanent(s: GameState, o: GameObject): boolean {
  return o.zone === 'battlefield' && o.face >= 1 && DOUBLE_FACED_LAYOUTS.has(s.defs[o.defId]?.layout ?? '');
}

export const isPlayerRef = (r: ObjRef | PlayerRef): r is PlayerRef => {
  if (isPlayerOnlyRef(r)) return true; // M12-1: the one table of player-only references (types/ability.ts, m12 design 4.3)
  switch (r.ref) {
    case 'each': return 'who' in r;
    case 'fixed': return 'players' in r;
    default: return false;
  }
};

// ---- Objects ----------------------------------------------------------------------------------------------------------------

const objOf = (cx: EvalCx, id: ObjectId | null | undefined): GameObject | undefined => (id ? cx.s.objects[id] : undefined);

/** The ids a reference stands for, de-duplicated, in a deterministic order. References that need an event, a target or a step name resolve to nothing. */
export function objectsOf(cx: EvalCx, ref: ObjRef): ObjectId[] {
  switch (ref.ref) {
    case 'self':
      return cx.source !== null && cx.all.has(cx.source) ? [cx.source] : [];
    case 'subject':
      return cx.subject !== undefined && cx.all.has(cx.subject) ? [cx.subject] : [];
    case 'attachedTo': {
      const host = objOf(cx, cx.source)?.attachedTo;
      return host !== undefined && cx.all.has(host) && cx.s.objects[host]?.zone === 'battlefield' ? [host] : [];
    }
    case 'each':
      return eachMatching(cx, ref.filter);
    case 'fixed':
      return dedupe(ref.objects.filter((h) => cx.all.has(h.id) && cx.s.objects[h.id]?.zone === h.zone).map((h) => h.id)); // CR 400.7: a handle in the wrong zone is a new object
    case 'union':
      return dedupe(ref.of.flatMap((r) => objectsOf(cx, r)));
    case 'linked': {
      const link = readLink(objOf(cx, cx.source), ref.link);
      return dedupe((link?.objects ?? []).filter((h: ObjHandle) => cx.all.has(h.id) && cx.s.objects[h.id]?.zone === h.zone).map((h: ObjHandle) => h.id));
    }
    default:
      return [];
  }
}

function dedupe(ids: ObjectId[]): ObjectId[] {
  return ids.length < 2 ? ids : [...new Set(ids)];
}

const ZONE_LISTS = ['battlefield', 'stack', 'exile', 'command'] as const;

/** Every object (zone default: the battlefield) whose characteristics so far satisfy `f`. */
export function eachMatching(cx: EvalCx, f: ObjectFilter): ObjectId[] {
  if (!evaluable(f)) return [];
  const zone = f.zone ?? 'battlefield';
  const out: ObjectId[] = [];
  const consider = (id: ObjectId): void => {
    if (cx.all.has(id) && filterMatches(cx, id, f)) out.push(id);
  };
  if (zone === 'battlefield') {
    for (const id of cx.s.zones.battlefield) consider(id);
    return out;
  }
  const z = cx.s.zones;
  const zones: string[] = zone === 'any' ? ['battlefield', 'stack', 'exile', 'command', 'hand', 'graveyard', 'library'] : Array.isArray(zone) ? zone : [zone];
  const seen = new Set<ObjectId>();
  for (const name of zones) {
    const lists: readonly (readonly ObjectId[])[] = (ZONE_LISTS as readonly string[]).includes(name)
      ? [z[name as (typeof ZONE_LISTS)[number]]]
      : cx.s.players.map((p) => z[name as 'hand' | 'graveyard' | 'library'][p.id] ?? []);
    for (const list of lists) for (const id of list) if (!seen.has(id)) { seen.add(id); consider(id); }
  }
  return out;
}

// ---- Filters ----------------------------------------------------------------------------------------------------------------

/** Does every field of the filter (and of its anyOf / not branches) belong to this module's table? */
export function evaluable(f: ObjectFilter): boolean {
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue;
    if (!STATIC_FILTER_FIELDS.has(k) && !STATIC_STATUS_FIELDS.has(k)) return false;
  }
  if (f.anyOf && !f.anyOf.every(evaluable)) return false;
  if (f.not && !evaluable(f.not)) return false;
  return true;
}

const num = (s: string | undefined): number | null => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : null);

function cmp(cx: EvalCx, c: NumberCmp, actual: number | null): boolean {
  if (actual === null) return false;
  const v = evalQuantity(cx, c.value);
  if (v === undefined) return false;
  switch (c.op) {
    case '<=': return actual <= v;
    case '>=': return actual >= v;
    case '==': return actual === v;
    case '!=': return actual !== v;
    case '<': return actual < v;
    case '>': return actual > v;
  }
}

/** Does the player word / reference describe `p`, relative to the effect's controller? */
function playerMatches(cx: EvalCx, pred: PlayerPred | undefined, p: PlayerId): boolean {
  if (pred === undefined || pred === 'any') return true;
  if (pred === 'you') return p === cx.controller;
  if (pred === 'opponent') return p !== cx.controller;
  return playersOf(cx, pred).includes(p);
}

const wordList = (x: string | string[] | undefined): string[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** Do the characteristics computed so far of object `id` satisfy the filter? Call `evaluable` first when a false from an unknown field must not be negated. */
export function filterMatches(cx: EvalCx, id: ObjectId, f: ObjectFilter): boolean {
  if (!evaluable(f)) return false;
  return match(cx, id, f);
}

function match(cx: EvalCx, id: ObjectId, f: ObjectFilter): boolean {
  const o = cx.s.objects[id];
  const c = cx.all.get(id);
  if (!o || !c) return false;
  if (o.phasedOut) return false; // CR 702.26b: a phased-out permanent is treated as though it does not exist
  // cmd1 (CR 400.1, 611.3a): an option of `anyOf` (or the `not`) that names no zone is about the zone of the whole filter: "each historic card in your hand" is an
  // artifact, legendary or Saga card IN YOUR HAND (rules/filter.ts reads a branch's missing zone the same way); without that, every branch defaulted to the
  // battlefield and no card in a hand or graveyard ever matched
  const inherit = (x: ObjectFilter): ObjectFilter => (x.zone === undefined && f.zone !== undefined && f.zone !== 'any' ? { ...x, zone: f.zone } : x);
  if (f.anyOf && !f.anyOf.some((x) => match(cx, id, inherit(x)))) return false;
  if (f.not && match(cx, id, inherit(f.not))) return false;
  const zone = f.zone ?? 'battlefield';
  if (zone !== 'any' && !(Array.isArray(zone) ? zone : [zone]).includes(o.zone)) return false;
  if (f.controller !== undefined && !playerMatches(cx, f.controller, c.controller)) return false;
  if (f.owner !== undefined && !playerMatches(cx, f.owner, o.owner)) return false;
  if (f.types && !f.types.some((t) => (c.types as string[]).includes(t))) return false;
  if (f.allTypes && !f.allTypes.every((t) => (c.types as string[]).includes(t))) return false;
  if (f.notTypes && f.notTypes.some((t) => (c.types as string[]).includes(t))) return false;
  if (f.subtypes && !f.subtypes.some((t) => c.subtypes.includes(t))) return false;
  if (f.allSubtypes && !f.allSubtypes.every((t) => c.subtypes.includes(t))) return false; // std-rx32 (CR 205.3m)
  if (f.notSubtypes && f.notSubtypes.some((t) => c.subtypes.includes(t))) return false;
  if (f.supertypes && !f.supertypes.some((t) => (c.supertypes as string[]).includes(t))) return false;
  if (f.notSupertypes && f.notSupertypes.some((t) => (c.supertypes as string[]).includes(t))) return false;
  if (f.colors && !f.colors.some((x) => c.colors.includes(x))) return false;
  if (f.notColors && f.notColors.some((x) => c.colors.includes(x))) return false;
  if (f.colorless !== undefined && (c.colors.length === 0) !== f.colorless) return false;
  if (f.multicolored !== undefined && (c.colors.length >= 2) !== f.multicolored) return false;
  if (f.monocolored !== undefined && (c.colors.length === 1) !== f.monocolored) return false;
  if (f.name !== undefined && !c.names.includes(f.name)) return false;
  if (f.notName !== undefined && c.names.includes(f.notName)) return false;
  if (f.nameless !== undefined && !c.names.some((n) => n !== '') !== f.nameless) return false; // r5-static: CR 201.2a, 708.2a
  if (f.manaValue && !cmp(cx, f.manaValue, c.manaValue)) return false;
  if (f.power && !cmp(cx, f.power, num(c.power))) return false;
  if (f.toughness && !cmp(cx, f.toughness, num(c.toughness))) return false;
  // std-rx16 (CR 208.1): as rules/filter.ts reads it; an object with no number for either never has it
  if (f.toughnessGreaterThanPower === true) { const tp = num(c.toughness); const pp = num(c.power); if (tp === null || pp === null || tp <= pp) return false; }
  if (f.keyword !== undefined && !wordList(f.keyword).some((k) => c.keywords.some((x) => x.keyword === k))) return false;
  if (f.notKeyword !== undefined && wordList(f.notKeyword).some((k) => c.keywords.some((x) => x.keyword === k))) return false;
  if (f.hasAbility !== undefined && !c.abilities.some((a) => abilityIsOfKind(a.def, f.hasAbility!))) return false;
  if (f.tapped !== undefined && o.tapped !== f.tapped) return false;
  if (f.token !== undefined && (o.kind === 'token') !== f.token) return false; // CR 111.1
  if (f.isCard !== undefined && (o.kind === 'card') !== f.isCard) return false;
  if (f.faceDown !== undefined && o.faceDown !== f.faceDown) return false;
  if (f.transformed !== undefined && isTransformedPermanent(cx.s, o) !== f.transformed) return false; // CR 701.27g
  if (f.self !== undefined && (id === cx.source) !== f.self) return false;
  if (f.other !== undefined && f.other && id === cx.source) return false;
  if (f.is !== undefined && !objectsOf(cx, f.is).includes(id)) return false;
  if (f.attacking !== undefined && !attackingMatches(cx, id, f.attacking)) return false;
  // CLOUD std-msh (CR 506.5): attacking, and no other creature is
  if (f.attackingAlone === true && (cx.s.combat?.attackers.length !== 1 || cx.s.combat.attackers[0]!.id !== id)) return false;
  if (f.blocking !== undefined && (cx.s.combat?.blockers.some((b) => b.id === id) === true) !== f.blocking) return false; // CR 509.1g
  // CR 509.1h: blocked and unblocked are both said of attacking creatures only (std-rx23: a creature that is not attacking is not unblocked)
  if (f.blocked !== undefined && cx.s.combat?.attackers.some((a) => a.id === id && a.blocked === f.blocked) !== true) return false;
  if (f.attached !== undefined && isAttachedAtAll(cx, o) !== f.attached) return false;
  if (f.attachedToSource !== undefined && (objOf(cx, cx.source)?.attachedTo === id) !== f.attachedToSource) return false;
  // FAST4 T22: attached to one of these objects (CR 301.5, 303.4), as the attachments are now (CR 611.3a)
  if (f.attachedToObject !== undefined && (o.zone !== 'battlefield' || o.attachedTo === undefined || !objectsOf(cx, f.attachedToObject).includes(o.attachedTo))) return false;
  // p2-combat-flow-1 (CR 509.1g-h, 506.4): blocking one of these objects, blocked by one of them now, or either ("Creatures blocking or blocked by ~ have lifelink")
  if (f.blockingObject !== undefined && !blocksAny(cx, id, objectsOf(cx, f.blockingObject))) return false;
  if (f.blockedByObject !== undefined && !blockedByAnyOf(cx, id, objectsOf(cx, f.blockedByObject))) return false;
  if (f.blockingOrBlockedBy !== undefined) { const others = objectsOf(cx, f.blockingOrBlockedBy); if (!blocksAny(cx, id, others) && !blockedByAnyOf(cx, id, others)) return false; }
  // p2-damage-2 (CR 303.4, 702.5d): attached to a player the predicate names, as rules/filter.ts reads it
  if (f.attachedToPlayer !== undefined && (o.zone !== 'battlefield' || o.attachedTo === undefined || !cx.s.players.some((p) => p.id === o.attachedTo) || !playerMatches(cx, f.attachedToPlayer, o.attachedTo as PlayerId))) return false;
  // FAST4 T33: equipped (CR 301.5) and modified (CR 700.9), as rules/filter.ts reads them, with the characteristics of this evaluation
  if (f.equipped !== undefined && equippedNow(cx, o) !== f.equipped) return false;
  if (f.modified !== undefined && modifiedNow(cx, o, c) !== f.modified) return false;
  // MX3, CR 701.54e: the Ring-bearer of a player the predicate names, under that player's control as computed so far (as rules/filter.ts reads it; the
  // designation is no characteristic, so it is read from the state, not from layers: CR 701.54b)
  if (f.ringBearer !== undefined) {
    const p = c.controller;
    if (o.zone !== 'battlefield' || cx.s.designations.ring?.[p]?.bearer !== id || !playerMatches(cx, f.ringBearer, p)) return false;
  }
  if (f.enchanted !== undefined && attachedChars(cx, o).some((a) => a.subtypes.includes('Aura')) !== f.enchanted) return false; // FAST5 T39, CR 303.4b
  // FAST5 T68, CR 715.1: an adventurer card has an Adventure, in any zone (a face of its definition with the Adventure subtype), as rules/filter.ts reads it
  if (f.adventure !== undefined && (cx.s.defs[o.defId]?.faces.some((face) => face.subtypes.includes('Adventure')) === true) !== f.adventure) return false;
  // FAST5 T68, CR 303.4b: an Aura that the described player controls is attached to it
  if (f.enchantedBy !== undefined && !attachedChars(cx, o).some((a) => a.subtypes.includes('Aura') && playerMatches(cx, f.enchantedBy, a.controller))) return false;
  if (f.counters) {
    // FAST4 T27: kind 'any' is a counter of any kind (CR 122.1), as in rules/filter.ts
    const n = f.counters.kind === 'any' ? Object.values(o.counters).reduce((a, b) => a + b, 0) : o.counters[f.counters.kind] ?? 0;
    if (f.counters.cmp ? !cmp(cx, f.counters.cmp, n) : n <= 0) return false;
  }
  if (f.sharesWith && !sharesQuality(cx, id, f.sharesWith)) return false;
  if (f.chosen && !hasChosen(cx, c, f.chosen)) return false;
  // M6-0: designations and statuses (CR 719.3b solved, 722.3a prepared, 718.3b-d prototyped, 710 flipped), as rules/filter.ts reads them
  if (f.solved !== undefined && (o.solved === true) !== f.solved) return false;
  if (f.harnessed !== undefined && (o.harnessed === true) !== f.harnessed) return false; // cloud r3-mech (CR 701.64)
  if (f.prepared !== undefined && (o.prepared === true) !== f.prepared) return false;
  if (f.prototyped !== undefined && (o.prototyped === true) !== f.prototyped) return false;
  if (f.flipped !== undefined && o.flipped !== f.flipped) return false;
  if (f.commander !== undefined && isCommander(cx.s, o) !== f.commander) return false; // M11-0: CR 903.3, 903.3b-d
  // FAST5X E3: the saddled designation (CR 702.171b) and the creatures that saddled a permanent this turn (CR 702.171c), as rules/filter.ts reads them
  if (f.saddled !== undefined && (o.zone === 'battlefield' && o.saddled === true) !== f.saddled) return false;
  if (f.suspected !== undefined && (o.zone === 'battlefield' && o.suspected !== undefined) !== f.suspected) return false; // FAST5X E12 (CR 701.60b)
  if (f.monstrous !== undefined && (o.zone === 'battlefield' && o.monstrous === true) !== f.monstrous) return false; // std-rx34 (CR 701.37b)
  // M12-3 (CR 701.15b); Cloud C3: also goaded by a static goad (CR 701.15a-c), which only a view of the rule effects knows (`EvalCx.all`)
  if (f.goaded !== undefined && (o.zone === 'battlefield' && ((o.goaded?.length ?? 0) > 0 || (cx.all.goadedBy?.(id).length ?? 0) > 0)) !== f.goaded) return false;
  if (f.renowned !== undefined && (o.zone === 'battlefield' && o.renowned === true) !== f.renowned) return false; // std-ry8 (CR 702.112b)
  if (f.saddledThisTurn !== undefined && !objectsOf(cx, f.saddledThisTurn).some((m) => (cx.s.objects[m] ?? cx.s.lki[m]?.object)?.saddledBy?.includes(id) === true)) return false;
  if (f.crewedThisTurn !== undefined && !objectsOf(cx, f.crewedThisTurn).some((m) => (cx.s.objects[m] ?? cx.s.lki[m]?.object)?.crewedBy?.includes(id) === true)) return false; // r5-fxb (CR 702.122)
  if (f.wasAttachedTo !== undefined && !objectsOf(cx, f.wasAttachedTo).some((m) => cx.s.lki[m]?.attached?.ids?.includes(id) === true)) return false; // r5-fxb (CR 603.10a)
  // FAST4 T24: what kind of stack object (CR 405.1, 707.10: a copy of a spell is a spell, but it was never cast), as rules/filter.ts#stackKindMatches reads it
  if (f.stackKind !== undefined && !stackKindOk(o, f.stackKind)) return false;
  // std-rf (CR 601.2a, 707.10): the zone a spell was cast from, as rules/filter.ts reads it (a copy was never cast, so it has none)
  if (f.castFrom !== undefined && (o.stack?.castFrom ?? o.cast?.from) !== f.castFrom) return false;
  // FAST5X E28 (CR 508.1, 611.3a): declared as an attacker this turn, as this object (CR 400.7), read from the turn's history like rules/history.ts
  // #attackedThisTurn (statics may not import rules/history, design 5.4; rules/characteristics.ts keys its cache on the history when a definition reads it)
  if (f.attackedThisTurn !== undefined && attackedThisTurnIn(cx.s, id) !== f.attackedThisTurn) return false;
  if (f.countersPutThisTurn !== undefined && !countersPutThisTurnIn(cx.s, id, f.countersPutThisTurn.kind, cx.controller)) return false; // std-rx12 (CR 122.6)
  return true;
}

/** std-rx12: the same reading as rules/history.ts#countersPutThisTurn (a `counters` entry of this turn on this object, put by that player). */
const countersPutThisTurnIn = (s: GameState, id: ObjectId, kind: string, by: PlayerId): boolean =>
  s.history.some((e) => e.turn === s.turn.number && e.ev === 'counters' && e.subject === id && e.facts['change'] === 'put' && e.facts['onPlayer'] !== true && (kind === 'any' || e.facts['kind'] === kind) && e.facts['by'] === by);
/** FAST5X E28: the same reading as rules/history.ts#attackedThisTurn (an `attacks` entry of this turn whose subject is this object). */
const attackedThisTurnIn = (s: GameState, id: ObjectId): boolean => s.history.some((e) => e.turn === s.turn.number && e.ev === 'attacks' && e.subject === id);

function stackKindOk(o: GameObject, kind: NonNullable<ObjectFilter['stackKind']>): boolean {
  if (o.zone !== 'stack') return false;
  const isAbility = o.kind === 'ability';
  switch (kind) {
    case 'spell': return !isAbility;
    case 'activatedAbility': return isAbility && o.stack?.kind === 'activated';
    case 'triggeredAbility': return isAbility && o.stack?.kind === 'triggered';
    case 'ability': return isAbility;
    case 'copy': return o.kind === 'spellCopy' || o.stack?.isCopy === true;
  }
}

function abilityIsOfKind(def: { kind: string; isMana?: boolean }, k: 'activated' | 'mana' | 'triggered' | 'static'): boolean {
  if (k === 'mana') return def.kind === 'activated' && def.isMana === true;
  return def.kind === k;
}

/** p2-combat-flow-1 (CR 509.1g, 506.4): does this creature block one of these objects now? */
const blocksAny = (cx: EvalCx, id: ObjectId, attackers: readonly ObjectId[]): boolean =>
  (cx.s.combat?.blockers.find((b) => b.id === id)?.blocking ?? []).some((a) => attackers.includes(a));
/** p2-combat-flow-1 (CR 509.1h, 506.4): is this attacker blocked now by one of these objects? */
const blockedByAnyOf = (cx: EvalCx, id: ObjectId, blockers: readonly ObjectId[]): boolean =>
  (cx.s.combat?.attackers.find((a) => a.id === id)?.blockedBy ?? []).some((b) => blockers.includes(b));

function attackingMatches(cx: EvalCx, id: ObjectId, want: boolean | { defender: PlayerPred; orPlaneswalker?: true }): boolean {
  const a = cx.s.combat?.attackers.find((x) => x.id === id);
  if (typeof want === 'boolean') return (a !== undefined) === want; // CR 506.4, 508.1k
  // std-combat-1 (CR 506.3, 508.5): "attacking you and/or planeswalkers you control": the player itself, or a planeswalker that player controls (never a battle)
  if (want.orPlaneswalker === true) {
    const d = a?.defender;
    if (a === undefined || typeof d !== 'string') return false;
    if (cx.s.players.some((p) => p.id === d)) return playerMatches(cx, want.defender, d);
    return cx.all.get(d)?.types.includes('Planeswalker') === true && playerMatches(cx, want.defender, a.defendingPlayer);
  }
  return a !== undefined && a.defendingPlayer !== undefined && playerMatches(cx, want.defender, a.defendingPlayer);
}

/** FAST4 T33: the characteristics of the permanents attached to a permanent (CR 301.5, 303.4), as this evaluation sees them. */
function attachedChars(cx: EvalCx, o: GameObject): Chars[] {
  if (o.zone !== 'battlefield') return [];
  const out: Chars[] = [];
  for (const x of cx.s.zones.battlefield) {
    const a = cx.s.objects[x];
    if (a === undefined || a.attachedTo !== o.id || a.phasedOut) continue;
    const ac = cx.all.get(x);
    if (ac !== undefined) out.push(ac);
  }
  return out;
}

/** FAST4 T33, CR 301.5: an Equipment is attached to it. */
const equippedNow = (cx: EvalCx, o: GameObject): boolean => attachedChars(cx, o).some((a) => a.subtypes.includes('Equipment'));

/** FAST4 T33, CR 700.9: a counter on it, equipped, or enchanted by an Aura controlled by its controller. */
function modifiedNow(cx: EvalCx, o: GameObject, c: Chars): boolean {
  if (o.zone !== 'battlefield') return false;
  if (Object.values(o.counters).some((n) => n > 0)) return true;
  return attachedChars(cx, o).some((a) => a.subtypes.includes('Equipment') || (a.subtypes.includes('Aura') && a.controller === c.controller));
}

function isAttachedAtAll(cx: EvalCx, o: GameObject): boolean {
  if (o.attachedTo !== undefined) return true;
  return cx.s.zones.battlefield.some((x) => cx.s.objects[x]?.attachedTo === o.id);
}

function sharesQuality(cx: EvalCx, id: ObjectId, sw: NonNullable<ObjectFilter['sharesWith']>): boolean {
  const mine = cx.all.get(id)!;
  for (const otherId of objectsOf(cx, sw.with)) {
    if (otherId === id) continue;
    const other = cx.all.get(otherId);
    if (!other) continue;
    switch (sw.quality) {
      case 'creatureType': if (mine.subtypes.some((t) => other.subtypes.includes(t) && creatureTypeLike(t))) return true; break;
      case 'landType': if (mine.subtypes.some((t) => other.subtypes.includes(t) && !creatureTypeLike(t))) return true; break;
      case 'color': if (mine.colors.some((x) => other.colors.includes(x))) return true; break;
      case 'cardType': if ((mine.types as string[]).some((t) => (other.types as string[]).includes(t))) return true; break;
      case 'name': if (mine.names.some((n) => other.names.includes(n))) return true; break;
    }
  }
  return false;
}

// "creature type" vs "land type" for sharesWith: land types are the 17 of CR 205.3i; everything else a creature has is a creature type.
const creatureTypeLike = (t: string): boolean => !LAND_TYPES.includes(t);

function hasChosen(cx: EvalCx, c: Chars, ch: NonNullable<ObjectFilter['chosen']>): boolean {
  const values = readLink(objOf(cx, cx.source), ch.link)?.values ?? [];
  switch (ch.quality) {
    case 'color': return values.some((v) => { const col = colorFromWord(v); return col !== undefined && c.colors.includes(col); });
    case 'creatureType':
    case 'landType': return values.some((v) => c.subtypes.includes(v));
    case 'cardType': return values.some((v) => (c.types as string[]).includes(v));
    case 'cardName': return values.some((v) => c.names.includes(v));
    case 'oddEven': return values.some((v) => v.toLowerCase() === (c.manaValue % 2 === 0 ? 'even' : 'odd')); // Cloud std-eoe (CR 202.3; zero is even)
  }
}

// ---- Players ----------------------------------------------------------------------------------------------------------------

const livePlayers = (cx: EvalCx): PlayerId[] => cx.s.players.filter((p) => !p.hasLost).map((p) => p.id);

/** The players a reference stands for (empty when it needs an event, a target or a choice). */
export function playersOf(cx: EvalCx, ref: PlayerRef | ObjRef): PlayerId[] {
  switch (ref.ref) {
    case 'you': return [cx.controller];
    case 'active': return [cx.s.turn.activePlayer];
    case 'anOpponent': { const opp = livePlayers(cx).filter((p) => p !== cx.controller); return opp.length === 1 ? opp : []; } // ambiguous with several opponents: no static effect picks one
    case 'each': {
      if (!('who' in ref)) return [];
      const all = livePlayers(cx);
      return ref.who === 'player' ? all : all.filter((p) => p !== cx.controller);
    }
    case 'controllerOf': return objectsOf(cx, ref.object).map((id) => cx.all.get(id)!.controller).filter((p, i, a) => a.indexOf(p) === i);
    case 'ownerOf': return objectsOf(cx, ref.object).map((id) => cx.s.objects[id]!.owner).filter((p, i, a) => a.indexOf(p) === i);
    case 'fixed': return 'players' in ref ? ref.players.filter((p) => cx.s.players.some((x) => x.id === p)) : [];
    case 'linked': return readLink(objOf(cx, cx.source), ref.link)?.players ?? [];
    case 'defending': return cx.defending !== undefined ? [cx.defending] : []; // FAST3 T16: only an attack question names one (CR 506.2, 508.1c)
    case 'enchantedPlayer': return attachedPlayer(cx.s, cx.source !== null ? cx.s.objects[cx.source] : undefined); // std-rr (CR 303.4, 702.5a)
    case 'eachWho': { // std-combat-1 (CR 608.2c, 611.3a): the players of `who` who did it in the scope's history, read now (rules/history.ts#countHistory)
      if (historyCounter === null) throw new Error('statics/match.ts: no history counter is installed (effects/eval.ts installs rules/history.ts#countHistory)');
      const count = historyCounter;
      const env = { you: cx.controller, ...(cx.source !== null ? { sourceId: cx.source } : {}), resolvePlayers: (r: PlayerRef) => playersOf(cx, r), qty: (q: Quantity) => evalQuantity(cx, q) };
      return livePlayers(cx).filter((p) => (ref.who === 'player' || p !== cx.controller) && count(cx.s, ref.did, ref.scope, { ref: 'fixed', players: [p] }, env) > 0);
    }
    case 'seat': { // M12-1 (m12 design D6): the next / previous player in turn order still in the game (CR 101.4, 103.1), from `of` (you by default)
      const from = ref.of !== undefined ? playersOf(cx, ref.of) : [cx.controller];
      return [...new Set(from.flatMap((p) => { const n = seatNeighbor(cx.s, p, ref.side); return n !== undefined ? [n] : []; }))];
    }
    default: return [];
  }
}

/** A reference that names exactly one player (layer 2: "you control that creature"). */
export function playerOf(cx: EvalCx, ref: PlayerRef): PlayerId | undefined {
  const ps = playersOf(cx, ref);
  return ps.length === 1 ? ps[0] : undefined;
}

// ---- Quantities -------------------------------------------------------------------------------------------------------------

const statOf = (cx: EvalCx, id: ObjectId, stat: 'power' | 'toughness' | 'manaValue' | 'loyalty' | 'defense'): number | undefined => {
  const c = cx.all.get(id);
  if (!c) return undefined;
  if (stat === 'manaValue') return c.manaValue;
  const n = num(c[stat]);
  return n === null ? undefined : n;
};

/** Mana symbols of the cost that are of, or include, one of the colors (CR 700.5: devotion). */
function devotionSymbols(c: Chars, to: readonly Color[]): number {
  let n = 0;
  for (const sym of c.manaCost ?? []) {
    switch (sym.kind) {
      case 'colored': case 'phyrexian': case 'monoHybrid': case 'colorlessHybrid': if (to.includes(sym.color)) n++; break;
      case 'hybrid': case 'hybridPhyrexian': if (sym.colors.some((x) => to.includes(x))) n++; break;
      default: break;
    }
  }
  return n;
}

/** The value of a quantity, or undefined when it cannot be determined here (an event, a variable, an announced X, a step result). */
export function evalQuantity(cx: EvalCx, q: Quantity): number | undefined {
  if (typeof q === 'number') return q;
  switch (q.q) {
    case 'count': return objectsOf(cx, q.of).length;
    case 'happenedCount': {
      // CLOUD std-ecl (CR 611.3a, 608.2h): "Creatures you control get +X/+X, where X is the number of creatures that entered the battlefield under your control this
      // turn": counted in GameState.history with the reader of the `happened` condition below (rules/history.ts#countHistory), relative to the controller of the
      // ability; the layer cache keys on the history when a definition reads it (rules/characteristics.ts#historyKey). A count relative to a triggering event
      // (`beforeEvent`) or the maximum over players (`per`) has no meaning for a static ability: unknown here.
      if (q.beforeEvent === true || q.per !== undefined) return undefined;
      if (historyCounter === null) throw new Error('statics/match.ts: no history counter is installed (effects/eval.ts installs rules/history.ts#countHistory)');
      return historyCounter(cx.s, q.event, q.scope, q.by, {
        you: cx.controller, ...(cx.source !== null ? { sourceId: cx.source } : {}), resolvePlayers: (ref) => playersOf(cx, ref), qty: (x) => evalQuantity(cx, x),
      });
    }
    case 'countPlayers': {
      if (q.didNot !== undefined) return undefined; // r5-fxz: an earlier step of a resolution; a static ability has none
      // std-mkm (CR 119.3, 120.3a): only the players who lost life this turn
      const lostOf = (p: string): number => cx.s.players.find((x) => x.id === p)?.turnStats.lifeLost ?? 0;
      const controlled = new Map<PlayerId, number>();
      if (q.controlsIs !== undefined) {
        for (const id of eachMatching(cx, q.controlsIs.filter)) {
          const c = cx.all.get(id)?.controller;
          if (c !== undefined) controlled.set(c, (controlled.get(c) ?? 0) + 1);
        }
      }
      const controlledOf = (p: string): number => controlled.get(p as PlayerId) ?? 0;
      const players = playersOf(cx, q.of).filter((p) => (q.lostLifeThisTurn !== true || lostOf(p) > 0)
        // Standard round P (CR 119.3, 120.3a): only the players whose life lost this turn compares with a fixed number
        && (q.lostLifeIs === undefined || compareCmp(q.lostLifeIs.op, lostOf(p), q.lostLifeIs.n))
        // std-rx12 (CR 102.3, 108.4): only the players who control a number of these permanents that compares with a fixed number
        && (q.controlsIs === undefined || compareCmp(q.controlsIs.op, controlledOf(p), q.controlsIs.n)));
      // std-control-1 (CR 702.179f): the players whose speed compares with another player's (no speed counts as 0)
      if (q.speedVs !== undefined) {
        if (q.sizeVs !== undefined || q.sizeIs !== undefined || q.lifeVs !== undefined) return undefined;
        const than = playerOf(cx, q.speedVs.than);
        if (than === undefined) return undefined;
        const speedOf = (p: string): number => cx.s.designations.speed?.[p as PlayerId] ?? 0;
        return players.filter((p) => compareCmp(q.speedVs!.op, speedOf(p), speedOf(than))).length;
      }
      // std-lci (CR 119.1, 102.1): the players whose life total compares with another player's
      if (q.lifeVs !== undefined) {
        if (q.sizeVs !== undefined || q.sizeIs !== undefined) return undefined;
        const than = playerOf(cx, q.lifeVs.than);
        if (than === undefined) return undefined;
        const lifeOf = (p: string): number | undefined => cx.s.players.find((x) => x.id === p)?.life;
        const t = lifeOf(than);
        if (t === undefined) return undefined;
        return players.filter((p) => { const l = lifeOf(p); return l !== undefined && compareCmp(q.lifeVs!.op, l, t); }).length;
      }
      // std-hob (CR 404.1, 402.1): the players whose zone holds at least / at most a fixed number of cards ("for each graveyard with seven or more cards in it")
      if (q.sizeIs !== undefined) {
        const { zone, op, n } = q.sizeIs;
        return players.filter((p) => compareCmp(op, (cx.s.zones[zone][p] ?? []).length, n)).length;
      }
      // r4-static (CR 119.1): the players whose life total compares with a fixed number ("as long as an opponent has 10 or less life")
      if (q.lifeIs !== undefined) {
        const { op, n } = q.lifeIs;
        return players.filter((p) => { const l = cx.s.players.find((x) => x.id === p)?.life; return l !== undefined && compareCmp(op, l, n); }).length;
      }
      // std-rx24 (CR 122.1f): the players whose poison counters compare with a fixed number ("as long as an opponent has three or more poison counters")
      if (q.poisonIs !== undefined) {
        const { op, n } = q.poisonIs;
        return players.filter((p) => { const c = cx.s.players.find((x) => x.id === p)?.poison; return c !== undefined && compareCmp(op, c, n); }).length;
      }
      if (q.controlsVs !== undefined) {
        // std-sos review (CR 102.2, 102.3): the players who control more (fewer, ...) of these permanents than another player, each player counted alone
        const than = playerOf(cx, q.controlsVs.than);
        if (than === undefined) return undefined;
        const per = new Map<PlayerId, number>();
        for (const id of eachMatching(cx, q.controlsVs.filter)) {
          const p = cx.all.get(id)?.controller;
          if (p !== undefined) per.set(p, (per.get(p) ?? 0) + 1);
        }
        const { op } = q.controlsVs;
        return players.filter((p) => compareCmp(op, per.get(p) ?? 0, per.get(than) ?? 0)).length;
      }
      if (q.sizeVs === undefined) return players.length;
      // FAST5 T53 (CR 402.1, 102.3): the players whose zone is bigger / smaller than another player's
      const than = playerOf(cx, q.sizeVs.than);
      if (than === undefined) return undefined;
      const { zone, op } = q.sizeVs;
      const size = (p: string): number => (cx.s.zones[zone][p] ?? []).length;
      return players.filter((p) => compareCmp(op, size(p), size(than))).length;
    }
    case 'stat': {
      const ids = objectsOf(cx, q.of);
      if (q.sum) {
        let t = 0;
        for (const id of ids) t += statOf(cx, id, q.stat) ?? 0;
        return t;
      }
      // FAST5X E15 (CR 208.1, 202.3, 601.2f, 613.4a): the greatest / least value among the set, as it is now (a cost while casting, a characteristic-defining
      // value continuously); none is 0; a member whose value is unknown ("*" not yet defined) makes it unknown
      if (q.agg !== undefined) {
        const vs = ids.map((id) => statOf(cx, id, q.stat));
        if (vs.some((v) => v === undefined)) return undefined;
        return vs.length === 0 ? 0 : q.agg === 'max' ? Math.max(...(vs as number[])) : Math.min(...(vs as number[]));
      }
      return ids.length === 1 ? statOf(cx, ids[0]!, q.stat) : undefined;
    }
    case 'life': {
      const ps = playersOf(cx, q.of);
      // p2-group-actions-1 (CR 119.1): the highest or lowest life total among a set of players
      if (q.agg !== undefined) { const lives = cx.s.players.filter((p) => ps.includes(p.id)).map((p) => p.life); return lives.length === 0 ? undefined : q.agg === 'max' ? Math.max(...lives) : Math.min(...lives); }
      return ps.length === 1 ? cx.s.players.find((p) => p.id === ps[0])?.life : undefined;
    }
    case 'zoneSize': {
      const p = playerOf(cx, q.of);
      if (p === undefined) return undefined;
      const z = cx.s.zones;
      if (q.zone === 'hand' || q.zone === 'graveyard' || q.zone === 'library') return (z[q.zone][p] ?? []).length;
      return z[q.zone].filter((id) => cx.s.objects[id]?.owner === p).length;
    }
    case 'counters': {
      if (isPlayerRef(q.on)) {
        const p = playerOf(cx, q.on);
        const ps = cx.s.players.find((x) => x.id === p);
        if (ps === undefined) return undefined;
        const bag = ps.counters;
        // std-rx24 (CR 122.1f): a player's poison counters are kept apart (`PlayerState.poison`), as effects/eval.ts#counters reads them
        if (q.kind === 'poison') return ps.poison;
        return q.kind === 'any' ? ps.poison + Object.values(bag).reduce((a, b) => a + b, 0) : bag[q.kind] ?? 0;
      }
      const ids = objectsOf(cx, q.on);
      let t = 0;
      for (const id of ids) {
        const bag = cx.s.objects[id]!.counters;
        t += q.kind === 'any' ? Object.values(bag).reduce((a, b) => a + b, 0) : bag[q.kind] ?? 0;
      }
      return t;
    }
    case 'devotion': {
      const players = playersOf(cx, q.of);
      let t = 0;
      for (const id of cx.s.zones.battlefield) {
        const c = cx.all.get(id);
        if (c && players.includes(c.controller) && !cx.s.objects[id]!.phasedOut) t += devotionSymbols(c, q.to);
      }
      return t;
    }
    case 'partySize': { // T38, CR 700.8: the creatures `of` controls (a phased-out permanent is treated as though it doesn't exist, CR 702.26b)
      const p = playerOf(cx, q.of);
      if (p === undefined) return undefined;
      const mine: PartyCreature[] = [];
      for (const id of cx.s.zones.battlefield) {
        const c = cx.all.get(id);
        if (c && c.controller === p && c.types.includes('Creature') && !cx.s.objects[id]!.phasedOut) mine.push(partyCreatureOf(c));
      }
      return partySize(mine);
    }
    // r4-static (CR 709.5c, 709.5j): "two or more unlocked doors among Rooms you control" in a static ability: each Room permanent's unlocked halves, summed, as
    // effects/eval.ts reads them (a face-down permanent is no Room, CR 708.2)
    case 'unlockedDoors': {
      let n = 0;
      for (const id of objectsOf(cx, q.among)) {
        const o = cx.s.objects[id];
        const def = o ? cx.s.defs[o.defId] : undefined;
        if (!o || !def || o.zone !== 'battlefield' || o.faceDown || o.kind === 'ability' || !hasSharedTypeLine(def)) continue;
        n += unlockedHalves(def, o).length;
      }
      return n;
    }
    case 'distinct': {
      const seen = new Set<string | number>();
      for (const id of objectsOf(cx, q.among)) {
        const c = cx.all.get(id)!;
        switch (q.what) {
          case 'colors': c.colors.forEach((x) => seen.add(x)); break;
          case 'cardTypes': c.types.forEach((x) => seen.add(x)); break;
          case 'permanentTypes': c.types.filter((x) => PERMANENT_TYPES.includes(x)).forEach((x) => seen.add(x)); break; // r4-cost (CR 110.4)
          case 'creatureTypes':
            // r4-static (CR 702.73a, 205.3m): a changeling is every creature type, as effects/eval.ts reads it ("for each of its creature types")
            if (c.keywords.some((k) => k.keyword === 'changeling')) CREATURE_TYPES.forEach((x) => seen.add(x));
            c.subtypes.filter(creatureTypeLike).forEach((x) => seen.add(x));
            break;
          case 'landTypes': c.subtypes.filter((t) => !creatureTypeLike(t)).forEach((x) => seen.add(x)); break;
          case 'planeswalkerTypes': if (c.types.includes('Planeswalker')) c.subtypes.filter((t) => subtypeClass(t) === undefined).forEach((x) => seen.add(x)); break; // r5-fxb (CR 205.3j), as rules/filter.ts#planeswalkerTypesOf
          case 'names': c.names.forEach((x) => seen.add(x)); break;
          case 'manaValues': seen.add(c.manaValue); break;
          case 'powers': { const p = num(c.power); if (p !== null) seen.add(p); break; } // CLOUD std-misc (CR 208.1)
          case 'colorPairs': if (c.colors.length === 2) seen.add([...c.colors].sort().join('')); break; // r4-mech (CR 105.2a)
          case 'counterKinds': for (const [k, n] of Object.entries(cx.s.objects[id]!.counters)) if (n > 0) seen.add(k); break; // r4-static (CR 122.1)
        }
      }
      return seen.size;
    }
    case 'math': {
      const args: number[] = [];
      for (const a of q.args) {
        const v = evalQuantity(cx, a);
        if (v === undefined) return undefined;
        args.push(v);
      }
      if (args.length === 0) return undefined;
      switch (q.op) {
        case '+': return args.reduce((a, b) => a + b, 0);
        case '*': return args.reduce((a, b) => a * b, 1);
        case '-': return args.slice(1).reduce((a, b) => a - b, args[0]!);
        case 'floorDiv': return args.length === 2 && args[1] !== 0 ? Math.floor(args[0]! / args[1]!) : undefined;
        case 'ceilDiv': return args.length === 2 && args[1] !== 0 ? Math.ceil(args[0]! / args[1]!) : undefined;
        case 'min': return Math.min(...args);
        case 'max': return Math.max(...args);
      }
      return undefined;
    }
    case 'live': return evalQuantity(cx, q.value);
    case 'turnNumber': return cx.s.turn.number;
    case 'startingLife': return cx.s.options.startingLife; // FAST5 T60, CR 103.4
    case 'speed': return cx.s.designations.speed?.[cx.controller] ?? 0; // FAST5X-4, CR 702.179f: no speed counts as 0
    // FAST5X E19 (CR 106.4): the controller's unspent mana ("as long as you have six or more unspent mana"); `players` is part of the layer cache key
    case 'unspentMana': return cx.s.players.find((p) => p.id === cx.controller)?.manaPool.filter((u) => q.type === undefined || u.type === q.type).length;
    case 'cardsDrawnThisTurn': return cx.s.players.find((p) => p.id === cx.controller)?.turnStats.cardsDrawn;
    case 'spellsCastThisTurn': return cx.s.players.find((p) => p.id === cx.controller)?.turnStats.spellsCast;
    case 'lifeGainedThisTurn': return cx.s.players.find((p) => p.id === cx.controller)?.turnStats.lifeGained;
    // Cloud std-woe (CR 119.3, 120.3a): all the life ONE player lost this turn, damage included (rules/life.ts#changeLife counts every loss); `players` is part of the layer
    // cache key, as for unspentMana. A reference to several players (or none) is unknown here, never a sum
    case 'lifeLostThisTurn': {
      const ps = playersOf(cx, q.of);
      return ps.length === 1 ? cx.s.players.find((p) => p.id === ps[0])?.turnStats.lifeLost : undefined;
    }
    case 'descendedThisTurn': { const p = cx.s.players.find((x) => x.id === cx.controller); return p === undefined ? undefined : p.turnStats.descended ?? 0; } // FAST5X E22 (CR 700.11)
    case 'turnsBegun': { const p = cx.s.players.find((x) => x.id === cx.controller); return p === undefined ? undefined : p.turnsBegun ?? 0; } // std-r9 (CR 500.7, 500.11)
    case 'kickCount': {
      // M6-0, CR 702.33d-e, 400.7d: the kicker payments of the spell, or of the spell this permanent was; never cast = never kicked
      const o = objOf(cx, cx.source);
      const paid = o?.zone === 'stack' ? o.stack?.costsPaid : o?.cast?.costsPaid;
      if (q.name !== undefined) return (paid?.additional ?? []).filter((n) => n === q.name).length; // M6-12: CR 702.157a, 702.56a
      return paid?.kicked ?? 0;
    }
    case 'costCount': {
      // std-costs-1 (CR 601.2b, 400.7d): the number the caster announced for the spell's optional cost of that name, or of the spell this permanent was
      const o = objOf(cx, cx.source);
      const paid = o?.zone === 'stack' ? o.stack?.costsPaid : o?.cast?.costsPaid;
      return paid?.counts?.[q.name] ?? 0;
    }
    case 'commanderCasts': return q.of === undefined ? commanderCastsOf(cx.s, cx.controller) : undefined; // M11-0, CR 903.8; CMD2: another player's count is not read here (fail closed)
    default: return undefined;
  }
}

// ---- Conditions -------------------------------------------------------------------------------------------------------------

/**
 * FAST5X E9 INTERFACE CHANGE (additive): the reader of `GameState.history` (rules/history.ts#countHistory), installed by effects/eval.ts: statics may not import
 * rules/history (design 5.4: rules/characteristics imports statics, rules/history imports rules/characteristics).
 */
export type HistoryCounter = (s: GameState, event: Extract<Condition, { cond: 'happened' }>['event'], scope: Extract<Condition, { cond: 'happened' }>['scope'],
  by: PlayerPred | undefined, env: { you: PlayerId; sourceId?: ObjectId; resolvePlayers: (ref: PlayerRef) => PlayerId[]; qty: (q: Quantity) => number | undefined }) => number;
let historyCounter: HistoryCounter | null = null;
export function installHistoryCounter(f: HistoryCounter): void {
  historyCounter = f;
}
const compareCmp = (op: NumberCmp['op'], a: number, b: number): boolean =>
  op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : a > b;

/** Is the condition true? Conditions that need a step result or a question to a player are false here (a static ability never asks). */
export function evalCondition(cx: EvalCx, c: Condition): boolean {
  switch (c.cond) {
    case 'all': return c.of.every((x) => evalCondition(cx, x));
    case 'any': return c.of.some((x) => evalCondition(cx, x));
    case 'not': return !evalCondition(cx, c.of);
    case 'compare': {
      const l = evalQuantity(cx, c.left);
      const r = evalQuantity(cx, c.right);
      if (l === undefined || r === undefined) return false;
      switch (c.op) {
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '==': return l === r;
        case '!=': return l !== r;
        case '<': return l < r;
        case '>': return l > r;
      }
      return false;
    }
    case 'prime': { const n = evalQuantity(cx, c.of); return n !== undefined && isPrime(n); } // std-rx1
    case 'exists': {
      const need = c.atLeast === undefined ? 1 : evalQuantity(cx, c.atLeast);
      return need !== undefined && objectsOf(cx, c.of).length >= need;
    }
    case 'matches': {
      if (!evaluable(c.filter)) return false;
      const ids = objectsOf(cx, c.object);
      return ids.length > 0 && ids.every((id) => match(cx, id, { ...c.filter, zone: c.filter.zone ?? 'any' }));
    }
    case 'turnOf': {
      const active = cx.s.turn.activePlayer;
      const ok = c.whose === 'any' ? true : c.whose === 'you' ? active === cx.controller : c.whose === 'opponent' ? active !== cx.controller : playersOf(cx, c.whose).includes(active);
      const steps = c.step === undefined ? undefined : Array.isArray(c.step) ? c.step : [c.step];
      return ok && (steps === undefined || steps.includes(cx.s.turn.step));
    }
    case 'wasCast': {
      // FAST5X E1 (CR 601.2b, 601.2f, 702.166b): a spell on the stack reads what was announced for it so far ("This spell costs {2} less to cast if it's
      // bargained"); a permanent reads the cast record its spell left (CR 607.2i-j, 400.7d)
      const o = objOf(cx, cx.source);
      const st = o?.zone === 'stack' && o.kind !== 'ability' ? o.stack : undefined;
      const cast = st !== undefined && st.kind === 'spell'
        ? { costsPaid: st.costsPaid, ...(st.x !== undefined ? { x: st.x } : {}), ...(st.castFrom !== undefined ? { from: st.castFrom } : {}), via: st.costsPaid.alternative, ...(st.caster !== undefined ? { by: st.caster } : {}) }
        : o?.cast;
      if (!cast) return false;
      if (c.kicked !== undefined && (typeof c.kicked === 'boolean' ? (cast.costsPaid.kicked ?? 0) > 0 !== c.kicked : cast.costsPaid.alternative !== c.kicked && !(cast.costsPaid.additional ?? []).includes(c.kicked))) return false;
      // p2-graveyard-1 (CR 601.3, 113.6f): a cost also usable from another zone is the method `<name>:2` (actions/cast-options.ts#castOptionsOf), still its cost
      if (c.via !== undefined && !viaOf(cast.via, c.via) && !viaOf(cast.costsPaid.alternative, c.via)) return false;
      if (c.from !== undefined && cast.from !== c.from) return false;
      if (c.by === 'you' && cast.by !== cx.controller) return false; // FAST4 T27 (CR 601.2a): "if you cast it"
      if (c.kept === true && !wasCastKept(o, cx.controller)) return false; // std-rx22 (CR 702.62a): "until you lose control of the spell or the permanent"
      if (c.spent !== undefined && !spentAtLeast(cast.costsPaid.manaSpent, c.spent)) return false; // FAST5 T37 (CR 601.2h): adamant
      return !(c.xAtLeast !== undefined && (cast.x ?? 0) < c.xAtLeast);
    }
    case 'designation': {
      const d = cx.s.designations;
      const ps = playersOf(cx, c.who);
      switch (c.what) {
        case 'monarch': return d.monarch !== undefined && ps.includes(d.monarch);
        case 'initiative': return d.initiative !== undefined && ps.includes(d.initiative);
        case 'day': return d.dayNight === 'day';
        case 'night': return d.dayNight === 'night';
        // FAST3 T16: the city's blessing as effects/eval.ts reads it (CR 702.131c: a designation a player keeps for the rest of the game)
        case 'citysBlessing': return ps.some((p) => d.citysBlessing?.includes(p) === true);
        // FAST5X-4 (CR 702.179e-f, 702.178a): "as long as your speed is 4" (max speed); no speed counts as 0
        case 'maxSpeed': return ps.some((p) => (d.speed?.[p] ?? 0) >= 4);
        // FAST5X E18: "as long as you have an enduring story" (Storied reminder text; kept for the rest of the game like CR 702.131c's city's blessing)
        case 'enduringStory': return ps.some((p) => d.enduringStory?.includes(p) === true);
        default: return false;
      }
    }
    case 'completedDungeon': { // MX4, CR 309.7: as core/dungeon-data.ts#hasCompleted reads it (statics import no core module, design 5.4)
      const done = (p: string): readonly string[] => cx.s.designations.completedDungeons?.[p] ?? [];
      return playersOf(cx, c.who).some((p) => (c.name === undefined ? done(p).length > 0 : done(p).includes(c.name)));
    }
    case 'chosen': return (readLink(objOf(cx, cx.source), c.link)?.values ?? []).includes(c.equals);
    case 'classLevel': {
      // M6-0, CR 716.2a-d: the level designation of a Class (absent = level 1), never level counters (CR 716.4); a non-Class has none
      const ids = objectsOf(cx, c.object);
      return ids.length > 0 && ids.every((id) => cx.all.get(id)?.subtypes.includes('Class') === true && (cx.s.objects[id]?.classLevel ?? 1) >= c.atLeast);
    }
    case 'happened': {
      // FAST5X E9 (CR 611.3a): "as long as two or more nonland permanents entered the battlefield under your control this turn", "as long as an opponent was
      // dealt noncombat damage this turn": counted in GameState.history with the reader the interpreter uses (rules/history.ts#countHistory), relative to the
      // controller of the ability. The layer cache notices a history change (rules/characteristics.ts#historyKey).
      const want = c.times === undefined ? 1 : evalQuantity(cx, c.times.value);
      if (want === undefined) return false;
      if (historyCounter === null) throw new Error('statics/match.ts: no history counter is installed (effects/eval.ts installs rules/history.ts#countHistory)');
      const n = historyCounter(cx.s, c.event, c.scope, c.by, {
        you: cx.controller, ...(cx.source !== null ? { sourceId: cx.source } : {}), resolvePlayers: (ref) => playersOf(cx, ref), qty: (q) => evalQuantity(cx, q),
      });
      return compareCmp(c.times?.op ?? '>=', n, want);
    }
    default: return false; // did, ask, eventFlag
  }
}

/**
 * std-rx22 (CR 702.62a: "it gains haste until you lose control of the spell or the permanent it becomes"): `player` cast this object and has controlled it, as
 * the spell and as the permanent, without a break since (core/control.ts writes `controlLost` on a change of controller; a new object after a zone change has no
 * cast record, CR 400.7). Pure.
 */
export function wasCastKept(o: GameObject | undefined, player: PlayerId): boolean {
  if (!o || o.controller !== player) return false;
  if (o.zone === 'stack') return o.stack?.kind === 'spell' && o.stack.caster === player && o.stack.controlLost !== true;
  return o.cast !== undefined && o.cast.by === player && o.cast.controlLost !== true;
}
