/**
 * Paying costs (CR 601.2g-h, 602.2b, 118). The order is the one the rules give: mana abilities are activated BEFORE the costs
 * are paid, so a permanent can be tapped for mana and THEN sacrificed or returned as part of the same cost.
 *   1. the tap costs: {T} of the source and "tap an untapped creature you control" (those permanents can't make mana any
 *      more, so they are chosen and tapped first);
 *   2. mana abilities are activated and the mana is paid through one cancellable `payCost` decision (CR 601.2g-h);
 *   3. the remaining parts, in order: loyalty counters, life, counters, sacrifice, discard, exile, return to hand.
 * Whenever a part makes the player choose objects, only objects that leave a way to pay the rest are offered
 * (rules/cost-pick.ts), so a listed action never dead-ends. Cancelling reverses the whole action (CR 733.1), including every
 * payment, because the engine re-runs the action from the settled state.
 *
 * Mana payment = (1) activate mana abilities (automatically from the solver's plan, or the ones the
 * player listed), which fills the pool (CR 605.3b), then (2) match the pool against the cost symbols
 * with the same solver, remove the matched units and pay life for Phyrexian symbols paid with life.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { ManaSymbol, ManaType } from '../types/mana';
import type { BeheldSnapshot, GameObject, GameState, ManaUnit, ObjHandle } from '../types/state';
import type { ActivatedInfo } from './abilities';
import { abilityCostModsFor, abilityManaCost } from '../statics/costmods';
import type { PayCostDecision } from '../types/decisions';
import { IllegalAction, type Game } from '../core/game';
import { assertAllowed } from './denial';
import { canonicalManaSymbols, costText, hasOneOf, hasWaterbend, manaCostText, oneOfPlans, partText, partsDenial, planDenial, planFromCostDef, WATERBEND_TAPS, waterbendCap, waterbendWith, type CostPlan, type PlanPart } from './cost';
import { findAssignment, isExactPart, isPickPart, isRandomPart, isSelfPart, isThresholdPart, pickCandidates, pickCount, pickOptions, thresholdOf, valueOf, type PickPart } from './cost-pick';
import { payPart, putCostCounters } from './pay-parts';
import { cantDo } from './cant';
import { stunInsteadOfUntap } from './status';
import { lifeBudget, payLife } from './life';
import { activateManaAbility, installManaCostRules } from './mana';
import { payWithOf, solveWithConverters, type ConverterPlan } from './convert';
import { hasOnlyOneWayToPay } from './pay-ways';
import { isPhyrexian, solve, solveBest } from './solver';
import { buildProviders, extraManaModes, manaSources, spendAllows, spendOptions, type Provider, type SpendContext } from './sources';

export interface Paid {
  manaSpent: ManaUnit[];
  lifePaid: number;
  /** New objects created by cost payments (the sacrificed card in the graveyard, ...). */
  costObjects: ObjectId[];
  /** FAST3 T18: the permanents sacrificed for a `sacrifice` part, by their battlefield ids (CostsPaid.sacrificed: last known information, CR 608.2h). */
  sacrificed?: ObjectId[];
  /** FAST5X E7: the permanents returned to hand for a `returnToHand` part, by their battlefield ids (CostsPaid.returned, CR 608.2h, 702.190b). */
  returned?: ObjectId[];
  /** T35: the permanents tapped for a `tapUntapped` part (CostsPaid.tapped: "the tapped creature's power", station CR 702.184a). */
  tapped?: ObjectId[];
  /**
   * FAST5X E3 INTERFACE CHANGE (additive): the creatures tapped for a crew or saddle cost (a `tapPower` part with `as`), by their battlefield ids: they crewed
   * or saddled the source as they were tapped (CR 702.122b, 702.171c). Absent when there is none.
   */
  tappedAs?: { as: 'crew' | 'saddle'; ids: ObjectId[] }[];
  /**
   * std-rq INTERFACE CHANGE (additive): the creatures tapped for a `tapPower` part without `as` (teamwork's "tap any number of creatures you control with total
   * power N or more", CR 702.194a), by their battlefield ids. Absent when there is none.
   */
  tappedPower?: ObjectId[];
  /** FAST5X E11 (CR 701.4b): what was beheld, as it was then (CostsPaid.beheld). */
  beheld?: BeheldSnapshot[];
  /** std-costs-2 (CR 601.2b): the objects a `chooseObject` part chose, where they were then (CostsPaid.chosenObjects). */
  chosenObjects?: ObjHandle[];
  /** p2-refs-1 (CR 601.2b, 701.20a): the cards a `reveal` part of cards other than ~ revealed, where they were then (CostsPaid.revealed). */
  revealed?: ObjHandle[];
  /** FAST5X E11 (CR 607.2q): the objects a `behold ... and exile it` part exiled, by the part's link (CostsPaid.costLinks). */
  costLinks?: Record<string, ObjHandle[]>;
  /**
   * FAST5X E13 INTERFACE CHANGE (additive): the cards exiled for an `exileFrom` part, by the ids they have IN EXILE (CR 400.7j): `self` is the card the source
   * became ("Exile this permanent": craft returns it, CR 702.167a), `others` the other cards (craft's materials, "the exiled cards used to craft it",
   * CR 702.167c). Absent when nothing was exiled or the exiled object ceased to exist (a token, CR 111.7).
   */
  exiled?: { self?: ObjectId; others: ObjectId[] };
  /** CLOUD C8: the cards discarded for a `discard` part, as handles of the cards they became (CostsPaid.discarded: "the discarded card", CR 400.7j, 608.2h). */
  discarded?: ObjHandle[];
}

/**
 * CR 601.2b: the count of an "any number of" cost part is announced with the other variable parts of the cost. Asks one cancellable number per such part, at most
 * the number of objects that still leave the whole cost payable, and returns the plan with the counts fixed.
 */
export function resolveAnyCounts(g: Game, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, label: string): CostPlan {
  let current = resolveWaterbend(g, player, sourceId, resolveOneOf(g, player, sourceId, plan, label), label); // FAST5X E27: the cost chosen first (CR 601.2b); FAST5X E10: which artifacts and creatures pay for a waterbend cost (CR 701.67a)
  for (let i = 0; i < current.other.length; i++) {
    const part = current.other[i]!;
    if (!('any' in part) || !part.any) continue;
    const pick = part as PickPart;
    // FAST5X E13: "N or more" (craft, CR 702.167a) announces at least N
    const min = pick.kind === 'exileFrom' || pick.kind === 'sacrifice' ? pick.atLeast ?? 0 : 0; // std-mana-1: and "sacrifice one or more"
    let max = pickCandidates(g.s, player, sourceId, current, pick).length;
    const withCount = (n: number): CostPlan => ({ ...current, other: current.other.map((p, j) => (j === i ? ({ ...pick, count: n } as PlanPart) : p)) });
    while (max > min && !findAssignment(g.s, player, sourceId, withCount(max), [], true)) max--;
    if (max < min || (min > 0 && !findAssignment(g.s, player, sourceId, withCount(min), [], true))) throw new IllegalAction(`You can't pay "${partText(part)}" for ${label}.`, ['CR 601.2b', 'CR 118.3']);
    const n = max === min ? min : g.choose({ kind: 'chooseNumber', player, prompt: `How many for "${partText(part)}" (cost of ${label})?`, min, max, cancellable: true, rules: ['CR 601.2b', 'CR 107.3a'] }).n;
    const fixed = { ...pick, count: n } as PickPart & { any?: boolean };
    delete fixed.any;
    current = { ...current, other: current.other.map((p, j) => (j === i ? (fixed as PlanPart) : p)) };
  }
  return current;
}

/**
 * FAST5X E27, CR 601.2b, 602.2b, 118.12a: a choice between costs ("Pay {3} or discard a card"): the player chooses one of the costs they can pay, as the cost is
 * announced (a cost only one option of which can be paid is that option, without asking: there is nothing to choose). Cancellable while activating (CR 733.1);
 * the `pay` op's game makes it non-cancellable during a resolution. Returns the plan with the chosen option in place of the choice; plans without one as they are.
 */
export function resolveOneOf(g: Game, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, label: string): CostPlan {
  let current = plan;
  for (let guard = 0; guard < 8 && hasOneOf(current); guard++) {
    const part = current.other.find((p) => p.kind === 'oneOf') as Extract<PlanPart, { kind: 'oneOf' }>;
    const options = oneOfPlans(current);
    const fits = options.map((o) => planDenial(g.s, player, sourceId, o) === null);
    const payable = fits.filter(Boolean).length;
    if (payable === 0) throw new IllegalAction(`None of the costs of ${label} (${partText(part)}) can be paid.`, ['CR 118.3', 'CR 601.2b']);
    let k: number;
    if (payable === 1) {
      k = fits.indexOf(true);
      g.log(`${g.player(player).name} pays the only cost of ${label} that can be paid: ${costText(part.options[k]!)}.`, { rules: ['CR 601.2b', 'CR 118.3'], level: 'info' });
    } else {
      const ids = g.choose({
        kind: 'chooseOption', player, prompt: `Choose the cost to pay for ${label}.`, min: 1, max: 1, cancellable: true, rules: ['CR 601.2b', 'CR 118.3'],
        options: part.options.map((o, j) => ({ id: String(j), label: costText(o), ...(fits[j] ? {} : { disabled: "You can't pay this cost." }) })),
      }).ids;
      k = ids.length === 1 ? Number(ids[0]) : -1;
      if (!Number.isInteger(k) || k < 0 || k >= options.length || !fits[k]) throw new IllegalAction(`Choose one of the costs of ${label} that can be paid.`, ['CR 601.2b', 'CR 118.3']);
      g.log(`${g.player(player).name} chooses to pay ${costText(part.options[k]!)} for ${label}.`, { rules: ['CR 601.2b'], level: 'info' });
    }
    current = options[k]!;
  }
  if (hasOneOf(current)) throw new IllegalAction(`The costs of ${label} can't be worked out.`, ['CR 601.2b']);
  return current;
}

/**
 * FAST5X E10, CR 701.67a-b, 601.2h: "waterbend {N}": for each generic mana in that cost the player may tap an untapped artifact or creature they control rather
 * than pay that mana. The player names the objects (up to N, and no more than the generic mana left in the total cost: 701.67b, a cost reduction may have
 * removed some); at least as many as the rest of the cost needs to stay payable. A permanent tapped for the {T} of the same cost can't be named (it is tapped
 * first, CR 602.2b; rules/cost-pick.ts#pickCandidates), nor an object another part of the cost already uses. The plan returned has no waterbend part: the named
 * objects are a chosen tap part, paid with the other tap costs, and the mana is reduced by as much. Cancellable (CR 733.1). Plans without one are returned as is.
 */
export function resolveWaterbend(g: Game, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, label: string): CostPlan {
  if (!hasWaterbend(plan)) return plan;
  const taken = new Set(plan.other.flatMap((p) => ('chosen' in p && p.chosen ? p.chosen : [])));
  const options = pickCandidates(g.s, player, sourceId, plan, { kind: 'tapUntapped', filter: WATERBEND_TAPS, count: 1 }).filter((id) => !taken.has(id));
  const max = Math.min(waterbendCap(plan), options.length);
  // the fewest taps that leave the rest of the cost payable (any objects: which ones is checked once they are named)
  let min = 0;
  while (min <= max && planDenial(g.s, player, sourceId, waterbendWith(plan, min)) !== null) min++;
  if (min > max) throw new IllegalAction(`You can't pay the waterbend cost of ${label}.`, ['CR 701.67a', 'CR 118.3']);
  const ids = max === 0 ? [] : min === options.length ? [...options] : g.choose({
    kind: 'chooseObjects', player, options, min, max, cancellable: true, rules: ['CR 701.67a', 'CR 601.2h'],
    prompt: `Waterbend: tap up to ${max} untapped artifact${max === 1 ? '' : 's'} and/or creature${max === 1 ? '' : 's'} you control to pay for {1} each of ${label}${min > 0 ? ` (at least ${min})` : ''}? (none to pay it all with mana)`,
  }).ids;
  if (ids.length < min || ids.length > max || ids.some((id) => !options.includes(id)) || new Set(ids).size !== ids.length) {
    throw new IllegalAction(`Choose from ${min} to ${max} of the untapped artifacts and creatures you control to waterbend for ${label}.`, ['CR 701.67a', 'CR 118.3']);
  }
  const out = waterbendWith(plan, ids.length, ids);
  if (planDenial(g.s, player, sourceId, out) !== null) throw new IllegalAction(`With those choices the rest of the cost of ${label} could not be paid.`, ['CR 118.3', 'CR 601.2h']);
  if (ids.length > 0) g.log(`${g.player(player).name} waterbends for ${label}, tapping ${ids.map((id) => g.nameOf(id)).join(', ')}.`, { rules: ['CR 701.67a'], level: 'info' });
  return out;
}

/** How a payment is asked (WP11 review interface change, additive): `origin` of the `payCost` decision (design 3.8: `optional` for "you may pay ... as it enters"). */
export interface PayOptions {
  origin?: PayCostDecision['origin'];
  /** The value of X was announced for this cost (CR 107.3a): the decision never says `onlyWay`, so the player sees what X costs. */
  announcedX?: boolean;
  /**
   * FAST5X E5 INTERFACE CHANGE (additive): the mana part is paid with these types of mana from the pool, without asking (the automatic payer put them there for a
   * filter ability's cost: rules/mana.ts#ActivateOptions.payWith, rules/convert.ts).
   */
  fromPool?: ManaType[];
}

/** Pay a whole plan. `sourceId` is the permanent the ability belongs to (null for a spell). */
export function payPlan(g: Game, player: PlayerId, sourceId: ObjectId | null, given: CostPlan, label: string, how: PayOptions = {}): Paid {
  // FAST5X E10: a path that did not announce it first (CR 701.67a); FAST5X E27: a choice between costs is chosen first, never paid unresolved (CR 601.2b)
  const plan = resolveWaterbend(g, player, sourceId, resolveOneOf(g, player, sourceId, given, label), label);
  assertAllowed(partsDenial(g.s, player, sourceId, plan)); // CR 118.3
  const paid: Paid = { manaSpent: [], lifePaid: 0, costObjects: [] };
  const src = sourceId ? g.maybeObj(sourceId) : undefined;

  // 1. Tap costs. They come first because a permanent tapped for a cost can't make mana any more.
  const tapPicks: ObjectId[][] = plan.other.map(() => []);
  plan.other.forEach((part, i) => {
    if (part.kind === 'tapUntapped' || part.kind === 'tapPower' || part.kind === 'untapTapped') tapPicks[i] = choosePicks(g, player, sourceId, plan, tapPicks, i, part, label);
  });
  // FAST5X E20 (CR 701.26a): a tap cost is tapped by the player who pays it (the `tap` action, rules/crime.ts)
  if (plan.tap && src) { src.tapped = true; g.emit({ type: 'tapped', objectId: src.id }); g.emit({ type: 'actionPerformed', verb: 'tap', actor: player, objectId: src.id, zone: 'battlefield' }); }
  if (plan.untap && src && !stunInsteadOfUntap(g, src.id)) { src.tapped = false; g.emit({ type: 'untapped', objectId: src.id }); } // CR 122.1d (T20)
  plan.other.forEach((part, i) => {
    if (part.kind === 'tapPower' && part.as !== undefined && tapPicks[i]!.length > 0) (paid.tappedAs ??= []).push({ as: part.as, ids: [...tapPicks[i]!] });
    if (part.kind === 'tapPower' && part.as === undefined && tapPicks[i]!.length > 0) (paid.tappedPower ??= []).push(...tapPicks[i]!); // std-rq
  });
  for (const [i, ids] of tapPicks.entries()) {
    for (const id of ids) {
      const o = g.maybeObj(id);
      // p2-cost-parts-1 (CR 118.3, 701.26b): "Untap two tapped creatures you control"
      if (plan.other[i]?.kind === 'untapTapped') {
        if (!o || !o.tapped) throw new IllegalAction(`${g.nameOf(id)} is not a tapped permanent you can untap to pay for ${label}.`, ['CR 118.3']);
        o.tapped = false;
        g.emit({ type: 'untapped', objectId: id });
        paid.costObjects.push(id);
        continue;
      }
      if (!o || o.tapped) throw new IllegalAction(`${g.nameOf(id)} is not an untapped permanent you can tap to pay for ${label}.`, ['CR 118.3']);
      o.tapped = true;
      g.emit({ type: 'tapped', objectId: id });
      g.emit({ type: 'actionPerformed', verb: 'tap', actor: player, objectId: id, zone: 'battlefield' }); // FAST5X E20 (CR 701.26a)
      paid.costObjects.push(id);
      const p = plan.other[i];
      if (p?.kind === 'tapUntapped' && p.waterbend !== true) (paid.tapped ??= []).push(id); // FAST5X E10: a waterbend tap pays mana, it is no "tapped creature"
    }
  }

  // What is left to pay once the taps are done: no tap costs, the other parts in their order.
  // CR 601.2h: first the costs that don't involve random elements or moving cards from the library to a public zone, in any order, then the rest.
  const late = (part: PlanPart): boolean => isRandomPart(part) || part.kind === 'mill';
  const untapped = plan.other.filter((part) => part.kind !== 'tapUntapped' && part.kind !== 'tapPower' && part.kind !== 'untapTapped');
  const removals = [...untapped.filter((part) => !late(part)), ...untapped.filter(late)];
  const rest = (from: number): CostPlan => ({ mana: [], tap: false, untap: false, other: removals.slice(from), ...(plan.spend ? { spend: plan.spend } : {}) });

  // 2. Mana (CR 601.2g-h), BEFORE the sacrifices and other removals: a creature can be tapped for mana and then sacrificed.
  //    Only a mana ability that sacrifices its own permanent (Lotus Petal) conflicts with a part that sacrifices that permanent.
  if (plan.mana.length > 0) {
    const exclude = new Set<ObjectId>();
    const witness = findAssignment(g.s, player, sourceId, { ...rest(0), mana: plan.mana }, [], true);
    if (witness) {
      const sacrificers = new Set(manaSources(g.s, player, undefined, plan.spend).filter((x) => x.modes.some((m) => m.sacrifices)).map((x) => x.objectId));
      for (const c of extraManaModes(g.s, player, undefined, plan.spend).converters) if (c.sacrifices) sacrificers.add(c.objectId); // FAST5X E5
      for (const ids of witness) for (const id of ids) if (sacrificers.has(id)) exclude.add(id);
    }
    const reserved = removals.reduce((n, part) => n + (part.kind === 'payLife' ? part.amount : 0), 0);
    const r = how.fromPool ? payFromPool(g, player, plan.mana, label, how.fromPool, plan.spend) : payMana(g, player, plan.mana, label, exclude, reserved, plan.spend, how.origin, how.announcedX === true);
    paid.manaSpent.push(...r.spent);
    paid.lifePaid += r.life;
  }

  // 3. Everything else, one part at a time and in order (a discarded card can be exiled from the graveyard by the next part).
  if (plan.loyalty !== undefined && src && plan.loyalty < 0) {
    src.counters.loyalty = (src.counters.loyalty ?? 0) + plan.loyalty; // CR 606.4
    g.emit({ type: 'countersChanged', target: src.id, counter: 'loyalty', delta: plan.loyalty });
  }
  // WP31 review: putting loyalty counters goes through the counters primitive, which a "can't have counters put on it" effect stops (CR 606.4, 122.6); a +N
  // cost that could not be paid is never counted as paid (CR 614.17b; rules/cost.ts#partsDenial refuses it first).
  // Review of Cloud r3-repl (CR 606.4, 122.6, 614.1a): the loyalty counters a +N cost puts are proposed like the counters of any other cost (rules/pay-parts.ts
  // #putCostCounters, cause 'cost', by the activating player), so "if you would put one or more counters on a permanent" (Innkeeper's Talent) applies to them and
  // "if an EFFECT would put" (Doubling Season) does not (CR 614.16); the "can't" check stays a backstop before them.
  if (plan.loyalty !== undefined && src && plan.loyalty > 0) {
    if (cantDo(g.s, 'haveCountersPut', src.id)) throw new IllegalAction(`Loyalty counters can't be put on ${g.nameOf(src.id)}, so the cost of ${label} can't be paid.`, ['CR 606.4', 'CR 614.17b']);
    putCostCounters(g, player, src.id, 'loyalty', plan.loyalty); // FAST5X E21: the activating player puts them (CR 606.4, 122.6)
  }
  removals.forEach((part, i) => {
    let picked: ObjectId[] = [];
    if (isPickPart(part) && !isRandomPart(part)) picked = isSelfPart(part) ? [sourceId!] : choosePicks(g, player, sourceId, rest(i), [], 0, part as PickPart, label);
    payPart(g, player, sourceId, part, picked, label, paid);
  });
  // FAST5X E10, CR 701.67c: the player waterbent once for each waterbend cost paid, however it was paid ("whenever you waterbend", triggers/normalize.ts)
  for (let i = 0; i < (plan.waterbends ?? 0); i++) g.emit({ type: 'actionPerformed', verb: 'waterbend', actor: player });
  return paid;
}

/** Ask which objects pay a pick part (CR 118.3); only objects that leave a way to pay the rest are offered. */
function choosePicks(g: Game, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan, chosen: ObjectId[][], index: number, part: PickPart, label: string): ObjectId[] {
  const count = pickCount(part);
  const options = pickOptions(g.s, player, sourceId, plan, index, chosen);
  if (options.length < count) throw new IllegalAction(`You can't pay all of the costs of ${label} at once.`, ['CR 118.3']);
  const threshold = isThresholdPart(part);
  if (!threshold && options.length === count) return [...options]; // no choice to make
  const [what, rules] = pickPrompt(part);
  const ids = g.choose({
    kind: 'chooseObjects', player, prompt: threshold ? `${what} to pay for ${label}.` : `${what} ${count} to pay for ${label}.`, options, min: count, max: threshold ? options.length : count, cancellable: true, rules,
  }).ids;
  if (threshold && isExactPart(part)) {
    // std-costs-1 (CR 118.3, 107.3a): exactly the announced total mana value
    const total = ids.reduce((n, id) => n + valueOf(g.s, part, id), 0);
    if (total !== thresholdOf(part)) throw new IllegalAction(`Those permanents have total mana value ${total}; exactly ${thresholdOf(part)} is needed.`, rules);
  } else if (threshold) {
    const total = ids.reduce((n, id) => n + valueOf(g.s, part, id), 0);
    if (total < thresholdOf(part)) throw new IllegalAction(`Those ${part.kind === 'tapPower' ? 'creatures have total power' : part.kind === 'exileFrom' ? 'cards have mana symbols of that color' : 'cards have total mana value'} ${total}; ${thresholdOf(part)} or more is needed.`, rules);
  }
  const forced = plan.other.map((_, i) => (i < index ? chosen[i] ?? [] : i === index ? ids : []));
  if (!findAssignment(g.s, player, sourceId, plan, forced, true)) {
    throw new IllegalAction('With those choices the rest of the cost could not be paid (they use up mana sources or the same permanents).', ['CR 118.3', 'CR 601.2h']);
  }
  return ids;
}

function pickPrompt(part: PickPart): [string, string[]] {
  switch (part.kind) {
    case 'discard': return ['Discard', ['CR 701.9', 'CR 118.3']];
    case 'sacrifice': return ['Sacrifice', ['CR 701.21', 'CR 118.3']];
    case 'returnToHand': return ['Return to your hand', ['CR 118.3']];
    case 'putIntoLibrary': return [`Put this card from your ${part.zone} on the ${part.position} of your library`, ['CR 401.4', 'CR 118.3']]; // trek-9
    case 'exileFrom':
      if (part.orGraveyard) return ['Exile from among permanents you control and/or cards in your graveyard', ['CR 702.167a', 'CR 118.3']]; // FAST5X E13
      if (part.total !== undefined) return [`Exile ${part.count} or more permanents you control with total mana value exactly ${part.total}`, ['CR 118.3', 'CR 107.3a']]; // std-costs-1
      if (part.symbolTotal !== undefined) return [`Exile cards from your graveyard with ${part.symbolTotal.atLeast} or more mana symbols of that color among their mana costs`, ['CR 118.3', 'CR 107.4']]; // std-cardcopy-7
      return [part.zone === 'battlefield' ? 'Exile' : `Exile from your ${part.zone}`, ['CR 118.3']];
    case 'tapUntapped': return ['Tap', ['CR 118.3']];
    case 'untapTapped': return ['Untap', ['CR 701.26b', 'CR 118.3']]; // p2-cost-parts-1
    case 'tapPower': return [`Tap untapped creatures with total power ${part.power} or more`, ['CR 702.122a', 'CR 118.3']];
    case 'collectEvidence': return [`Exile cards from your graveyard with total mana value ${part.amount} or more`, ['CR 701.59a', 'CR 118.3']];
    case 'reveal': return ['Reveal from your hand', ['CR 701.20a', 'CR 118.3']];
    case 'removeCounters': return [`Choose the permanent to remove ${part.count} ${part.counter === 'any' ? '' : `${part.counter} `}counter${part.count === 1 ? '' : 's'} from`, ['CR 118.3']];
    case 'putCounters': return [`Choose the permanent to put ${part.count} ${part.counter} counter${part.count === 1 ? '' : 's'} on`, ['CR 122.1', 'CR 118.3']];
    case 'behold': return [part.exile ? 'Behold and exile' : 'Behold', ['CR 701.4a', 'CR 118.3']];
    case 'chooseObject': return ['Choose', ['CR 601.2b', 'CR 118.3']]; // std-costs-2
  }
}

/** What the player may activate to pay mana now (CR 605.3a), for the payCost decision. */
export function describeManaSources(g: Game, player: PlayerId, exclude?: ReadonlySet<ObjectId>, spend?: SpendContext): PayCostDecision['manaSources'] {
  const out: PayCostDecision['manaSources'] = [];
  for (const src of manaSources(g.s, player, exclude, spend)) {
    for (const m of src.modes) {
      const produces = [...new Set(m.units.flat())] as ManaType[];
      out.push({ objectId: src.objectId, abilityKey: m.key, label: `${src.name}: ${m.info.def.text}`, produces });
    }
  }
  // FAST5X E5: the mana abilities with more costs (a mana cost, life, other permanents): the player may activate them too (CR 605.3a)
  const extra = extraManaModes(g.s, player, exclude, spend);
  for (const c of extra.converters) out.push({ objectId: c.objectId, abilityKey: c.key, label: `${c.name}: ${c.info.def.text}`, produces: [...new Set(c.units.flat())] });
  for (const b of extra.byHand) out.push({ objectId: b.objectId, abilityKey: b.key, label: `${b.name}: ${b.info.def.text}`, produces: b.produces });
  return out;
}

interface ActivationPlan {
  objectId: ObjectId;
  key: string;
  colors: ManaType[];
}

/** Group the providers a solution uses into one activation per source object. */
function activationsOf(providers: Provider[], used: { providerId: number; type: ManaType }[]): ActivationPlan[] {
  const byObject = new Map<ObjectId, ActivationPlan>();
  for (const u of [...used].sort((a, b) => a.providerId - b.providerId)) {
    const pr = providers[u.providerId]!;
    if (!pr.source) continue;
    let a = byObject.get(pr.source.objectId);
    if (!a) {
      a = { objectId: pr.source.objectId, key: pr.source.keyFor[u.type]!, colors: pr.source.allOptions.map((o) => o[0]!) };
      byObject.set(pr.source.objectId, a);
    }
    a.colors[pr.source.unitIndex] = u.type;
    if (pr.source.oneType) a.colors = a.colors.map(() => u.type); // PAY1: "any one color": the unused units are that color too (CR 106.1b)
  }
  return [...byObject.values()];
}

/**
 * Pay the mana part. `exclude` are permanents another part of the cost will sacrifice (they can't be sacrificed twice);
 * `lifeReserved` is life the other parts will still pay (CR 119.4).
 */
function payMana(g: Game, player: PlayerId, given: ManaSymbol[], label: string, exclude: ReadonlySet<ObjectId>, lifeReserved: number, spend?: SpendContext, origin?: PayCostDecision['origin'], announcedX = false): { spent: ManaUnit[]; life: number } {
  const symbols = canonicalManaSymbols(given); // CMDF: "{2}{W}", not "{W}{2}" (the base cost then the commander tax, CR 903.8)
  const allows = spendAllows(g.s, player, spend);
  const p = g.player(player);
  const life = Math.max(0, lifeBudget(g.s, player) - lifeReserved);
  const sources = manaSources(g.s, player, exclude, spend);
  const providers = buildProviders(sources, p.manaPool, undefined, allows);
  const opts = spendOptions(spend); // FAST5X E29 (CR 609.4b): "mana of any type can be spent to cast that spell"; std-rx32: "... of any color"
  const anyType = opts.anyType === true || opts.anyColor === true;
  const plan = solveBest({ symbols, providers, life, ...opts });
  // FAST5X E5 (CR 605.3a): only when the ordinary sources can't pay, a payment that also activates filter abilities (rules/convert.ts)
  const converters = extraManaModes(g.s, player, exclude, spend).converters;
  const convPlan: ConverterPlan | null = plan === null && converters.length > 0 ? solveWithConverters({ symbols, sources, pool: p.manaPool, converters, life, allows, ...opts }) : null;
  const onlyWay = plan !== null && converters.length === 0 && !announcedX && !anyType && hasOnlyOneWayToPay(symbols, sources, p.manaPool, allows);
  const text = manaCostText(symbols);
  const ans = g.choose({
    kind: 'payCost',
    player,
    prompt: `Pay ${text} for ${label}.`,
    costText: text,
    manaSources: describeManaSources(g, player, exclude, spend),
    autoPayable: plan !== null || convPlan !== null,
    ...(onlyWay ? { onlyWay: true as const } : {}),
    ...(origin !== undefined ? { origin } : {}),
    cancellable: true,
    rules: ['CR 601.2g', 'CR 601.2h'],
  });

  let forceLife: Set<number>;
  if (ans.auto && !plan && convPlan) {
    // FAST5X E5: the ordinary sources first (their mana pays the filter abilities' costs and part of this one), then each filter ability in turn, paying its
    // cost with the types the plan gave it (CR 605.3a, 601.2g-h); every filter ability's mana is for this cost only (rules/convert.ts)
    const filterIds = new Set(convPlan.converters.map((c) => c.converter.objectId));
    const acts = activationsOf(convPlan.providers, convPlan.solution.used);
    for (const a of acts) if (!filterIds.has(a.objectId)) activateManaAbility(g, player, a.objectId, a.key, { colors: a.colors });
    for (const { converter, symbols: own } of convPlan.converters) {
      const a = acts.find((x) => x.objectId === converter.objectId)!;
      activateManaAbility(g, player, converter.objectId, converter.key, { colors: a.colors, payWith: payWithOf(convPlan, own) });
    }
    forceLife = new Set(convPlan.solution.lifeSymbols.filter((i) => i < symbols.length));
  } else if (ans.auto) {
    if (!plan) throw new IllegalAction(`You can't pay ${text}.`, ['CR 601.2h', 'CR 118.3']);
    for (const a of activationsOf(providers, plan.used)) activateManaAbility(g, player, a.objectId, a.key, { colors: a.colors });
    forceLife = new Set(plan.lifeSymbols);
  } else {
    for (const a of ans.activations) {
      if (exclude.has(a.objectId)) throw new IllegalAction(`${g.nameOf(a.objectId)} is being sacrificed to pay another part of this cost, so it can't make mana.`, ['CR 118.3']);
      activateManaAbility(g, player, a.objectId, a.abilityKey, a.color ? { color: a.color } : {});
    }
    forceLife = new Set(ans.lifeForPhyrexian ?? []);
    for (const i of forceLife) {
      const sym = symbols[i];
      if (!sym || !isPhyrexian(sym)) throw new IllegalAction(`Symbol number ${i + 1} of ${text} is not a Phyrexian mana symbol, so it can't be paid with life.`, ['CR 107.4f']);
    }
  }

  // Match the pool against the symbols; the player may name the pool units to spend (CR 601.2h), otherwise the engine picks.
  const only = !ans.auto && ans.spendPool ? new Set(ans.spendPool) : undefined;
  if (only) for (const i of only) if (i >= p.manaPool.length) throw new IllegalAction(`There is no mana number ${i + 1} in your pool.`, ['CR 601.2h']);
  const poolProviders = buildProviders([], p.manaPool, only, allows);
  const sol = solve({ symbols, providers: poolProviders, life, forceLife, ...opts });
  if (!sol) {
    const have = p.manaPool.length ? p.manaPool.map((u) => `{${u.type}}`).join('') : 'no mana';
    throw new IllegalAction(`The mana in your pool (${have}) doesn't pay ${text}.`, ['CR 601.2h', 'CR 118.3']);
  }
  const spent: ManaUnit[] = [];
  const poolIdx = sol.used.map((u) => poolProviders[u.providerId]!.poolIndex!).sort((a, b) => b - a);
  for (const i of poolIdx) spent.unshift(...p.manaPool.splice(i, 1));
  let paidLife = 0;
  for (const i of sol.lifeSymbols) {
    if (!payLife(g, player, 2, `paying ${manaCostText([symbols[i]!])} with life`, ['CR 107.4f', 'CR 119.4'])) throw new IllegalAction(`You can't pay 2 life for ${manaCostText([symbols[i]!])}.`, ['CR 119.4', 'CR 119.8']);
    paidLife += 2;
  }
  g.log(`${p.name} pays ${text}${spent.length ? ` with ${spent.map((u) => `{${u.type}}`).join('')}` : ''}${paidLife ? ` and ${paidLife} life` : ''}.`, { rules: ['CR 601.2h'], level: 'info' });
  return { spent, life: paidLife };
}

/**
 * FAST5X E5: pay a mana cost with mana already in the pool, of exactly the given types, without asking (CR 601.2h: the player, here the automatic payer that
 * planned the payment, chooses the mana spent). Each type takes the first unit of that type without a spending restriction, preferring mana that is not snow
 * (a snow unit may be planned for a {S} of the cost being paid, CR 107.4h). Used for the cost of a filter ability (`PayOptions.fromPool`).
 */
function payFromPool(g: Game, player: PlayerId, given: ManaSymbol[], label: string, types: readonly ManaType[], spend?: SpendContext): { spent: ManaUnit[]; life: number } {
  const symbols = canonicalManaSymbols(given); // CMDF: in the order a mana cost is written
  const p = g.player(player);
  const text = manaCostText(symbols);
  const picked = new Set<number>();
  for (const t of types) {
    const fits = (snow: boolean): number => p.manaPool.findIndex((u, i) => !picked.has(i) && u.type === t && u.restriction === undefined && (u.snow === true) === snow);
    const i = fits(false) >= 0 ? fits(false) : fits(true);
    if (i < 0) throw new IllegalAction(`There is no {${t}} in your pool to pay ${text} for ${label}.`, ['CR 601.2h', 'CR 118.3']);
    picked.add(i);
  }
  const allows = spendAllows(g.s, player, spend);
  const providers = buildProviders([], p.manaPool, picked, allows);
  const sol = solve({ symbols, providers, life: 0, forceLife: new Set() });
  if (!sol) throw new IllegalAction(`That mana doesn't pay ${text} for ${label}.`, ['CR 601.2h', 'CR 118.3']);
  const spent: ManaUnit[] = [];
  for (const i of sol.used.map((u) => providers[u.providerId]!.poolIndex!).sort((a, b) => b - a)) spent.unshift(...p.manaPool.splice(i, 1));
  g.log(`${p.name} pays ${text} with ${spent.map((u) => `{${u.type}}`).join('')}.`, { rules: ['CR 601.2h'], level: 'info' });
  return { spent, life: 0 };
}

/**
 * FAST5X E5 (CR 605.3a, 602.2b, 118.3): the cost rules of a mana ability whose cost is more than {T}, {Q} and "Sacrifice ~" (rules/mana.ts#ManaCostRules): its
 * cost is built and paid as any activated ability's, the mana for the ability itself (restricted mana pays only if it allows that ability, CR 106.6).
 */
function manaAbilityPlan(sourceId: ObjectId, cost: Parameters<typeof planFromCostDef>[0], x = 0): CostPlan {
  return { ...planFromCostDef(cost, x), spend: { kind: 'ability', id: sourceId } }; // p2-mana-1: `x`, the announced X of rules/mana.ts#counterXPart (0 before it is announced)
}
/**
 * Cloud std-woe (CR 601.2f, 602.2b, 605.1a): the plan with the mana other objects' static abilities take off its cost ("Activated abilities of lands you control cost
 * {1} less to activate", statics/costmods.ts#abilityManaCost), or null when an amount can't be worked out. rules/sources.ts plans a filter ability with the same cost.
 */
function modifiedManaAbilityPlan(s: GameState, player: PlayerId, source: GameObject, info: ActivatedInfo, x = 0): CostPlan | null {
  const plan = manaAbilityPlan(source.id, info.def.cost, x);
  const mana = abilityManaCost(s, player, source, info.def, plan.mana);
  return mana === null ? null : { ...plan, mana };
}
installManaCostRules({
  denial: (s, player, source, info) => {
    const plan = modifiedManaAbilityPlan(s, player, source, info);
    if (plan === null) return { message: `The engine can't work out the cost change of this mana ability ("${info.def.text}"), so its total cost is unknown.`, rules: ['CR 601.2f', 'CR 602.2b'] };
    return planDenial(s, player, source.id, plan);
  },
  pay: (g, player, source, info, payWith, x) => {
    const label = `${g.nameOf(source.id)}'s mana ability`;
    const modified = modifiedManaAbilityPlan(g.s, player, source, info, x ?? 0);
    if (modified === null) throw new IllegalAction(`The engine can't work out the cost change of ${label}.`, ['CR 601.2f', 'CR 602.2b']);
    const plan = resolveAnyCounts(g, player, source.id, modified, label);
    payPlan(g, player, source.id, plan, label, payWith ? { fromPool: payWith } : {});
  },
  // std-rx28 (CR 601.2f, 602.2b, 605.1a): another object's static ability increases or sets the cost (statics/costmods.ts#abilityCostModsFor); one it can't evaluate counts
  // too (its payment then reports the unknown amount, never a free activation)
  increased: (s, player, source, info) => abilityCostModsFor(s, player, source, info.def).some((h) => h.def.change.kind !== 'reduce' || h.unknown === true),
});
