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
import { enteredThisTurn, happenedCountOf } from '../rules/history';
import type { ObjectId } from '../types/ids';
import { IllegalAction, type Game } from '../core/game';
import { canSee } from '../core/view';
import { applyManualOps, chooseManualSteps } from '../core/manual';
import { freshObject, moveObject } from '../core/zones';
import { activationZones, findAbility, type ActivatedInfo } from '../rules/abilities';
import { charsOfObject } from '../rules/characteristics';
import { addPlans, costFilterHasX, costHasX, payableXs, planDenial, planFromCostDef, planFromCostDefs, type CostPlan, type CostX } from '../rules/cost';
import { programFiltersMentionX } from '../rules/targets';
import { deny, assertAllowed, type Denial } from '../rules/denial';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { activateManaAbility, addManaByActivation, installManaRestrictionReader, manaAbilityDenial, manaText } from '../rules/mana';
import { costUseDenial } from '../rules/cant';
import { abilityCostModsFor, modifyMana, type CostModHit } from '../statics/costmods';
import { charsViewOf } from '../statics/rule-sources';
import { staticAnyColorForAbility } from '../statics/play-permits';
import { evalCondition } from '../statics/match';
import { payPlan, resolveAnyCounts, type Paid } from '../rules/pay';
import { applyOptions, payableWith, tapForManaOption } from '../rules/payment-options';
import { emitCrime } from '../rules/crime';
import { activatedForms } from '../model/forms';
import { abilityTiming, isSummoningSickToActivate, splitSecondDenial } from '../rules/timing';
import { readLink, setLink } from '../statics/links';
import { activationOutcome, announceCond, type AnnounceEnv } from './announce-cond';
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
  const keyword = def.prov?.by === 'keyword' && typeof def.prov.id === 'string' ? def.prov.id : undefined;
  // std-rx32 (CR 609.4b): "you may spend mana as though it were mana of any color to activate abilities of creatures you control" (its controller activates it, CR 602.2)
  const controller = s.objects[source]?.controller;
  const anyColor = controller !== undefined && staticAnyColorForAbility(s, controller, source);
  const plan: CostPlan = { ...planFromCostDef(def.cost, x), spend: { kind: 'ability', id: source, ...(keyword !== undefined ? { keyword } : {}), ...(anyColor ? { anyColor: true as const } : {}) } };
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
  // FAST5X E27 (CR 601.2b, 601.2f): a choice between costs is made before the total cost is locked in; this build applies the cost change to the plan before the
  // choice is resolved, so such an ability is not offered rather than charged a wrong amount (merged with T60: any cost change, its own or another object's)
  if (JSON.stringify(def.cost).includes('"oneOf"')) return { denial: deny("This engine build can't apply this ability's cost change to a choice between costs, so it is not offered.", 'CR 601.2f', 'CR 602.2b') };
  // r4-cost (CR 601.2f, 602.2b): a cost change of its own that applies only while its condition holds ("during your turn"), read as the cost is determined
  const ownApplies = change !== undefined && (def.costChangeIf === undefined || evalCondition({ s, all: charsViewOf(s), source: source.id, controller: player }, def.costChangeIf));
  const own: CostModHit[] = !ownApplies ? [] : [{
    def: { s: 'costMod', applies: { abilities: {}, caster: 'you' }, change },
    source: source.id, controller: player, name: charsOfObject(s, source).name, text: def.text,
    cx: { s, all: charsViewOf(s), source: source.id, controller: player }, targets: announced,
  }];
  const hits = [...own, ...outside];
  // FAST5 T63 INTERFACE CHANGE (additive; CR 601.2f, 602.2b): the history count of "if you attacked with a Spacecraft this turn" (`happenedCount`, evaluated here because statics may not read
  // rules/history.ts, design 5.4), as actions/cast.ts#modifiedPlan supplies it for a spell's cost modifiers
  const history = (q: Quantity, h: CostModHit): number | undefined =>
    typeof q !== 'number' && q.q === 'happenedCount' ? happenedCountOf(s, q, { you: h.controller, ...(h.source !== null ? { sourceId: h.source } : {}) }) : undefined;
  const run = (plan: CostPlan) => modifyMana(plan.mana, hits, history);
  if ('unknown' in run({ mana: [], tap: false, untap: false, other: [] })) {
    return { denial: deny(`The engine can't work out the cost change of this ability ("${def.text}"), so its total cost is unknown.`, 'CR 601.2f', 'CR 602.2b') };
  }
  return {
    apply: (plan) => {
      const r = run(plan);
      return 'unknown' in r ? plan : { ...plan, mana: r.mana };
    },
    log: (plan) => {
      const r = run(plan);
      return 'unknown' in r || r.applied.length === 0 ? null : r.applied.join('; ');
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
  if (holder !== player && !anyone) return deny('You can only activate abilities of objects you control.', 'CR 602.2');
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
  const cc = costChangeOf(s, player, source, def); // T38: CR 601.2f
  if ('denial' in cc) return cc.denial;
  if (programFiltersMentionX(def.effect)) {
    const xs = costHasX(def.cost) ? payableXs((n) => planDenial(s, player, source.id, cc.apply(abilityPlan(s, def, n, source.id))) === null, costFilterHasX(def.cost)) : [0];
    aenv.xMax = xs.length ? xs[xs.length - 1]! : 0;
  }
  // std-rx12 (CR 107.3a, 602.2b): "X can't be 0." (`xMin`): some X at least that must be payable; with no X in the cost it never is
  if (def.xMin !== undefined && def.xMin > 0) {
    const xs = costHasX(def.cost) ? payableXs((n) => planDenial(s, player, source.id, cc.apply(abilityPlan(s, def, n, source.id))) === null, costFilterHasX(def.cost)) : [0];
    if (!xs.some((n) => n >= def.xMin!)) return deny("You can't pay for that ability with any value of X it allows (X can't be 0).", 'CR 107.3a', 'CR 602.2b');
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
  const cant = manualManaCost(def).sacrificeSelf ? costUseDenial(s, player, source.id, 'sacrifice') : null; // WP31: CR 701.21a, 614.17b
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

  if (def.isMana) {
    // CR 605.3b: a mana ability doesn't use the stack; it resolves immediately.
    activateManaAbility(g, player, source.id, act.key, { ask: true });
    return;
  }

  // CR 602.2a: the ability is created on the stack as an object that is not a card.
  const obj = freshObject(g, { kind: 'ability', defId: source.defId, owner: player, controller: player }, 'stack');
  obj.stack = {
    kind: 'activated',
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
  const cc = costChangeOf(g.s, player, source, def, () => announcedTargets); // T38: CR 601.2f (the denial was checked above, so the amount is known)
  if ('denial' in cc) throw new IllegalAction(cc.denial.message, cc.denial.rules);
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
    const fixed = fixedCounterX(g.s, def, source.id);
    if (fixed !== undefined && !xs.includes(fixed)) throw new IllegalAction(`You can't pay for ${what}.`, ['CR 601.2h', 'CR 118.3']);
    x = fixed ?? chooseX(g, player, xs[xs.length - 1]!, what, xs);
    obj.stack.x = x;
  }
  else if (def.xMin !== undefined && def.xMin > 0) throw new IllegalAction(`${what} has no X to announce, and X can't be 0.`, ['CR 107.3a', 'CR 602.2b']); // std-rx12: fail closed
  aenv.x = x;
  const announced = announceTargets(g, player, programs, source.id, obj.id, what, aenv);
  obj.stack.targets = announced.targets;
  announcedTargets = announced.targets;
  if (Object.keys(announced.division).length > 0) obj.stack.division = announced.division;
  const total: CostPlan = planAt(x);
  const changed = def.costChange !== undefined ? cc.log(addPlans(abilityPlan(g.s, def, x, source.id), planFromCostDefs(modeCostDefs, x))) : null;
  if (changed !== null) g.log(`${sourceName}'s ability costs less to activate: ${changed}.`, { rules: ['CR 601.2f', 'CR 118.7'], level: 'info' });
  // std-rx27 (CR 601.2f-h, 602.2b): after the total cost is determined, the permanents the player taps rather than pay mana (`tapForMana`)
  const counted = resolveAnyCounts(g, player, source.id, total, what);
  const optioned = def.tapForMana !== undefined ? applyOptions(g, player, source.id, counted, what, [tapForManaOption(def.tapForMana)]) : counted;
  const paid = payPlan(g, player, source.id, optioned, what, { announcedX });
  obj.stack.costsPaid.manaSpent = paid.manaSpent;
  if (paid.lifePaid) obj.stack.costsPaid.lifePaid = paid.lifePaid;
  if (paid.costObjects.length) obj.stack.costsPaid.costObjects = paid.costObjects;
  if (paid.sacrificed?.length) obj.stack.costsPaid.sacrificed = paid.sacrificed; // FAST3 T18: "the sacrificed creature" (CR 608.2h)
  if (paid.tapped?.length) obj.stack.costsPaid.tapped = paid.tapped; // T35: "the tapped creature" (station, CR 702.184a)
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

  // CR 602.5b / 606.3: remember the activation for "once each turn" and loyalty abilities.
  const k = `${source.id}|${act.key}`;
  g.s.turnActivations[k] = (g.s.turnActivations[k] ?? 0) + 1;
  if (def.isLoyalty || def.cost.loyalty !== undefined) g.s.turnActivations[`${source.id}|loyalty`] = 1;
  // std-rx27 (CR 602.2b): an ability with a wrapper keyword ("equip") activated by the player this turn: "the first equip ability you activate each turn"
  const kw = def.keyword ?? (def.prov?.by === 'keyword' ? def.prov.id : undefined);
  if (kw !== undefined) g.s.turnActivations[`kw:${player}:${kw}`] = (g.s.turnActivations[`kw:${player}:${kw}`] ?? 0) + 1;
  // "Activate only once" (exhaust, CR 602.5b): counted on the object, so a new object (CR 400.7) has its use back.
  const live = g.maybeObj(source.id);
  if (def.limit?.per === 'game' && live) live.chosen = { ...(live.chosen ?? {}), [`limit:${act.key}`]: (Number(live.chosen?.[`limit:${act.key}`] ?? 0) || 0) + 1 };

  // FAST5X E20: what kind of ability was activated: an exhaust ability (CR 702.177a) or a loyalty ability (CR 606.3)
  // Standard round 3, r3-trig (CR 606.4): the loyalty counters the cost removed ("if you removed two or more loyalty counters to activate it"), after X and cost changes
  const loyaltyRemoved = total.loyalty !== undefined && total.loyalty < 0 ? -total.loyalty : undefined;
  g.emit({ type: 'abilityActivated', objectId: obj.id, sourceId: source.id, player, ...(def.keyword === 'exhaust' ? { exhaust: true as const } : {}), ...(def.isLoyalty || def.cost.loyalty !== undefined ? { loyalty: true as const } : {}), ...(loyaltyRemoved !== undefined ? { loyaltyRemoved } : {}) });
  // FAST5 T37 (CR 702.29a, 702.29d-e, 701.9): activating a cycling or typecycling ability is cycling the card: "when you cycle ~" / "whenever you cycle a card"
  // trigger as the cost (the discard) is paid. The subject is the card as it is now, in the graveyard (it may be elsewhere if a replacement moved it: then the
  // event names that object).
  const cycled = def.prov?.by === 'keyword' && def.prov.id === 'cycling' ? paid.costObjects.find((id) => g.maybeObj(id)?.cardId !== undefined && g.maybeObj(id)!.cardId === source.cardId) : undefined;
  // CLOUD std-dft (CR 107.3a): the X announced for a cycling cost with X ("Cycling {X}{G}{G}") goes with the event: "when you cycle ~, ... X" reads it
  if (cycled !== undefined) g.emit({ type: 'actionPerformed', verb: 'cycle', actor: player, objectId: cycled, ...(announcedX ? { x } : {}) });
  emitBecameTarget(g, obj.id, player, obj.stack.targets);
  emitCrime(g, obj.id, player, obj.stack.targets); // FAST5X E20: CR 700.13
  g.log(`${g.player(player).name} activates ${sourceName}: ${def.text}${x > 0 ? ` (X = ${x})` : ''}${describeTargets(g, obj.stack.targets)}`, { rules: ['CR 602.2'], level: 'action' });
}

/**
 * p2-counters-move-2 (CR 118.3, 107.3a, 602.2b; cites unverified): the X of a cost "Remove all <kind> counters from ~" (CostPart `all`), which nobody chooses: the
 * number of counters of that kind on the source as the ability is announced (none is a legal number: removing all of none removes nothing). Undefined for a cost
 * without such a part. A cost with any other X beside it (an {X} or another X part) is refused: its X could not be both.
 */
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
