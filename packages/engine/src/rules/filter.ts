/**
 * Evaluating ObjectFilter (types/ability.ts) against objects: costs ("sacrifice a creature"), targets (CR 115) and effects ("destroy all creatures you
 * control"). Characteristics always come from the characteristics function (CR 109.3), never from `state.defs`.
 *
 * Owner: WP4. `matchesFilter` evaluates EVERY field of `ObjectFilter` (design 3.3). All present fields are ANDed; `anyOf` is an OR and `not` a NOT. A field
 * the build does not know, or a reference / quantity the caller gave no way to resolve (`FilterContext.env`), makes the whole filter NOT MATCH: a filter is
 * never approximately right (design D2), and a `not` never turns "could not be evaluated" into "true".
 *
 * `zone` absent means "any zone" here, because costs and targets pass candidates they already found (a discard cost filters cards in a hand). The search
 * functions (`findObjects`, `{ref:'each'}`) default to the battlefield, as the model says (design 3.2, CR 609.2).
 */
import type { AbilityDef, NumberCmp, ObjectFilter, PlayerPred, PlayerRef, Quantity, Ref, ZoneName } from '../types/ability';
import { colorSymbolCount, manaValue } from '../types/mana';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState, LinkValue, ObjHandle } from '../types/state';
import { charsOfObject, hasKeyword, type Chars } from './characteristics';
import { attackerState, isAttacking, isBlocked, isBlocking, isUnblocked } from './combat-state';
import { KEYWORD_ABILITY_KINDS } from './ability-kinds';
import { attackedThisTurn, blockedThisTurn, controllerDealtCombatDamageBySourceThisTurn, crewedBySourceThisTurn, enteredFromThisTurn, dealtDamageAsSourceThisTurn, dealtDamageBySourceThisTurn, dealtDamageThisTurn, enteredThisTurn, countersPutThisTurn, HISTORY_FILTER_FIELDS, HISTORY_WRITTEN, putThereThisTurn } from './history';
import { compareNumbers, playerPredMatches } from './predicates';
import { BASIC_LAND_TYPES, isLandType, isNonCreatureSubtype, subtypeClass } from '../statics/subtypes';
import { isTransformedPermanent } from '../statics/match';
import { holdStill } from '../statics/stable-scope';
import { charsThroughLayer7b } from '../statics/layers';
import { isCopyPermanent } from '../statics/copy';
import { isCommander } from '../statics/commander';
import { staticGoadersOf } from '../statics/rule-sources';
import { FILTER_PARTS, FILTER_STATUS_FIELDS } from './registries';
import { ringBearerPlayer } from '../core/ring-state';
import { hasSharedTypeLine, unlockedHalves } from './base-parts/room';

/** The objects and players a reference stands for. */
export interface RefValue {
  objects: ObjHandle[];
  players: PlayerId[];
}

/**
 * How a filter resolves what it mentions besides the object: `is`, `sharesWith`, `targets`, `controller: {ref}`, `attacking: {defender}` and a comparison
 * whose value is a quantity. The interpreter builds one from its context (`effects/refs.ts#filterEnvOf`). Without it only `self`, `you` and `active` resolve.
 * `undefined` = cannot be determined: the filter does not match.
 */
export interface FilterEnv {
  refs: (ref: Ref) => RefValue | undefined;
  qty: (q: Quantity) => number | undefined;
}

export interface FilterContext {
  /** The player the words "you" / "opponent" are relative to (the controller of the spell or ability). */
  you: PlayerId;
  /** The source object, for "other"/"another", `self`, `attachedToSource` and `chosen`. */
  sourceId?: ObjectId;
  /**
   * REQUIRED (WP30 review): every reader of a filter says how its references and quantities resolve, so the forms of `NEEDS_ENV` work in every position and can
   * be advertised. The compiler is the check: a call site without an environment does not build. Engine code takes one from `effects/refs.ts#filterCtxOf`
   * (while resolving) or `rules/filter-env.ts#filterCtxOutside` (everywhere else); `NO_ENV` is for tests only (test/m5/eval/wp30-env-call-sites.test.ts).
   */
  env: FilterEnv;
  /** Use these characteristics for the object instead of computing them (last known information, CR 608.2h, 603.10). */
  chars?: Chars;
  /**
   * FAST3 T13 INTERFACE CHANGE (additive): the values chosen during the resolution that reads this filter (`ExecCtx.choices`), by link id; `chosen` reads them
   * before the source's own links (CR 608.2d, 607.2d).
   */
  choices?: ReadonlyMap<string, LinkValue>;
}

/** std-costs-2 (CR 702.185a): the `chosen` key of the warped designation, the turn number in which warp's delayed triggered ability exiled the card. */
export const WARPED_KEY = 'warped';

/** std-costs-2 (CR 702.185a, 400.7): is this a warped card (a card in exile that warp exiled, effects/handlers/levels.ts)? Pure. */
export function isWarped(o: GameObject): boolean {
  return o.zone === 'exile' && o.kind === 'card' && typeof o.chosen?.[WARPED_KEY] === 'number';
}

/** Every field of `ObjectFilter`. Adding a field to the model without listing it here is a compile error, so no field can be forgotten. */
const FIELD_KEYS: Record<keyof ObjectFilter, true> = {
  anyOf: true, not: true, zone: true, controller: true, owner: true, types: true, allTypes: true, notTypes: true, subtypes: true, allSubtypes: true /* std-rx32 */, notSubtypes: true,
  supertypes: true, notSupertypes: true, colors: true, notColors: true, colorless: true, multicolored: true, monocolored: true, name: true, notName: true, nameless: true,
  manaValue: true, power: true, toughness: true, keyword: true, notKeyword: true, hasAbility: true, tapped: true, token: true, isCard: true, faceDown: true,
  transformed: true, emblem: true /* std-typechange-2 */, doubleFaced: true, isCopy: true, attacking: true, blocking: true, blocked: true, self: true, is: true, other: true, attached: true, attachedToSource: true,
  counters: true, enteredThisTurn: true, dealtDamageThisTurn: true, dealtDamageBySourceThisTurn: true, controllerDealtCombatDamageBySourceThisTurn: true, attackedThisTurn: true, blockedThisTurn: true, sharesWith: true, chosen: true,
  dealtDamageAsSourceThisTurn: true, // std-mkm (CR 120.1)
  putThereThisTurn: true, // r3-choose (CR 400.7)
  putThereFrom: true, // r5-fxz (CR 400.7)
  countersPutThisTurn: true, // std-rx12 (CR 122.6, 400.7)
  stackKind: true, targets: true, castFrom: true,
  abilitySource: true, // FAST5 T45 (CR 113.7a)
  targetsOnly: true, targetCount: true, // FAST5 T45 (CR 115.9a, 115.9c)
  targetedBy: true, // std-rx28 (CR 115.9b)
  solved: true, prepared: true, prototyped: true, flipped: true, // M6-0 (m6 design 2.1)
  harnessed: true, // cloud r3-mech (CR 701.64)
  blockingObject: true, // FAST3 T18
  blockedByObject: true, blockingOrBlockedBy: true, // p2-combat-flow-1 (CR 509.1g-h)
  attachedToObject: true, // FAST4 T22
  attachedToPlayer: true, // p2-damage-2 (CR 303.4, 702.5d)
  commander: true, // M11-0 (m11 design 4.5): a status field, advertised once M11-1 lists it in rules/filter-parts/commander.ts
  equipped: true, modified: true, // FAST4 T33
  enchanted: true, // FAST5 T39 (CR 303.4b)
  enchantedBy: true, // FAST5 T68 (CR 303.4b, 109.4)
  adventure: true, // FAST5 T49 (CR 715.1)
  saddled: true, saddledThisTurn: true, // FAST5X E3 (CR 702.171b-c)
  crewedThisTurn: true, // r5-fxb (CR 702.122)
  wasAttachedTo: true, // r5-fxb (CR 603.10a, 301.5)
  suspected: true, // FAST5X E12 (CR 701.60a-b)
  warped: true, // std-costs-2 (CR 702.185a)
  monstrous: true, // std-rx34 (CR 701.37b)
  goaded: true, // M12-3 (CR 701.15b)
  renowned: true, // std-ry8 (CR 702.112b)
  prepareSpell: true, // std-copy-2 (CR 722.3c-d)
  ringBearer: true, // MX3 (CR 701.54e)
  manaCostHasX: true, // FAST5X E23 (CR 107.3)
  manaSymbols: true, // Standard round 5, r5-trig (CR 107.4, 202.1)
  attackingAlone: true, // CLOUD std-msh (CR 506.5)
  toughnessGreaterThanPower: true, // Standard round 4, r4-trig (CR 208.1)
  totalPowerToughness: true, // std-rx10 (CR 208.1)
  powerGreaterThanBase: true, // std-rx11 (CR 208.1, 613.4)
  crewedBySourceThisTurn: true, // Standard round 5, r5-trig (CR 702.122c)
  castWithMana: true, enteredFrom: true, // Standard round 5, r5-trig (CR 601.2h, 603.6a)
  lockedDoor: true, // r5-fxz (CR 709.5c)
};

/** p2-combat-flow-1: the last known combat of an object that left the battlefield, under its old id or the new object it became (CR 400.7, `LastKnown.newId`). */
function lastCombat(s: GameState, id: ObjectId): NonNullable<GameState['lki'][string]>['combat'] {
  if (s.objects[id]?.zone === 'battlefield') return undefined;
  return (s.lki[id] ?? Object.values(s.lki).find((l) => l.newId === id))?.combat;
}

/**
 * FAST3 T18, p2-combat-flow-1 (CR 509.1g, 506.4, 603.10a): does `blocker` block `attacker`? Now, by the combat state; or, when one of them left the battlefield, by
 * its last known combat while the other is still in combat (CR 506.4: a blocking creature stays a blocking creature, a blocked creature stays blocked, after the
 * creature on the other side left); a blocker that left is judged as it last existed ("whenever a creature blocking ~ dies"). `blocker` is an object (possibly last
 * known information) or an id.
 */
function blocks(s: GameState, blocker: GameObject | ObjectId, attacker: ObjectId): boolean {
  const bid = typeof blocker === 'string' ? blocker : blocker.id;
  const b = s.combat?.blockers.find((x) => x.id === bid);
  if (b !== undefined && b.blocking.includes(attacker)) return true;
  if (b !== undefined && s.combat?.attackers.some((a) => a.id === attacker) !== true && (lastCombat(s, attacker)?.blockedBy ?? []).includes(bid)) return true;
  const gone = s.objects[bid] === undefined || s.objects[bid]!.zone !== 'battlefield';
  return gone && (lastCombat(s, bid)?.blockingIds ?? []).includes(attacker) && (s.combat?.attackers.some((a) => a.id === attacker) === true || (lastCombat(s, attacker)?.blockedBy ?? []).includes(bid));
}

/** r5-fxz (CR 709.5c): a Room permanent (a face-up card with a shared type line, core/rooms.ts#isRoomPermanent) with a half that is not unlocked. */
function hasLockedDoor(s: GameState, o: GameObject): boolean {
  const def = s.defs[o.defId];
  if (o.zone !== 'battlefield' || o.faceDown || o.kind === 'ability' || def === undefined || !hasSharedTypeLine(def)) return false;
  return unlockedHalves(def, o).length < def.faces.length;
}

/** Value forms (model/forms.ts `filterForms`) this evaluator reads, in addition to the plain forms of the fields above. */
const FILTER_FORMS = ['controller.ref', 'owner.ref', 'keyword.list', 'notKeyword.list', 'attacking.defender', 'cmp.quantity', 'attacking.orPlaneswalker' /* std-combat-1 */];

/**
 * Fields and forms that need a `FilterEnv` to be read (a reference to resolve, a quantity to evaluate). The interpreter passes one (`effects/refs.ts#filterCtxOf`);
 * until WP30 the other call sites passed none, so a target spec, cost, enchant restriction or trigger pattern that used one never matched and the forms were not
 * advertised. Since WP30 every position passes one (rules/filter-env.ts: targets and their CR 608.2b re-check, conditions read while announcing, cost parts, the
 * enchant restriction, mana spending restrictions, trigger patterns and conditions), and `FilterContext.env` is required, so a new call site without one does
 * not compile (`ENV_REQUIRED`). test/m5/eval/wp30-filter-env.test.ts covers the forms in the positions.
 */
export const NEEDS_ENV: ReadonlySet<string> = new Set(['controller.ref', 'owner.ref', 'attacking.defender', 'cmp.quantity', 'is', 'sharesWith', 'targets', 'blockingObject', 'attachedToObject', 'saddledThisTurn', 'targetsOnly', 'targetedBy' /* std-rx28 */, 'crewedThisTurn' /* r5-fxb */, 'wasAttachedTo' /* r5-fxb */, 'attachedToPlayer' /* p2-damage-2 */, 'attacking.orPlaneswalker' /* std-combat-1 */, 'blockedByObject', 'blockingOrBlockedBy' /* p2-combat-flow-1 */]);

/**
 * An environment that resolves nothing beyond `self`, `you` and `active` (a quantity can't be read): what a filter read with no context sees. For TESTS of the
 * evaluator only; engine code never uses it (test/m5/eval/wp30-env-call-sites.test.ts fails on any use under src/).
 */
export const NO_ENV: FilterEnv = { refs: () => undefined, qty: () => cannot('a quantity in a filter needs a filter environment') };

/**
 * Whether every reader of a filter must pass an environment, DERIVED from the type of `FilterContext.env` (WP30 review: never a hand-set flag): if `env`
 * became optional again, `undefined extends FilterContext['env']` would be true and this declaration would not compile. Together with the call-site test
 * (no `NO_ENV`, no hand-built environment in engine code) it is what makes the forms of `NEEDS_ENV` capabilities.
 */
type EnvRequired = undefined extends FilterContext['env'] ? false : true;
const ENV_REQUIRED: EnvRequired = true;

/**
 * The `ObjectFilter` fields and value forms this engine build can evaluate in EVERY position a filter can appear (capability names are `filter:<field>` and
 * `filter:<form>`, design 5.2): every field and form, the forms of `NEEDS_ENV` because every position passes an environment, and the four history fields
 * because something writes `GameState.history` (`HISTORY_WRITTEN`, rules/history.ts).
 */
export const SUPPORTED_FILTER_FIELDS: ReadonlySet<string> = new Set(
  [...Object.keys(FIELD_KEYS), ...FILTER_FORMS].filter((n) => (ENV_REQUIRED || !NEEDS_ENV.has(n)) && (HISTORY_WRITTEN || !HISTORY_FILTER_FIELDS.includes(n)) && statusAdvertised(n)),
);

/**
 * M6-0 (m6 design 2.6): the four status fields (`solved`, `prepared`, `prototyped`, `flipped`) are evaluated, but a field is advertised only once a package's
 * mechanism sets the status (rules/registries.ts#FILTER_PARTS): before that every object would answer "no", a silent wrong answer for "if it's solved".
 */
function statusAdvertised(n: string): boolean {
  return !(FILTER_STATUS_FIELDS as readonly string[]).includes(n) || FILTER_PARTS.some((p) => (p as readonly string[]).includes(n));
}

/** The permanents attached to a permanent, with their characteristics (CR 301.5, 303.4). Only a permanent has attachments. */
function attachmentsOf(s: GameState, o: GameObject): { object: GameObject; chars: Chars }[] {
  if (o.zone !== 'battlefield') return [];
  const out: { object: GameObject; chars: Chars }[] = [];
  for (const id of s.zones.battlefield) {
    const x = s.objects[id];
    if (x !== undefined && x.attachedTo === o.id && !x.phasedOut) out.push({ object: x, chars: charsOfObject(s, x) });
  }
  return out;
}

/**
 * r5-fxb (CR 603.10a, 608.2h): for the last known information of a permanent that left the battlefield (the object is no longer in the state), what was attached
 * to it as it left (`LastKnown.attached`); undefined for an object that is in the state.
 */
function leftAttached(s: GameState, o: GameObject): { equipped: boolean; modified: boolean } | undefined {
  if (s.objects[o.id] !== undefined || o.zone !== 'battlefield') return undefined;
  return s.lki[o.id]?.attached;
}

/** FAST4 T33, CR 301.5: an Equipment is attached to it. */
/**
 * std-copy-2 (CR 722.3c-d): a prepare spell: an object whose definition is the one core/prepare.ts#copyDef makes for the copy of a prepare spell in exile
 * (`prepare:<source definition>`, only the prepare spell's characteristics); that copy as it is cast, and every copy of it (rules/stack-objects.ts keeps the
 * definition), are prepare spells too (CR 722.3d). A preparation card itself never is (CR 722.4).
 */
export function isPrepareSpell(s: GameState, o: GameObject): boolean {
  return o.kind === 'spellCopy' && s.defs[o.defId]?.id.startsWith('prepare:') === true;
}

/** std-rx31 (CR 712.1, 712.4, 111.1): a double-faced CARD: a transforming or modal double-faced card, or a meld card (a token is never a card). */
export function isDoubleFacedCard(s: GameState, o: GameObject): boolean {
  const def = s.defs[o.defId];
  return o.kind === 'card' && def !== undefined && def.faces.length > 1 && ['transform', 'modal_dfc', 'meld'].includes(def.layout);
}

export function isEquipped(s: GameState, o: GameObject): boolean {
  const left = leftAttached(s, o);
  if (left !== undefined) return left.equipped; // r5-fxb (CR 603.10a): as it last existed on the battlefield
  return attachmentsOf(s, o).some((a) => a.chars.subtypes.includes('Equipment'));
}

/** FAST5 T39, CR 303.4b: an Aura (of any controller) is attached to it. */
export function isEnchanted(s: GameState, o: GameObject): boolean {
  return attachmentsOf(s, o).some((a) => a.chars.subtypes.includes('Aura'));
}

/** FAST4 T33, CR 700.9: a counter on it, equipped, or enchanted by an Aura controlled by its controller. */
export function isModified(s: GameState, o: GameObject): boolean {
  const left = leftAttached(s, o);
  if (left !== undefined) return left.modified; // r5-fxb (CR 603.10a): as it last existed on the battlefield
  if (o.zone !== 'battlefield') return false;
  if (Object.values(o.counters).some((n) => n > 0)) return true;
  const controller = charsOfObject(s, o).controller;
  return attachmentsOf(s, o).some((a) => a.chars.subtypes.includes('Equipment') || (a.chars.subtypes.includes('Aura') && a.chars.controller === controller));
}

/** Raised inside the evaluator when something cannot be determined; `matchesFilter` turns it into "no match" for the whole filter. */
class Unevaluable extends Error {}
const cannot = (why: string): never => {
  throw new Unevaluable(why);
};

// ---- subtype classes (CR 205.3g-m) -------------------------------------------------------------------------------------------------------------------

// The subtype classes come from the one list (statics/subtypes.ts, WP30). It replaced a copy here whose "Urza’s" had a curly apostrophe: the Oracle data
// writes "Urza's", so an Urza's land was not a land type and an animated one had "Urza's" as a creature type.

/**
 * Creature types of an object (CR 205.3m: only creatures and kindreds have them) and whether it has all of them (changeling, CR 702.73a). Its subtypes minus
 * those of the other classes (artifact, enchantment, land, spell, battle and dungeon types, CR 205.3g-i, 205.3k, 205.3p-q); a subtype in no list counts.
 */
export function creatureTypesOf(c: Chars): { all: boolean; set: Set<string> } {
  const creaturish = c.types.includes('Creature') || c.types.includes('Kindred');
  return { all: hasKeyword(c, 'changeling'), set: new Set(creaturish ? c.subtypes.filter((t) => !isNonCreatureSubtype(t)) : []) };
}
/** Land types of an object (CR 205.3i). */
export const landTypesOf = (c: Chars): Set<string> => new Set(c.subtypes.filter(isLandType));
/**
 * r5-fxb (CR 205.3j): the planeswalker types of a planeswalker: its subtypes that are of no other class this build lists (statics/subtypes.ts has no list of
 * planeswalker types; a creature type of a creature planeswalker is not one). An object that is not a planeswalker has none (CR 205.3d).
 */
export const planeswalkerTypesOf = (c: Chars): Set<string> => new Set(c.types.includes('Planeswalker') ? c.subtypes.filter((t) => subtypeClass(t) === undefined) : []);

// ---- information about objects, current or last known ----------------------------------------------------------------------------------------------

export interface ObjInfo {
  object: GameObject;
  /** `null` for an ability on the stack: it has no card type, mana value or P/T (glossary "Card Type": "Except for abilities on the stack, each object has a card type"; CR 109.1, 113.1c). */
  chars: Chars | null;
}

/** An ability on the stack has no types, colors, mana value or P/T of its own; everything else (a future `Chars` field) is kept as computed. */
function blankedChars(c: Chars): Chars {
  const { power: _power, toughness: _toughness, loyalty: _loyalty, defense: _defense, ...rest } = c;
  return { ...rest, name: '', names: [], manaCost: null, manaValue: 0, colors: [], supertypes: [], types: [], subtypes: [], abilities: [], keywords: [] };
}

/** The characteristics of an object for filter purposes (an ability on the stack has none of its own). */
export function filterChars(s: GameState, o: GameObject): Chars {
  const c = charsOfObject(s, o);
  return o.kind === 'ability' ? blankedChars(c) : c;
}

/**
 * What is known about an object by handle: the current object if it is still in the expected zone, otherwise the last known information (CR 608.2h, 400.7),
 * otherwise nothing. Abilities carry no characteristics.
 */
export function infoFor(s: GameState, h: ObjHandle): ObjInfo | undefined {
  const cur = s.objects[h.id];
  if (cur && cur.zone === h.zone) return { object: cur, chars: cur.kind === 'ability' ? null : charsOfObject(s, cur) };
  const l = s.lki[h.id];
  if (!l) return undefined;
  return { object: l.object, chars: l.object.kind === 'ability' ? null : (l.chars ?? charsOfObject(s, l.object)) };
}

/** The object with this id as it is now, or as it last existed. */
const objectOrLki = (s: GameState, id: ObjectId): GameObject | undefined => s.objects[id] ?? s.lki[id]?.object;

// ---- references inside filters -------------------------------------------------------------------------------------------------------------------------

function refsOf(s: GameState, ctx: FilterContext, ref: Ref): RefValue {
  const fromEnv = ctx.env.refs(ref);
  if (fromEnv) return fromEnv;
  // The references that need no interpreter context.
  if (ref.ref === 'self' && ctx.sourceId) {
    const zone = s.objects[ctx.sourceId]?.zone ?? s.lki[ctx.sourceId]?.leftZone ?? 'battlefield';
    return { objects: [{ id: ctx.sourceId, zone }], players: [] };
  }
  if (ref.ref === 'you') return { objects: [], players: [ctx.you] };
  if (ref.ref === 'active') return { objects: [], players: [s.turn.activePlayer] };
  return cannot(`reference ${ref.ref} needs a filter environment`);
}

function playerOk(s: GameState, ctx: FilterContext, pred: PlayerPred | undefined, who: PlayerId): boolean {
  const resolve = (ref: PlayerRef): PlayerId[] => refsOf(s, ctx, ref).players;
  const r = playerPredMatches(pred, who, ctx.you, resolve);
  return r === undefined ? cannot('unresolved player predicate') : r;
}

function quantityOf(ctx: FilterContext, q: Quantity): number | undefined {
  if (typeof q === 'number') return q;
  return ctx.env.qty(q);
}

/** A comparison; "fails to determine" (no value, no power) is false (design 3.4). */
function cmp(ctx: FilterContext, c: NumberCmp, actual: number | null): boolean {
  const value = quantityOf(ctx, c.value);
  return actual === null || value === undefined ? false : compareNumbers(c.op, actual, value);
}

const INTEGER = /^-?\d+$/;
const num = (s: string | undefined): number | null => (s !== undefined && INTEGER.test(s) ? Number(s) : null);
const eqi = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const COLOR_BY_NAME: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * M12-3, CR 701.15b: is the permanent goaded, by any player? Cloud C3 (batch 3): goaded by the goad action (`GameObject.goaded`) or by a static goad that
 * applies now ("enchanted creature is goaded", CR 701.15a-c, 611.3a; statics/rule-sources.ts#staticGoadersOf); an object that is only last known information
 * as it was when it left the battlefield (`LastKnown.goadedBy`, CR 603.10a, 608.2h: "whenever a goaded creature dies").
 */
function isGoaded(s: GameState, o: GameObject): boolean {
  if (o.zone !== 'battlefield') return false;
  if ((o.goaded?.length ?? 0) > 0) return true;
  if (s.objects[o.id] === undefined) return (s.lki[o.id]?.goadedBy?.length ?? 0) > 0;
  return staticGoadersOf(s, o.id).length > 0;
}

/**
 * FAST4 T34 (CR 506.4, 608.2h): is the object attacking (blocking)? For an object that is only last known information (it left the battlefield, so it is no
 * longer in `GameState.objects`), whether it was as it left (`LastKnown.combat`, core/zones.ts#moveObject); otherwise the combat state now.
 */
function wasInCombat(s: GameState, o: GameObject, what: 'attacking' | 'blocking'): boolean {
  if (s.objects[o.id] === undefined && s.lki[o.id] !== undefined) return s.lki[o.id]!.combat?.[what] === true;
  return what === 'attacking' ? isAttacking(s, o.id) : isBlocking(s, o.id);
}

/** Does the zone satisfy the filter's zone (a name, a list of names, 'any' or absent)? */
function inZone(zone: ObjectFilter['zone'], actual: ZoneName): boolean {
  if (zone === undefined || zone === 'any') return true;
  return Array.isArray(zone) ? zone.includes(actual) : zone === actual;
}

function sharesQuality(q: NonNullable<ObjectFilter['sharesWith']>['quality'], a: Chars, b: Chars): boolean {
  switch (q) {
    case 'creatureType': {
      const x = creatureTypesOf(a);
      const y = creatureTypesOf(b);
      return (x.all && (y.all || y.set.size > 0)) || (y.all && x.set.size > 0) || [...x.set].some((t) => y.set.has(t)); // CR 702.73a: changeling
    }
    case 'color': return a.colors.some((k) => b.colors.includes(k));
    case 'cardType': return a.types.some((t) => b.types.includes(t));
    case 'name': return a.names.some((n) => b.names.includes(n));
    case 'landType': { const y = landTypesOf(b); return [...landTypesOf(a)].some((t) => y.has(t)); }
  }
}

/** Does the object have the quality a linked ability chose (CR 607.2d)? */
function hasChosenQuality(chosen: string, quality: NonNullable<ObjectFilter['chosen']>['quality'], c: Chars): boolean {
  switch (quality) {
    case 'color': { const letter = COLOR_BY_NAME[chosen.toLowerCase()] ?? chosen; return c.colors.some((k) => eqi(k, letter)); }
    case 'creatureType': { const t = creatureTypesOf(c); return t.all || [...t.set].some((x) => eqi(x, chosen)); }
    case 'cardType': return c.types.some((x) => eqi(x, chosen));
    case 'landType': return [...landTypesOf(c)].some((x) => eqi(x, chosen));
    case 'cardName': return c.names.some((x) => eqi(x, chosen));
    // Cloud std-eoe (CR 202.3; "zero is even", as the cards remind): "each creature with mana value of the chosen quality": its mana value is odd or even as chosen
    case 'oddEven': return eqi(c.manaValue % 2 === 0 ? 'even' : 'odd', chosen);
  }
}


/**
 * Does the object have an ability of this kind? A definite answer, or the filter does not match at all: an ability that cannot be classified (a manual line of
 * unknown shape, a keyword with no tabulated kind, the abilities of a Class level) makes the answer "cannot be determined" (`cannot`) when no ability matched,
 * so `not: {hasAbility}` never turns it into "true" (design D2).
 */
function hasAbilityOfKind(c: Chars, kind: NonNullable<ObjectFilter['hasAbility']>): boolean {
  // CR 305.6, 605.1a: a basic land type gives the intrinsic ability "{T}: Add {X}", a mana ability and so an activated ability.
  if ((kind === 'mana' || kind === 'activated') && c.types.includes('Land') && c.subtypes.some((t) => BASIC_LAND_TYPES.includes(t))) return true;
  let unknown = false;
  const matches = (def: AbilityDef): boolean => {
    switch (def.kind) {
      case 'activated': return kind === 'activated' || (kind === 'mana' && def.isMana === true); // a mana ability is an activated ability (CR 605.1a)
      case 'triggered': case 'chapter': return kind === 'triggered'; // a chapter ability is a triggered ability (CR 714.2)
      case 'static': return kind === 'static';
      case 'spell': return false; // a spell ability is none of these (CR 113.3a)
      case 'keyword': {
        const kinds = KEYWORD_ABILITY_KINDS[def.keyword];
        if (!kinds) { unknown = true; return false; }
        return kind !== 'mana' && kinds.includes(kind); // CR 702.x.a states the kind of each keyword ability
      }
      case 'manual':
        if (def.shape === 'unknown') { unknown = true; return false; }
        return def.shape === kind || (kind === 'mana' && def.shape === 'activated' && def.mana === true);
      case 'classLevel': case 'levelBracket': unknown = true; return def.abilities.some(matches); // CR 711, 716: which abilities apply depends on the level
      case 'case': unknown = true; return kind === 'triggered' || def.solved.some(matches); // M6-0, CR 719.3a: "to solve" is a triggered ability; the solved ones depend on the designation
    }
  };
  if (c.abilities.some(({ def }) => matches(def))) return true;
  return unknown ? cannot('an ability whose kind is not known') : false;
}

/**
 * p2-graveyard-2 (CR 702.29f, 702.33c): the keywords whose abilities ARE another keyword's abilities (keywords/data `family`): a typecycling ability is a cycling
 * ability, a multikicker cost is a kicker cost, commander ninjutsu is ninjutsu. "A card with cycling" (Sacred Excavation) includes a card with swampcycling, "a card with
 * a kicker ability" one with multikicker. A static table (rules/ may not import keywords/, design 5.4); a test pins it to the families of the keyword data.
 */
export const KEYWORD_FAMILY_MEMBERS: Readonly<Record<string, readonly string[]>> = { cycling: ['typecycling'], kicker: ['multikicker'], ninjutsu: ['commander ninjutsu'] };
const hasKeywordOrFamily = (c: Chars, k: string): boolean => hasKeyword(c, k) || (KEYWORD_FAMILY_MEMBERS[k] ?? []).some((m) => hasKeyword(c, m));

function stackKindMatches(o: GameObject, kind: NonNullable<ObjectFilter['stackKind']>): boolean {
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

/** FAST5 T45: does the source of ability `o` (on the stack) satisfy `f`? Its last known information when it has left (CR 113.7a, 608.2h). */
function abilitySourceMatches(s: GameState, o: GameObject, f: ObjectFilter, ctx: FilterContext): boolean {
  const id = o.kind === 'ability' ? o.stack?.sourceId : undefined;
  if (id === undefined) return false;
  const live = s.objects[id];
  const lk = live === undefined ? s.lki[id] : undefined;
  const src = live ?? lk?.object;
  if (src === undefined) return false;
  const { chars: _outer, ...base } = ctx; // the characteristics given for the ability are not the source's
  return matchesFilter(s, src, f, { ...base, ...(lk?.chars ? { chars: lk.chars } : {}) });
}

// ---- the evaluator ---------------------------------------------------------------------------------------------------------------------------------------------

function test(s: GameState, o: GameObject, f: ObjectFilter, ctx: FilterContext, c: Chars): boolean {
  for (const [k, v] of Object.entries(f)) if (v !== undefined && !Object.hasOwn(FIELD_KEYS, k)) return cannot(`unknown filter field "${k}"`);

  if (f.anyOf !== undefined && !f.anyOf.some((sub) => test(s, o, sub, ctx, c))) return false;
  if (f.not !== undefined && test(s, o, f.not, ctx, c)) return false;
  if (!inZone(f.zone, o.zone)) return false;
  if (f.controller !== undefined && !playerOk(s, ctx, f.controller, o.controller)) return false;
  if (f.owner !== undefined && !playerOk(s, ctx, f.owner, o.owner)) return false;

  // status
  if (f.tapped !== undefined && o.tapped !== f.tapped) return false;
  if (f.token !== undefined && (o.kind === 'token') !== f.token) return false; // CR 111.1
  if (f.isCard !== undefined && (o.kind === 'card') !== f.isCard) return false; // tokens and copies of spells are not cards (CR 111.1, 707.10)
  if (f.emblem !== undefined && (o.kind === 'emblem') !== f.emblem) return false; // std-typechange-2 (CR 114.1)
  if (f.faceDown !== undefined && o.faceDown !== f.faceDown) return false;
  if (f.transformed !== undefined && isTransformedPermanent(s, o) !== f.transformed) return false; // CR 701.27g: a double-faced permanent, back face up
  if (f.doubleFaced !== undefined && isDoubleFacedCard(s, o) !== f.doubleFaced) return false; // std-rx31: CR 712.1, 712.4
  // CR 707.10 spell copies; M6-0: a permanent is a copy when a 1a copy effect applies to it (statics/copy.ts#isCopyPermanent, M6-2; none before)
  if (f.isCopy !== undefined && (o.kind === 'spellCopy' || o.stack?.isCopy === true || (o.zone === 'battlefield' && isCopyPermanent(s, o))) !== f.isCopy) return false;
  // M6-0: designations and statuses (CR 719.3b solved, 722.3a prepared, 718.3b-d prototyped, 710 flipped)
  if (f.solved !== undefined && (o.solved === true) !== f.solved) return false;
  if (f.harnessed !== undefined && (o.harnessed === true) !== f.harnessed) return false; // cloud r3-mech (CR 701.64)
  if (f.prepared !== undefined && (o.prepared === true) !== f.prepared) return false;
  if (f.prototyped !== undefined && (o.prototyped === true) !== f.prototyped) return false;
  if (f.flipped !== undefined && o.flipped !== f.flipped) return false;
  if (f.commander !== undefined && isCommander(s, o) !== f.commander) return false; // M11-0: CR 903.3, 903.3b-d (the card's designation)
  // FAST5X E3, CR 702.171b: the saddled designation (only a permanent has it)
  if (f.saddled !== undefined && (o.zone === 'battlefield' && o.saddled === true) !== f.saddled) return false;
  // FAST5X E12, CR 701.60b: the suspected designation (only a permanent has it)
  if (f.suspected !== undefined && (o.zone === 'battlefield' && o.suspected !== undefined) !== f.suspected) return false;
  // std-costs-2, CR 702.185a, 400.7: a warped card, a card in exile that warp's delayed triggered ability exiled (WARPED_KEY; a new object once it leaves exile)
  if (f.warped !== undefined && isWarped(o) !== f.warped) return false;
  // std-rx34, CR 701.37b: the monstrous designation (only a permanent has it; it ends as the permanent leaves the battlefield, CR 400.7)
  if (f.monstrous !== undefined && (o.zone === 'battlefield' && o.monstrous === true) !== f.monstrous) return false;
  // M12-3, CR 701.15b: the goaded designation (only a permanent has it; by any player). Cloud C3: by a static goad too (`isGoaded`)
  if (f.goaded !== undefined && isGoaded(s, o) !== f.goaded) return false;
  // std-ry8, CR 702.112b: the renowned designation (only a permanent has it; it ends as the permanent leaves the battlefield, CR 400.7)
  if (f.renowned !== undefined && (o.zone === 'battlefield' && o.renowned === true) !== f.renowned) return false;
  // std-copy-2, CR 722.3c-d: a prepare spell (the copy core/prepare.ts makes, or a copy of that copy); never a card (CR 722.4)
  if (f.prepareSpell !== undefined && isPrepareSpell(s, o) !== f.prepareSpell) return false;
  // CLOUD std-msh (CR 506.5): attacking alone, "it's attacking but no other creatures are" (as it last existed for an object that left: it was attacking then and
  // no other creature is attacking now)
  if (f.attackingAlone === true && (!wasInCombat(s, o, 'attacking') || (s.combat?.attackers ?? []).some((a) => a.id !== o.id))) return false;
  // r5-fxz (CR 709.5c, 709.5f): a Room permanent with a locked door
  if (f.lockedDoor === true && !hasLockedDoor(s, o)) return false;
  if (f.attacking !== undefined) {
    if (typeof f.attacking === 'boolean') {
      if (wasInCombat(s, o, 'attacking') !== f.attacking) return false; // CR 506.4, 508.1k; FAST4 T34: as it last existed (CR 608.2h)
    } else {
      // CR 506.3: what is attacked is a player, a planeswalker or a battle; "attacking you" is the player. (The defending player of CR 508.5 is also the controller
      // of an attacked planeswalker: that is the `{ref:'defending'}` reference, not this test.) A null defender (CR 506.4c) is nothing.
      const a = attackerState(s, o.id);
      const d = a?.defender;
      // std-combat-1 (CR 506.3, 508.5): `orPlaneswalker`, or a planeswalker that player controls (its controller is the defending player of the attack on it)
      const walker = f.attacking.orPlaneswalker === true && typeof d === 'string' && s.objects[d]?.zone === 'battlefield' && charsOfObject(s, s.objects[d]!).types.includes('Planeswalker');
      if (walker) { if (!playerOk(s, ctx, f.attacking.defender, a!.defendingPlayer)) return false; }
      else if (typeof d !== 'string' || !s.players.some((p) => p.id === d) || !playerOk(s, ctx, f.attacking.defender, d)) return false;
    }
  }
  if (f.blocking !== undefined && wasInCombat(s, o, 'blocking') !== f.blocking) return false; // CR 509.1g; FAST4 T34: as it last existed (CR 608.2h)
  // CR 509.1h: a blocked creature is an attacking creature a blocker was declared for, an unblocked one an attacking creature none was (std-rx23: a creature
  // that is not attacking is neither, so "unblocked creatures" never matches a blocker or a creature out of combat)
  if (f.blocked !== undefined && (f.blocked ? !isBlocked(s, o.id) : !isUnblocked(s, o.id))) return false;
  // FAST3 T18: a blocker of one of these objects (CR 509.1g); a creature removed from combat is no longer a blocker (CR 506.4)
  // p2-combat-flow-1 (CR 509.1g-h, 506.4, 603.10a): an attacker one of these objects blocks ("blocked by ~"), or either relation; each read with the last known
  // combat of a side that left the battlefield (rules/filter.ts#blocks)
  if (f.blockingObject !== undefined && !refsOf(s, ctx, f.blockingObject).objects.some((h) => blocks(s, o, h.id))) return false;
  if (f.blockedByObject !== undefined && !refsOf(s, ctx, f.blockedByObject).objects.some((h) => blocks(s, h.id, o.id))) return false;
  if (f.blockingOrBlockedBy !== undefined && !refsOf(s, ctx, f.blockingOrBlockedBy).objects.some((h) => blocks(s, o, h.id) || blocks(s, h.id, o.id))) return false;
  if (f.self !== undefined && (ctx.sourceId === o.id) !== f.self) return false;
  if (f.other && ctx.sourceId === o.id) return false;
  // FAST5 T42 (CR 400.7, 603.10a): "another" excludes the object the ability is on even after it has moved: in "When this creature dies, return another target creature card
  // from your graveyard" the dead creature's card (the new object it became, `LastKnown.newId`) is the creature itself, not another one
  if (f.other && ctx.sourceId !== undefined) {
    const moved = s.lki[ctx.sourceId];
    if (moved !== undefined && (moved.newId === o.id || (moved.alsoBecame ?? []).includes(o.id))) return false;
  }
  // FAST5 MX6: a FIXED reference names the object as it was when the effect was created (CR 603.7c, 400.7); judged against that object itself (`o` as it is,
  // or the look-back snapshot of a leaves-the-battlefield event, CR 603.10a), not only while it is still there: "when that land dies or is put into exile"
  // (earthbend, CR 701.66a) must see the land that left
  const isRefs = f.is === undefined ? [] : f.is.ref === 'fixed' ? f.is.objects : refsOf(s, ctx, f.is).objects;
  if (f.is !== undefined && !isRefs.some((h) => h.id === o.id && h.zone === o.zone)) return false;
  if (f.attached !== undefined) {
    // CR 301.5, 303.4: attached to something, or something is attached to it.
    const attached = o.attachedTo !== undefined || s.zones.battlefield.some((id) => s.objects[id]?.attachedTo === o.id);
    if (attached !== f.attached) return false;
  }
  if (f.attachedToSource !== undefined) {
    const host = ctx.sourceId ? objectOrLki(s, ctx.sourceId)?.attachedTo : undefined; // "enchanted / equipped by the source" (CR 303.4, 301.5)
    if ((host === o.id) !== f.attachedToSource) return false;
  }
  if (f.attachedToObject !== undefined) {
    // FAST4 T22: attached to one of these objects (CR 301.5, 303.4); only a permanent is attached to anything
    const hosts = refsOf(s, ctx, f.attachedToObject).objects.map((h) => h.id);
    if (o.zone !== 'battlefield' || o.attachedTo === undefined || !hosts.includes(o.attachedTo)) return false;
  }
  // p2-damage-2 (CR 303.4, 702.5d): attached to a player the predicate names (an Aura with enchant player); an object attached to an object is not
  if (f.attachedToPlayer !== undefined) {
    const host = o.zone === 'battlefield' ? o.attachedTo : undefined;
    if (host === undefined || !s.players.some((p) => p.id === host) || !playerOk(s, ctx, f.attachedToPlayer, host as PlayerId)) return false;
  }
  if (f.saddledThisTurn !== undefined) {
    // FAST5X E3, CR 702.171c: a creature that saddled one of these permanents this turn (GameObject.saddledBy; a mount that left is read as it last existed)
    const mounts = refsOf(s, ctx, f.saddledThisTurn).objects.map((h) => objectOrLki(s, h.id));
    if (!mounts.some((m) => m?.saddledBy?.includes(o.id) === true)) return false;
  }
  if (f.crewedThisTurn !== undefined) {
    // r5-fxb (CR 702.122): a creature that crewed one of these Vehicles this turn (GameObject.crewedBy; a Vehicle that left is read as it last existed)
    const vehicles = refsOf(s, ctx, f.crewedThisTurn).objects.map((h) => objectOrLki(s, h.id));
    if (!vehicles.some((v) => v?.crewedBy?.includes(o.id) === true)) return false;
  }
  if (f.wasAttachedTo !== undefined) {
    // r5-fxb (CR 603.10a, 301.5): attached to one of these objects as it left the battlefield (LastKnown.attached.ids); only a permanent still on the battlefield
    const hosts = refsOf(s, ctx, f.wasAttachedTo).objects.map((h) => s.lki[h.id]?.attached?.ids ?? []);
    if (o.zone !== 'battlefield' || !hosts.some((ids) => ids.includes(o.id))) return false;
  }
  // FAST4 T33: equipped (CR 301.5) and modified (CR 700.9), as statics/match.ts reads them
  if (f.equipped !== undefined && isEquipped(s, o) !== f.equipped) return false;
  if (f.modified !== undefined && isModified(s, o) !== f.modified) return false;
  // MX3, CR 701.54e: the Ring-bearer of a player the predicate names (only its controller can have it as Ring-bearer: core/ring-state.ts)
  if (f.ringBearer !== undefined) {
    const p = ringBearerPlayer(s, o, c.controller);
    if (p === undefined || !playerOk(s, ctx, f.ringBearer, p)) return false;
  }
  if (f.enchanted !== undefined && isEnchanted(s, o) !== f.enchanted) return false; // FAST5 T39, CR 303.4b
  // FAST5 T68, CR 303.4b: an Aura that the described player controls is attached to it
  if (f.enchantedBy !== undefined && !attachmentsOf(s, o).some((a) => a.chars.subtypes.includes('Aura') && playerOk(s, ctx, f.enchantedBy, a.chars.controller))) return false;
  // FAST5 T49, CR 715.1: an adventurer card has an Adventure, in any zone (a face of its definition with the Adventure subtype)
  if (f.adventure !== undefined && (s.defs[o.defId]?.faces.some((face) => face.subtypes.includes('Adventure')) === true) !== f.adventure) return false;
  if (f.counters !== undefined) {
    // FAST4 T27: kind 'any' is "a counter" of any kind ("a creature with a counter on it", CR 122.1): every counter on it counts
    const n = f.counters.kind === 'any' ? Object.values(o.counters).reduce((a, b) => a + b, 0) : Object.hasOwn(o.counters, f.counters.kind) ? o.counters[f.counters.kind]! : 0; // counter names are data
    if (f.counters.cmp ? !cmp(ctx, f.counters.cmp, n) : n < 1) return false;
  }

  // history (CR 603.4 style "this turn" facts)
  if (f.enteredThisTurn !== undefined && enteredThisTurn(s, o.id) !== f.enteredThisTurn) return false;
  if (f.dealtDamageThisTurn !== undefined && dealtDamageThisTurn(s, o.id) !== f.dealtDamageThisTurn) return false;
  if (f.dealtDamageAsSourceThisTurn !== undefined && dealtDamageAsSourceThisTurn(s, o.id) !== f.dealtDamageAsSourceThisTurn) return false; // std-mkm (CR 120.1)
  if (f.putThereThisTurn !== undefined && putThereThisTurn(s, o, f.putThereFrom) !== f.putThereThisTurn) return false; // r3-choose (CR 400.7); r5-fxz: `putThereFrom`
  if (f.putThereFrom !== undefined && f.putThereThisTurn === undefined) return cannot('putThereFrom without putThereThisTurn');
  // std-rx12 (CR 122.6, 400.7): counters of that kind put on it this turn by "you"
  if (f.countersPutThisTurn !== undefined && !countersPutThisTurn(s, o.id, f.countersPutThisTurn.kind, ctx.you)) return false;
  // FAST3 T14: "dealt damage by ~ this turn": with no source there is no such damage (a filter read with no source never matches the true form)
  if (f.dealtDamageBySourceThisTurn !== undefined && (ctx.sourceId !== undefined && dealtDamageBySourceThisTurn(s, o.id, ctx.sourceId)) !== f.dealtDamageBySourceThisTurn) return false;
  // Standard round 5, r5-trig (CR 702.122c): "a Vehicle crewed by ~ this turn": with no source nothing crewed it (as dealtDamageBySourceThisTurn)
  if (f.crewedBySourceThisTurn !== undefined && (ctx.sourceId !== undefined && crewedBySourceThisTurn(s, o.id, ctx.sourceId)) !== f.crewedBySourceThisTurn) return false;
  // Standard round 5, r5-trig (CR 601.2h, 400.7d): a permanent cast with mana spent on it (the cast record it kept from its spell; none: it was not cast)
  if (f.castWithMana !== undefined && ((o.cast?.costsPaid.manaSpent?.length ?? 0) > 0) !== f.castWithMana) return false;
  // Standard round 5, r5-trig (CR 603.6a, 400.7): entered the battlefield this turn from that zone, as this object (the history)
  if (f.enteredFrom !== undefined && !enteredFromThisTurn(s, o.id, f.enteredFrom)) return false;
  // FAST5 T66: "whose controller was dealt combat damage by ~ this turn": with no source there is no such damage (as dealtDamageBySourceThisTurn)
  if (f.controllerDealtCombatDamageBySourceThisTurn !== undefined && (ctx.sourceId !== undefined && controllerDealtCombatDamageBySourceThisTurn(s, c.controller, ctx.sourceId)) !== f.controllerDealtCombatDamageBySourceThisTurn) return false;
  if (f.attackedThisTurn !== undefined && attackedThisTurn(s, o.id) !== f.attackedThisTurn) return false;
  if (f.blockedThisTurn !== undefined && blockedThisTurn(s, o.id) !== f.blockedThisTurn) return false;

  // stack objects
  if (f.stackKind !== undefined && !stackKindMatches(o, f.stackKind)) return false;
  // FAST5 T45, CR 113.7a, 608.2h: the source of the ability on the stack as it last existed ("from an artifact source")
  if (f.abilitySource !== undefined && !abilitySourceMatches(s, o, f.abilitySource, ctx)) return false;
  if (f.castFrom !== undefined && (o.stack?.castFrom ?? o.cast?.from) !== f.castFrom) return false;
  if (f.targets !== undefined) {
    if (o.zone !== 'stack' || !o.stack) return false;
    const want = refsOf(s, ctx, f.targets); // CR 115.9b: a spell or ability "targets" what it has as a target
    if (!o.stack.targets.flat().some((t) => (t.kind === 'object' ? want.objects.some((h) => h.id === t.id) : want.players.includes(t.id)))) return false;
  }

  // FAST5 T45, CR 115.9c: "targets only X": the number of DIFFERENT objects and players chosen is one, and it is X (its current state, 115.9b)
  if (f.targetsOnly !== undefined) {
    if (o.zone !== 'stack' || !o.stack) return false;
    const chosen = o.stack.targets.flat();
    if (new Set(chosen.map((t) => `${t.kind}:${t.id}`)).size !== 1) return false;
    const want = refsOf(s, ctx, f.targetsOnly);
    const t = chosen[0]!;
    if (!(t.kind === 'object' ? want.objects.some((h) => h.id === t.id) : want.players.includes(t.id))) return false;
  }
  // std-rx28, CR 115.9b, 608.2c: "those creatures" of "a spell that targets one or more creatures": an object one of whose targets this object is (the spell on the
  // stack, or as it last existed there once it has left: a countered or resolved spell still names what it targeted)
  if (f.targetedBy !== undefined) {
    const by = refsOf(s, ctx, f.targetedBy).objects.map((h) => objectOrLki(s, h.id));
    if (!by.some((x) => x?.stack !== undefined && x.stack.targets.flat().some((t) => t.kind === 'object' && t.id === o.id))) return false;
  }
  // FAST5 T45, CR 115.9a: "with a single target": the number of times anything was chosen when it was put on the stack
  if (f.targetCount !== undefined) {
    if (o.zone !== 'stack' || !o.stack) return false;
    if (!cmp(ctx, f.targetCount, o.stack.targets.flat().length)) return false;
  }

  // characteristics (always through the characteristics function, CR 109.3)
  if (f.name !== undefined && !c.names.includes(f.name)) return false;
  if (f.notName !== undefined && c.names.includes(f.notName)) return false;
  if (f.nameless !== undefined && !c.names.some((n) => n !== '') !== f.nameless) return false; // r5-static: CR 201.2a, 708.2a
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
  if (f.colorless !== undefined && (c.colors.length === 0) !== f.colorless) return false; // CR 105.2c
  if (f.multicolored !== undefined && (c.colors.length >= 2) !== f.multicolored) return false; // CR 105.2b
  if (f.monocolored !== undefined && (c.colors.length === 1) !== f.monocolored) return false; // CR 105.2a
  if (f.keyword !== undefined && !([] as string[]).concat(f.keyword).some((k) => hasKeywordOrFamily(c, k) || hasKeywordOrFamily(c, k.toLowerCase()))) return false;
  if (f.notKeyword !== undefined && ([] as string[]).concat(f.notKeyword).some((k) => hasKeyword(c, k) || hasKeyword(c, k.toLowerCase()))) return false;
  if (f.hasAbility !== undefined && !hasAbilityOfKind(c, f.hasAbility)) return false;
  if (f.power && !cmp(ctx, f.power, num(c.power))) return false;
  if (f.toughness && !cmp(ctx, f.toughness, num(c.toughness))) return false;
  // Standard round 4, r4-trig (CR 208.1): "with toughness greater than its power", the object's own two values (a noncreature with neither has neither)
  if (f.toughnessGreaterThanPower === true) { const tp = num(c.toughness); const pp = num(c.power); if (tp === null || pp === null || tp <= pp) return false; }
  // std-rx10 (CR 208.1): "with total power and toughness 5 or less", the sum of the object's own two values (an object without both has no total)
  if (f.totalPowerToughness !== undefined) { const tp = num(c.toughness); const pp = num(c.power); if (tp === null || pp === null || !cmp(ctx, f.totalPowerToughness, pp + tp)) return false; }
  // std-rx11 (CR 208.1, 613.4): "with power greater than its base power": its power now against its power after layer 7b (before 7c modifications and counters).
  // Only a permanent that is still on the battlefield: the base of an object that left is not recorded (last known information keeps the final values only).
  if (f.powerGreaterThanBase === true) {
    if (o.zone !== 'battlefield' || s.objects[o.id] !== o || ctx.chars !== undefined) cannot('the base power of an object that is not on the battlefield');
    const pp = num(c.power);
    const bp = num(charsThroughLayer7b(s).get(o.id)?.power);
    if (pp === null || bp === null || pp <= bp) return false;
  }
  // FAST5X E23 (CR 107.3, 202.1): "with {X} in its mana cost": the characteristics' mana cost (the face cast, for a spell) has a variable symbol X
  // Standard round 5, r5-trig (CR 107.4, 202.1): the mana symbols of a color in its mana cost (a hybrid symbol of that color counts, as devotion counts it)
  if (f.manaSymbols !== undefined && !cmp(ctx, f.manaSymbols.cmp, colorSymbolCount(c.manaCost, f.manaSymbols.color))) return false;
  if (f.manaCostHasX !== undefined && (c.manaCost ?? []).some((m) => m.kind === 'variable' && m.name === 'X') !== f.manaCostHasX) return false;
  if (f.manaValue) {
    const mv = o.zone === 'stack' && o.stack?.x !== undefined ? manaValue(c.manaCost, o.stack.x) : c.manaValue; // CR 202.3e: X is the announced value on the stack
    if (!cmp(ctx, f.manaValue, mv)) return false;
  }
  if (f.sharesWith !== undefined) {
    const all = refsOf(s, ctx, f.sharesWith.with).objects;
    const others = f.sharesWith.other === true ? all.filter((h) => h.id !== o.id) : all; // std-rx32: "another <set>" (CR 201.2)
    const q = f.sharesWith.quality;
    if (!others.some((h) => { const i = infoFor(s, h); return i?.chars ? sharesQuality(q, c, i.chars) : false; })) return false;
  }
  if (f.chosen !== undefined) {
    const src = ctx.sourceId ? objectOrLki(s, ctx.sourceId) : undefined;
    // std-costs-2 (CR 601.2b, 707.10): a creature type chosen for an additional cost, kept with the costs paid (a copy of the spell has it too)
    const paidType = src?.zone === 'stack' ? src.stack?.costsPaid.chosenTypes?.[f.chosen.link] : undefined;
    const value = (ctx.choices?.get(f.chosen.link) ?? src?.links?.[f.chosen.link])?.values?.[0] ?? paidType; // CR 607.1: only the linked ability of the same object instance sees the choice; undefined matches nothing (CR 607.5a)
    if (value === undefined || !hasChosenQuality(value, f.chosen.quality, c)) return false;
  }
  return true;
}

/** Does `o` satisfy the filter? See the file comment for what "cannot be evaluated" means. */
export function matchesFilter(s: GameState, o: GameObject, f: ObjectFilter, ctx: FilterContext): boolean {
  try {
    return test(s, o, f, ctx, ctx.chars ?? filterChars(s, o));
  } catch (e) {
    if (e instanceof Unevaluable) return false;
    throw e;
  }
}

/**
 * Objects of the filter's zone (default: the battlefield) that match, in zone order. A phased-out permanent is treated as though it doesn't exist (CR 702.26b:
 * "draw a card for each creature you control" doesn't count it; WP14 INTERFACE CHANGE, review of WP14); no filter field mentions phasing.
 */
export function findObjects(s: GameState, f: ObjectFilter, ctx: FilterContext): GameObject[] {
  return holdStill(s, () => findIn(s, f, ctx)); // P1: a read of every object of a state it does not change, so the characteristics cache is checked once
}

function findIn(s: GameState, f: ObjectFilter, ctx: FilterContext): GameObject[] {
  const zones: (ZoneName | 'any')[] = f.zone === undefined ? ['battlefield'] : Array.isArray(f.zone) ? f.zone : [f.zone];
  const z = s.zones;
  const ids: ObjectId[] = [];
  const seen = new Set<ObjectId>();
  const add = (list: readonly ObjectId[]): void => {
    for (const id of list) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  };
  for (const zone of zones) {
    if (zone === 'any') {
      add(z.battlefield);
      add(z.stack);
      add(z.exile);
      for (const p of s.players) { add(z.hand[p.id] ?? []); add(z.graveyard[p.id] ?? []); }
    } else if (zone === 'battlefield' || zone === 'stack' || zone === 'exile' || zone === 'command') {
      add(z[zone]);
    } else {
      for (const p of s.players) add(z[zone][p.id] ?? []);
    }
  }
  const out: GameObject[] = [];
  for (const id of ids) {
    const o = s.objects[id];
    if (o && !(o.zone === 'battlefield' && o.phasedOut) && matchesFilter(s, o, { ...f, zone: 'any' }, ctx)) out.push(o);
  }
  return out;
}
