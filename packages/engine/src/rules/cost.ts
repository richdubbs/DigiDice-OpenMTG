/**
 * The cost model (CR 118, 601.2f): a CostPlan is the total cost of a spell or ability once X, optional
 * additional costs and alternative costs are fixed. This module builds plans and answers "could this
 * player pay it right now?" without changing the game (used by legalActions and the early checks
 * in cast/activate). Paying is in pay.ts and pay-parts.ts. Owner: WP7.
 */
import type { CostDef, CostPart, KeywordActionName, ObjectFilter } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { formatManaSymbol, type Color, type ManaCost, type ManaSymbol } from '../types/mana';
import type { GameState } from '../types/state';
import { evalCount } from '../effects/eval';
import { charsOfObject } from './characteristics';
import { deny, type Denial } from './denial';
import { lifeBudget } from './life';
import { playerRestricted } from './restrictions';
import { cantDo, costUseDenial } from './cant';
import { countersAmong, countersFor, findAssignment, isPickPart, pickCandidates, pickFeasible, type PickPart } from './cost-pick';
import { filterMentionsX, fixX, relaxUnannouncedX } from './filter-env';
import type { SpendContext } from './sources';

/** Pick parts may carry the objects the player already chose (a payment option such as convoke or delve names them while the total cost is being built). */
interface Chosen {
  chosen?: ObjectId[];
  /** "Any number of": the count is chosen by the player when the cost is announced (CR 601.2b); until then `count` is 0 (`resolveAnyCounts` in rules/pay.ts). */
  any?: boolean;
}

/**
 * A cost part with every `Count` and `Quantity` resolved to a number (done once X is fixed, CR 601.2f). A `CostPart` the build can't pay (a computed count, an
 * action it doesn't implement, a form it doesn't honor) becomes a `manual` plan part: the cost can't be paid automatically, so the spell or ability is not
 * offered, never silently free. `confirm` is different: it is the `manual` CostPart of the model, a cost word the compiler didn't understand, which the controller
 * confirms having paid by hand (declining cancels, CR 733.1).
 */
export type PlanPart =
  | (Chosen & { kind: 'sacrifice'; filter: ObjectFilter; count: number; self?: boolean; distinctNames?: true; atLeast?: number }) // r3-cost: no two with the same name (cost-pick.ts); std-mana-1: `atLeast`
  | { kind: 'payLife'; amount: number }
  | (Chosen & { kind: 'discard'; filter?: ObjectFilter; count: number; random?: boolean; self?: boolean; hand?: boolean })
  /** FAST5X E13: 'battlefield' (self, or a permanent you control), `orGraveyard` (craft materials, CR 702.167a-b), `atLeast` ("N or more", CR 601.2b). */
  | (Chosen & { kind: 'exileFrom'; zone: 'graveyard' | 'hand' | 'battlefield' | 'stack'; filter?: ObjectFilter; count: number; self?: boolean; orGraveyard?: true; atLeast?: number; link?: string; total?: number; symbolTotal?: { color: Color; atLeast: number } }) // `link`: FAST5 T59 (CR 607.2q); `total`: std-costs-1, the exact total mana value of the objects (rules/cost-pick.ts)
  /** `waterbend`: FAST5X E10, the artifacts and creatures tapped to pay generic mana of a waterbend cost (CR 701.67a; not a "tapped creature" of the cost). */
  | (Chosen & { kind: 'tapUntapped'; filter: ObjectFilter; count: number; other?: boolean; waterbend?: true })
  | (Chosen & { kind: 'tapPower'; filter: ObjectFilter; power: number; other?: boolean; as?: 'crew' | 'saddle' }) // `as`: FAST5X E3 (CR 702.122a, 702.171a)
  /** p2-cost-parts-1 (CR 118.3, 701.26b): untap `count` tapped permanents you control of the filter (paid with the tap costs, rules/pay.ts). */
  | (Chosen & { kind: 'untapTapped'; filter: ObjectFilter; count: number })
  /** r3-cost: `among`, "from among <permanents>": `count` counters in all from any of them (rules/pay-parts.ts#removeCountersAmong, CR 118.3). */
  | { kind: 'removeCounters'; counter: string; count: number; filter?: ObjectFilter; among?: true }
  | { kind: 'putCounters'; counter: string; count: number; self?: boolean; filter?: ObjectFilter }
  | (Chosen & { kind: 'returnToHand'; filter: ObjectFilter; count: number; self?: boolean; beamUp?: true }) // trek-1: `beamUp`, a beam me up cost (rules/cant.ts)
  /** trek-9 (CR 118.3, 401.4): the source itself, from your graveyard, to the top or the bottom of its owner's library. */
  | (Chosen & { kind: 'putIntoLibrary'; zone: 'graveyard'; self: true; position: 'top' | 'bottom' })
  | (Chosen & { kind: 'reveal'; filter?: ObjectFilter; count: number; self?: boolean })
  | { kind: 'mill'; count: number }
  | { kind: 'payEnergy'; amount: number }
  /** CR 701.59a: exile cards from your graveyard with total mana value N or greater. */
  | (Chosen & { kind: 'collectEvidence'; amount: number; link?: string }) // `link`: std-rx27 (CR 607.2a)
  /** FAST5X E11, CR 701.4a: behold N [quality]: reveal such cards from your hand or choose such permanents you control (and exile them, `exile`). */
  | (Chosen & { kind: 'behold'; filter: ObjectFilter; count: number; exile?: boolean; link?: string })
  /** std-costs-2 (CR 601.2b, 601.2h): choose N objects, each matching one of the filters (each names its zone); nothing happens to them (`CostsPaid.chosenObjects`). */
  | (Chosen & { kind: 'chooseObject'; filters: ObjectFilter[]; count: number })
  /** CR 701.61a: exile three cards from your graveyard or sacrifice a Food. */
  | { kind: 'forage' }
  /** FAST5X E28, CR 701.43a: "Exert ~": the source won't untap during your next untap step (rules/pay-parts.ts#exertForCost); only a permanent on the battlefield (CR 701.43c). */
  | { kind: 'exert' }
  /**
   * FAST5X E10, CR 701.67a-b: "waterbend {N}". Its N generic mana is in the plan's `mana` (planFromCostDef adds it, so cost changes apply to the total cost,
   * CR 601.2f); this part says that up to N of the generic mana of the total may be paid by tapping untapped artifacts and creatures, each one paying {1}
   * (`waterbendWith`). Resolved before the payment (rules/pay.ts#resolveWaterbend): it becomes a chosen `tapUntapped` part and less mana.
   */
  | { kind: 'waterbend'; amount: number }
  /** FAST5X E27 (CR 122.1f, 702.21a): the paying player gets this many poison counters. */
  | { kind: 'getCounters'; counter: 'poison'; amount: number }
  /**
   * FAST5X E27 (CR 601.2b, 602.2b, 118.12a): pay ONE of these costs, the player's choice among those they can pay. A plan with one is payable when some option
   * is (`planDenial`); rules/pay.ts#resolveOneOf replaces it with the chosen option before anything is paid.
   */
  | { kind: 'oneOf'; options: CostPlan[] }
  /** std-combat-5 (CR 608.2d, 118.3): reveal the value the source's choice `link` holds (rules/pay-parts.ts). */
  | { kind: 'revealChosen'; link: string; what: 'creatureType' }
  | { kind: 'confirm'; text: string }
  | { kind: 'manual'; text: string };

/** Every `CostPart` kind of the model, by its capability name `cost:<kind>` (design 5.2). All of them can be paid; the value forms they can't pay are not in `COST_FORMS`. */
export const COST_PART_IMPLS: Readonly<Record<CostPart['kind'], true>> = {
  sacrifice: true, payLife: true, discard: true, exileFrom: true, tapUntapped: true, tapPower: true, removeCounters: true, putCounters: true, returnToHand: true,
  reveal: true, mill: true, payEnergy: true, action: true, manual: true, behold: true,
  getCounters: true, oneOf: true, // FAST5X E27
  chooseObject: true, // std-costs-2 (CR 601.2b, 601.2h)
  revealChosen: true, // std-combat-5
  untapTapped: true, // p2-cost-parts-1 (CR 118.3, 701.26b)
  putIntoLibrary: true, // trek-9 (CR 118.3, 401.4)
};

/** The keyword actions this build can pay as a cost (capabilities `cost:action.<name>`). `exert`, `behold` and the like stay manual until their keyword action exists. */
export const COST_ACTIONS: readonly KeywordActionName[] = ['collectEvidence', 'forage', 'blight', 'waterbend', 'exert' /* FAST5X E28: CR 701.43a */];


/**
 * The VALUE FORMS of those kinds this build can pay, WITHOUT the `cost:` prefix (design 5.2, WP0 review; names in model/forms.ts `costPartForms`):
 * `discard.self` (cycling), `discard.hand`, `removeCounters.filter`, `tapUntapped.other`, and one `action.<name>` per keyword action of `COST_ACTIONS`.
 * `count.any` ("any number of": the player chooses the count when the cost is announced, CR 601.2b). Not here: `count.quantity` (a computed count: it waits for
 * WP4's `evalCount`) and `exileFrom.zone`
 * (a zone other than graveyard or hand): a cost that uses one stays a manual plan part and the spell or ability is not offered.
 */
export const COST_FORMS: readonly string[] = [
  'count.any', 'discard.self', 'discard.hand', 'removeCounters.filter', 'tapUntapped.other', ...COST_ACTIONS.map((a) => `action.${a}`),
  // CLOUD std-ecl: "Remove two counters from this creature" (no kind named): counters of any kinds, the payer's choice (CR 122.1, 118.3; rules/pay-parts.ts)
  // (cloud std-spm wrote the same cost; this one implementation serves both)
  'removeCounters.any',
  // r3-cost: "Remove two +1/+1 counters from among artifacts you control" (CR 118.3, 122.1): in all, from any of them (rules/pay-parts.ts#removeCountersAmong)
  'removeCounters.among',
  // p2-counters-move-2: "Remove all charge counters from ~" (CR 118.3, 107.3a): the ability's X, fixed to the counters of that kind on ~ (actions/activate.ts#fixedCounterX)
  'removeCounters.all',
  // r3-cost: "Sacrifice three artifact tokens with different names" (CR 118.3, 201.2): rules/cost-pick.ts#findAssignment picks objects with different names
  'sacrifice.distinctNames',
  // std-mana-1: "Sacrifice one or more artifacts" (CR 601.2b, 118.3): announced, at least `atLeast` (rules/pay.ts#resolveAnyCounts)
  'sacrifice.atLeast',
  // FAST5X E13: "Exile ~" / "Exile a <permanent> you control" (CR 118.3, 602.2), craft's materials from the battlefield and/or your graveyard (CR 702.167a-b)
  // and their "N or more" count (CR 601.2b); model/forms.ts names them, `exileZonePayable` below decides what is paid
  'exileFrom.battlefield', 'exileFrom.orGraveyard', 'exileFrom.atLeast',
  // r5-mech: "you may exile ~ and four cards named ~ from your graveyard" while the spell resolves: the spell itself, from the stack (CR 118.3, 608.2m, 608.2n)
  'exileFrom.stack',
  // std-costs-1: "Exile one or more other artifacts you control with total mana value X" (CR 118.3, 107.3a): rules/cost-pick.ts picks an exact total
  'exileFrom.totalManaValue',
  // std-cardcopy-7: "with fifteen or more black mana symbols among their mana costs" (CR 118.3, 107.4): a threshold part (rules/cost-pick.ts)
  'exileFrom.symbolTotal',
  // trek-1: the creature returned for a beam me up cost (Star Trek; CR 702 rule number unverified): rules/cost-pick.ts#costUse asks rules/cant.ts for `beBeamedUp`
  'returnToHand.beamUp',
];

/**
 * FAST5X E13: the zones an `exileFrom` part can be paid from: your graveyard or hand (CR 118.3: only your own cards), and the battlefield for the source itself
 * ("Exile ~", CR 602.2), for permanents the filter says you control ("Exile a creature you control"), or for craft's materials (`orGraveyard`, CR 702.167a).
 * The same test as model/forms.ts#costPartForms (`cost:exileFrom.zone` otherwise).
 */
export function exileZonePayable(part: Extract<CostPart, { kind: 'exileFrom' }>): boolean {
  if (part.orGraveyard) return part.zone === 'battlefield' && part.self !== true;
  if (part.zone === 'graveyard' || part.zone === 'hand') return true;
  if (part.zone === 'stack') return part.self === true; // r5-mech: a resolving spell exiling itself (CR 608.2m, 608.2n)
  return part.zone === 'battlefield' && (part.self === true || part.filter?.controller === 'you');
}

export interface CostPlan {
  /** Mana symbols with X substituted. Empty = no mana to pay. */
  mana: ManaSymbol[];
  /** {T} / {Q} of the source of an ability (CR 602.1a). */
  tap: boolean;
  untap: boolean;
  /** Loyalty cost of a planeswalker ability: +N adds, -N removes counters (CR 606.4). */
  loyalty?: number;
  other: PlanPart[];
  /** What the mana is for (the spell, or the source of the ability): restricted mana ("only to cast creature spells", CR 106.6) pays only where it allows. */
  spend?: SpendContext;
  /** FAST5X E10: how many waterbend costs this plan pays (after rules/pay.ts#resolveWaterbend): each is "you waterbend" once it is paid (CR 701.67c). */
  waterbends?: number;
}

/** Short description of a cost part this engine build cannot pay (the text of its manual plan part). */
function unavailableText(part: CostPart): string {
  switch (part.kind) {
    case 'manual': return part.text;
    case 'tapPower': return 'Tap untapped creatures you control with total power N or more';
    case 'putCounters': return `Put ${part.counter} counters`;
    case 'payEnergy': return 'Pay energy';
    case 'reveal': return 'Reveal a card from your hand';
    case 'mill': return 'Mill cards';
    case 'action': return `Perform the keyword action ${part.action}`;
    default: return `Pay ${part.kind}`;
  }
}

/**
 * X while a cost is built: the announced number (CR 107.3a), or `'unannounced'` for a check made before X is announced (CR 601.2b: modes and optional costs
 * come first; the legality check, CR 601.3, 602.5). Unannounced, an {X} in the mana and a count of X are 0 (the announcement that always exists, CR 107.3b),
 * and an X inside a part's filter is relaxed ("sacrifice an artifact with mana value X" is "sacrifice an artifact": some X may fit, WP30 review).
 */
export type CostX = number | 'unannounced';

/** One `CostPart` of the model as a plan part, or as a manual part when it uses something this build cannot pay. */
export function toPlanPart(part: CostPart, xs: CostX): PlanPart {
  const manual = (): PlanPart => ({ kind: 'manual', text: unavailableText(part) });
  const x = typeof xs === 'number' ? xs : 0;
  /** CR 601.2f: the total cost is locked in with the announced X, so an X in a part's filter is that number (WP30; the filter is then read by cost-pick.ts). */
  const fx = <F extends ObjectFilter>(f: F): F => (xs === 'unannounced' ? (relaxUnannouncedX(f) as F) : fixX(f, x));
  const n = (c: Parameters<typeof evalCount>[0]): number | null => {
    try {
      const v = evalCount(c, { x });
      return Number.isFinite(v) ? v : null; // "any number" is read by `counted` below; a computed quantity needs the evaluators of WP4
    } catch {
      return null;
    }
  };
  /** The count of a part that picks objects: a number, or 0 with `any` when the player chooses it (CR 601.2b). null = can't be read. */
  const counted = (c: Parameters<typeof evalCount>[0]): { count: number; any?: true } | null => {
    if (c === 'any') return { count: 0, any: true };
    const v = n(c);
    return v === null ? null : { count: v };
  };
  switch (part.kind) {
    case 'sacrifice': {
      const c = counted(part.count);
      if (part.distinctNames === true && (c === null || 'any' in c)) return manual(); // r3-cost: a fixed number with different names only
      if (part.atLeast !== undefined && (c === null || c.any !== true)) return manual(); // std-mana-1: "N or more" is an announced count only
      // std-mana-1 (CR 601.2b, 118.3): "Sacrifice one or more artifacts": announced like "any number" but never fewer than N; until announced the plan needs N
      if (part.atLeast !== undefined) return { kind: 'sacrifice', filter: fx(part.filter), count: part.atLeast, any: true, atLeast: part.atLeast };
      return c === null ? manual() : { kind: 'sacrifice', filter: fx(part.filter), ...c, ...(part.self ? { self: true } : {}), ...(part.distinctNames === true ? { distinctNames: true as const } : {}) };
    }
    case 'payLife': {
      const amount = n(part.amount);
      return amount === null ? manual() : { kind: 'payLife', amount };
    }
    case 'discard': {
      const c = counted(part.count);
      if (c === null) return manual();
      if (part.hand) return { kind: 'discard', hand: true, count: 0 }; // CR 701.9: discard your hand
      if (part.self) return { kind: 'discard', self: true, count: 1 }; // cycling: discard this card
      return { kind: 'discard', ...(part.filter ? { filter: fx(part.filter) } : {}), ...c, ...(part.random ? { random: true } : {}) };
    }
    case 'exileFrom': {
      const c0 = counted(part.count);
      if (c0 === null || !exileZonePayable(part)) return manual();
      // std-costs-1 (CR 118.3, 107.3a, 601.2f): "Exile one or more other artifacts you control with total mana value X": as many permanents as the player picks, at
      // least `atLeast`, whose mana values add up to exactly the announced X. Before X is announced any X may fit: the part needs `atLeast` of them.
      if (part.totalManaValue !== undefined) {
        if (part.zone !== 'battlefield' || part.self === true || part.orGraveyard === true || part.atLeast === undefined || c0.any !== true) return manual();
        const total = xs === 'unannounced' ? null : n(part.totalManaValue);
        if (xs !== 'unannounced' && total === null) return manual();
        return { kind: 'exileFrom', zone: 'battlefield', ...(part.filter ? { filter: fx(part.filter) } : {}), count: part.atLeast, ...(total !== null ? { total } : {}), ...(part.link !== undefined ? { link: part.link } : {}) };
      }
      if (part.atLeast !== undefined && c0.any !== true) return manual(); // "N or more" is an announced count only
      // std-cardcopy-7 (CR 118.3, 107.4): "any number of black cards ... with fifteen or more black mana symbols among their mana costs": a threshold part (as many
      // cards as the player chooses to reach the total, rules/cost-pick.ts), from your graveyard only; its count is not announced
      if (part.symbolTotal !== undefined) {
        if (c0.any !== true || part.zone !== 'graveyard' || part.self === true || part.orGraveyard === true || part.atLeast !== undefined) return manual();
        return { kind: 'exileFrom', zone: 'graveyard', ...(part.filter ? { filter: fx(part.filter) } : {}), count: 0, symbolTotal: { ...part.symbolTotal }, ...(part.link !== undefined ? { link: part.link } : {}) };
      }
      // FAST5X E13: "N or more" (CR 702.167a): announced like "any number" (CR 601.2b) but never fewer than N; until it is announced the plan needs N
      const c = part.atLeast !== undefined ? { count: part.atLeast, any: true as const, atLeast: part.atLeast } : c0;
      return {
        kind: 'exileFrom', zone: part.zone as 'graveyard' | 'hand' | 'battlefield' | 'stack', ...(part.filter ? { filter: fx(part.filter) } : {}), ...c,
        ...(part.self ? { self: true } : {}), ...(part.orGraveyard ? { orGraveyard: true as const } : {}), ...(part.link !== undefined ? { link: part.link } : {}),
      };
    }
    case 'tapUntapped': {
      const c = counted(part.count);
      return c === null ? manual() : { kind: 'tapUntapped', filter: fx(part.filter), ...c, ...(part.other ? { other: true } : {}) };
    }
    case 'untapTapped': { // p2-cost-parts-1: a fixed count only ("any number of" tapped permanents is no wording of the corpus)
      const c = counted(part.count);
      return c === null || c.any === true ? manual() : { kind: 'untapTapped', filter: fx(part.filter), count: c.count };
    }
    case 'tapPower': {
      const power = n(part.power);
      return power === null ? manual() : { kind: 'tapPower', filter: fx(part.filter), power, ...(part.other ? { other: true } : {}), ...(part.as ? { as: part.as } : {}) };
    }
    case 'removeCounters': {
      const count = n(part.count);
      if (part.among === true && part.filter === undefined) return manual(); // r3-cost: "from among" names the permanents
      return count === null ? manual() : { kind: 'removeCounters', counter: part.counter, count, ...(part.filter ? { filter: fx(part.filter) } : {}), ...(part.among === true ? { among: true as const } : {}) };
    }
    case 'putCounters': {
      const count = n(part.count);
      if (count === null || (!part.self && !part.filter)) return manual();
      return { kind: 'putCounters', counter: part.counter, count, ...(part.self ? { self: true } : { filter: fx(part.filter!) }) };
    }
    case 'returnToHand': {
      const c = counted(part.count);
      return c === null ? manual() : { kind: 'returnToHand', filter: fx(part.filter), ...c, ...(part.self ? { self: true } : {}), ...(part.beamUp === true ? { beamUp: true as const } : {}) }; // trek-1: beam me up
    }
    case 'putIntoLibrary': // trek-9 (CR 118.3, 401.4): the source itself from your graveyard only
      return part.zone === 'graveyard' && part.self === true ? { kind: 'putIntoLibrary', zone: 'graveyard', self: true, position: part.position } : manual();
    case 'reveal': {
      const c = counted(part.count);
      return c === null ? manual() : { kind: 'reveal', ...(part.filter ? { filter: fx(part.filter) } : {}), ...c, ...(part.self ? { self: true } : {}) };
    }
    case 'mill': {
      const count = n(part.count);
      return count === null ? manual() : { kind: 'mill', count };
    }
    case 'behold': {
      // FAST5X E11 (CR 701.4a): an "any number" behold is not printed; only a fixed count is paid automatically
      const c = counted(part.count);
      return c === null || c.any ? manual() : { kind: 'behold', filter: fx(part.filter), count: c.count, ...(part.exile ? { exile: true } : {}), ...(part.link !== undefined ? { link: part.link } : {}) };
    }
    case 'chooseObject': {
      // std-costs-2 (CR 601.2b): a fixed number of objects, each of a filter that names its zone
      const c = counted(part.count);
      return c === null || c.any || part.filters.length === 0 || part.filters.some((f) => typeof f.zone !== 'string') ? manual() : { kind: 'chooseObject', filters: part.filters.map(fx), count: c.count };
    }
    case 'payEnergy': {
      const amount = n(part.amount);
      return amount === null ? manual() : { kind: 'payEnergy', amount };
    }
    case 'action': {
      // std-costs-1 (CR 601.2c, 601.2f, 701.59a): "collect evidence X, where X is the total mana value of the permanents this spell targets" is read once the targets
      // are chosen: actions/cast.ts#withTargetTotals replaces the quantity by the number before the total cost is built. Before that (the castability check of
      // CR 601.3, the X and cost announcements of 601.2b) the spell targets nothing yet: 0.
      const unfixed = typeof part.arg === 'object' && part.arg.q === 'spellTargetTotal';
      const arg = part.arg === undefined ? undefined : unfixed ? 0 : n(part.arg);
      if (arg === null) return manual();
      switch (part.action) {
        case 'collectEvidence': return arg === undefined ? manual() : { kind: 'collectEvidence', amount: arg, ...(part.link !== undefined ? { link: part.link } : {}) };
        case 'forage': return { kind: 'forage' };
        case 'exert': return { kind: 'exert' }; // FAST5X E28: "Exert ~" (the cost template's only form, CR 701.43a)
        // CR 701.68a: to blight N is to put N -1/-1 counters on a creature you control.
        case 'blight': return arg === undefined ? manual() : { kind: 'putCounters', counter: '-1/-1', count: arg, filter: { types: ['Creature'] } };
        // CR 701.67a: "waterbend {N}" (its N generic mana is added to the plan's mana by planFromCostDef)
        case 'waterbend': return arg === undefined || arg < 0 ? manual() : { kind: 'waterbend', amount: arg };
        default: return manual();
      }
    }
    case 'revealChosen': return { kind: 'revealChosen', link: part.link, what: part.what }; // std-combat-5
    case 'getCounters': {
      // FAST5X E27 (CR 122.1f): "get N poison counters"
      const amount = n(part.amount);
      return amount === null || part.counter !== 'poison' ? manual() : { kind: 'getCounters', counter: 'poison', amount };
    }
    case 'oneOf': {
      // FAST5X E27 (CR 601.2b, 118.12a): each option is a whole cost; one the build can't pay stays a manual part inside its option (that option is never payable)
      if (!Array.isArray(part.options) || part.options.length < 2) return manual();
      return { kind: 'oneOf', options: part.options.map((o) => planFromCostDef(o, xs)) };
    }
    case 'manual':
      return { kind: 'confirm', text: part.text };
  }
}

export const emptyPlan = (): CostPlan => ({ mana: [], tap: false, untap: false, other: [] });

/** Number of {X} symbols in a cost (the cost counts X once per symbol, CR 107.3a). */
export const countX = (mana: ManaCost | null | undefined): number => (mana ?? []).filter((s) => s.kind === 'variable').length;

/** Replace each {X} with X generic mana (CR 107.3b); {0} symbols vanish. */
export function substituteX(mana: ManaCost | null | undefined, x: number): ManaSymbol[] {
  const out: ManaSymbol[] = [];
  for (const sym of mana ?? []) {
    if (sym.kind === 'variable') { if (x > 0) out.push({ kind: 'generic', amount: x }); } else if (sym.kind === 'generic' && sym.amount === 0) continue;
    else out.push(sym);
  }
  return out;
}

/**
 * Does this cost have an X that its controller announces (CR 107.3a)? An {X} in the mana, a count / amount of exactly X in any other part ("pay X life", "remove X
 * counters"), or an X inside a part's filter ("Sacrifice an artifact with mana value X", `costFilterHasX`). A cost whose X is read from a computed quantity is a
 * manual plan part (`toPlanPart`) and is never paid automatically.
 */
export function costHasX(cost: CostDef | undefined): boolean {
  if (!cost) return false;
  const isX = (v: unknown): boolean => typeof v === 'object' && v !== null && (v as { q?: unknown }).q === 'X';
  return countX(cost.mana) > 0 || costFilterHasX(cost) || cost.loyaltyX === true // std-r9: "−X" (CR 606.4, 107.3a)
    || (cost.other ?? []).some((p) => isX((p as { count?: unknown }).count) || isX((p as { amount?: unknown }).amount) || isX((p as { power?: unknown }).power) || isX((p as { arg?: unknown }).arg)
      || isX((p as { totalManaValue?: unknown }).totalManaValue)); // std-costs-1: "with total mana value X" (CR 107.3a)
}

/**
 * Does a part of this cost pick objects by a filter that reads X (CR 107.3a: X in an activation or additional cost)? Then whether the cost can be paid is not
 * monotone in X ("an artifact with mana value X": only the mana values on the board fit), so every X up to the cap is tried (`payableXs`).
 */
export const costFilterHasX = (cost: CostDef | undefined): boolean => (cost?.other ?? []).some((p) => filterMentionsX((p as { filter?: unknown }).filter)
  || (p as { totalManaValue?: unknown }).totalManaValue !== undefined); // std-costs-1: an exact total mana value is not monotone in X either

/** The plan of several costs added together, with the announced X in every one of them (CR 601.2f, 107.3a). */
export function planFromCostDefs(costs: readonly (CostDef | undefined)[], x: CostX): CostPlan {
  return costs.reduce<CostPlan>((plan, c) => addPlans(plan, planFromCostDef(c, x)), emptyPlan());
}

export function planFromCostDef(cost: CostDef | undefined, x: CostX): CostPlan {
  const plan = emptyPlan();
  if (!cost) return plan;
  plan.mana = substituteX(cost.mana, typeof x === 'number' ? x : 0);
  plan.tap = cost.tap === true;
  plan.untap = cost.untap === true;
  if (cost.loyalty !== undefined) plan.loyalty = cost.loyalty;
  if (cost.loyaltyX === true) plan.loyalty = -(typeof x === 'number' ? x : 0); // std-r9 (CR 606.4, 107.3a): before X is announced, 0
  plan.other = (cost.other ?? []).map((part) => toPlanPart(part, x));
  // FAST5X E10 (CR 701.67a, 601.2f): a waterbend cost is mana to pay: its generic mana is part of the total cost (some of it may be paid by tapping)
  for (const p of plan.other) if (p.kind === 'waterbend' && p.amount > 0) plan.mana.push({ kind: 'generic', amount: p.amount });
  return plan;
}

// ---- waterbend (FAST5X E10, CR 701.67) ----------------------------------------------------------------------------------------------------------------

/** CR 701.67a: what may be tapped to pay for a waterbend cost: untapped artifacts and creatures you control (the tap part adds "untapped" and "you control"). */
export const WATERBEND_TAPS: ObjectFilter = { types: ['Artifact', 'Creature'] };

export const hasWaterbend = (plan: CostPlan): boolean => plan.other.some((p) => p.kind === 'waterbend');

/** The generic mana of the plan's mana symbols. */
const genericOf = (mana: readonly ManaSymbol[]): number => mana.reduce((n, m) => n + (m.kind === 'generic' ? m.amount : 0), 0);

/**
 * CR 701.67a-b: how many of the plan's generic mana its waterbend costs let the player pay by tapping: the generic mana in the waterbend costs, never more than
 * the generic mana left in the total cost (a cost reduction may have removed some, CR 601.2f), and never generic mana of other parts of the total cost (701.67b).
 */
export function waterbendCap(plan: CostPlan): number {
  const total = plan.other.reduce((n, p) => n + (p.kind === 'waterbend' ? p.amount : 0), 0);
  return Math.min(total, genericOf(plan.mana));
}

/**
 * The plan with its waterbend costs paid partly by tapping `k` untapped artifacts and/or creatures (CR 701.67a: each pays {1}): `k` less generic mana and a
 * tap part of `k` objects (`chosen`: the ones the player named). The plan counts the waterbend costs it pays (`waterbends`, CR 701.67c).
 */
export function waterbendWith(plan: CostPlan, k: number, chosen?: readonly ObjectId[]): CostPlan {
  const count = plan.other.filter((p) => p.kind === 'waterbend').length;
  const other = plan.other.filter((p) => p.kind !== 'waterbend');
  if (k > 0) other.push({ kind: 'tapUntapped', filter: WATERBEND_TAPS, count: k, waterbend: true, ...(chosen ? { chosen: [...chosen] } : {}) });
  let left = k;
  const mana: ManaSymbol[] = [];
  for (const sym of plan.mana) {
    if (sym.kind === 'generic' && left > 0) {
      const take = Math.min(left, sym.amount);
      left -= take;
      if (sym.amount - take > 0) mana.push({ kind: 'generic', amount: sym.amount - take });
    } else mana.push(sym);
  }
  return { ...plan, mana, other, ...(count > 0 || plan.waterbends ? { waterbends: (plan.waterbends ?? 0) + count } : {}) };
}

// ---- a choice between costs (FAST5X E27, CR 601.2b, 602.2b, 118.12a) ---------------------------------------------------------------------------------

export const hasOneOf = (plan: CostPlan): boolean => plan.other.some((p) => p.kind === 'oneOf');

/**
 * The plans a plan with a choice between costs stands for: its first `oneOf` part replaced by each of its options in turn (the option's mana, tap and parts
 * added to the rest, CR 601.2f). A plan with none is the only one.
 */
export function oneOfPlans(plan: CostPlan): CostPlan[] {
  const i = plan.other.findIndex((p) => p.kind === 'oneOf');
  if (i < 0) return [plan];
  const part = plan.other[i] as Extract<PlanPart, { kind: 'oneOf' }>;
  const rest: CostPlan = { ...plan, other: plan.other.filter((_, j) => j !== i) };
  return part.options.map((o) => addPlans(rest, { ...o, ...(rest.spend ? { spend: rest.spend } : {}) }));
}

/** Null when one of the plans a choice stands for passes `check` (CR 118.3: the player chooses a cost they can pay); otherwise the first option's denial. */
function firstPayable(plan: CostPlan, check: (p: CostPlan) => Denial | null): Denial | null {
  let first: Denial | null = null;
  for (const o of oneOfPlans(plan)) {
    const d = check(o);
    if (!d) return null;
    first ??= d;
  }
  return first ?? deny('None of the costs to choose from can be paid.', 'CR 118.3');
}

/** CR 601.2f: total cost = base cost + additional costs (cost increases and reductions are a hook for milestone 5/6). */
export function addPlans(a: CostPlan, b: CostPlan): CostPlan {
  const loyalty = (a.loyalty ?? 0) + (b.loyalty ?? 0);
  return {
    mana: [...a.mana, ...b.mana],
    tap: a.tap || b.tap,
    untap: a.untap || b.untap,
    ...(a.loyalty !== undefined || b.loyalty !== undefined ? { loyalty } : {}),
    other: [...a.other, ...b.other],
    ...((a.spend ?? b.spend) ? { spend: (a.spend ?? b.spend)! } : {}),
    ...(a.waterbends || b.waterbends ? { waterbends: (a.waterbends ?? 0) + (b.waterbends ?? 0) } : {}),
  };
}

export const manaCostText = (mana: ManaSymbol[]): string => (mana.length ? mana.map(formatManaSymbol).join('') : '{0}');

/**
 * CMDF (cosmetic): a total cost in the order a mana cost is written (CR 107.4, 202.1): the variable symbols ({X}), then one generic symbol for all the generic
 * mana, then every other symbol in its order. A total cost is built by appending (an additional cost such as the commander tax, CR 903.8, 601.2f), so before
 * this the payment read "{W}{2}". The same mana: rules/pay.ts reorders the symbols before it asks, so the prompt, the client's symbol indices (Phyrexian
 * symbols paid with life) and the solver agree. A total of {0} generic adds no symbol.
 */
export function canonicalManaSymbols(mana: readonly ManaSymbol[]): ManaSymbol[] {
  const generic = mana.reduce((n, s) => n + (s.kind === 'generic' ? s.amount : 0), 0);
  const variable = mana.filter((s) => s.kind === 'variable');
  const rest = mana.filter((s) => s.kind !== 'variable' && s.kind !== 'generic');
  return [...variable, ...(generic > 0 ? [{ kind: 'generic', amount: generic } as const] : []), ...rest];
}

export function costText(plan: CostPlan): string {
  const parts: string[] = [];
  // FAST5X E10: the generic mana of a waterbend cost is in `mana` (planFromCostDef): it is written once, as "Waterbend {N}"
  const mana = hasWaterbend(plan) ? waterbendWith({ ...plan, other: plan.other.filter((p) => p.kind === 'waterbend') }, waterbendCap(plan)).mana : plan.mana;
  if (mana.length) parts.push(manaCostText(mana));
  for (const p of plan.other) if (p.kind === 'waterbend') parts.push(partText(p));
  if (plan.tap) parts.push('{T}');
  if (plan.untap) parts.push('{Q}');
  if (plan.loyalty !== undefined) parts.push(plan.loyalty > 0 ? `+${plan.loyalty}` : `${plan.loyalty}`);
  for (const p of plan.other) if (p.kind !== 'waterbend') parts.push(partText(p));
  return parts.length ? parts.join(', ') : '{0}';
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const VERB: Partial<Record<PlanPart['kind'], string>> = { tapUntapped: 'Tap', untapTapped: 'Untap', returnToHand: 'Return to your hand', exileFrom: 'Exile', reveal: 'Reveal', discard: 'Discard', sacrifice: 'Sacrifice' };

/**
 * FAST5 T56: the cards a one-card discard names, for the prompt that asks whether to pay it ("Discard an artifact card", "Discard an instant or sorcery card or a
 * creature card with flying"). Null for a filter this does not word (the generic "Discard 1 card" then stands).
 */
function discardedCards(f: ObjectFilter | undefined): string | null {
  if (f === undefined) return null;
  const one = (g: ObjectFilter): string | null => {
    const keys = Object.keys(g).filter((k) => (g as Record<string, unknown>)[k] !== undefined && k !== 'isCard');
    if (g.types === undefined || g.types.length === 0 || keys.some((k) => k !== 'types' && k !== 'keyword') || (g.keyword !== undefined && typeof g.keyword !== 'string')) return null;
    return `${g.types.map((t) => t.toLowerCase()).join(' or ')} card${g.keyword !== undefined ? ` with ${g.keyword}` : ''}`;
  };
  const parts = f.anyOf !== undefined && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 1 ? f.anyOf.map(one) : [one(f)];
  if (parts.some((x) => x === null)) return null;
  return parts.map((x) => `${/^[aeiou]/.test(x!) ? 'an' : 'a'} ${x!}`).join(' or ');
}

const COLOR_NAME: Readonly<Record<string, string>> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }; // std-cardcopy-7

export function partText(p: PlanPart): string {
  if (p.kind === 'exileFrom' && p.symbolTotal !== undefined) return `Exile cards from your graveyard with ${p.symbolTotal.atLeast} or more ${COLOR_NAME[p.symbolTotal.color] ?? p.symbolTotal.color} mana symbols among their mana costs`; // std-cardcopy-7
  if (p.kind === 'exileFrom' && p.orGraveyard) { // FAST5X E13: craft's materials (CR 702.167a)
    return `Exile ${'any' in p && p.any ? `${p.atLeast ?? 0} or more` : String(p.count)} from among permanents you control and/or cards in your graveyard`;
  }
  if ('any' in p && p.any) return `${VERB[p.kind] ?? 'Pay'} any number of cards or permanents`;
  switch (p.kind) {
    case 'sacrifice': return p.self ? 'Sacrifice this permanent' : `Sacrifice ${plural(p.count, 'permanent')}${p.distinctNames ? ' with different names' : ''}`;
    case 'payLife': return `Pay ${p.amount} life`;
    case 'discard': return p.hand ? 'Discard your hand' : p.self ? 'Discard this card' : p.count === 1 && !p.random && discardedCards(p.filter) !== null ? `Discard ${discardedCards(p.filter)!}` : `Discard ${plural(p.count, 'card')}${p.random ? ' at random' : ''}`;
    case 'exileFrom':
      if (p.zone === 'battlefield' && p.total !== undefined) return `Exile ${p.count} or more permanents you control with total mana value ${p.total}`; // std-costs-1
      if (p.zone === 'battlefield') return p.self ? 'Exile this permanent' : `Exile ${plural(p.count, 'permanent')} you control`; // FAST5X E13
      return `Exile ${p.self ? 'this card' : plural(p.count, 'card')} from your ${p.zone}`;
    case 'tapUntapped': return `Tap ${plural(p.count, `untapped ${p.other ? 'other ' : ''}permanent`)} you control`;
    case 'untapTapped': return `Untap ${plural(p.count, 'tapped permanent')} you control`; // p2-cost-parts-1
    case 'tapPower': return `Tap any number of untapped ${p.other ? 'other ' : ''}creatures you control with total power ${p.power} or more`;
    case 'removeCounters': return `Remove ${plural(p.count, p.counter === 'any' ? 'counter' : `${p.counter} counter`)}${p.among ? ' from among permanents you control' : p.filter ? ' from a permanent you control' : ''}`; // CLOUD std-ecl: 'any' kind; r3-cost: among
    case 'putCounters': return `Put ${plural(p.count, `${p.counter} counter`)} on ${p.self ? 'this permanent' : 'a permanent you control'}`;
    case 'returnToHand': return p.self ? 'Return this permanent to its owner\'s hand' : `Return ${plural(p.count, 'permanent')} to your hand`;
    case 'reveal': return p.self ? 'Reveal this card from your hand' : `Reveal ${plural(p.count, 'card')} from your hand`;
    case 'putIntoLibrary': return `Put this card from your ${p.zone} on the ${p.position} of your library`; // trek-9
    case 'mill': return `Mill ${plural(p.count, 'card')}`;
    case 'payEnergy': return `Pay ${p.amount} energy`;
    case 'collectEvidence': return `Collect evidence ${p.amount}`;
    case 'behold': {
      const q = [...(p.filter.supertypes ?? []).map((t) => t.toLowerCase()), ...(p.filter.subtypes ?? []), ...(p.filter.types ?? []).map((t) => t.toLowerCase())].join(' ') || 'card or permanent';
      return `Behold ${p.count === 1 ? (/^[aeiou]/i.test(q) ? `an ${q}` : `a ${q}`) : `${p.count} ${q}`}${p.exile ? ' and exile it' : ''}`;
    }
    case 'chooseObject': return `Choose ${p.count === 1 ? 'an object' : `${p.count} objects`}`; // std-costs-2
    case 'forage': return 'Forage';
    case 'exert': return 'Exert this permanent';
    case 'waterbend': return `Waterbend {${p.amount}}`;
    case 'getCounters': return `Get ${plural(p.amount, `${p.counter} counter`)}`; // FAST5X E27
    case 'revealChosen': return 'Reveal the creature type you chose'; // std-combat-5
    case 'oneOf': return p.options.map((o) => costText(o)).join(' or '); // FAST5X E27
    case 'confirm': case 'manual': return p.text;
  }
}

/** Whether the non-mana parts of a plan can be paid (CR 118.3: you can't pay without the resources). */
export function partsDenial(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan): Denial | null {
  if (hasOneOf(plan)) return firstPayable(plan, (o) => partsDenial(s, player, sourceId, o)); // FAST5X E27: some option's parts can be paid
  const p = s.players.find((x) => x.id === player)!;
  const src = sourceId ? s.objects[sourceId] : undefined;
  if (plan.tap && (!src || src.tapped)) return deny('The permanent is already tapped, so its {T} cost can\'t be paid.', 'CR 118.3', 'CR 602.1a');
  if (plan.untap && (!src || !src.tapped)) return deny('The permanent is untapped, so its {Q} cost can\'t be paid.', 'CR 118.3');
  const cantUntap = plan.untap && src ? cantDo(s, 'untap', src.id) : null; // WP31: CR 107.6, 614.17b
  if (cantUntap) return deny(`The permanent can't untap, so its {Q} cost can't be paid. ${cantUntap.message}`, 'CR 107.6', 'CR 614.17b');
  if (plan.loyalty !== undefined && plan.loyalty < 0 && (!src || (src.counters.loyalty ?? 0) < -plan.loyalty)) {
    return deny('The planeswalker doesn\'t have enough loyalty counters.', 'CR 606.4', 'CR 118.3');
  }
  // WP31 review: a +N loyalty cost puts loyalty counters on the permanent (CR 606.4), so it can't be paid when counters can't be put on it (CR 614.17b).
  const cantPut = plan.loyalty !== undefined && plan.loyalty > 0 && src ? costUseDenial(s, player, src.id, 'putCounters') : null;
  if (cantPut) return deny(`Loyalty counters can't be put on this permanent, so its +${plan.loyalty} cost can't be paid. ${cantPut.message}`, 'CR 606.4', 'CR 614.17b');
  let life = lifeBudget(s, player);
  let energy = p.counters.energy ?? 0;
  for (const part of plan.other) {
    switch (part.kind) {
      case 'payLife':
        if (part.amount > 0 && playerRestricted(s, player, 'cantLoseLife')) return deny(`You can't pay ${part.amount} life: you can't lose life.`, 'CR 119.8', 'CR 119.4', 'CR 118.3');
        if (part.amount > 0 && cantDo(s, 'payLife', player)) return deny(`You can't pay ${part.amount} life: a "can't pay life" effect forbids it.`, 'CR 119.4', 'CR 614.17b', 'CR 118.3'); // WP31
        if (life < part.amount) return deny(`You can't pay ${part.amount} life with only ${life} life.`, 'CR 119.4', 'CR 118.3');
        life -= part.amount;
        break;
      case 'payEnergy':
        if (energy < part.amount) return deny(`You can't pay ${part.amount} energy with only ${energy}.`, 'CR 107.14', 'CR 118.3');
        energy -= part.amount;
        break;
      case 'removeCounters':
        if (!part.filter && (!src || countersFor(src.counters, part.counter) < part.count)) return deny(`Not enough ${part.counter === 'any' ? '' : `${part.counter} `}counters to remove.`, 'CR 118.3');
        // r3-cost (CR 118.3): "from among <permanents>": that many in all on the permanents it describes
        if (part.among && countersAmong(s, player, sourceId, part) < part.count) return deny(`Not enough ${part.counter === 'any' ? '' : `${part.counter} `}counters among those permanents to remove.`, 'CR 118.3', 'CR 122.1');
        break;
      case 'putCounters':
        if (part.self && (!src || src.zone !== 'battlefield')) return deny('There is nothing to put counters on.', 'CR 118.3');
        if (part.self && src && costUseDenial(s, player, src.id, 'putCounters')) return deny('Counters can\'t be put on this permanent, so this cost can\'t be paid.', 'CR 122.6', 'CR 614.17b'); // WP31
        break;
      case 'mill':
        if ((s.zones.library[player]?.length ?? 0) < part.count) return deny(`You can't mill ${part.count} cards: your library has fewer.`, 'CR 701.17b', 'CR 118.3');
        break;
      case 'exert':
        // FAST5X E28, CR 701.43c: an object that isn't on the battlefield can't be exerted (CR 701.43b: an exerted or untapped one can)
        if (!src || src.zone !== 'battlefield') return deny('Only a permanent on the battlefield can be exerted.', 'CR 701.43c', 'CR 118.3');
        break;
      case 'forage': {
        const f = forageOptions(s, player); // WP31 review: only what a "can't" effect lets the player exile or sacrifice (CR 614.17b)
        if (f.yard.length < 3 && f.food.length === 0) return deny('You can\'t forage: you have neither three cards in your graveyard you can exile nor a Food you can sacrifice.', 'CR 701.61a', 'CR 118.3', 'CR 614.17b');
        break;
      }
      case 'discard': {
        // WP31 review: "discard your hand" can't be paid when a "can't" effect forbids discarding a card of it (CR 701.9, 614.17b). A spell being cast is not
        // in the hand by then (CR 601.2a).
        const spell = plan.spend?.kind === 'spell' ? plan.spend.id : undefined;
        const cant = part.hand ? (s.zones.hand[player] ?? []).filter((id) => id !== spell).map((id) => cantDo(s, 'discard', player, id)).find((d) => d !== null) : undefined;
        if (cant) return deny(`You can't discard your hand. ${cant.message}`, 'CR 701.9', 'CR 614.17b');
        break;
      }
      case 'revealChosen': // std-combat-5 (CR 118.3, 608.2d): nothing was chosen (or the source is gone): there is nothing to reveal
        if (!src || (src.links?.[part.link]?.values ?? []).length === 0) return deny('Nothing was chosen, so there is nothing to reveal.', 'CR 118.3', 'CR 607.2d');
        break;
      case 'getCounters': {
        // FAST5X E27 (CR 122.1f, 614.17b): a player who can't get counters can't pay "get N poison counters"
        const cant = part.amount > 0 ? cantDo(s, 'haveCountersPut', player) : null;
        if (cant) return deny(`You can't get poison counters, so this cost can't be paid. ${cant.message}`, 'CR 122.1f', 'CR 614.17b', 'CR 118.3');
        break;
      }
      case 'confirm':
        break;
      case 'manual':
        return deny(`This cost can't be paid automatically yet: ${part.text}`, 'CR 118.3');
      default:
    }
    if (isPickPart(part) && !pickFeasible(s, player, sourceId, plan, part)) return deny(`You don't have enough permanents or cards to pay: ${partText(part)}.`, 'CR 118.3');
  }
  // Each object can pay only one part (two "Sacrifice a creature" parts need two creatures, CR 118.3).
  if (!findAssignment(s, player, sourceId, plan, [], false)) return deny('Those cost parts need the same permanents or cards, so they can\'t all be paid.', 'CR 118.3');
  return null;
}

/** CR 701.61a: does the player control a Food? */
export function hasFood(s: GameState, player: PlayerId): boolean {
  return foods(s, player).length > 0;
}

/** The Foods a player controls (Artifact — Food, CR 701.61a). */
export function foods(s: GameState, player: PlayerId): ObjectId[] {
  return s.zones.battlefield.filter((id) => {
    const o = s.objects[id];
    return o !== undefined && o.controller === player && !o.phasedOut && charsOfObject(s, o).subtypes.includes('Food');
  });
}

/**
 * CR 701.61a, 614.17b (WP31 review): what can pay a forage: the graveyard cards a "can't" effect lets the player exile and the Foods it lets the player
 * sacrifice ("cards in graveyards can't be exiled", "artifacts can't be sacrificed").
 */
export function forageOptions(s: GameState, player: PlayerId): { yard: ObjectId[]; food: ObjectId[] } {
  return {
    yard: (s.zones.graveyard[player] ?? []).filter((id) => costUseDenial(s, player, id, 'exile') === null),
    food: foods(s, player).filter((id) => costUseDenial(s, player, id, 'sacrifice') === null),
  };
}

let manaUncounted = false;

/**
 * AP1 review: runs a pure read in which every mana payment counts as payable (`manaDenial` answers null; the other cost parts are still checked). For a player
 * who controls a mana ability the engine leaves to them (a painland's colored ability, City of Brass, Ancient Tomb: activated by hand, CR 605.3b), the engine
 * can't tell what mana they could make, so smart auto-pass (core/legal.ts#hasPriorityActions) asks whether an action would be legal if the mana were there,
 * and stops for the player rather than pass for them silently. Synchronous and restored on exit, so nothing outside the read sees it.
 */
export function assumingManaPayable<T>(read: () => T): T {
  const was = manaUncounted;
  manaUncounted = true;
  try {
    return read();
  } finally {
    manaUncounted = was;
  }
}

/**
 * Whether the mana part of a plan could be paid (floating mana plus mana abilities, CR 601.2g-h) given what the other cost
 * parts use up: a permanent that is sacrificed or returned can still be tapped for mana first, one that is tapped for a
 * cost can't (see cost-pick.ts).
 */
export function manaDenial(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan): Denial | null {
  if (plan.mana.length === 0 || manaUncounted) return null;
  return findAssignment(s, player, sourceId, plan, [], true) ? null : deny(`You can't pay ${manaCostText(plan.mana)} with the mana you can produce.`, 'CR 601.2h', 'CR 118.3');
}

export function planDenial(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan): Denial | null {
  if (hasOneOf(plan)) return firstPayable(plan, (o) => planDenial(s, player, sourceId, o)); // FAST5X E27 (CR 601.2b, 118.3)
  if (hasWaterbend(plan)) return waterbendDenial(s, player, sourceId, plan);
  return partsDenial(s, player, sourceId, plan) ?? manaDenial(s, player, sourceId, plan);
}

/**
 * FAST5X E10, CR 701.67a, 118.3: a plan with a waterbend cost can be paid when some number of taps (0 to the cap, each paying {1} of the waterbend cost's generic
 * mana) leaves the rest payable. The denial is the one of paying it all with mana. Pure.
 */
function waterbendDenial(s: GameState, player: PlayerId, sourceId: ObjectId | null, plan: CostPlan): Denial | null {
  const tap: PickPart = { kind: 'tapUntapped', filter: WATERBEND_TAPS, count: 1 };
  const cap = Math.min(waterbendCap(plan), pickCandidates(s, player, sourceId, plan, tap).length);
  let first: Denial | null = null;
  for (let k = 0; k <= cap; k++) {
    const d = planDenial(s, player, sourceId, waterbendWith(plan, k));
    if (!d) return null;
    first ??= d;
  }
  return first;
}

/**
 * The largest X the player can afford for a cost built by `makePlan(x)`, or -1 if even X = 0 is unaffordable.
 * Cost grows with X, so the scan stops at the first unaffordable value (capped to keep it cheap).
 */
export function maxAffordableX(s: GameState, player: PlayerId, sourceId: ObjectId | null, makePlan: (x: number) => CostPlan, cap = 60): number {
  const xs = payableXs((x) => planDenial(s, player, sourceId, makePlan(x)) === null, false, cap);
  return xs.length ? xs[xs.length - 1]! : -1;
}

/**
 * The values of X (0 to `cap`, ascending) for which `payable(x)` holds (CR 107.3a, 601.2h). A cost that only grows with X stops at the first unpayable value;
 * with `scanAll` (an X in a part's filter, `costFilterHasX`: "an artifact with mana value X" fits only some values) every value is tried.
 */
export function payableXs(payable: (x: number) => boolean, scanAll: boolean, cap = 60): number[] {
  const out: number[] = [];
  for (let x = 0; x <= cap; x++) {
    if (payable(x)) out.push(x);
    else if (!scanAll) break;
  }
  return out;
}
