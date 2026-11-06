/**
 * Activating abilities (CR 602). Mana abilities resolve immediately without the stack (CR 605.3b);
 * every other activated ability becomes an object on the stack (CR 602.2a) and then follows the
 * casting procedure CR 601.2b-i (CR 602.2b): modes, X, targets, total cost, payment.
 *
 * Unlike a spell, the ability goes on the stack BEFORE its costs are paid (CR 602.2a), so a cost such
 * as "sacrifice this permanent" leaves the ability on the stack with its source's last known information.
 */
import type { Action } from '../types/actions';
import type { ManualOp } from '../types/decisions';
import type { ActivatedAbilityDef, CostDef, ManualAbilityDef, Quantity } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { GameObject, GameState, TargetChoice } from '../types/state';
import { holdStill } from '../statics/stable-scope';
import { reduceManaBy } from '../statics/costmods';
import { enteredThisTurn, happenedCountOf, opponentsAttackedCount } from '../rules/history';
import type { ObjectId } from '../types/ids';
import { IllegalAction, type Game } from '../core/game';
import { canSee } from '../core/view';
import { applyManualOps, chooseManualSteps } from '../core/manual';
import { freshObject, moveObject } from '../core/zones';
import { activationZones, findAbility, type ActivatedInfo } from '../rules/abilities';
import { charsOfObject } from '../rules/characteristics';
import { addPlans, applyOnlyX, countX, costFilterHasX, costHasX, hasOneOf, oneOfPlans, payableXs, planDenial, planFromCostDef, planFromCostDefs, type CostPlan, type CostX, type PlanPart } from '../rules/cost';
import { pickCandidates } from '../rules/cost-pick';
import { groupStat, programFiltersMentionX } from '../rules/targets';
import { deny, assertAllowed, type Denial } from '../rules/denial';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { activateManaAbility, addManaByActivation, installManaRestrictionReader, manaAbilityDenial, manaText } from '../rules/mana';
import { costUseDenial } from '../rules/cant';
import { abilityCostModsFor, modifyMana, type CostModHit } from '../statics/costmods';
import { beginTypedActivation, endTypedActivation } from '../rules/typed-activations';
import { charsViewOf } from '../statics/rule-sources';
import { staticAnyColorForAbility, staticAnyColorWithForAbility } from '../statics/play-permits';
import { evalCondition, evalQuantity } from '../statics/match';
import { payPlan, resolveAnyCounts, type Paid } from '../rules/pay';
import { applyOptions, payableWith, tapForManaOption } from '../rules/payment-options';
import { emitCrime } from '../rules/crime';
import { activatedForms } from '../model/forms';
import { abilityTiming, isSummoningSickToActivate, splitSecondDenial } from '../rules/timing';
import { readLink, setLink } from '../statics/links';
import { activationOutcome, announceCond, type AnnounceEnv } from './announce-cond';
import { manaSpentTriggers } from './cast';
import { announceTargets, chooseModes, chooseX, describeTargets, effectivePrograms, emitBecameTarget, modeCosts, modesDenial, programsDenial, supportsForm } from './announce';

/** The mana of an ability's cost is for that ability: restricted mana pays only if its source matches (CR 106.6). */
/** The printed definition behind a printed ability (CR 113.7a): what rules/abilities.ts#abilityDefOnStack reads for a printed ability on the stack without `inline`. */
const printedDef = (s: GameState, source: GameObject, act: ActivatedInfo): unknown =>
  act.origin === 'printed' && act.index >= 0 ? s.defs[source.defId]?.faces[act.face]?.abilities[act.index] : act.def;

const samePrinted = (a: unknown, b: unknown): boolean => a === b || (b !== undefined && JSON.stringify(a) === JSON.stringify(b));

/**
 * The plan of an ability's cost (CR 602.2b). T35 (CR 702.193a-b, 118.7): a power-up ability (`reducedByManaCost`) of a permanent that entered the battlefield this
 * turn costs less by that permanent's mana cost: generic mana reduces generic mana, colored and colorless mana reduce mana of the same type, any excess reduces
 * generic mana. A mana cost that cannot be reduced exactly (an {X} left in it) is charged in full, never guessed.
 */
function abilityPlan(s: GameState, def: ActivatedAbilityDef, x: CostX, source: ObjectId): CostPlan {
  // FAST5X E23 (CR 106.6, 702.6a): the keyword the ability is the expansion of ("an equip ability") is part of what the mana pays for
  // edh-c-110 (CR 702.193a, 106.6; Quinjet Technician): a power-up ability is written out in the card's text, so its wrapper keyword (`def.keyword`) names it
  const keyword = def.prov?.by === 'keyword' && typeof def.prov.id === 'string' ? def.prov.id : typeof def.keyword === 'string' && def.keyword !== '' ? def.keyword : undefined;
  // std-rx32 (CR 609.4b): "you may spend mana as though it were mana of any color to activate abilities of creatures you control" (its controller activates it, CR 602.2)
  const controller = s.objects[source]?.controller;
  const anyColor = controller !== undefined && staticAnyColorForAbility(s, controller, source);
  const anyColorWith = controller !== undefined && !anyColor ? staticAnyColorWithForAbility(s, controller, source) : undefined; // edh-next-140 (CR 609.4b; Quicksilver Elemental)
  // pc-statics-2 (CR 118.3, 602.2b, 903.4): a life payment of a computed amount ("Pay life equal to the number of colors in your commanders' color identity") is
  // worked out as the total cost is determined; an amount that cannot be read stays computed, and the plan then holds a manual part, so the ability is not offered
  const cost = def.cost?.other?.some((p) => p.kind === 'payLife' && typeof p.amount === 'object') && controller !== undefined
    ? { ...def.cost, other: def.cost.other.map((p) => { if (p.kind !== 'payLife' || typeof p.amount !== 'object') return p; const v = evalQuantity({ s, all: charsViewOf(s), source, controller }, p.amount); return v === undefined ? p : { ...p, amount: Math.max(0, v) /* edh-c-41 (CR 107.1b; Lurking Evil ruling 2004-10-04): half of zero or negative life is zero, it costs nothing */ }; }) }
    : def.cost;
  const basePlan: CostPlan = { ...planFromCostDef(cost, x), spend: { kind: 'ability', id: source, ...(def.spendOnlyX !== undefined && typeof x === 'number' ? { onlyX: def.spendOnlyX, x } : {}) /* edh-next-85 (CR 107.3a): "Spend only black mana on X", applied by rules/cost.ts#applyOnlyX */, ...(def.isMana === true ? { mana: true as const } : {}) /* edh-d-3 (CR 605.1a) */, ...(keyword !== undefined ? { keyword } : {}), ...(anyColor ? { anyColor: true as const } : {}), ...(anyColorWith !== undefined ? { anyColorWith } : {}), ...(countX(def.cost?.mana) > 0 ? { xCost: true as const } : {}) } };
  const plan = basePlan;
  // edh-next-141 (CR 609.4b; Grell Philosopher): an ability a resolved "gains all activated abilities of" effect copied with "You may spend blue mana as though it were mana of any color to activate
  // those abilities" (ActivatedAbilityDef.spendColorAsAny): mana of that color pays its colored symbols too (the solver's anyColorWith, edh-next-140)
  if (def.spendColorAsAny !== undefined && plan.spend?.kind === 'ability' && plan.spend.anyColor !== true) plan.spend = { ...plan.spend, anyColorWith: def.spendColorAsAny };
  if (def.reducedByManaCost !== true || plan.mana.length === 0 || !enteredThisTurn(s, source)) return plan;
  const src = s.objects[source];
  const printed = src ? charsOfObject(s, src).manaCost : null;
  if (!printed || printed.length === 0) return plan;
  const reduced = reduceManaBy(plan.mana, printed);
  return reduced === null ? plan : { ...plan, mana: reduced };
}

/**
 * FAST5X E5 (CR 605.1a, 602.5b): a mana ability keeps its printed restrictions. Its "Activate only if ..." is read as any ability's (announce-cond.ts), with the
 * same fail-closed check of the forms this build reads (activatedForms, supportsForm). The controller's attestation (`ask`) is not taken for a mana ability:
 * the automatic payer activates mana abilities without asking anything, so such an ability is not offered (the capability walker keeps it manual,
 * model/cap-walk.ts#nativeManaGaps).
 */
installManaRestrictionReader((s, player, source, info) => {
  const def = info.def;
  const unread = activatedForms(def).filter((c) => !supportsForm(c));
  if (unread.length > 0) return deny(`This engine build can't check part of this mana ability yet (${unread.join(', ')}), so it is not offered.`, 'CR 602.5', 'CR 605.1a');
  if (def.onlyIf === undefined) return null;
  if (JSON.stringify(def.onlyIf).includes('"cond":"ask"')) return deny('The restriction of this mana ability must be confirmed by hand, so the engine does not offer it.', 'CR 602.5b', 'CR 605.1a');
  const holds = announceCond({ s, player, sourceId: source.id, costsPaid: {}, history: true }, def.onlyIf);
  if (holds === undefined) return deny("This engine build can't read the restriction of this mana ability yet, so it is not offered.", 'CR 602.5b', 'CR 605.1a');
  return holds ? null : deny('The condition this mana ability can be activated under does not hold.', 'CR 602.5b', 'CR 605.1a');
});

/**
 * edh-mana-keywords-8 (CR 106.6, 602.2b, 106.1b, 607.2d; Throne of Eldraine): "Spend only mana of the chosen color to activate this ability." Every mana the activation spends is of
 * the color the source chose, so each generic mana of the cost is a mana of that color; a cost with any other colored mana (a symbol of another color, a hybrid, a snow or colorless
 * symbol) cannot be paid with only that color and is not offered, as is an ability whose source has chosen no color (never a payment that breaks the restriction).
 */
function onlyChosenColor(s: GameState, plan: CostPlan, source: ObjectId, link: string): CostPlan {
  const v = readLink(s.objects[source], link)?.values?.[0];
  const color = v === undefined ? undefined : (CHOSEN_COLORS[v.toLowerCase()] ?? v.toUpperCase());
  const unpayable: CostPlan = { ...plan, other: [...plan.other, { kind: 'manual', text: 'Spend only mana of the chosen color, which this permanent has not chosen' }] };
  if (color === undefined || !(['W', 'U', 'B', 'R', 'G'] as const).includes(color as 'W')) return unpayable;
  const paid = color as 'W' | 'U' | 'B' | 'R' | 'G';
  const mana: CostPlan['mana'] = [];
  for (const sym of plan.mana) {
    if (sym.kind === 'generic') for (let i = 0; i < sym.amount; i++) mana.push({ kind: 'colored', color: paid });
    else if (sym.kind === 'colored' && sym.color === paid) mana.push(sym);
    else return unpayable;
  }
  return { ...plan, mana };
}
/**
 * edh-mana-keywords-8 (CR 601.2f-h, 106.6; review fix): "Spend only mana of the chosen color" covers the TOTAL cost, so it is applied after the cost changes of other objects
 * (a {1} more is mana of the chosen color too; a {2} less leaves the rest) and the costs of the chosen modes.
 */
function spendOnlyAfter(cc: Exclude<CostChange, { denial: Denial }>, s: GameState, def: ActivatedAbilityDef, source: ObjectId): Exclude<CostChange, { denial: Denial }> {
  const link = def.spendOnlyChosen;
  if (link === undefined) return def.spendOnlyX === undefined ? cc : { apply: (plan) => applyOnlyX(cc.apply(plan)), log: cc.log };
  return { apply: (plan) => applyOnlyX(onlyChosenColor(s, cc.apply(plan), source, link)), log: cc.log };
}
const CHOSEN_COLORS: Readonly<Record<string, string>> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/**
 * T38, CR 601.2f, 602.2b, 118.7: the ability's own cost change ("This ability costs {1} less to activate for each Equipment you control"; `ActivatedAbilityDef.costChange`)
 * applied to a TOTAL cost plan (the mana cost with X, plus the costs of the chosen modes). It is read as a spell's own cost modifier is (statics/costmods.ts#modifyMana:
 * reductions never take the cost below {0}, generic reductions touch only the generic part), with the activating player as "you". The result is a function, or
 * the denial when the amount can't be worked out (a quantity nobody can evaluate: never a guess, design 1.1.4). Nothing changes for an ability without one.
 */
type CostChange = { apply: (plan: CostPlan) => CostPlan; log: (plan: CostPlan) => string | null } | { denial: Denial };
function costChangeOf(s: GameState, player: PlayerId, source: GameObject, def: ActivatedAbilityDef, targets?: () => readonly (readonly TargetChoice[])[] | undefined): CostChange {
  const change = def.costChange;
  // FAST5 T60: and what other objects' static abilities change the cost of activating it ("Exhaust abilities of other permanents you control cost {2} less")
  // r4-cost (CR 601.2c, 601.2f): each modifier may read the targets announced for the ability ("if it targets ...", "the creature it targets"); none before
  const announced = targets ?? (() => undefined);
  const outside = abilityCostModsFor(s, player, source, def).map((h) => ({ ...h, targets: announced }));
  if (change === undefined && outside.length === 0) return { apply: (p) => p, log: () => null };
  // FAST5X E27 (CR 601.2b, 601.2f): a choice between costs is made before the total cost is locked in. edh-next-147 (Crystal Shard under a cost change): the change is
  // applied to the total each option stands for (the rest of the cost plus that option), so whichever cost is chosen is changed as CR 601.2f says (below). A choice
  // nested in a choice is not offered rather than charged a wrong amount.
  // A spending restriction (spendOnlyAfter below) reads the plan's own mana only, which the distribution moves into the options: such an ability keeps the older refusal too.
  // edh-d-88 (Razorfield Ripper's "Reconfigure--Pay {2} or {E}{E}{E}", Ward costs, e27's Equip) made the same change: one implementation, this one.
  const choices = (JSON.stringify(def.cost).match(/"oneOf"/g) ?? []).length;
  if (choices > 1 || (choices === 1 && (def.spendOnlyChosen !== undefined || def.spendOnlyX !== undefined))) return { denial: deny("This engine build can't apply this ability's cost change to a choice between costs, so it is not offered.", 'CR 601.2f', 'CR 602.2b') };
  // r4-cost (CR 601.2f, 602.2b): a cost change of its own that applies only while its condition holds ("during your turn"), read as the cost is determined
  const ownApplies = change !== undefined && (def.costChangeIf === undefined || evalCondition({ s, all: charsViewOf(s), source: source.id, controller: player }, def.costChangeIf));
  const own: CostModHit[] = !ownApplies ? [] : [{
    def: { s: 'costMod', applies: { abilities: {}, caster: 'you' }, change },
    source: source.id, controller: player, name: charsOfObject(s, source).name, text: def.text,
    cx: { s, all: charsViewOf(s), source: source.id, controller: player }, targets: announced,
  }];
  // edh-next-107 (CR 601.2c, 601.2f; Bladegraft Aspirant): a modifier of "abilities that target ~" applies when the announced targets include its source, read each time the cost is worked
  // out (the thunk answers after the targets are announced); before that a reduction counts (the cheapest the targets could make it, as for spells: statics/costmods.ts#spellTargetsSource)
  // and an increase does not
  const hitsNow = (): CostModHit[] => [...own, ...outside.filter((h) => {
    if (h.abilityTargetsSelf !== true) return true;
    const t = announced();
    return t === undefined ? h.def.change.kind === 'reduce' : t.flat().some((x) => x.kind === 'object' && x.id === h.source);
  })];
  // FAST5 T63 INTERFACE CHANGE (additive; CR 601.2f, 602.2b): the history count of "if you attacked with a Spacecraft this turn" (`happenedCount`, evaluated here because statics may not read
  // rules/history.ts, design 5.4), as actions/cast.ts#modifiedPlan supplies it for a spell's cost modifiers
  // trek-15 (CR 506.3, 601.2f): and "for each opponent you attacked this turn", as actions/cast.ts#modifiedPlan reads it
  const history = (q: Quantity, h: CostModHit): number | undefined =>
    typeof q === 'number' ? undefined
    : q.q === 'happenedCount' ? happenedCountOf(s, q, { you: h.controller, ...(h.source !== null ? { sourceId: h.source } : {}) })
    : q.q === 'opponentsAttacked' && q.scope === 'turn' ? opponentsAttackedCount(s, h.controller, null)
    : undefined;
  const run = (plan: CostPlan) => modifyMana(plan.mana, hitsNow(), history);
  if ('unknown' in run({ mana: [], tap: false, untap: false, other: [] })) {
    return { denial: deny(`The engine can't work out the cost change of this ability ("${def.text}"), so its total cost is unknown.`, 'CR 601.2f', 'CR 602.2b') };
  }
  // edh-next-142 (CR 606.4, 601.2f, 118.8; Carth the Lion, rulings 2021-06-18): "loyalty abilities you activate cost an additional [+1] to activate": the loyalty cost is that much more, once for each
  // modifier, as the total cost is determined (before any counter is put or removed: a [−3] removes two counters at once); only an ability with a loyalty cost has one to change
  // (combined copy: the modifiers are read when the plan is, as edh-next-107's hitsNow does for the mana, so a modifier that counts only once targets are announced counts here too)
  const withLoyalty = (plan: CostPlan): CostPlan => {
    const extraLoyalty = hitsNow().reduce((n, h) => n + (h.def.change.kind === 'increase' && typeof h.def.change.loyalty === 'number' ? h.def.change.loyalty : 0), 0);
    return extraLoyalty === 0 || plan.loyalty === undefined ? plan : { ...plan, loyalty: plan.loyalty + extraLoyalty };
  };
  const applyTo = (plan: CostPlan): CostPlan => {
    const r = run(plan);
    return 'unknown' in r ? plan : { ...plan, mana: r.mana };
  };
  return {
    // edh-next-147 (CR 601.2b, 601.2f): with a choice between costs, each option carries the whole changed mana of the total it stands for (the rest's mana moves into
    // every option), so rules/pay.ts#resolveOneOf offers and charges each total as changed
    apply: (plan) => {
      if (!hasOneOf(plan)) {
        const out = applyTo(plan);
        return out === plan ? plan : withLoyalty(out); // edh-next-142 (Carth the Lion): an additional loyalty cost rides on an applied change
      }
      const i = plan.other.findIndex((p) => p.kind === 'oneOf');
      const part = plan.other[i] as Extract<CostPlan['other'][number], { kind: 'oneOf' }>;
      const options = part.options.map((o) => ({ ...o, mana: applyTo({ ...o, mana: [...plan.mana, ...o.mana] }).mana }));
      return withLoyalty({ ...plan, mana: [], other: plan.other.map((p, j) => (j === i ? { kind: 'oneOf' as const, options } : p)) });
    },
    log: (plan) => {
      // edh-d-88: the changes applied to any option of a choice between costs (each option's total, as apply charges it)
      const k = plan.other.findIndex((p) => p.kind === 'oneOf');
      const options = k < 0 ? [plan] : (plan.other[k] as Extract<CostPlan['other'][number], { kind: 'oneOf' }>).options.map((o) => ({ ...o, mana: [...plan.mana, ...o.mana] }));
      const said = options.flatMap((o) => { const r = run(o); return 'unknown' in r ? [] : r.applied; });
      return said.length === 0 ? null : [...new Set(said)].join('; ');
    },
  };
}

/** CR 602.5: may this player begin to activate this ability? Pure. Includes a payability check at X = 0. */
export function activationDenial(s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo): Denial | null {
  return holdStill(s, () => activationDenialIn(s, player, source, info)); // P1: pure, so its questions share one cache check of `s`
}

function activationDenialIn(s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo): Denial | null {
  const def = info.def;
  if (def.isMana) return manaAbilityDenial(s, player, source, info);
  const split = splitSecondDenial(s); // CR 702.61a
  if (split) return split;
  const zones = activationZones(def);
  if (!zones.includes(source.zone)) return deny(`That ability can only be activated while the card is on the ${zones.join(' or ')}.`, 'CR 113.6');
  const holder = source.zone === 'battlefield' ? source.controller : source.owner;
  // MX5: "Any player may activate this ability" (CR 602.2: unless the object says otherwise); the activating player controls it (CR 602.2a, below)
  const anyone = def.anyPlayer === true && source.zone === 'battlefield' && supportsForm('feature:activate.anyPlayer');
  // edh-c-103 (CR 602.2): "Only your opponents may activate this ability" (Detention Vortex): an opponent of the controller, never the controller
  const opponentOnly = def.opponentsOnly === true && source.zone === 'battlefield' && supportsForm('feature:activate.opponentsOnly');
  // edh-d-88 (CR 602.2, 506.2; Capricopian): "Only the player this creature is attacking may activate this ability": the PLAYER the source attacks (not a planeswalker's or battle's player), nobody else
  const attackedOnly = def.attackedPlayerOnly === true && source.zone === 'battlefield' && supportsForm('feature:activate.attackedPlayerOnly');
  if (attackedOnly) {
    const att = s.combat?.attackers.find((a) => a.id === source.id);
    if (att === undefined || att.defender !== player) return deny('Only the player this creature is attacking may activate this ability.', 'CR 602.2');
    if (s.players.find((p) => p.id === player)?.hasLost !== false) return deny('Only a player still in the game may activate this ability.', 'CR 602.2');
  } else if (opponentOnly) {
    if (holder === player) return deny('Only the opponents of its controller may activate this ability.', 'CR 602.2');
    if (s.players.find((p) => p.id === player)?.hasLost !== false) return deny('Only a player still in the game may activate this ability.', 'CR 602.2');
  } else if (holder !== player && !anyone) return deny('You can only activate abilities of objects you control.', 'CR 602.2');
  if (source.phasedOut) return deny('That permanent is phased out.', 'CR 702.26b');
  const unread = activatedForms(def).filter((c) => !supportsForm(c)); // fields of the ability this build doesn't read yet: not offered, never played with them ignored
  if (unread.length > 0) return deny(`This engine build can't check part of this ability yet (${unread.join(', ')}), so it is not offered.`, 'CR 602.5', 'CR 602.5b');
  const timing = abilityTiming(s, player, source, info.key, def);
  if (timing) return timing;
  const hook = hookpoints.canActivate(gameOf(s), source.id, info.key, player); // "can't activate" effects (CR 602.5, WP16)
  if (hook) return hook;
  if ((def.cost.tap || def.cost.untap) && isSummoningSickToActivate(s, source, charsOfObject(s, source))) {
    return deny(`${charsOfObject(s, source).name} came under your control this turn, so you can't use its {T} abilities yet (summoning sickness).`, 'CR 302.6', 'CR 602.5a');
  }
  const aenv: AnnounceEnv = { s, player, sourceId: source.id, costsPaid: {}, modeMemory: { key: info.key, triggered: false } }; // r3-choose: ModeSpec.unchosen
  if (def.onlyIf) {
    // The attestation of an `ask` restriction is asked when the ability is activated (CR 602.5b): here every answer is tried, so "not (ask)" is offered and a definite false is not.
    const outcome = activationOutcome({ ...aenv, history: true }, def.onlyIf); // std-blb: the restriction reads the turn's history (CR 602.5b)
    if (outcome.unreadable) return deny("This engine build can't read the restriction of this ability yet, so it is not offered.", 'CR 602.5', 'CR 602.5b');
    if (!outcome.possible) return deny('The condition this ability can be activated under does not hold.', 'CR 602.5b');
  }
  // CR 601.2c, 601.2h: a target filter that reads X needs SOME X the player can pay for to have a target (the bound is what the activation cost allows; an
  // ability with no X to announce has X = 0).
  const cc0 = costChangeOf(s, player, source, def); // T38: CR 601.2f
  if ('denial' in cc0) return cc0.denial;
  const cc = spendOnlyAfter(cc0, s, def, source.id);
  if (programFiltersMentionX(def.effect)) {
    const xs = costHasX(def.cost) ? payableXs((n) => planDenial(s, player, source.id, cc.apply(abilityPlan(s, def, n, source.id))) === null, costFilterHasX(def.cost)) : [0];
    aenv.xMax = xs.length ? xs[xs.length - 1]! : 0;
  }
  // edh-next-132 (CR 107.3c, 602.2b; Prototype Portal, ruling 2011-01-01): an X the text defines must be defined (a card exiled with the source) and payable
  if (def.xIs !== undefined) {
    const dx = definedX(s, def, source.id);
    if (dx === undefined) return deny('The value of X this ability defines is undefined (no card is exiled with it), so it can\'t be paid.', 'CR 107.3c', 'CR 602.2b');
    if (planDenial(s, player, source.id, cc.apply(abilityPlan(s, def, dx, source.id))) !== null) return deny(`You can't pay for that ability with X = ${dx}.`, 'CR 107.3c', 'CR 601.2h');
  }
  // std-rx12 (CR 107.3a, 602.2b): "X can't be 0." (`xMin`): some X at least that must be payable; with no X in the cost it never is
  if (def.xMin !== undefined && def.xMin > 0) {
    const xs = costHasX(def.cost) ? payableXs((n) => planDenial(s, player, source.id, cc.apply(abilityPlan(s, def, n, source.id))) === null, costFilterHasX(def.cost)) : [0];
    if (!xs.some((n) => n >= def.xMin!)) return deny("You can't pay for that ability with any value of X it allows (X can't be 0).", 'CR 107.3a', 'CR 602.2b');
  }
  // edh-next-141 (CR 601.2b, 601.2d, 701.3d): an effect that reads what the unattach cost will unattach is playable when SOME permanent the cost could unattach makes it so (the player
  // chooses it as the ability is announced, chooseUnattachedAhead)
  if (readsCostUnattached(def)) {
    const plan0 = cc.apply(abilityPlan(s, def, 'unannounced', source.id));
    const part = plan0.other.find((p): p is Extract<PlanPart, { kind: 'unattach' }> => p.kind === 'unattach' && p.self !== true);
    const cands = part !== undefined ? pickCandidates(s, player, source.id, plan0, part) : [];
    const noTarget = deny('That ability needs a target but there is no legal one.', 'CR 601.2c', 'CR 602.2b');
    const ok = cands.find((id) => programsDenial(s, [def.effect], player, source.id, noTarget, undefined, { ...aenv, costsPaid: { ...aenv.costsPaid, unattached: [id] } }) === null);
    if (cands.length === 0) return deny("Nothing that ability's cost could unattach is attached, so the cost can't be paid.", 'CR 701.3d', 'CR 118.3');
    if (ok === undefined) return noTarget;
    aenv.costsPaid = { ...aenv.costsPaid, unattached: [ok] };
  }
  const unplayable = programsDenial(s, [def.effect], player, source.id, deny('That ability needs a target but there is no legal one.', 'CR 601.2c', 'CR 602.2b'), undefined, aenv);
  if (unplayable) return unplayable;
  const cost0 = abilityPlan(s, def, 'unannounced', source.id); // before X is announced (CR 601.2b): {X} is 0 and an X in a part's filter is relaxed
  const noModes = modesDenial(s, [def.effect], player, source.id, undefined, aenv, (costs) => planDenial(s, player, source.id, cc.apply(addPlans(cost0, planFromCostDefs(costs, 'unannounced')))) === null); // CR 601.2b, 700.2, 700.2h
  if (noModes) return noModes;
  // std-rx27 (CR 601.2h, 602.2b): "you may tap an untapped creature you control rather than pay that mana" (`tapForMana`) counts toward paying the cost
  if (def.tapForMana !== undefined) return payableWith(s, player, source.id, cc.apply(cost0), [tapForManaOption(def.tapForMana)]);
  return planDenial(s, player, source.id, cc.apply(cost0));
}

/** The cost part of a manual mana ability's text ("{T}, Sacrifice this land" in "{T}, Sacrifice this land: Add ..."). */
function manualManaCost(def: ManualAbilityDef): { tap: boolean; sacrificeSelf: boolean } {
  const cost = def.text.slice(0, Math.max(0, def.text.indexOf(':')));
  return { tap: /\{T\}/.test(cost), sacrificeSelf: /Sacrifice (this |CARDNAME|[A-Z])/.test(cost) };
}

/**
 * May this player activate a mana ability the engine can't run (flagged `mana` on a manual ability)? CR 605.3b.
 * The engine only checks what it can: the controller, zone, "can't activate" effects, and {T} (untapped, not summoning sick).
 * W3b: only on the battlefield, and only when the ability functions there: "Exile this card from your hand: Add {R}." functions in the hand alone
 * (CR 113.6j), so a Simian Spirit Guide on the battlefield offers nothing by hand (the hand path pays only {T} and "Sacrifice ~").
 */
export function manualManaDenial(s: GameState, player: PlayerId, source: GameObject, def: ManualAbilityDef, key: string): Denial | null {
  if (source.zone !== 'battlefield') return deny('Mana abilities of permanents can only be activated while the permanent is on the battlefield.', 'CR 113.6');
  if (def.zone !== undefined && !def.zone.includes('battlefield')) return deny(`That ability functions only in the ${def.zone.join(' or ')}, not on the battlefield.`, 'CR 113.6', 'CR 113.6j');
  if (source.controller !== player) return deny('You can only activate abilities of permanents you control.', 'CR 602.2');
  if (source.phasedOut) return deny('That permanent is phased out.', 'CR 702.26b');
  const hook = hookpoints.canActivate(gameOf(s), source.id, key, player); // CR 602.5, 605.1a: a mana ability is an activated ability
  if (hook) return hook;
  const c = charsOfObject(s, source);
  if (manualManaCost(def).tap) {
    if (source.tapped) return deny(`${c.name} is already tapped.`, 'CR 118.3', 'CR 602.2');
    if (isSummoningSickToActivate(s, source, c)) return deny(`${c.name} came under your control this turn, so you can't use its {T} abilities yet (summoning sickness).`, 'CR 302.6', 'CR 602.5a');
  }
  const cant = manualManaCost(def).sacrificeSelf ? costUseDenial(s, player, source.id, 'sacrifice', undefined, true) : null; // edh-next-18: a cost of activating; WP31: CR 701.21a, 614.17b
  if (cant) return deny(`${c.name} can't be sacrificed, so this mana ability can't be activated. ${cant.message}`, 'CR 701.21a', 'CR 614.17b');
  return null;
}

/**
 * A mana ability the engine does not understand is activated by hand: it pays {T} and "Sacrifice this ..." itself and the
 * player adds the mana (and applies any other effect, like "deals 1 damage to you") with manual operations. Like every
 * mana ability it does not use the stack (CR 605.3b). Cancellable: nothing happens until the player confirms.
 *
 * WP32 review: it is still the activation of a mana ability (CR 605.1b). The mana the player adds to their own pool is added as the ability's mana (source:
 * this permanent, CR 106.3, 107.4h) through `addManaByActivation`, so "whenever a player taps a land for mana" triggers as for an engine-run mana ability and
 * triggered mana abilities resolve at once (CR 605.4a), even when the player added none. The other operations (damage, other players' mana) are applied first.
 */
function activateManualMana(g: Game, player: PlayerId, source: GameObject, def: ManualAbilityDef, key: string): void {
  assertAllowed(manualManaDenial(g.s, player, source, def, key));
  const cost = manualManaCost(def);
  const chars = charsOfObject(g.s, source);
  const name = chars.name;
  const snowSource = chars.supertypes.includes('Snow');
  const sourceId = source.id;
  endTypedActivation(g.s, beginTypedActivation(g.s, player, source)); // edh-next-124 (CR 602.2, 605.1a): a mana ability activated by hand counts too (rules/typed-activations.ts); its cost has no mana
  if (cost.tap) {
    source.tapped = true;
    g.emit({ type: 'tapped', objectId: sourceId });
  }
  if (cost.sacrificeSelf) moveObject(g, sourceId, 'graveyard', { cause: 'sacrifice' });
  g.log(`${g.player(player).name} activates ${name} by hand: ${def.text}`, { rules: ['CR 605.3b'], level: 'manual' });
  const own = (op: ManualOp): op is Extract<ManualOp, { op: 'mana' }> => op.op === 'mana' && op.player === player;
  // MRE: in steps like every manualResolve decision; the other operations apply at each step, the player's own mana is added once at the end as the ability's.
  const ops = chooseManualSteps(g, {
    kind: 'manualResolve',
    player,
    prompt: `Activate ${name} by hand: ${def.text} Its {T} / sacrifice cost is paid; add the mana and apply the rest of the text yourself.`,
    sourceName: name,
    text: def.text,
    cancellable: true,
    rules: ['CR 605.3b', 'CR 605.1a'],
  }, (step) => applyManualOps(g, player, step.filter((op) => !own(op)), sourceId));
  const mine = ops.filter(own);
  const types = mine.flatMap((op) => op.types);
  if (types.length > 0) g.log(`${g.player(player).name} adds ${manaText(types)} with ${name} by hand.`, { rules: ['CR 605.3b', 'CR 106.3'], level: 'manual' });
  // FAST5X E20 (CR 702.177a): an exhaust mana ability run by hand is still an exhaust ability ("Exhaust — {T}: Add ...")
  addManaByActivation(g, player, types, source, snowSource || mine.some((op) => op.snow === true), undefined, /^exhaust\b/i.test(def.text), undefined, undefined, cost.tap); // std-mana-1: `tapped` (CR 106.12)
}

/**
 * FAST5X E3, CR 702.171c: a creature saddles a permanent as it is tapped to pay the cost of that permanent's saddle ability, whether or not the ability
 * resolves; the permanent remembers them for "the creatures that saddled it this turn" (GameObject.saddledBy, cleared in the cleanup step, CR 514.2).
 */
function recordSaddlers(g: Game, sourceId: ObjectId, tapped: Paid['tappedAs'], player: PlayerId): void {
  // Standard round 5, r5-trig (CR 702.122b, 702.171c): each creature tapped for a crew or saddle cost crews / saddles the permanent now ("Whenever ~ crews a Vehicle")
  for (const t of tapped ?? []) for (const id of t.ids) g.emit({ type: 'crewTapped', objectId: sourceId, by: id, as: t.as, player });
  const ids = (tapped ?? []).filter((t) => t.as === 'saddle').flatMap((t) => t.ids);
  const mount = g.maybeObj(sourceId);
  if (ids.length === 0 || !mount || mount.zone !== 'battlefield') return;
  mount.saddledBy = [...(mount.saddledBy ?? []), ...ids.filter((id) => !mount.saddledBy?.includes(id))];
  g.log(`${ids.map((id) => g.nameOf(id)).join(', ')} ${ids.length === 1 ? 'saddles' : 'saddle'} ${g.nameOf(sourceId)}.`, { rules: ['CR 702.171c'], level: 'info' });
}

/**
 * r5-fxb (CR 702.122b-c): a creature crews a Vehicle as it is tapped to pay the cost of that Vehicle's crew ability, whether or not the
 * ability resolves; the Vehicle remembers them for "target creature that crewed it this turn" (GameObject.crewedBy, cleared in the cleanup step, CR 514.2).
 */
function recordCrew(g: Game, sourceId: ObjectId, tapped: Paid['tappedAs']): void {
  const ids = (tapped ?? []).filter((t) => t.as === 'crew').flatMap((t) => t.ids);
  const vehicle = g.maybeObj(sourceId);
  if (ids.length === 0 || !vehicle || vehicle.zone !== 'battlefield') return;
  vehicle.crewedBy = [...(vehicle.crewedBy ?? []), ...ids.filter((id) => !vehicle.crewedBy?.includes(id))];
}

/** The one error for activating an ability of an object the player can't see (M1). */
export const HIDDEN_ACTIVATE = "That ability can't be activated.";

export function activateAbility(g: Game, action: Extract<Action, { type: 'activate' }>): void {
  const { player } = action;
  const source = g.maybeObj(action.source);
  // M1 (audit 2026-10-12; CR 400.2, 401.2): nothing about an object the player can't see is looked up or described. The same error answers every such object
  // whatever card it is, before the ability, its zone or its kind is read, so an action naming another player's hand card or a library card tells nothing;
  // an id that names nothing gets it too, so guessing ids tells nothing either (m4: which ids another player's hand holds).
  if (!source || !canSee(g.s, source, player)) throw new IllegalAction(HIDDEN_ACTIVATE, ['CR 602.2', 'CR 400.2']);
  const info = findAbility(g.s, source.id, action.ability);
  if (!info) throw new IllegalAction('That ability does not exist.', ['CR 602.2']);
  if (info.def.kind === 'manual' && info.def.mana) {
    activateManualMana(g, player, source, info.def, info.key);
    return;
  }
  if (info.def.kind !== 'activated') throw new IllegalAction('That is not an activated ability.', ['CR 602.1']);
  const act = info as ActivatedInfo;
  assertAllowed(activationDenial(g.s, player, source, act));
  const def: ActivatedAbilityDef = act.def;
  const sourceName = charsOfObject(g.s, source).name;
  const sourceZone = source.zone; // edh-players-5 (CR 602.2, 109.2): where the ability is activated from, for the `abilityActivated` event

  if (def.isMana) {
    // CR 605.3b: a mana ability doesn't use the stack; it resolves immediately.
    activateManaAbility(g, player, source.id, act.key, { ask: true });
    return;
  }

  // CR 602.2a: the ability is created on the stack as an object that is not a card.
  const obj = freshObject(g, { kind: 'ability', defId: source.defId, owner: player, controller: player }, 'stack');
  obj.stack = {
    kind: 'activated',
    ...(def.isLoyalty || def.cost.loyalty !== undefined || def.cost.loyaltyX === true ? { loyalty: true as const } : {}), // edhd36 (CR 606.2)
    sourceId: source.id,
    sourceName,
    abilityRef: { source: act.origin, face: act.face, index: act.index, key: act.key },
    // CR 113.7a: an ability that is not printed text of its source (granted, generated by a keyword) exists independently of it: it carries its definition.
    // M6-0 (m6 design E5): a COPIED ability (a copy effect's, key c:...) too: the copy's own definition is not its text (CR 707.2, 113.7a)
    // M6-8 (CR 612, 113.7a): a printed ability whose text a text-changing effect changed is not its card's printed definition: it carries what it says now.
    ...(act.origin === 'granted' || act.origin === 'keyword' || act.origin === 'copied' || !samePrinted(def, printedDef(g.s, source, act)) ? { inline: def } : {}),
    targets: [],
    costsPaid: {},
  };
  g.s.objects[obj.id] = obj;
  g.s.zones.stack.push(obj.id);

  // CR 602.2b = 601.2b-i.
  const what = `${sourceName}'s ability`;
  const aenv: AnnounceEnv = {
    s: g.s, player, sourceId: source.id, costsPaid: {}, modeMemory: { key: act.key, triggered: false }, // r3-choose: the modes it already had chosen (ModeSpec.unchosen)
    // CR 602.5b: the controller attests an activation restriction the engine can't check (`ask`); declining cancels the activation.
    attest: (c) => g.choose({ kind: 'yesNo', player, prompt: `Confirm: ${c.text}`, yesLabel: 'Yes', noLabel: 'No', cancellable: true, rules: ['CR 602.5b'] }).yes,
  };
  if (def.onlyIf) {
    const holds = announceCond({ ...aenv, history: true }, def.onlyIf); // std-blb: the restriction reads the turn's history (CR 602.5b)
    if (holds === undefined) throw new IllegalAction("This engine build can't read the restriction of this ability.", ['CR 602.5', 'CR 602.5b']);
    if (!holds) throw new IllegalAction('The condition this ability can be activated under does not hold.', ['CR 602.5b']);
  }
  // CR 700.2h: the cost of the chosen SET of modes is checked together; each cost is kept as a definition so that it is built again with the announced X (CR 107.3a).
  const cost0 = abilityPlan(g.s, def, 'unannounced', source.id);
  // r4-cost (CR 601.2c, 601.2f): the cost is determined after the targets are announced; a cost change may read them (none yet before announceTargets)
  let announcedTargets: TargetChoice[][] | undefined;
  // edh-next-124 (CR 602.2, 601.2f; Tezzeret, Betrayer of Flesh, ruling 2022-02-18): this activation begins: it may be the first of an artifact's abilities this turn (rules/typed-activations.ts);
  // its cost change is worked out now, so a mana ability activated to pay for it is counted after it
  const typedMarks = beginTypedActivation(g.s, player, source);
  const cc0 = costChangeOf(g.s, player, source, def, () => announcedTargets); // T38: CR 601.2f (the denial was checked above, so the amount is known)
  endTypedActivation(g.s, typedMarks);
  if ('denial' in cc0) throw new IllegalAction(cc0.denial.message, cc0.denial.rules);
  const cc = spendOnlyAfter(cc0, g.s, def, source.id);
  const modes = chooseModes(g, player, [def.effect], source.id, obj.id, what, aenv, (costs: CostDef[]) => planDenial(g.s, player, source.id, cc.apply(addPlans(cost0, planFromCostDefs(costs, 'unannounced')))) === null);
  if (modes) obj.stack.modes = modes;
  const programs = effectivePrograms([def.effect], modes);
  const modeCostDefs = modeCosts([def.effect], modes);
  const planAt = (n: number): CostPlan => cc.apply(addPlans(abilityPlan(g.s, def, n, source.id), planFromCostDefs(modeCostDefs, n)));
  let x = 0;
  const announcedX = costHasX(def.cost) || modeCostDefs.some(costHasX);
  if (announcedX) { // CR 107.3a: X in the mana cost, in "pay X life", "remove X counters", in a part's filter, or in the cost of a chosen mode
    // An X in a part's filter ("Sacrifice an artifact with mana value X") fits only some values: every value up to the cap is tried (rules/cost.ts#payableXs).
    // std-rx12 (CR 107.3a, 602.2b): "X can't be 0." (`xMin`): only values of X at least that
    const xs = payableXs((n) => planDenial(g.s, player, source.id, planAt(n)) === null, costFilterHasX(def.cost) || modeCostDefs.some(costFilterHasX)).filter((n) => n >= (def.xMin ?? 0));
    if (xs.length === 0) throw new IllegalAction(`You can't pay for ${what} with any value of X.`, ['CR 601.2h', 'CR 107.3a']);
    // p2-counters-move-2 (CR 118.3, 107.3a): "Remove all charge counters from ~" is X with no choice: the number of those counters on ~ now
    // edh-next-132 (CR 107.3c): the X the text defines is no choice either
    const defined = def.xIs !== undefined ? definedX(g.s, def, source.id) : undefined;
    if (def.xIs !== undefined && (defined === undefined || !xs.includes(defined))) throw new IllegalAction(`You can't pay for ${what}.`, ['CR 107.3c', 'CR 601.2h']);
    const fixed = defined ?? fixedCounterX(g.s, def, source.id);
    if (fixed !== undefined && !xs.includes(fixed)) throw new IllegalAction(`You can't pay for ${what}.`, ['CR 601.2h', 'CR 118.3']);
    x = fixed ?? chooseX(g, player, xs[xs.length - 1]!, what, xs);
    obj.stack.x = x;
  }
  else if (def.xMin !== undefined && def.xMin > 0) throw new IllegalAction(`${what} has no X to announce, and X can't be 0.`, ['CR 107.3a', 'CR 602.2b']); // std-rx12: fail closed
  aenv.x = x;
  // edh-next-141 (CR 601.2b, 601.2d, 701.3d; Captain America, First Avenger): an effect that reads the permanent the unattach cost will unattach ("damage equal to that Equipment's mana value divided as you
  // choose ...") defines its amount by a choice made later, as the cost is paid: that choice is made now, before targets and division are announced; the cost then unattaches that permanent
  const unattachAhead = readsCostUnattached(def) ? chooseUnattachedAhead(g, player, source.id, planAt(x), what) : undefined;
  if (unattachAhead !== undefined) { aenv.costsPaid = { ...aenv.costsPaid, unattached: [unattachAhead] }; obj.stack.costsPaid.unattached = [unattachAhead]; }
  const announced = announceTargets(g, player, programs, source.id, obj.id, what, aenv);
  obj.stack.targets = announced.targets;
  announcedTargets = announced.targets;
  if (Object.keys(announced.division).length > 0) obj.stack.division = announced.division;
  const total: CostPlan = withUnattachAhead(planAt(x), unattachAhead);
  const changed = def.costChange !== undefined ? cc.log(addPlans(abilityPlan(g.s, def, x, source.id), planFromCostDefs(modeCostDefs, x))) : null;
  if (changed !== null) g.log(`${sourceName}'s ability costs less to activate: ${changed}.`, { rules: ['CR 601.2f', 'CR 118.7'], level: 'info' });
  // std-rx27 (CR 601.2f-h, 602.2b): after the total cost is determined, the permanents the player taps rather than pay mana (`tapForMana`)
  const counted = resolveAnyCounts(g, player, source.id, total, what);
  const optioned = def.tapForMana !== undefined ? applyOptions(g, player, source.id, counted, what, [tapForManaOption(def.tapForMana)]) : counted;
  const paid = payPlan(g, player, source.id, optioned, what, { announcedX });
  obj.stack.costsPaid.manaSpent = paid.manaSpent;
  if (paid.lifePaid) obj.stack.costsPaid.lifePaid = paid.lifePaid;
  if (paid.rolled !== undefined) obj.stack.costsPaid.rolled = paid.rolled; // edh-d-49 (CR 706.2, 602.2b): Clay Golem's "Roll a d8: Monstrosity X, where X is the result"
  if (paid.costObjects.length) obj.stack.costsPaid.costObjects = paid.costObjects;
  if (paid.sacrificed?.length) obj.stack.costsPaid.sacrificed = paid.sacrificed; // FAST3 T18: "the sacrificed creature" (CR 608.2h)
  if (paid.tapped?.length) obj.stack.costsPaid.tapped = paid.tapped; // T35: "the tapped creature" (station, CR 702.184a)
  if (paid.unattached?.length) obj.stack.costsPaid.unattached = paid.unattached; // edh-next-141: "that Equipment" a cost unattached (CR 701.3d)
  if (paid.exiled) obj.stack.costsPaid.exiled = paid.exiled; // FAST5X E13: craft returns the exiled source; its materials (CR 702.167a, 702.167c)
  if (paid.discarded?.length) obj.stack.costsPaid.discarded = paid.discarded; // CLOUD C8: "the discarded card" (CR 602.2b, 400.7j)
  if (paid.returned?.length) obj.stack.costsPaid.returned = paid.returned; // std-typechange-1: ninjutsu's returned attacker (CR 702.49c, 608.2h)
  // std-rx27 (CR 607.2a, 400.7): the cards the cost exiled for a link (collect evidence: "cards exiled with it") are added to what the source remembers, while it is
  // still the same object (CR 400.7)
  for (const [link, handles] of Object.entries(paid.costLinks ?? {})) {
    const prev = readLink(g.s.objects[source.id], link);
    const before = prev?.objects ?? [];
    const live = g.maybeObj(source.id);
    if (live && live.zone === source.zone) setLink(live, link, { ...prev, objects: [...before, ...handles.filter((h) => !before.some((b) => b.id === h.id))] });
  }
  recordSaddlers(g, source.id, paid.tappedAs, player);
  recordCrew(g, source.id, paid.tappedAs); // r5-fxb (CR 702.122)
  // edh-d-89 (CR 702.122c, 702.122e): the creatures this activation was crewed by, for its own "becomes crewed" event (not every crewer of the turn)
  const crewers = (paid.tappedAs ?? []).filter((t) => t.as === 'crew').flatMap((t) => t.ids);
  if (crewers.length > 0) obj.stack.costsPaid.crewers = crewers;

  // CR 602.5b / 606.3: remember the activation for "once each turn" and loyalty abilities.
  const k = `${source.id}|${act.key}`;
  g.s.turnActivations[k] = (g.s.turnActivations[k] ?? 0) + 1;
  if (def.isLoyalty || def.cost.loyalty !== undefined) g.s.turnActivations[`${source.id}|loyalty`] = (g.s.turnActivations[`${source.id}|loyalty`] ?? 0) + 1; // edh-players-6: a count (CR 606.3 allows one each turn unless a rule allows more)
  // std-rx27 (CR 602.2b): an ability with a wrapper keyword ("equip") activated by the player this turn: "the first equip ability you activate each turn"
  const kw = def.keyword ?? (def.prov?.by === 'keyword' ? def.prov.id : undefined);
  if (kw !== undefined) g.s.turnActivations[`kw:${player}:${kw}`] = (g.s.turnActivations[`kw:${player}:${kw}`] ?? 0) + 1;
  // "Activate only once" (exhaust, CR 602.5b): counted on the object, so a new object (CR 400.7) has its use back.
  const live = g.maybeObj(source.id);
  if (def.limit?.per === 'game' && live) live.chosen = { ...(live.chosen ?? {}), [`limit:${act.key}`]: (Number(live.chosen?.[`limit:${act.key}`] ?? 0) || 0) + 1 };

  // FAST5X E20: what kind of ability was activated: an exhaust ability (CR 702.177a) or a loyalty ability (CR 606.3)
  // Standard round 3, r3-trig (CR 606.4): the loyalty counters the cost removed ("if you removed two or more loyalty counters to activate it"), after X and cost changes
  const loyaltyRemoved = total.loyalty !== undefined && total.loyalty < 0 ? -total.loyalty : undefined;
  g.emit({ type: 'abilityActivated', objectId: obj.id, sourceId: source.id, player, ...(def.keyword === 'exhaust' ? { exhaust: true as const } : {}), ...(kw === 'ninjutsu' ? { ninjutsu: true as const } : {}), ...(kw === 'boast' ? { boast: true as const } : {}) /* edh-c-104: CR 702.142a */, /* edh-zones-19: CR 702.49a */ ...(def.isLoyalty || def.cost.loyalty !== undefined ? { loyalty: true as const } : {}), ...(loyaltyRemoved !== undefined ? { loyaltyRemoved } : {}), ...(paid.lifePaid ? { lifePaid: paid.lifePaid } : {}), ...(paid.manaSpent.length > 0 ? { manaSpent: paid.manaSpent.length } : {}) /* edh-d-50 (CR 602.2b, 106.3) */, ...(countX(def.cost.mana) > 0 || modeCostDefs.some((c) => countX(c.mana) > 0) ? { xInCost: true as const } : {}) /* edh-next-74: the mana symbol {X} only, not "pay X life" or loyalty -X (CR 107.3a, 602.2b; Unbound Flourishing ruling 2019-06-14) */, fromZone: sourceZone });
  // FAST5 T37 (CR 702.29a, 702.29d-e, 701.9): activating a cycling or typecycling ability is cycling the card: "when you cycle ~" / "whenever you cycle a card"
  // trigger as the cost (the discard) is paid. The subject is the card as it is now, in the graveyard (it may be elsewhere if a replacement moved it: then the
  // event names that object).
  const cycled = def.prov?.by === 'keyword' && def.prov.id === 'cycling' ? paid.costObjects.find((id) => g.maybeObj(id)?.cardId !== undefined && g.maybeObj(id)!.cardId === source.cardId) : undefined;
  // CLOUD std-dft (CR 107.3a): the X announced for a cycling cost with X ("Cycling {X}{G}{G}") goes with the event: "when you cycle ~, ... X" reads it
  if (cycled !== undefined) g.emit({ type: 'actionPerformed', verb: 'cycle', actor: player, objectId: cycled, ...(announcedX ? { x } : {}) });
  manaSpentTriggers(g, obj.id, player, paid.manaSpent, 'ability'); // edh-cast-15: "When you spend this mana to cast a spell or activate an ability" (CR 106.6, 603.2)
  emitBecameTarget(g, obj.id, player, obj.stack.targets);
  emitCrime(g, obj.id, player, obj.stack.targets); // FAST5X E20: CR 700.13
  g.log(`${g.player(player).name} activates ${sourceName}: ${def.text}${x > 0 ? ` (X = ${x})` : ''}${describeTargets(g, obj.stack.targets)}`, { rules: ['CR 602.2'], level: 'action' });
}

/** edh-next-141: the effect reads what the ability's unattach cost unattached (ObjRef costUnattached). */
function readsCostUnattached(def: ActivatedAbilityDef): boolean {
  return JSON.stringify(def.effect).includes('"ref":"costUnattached"') && (def.cost.other ?? []).some((p) => p.kind === 'unattach' && p.self !== true);
}

/**
 * edh-next-141 (CR 601.2b, 701.3d, 118.3): the permanent the plan's one unattach part (of another permanent than the source) will unattach, chosen by the player now; none attached refuses the
 * activation (the cost can't be paid, CR 601.2h). Cancellable (CR 733.1).
 */
function chooseUnattachedAhead(g: Game, player: PlayerId, sourceId: ObjectId, plan: CostPlan, label: string): ObjectId {
  const parts = plan.other.filter((p): p is Extract<PlanPart, { kind: 'unattach' }> => p.kind === 'unattach' && p.self !== true);
  if (parts.length !== 1) throw new IllegalAction(`This engine build can't announce ${label}.`, ['CR 601.2b']);
  const options = pickCandidates(g.s, player, sourceId, plan, parts[0]!);
  if (options.length === 0) throw new IllegalAction(`You can't pay the unattach cost of ${label}.`, ['CR 701.3d', 'CR 118.3']);
  if (options.length === 1) return options[0]!;
  return g.choose({ kind: 'chooseObjects', player, prompt: `Choose the permanent to unattach to pay for ${label}.`, options, min: 1, max: 1, cancellable: true, rules: ['CR 601.2b', 'CR 701.3d'] }).ids[0]!;
}

/** edh-next-141: the plan's unattach part takes only the permanent chosen as the ability was announced. */
function withUnattachAhead(plan: CostPlan, id: ObjectId | undefined): CostPlan {
  return id === undefined ? plan : { ...plan, other: plan.other.map((p) => (p.kind === 'unattach' && p.self !== true ? { ...p, chosen: [id] } : p)) };
}

/**
 * p2-counters-move-2 (CR 118.3, 107.3a, 602.2b; cites unverified): the X of a cost "Remove all <kind> counters from ~" (CostPart `all`), which nobody chooses: the
 * number of counters of that kind on the source as the ability is announced (none is a legal number: removing all of none removes nothing). Undefined for a cost
 * without such a part. A cost with any other X beside it (an {X} or another X part) is refused: its X could not be both.
 */
/**
 * edh-next-132 (CR 107.3c, 607.2a, 202.3; Prototype Portal, Soul Foundry): the X of the activation cost the ability's text defines (`xIs`): the mana value of the one card linked to the source
 * that is still in exile (an {X} in that card's mana cost is 0 there, CR 107.3g), or undefined when there is no such card (ruling 2011-01-01: the ability can't be activated).
 */
export function definedX(s: GameState, def: ActivatedAbilityDef, sourceId: ObjectId): number | undefined {
  const q = def.xIs;
  if (q === undefined) return undefined;
  const here = (readLink(s.objects[sourceId], q.of.link)?.objects ?? []).filter((h) => h.zone === 'exile' && s.objects[h.id]?.zone === 'exile');
  if (here.length !== 1) return undefined;
  return groupStat(s, { kind: 'object', id: here[0]!.id }, 'manaValue');
}

export function fixedCounterX(s: GameState, def: ActivatedAbilityDef, sourceId: ObjectId): number | undefined {
  const parts = (def.cost.other ?? []).filter((p) => p.kind === 'removeCounters' && p.all === true);
  if (parts.length === 0) return undefined;
  const p = parts[0]!;
  const others = (def.cost.other ?? []).filter((q) => q !== p && JSON.stringify(q).includes('"q":"X"'));
  if (parts.length > 1 || p.kind !== 'removeCounters' || p.self !== true || others.length > 0 || (def.cost.mana ?? []).some((m) => m.kind === 'variable') || def.cost.loyaltyX === true) {
    throw new IllegalAction('This engine build cannot pay "remove all counters" beside another X.', ['CR 107.3a', 'CR 118.3']);
  }
  return s.objects[sourceId]?.counters?.[p.counter] ?? 0;
}
