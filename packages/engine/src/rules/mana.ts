/**
 * Mana pools and mana abilities (CR 106, 605).
 *
 * A mana ability does not use the stack: paying its costs and adding the mana happen at once
 * (CR 605.3b). It can be activated whenever a player has priority and while paying a cost
 * (CR 117.1d, 605.3a).
 */
import type { ActivatedAbilityDef, ManaRestriction, ManaSpentRider, Quantity } from '../types/ability';
import type { PlayerId } from '../types/ids';
import { COLORS, type ManaSymbol, type ManaType } from '../types/mana';
import type { GameObject, GameState, ManaUnit } from '../types/state';
import { STATIC_CONDITION_KINDS, STATIC_QUANTITY_KINDS } from '../statics/match';
import { identityManaColors } from '../statics/commander';
import { moveObject } from '../core/zones';
import { EngineBug, IllegalAction, type Game } from '../core/game';
import type { ActivatedInfo } from './abilities';
import { activationZones, findAbility } from './abilities';
import { charsOfObject } from './characteristics';
import { deny, type Denial } from './denial';
import { cantDo, costUseDenial } from './cant';
import { gameOf, hookpoints } from './hookpoints';
import { manaUnitsOf } from './mana-text';
import { activationRestrictionDenial, isSummoningSickToActivate } from './timing';
import { stunInsteadOfUntap } from './status';

export const manaText = (types: readonly ManaType[]): string => types.map((t) => `{${t}}`).join('');

/**
 * FAST5X E5 INTERFACE CHANGE (additive): how the engine pays the cost of a mana ability (CR 605.3a-b, 118.3).
 *   - `simple`: only {T}, {Q} and "Sacrifice ~", paid right here, as since milestone 3 (the automatic payer's ordinary sources, rules/sources.ts).
 *   - `converter`: a mana cost (no {X}, Phyrexian or snow symbol) plus at most {T}, {Q} and "Sacrifice ~": a filter or "pay to produce" ability ("{1}, {T}: Add
 *     one mana of any color", Signets, filter lands). The automatic payer may activate it, paying its mana from other mana it plans (rules/convert.ts).
 *   - `byHand`: any other cost the payment code pays ("{T}, Pay 1 life", "Tap an untapped creature you control", "Remove two charge counters", "Sacrifice another
 *     Goblin", "Exile a card from your graveyard", or a mana cost with a Phyrexian or snow symbol): paid through rules/pay.ts#payPlan like the cost of any
 *     other ability (CR 602.2b, 601.2g-h). The automatic payer never activates it: the player chooses to (an action at priority or during a payment).
 *   - `unsupported`: a loyalty cost, an X anywhere in the cost ("Remove X counters": X is announced, CR 107.3a, which no mana ability does here), a cost part
 *     this build can't pay (a `manual` part), or an effect that reads what the cost paid ("the sacrificed creature's mana value", "the tapped creature", X,
 *     the colors spent: CR 608.2h; the mana ability resolves without a stack object that would keep them, effects/mana-ability.ts): the ability is not
 *     offered, never activated half paid or resolved with a wrong amount.
 * model/cap-walk.ts#nativeManaGaps mirrors this on the JSON (capability feature:mana.cost for `unsupported`).
 */
export type ManaCostShape = 'simple' | 'converter' | 'byHand' | 'unsupported';

const PLAIN_SYMBOLS: ReadonlySet<ManaSymbol['kind']> = new Set(['generic', 'colored', 'colorless', 'hybrid', 'monoHybrid', 'colorlessHybrid']);

/** FAST5X E5: what a mana ability's effect may not read when its cost is paid by the payment code: the cost's X and objects, the mana spent (see above). */
// CLOUD C8: and what the cost discarded or exiled ("the discarded card", "the exiled creature"): no stack object keeps it for a mana ability (CR 605.3b)
export const COST_READS = /"q":"X"|"ref":"costSacrificed"|"ref":"costTapped"|"ref":"costDiscarded"|"ref":"costExiled"|"q":"colorsSpent"/;

/**
 * p2-mana-1 (CR 107.1c, 107.3a, 601.2b, 602.2b, 605.3b): the one cost part of a mana ability whose number is the ability's X, "Remove any number of storage
 * counters from ~" / "Remove X charge counters from ~", when nothing else of the cost has an X: the player announces X as the ability is activated (0 up to the
 * counters of that kind on ~), the part is paid with it and the production reads it ("Add {B} for each storage counter removed this way"). Such an ability is
 * activated by hand (`byHand`), never planned by the automatic payer. Undefined for any other cost.
 */
export function counterXPart(def: ActivatedAbilityDef): Extract<NonNullable<ActivatedAbilityDef['cost']['other']>[number], { kind: 'removeCounters' }> | undefined {
  const cost = def.cost;
  if (cost.loyalty !== undefined || cost.loyaltyX === true || (cost.mana ?? []).some((sym) => sym.kind === 'variable')) return undefined;
  const xs = (cost.other ?? []).filter((p) => JSON.stringify(p).includes('"q":"X"'));
  const p = xs[0];
  if (xs.length !== 1 || p === undefined || p.kind !== 'removeCounters' || p.self !== true || p.counter === 'any' || p.among === true || p.filter !== undefined) return undefined;
  if (p.all === true) return undefined; // p2-counters-move-2: "Remove all ... counters" has no X to choose (actions/activate.ts#fixedCounterX); not a mana ability's announced X
  return typeof p.count === 'object' && (p.count as { q?: string }).q === 'X' ? p : undefined;
}

export function manaCostShape(def: ActivatedAbilityDef): ManaCostShape {
  const cost = def.cost;
  if (cost.loyalty !== undefined) return 'unsupported';
  const mana = cost.mana ?? [];
  if (mana.some((sym) => sym.kind === 'variable')) return 'unsupported';
  const other = cost.other ?? [];
  if (other.some((p) => p.kind === 'manual')) return 'unsupported';
  const selfOnly = other.every((p) => p.kind === 'sacrifice' && p.self === true);
  if (selfOnly && mana.length === 0) return 'simple';
  // p2-mana-1: an X that is only the number of counters one cost part removes from ~ is announced as the ability is activated (counterXPart): paid by hand
  const xOnly = counterXPart(def) !== undefined;
  const reads = (v: unknown): boolean => COST_READS.test(xOnly ? JSON.stringify(v).replaceAll('"q":"X"', '') : JSON.stringify(v));
  if (reads(other) || reads(def.effect)) return 'unsupported';
  if (xOnly) return 'byHand';
  if (selfOnly && mana.every((sym) => PLAIN_SYMBOLS.has(sym.kind))) return 'converter';
  return 'byHand';
}

/**
 * FAST5X E5 INTERFACE CHANGE (additive): the cost rules of a mana ability whose cost is not `simple`, installed by rules/pay.ts when it loads (rules/pay.ts and
 * rules/cost.ts import this module, so it can't import them: design 5.4, no cycles). `denial` answers "could the player pay it now" (CR 118.3, 602.2b: a cost
 * that can't be paid can't be begun, CR 605.3a); `pay` pays it (the source's {T}, the mana, then the other parts, CR 601.2g-h). `payWith`: the automatic payer
 * already put the mana for it in the pool and names the types to spend (rules/convert.ts); the player is not asked. A function registry, not game data. Not
 * installed: such abilities are not offered.
 */
export interface ManaCostRules {
  denial: (s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo) => Denial | null;
  pay: (g: Game, player: PlayerId, source: GameObject, info: ActivatedInfo, payWith?: ManaType[], /** p2-mana-1: the announced X of counterXPart */ x?: number) => void;
  /**
   * std-rx28 INTERFACE CHANGE (additive): does another object's static ability increase (or set) the cost of activating this mana ability now ("Activated
   * abilities of sources with the chosen name cost {2} more to activate", Skyseer's Chariot; CR 601.2f, 602.2b, 605.1a)? Such an ability is paid like any other
   * (`shapeNow`), never activated for free.
   */
  increased?: (s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo) => boolean;
}
let costRules: ManaCostRules | null = null;
export function installManaCostRules(r: ManaCostRules | null): void {
  costRules = r;
}

/**
 * std-rx28 (CR 601.2f, 602.2b, 605.1a): the shape of a mana ability's cost as it would be activated now: a `simple` cost ({T}, "Sacrifice ~") that another object's
 * static ability increases has mana to pay, so it is paid by hand like a `byHand` one (rules/pay.ts adds the increase, statics/costmods.ts#abilityManaCost); with no
 * cost rules installed it can't be paid, and is `unsupported`.
 */
export function manaCostShapeNow(s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo): ManaCostShape {
  const shape = manaCostShape(info.def);
  if (shape !== 'simple' || costRules?.increased === undefined) return shape;
  return costRules.increased(s, player, source, info) ? 'byHand' : shape;
}

/**
 * FAST5X E5 INTERFACE CHANGE (additive): the reader of a mana ability's "Activate only if ..." restriction (CR 602.5b, kept by a mana ability, CR 605.1a), read
 * like any activation restriction (actions/announce-cond.ts, which this module may not import: actions/activate.ts installs it). It answers a Denial, or null
 * when the restriction holds. An `ask` (the controller's attestation) is never accepted for a mana ability: the reader denies it. Not installed: a mana ability
 * with a restriction is not offered.
 */
export type ManaRestrictionReader = (s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo) => Denial | null;
let restrictionReader: ManaRestrictionReader | null = null;
export function installManaRestrictionReader(f: ManaRestrictionReader | null): void {
  restrictionReader = f;
}

/**
 * FAST5X E5: while the payability of a mana ability's cost is being checked (`manaAbilityDenial` of a non-simple cost), the mana sources it may count are the
 * simple ones and the pool only (rules/sources.ts reads this): a filter ability whose cost could be paid only by another filter ability is not offered, which
 * keeps the check finite (no ability asks about itself) and deterministic. Synchronous and restored on exit.
 */
let costCheckDepth = 0;
export const inManaCostCheck = (): boolean => costCheckDepth > 0;

/**
 * CR 605.3c: once a player begins to activate a mana ability, it can't be activated again until it has resolved. The abilities being activated right now,
 * per game state ("<object id>|<ability key>"), so paying a filter ability's mana cost never activates that same ability.
 */
const BEING_ACTIVATED = new WeakMap<GameState, Set<string>>();

/**
 * WP32 INTERFACE CHANGE (additive): what happens right after a mana ability was activated: its triggered mana abilities resolve at once (CR 605.4a). The
 * function gets the index in `g.events` of the activation's `manaAdded` event. core/triggers.ts installs it when it loads (triggers/mana-now.ts finds the
 * abilities, effects/mana-now.ts resolves them); rules/ may import neither (design 5.4). A function registry, not game data. Not installed: nothing happens,
 * which only a module graph without core/triggers.ts sees (it can't collect triggers either).
 */
export type AfterManaActivation = (g: Game, eventIndex: number) => void;
let afterManaActivation: AfterManaActivation | null = null;

export function installTriggeredManaResolver(f: AfterManaActivation): void {
  afterManaActivation = f;
}

/**
 * FAST5X E19 (CR 106.3, 608.2h): the subtypes of the source of mana as it produces it: its characteristics where it is, or its last known information when a
 * cost moved it first (a Treasure sacrificed to add the mana). An ability on the stack has none.
 */
function sourceSubtypesOf(g: Game, source: GameObject): readonly string[] {
  if (source.kind === 'ability') return [];
  const live = g.s.objects[source.id];
  if (live !== undefined && live.zone === source.zone) return charsOfObject(g.s, live).subtypes;
  return g.s.lki[source.id]?.chars?.subtypes ?? charsOfObject(g.s, source).subtypes;
}

/**
 * Add mana to a player's pool (CR 106.4). `source` is the source of the mana (CR 106.3). `opts.viaActivation` (WP13 INTERFACE CHANGE) marks mana added by
 * activating a mana ability (CR 605.3b): only then does the `manaAdded` event count as an activation for triggers (triggers/normalize.ts).
 */
export function addMana(g: Game, player: PlayerId, types: ManaType[], source: GameObject | undefined, snow: boolean, restriction?: ManaRestriction, opts: { viaActivation?: boolean; keep?: 'endOfCombat' | 'endOfTurn'; exhaust?: boolean; rider?: ManaSpentRider; tapped?: boolean; whenSpent?: ManaUnit['whenSpent'] } = {}): void {
  const p = g.player(player);
  const running = source !== undefined ? ACTIVATING.get(g) : undefined;
  const byResolver = running !== undefined && running.id === source!.id; // WP31: a resolver-run mana ability (below)
  const viaActivation = opts.viaActivation === true || byResolver;
  // FAST5X E20 (CR 605.1a, 702.177a): the activated mana ability is an exhaust ability ("whenever you activate an exhaust ability", triggers/match.ts)
  const exhaust = viaActivation && (opts.exhaust === true || (byResolver && running.exhaust));
  // std-mana-1 (CR 106.12): the activated mana ability had {T} in its cost: the permanent was tapped for mana ("whenever you tap an artifact for mana")
  const tapped = viaActivation && (opts.tapped === true || (byResolver && running.tap));
  const subtypes = source ? sourceSubtypesOf(g, source) : [];
  // std-mana-1 (CR 106.12, 614.1a): a permanent tapped for mana may produce more of that mana ("three times as much of that mana instead")
  const factor = tapped && source !== undefined && source.zone === 'battlefield' && tapMultiplier ? tapMultiplier(g.s, player, source.id) : 1;
  if (factor > 1) types = types.flatMap((t) => Array.from({ length: factor }, () => t));
  for (const type of types) {
    const unit: ManaUnit = { type };
    if (source) unit.sourceId = source.id;
    if (subtypes.length > 0) unit.sourceSubtypes = [...subtypes]; // FAST5X E19 (CR 106.3): "mana from a Treasure", as the source was when it produced it
    if (snow) unit.snow = true;
    if (restriction) unit.restriction = structuredClone(restriction); // CR 106.6: spent only as the restriction says (enforced by the payment code)
    if (opts.rider) unit.rider = structuredClone(opts.rider); // std-mana-1 (CR 106.6): a rider on the spell it is spent on (actions/cast.ts#applySpentRiders)
    if (opts.whenSpent) unit.whenSpent = structuredClone(opts.whenSpent); // std-copy-3 (CR 106.6, 603.2): "When that mana is spent to cast ..." (actions/cast.ts)
    if (opts.keep) unit.keep = opts.keep; // FAST5 MX6: firebending's mana lasts until end of combat (CR 702.189a; core/steps.ts#endOfStepCleanup)
    p.manaPool.push(unit);
  }
  g.emit({ type: 'manaAdded', player, mana: types, ...(source ? { sourceId: source.id } : {}), ...(viaActivation ? { viaActivation: true as const } : {}), ...(exhaust ? { exhaust: true as const } : {}), ...(tapped ? { tapped: true as const } : {}) });
}

/**
 * WP31: a mana ability whose mana is decided as it resolves (`addMana` with `dynamic`: "one mana of the chosen color", "X mana of any one color", or any other
 * step beside `addMana`) has no units this module can read (rules/mana-text.ts#manaUnitsOf). Its effect is run by the interpreter's handlers, without the
 * stack (CR 605.3b), through this resolver, which effects/mana-ability.ts installs; the mana it adds counts as added by activating it (`ACTIVATING`, the
 * `viaActivation` of the `manaAdded` event, CR 605.3b). Before WP31 such an activation paid its costs and added nothing.
 */
/**
 * std-mana-1 (CR 106.12, 614.1a): the factor of "it produces three times as much of that mana instead" for a permanent tapped for mana (statics/hooks.ts#
 * tapManaMultiplier, installed by effects/mana-ability.ts so this module does not import the statics provider). Not installed: 1.
 */
type TapManaMultiplier = (s: GameState, player: PlayerId, source: string) => number;
let tapMultiplier: TapManaMultiplier | null = null;
export function installTapManaMultiplier(f: TapManaMultiplier | null): void {
  tapMultiplier = f;
}

export type ManaAbilityResolver = (g: Game, player: PlayerId, source: GameObject, info: ActivatedInfo) => void;
let manaResolver: ManaAbilityResolver | null = null;
export function installManaAbilityResolver(f: ManaAbilityResolver | null): void {
  manaResolver = f;
}
/** The source whose mana ability is being activated in this game right now, and whether it is an exhaust ability (per Game: deterministic, nothing kept across runs). */
const ACTIVATING = new WeakMap<Game, { id: string; exhaust: boolean; tap: boolean; x?: number; preset?: ManaType[] }>();

/**
 * Owner 2026-10-21: the next type the payer (or the player, in the payment decision) already chose for the mana ability the resolver is running now
 * (`activateManaAbility`'s `colors` / `color`), when it is one of `options`; it is used once. Read by effects/handlers/cards-mana.ts before it asks.
 */
export function presetManaType(g: Game, options: readonly ManaType[]): ManaType | undefined {
  const preset = ACTIVATING.get(g)?.preset;
  const i = preset ? preset.findIndex((t) => options.includes(t)) : -1;
  return i < 0 ? undefined : preset!.splice(i, 1)[0];
}
/** p2-mana-1: the X announced for the mana ability the resolver is running now (counterXPart), read by effects/mana-ability.ts's context; undefined otherwise. */
export function activatingX(g: Game): number | undefined {
  return ACTIVATING.get(g)?.x;
}

/**
 * Whether `player` can activate this mana ability of `source` right now (controller, zone, {T}/{Q} state, summoning sickness, and "can't activate"
 * effects). CR 605.1a makes a mana ability an ordinary activated ability, so CR 602.5 restrictions (Null Rod, Cursed Totem, Collector Ouphe) apply to it
 * unless the restriction says otherwise (Pithing Needle: "unless they're mana abilities", which the statics provider decides). This is the single choke point
 * of the activation list, `activateManaAbility` and the auto-payer's source discovery (rules/sources.ts).
 * FAST5X E5: also the ability's own restrictions (CR 605.1a, 602.5b, 602.5d: "Activate only if ...", "only once each turn", "only as a sorcery"), CR 605.3c
 * (not while it is being activated), and whether its whole cost can be paid now (CR 118.3, 605.3a: a mana cost, life, other permanents; `manaCostShape`).
 */
export function manaAbilityDenial(s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo): Denial | null {
  // edh-mana-keywords-1 (CR 113.6, 605.1a, 602.2): "Exile this card from your hand: Add {G}." (the Spirit Guides) works in the hand only, for the card's owner, who
  // holds it (a card in a hand has no controller); every other mana ability works on the battlefield, for its controller
  if (source.zone === 'hand' && info.def.zone?.length === 1 && info.def.zone[0] === 'hand') {
    if (source.owner !== player) return deny('You can only activate abilities of cards in your own hand.', 'CR 602.2');
  } else {
    if (source.zone !== 'battlefield' || !activationZones(info.def).includes('battlefield')) return deny('Mana abilities of permanents can only be activated while the permanent is on the battlefield.', 'CR 113.6');
    if (source.controller !== player) return deny('You can only activate abilities of permanents you control.', 'CR 602.2');
    if (source.phasedOut) return deny('That permanent is phased out.', 'CR 702.26b');
  }
  const hook = hookpoints.canActivate(gameOf(s), source.id, info.key, player); // CR 602.5, 605.1a (rules/hookpoints.ts)
  if (hook) return hook;
  if (BEING_ACTIVATED.get(s)?.has(`${source.id}|${info.key}`)) return deny('That mana ability is being activated: it can\'t be activated again until it has resolved.', 'CR 605.3c');
  // FAST5X E5 (CR 605.1a, 602.5b, 602.5d): a mana ability keeps its printed restrictions ("Activate only once each turn", "only as a sorcery", "only if ...")
  const restricted = activationRestrictionDenial(s, player, source, info.key, info.def);
  if (restricted) return restricted;
  if (info.def.onlyIf !== undefined || info.def.limit !== undefined) {
    if (!restrictionReader) return deny("This engine build can't read the restriction of this mana ability, so it is not offered.", 'CR 602.5b', 'CR 605.1a');
    const r = restrictionReader(s, player, source, info);
    if (r) return r;
  }
  const cost = info.def.cost;
  const shape = manaCostShapeNow(s, player, source, info); // std-rx28: a cost increase of another object makes a {T} cost one to pay
  if (shape === 'unsupported') return deny('This mana ability has a cost the engine can not pay yet.', 'CR 605.3a');
  const c = charsOfObject(s, source);
  if (cost.tap || cost.untap) {
    if (cost.tap && source.tapped) return deny(`${c.name} is already tapped.`, 'CR 118.3', 'CR 602.2');
    if (cost.untap && !source.tapped) return deny(`${c.name} is already untapped.`, 'CR 118.3', 'CR 602.2');
    if (isSummoningSickToActivate(s, source, c)) return deny(`${c.name} came under your control this turn, so you can't use its {T} abilities yet (summoning sickness).`, 'CR 302.6', 'CR 602.5a');
  }
  const cantUntap = cost.untap ? cantDo(s, 'untap', source.id) : null; // WP31: CR 107.6, 614.17b
  if (cantUntap) return deny(`${c.name} can't untap, so its {Q} cost can't be paid.`, 'CR 107.6', 'CR 614.17b');
  if (shape !== 'simple') {
    // FAST5X E5 (CR 605.3a, 118.3, 602.2b): the whole cost, as the payment code will pay it; mana counted from the pool and the simple sources only (see
    // `inManaCostCheck`)
    if (!costRules) return deny('This engine build can\'t pay the cost of this mana ability, so it is not offered.', 'CR 605.3a');
    costCheckDepth++;
    try {
      return costRules.denial(s, player, source, info);
    } finally {
      costCheckDepth--;
    }
  }
  for (const part of cost.other ?? []) {
    if (part.kind !== 'sacrifice' || !part.self) return deny('This mana ability has a cost the engine can not pay yet.', 'CR 605.3a');
    const cant = costUseDenial(s, player, source.id, 'sacrifice'); // WP31: "can't be sacrificed", "can't leave the battlefield" (CR 701.21a, 614.17b)
    if (cant) return deny(`${c.name} can't be sacrificed, so this mana ability can't be activated. ${cant.message}`, 'CR 701.21a', 'CR 614.17b');
  }
  return null;
}

/** The restriction on the mana a mana ability adds (its `addMana` steps), or undefined when the mana is unrestricted. */
export function restrictionOf(info: ActivatedInfo): ManaRestriction | undefined {
  const steps = info.def.effect.steps;
  for (const st of steps) if (st.op === 'addMana' && st.restriction) return st.restriction;
  return undefined;
}

/** std-mana-1 (CR 106.6): the rider on the mana a mana ability adds ("If that mana is spent on a Dragon creature spell, it gains haste until end of turn"). */
export function riderOf(info: ActivatedInfo): ManaSpentRider | undefined {
  for (const st of info.def.effect.steps) if (st.op === 'addMana' && st.rider) return st.rider;
  return undefined;
}

/** std-copy-3 (CR 106.6, 603.2): the triggered ability "When that mana is spent to cast ..." the mana of a mana ability carries (its addMana step's `whenSpent`). */
export function whenSpentOf(info: ActivatedInfo, controller: PlayerId, source: GameObject): ManaUnit['whenSpent'] {
  for (const st of info.def.effect.steps) if (st.op === 'addMana' && st.whenSpent) return { ...structuredClone(st.whenSpent), controller, sourceId: source.id };
  return undefined;
}

/** std-mkm (CR 500.5, 106.4): "Until end of turn, you don't lose this mana as steps and phases end" said by a mana ability (the `keep` of its addMana step). */
export function keepOf(info: ActivatedInfo): 'endOfCombat' | 'endOfTurn' | undefined {
  for (const st of info.def.effect.steps) if (st.op === 'addMana' && st.keep) return st.keep;
  return undefined;
}

/** The options of each unit of a mana ability. */
export function unitOptions(info: ActivatedInfo): ManaType[][] {
  return manaUnitsOf(info.def) ?? [];
}

/**
 * PAY1 INTERFACE CHANGE (additive): reads the amount of a mana ability whose amount is computed ("Add X mana of any one color, where X is ~'s power", Mona
 * Lisa, Science Geek; "where X is the number of Elves on the battlefield", Wirewood Channeler) exactly as the interpreter will when the ability resolves: the
 * same evaluator, in the same context as the resolver above (no stack object, no targets, no event). effects/mana-ability.ts installs it next to the
 * resolver. A function registry, not game data. Not installed: such abilities are left to the player, as before.
 */
export type ManaAmountReader = (s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo, count: Quantity) => number | undefined;
let amountReader: ManaAmountReader | null = null;
export function installManaAmountReader(f: ManaAmountReader | null): void {
  amountReader = f;
}

/**
 * True when every quantity and condition in `node` depends only on the game state (statics/match.ts's kinds): no event, no question to a player. An amount
 * that reads whether permanents are tapped is left out: paying the ability's {T} cost changes it, so it could not be planned before the payment.
 */
function stateOnly(node: unknown): boolean {
  if (Array.isArray(node)) return node.every(stateOnly);
  if (node === null || typeof node !== 'object') return true;
  const o = node as Record<string, unknown>;
  if ('tapped' in o) return false;
  if (typeof o['q'] === 'string' && !STATIC_QUANTITY_KINDS.has(o['q'])) return false;
  if (typeof o['cond'] === 'string' && !STATIC_CONDITION_KINDS.has(o['cond'])) return false;
  return Object.values(o).every(stateOnly);
}

/** A mana ability's units once its computed amount is known; `oneType`: every unit is the same type, chosen among the unit's options ("any one color"). */
export interface ComputedUnits {
  units: ManaType[][];
  oneType: boolean;
  /** The types each unit may be (whatever the amount). */
  options: ManaType[];
}

/**
 * PAY1: the units of a mana ability whose amount is computed, read now. The amount is determined as the ability resolves (CR 106.1, 605.3b), which is at
 * once, with nothing in between, so it is known when the payment is planned (CR 601.2g-h). Only the plain shape is read: one unconditional `addMana` step
 * for its controller with "any color" (each unit chosen on its own), "any one color" (one choice for every unit) or one fixed type, and an amount that
 * depends on the game state only. Anything else (the chosen color, the mana spent, a second step, an amount that asks a player) is null: the player
 * activates it by hand, as before.
 */
export function computedManaUnits(s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo): ComputedUnits | null {
  const steps = info.def.effect.steps;
  if (steps.length !== 1 || !amountReader) return null;
  const st = steps[0]!;
  if (st.op !== 'addMana' || st.units !== undefined || !st.dynamic || st.guard || st.who.ref !== 'you') return null;
  const d = st.dynamic;
  if (d.kind !== 'anyColor' && d.kind !== 'anyOneColor' && d.kind !== 'ofType' && d.kind !== 'commanderIdentity') return null;
  if (!stateOnly(d.count)) return null;
  // M11-1, CR 903.4, 903.4f, 702.124c: "any color in your commander's color identity": exactly those colors; none (nothing to offer) without a commander or
  // with a colorless identity; an identity the game was not given is left to the player (the resolver asks by hand, never a guess)
  const identity = d.kind === 'commanderIdentity' ? identityManaColors(s, player) : null;
  if (identity === 'unknown') return null;
  const raw = amountReader(s, player, source, info, d.count);
  if (raw === undefined || !Number.isFinite(raw)) return null;
  const n = Math.max(0, Math.floor(raw)); // as effects/handlers/cards-util.ts#cardCount does for the resolver: an amount of mana is never negative
  const options: ManaType[] =
    d.kind === 'ofType' ? [d.type]
    : identity !== null ? [...identity]
    : (d.kind === 'anyOneColor' || d.kind === 'anyColor') && d.from !== undefined ? [...d.from] // FAST5 T48: "X {G} or X {W}"; r3-cost: "{R} or {G} for each"
    : [...COLORS];
  if (options.length === 0) return { units: [], oneType: false, options }; // CR 903.4f: that part of the ability does nothing
  return { units: Array.from({ length: n }, () => [...options]), oneType: d.kind === 'anyOneColor', options };
}

export interface ActivateOptions {
  /** Color for every unit that has a choice. */
  color?: ManaType;
  /** Color per unit (index = unit); takes priority over `color`. */
  colors?: ManaType[];
  /** If a choice is needed and no color was given: true asks the player (decision), false rejects the action. */
  ask?: boolean;
  /**
   * FAST5X E5 INTERFACE CHANGE (additive): the mana cost of a `converter` ability is paid with these types from the pool, without asking (the automatic payer
   * put them there for it, rules/convert.ts). Absent: the player is asked to pay it (a `payCost` decision, CR 605.3a).
   */
  payWith?: ManaType[];
}

/**
 * PAY1: the type of each unit of a computed mana ability from the activation's options (at least one type is given). "Any one color" takes one type for
 * every unit, and two different types are refused (null). "Any color" takes a type per unit; a unit beyond the given list (the amount grew since the
 * payment was planned) takes `color`, else the last type given: extra mana stays in the pool.
 */
function presetTypes(c: ComputedUnits, opts: ActivateOptions): ManaType[] | null {
  const given = opts.colors && opts.colors.length > 0 ? opts.colors : [opts.color!];
  if (c.oneType) {
    const t = given[0]!;
    return given.every((x) => x === t) ? c.units.map(() => t) : null;
  }
  return c.units.map((_, i) => given[i] ?? opts.color ?? given[given.length - 1]!);
}

/**
 * FAST5X E5 (CR 602.5b, 605.1a): a mana ability with an activation limit counts its activations as actions/activate.ts counts any ability's: per turn in
 * `turnActivations`, "only once" on the object (a new object has its use back, CR 400.7). Abilities without a limit are not counted (nothing reads it).
 */
function countActivation(g: Game, sourceId: string, info: ActivatedInfo): void {
  const limit = info.def.limit;
  if (limit?.per === 'turn') {
    const k = `${sourceId}|${info.key}`;
    g.s.turnActivations[k] = (g.s.turnActivations[k] ?? 0) + 1;
  }
  const live = g.maybeObj(sourceId);
  if (limit?.per === 'game' && live) live.chosen = { ...(live.chosen ?? {}), [`limit:${info.key}`]: (Number(live.chosen?.[`limit:${info.key}`] ?? 0) || 0) + 1 };
}

/**
 * Activate a mana ability: pay its costs (tap, sacrifice itself) and add the mana at once (CR 605.3b).
 * Returns the mana produced.
 */
export function activateManaAbility(g: Game, player: PlayerId, sourceId: string, key: string, opts: ActivateOptions = {}): ManaType[] {
  const source = g.maybeObj(sourceId);
  if (!source) throw new IllegalAction('That object is not here.');
  const info = findAbility(g.s, sourceId, key);
  if (!info || info.def.kind !== 'activated' || !info.def.isMana) throw new IllegalAction('That is not a mana ability.', ['CR 605.1a']);
  const mana = info as ActivatedInfo;
  const d = manaAbilityDenial(g.s, player, source, mana);
  if (d) throw new IllegalAction(d.message, d.rules);

  // Decide the type of each unit before paying anything. (A dynamic ability decides as it resolves, through the resolver: WP31.)
  // PAY1: an ability whose amount is computed, activated with its type(s) given (the auto-payer's plan, or the player's color), adds the given type(s)
  // instead of asking again (CR 106.1b, 605.3b). Its amount is read after its costs are paid, as the resolver reads it (rules/mana.ts#computedManaUnits).
  const xPart = counterXPart(mana.def); // p2-mana-1: its amount reads the X announced below, never planned ahead
  const computed = xPart === undefined && manaUnitsOf(mana.def) === null && (opts.color !== undefined || (opts.colors?.length ?? 0) > 0) ? computedManaUnits(g.s, player, source, mana) : null;
  if (computed) {
    const given = presetTypes(computed, opts);
    if (given === null) throw new IllegalAction(`${charsOfObject(g.s, source).name} adds mana of one color only.`, ['CR 106.1b']);
    const bad = [...(opts.colors ?? []), ...(opts.color !== undefined ? [opts.color] : [])].find((t) => !computed.options.includes(t));
    if (bad !== undefined) throw new IllegalAction(`${charsOfObject(g.s, source).name} can't produce {${bad}} with that ability.`, ['CR 106.1b']);
  }
  let dynamic = (manaUnitsOf(mana.def) === null || xPart !== undefined) && computed === null;
  if (dynamic && !manaResolver) throw new EngineBug('activateManaAbility: no resolver for a mana ability decided as it resolves (effects/mana-ability.ts was not loaded)');
  const units = computed || dynamic ? [] : unitOptions(mana); // a computed amount is read once the costs are paid (below)
  const produced: ManaType[] = [];
  units.forEach((options, i) => {
    let t: ManaType | undefined = options.length === 1 ? options[0] : opts.colors?.[i] ?? opts.color;
    if (t === undefined) {
      if (!opts.ask) throw new IllegalAction(`Choose which type of mana ${charsOfObject(g.s, source).name} produces.`, ['CR 106.1b']);
      t = g.choose({
        kind: 'chooseColor',
        player,
        prompt: `Choose a type of mana for ${charsOfObject(g.s, source).name}.`,
        options: [...options],
        cancellable: true,
        rules: ['CR 605.3b'],
      }).color;
    }
    if (!options.includes(t)) throw new IllegalAction(`${charsOfObject(g.s, source).name} can't produce {${t}} with that ability.`, ['CR 106.1b']);
    produced.push(t);
  });

  const fromHand = source.zone === 'hand'; // edh-mana-keywords-1: its cost moves it out of the hand
  const c = charsOfObject(g.s, source);
  const snow = c.supertypes.includes('Snow'); // CR 107.4h: mana produced by a snow source is snow mana
  const shape = manaCostShapeNow(g.s, player, source, mana); // std-rx28
  let announcedX: number | undefined; // p2-mana-1 (counterXPart)
  const sacrifice = (mana.def.cost.other ?? []).some((p) => p.kind === 'sacrifice' && p.self === true);
  const name = c.name;
  if (shape === 'simple') {
    if (mana.def.cost.tap) {
      source.tapped = true;
      g.emit({ type: 'tapped', objectId: source.id });
    }
    if (mana.def.cost.untap && !stunInsteadOfUntap(g, source.id)) { // CR 122.1d (T20)
      source.tapped = false;
      g.emit({ type: 'untapped', objectId: source.id });
    }
    if (sacrifice) moveObject(g, source.id, 'graveyard', { cause: 'sacrifice' });
  } else {
    // FAST5X E5 (CR 605.3a-c, 602.2b, 601.2g-h): the cost is paid like any ability's (its mana may need other mana abilities, which the player may activate
    // now); this ability can't be activated again until it has resolved (CR 605.3c)
    if (!costRules) throw new EngineBug('activateManaAbility: no cost rules for a mana ability with a non-simple cost (rules/pay.ts was not loaded)');
    const key = `${source.id}|${mana.key}`;
    const active = BEING_ACTIVATED.get(g.s) ?? new Set<string>();
    BEING_ACTIVATED.set(g.s, active);
    active.add(key);
    try {
      // p2-mana-1 (CR 107.1c, 601.2b, 602.2b): "Remove any number of storage counters from ~": the number is announced first, 0 up to the counters on it
      if (xPart !== undefined) {
        const have = source.counters[xPart.counter] ?? 0;
        announcedX = have === 0 ? 0 : g.choose({ kind: 'chooseNumber', player, prompt: `How many ${xPart.counter} counters do you remove from ${name}? (X, up to ${have})`, min: 0, max: have, cancellable: true, rules: ['CR 107.1c', 'CR 601.2b', 'CR 602.2b'] }).n;
        if (!Number.isInteger(announcedX) || announcedX < 0 || announcedX > have) throw new IllegalAction(`Choose a number from 0 to ${have}.`, ['CR 601.2b']);
      }
      costRules.pay(g, player, source, mana, opts.payWith, announcedX);
    } finally {
      active.delete(key);
    }
  }
  countActivation(g, source.id, mana);
  const exhaust = mana.def.keyword === 'exhaust'; // FAST5X E20 (CR 702.177a): an exhaust mana ability is still "an exhaust ability"
  if (computed) {
    const now = computedManaUnits(g.s, player, source, mana); // CR 605.3b: the amount as the ability resolves, after its costs were paid
    const types = now ? presetTypes(now, opts) : null;
    if (types) produced.push(...types);
    else dynamic = true; // no longer readable: the resolver decides, as before PAY1
  }
  let firstEvent = -1;
  if (dynamic) {
    const pool = g.player(player).manaPool;
    const before = pool.length;
    firstEvent = g.events.length;
    const preset = [...(opts.colors ?? []), ...(opts.color !== undefined ? [opts.color] : [])];
    ACTIVATING.set(g, { id: source.id, exhaust, tap: mana.def.cost.tap === true, ...(announcedX !== undefined ? { x: announcedX } : {}), ...(preset.length > 0 ? { preset } : {}) });
    try {
      manaResolver!(g, player, source, mana); // CR 605.3b: at once, without the stack
    } finally {
      ACTIVATING.delete(g);
    }
    produced.push(...g.player(player).manaPool.slice(before).map((u) => u.type));
  }
  g.log(`${g.player(player).name} ${fromHand ? 'exiles' : sacrifice ? 'sacrifices' : 'taps'} ${name} for ${manaText(produced)}.`, { rules: ['CR 605.3b'], level: 'info' });
  if (!dynamic) {
    addManaByActivation(g, player, produced, source, snow, restrictionOf(mana), exhaust, keepOf(mana), riderOf(mana), mana.def.cost.tap === true, whenSpentOf(mana, player, source)); // only the id is used, which survives the sacrifice
    return produced;
  }
  // W3 integration (WP31 resolver + WP32 triggered mana abilities): the resolver's first `manaAdded` event of this activation (marked `viaActivation` through
  // ACTIVATING) is the activation that triggers triggered mana abilities, once (CR 605.1b, 605.4a). If the resolver added nothing, the ability was still
  // activated: an empty `manaAdded` event stands for it, as for a manual mana ability that adds nothing (addManaByActivation).
  for (let i = firstEvent; i < g.events.length; i++) {
    const e = g.events[i]!;
    if (e.type === 'manaAdded' && e.viaActivation === true) {
      afterManaActivation?.(g, i);
      return produced;
    }
  }
  addManaByActivation(g, player, [], source, snow, restrictionOf(mana), exhaust, undefined, undefined, mana.def.cost.tap === true);
  return produced;
}

/**
 * WP32 review INTERFACE CHANGE (additive): the mana a mana ability adds as it is activated (CR 605.3b), by the engine (`activateManaAbility`) or by hand
 * (actions/activate.ts#activateManualMana, a mana ability the recognizer does not understand). Its `manaAdded` event is the activation (CR 605.1b: what
 * triggers a triggered mana ability, triggers/normalize.ts), and the triggered mana abilities it triggers resolve now, before anything else, even in the middle
 * of a payment (CR 605.4a). `types` may be empty (the player added nothing by hand): the ability was still activated.
 */
export function addManaByActivation(g: Game, player: PlayerId, types: ManaType[], source: GameObject, snow: boolean, restriction?: ManaRestriction, exhaust = false, keep?: 'endOfCombat' | 'endOfTurn', rider?: ManaSpentRider, tapped = false, whenSpent?: ManaUnit['whenSpent']): void {
  addMana(g, player, types, source, snow, restriction, { viaActivation: true, exhaust, tapped, ...(keep ? { keep } : {}), ...(rider ? { rider } : {}), ...(whenSpent ? { whenSpent } : {}) }); // std-mkm: `keep` (keepOf); std-copy-3: `whenSpent`
  afterManaActivation?.(g, g.events.length - 1); // the manaAdded event just emitted
}

/** Types a pool contains (for display and the mana-empties tests). */
export function poolTypes(s: GameState, player: PlayerId): ManaType[] {
  return (s.players.find((p) => p.id === player)?.manaPool ?? []).map((u) => u.type);
}
