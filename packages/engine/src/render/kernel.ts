/**
 * The knot of the renderer (WP2). The renderers of filters, references, quantities, conditions, events, costs, steps and statics call each other
 * (a quantity counts a filter, a filter compares a quantity, a condition holds an event ...). The import rules forbid import cycles, so these calls
 * go through the table `K`, which `render/boot.ts` fills once with the implementations. Implementation modules import only `K` (and types); the
 * public modules (render/filter.ts, render/step.ts, ...) import `boot` first, so `K` is always complete before any renderer runs.
 */
import type { Condition, CostDef, Duration, EffectProgram, EffectStep, EventPattern, ObjectFilter, ObjRef, PlayerPred, PlayerRef, Quantity, StaticEffect, TargetSpec, AbilityDef } from '../types/ability';
import type { Clause } from './clause';
import type { Form, Phrase, RenderState } from './state';

/** How a noun phrase is introduced. */
export interface NpOpts {
  /** The determiner: "a creature", "the creature", "target creature", "all creatures", "each creature", "any creature", none ("creatures you control"). */
  det?: 'a' | 'the' | 'target' | 'all' | 'each' | 'any' | 'none';
  /** Plural noun ("creatures"). */
  plural?: boolean;
  /** Do not print the zone of a card ("search your library for a basic land card" already says the zone). */
  noZone?: boolean;
  /** Do not print the controller ("you control a creature": the condition prints it before the noun). */
  noController?: boolean;
  /** Force the head noun ("spell" for a mana restriction whose filter has no stack kind). */
  head?: string;
  /** A count word before the noun ("two", "up to two", "X"). Replaces the article. */
  count?: string;
  /**
   * FAST3 T12 ADDITION (optional): the noun follows "for each" ("for each Swamp your opponents control"): a singular noun whose controller is every opponent
   * also reads "your opponents control", as it does after "each" (CR 109.5; render/qty.ts#countParts sets it for the singular form).
   */
  forEach?: boolean;
  /** FAST3 T14: the zone is "a single graveyard" (`TargetSpec.sameOwner`: cards of one player's graveyard). */
  singleZone?: boolean;
  /** FAST5 T42: the targets have different names (`TargetSpec.differentNames`): "cards with different names". */
  differentNames?: boolean;
  /**
   * FAST5 T66: the objects chosen together keep a total (`TargetSpec.groupLimit`, `chooseObjects.groupLimit`): the words "total mana value 4 or less", said as a "with" feature
   * (in front of or behind the zone: "creature cards with total mana value 4 or less from your graveyard").
   */
  total?: string;
  /** CLOUD std-ecl: the targets share a creature type (`TargetSpec.sharedCreatureType`): "creature cards that share a creature type", in front of or behind the zone. */
  shareCreatureType?: boolean;
  /**
   * std-rx11: a plural noun says what each object has ONLY as "each with" in the singular ("one or more creatures you control each with power greater than its base
   * power", Kutzil, Malamet Exemplar); with no "with" feature there is no such wording (NoRenderer).
   */
  eachWithSingular?: boolean;
}

export interface QtyOpts {
  /** Where the value is printed: a bare number, or "equal to ..." for a computed one. */
  as?: 'plain' | 'equal';
}

export interface EventOpts {
  /** "One or more" trigger (CR 603.2c): the subject is plural and counted once for the batch. */
  batch?: boolean;
  /** CLOUD std-misc: with `batch`, the acting players are counted together too ("one or more players discard one or more cards", TriggerDef.wholeBatch). */
  wholeBatch?: boolean;
}

export interface JoinOpts {
  /** Inside a `may`/`then` list: no sentence break between the items. */
  nested?: boolean;
  /**
   * r3-refs: the list is the instructions of a delayed trigger that waits for an event (CR 603.7): with `nested`, its items may also be sentences of their own
   * ("Whenever a creature you control attacks this turn, put a +1/+1 counter on it. It gains trample until end of turn."; parser/lower/anaphora.ts#foldIntoDelay).
   */
  sentences?: boolean;
  /** The player the clauses are written for (the one of the enclosing `may`/`pay`): their clauses are printed without a subject. */
  actor?: string | null;
}

export interface Kernel {
  np(f: ObjectFilter, st: RenderState, o?: NpOpts): string;
  /** FAST5 T42: only the zone words of a filter's cards ("from your graveyard"), for a zone said once after several phrases. */
  zoneTail(f: ObjectFilter, st: RenderState): string;
  /** Singular head nouns and plurality of what a filter describes ("creature", "card"): the words an anaphor can use. */
  nounsOf(f: ObjectFilter): string[];
  /** `prefer`: which quantifier a set of objects shows first ("deals 1 damage to each creature" / "destroy all creatures"); the other is an alternative. */
  obj(ref: ObjRef, st: RenderState, form: Form, o?: { prefer?: 'all' | 'each' }): Phrase;
  player(ref: PlayerRef | PlayerPred, st: RenderState, form: Form): Phrase;
  specPhrase(spec: TargetSpec, st: RenderState, extra?: NpOpts): string;
  qty(q: Quantity, st: RenderState, o?: QtyOpts): string;
  /** True when the quantity is a plain number (the caller prints it as a count word instead of "equal to"). */
  isNumber(q: Quantity): q is number;
  cond(c: Condition, st: RenderState): string;
  /** An event as a clause: tense 'present' ("a creature dies"), 'past' ("a creature died"), 'would' ("a creature would die"). */
  event(ev: EventPattern, st: RenderState, tense: 'present' | 'past' | 'would', o?: EventOpts): string;
  events(list: EventPattern[], st: RenderState, tense: 'present' | 'past' | 'would', o?: EventOpts): string;
  dur(d: Duration, st: RenderState, o?: { context?: 'mods' | 'rule' }): string;
  cost(c: CostDef, st: RenderState): string;
  costParts(c: CostDef, st: RenderState): string[];
  costVerbs(c: CostDef, st: RenderState, person: 'you' | 'sg' | 'pl', times?: Quantity): string;
  clause(step: EffectStep, st: RenderState): Clause;
  steps(list: EffectStep[], st: RenderState, o?: JoinOpts): string;
  program(p: EffectProgram, st: RenderState): string;
  ability(def: AbilityDef, st: RenderState): string;
  staticEffect(e: StaticEffect, st: RenderState, o?: { duration?: Duration }): string;
  staticEffects(list: StaticEffect[], st: RenderState): string;
  /** r4-cost: the amount of a cost change and its "for each ..." tail (render/stat.ts#costAmount), for a keyword's cost change (render/kw.ts). */
  costAmount(change: { generic?: Quantity; mana?: import('../types/mana').ManaCost; times?: Quantity }, st: RenderState): { amount: string; per: string };
}

/** Filled by render/boot.ts. */
export const K = {} as Kernel;
