/**
 * The ways a card may be cast beyond paying its mana cost: additional costs (kicker, multikicker, buyback, entwine; or mandatory ones such as
 * "As an additional cost to cast this spell, discard a card", CR 118.8, 601.2b) and alternative costs (flashback, evoke, escape, "rather than pay this spell's
 * mana cost", CR 118.9). Owner: WP7.
 *
 * Source of truth (design 7.2, 9.5): the `additionalCost` / `alternativeCost` static effects on the card, which is what the keyword library (WP3) expands
 * `kicker`, `buyback`, `flashback`, `evoke`, `entwine`, ... into. Until the library's data is merged the milestone 3 spellings are still read: a printed
 * `kicker`, `multikicker` or `flashback` keyword ability with a cost. A static effect wins over a keyword of the same name.
 *
 * An alternative cost is a cast METHOD: `Action.cast.method` is its `name` (the way milestone 3 selected flashback). What was paid is recorded in
 * `CostsPaid` (and copied to `GameObject.cast` when the spell becomes a permanent, CR 400.7d): `kicked` counts payments of every kicker cost ("kicker",
 * "kicker:2", ...; multikicker counts each; CR 702.33d, M6-5a), `additional` lists the name of every optional additional cost paid (once per payment), `alternative` is the method.
 */
import type { AdditionalCostDef, AltCostDelay, AlternativeCostDef, CastWithDef, Condition, CostDef, Quantity, StaticEffect, TargetSpec, ZoneName } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject } from '../types/state';
import type { Game } from '../core/game';
import type { BaseChars, Chars } from '../rules/characteristics';
import { printedKeywordExpansions } from '../statics/abilities';
import { BACK_FACE_CAST_OPTIONS } from './cast-opt/back-face';
import { FACE_DOWN_CAST_OPTIONS } from './cast-opt/face-down';
import { MUTATE_CAST_OPTIONS } from './cast-opt/mutate';
import { PREPARE_CAST_OPTIONS } from './cast-opt/prepare';
import { PROTOTYPE_CAST_OPTIONS } from './cast-opt/prototype';
import { BESTOW_CAST_OPTIONS } from './cast-opt/bestow';
import { PLOT_CAST_OPTIONS } from './cast-opt/plot';
import { FORETELL_CAST_OPTIONS } from './cast-opt/foretell';
import { AIRBEND_CAST_OPTIONS } from './cast-opt/airbend';

// ---- cast options from keywords and layouts (M6-0, m6 design 2.6; CR 601.2b-c, 601.2f) --------------------------------------------------------------

/**
 * A way to cast a card that changes what the spell IS, not only what it costs: face down (morph, megamorph, disguise: M6-3), back face up (disturb: M6-4),
 * prototyped and the exile copy of a prepare spell (M6-6), mutating (M6-9). Its `name` is a cast method (`Action.cast.method`). actions/cast.ts#castCheck
 * applies `charsOverride` BEFORE the timing, prohibition and "can't cast" checks, so they are judged on the characteristics the spell has from the moment it
 * is announced (CR 708.4, 718.3a-b, 712.8c); castSpell adds `extraTargets` and calls `onStack`.
 */
export interface CastOptionProvider {
  name: string; // 'morph' | 'megamorph' | 'disguise' | 'prototype' | 'backFace' | 'mutate' | 'prepare' | 'airbend' (FAST5X E10)
  /** The objects this provider lets `player` cast now, beyond the hand (prepare: the exile copy, CR 722.3c). */
  castable?(g: Game, player: PlayerId): ObjectId[];
  /** Offered for this object? (keyword present, zone, CR 702.37a "any zone from which you could play it"). */
  offers(g: Game, o: GameObject, player: PlayerId): boolean;
  /** Alternative cost (CR 118.9), or null for the normal cost. */
  cost(g: Game, o: GameObject): CostDef | null;
  /** The characteristics the spell has from the moment it is announced (CR 708.4 face-down, 718.3a-b prototype, 712.8c back face; mutate keeps the card's). */
  charsOverride?(def: CardDef, face: number): BaseChars;
  /** Targets added by the option (mutate: a non-Human creature with the same owner, CR 702.140a). */
  extraTargets?(g: Game, o: GameObject): TargetSpec[];
  /** Status the spell gets on the stack (faceDown + faceDownInfo, prototyped, back face up, mutating). */
  onStack(g: Game, spell: GameObject): void;
  /**
   * M6-3 INTERFACE CHANGE (additive): the card is turned face down BEFORE it is put onto the stack (CR 708.4), so the zone change (its event and log) never names
   * it; actions/cast.ts moves it with `faceDown` and names it "a face-down spell" in its log lines and prompts (CR 708.5).
   */
  faceDown?: boolean;
}

/** The cast option providers (each in its owner's file); empty in M6-0, so every cast is the milestone 5 cast. */
export const CAST_OPTION_PROVIDERS: readonly CastOptionProvider[] = [
  ...FACE_DOWN_CAST_OPTIONS, ...BACK_FACE_CAST_OPTIONS, ...PROTOTYPE_CAST_OPTIONS, ...PREPARE_CAST_OPTIONS, ...MUTATE_CAST_OPTIONS, ...PLOT_CAST_OPTIONS, // FAST5X E6: CR 702.170d
  ...AIRBEND_CAST_OPTIONS, // FAST5X E10: a card exiled by airbending, cast by its owner for {2} (CR 701.65a)
  ...FORETELL_CAST_OPTIONS, // cloud r3-mech: a foretold card, cast by its owner on a later turn for its foretell cost (CR 702.143a)
  ...BESTOW_CAST_OPTIONS, // std-ry7: cast for its bestow cost as an Aura spell with enchant creature (CR 702.103a-b)
];

/** The provider whose method this is (an alternative cost of the card's own text wins: castCheck looks there first). */
export const castOptionProvider = (method: string | undefined): CastOptionProvider | undefined =>
  method === undefined ? undefined : CAST_OPTION_PROVIDERS.find((p) => p.name === method);

export interface AdditionalOption {
  /** The name linked abilities and `wasCast.kicked` use ("kicker", "buyback", "entwine"). Mandatory additional costs may be unnamed. */
  name: string | undefined;
  cost: CostDef;
  optional: boolean;
  /** Multikicker, replicate: may be paid any number of times (CR 702.33c). */
  repeatable: boolean;
  /** M6-5 (CR 601.2b): "sacrifice a creature or pay {3}": exactly one of the costs that share this group is paid (actions/cast-costs.ts#announceGroupedCosts). */
  choiceGroup?: string;
  /** FAST5X E1: paying it is choosing an opponent (gift, CR 702.174a); the choice goes to `CostsPaid.chosenPlayers[name]` (actions/cast-costs.ts). */
  choosePlayer?: 'opponent';
  /** std-costs-2 (CR 601.2b, 607.2d): paying it starts with choosing a creature type, remembered by the spell under the link (`AdditionalCostDef.chooseType`). */
  chooseType?: { what: 'creatureType'; link: string };
  /** r3-cost (CR 107.3, 601.2b): "X can't be greater than ...": the largest X that may be announced (`AdditionalCostDef.xMax`, actions/cast.ts). */
  xMax?: Quantity;
  /** std-costs-1 (CR 601.2b, 601.2f): the number of its "any number" part is announced with it (`AdditionalCostDef.announceCount`, actions/cast-costs.ts). */
  announceCount?: true;
}

export interface AlternativeOption {
  name: string;
  cost: CostDef;
  /** The zone the card is cast from this way (flashback: graveyard); absent = the usual places (hand, exile on an adventure). */
  from?: ZoneName;
  /** "If ..." restriction on using it (read at announcement, `announce-cond.ts`). */
  when?: Condition;
  /** FAST5X E2: what happens to the permanent the spell becomes (warp's delayed exile, CR 702.185a; `AlternativeCostDef.delay`). */
  delay?: AltCostDelay;
  /** FAST5X E7 (CR 702.190a): cast this way at instant speed while `when` holds (sneak; `AlternativeCostDef.instantSpeed`). */
  instantSpeed?: true;
  /** FAST5X E7 (CR 702.190b): the permanent enters tapped and attacking what the returned creature attacked (`AlternativeCostDef.entersAttacking`). */
  entersAttacking?: 'returned';
  /** FAST5X E6: only on a card its owner discarded this turn (mayhem, CR 702.187b; `AlternativeCostDef.discardedThisTurn`). */
  discardedThisTurn?: true;
  /** FAST5X E6: tap up to one untapped creature you control to reduce the total cost by its power (harmonize, CR 702.180a-b). */
  tapReduces?: 'power';
  /** FAST5X E6: exile the card any time it would leave the stack (harmonize, CR 702.180a). */
  exileOnLeave?: true;
}

export interface CastOptions {
  additional: AdditionalOption[];
  alternatives: AlternativeOption[];
}

const isAdditional = (e: StaticEffect): e is AdditionalCostDef => e.s === 'additionalCost';
const isAlternative = (e: StaticEffect): e is AlternativeCostDef => e.s === 'alternativeCost';
const isCastWith = (e: StaticEffect): e is CastWithDef => e.s === 'castWith';

/**
 * CR 702.33d-f (M6-5a): every kicker cost counts towards "kicked": the first is named "kicker", later ones "kicker:2", "kicker:3" (keywords/expand.ts `$ordinal`,
 * "Kicker {A} and/or {B}"), and multikicker's payments are kicker payments too. `wasCast.kicked: true` reads the count; a name reads that one cost.
 */
export const isKickerName = (name: string | undefined): boolean => name === 'kicker' || (name !== undefined && name.startsWith('kicker:'));

/**
 * The cast method name of an alternative cost (`Action.cast.method`): its own name, or `<name>:2`, `<name>:3` for a second cost of the same name on the face (two
 * "You may ... rather than pay this spell's mana cost" lines are two different methods, CR 118.9, and the first must stay selectable by its name).
 */
function uniqueName(taken: readonly AlternativeOption[], name: string): string {
  if (!taken.some((a) => a.name === name)) return name;
  let n = 2;
  while (taken.some((a) => a.name === `${name}:${n}`)) n++;
  return `${name}:${n}`;
}

/**
 * The additional and alternative costs of the characteristics (CR 118.8-118.9): their static effects, including the ones the keyword library generates from
 * the printed keywords (kicker, multikicker, buyback, entwine, evoke, ...). `faceChars` holds printed abilities only, so their expansions are made here
 * (statics/abilities.ts#printedKeywordExpansions, with the kicker ordinals); a keyword already expanded in `c` is not expanded twice. M6-5a fix: before it,
 * only the milestone 3 kicker / multikicker / flashback spellings below were read, and buyback, entwine and evoke were never offered.
 */
export function castOptionsOf(c: Chars): CastOptions {
  const additional: AdditionalOption[] = [];
  const alternatives: AlternativeOption[] = [];
  const expanded = new Set(c.abilities.flatMap((a) => (a.parent !== undefined ? [a.parent] : [])));
  const abilities = [...c.abilities, ...printedKeywordExpansions(c.abilities.filter((a) => !expanded.has(a.key)), c)];
  const castWith: CastWithDef[] = [];
  for (const a of abilities) {
    if (a.def.kind !== 'static') continue;
    for (const e of a.def.effects) {
      if (isAdditional(e)) additional.push({ name: e.name, cost: e.cost, optional: e.optional === true, repeatable: e.repeatable === true, ...(e.choiceGroup !== undefined ? { choiceGroup: e.choiceGroup } : {}), ...(e.choosePlayer !== undefined ? { choosePlayer: e.choosePlayer } : {}), ...(e.chooseType !== undefined ? { chooseType: e.chooseType } : {}), ...(e.xMax !== undefined ? { xMax: e.xMax } : {}), ...(e.announceCount === true && e.name !== undefined ? { announceCount: true as const } : {}) });
      else if (isAlternative(e)) {
        alternatives.push({
          name: uniqueName(alternatives, e.name), cost: e.cost, ...(e.from ? { from: e.from } : {}), ...(e.when ? { when: e.when } : {}), ...(e.delay ? { delay: e.delay } : {}),
          // FAST5X E7: sneak (CR 702.190a-b)
          ...(e.instantSpeed ? { instantSpeed: true as const } : {}), ...(e.entersAttacking ? { entersAttacking: e.entersAttacking } : {}),
          // FAST5X E6: mayhem (CR 702.187b) and harmonize (CR 702.180a-b)
          ...(e.discardedThisTurn ? { discardedThisTurn: true as const } : {}), ...(e.tapReduces ? { tapReduces: e.tapReduces } : {}), ...(e.exileOnLeave ? { exileOnLeave: true as const } : {}),
        });
      }
      else if (isCastWith(e)) castWith.push(e);
    }
  }
  // FAST5X E2 (CR 601.3, 113.6f): "you may cast this card from your graveyard using its warp ability": the same cost (and its static abilities, CR 702.185a)
  // from that zone too, as a method of its own (`warp:2`: "cast for its warp cost" still reads it, triggers/match.ts#castVia)
  for (const w of castWith) {
    for (const alt of alternatives.filter((x) => x.name === w.method && x.from === undefined)) alternatives.push({ ...alt, name: uniqueName(alternatives, alt.name), from: w.from });
  }
  // Milestone 3 keyword spellings, for the names that no static effect provides.
  for (const k of c.keywords) {
    // FAST5 T56 (CR 702.34a): "The flashback cost is equal to its mana cost": the card's own mana cost, as a card in a graveyard has it
    if (k.keyword === 'flashback' && k.costIsManaCost === true && k.cost === undefined) {
      if (c.manaCost !== null && !alternatives.some((o) => o.name === 'flashback')) alternatives.push({ name: 'flashback', cost: { mana: c.manaCost }, from: 'graveyard' });
      continue;
    }
    // cloud r3-mech (CR 702.187b, 118.9): "The mayhem cost is equal to its mana cost": cast from the graveyard for its own mana cost if its owner discarded it this turn
    if (k.keyword === 'mayhem' && k.costIsManaCost === true && k.cost === undefined) {
      if (c.manaCost !== null && !alternatives.some((o) => o.name === 'mayhem')) alternatives.push({ name: 'mayhem', cost: { mana: c.manaCost }, from: 'graveyard', discardedThisTurn: true });
      continue;
    }
    if (!k.cost) continue;
    if (k.keyword === 'kicker' && !additional.some((o) => isKickerName(o.name))) additional.push({ name: 'kicker', cost: k.cost, optional: true, repeatable: false });
    else if (k.keyword === 'multikicker' && !additional.some((o) => isKickerName(o.name))) additional.push({ name: 'kicker', cost: k.cost, optional: true, repeatable: true });
    else if (k.keyword === 'flashback' && !alternatives.some((o) => o.name === 'flashback')) alternatives.push({ name: 'flashback', cost: k.cost, from: 'graveyard' });
  }
  return { additional, alternatives };
}

/** The names of the ways to cast the card other than normally (fuse is not a cost and is handled by the caller). */
export const methodNames = (o: CastOptions): string[] => o.alternatives.map((a) => a.name);
