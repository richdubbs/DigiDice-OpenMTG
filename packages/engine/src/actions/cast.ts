/**
 * Casting a spell (CR 601.2a-i). The action names the card, optionally a face (split half, adventure,
 * modal double-faced back face) and a method (an alternative cost such as "flashback" or "evoke"). Everything else
 * is asked as cancellable decisions in the order of the rules, so cancelling reverses the whole action (CR 733.1).
 *
 *   601.3   permission: zone, card type, timing, face, payability and targets are checked first
 *   601.2a  the card moves to the stack (a new object, CR 400.7); the caster controls it
 *   601.2b  the way it is cast (alternative cost = the method, CR 118.9), optional additional costs (kicker, buyback, entwine; mandatory ones are simply added,
 *           CR 118.8), modes (CR 700.2; the kicked / entwined choice comes first because it can change how many modes, CR 601.4), the value of X
 *   601.2c  targets (counts, distinctFrom, groupLimit, onlyIf, chooser), 601.2d the division
 *   601.2f  total cost = base (mana cost or alternative cost) + additional costs + mode costs, then cost modifiers (statics/costmods.ts, WP16), then payment options
 *   601.2g-h  payment (rules/pay.ts)
 *   601.2i  the spell becomes cast: events, log, spells-cast count
 *
 * Owner: WP7. The costs a card offers come from its `additionalCost` / `alternativeCost` statics (actions/cast-options.ts).
 *
 * X (CR 107.3a): announced when ANY cost that will be paid has one (the mana cost, an alternative cost, a mandatory or chosen additional cost, the cost of a chosen
 * mode); every one of those costs is built again with the announced X (`planFromCostDefs`).
 *
 * DEVIATIONS from the design, on purpose:
 *   - EMERGE (CR 702.119) is native here, keyed on the alternative cost NAMED "emerge" (a cost with a sacrifice part), not a `paymentOptions` hook (design 7.3 / 8.2.6):
 *     the PaymentOption contract reduces the mana by a fixed amount per object, while emerge reduces it by the sacrificed creature's MANA VALUE, which is known only
 *     once the creature is named (CR 702.119c, at announcement, before the total cost is determined). The reduction is applied to the TOTAL cost (CR 601.2f).
 *     A keyword expansion for emerge must therefore produce `alternativeCost { name: 'emerge', cost: { mana, other: [sacrifice a creature] } }`.
 *   - Restricted mana (CR 106.6, Cavern of Souls) is enforced where the mana providers are built (rules/sources.ts `buildProviders`, `spendAllows`), not in the solver
 *     (design 15.2): the solver only sees providers that may pay, which is equivalent and keeps the Hungarian matching unchanged.
 *   - "That spell can't be countered" leaves `FLAG_CANT_BE_COUNTERED` in `StackInfo.flags` of the spell; `hookpoints.canBeCountered` consumers (WP10 / WP16) read that flag.
 */
import type { Action } from '../types/actions';
import type { CostDef, CounterSpec, Destination, EffectProgram, KeywordAbilityDef, Quantity } from '../types/ability';
import type { CardDef } from '../types/card';
import type { ObjectId, PlayerId } from '../types/ids';
import { castOriginOf, type CostsPaid, type GameObject, type GameState, type ManaUnit } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import { putReflexiveTrigger } from '../triggers/stack';
import { holdStill } from '../statics/stable-scope';
import { keywordRegistry } from '../keywords/registry';
import { Game, IllegalAction } from '../core/game';
import { moveObject } from '../core/zones';
import { canSee } from '../core/view';
import { charsOfObject, combinedChars, faceChars, hasKeyword, hasSubtype, hasType, ptNumbers, type BaseChars, type Chars } from '../rules/characteristics';
import { charAbilitiesOfBase, keywordsOfAbilities, printedKeywordExpansions } from '../statics/abilities';
import { auraTargetProgram } from '../rules/attachment';
import { castRestrictionDenial, castRestrictionOf, isCastRestrictionLine } from '../rules/cast-restriction';
import { addPlans, costFilterHasX, manaCostText, costHasX, countX, emptyPlan, payableXs, planFromCostDef, planFromCostDefs, substituteX, type CostPlan, type CostX, type PlanPart } from '../rules/cost';
import { hasRestrictedMana, type SpendContext } from '../rules/sources';
import { programFiltersMentionX } from '../rules/targets';
import { deny, assertAllowed, throwDenial, type Denial } from '../rules/denial';
import { happenedCountOf } from '../rules/history';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { payPlan, resolveAnyCounts } from '../rules/pay';
import { applyPaymentOptions, emergePayableCandidates, emergeReduction, payableWithOptions, reduceGeneric } from '../rules/payment-options';
import { partCandidates } from '../rules/cost-pick';
import { castTiming, splitSecondDenial } from '../rules/timing';
import { announceCond, type AnnounceEnv } from './announce-cond';
import { OVERLOAD, overloadablePrograms } from '../effects/overload';
import { announceTargets, chooseModes, chooseX, describeTargets, effectivePrograms, emitBecameTarget, modeCosts, modesDenial, programsDenial } from './announce';
import { CAST_OPTION_PROVIDERS, castOptionProvider, castOptionsOf, isKickerName, type AdditionalOption, type AlternativeOption, type CastOptionProvider } from './cast-options';
import { announceMandatoryCosts, announceOptionalCosts, commanderTaxCost, countCap, groupedCostsDenial, ungroupedMandatoryCosts, withAnnouncedCount } from './cast-costs';
import { commanderOfCard, isCommander } from '../statics/commander';
import { costModsFor, modifyMana, type CostModHit } from '../statics/costmods';
import { spellTargetTotal } from '../rules/target-total';
import { charsViewOf, overlayAsSpell } from '../statics/rule-sources';
import { evalQuantity } from '../statics/match';
import { anyManaColorPermit, anyManaTypePermit, type GrantedAlternative, grantedAlternatives, graveyardInsteadPermit, graveyardMethod, graveyardMethodIndex, graveyardPermitUses, type GraveyardUse, isGrantedAltMethod, isLinkedFreeMethod, isNamedFreeMethod, lifeCostOf, linkedPermitLifeCost, linkedPermitUses, type LinkedUse, namedPermit, namedPermitAdventureOnly, namedPermitIncrease, namedSingleKey, outsideCastUses, paidCastPermitted, playPermitted, staticAnyManaType, topPermitFor } from '../statics/play-permits';
import { installResolutionCaster, type ResolutionCastOptions } from '../effects/cast-hook';
import { recordCastChecks } from './cast-checks';
import { lockNextSpellKeywords, takeNextSpellRiders } from '../core/turn-effects';
import { applySpentRiders } from '../core/mana-riders';
import { emitCrime, recordSpellMana } from '../rules/crime';

/**
 * Faces of a layout that a player may choose to cast. Back faces of transform/flip/meld cards are never cast (CR 712.8c, 710.2), except that an effect that
 * casts a transforming double-faced card "transformed" casts only its back face (CR 712.11a; FXC). Any other card can't be cast transformed: no face.
 */
function castableFaces(def: CardDef, transformed = false): number[] {
  if (transformed) return def.layout === 'transform' && def.faces.length > 1 ? [1] : [];
  switch (def.layout) {
    case 'split': // CR 709.3
    case 'adventure': // CR 715.3
    case 'modal_dfc': // CR 712.11b
      return def.faces.map((_, i) => i);
    default:
      return [0];
  }
}

export function keywordOf(c: Chars, keyword: string): KeywordAbilityDef | undefined {
  for (const a of c.abilities) if (a.def.kind === 'keyword' && a.def.keyword === keyword) return a.def;
  return undefined;
}

/**
 * The spell abilities of a face (CR 113.3a): the programs that run when the spell resolves. An Aura spell also requires a target,
 * which its enchant ability defines (CR 303.4a); it has no steps because attaching is part of entering the battlefield (CR 303.4f).
 */
export function spellPrograms(c: Chars): EffectProgram[] {
  // std-ry3 (CR 601.2c, 702.113b): `faceChars` holds printed abilities only, so the spell abilities a printed keyword stands for (awaken's land target) are
  // expanded here, as castOptionsOf does for costs; a keyword already expanded in `c` is not expanded twice. They follow the printed abilities, as in the
  // characteristics of the spell on the stack (statics/abilities.ts#charAbilitiesOfBase), so the announced targets line up with core/resolve.ts's programs
  const expanded = new Set(c.abilities.flatMap((a) => (a.parent !== undefined ? [a.parent] : [])));
  const all = [...c.abilities, ...printedKeywordExpansions(c.abilities.filter((a) => !expanded.has(a.key)), c)];
  const programs = withModalKeywords(c, all.flatMap((a) => (a.def.kind === 'spell' ? [a.def.effect] : [])));
  const aura = auraTargetProgram(c);
  return aura ? [aura, ...programs] : programs;
}

/**
 * M6-5a: a keyword that modifies how many modes are chosen (the keyword data's `modifies: {kind: 'modal', chooseAll: {when}}`): entwine, CR 702.42a "You may
 * choose all modes of this spell instead of just the number specified. If you do, you pay an additional [cost]". It becomes the modal spec's `override`
 * (all modes when the entwine cost was announced, CR 601.2b, 601.4), which actions/announce.ts reads. A spec that already has an override of its own keeps it
 * (no printed card has both); the override is read only while announcing, so the resolution is unchanged (CR 700.2).
 */
function withModalKeywords(c: Chars, programs: EffectProgram[]): EffectProgram[] {
  const whens = c.keywords.flatMap((k) => {
    const m = keywordRegistry.get(k.keyword)?.modifies;
    return m !== undefined && m.kind === 'modal' && keywordRegistry.get(k.keyword)?.status === 'implemented' ? [m.chooseAll.when] : [];
  });
  if (whens.length === 0) return programs;
  return programs.map((p) => {
    if (!p.modes || p.modes.override) return p;
    const all = p.modes.options.length;
    return { ...p, modes: { ...p.modes, override: { when: whens.length === 1 ? whens[0]! : { cond: 'any', of: whens }, min: all, max: all } } };
  });
}

/** The flag a spell cast with Cavern of Souls mana carries in `StackInfo.flags` (CR 106.6): "that spell can't be countered". Read by `hookpoints.canBeCountered` consumers. */
export const FLAG_CANT_BE_COUNTERED = 'cantBeCountered';

export interface CastInfo {
  object: GameObject;
  face: number;
  chars: Chars;
  method: string | undefined;
  /** The base cost has an X (the mana cost, or the alternative cost when one is used, CR 107.3a); X in an additional cost or a mode's cost is found when those are chosen. */
  baseHasX: boolean;
  /** Both halves of a split card with fuse are cast together (CR 702.102a). */
  fused: boolean;
  programs: EffectProgram[];
  /** The mana cost or alternative cost for a given X (601.2f before additional costs); `'unannounced'` before X is announced (rules/cost.ts#CostX). */
  base: (x: CostX) => CostPlan;
  /** The alternative cost being used (`method`), CR 118.9. */
  alt?: AlternativeOption;
  /** Every additional cost of the card, optional and mandatory (CR 118.8). */
  additional: AdditionalOption[];
  /** M6-0 (m6 design 2.6): the cast option provider of `method` (face down, back face, prototype, prepare, mutate), when the method is one. */
  provider?: CastOptionProvider;
  /**
   * FAST5X E14 INTERFACE CHANGE (additive): cast from the top of the library by a once-each-turn permission ("Once each turn, you may cast ... from the top
   * of your library", CR 601.3): the key of its counter in `GameState.turnActivations`, spent as the card moves to the stack (statics/play-permits.ts).
   */
  topOnce?: string;
  /**
   * C10 INTERFACE CHANGE (additive): cast from the caster's graveyard by a graveyard permission (CR 601.3; statics/play-permits.ts#graveyardPermitUses): its
   * once-each-turn counter (spent as the card moves to the stack), its additional cost (a mandatory cost of this cast, CR 601.2f, 118.8) and the counters
   * the permanent enters with (CR 614.1c, recorded on the spell).
   */
  gyPermit?: GraveyardUse;
  /** std-exile-play-1-3 (CR 601.2f): "Each spell cast this way costs {1} more to cast": the increase of the permission for named objects it is cast with. */
  permitIncrease?: CostDef;
  /**
   * std-rx27 INTERFACE CHANGE (additive): cast from exile by a static linked permission with riders (CR 601.3, 607.2a; statics/play-permits.ts#linkedPermitUses):
   * its once-each-turn counter (spent as the card moves to the stack) and the counters the permanent enters with (CR 614.1c, recorded on the spell).
   */
  linkedPermit?: LinkedUse;
  /** std-rx27 (CR 614.1c): cast from the top of the library with a permission whose "enters with" rider applies to this spell (recorded on the spell). */
  topEnters?: { counters: CounterSpec[]; source: string };
  /** std-rx27 (CR 601.3): cast with a one-card permission ("you may play a card exiled with ~"): its counter, spent as the card moves to the stack. */
  singleKey?: string;
  /** std-rx10 (CR 601.3b, 118.8): the additional cost of the permission this spell is cast with as though it had flash ("if you behold a Dragon ..."). */
  flashAddCost?: CostDef;
  /**
   * FAST5X E29 INTERFACE CHANGE (additive), CR 609.4b: "mana of any type can be spent to cast that spell" (a permission's `anyManaType`, or a resolving effect's
   * `ResolutionCastOptions.anyManaType`): the spell's payments have `SpendContext.anyType`.
   */
  anyManaType?: true | 'color';
  /**
   * r5-repl INTERFACE CHANGE (additive), CR 614.1a: cast with a permission for this object that says "If that spell would be put into a graveyard, exile it
   * instead" (statics/play-permits.ts#graveyardInsteadPermit): recorded on the spell (`StackInfo.permitGraveyardInstead`).
   */
  permitGraveyard?: { to: Destination; source: string };
  /**
   * r3-cost INTERFACE CHANGE (additive), CR 118.9, 601.2b: cast for an alternative cost another object's static ability gives the spell ("You may pay
   * {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast"; statics/play-permits.ts#grantedAlternatives): its once-each-turn counter is spent as
   * the card moves to the stack; `source` names it in the label.
   */
  grantedAlt?: GrantedAlternative;
}

/**
 * The names of the alternative costs a face offers (the `method` values of a cast action besides "fuse"). M6-0: and the cast option providers that offer the
 * card to its owner (actions/cast-options.ts#CAST_OPTION_PROVIDERS; none in M6-0).
 */
export function castMethods(s: GameState, id: ObjectId, face: number, player?: PlayerId): string[] {
  const o = s.objects[id];
  const def = o && s.defs[o.defId];
  if (!def || face >= def.faces.length) return [];
  const own = castOptionsOf(withGrantedCosts(faceChars(def, face), s, o)).alternatives.map((a) => a.name); // M6-12: granted costs too
  // r3-cost (CR 118.9, 601.2b): the alternative costs other objects' static abilities give the spell, for the player who would cast it (default: its owner)
  own.push(...grantedAlternatives(s, player ?? o.owner, id, faceChars(def, face)).map((g) => g.method));
  // C10 (CR 601.3): several graveyard permissions that let its owner cast it in different ways (an additional cost, a rider) are a choice: one method each
  const gy = o.zone === 'graveyard' && o.kind === 'card' ? graveyardPermitUses(s, o.owner, id, faceChars(def, face)) : [];
  if (gy.length > 1) own.push(...gy.map((_, i) => graveyardMethod(i + 1)));
  // std-rx27 (CR 601.3): likewise several paid ways linked permissions let the player cast a card from exile (a free one is its granted alternative cost)
  const lnk = o.zone === 'exile' && o.kind === 'card' && player !== undefined ? linkedPermitUses(s, player, id, faceChars(def, face)).filter((u) => u.free !== true) : [];
  if (lnk.length > 1) own.push(...lnk.map((_, i) => graveyardMethod(i + 1)));
  if (CAST_OPTION_PROVIDERS.length === 0) return own;
  const g = new Game(s); // a reading view: offering changes nothing
  return [...own, ...CAST_OPTION_PROVIDERS.filter((p) => !own.includes(p.name) && p.offers(g, o, o.owner)).map((p) => p.name)];
}

/**
 * M6-12 (`feature:castCost.granted`, m6 design 3.8): the characteristics the cast path reads its additional and alternative costs from (CR 601.2b): the face
 * being cast, plus the abilities continuous effects GRANT to the card where it is now (CR 613.1f, 611.2: "target instant or sorcery card in your graveyard gains
 * flashback {2}{R}{G} until end of turn", a granted keyword or a granted cost static). Only the costs: every other check reads the face as before. A card on the
 * stack or the battlefield is not cast (CR 601.2a). Review fix: the grant may come from a permanent's static ability ("instant and sorcery cards in your graveyard
 * have flashback {1}{R}", CR 604.1, 611.3a), which has no entry in `s.continuousEffects`, so the card's characteristics are always read; `charsOfObject` is
 * already free when no layer source exists (`layerSourcesPresent`) and memoized otherwise.
 */
function withGrantedCosts(c: Chars, s: GameState, o: GameObject, caster: PlayerId = o.owner): Chars {
  if (o.zone === 'stack' || o.zone === 'battlefield') return c;
  const granted = charsOfObject(s, o).abilities.filter((a) => a.origin === 'granted');
  // FAST4 T24: and the abilities granted to it AS A SPELL its caster controls (CR 601.2a, 601.2b: its costs are determined on the stack): "each noncreature spell
  // you cast has conspire" (CR 613.1f). The overlay is built only when some permanent could grant one (statics/rule-sources.ts#overlayAsSpell).
  const s2 = overlayAsSpell(s, o.id, caster);
  if (s2 !== s) for (const a of charsOfObject(s2, s2.objects[o.id]!).abilities) if (a.origin === 'granted' && !granted.some((x) => x.key === a.key)) granted.push(a);
  if (granted.length === 0) return c;
  const abilities = [...c.abilities, ...granted];
  return { ...c, abilities, keywords: keywordsOfAbilities(abilities) };
}

/**
 * M6-0 (m6 design 2.6): the characteristics a cast option gives the spell from the moment it is announced (CR 708.4, 718.3a-b, 712.8c), as the cast path reads
 * them: the provider's base characteristics with their abilities keyed (statics/abilities.ts) and the caster as controller.
 */
function overriddenChars(base: BaseChars, controller: PlayerId): Chars {
  const abilities = charAbilitiesOfBase(base);
  return { ...base, controller, abilities, keywords: keywordsOfAbilities(abilities), cantHave: [] };
}

/**
 * r3-cost (CR 107.3, 601.2b; `AdditionalCostDef.xMax`): the largest X the caster may announce because of "X can't be greater than ..." on a mandatory additional
 * cost (Soul Immolation's "blight X. X can't be greater than the greatest toughness among creatures you control"), read now with the spell's caster as "you";
 * `Infinity` when no cost says one, undefined when one can't be read (the caller refuses the cast: never a guess).
 */
function xCap(s: GameState, player: PlayerId, spell: ObjectId, options: readonly AdditionalOption[]): number | undefined {
  let cap = Infinity;
  for (const o of options) {
    if (o.xMax === undefined || o.optional) continue;
    const n = evalQuantity({ s, all: charsViewOf(s), source: spell, controller: player }, o.xMax);
    if (n === undefined || !Number.isFinite(n)) return undefined;
    cap = Math.min(cap, Math.max(0, Math.floor(n)));
  }
  return cap;
}

/** The mandatory additional costs of a card (CR 118.8: always paid with the spell). */
// M6-5 (m6 design 3.8): a cost of a choice group ("sacrifice a creature or pay {3}", CR 601.2b) is not always paid: actions/cast-costs.ts#groupedCostsDenial
const mandatoryCosts = (options: AdditionalOption[]): CostDef[] => ungroupedMandatoryCosts(options);

/**
 * CR 601.3: may this player begin to cast this card? Pure: used by the action and by legalActions.
 * Includes a payability check at X = 0 (with the mandatory additional costs and the payment options) so "no mana" is rejected before anything is announced.
 */
export function castCheck(s: GameState, player: PlayerId, id: ObjectId, requestedFace?: number, method?: string, during?: ResolutionCastOptions): { denial: Denial } | { info: CastInfo } {
  return holdStill(s, () => castCheckIn(s, player, id, requestedFace, method, during)); // P1: pure, so its questions share one cache check of `s`
}

/** The one denial for casting a card the player can't see (m3). */
export const HIDDEN_CAST = "You can't cast that card.";

function castCheckIn(s: GameState, player: PlayerId, id: ObjectId, requestedFace?: number, castMethod?: string, during?: ResolutionCastOptions): { denial: Denial } | { info: CastInfo } {
  const o = s.objects[id];
  // C10 (CR 601.3): "permission:<n>" is not a way to pay: it picks which of several graveyard permissions the card is cast with (below); otherwise the cast
  // is the plain one
  const gyPick = castMethod !== undefined && !during ? graveyardMethodIndex(castMethod) : null;
  const method = gyPick !== null ? undefined : castMethod;
  // r3-cost (CR 118.9, 601.3): an alternative cost another object gives the spell is a way to pay, not a permission: the card is cast from where it may be cast
  // anyway (the hand, or an effect's permission, below)
  const grantedPick = method !== undefined && !during && isGrantedAltMethod(method);
  // m3 (audit 2026-10-12; CR 400.2, 401.2): a card the player can't see (another player's hand, a library) gets the same answer whatever it is, before
  // anything reads its definition (stub, fuse, faces, alternative costs), and the same answer as an id that names nothing, so guessing ids tells nothing
  // either (m4: which ids another player's hand holds). An effect that lets a player cast a card while it resolves names it (`during`).
  if (!during && (!o || !canSee(s, o, player))) return { denial: deny(HIDDEN_CAST, 'CR 601.3', 'CR 400.2') };
  if (!o) return { denial: deny('That card is not here.') };
  const def = s.defs[o.defId];
  if (!def) return { denial: deny('Unknown card.') };
  // WP24 INTERFACE CHANGE: a stub's characteristics are unknown (contract C4). The real card may be a land, which can't be cast (CR 305.9), or a permanent,
  // which would enter the battlefield (CR 608.3); CR 118.6a lets an alternative cost such as "without paying its mana cost" be paid for a card with no mana
  // cost, so the null cost alone does not stop an effect from casting it. The players move a stub by hand.
  if (def.stub) return { denial: deny(`${def.name}'s characteristics are unknown (a stub): move it by hand.`, 'CR 118.6a', 'CR 305.9', 'CR 608.3') };
  // WP14 INTERFACE CHANGE (`during`): an effect that instructs or allows a player to cast a card while it resolves (CR 608.2g) gives the permission the zone,
  // ownership and timing checks below stand for; casting otherwise follows 601.2a-i unchanged.
  // FAST4 T31 (CR 601.2a, 611.2): "you may play that card this turn": an effect allows this player to cast this very card from where it is (statics/play-permits.ts)
  const permitted = !during && (method === undefined || grantedPick) && o.zone !== 'hand' && playPermitted(s, player, id, false);
  // FAST5X E14 (CR 601.3, 401.5): the card on top of the player's library that only a top-card permission allows: its qualities are checked below on the
  // face being cast (CR 601.3e)
  const byTop = permitted && o.zone === 'library' && !namedPermit(s, player, id, false);
  // std-rx3 (CR 118.9, 601.2b): a card that only a permission "without paying its mana cost" lets the player cast from here is cast for that alternative cost only
  if (permitted && !isNamedFreeMethod(method) && !paidCastPermitted(s, player, id)) return { denial: deny('That card may be cast this way only without paying its mana cost.', 'CR 118.9', 'CR 601.2b') };
  if (o.owner !== player && !during && !permitted) return { denial: deny('You can only cast your own cards.', 'CR 601.3') };
  // M11-1, CR 903.8: "A player may cast a commander they own from the command zone" (the timing and every other check below apply as usual)
  const fromCommand = o.zone === 'command' && o.owner === player && isCommander(s, o);
  // M6-6 INTERFACE CHANGE (CR 722.3c): a copy of a card a cast option provider lists as castable (the exile copy of a prepare spell) may be cast that way
  // FAST5X E26 (CR 707.12): a copy of a card an effect created to be cast ("You may cast the copy", paradigm CR 702.192a) is cast like a card while it resolves
  const castCopy = during?.copy === true && o.kind === 'spellCopy' && o.zone !== 'stack';
  if (o.kind !== 'card' && !castCopy && !(method !== undefined && !during && castOptionProvider(method)?.castable?.(new Game(s), player).includes(id) === true)) {
    return { denial: deny('Only cards can be cast.', 'CR 601.3') };
  }

  // A fused cast uses both halves of a split card with fuse, from the hand only (CR 702.102a).
  const fused = method === 'fuse';
  if (fused) {
    const bothFuse = def.layout === 'split' && def.faces.length === 2 && def.faces.every((f) => f.abilities.some((a) => a.kind === 'keyword' && a.keyword === 'fuse'));
    if (!bothFuse) return { denial: deny('Only a split card with fuse can be cast as both halves.', 'CR 702.102a') };
    if (o.zone !== 'hand') return { denial: deny('A split card with fuse can be cast as both halves only from your hand.', 'CR 702.102a') };
    if (requestedFace !== undefined && requestedFace !== 0) return { denial: deny("A fused cast uses both halves; don't choose one.", 'CR 702.102a') };
  }

  // trek-11 (CR 400.11b, 601.3): the staging object of a card played from outside the game (core/special/play-outside.ts) is cast the plain way, with its mana cost, as a
  // permanent spell some permission that covers cards outside the game allows (checked below on the face as the spell it would be)
  const outside = o.fromOutside === true;
  if (outside && (during || castMethod !== undefined || fused || o.zone !== 'hand' || o.owner !== player)) {
    return { denial: deny('A card from outside the game is cast the plain way, with its mana cost, by its owner.', 'CR 400.11b', 'CR 601.3') };
  }

  // Which face (CR 709.3, 712.11b, 715.3).
  const transformed = during?.transformed === true;
  const allowed = castableFaces(def, transformed);
  if (transformed && allowed.length === 0) return { denial: deny(`${def.name} is not a transforming double-faced card, so it can't be cast transformed.`, 'CR 712.11a') };
  const face = fused ? 0 : requestedFace ?? allowed[0] ?? 0; // CR 712.11a: cast transformed, its back face is up
  if (!allowed.includes(face) || face >= def.faces.length) return { denial: deny("That face of the card can't be cast.", 'CR 712.8c', 'CR 709.3', 'CR 715.3') };
  // trek-11 (CR 712.8a, 400.11): outside the game a card has its front face's characteristics only, so only the front face is played from there
  if (outside && face !== 0) return { denial: deny("Outside the game a card has only its front face's characteristics: only the front face can be cast from there.", 'CR 712.8a', 'CR 400.11') };
  const onAdventure = o.zone === 'exile' && o.chosen?.onAdventure === true;
  if (onAdventure && face !== 0) return { denial: deny('A card on an adventure can only be cast as the creature (or other normal) half.', 'CR 715.3d') };
  // r5-dig (CR 715.3, 715.3a): a card an effect lets you cast from where it is only "as an Adventure" is cast as that face only; its other face only by another
  // permission, a graveyard permission that covers that face (checked as one below: `byGraveyard`)
  const adventureOnly = permitted && o.zone !== 'hand' && !onAdventure && !fromCommand && namedPermitAdventureOnly(s, player, id) && !hasSubtype(faceChars(def, face), 'Adventure');
  if (adventureOnly && !(o.zone === 'graveyard' && o.owner === player && graveyardPermitUses(s, player, id, faceChars(def, face)).length > 0)) {
    return { denial: deny(`${def.name} may be cast this way only as an Adventure.`, 'CR 715.3', 'CR 715.3a') };
  }
  const printed = fused ? combinedChars(def) : faceChars(def, face);
  // M6-0 (m6 design 2.6): a method that is not one of the card's own alternative costs may be a cast option provider's (face down, back face, prototype,
  // prepare, mutate). Its characteristics apply from the moment the spell is announced (CR 708.4, 718.3a-b, 712.8c), so every check below (timing, "can't
  // cast", prohibitions, costs) is judged on them. None is registered in M6-0.
  // M6-12 (feature:castCost.granted): the cast costs of abilities granted to the card where it is ("gains flashback {2}{R}{G} until end of turn", CR 613.1f)
  const costChars = during ? printed : withGrantedCosts(printed, s, o, player);
  const provider = !fused && !during && method !== undefined && !castOptionsOf(costChars).alternatives.some((a) => a.name === method) ? castOptionProvider(method) : undefined;
  const view = provider ? new Game(s) : undefined; // a reading view for the provider's questions
  const chars = provider?.charsOverride ? overriddenChars(provider.charsOverride(def, face), player) : printed;
  // Aftermath: this half can be cast only from a graveyard (CR 702.127a).
  const aftermath = !fused && hasKeyword(chars, 'aftermath');
  const options = castOptionsOf(chars === printed ? costChars : chars);

  // Where from, and how (CR 601.3).
  let alt: AlternativeOption | undefined;
  let grantedUse: GrantedAlternative | undefined;
  if (during) {
    if (method !== undefined) return { denial: deny('A card cast as an effect resolves is cast the way the effect says.', 'CR 608.2g', 'CR 118.9a') };
    if (o.zone === 'stack' || o.zone === 'battlefield') return { denial: deny('Only a card that is not a spell or a permanent can be cast.', 'CR 601.2a') };
    if (aftermath && o.zone !== 'graveyard') return { denial: deny(`${chars.name} has aftermath: it can't be cast from any zone other than a graveyard.`, 'CR 702.127a') };
    // M6-12: "by paying [cost] rather than paying its mana cost" (madness, CR 702.35b): an alternative cost, followed as in CR 601.2b, 601.2f-h
    if (during.alternative) {
      if (during.free) return { denial: deny('Only one alternative cost can be applied to a spell.', 'CR 118.9a') };
      alt = { name: during.alternative.name, cost: during.alternative.cost };
    }
  } else if (method === undefined || fused) {
    if (o.zone === 'hand') {
      if (aftermath) return { denial: deny(`${chars.name} has aftermath: it can't be cast from any zone other than a graveyard.`, 'CR 702.127a') };
    } else if (o.zone === 'graveyard' && aftermath) {
      // CR 702.127a: "You may cast this half of this split card from your graveyard."
    } else if (!onAdventure && !(permitted && !fused) && !(fromCommand && !fused)) {
      return { denial: deny('You can only cast cards from your hand unless an effect lets you cast them from elsewhere.', 'CR 601.3', 'CR 601.2a') };
    }
    // FAST4 T31: a permission to play the card does not let an aftermath half be cast from anywhere but a graveyard (CR 702.127a)
    if (permitted && aftermath && o.zone !== 'graveyard') return { denial: deny(`${chars.name} has aftermath: it can't be cast from any zone other than a graveyard.`, 'CR 702.127a') };
  } else if (grantedPick) {
    // r3-cost (CR 118.9, 601.2b, 601.3): the alternative cost a static ability gives this spell; where the card is cast from is checked as for its mana cost
    if (o.zone !== 'hand' && !onAdventure && !permitted && !fromCommand) {
      return { denial: deny('You can only cast cards from your hand unless an effect lets you cast them from elsewhere.', 'CR 601.3', 'CR 601.2a') };
    }
    if (aftermath && o.zone !== 'graveyard') return { denial: deny(`${chars.name} has aftermath: it can't be cast from any zone other than a graveyard.`, 'CR 702.127a') };
    grantedUse = grantedAlternatives(s, player, id, chars).find((g) => g.method === method);
    if (!grantedUse) return { denial: deny(`No effect lets you pay that alternative cost for ${chars.name} now.`, 'CR 118.9', 'CR 601.2b') };
    alt = { name: grantedUse.name, cost: grantedUse.cost };
  } else if (provider) {
    // M6-0: the provider decides where from (CR 702.37a: any zone it could be cast from) and the cost (an alternative cost, CR 118.9, or the normal one)
    if (!provider.offers(view!, o, player)) return { denial: deny(`${printed.name} can't be cast that way (${provider.name}) now.`, 'CR 601.2b', 'CR 601.3') };
    const cost = provider.cost(view!, o);
    if (cost) alt = { name: provider.name, cost };
  } else {
    alt = options.alternatives.find((a) => a.name === method);
    if (!alt) return { denial: deny(`Unknown way to cast: ${method}.`, 'CR 601.2b') };
    // M11-1, CR 903.8: an alternative cost that does not name a zone may be used for a commander cast from the command zone too (CR 118.9)
    if (alt.from !== undefined ? o.zone !== alt.from : !(o.zone === 'hand' || onAdventure || fromCommand)) {
      return { denial: deny(alt.name === 'flashback' ? 'Flashback casts a card from your graveyard.' : `${chars.name} can be cast with ${alt.name} only from your ${alt.from ?? 'hand'}.`, alt.name === 'flashback' ? 'CR 702.34a' : 'CR 118.9') };
    }
  }

  if (hasType(chars, 'Land')) return { denial: deny('Lands are played, not cast.', 'CR 305.1', 'CR 116.2a') };
  // std-ru (CR 118.9, 601.2b, 601.3): a card exiled with an object whose linked permission says "If you cast a spell this way, pay life equal to its mana value rather
  // than pay its mana cost" (Valgavoth, Terror Eater) is cast for that cost when that permission is what lets it be cast (statics/play-permits.ts#linkedPermitLifeCost)
  // std-exile-play-2-1: and a card a resolved permission with that rider names, in any zone ("You may play those cards this turn. If you cast a spell this way, ...")
  if (!during && !fused && method === undefined && alt === undefined && permitted) {
    const life = linkedPermitLifeCost(s, player, id, chars);
    if (life === 'unsupported') return { denial: deny(`${chars.name} has a {Y} or {Z} in its mana cost: pay its life cost by hand.`, 'CR 118.9', 'CR 107.3') };
    if (life !== null) alt = { name: 'payLife', cost: life };
  }
  // FAST5X E14 (CR 601.3, 601.3e): "You may cast creature spells from the top of your library": the permission must cover this face as the spell it would be
  const topUse = byTop ? topPermitFor(s, player, id, false, chars) : null;
  if (byTop && topUse === null) return { denial: deny(`No effect lets you cast ${chars.name} from the top of your library.`, 'CR 601.3', 'CR 601.3e') };
  // std-exile-play-1-1 (CR 118.9, 118.9a, 202.3): "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on the top-card permission
  // used (Gwenom, Remorseless): that alternative cost is the spell's, and no other alternative cost can be combined with it
  if (topUse?.lifeCost === true) {
    if (during || fused || method !== undefined || alt !== undefined) return { denial: deny(`${chars.name} is cast from the top of your library for life rather than its mana cost: no other way to cast it applies.`, 'CR 118.9', 'CR 118.9a') };
    const life = lifeCostOf(chars);
    if (life === 'unsupported') return { denial: deny(`${chars.name} has a {Y} or {Z} in its mana cost: pay its life cost by hand.`, 'CR 118.9', 'CR 107.3') };
    alt = { name: 'payLife', cost: life };
  }
  // C10 (CR 601.3, 601.3e): a card in the caster's own graveyard that only a graveyard permission allows (an aftermath half needs none, CR 702.127a; a
  // permission that names the card wins: it adds nothing to the cost): the permission must cover this face as the spell it would be, and with several
  // different ways the player picks one (the `permission:<n>` methods)
  const byGraveyard = permitted && o.zone === 'graveyard' && o.owner === player && !aftermath && !fused && (!namedPermit(s, player, id, false) || adventureOnly);
  let gyUse: GraveyardUse | undefined;
  if (byGraveyard) {
    const uses = graveyardPermitUses(s, player, id, chars);
    if (uses.length === 0) return { denial: deny(`No effect lets you cast ${chars.name} from your graveyard.`, 'CR 601.3', 'CR 601.3e') };
    // std-rx27 (CR 601.3): ways that differ only in which once-each-turn permission they spend ("a permanent spell of each permanent type") need no choice: the
    // first is used unless the player picks another (the `permission:<n>` methods)
    const way = (u: GraveyardUse): string => JSON.stringify([u.addCost ?? null, u.entersWith ?? null, u.exileOnLeave ?? null, u.graveyardInstead ?? null]); // p2-graveyard-2: and where it goes instead
    const sameWay = uses.every((u) => way(u) === way(uses[0]!));
    if (gyPick === null && uses.length > 1 && !sameWay) return { denial: deny(`Several effects let you cast ${chars.name} from your graveyard in different ways: choose which one you use.`, 'CR 601.3') };
    gyUse = uses[gyPick === null ? 0 : gyPick - 1];
    if (gyUse === undefined) return { denial: deny(`There is no such way to cast ${chars.name} from your graveyard.`, 'CR 601.3') };
  }
  // trek-11 (CR 400.11b, 601.3, 601.3e): a card played from outside the game: a permission that covers cards outside the game must cover this face as the spell it
  // would be; all such uses spend the one counter of the permission (shared with its graveyard casts and land plays)
  if (outside) {
    const uses = outsideCastUses(s, player, id, chars);
    if (uses.length === 0) return { denial: deny(`No effect lets you cast ${chars.name} from outside the game.`, 'CR 400.11b', 'CR 601.3', 'CR 601.3e') };
    gyUse = uses[0];
  }
  // std-rx27 (CR 601.3, 601.3e, 607.2a): a card in exile that only linked permissions allow (one that names the card wins, as above): one of them must cover this
  // face as the spell it would be; a free one is used through its granted alternative cost (grantedAlternatives), a paid one picked like a graveyard one
  const byLinked = permitted && o.zone === 'exile' && !fused && !namedPermit(s, player, id, false);
  let linkUse: LinkedUse | undefined;
  if (byLinked) {
    const uses = linkedPermitUses(s, player, id, chars);
    const free = isLinkedFreeMethod(method);
    const ways = uses.filter((u) => (u.free === true) === free);
    if (ways.length === 0) return { denial: deny(`No effect lets you cast ${chars.name} from exile this way.`, 'CR 601.3', 'CR 601.3e') };
    if (!free && gyPick === null && ways.length > 1) return { denial: deny(`Several effects let you cast ${chars.name} from exile in different ways: choose which one you use.`, 'CR 601.3') };
    linkUse = free ? ways[0] : ways[gyPick === null ? 0 : gyPick - 1];
    if (linkUse === undefined) return { denial: deny(`There is no such way to cast ${chars.name} from exile.`, 'CR 601.3') };
  } else if (gyPick !== null && !byGraveyard) {
    return { denial: deny(`That way of casting ${chars.name} is for a card in your graveyard that an effect lets you cast from there.`, 'CR 601.3') };
  }

  if (alt?.name === 'flashback') {
    if (!hasType(chars, 'Instant') && !hasType(chars, 'Sorcery')) return { denial: deny('Flashback only works on instants and sorceries.', 'CR 702.34a') };
  } else if (alt?.name === 'beam me up') {
    // trek-7 (Star Trek reminder text of Scotty, Miracle Worker, "Only instant and sorcery spells can be cast this way"; the set is newer than the rules in rules/cr)
    if (!hasType(chars, 'Instant') && !hasType(chars, 'Sorcery')) return { denial: deny('Beam me up only works on instants and sorceries.', 'CR 118.9') };
  } else if (!alt && chars.manaCost === null && !during?.free) {
    return { denial: deny(`${chars.name} has no mana cost, so it can't be cast without an alternative cost.`, 'CR 202.1b', 'CR 118.6') };
  }

  // CR 702.61a: nothing but mana abilities and special actions while a spell with split second is on the stack.
  const split = splitSecondDenial(s);
  if (split) return { denial: split };

  // CR 608.2g: cast during the resolution, whatever the card type's timing. FAST5X E7 (CR 702.190a): an alternative cost that may be paid "any time you could
  // cast an instant" (sneak) gives the spell instant timing; its `when` (checked below) keeps it to the step it names
  let timing = during || alt?.instantSpeed === true ? null : castTiming(s, player, id, chars);
  // FAST5 T56 (CR 601.3b, 601.2f): "You may cast this spell as though it had flash if you pay {2} more to cast it": only when it could not be cast now without the permission, and
  // then the increase is part of the total cost (an additional cost besides the mana cost); the cheapest of several such permissions
  let flashExtra = 0;
  // std-rx10 (CR 601.3b, 601.2b, 118.8): "... as though it had flash if you behold a Dragon as an additional cost to cast it": a permission whose price is an
  // additional cost; only one such permission (two would be a choice of which cost to pay that this build does not offer, so none is used then)
  let flashAddCost: CostDef | undefined;
  if (timing) {
    const prices = hookpoints.castFlashCosts(gameOf(s), id, player, chars);
    if (prices.length > 0) { flashExtra = Math.min(...prices); timing = null; }
  }
  if (timing) {
    const adds = hookpoints.castFlashAddCosts(gameOf(s), id, player, chars);
    if (adds.length === 1) { flashAddCost = adds[0]; timing = null; }
  }
  if (timing) return { denial: timing };
  // CR 205.4e (AF1, audit FAST1 defect 1): a rule that applies however the spell is cast, from a resolving effect too (CR 601.3).
  const legendary = legendarySpellDenial(s, player, chars);
  if (legendary) return { denial: legendary };
  // Casting restrictions printed on the card (CR 601.3, 101.2).
  for (const a of chars.abilities) {
    if (a.def.kind === 'static' && castRestrictionOf(a.def)) {
      const d = castRestrictionDenial(s, player, a.def);
      if (d) return { denial: d };
    }
  }
  // Restrictions imposed by other objects' static abilities ("can't cast", CR 101.2) come through the rule hookpoints (WP16 fills them in).
  const hook = hookpoints.canCast(gameOf(s), id, player, face, { ...(method !== undefined ? { method } : {}), ...(fused ? { fused: true } : {}), ...(chars !== printed ? { chars } : {}) }); // CR 709.3a: the face being cast; M6-0: a cast option's characteristics
  if (hook) return { denial: hook };

  // FAST5X E6 (CR 702.187b): mayhem: "As long as you discarded this card this turn": the card in the graveyard is the object a discard put there this turn
  if (alt?.discardedThisTurn && !discardedThisTurn(s, o)) {
    return { denial: deny(`${chars.name} can be cast with ${alt.name.replace(/:\d+$/, '')} only if you discarded it this turn.`, 'CR 702.187b', 'CR 400.7') };
  }
  // FAST5X E6 (CR 702.180a): "exile this card instead of putting it anywhere else any time it would leave the stack" would also keep a permanent spell from
  // entering the battlefield; this build applies it only where an instant or sorcery leaves the stack (core/resolve.ts#leaveStack), so it is not offered for others
  if (alt?.exileOnLeave && !hasType(chars, 'Instant') && !hasType(chars, 'Sorcery')) {
    return { denial: deny(`This engine build casts ${alt.name.replace(/:\d+$/, '')} only for instants and sorceries.`, 'CR 702.180a') };
  }
  // p2-cost-statics-1 (CR 118.9, 601.2b): an alternative cost's condition reads this turn's history ("If an opponent cast a blue spell this turn", model/forms.ts
  // 'altCost'), complete whenever a spell can be cast (it is written before a player receives priority, CR 117.3)
  const aenv: AnnounceEnv = { s, player, sourceId: id, costsPaid: alt ? { alternative: alt.name } : {}, castFrom: castOriginOf(o), ...(alt?.when ? { history: true as const } : {}) };
  if (alt?.when) {
    // p2-modal-2 (CR 601.2b, 118.9): the alternative cost is chosen as the spell is cast, so "If you've cast another white spell this turn" reads the turn's history so
    // far (model/cap-walk.ts declares the condition in position 'mode', as a mode count's override: both read the history, model/forms.ts)
    const ok = announceCond({ ...aenv, history: true }, alt.when);
    if (ok === undefined) return { denial: deny(`This engine build can't check the condition for casting ${chars.name} with ${alt.name} yet, so it is not offered.`, 'CR 118.9', 'CR 601.2b') };
    if (!ok) return { denial: deny(`${chars.name} can't be cast with ${alt.name} right now.`, 'CR 118.9') };
  }

  // M6-0: targets a cast option adds (mutate's non-Human creature with the same owner, CR 702.140a) are announced with the spell's own (CR 601.2c)
  const extra = provider?.extraTargets?.(view!, o);
  const ownPrograms = extra && extra.length > 0 ? [...spellPrograms(chars), { targets: extra, steps: [] }] : spellPrograms(chars);
  // CR 702.96a-b: cast for its overload cost the spell has no targets and says "each" where it said "target" (actions/overload.ts); a spell that can't be rewritten
  // faithfully is not offered for it (fail closed)
  const manualSpell = chars.abilities.some((a) => a.def.kind === 'manual' && (a.def.shape === 'spell' || a.def.shape === 'unknown'));
  const overloaded = alt?.name === OVERLOAD ? (manualSpell ? null : overloadablePrograms(ownPrograms)) : undefined;
  if (alt?.name === OVERLOAD && overloaded === null) {
    return { denial: deny(`This engine build can't change "target" to "each" in ${chars.name}, so it is not offered with overload.`, 'CR 702.96a') };
  }
  const programs = overloaded ?? ownPrograms;
  const altCost = alt?.cost;
  // The mana is for this spell: restricted mana (Cavern of Souls) pays only if the spell matches (CR 106.6).
  // "Without paying its mana cost" (CR 118.9, 608.2g; WP14) pays nothing for the base cost; additional costs are still paid (CR 118.9d).
  // FAST5X E29 (CR 609.4b): "mana of any type can be spent to cast that spell" (the permission it is cast with, or the resolving effect)
  // CLOUD std-fdn (CR 609.4b): or a static ability lets the caster spend mana of any type to cast spells like this one ("... to cast creature spells")
  // Standard round I (CR 609.4b, 107.4c): 'color' when a static ability only lets the caster spend mana as though it were mana of any color
  const anyManaType: boolean | 'color' = during?.anyManaType === true || (permitted && !byTop && !fused && anyManaTypePermit(s, player, id))
    || linkUse?.anyManaType === true // std-rx27: the linked permission it is cast with
    ? true : staticAnyColorOrType(staticAnyManaType(s, player, id, chars), permitted && !byTop && !fused && anyManaColorPermit(s, player, id));
  // FAST5X E23 (CR 601.2a, 708.4, 202.3e): the spell is read as it would be: this face, face down when cast face down, with the X the plan is for
  const spendFor = (x: CostX): SpendContext => ({
    kind: 'spell', id, face, ...(provider?.faceDown === true ? { faceDown: true as const } : {}), ...(typeof x === 'number' ? { x } : {}), ...(anyManaType ? { anyType: anyManaType === 'color' ? ('color' as const) : (true as const) } : {}),
  });
  const base = (x: CostX): CostPlan => {
    const plan: CostPlan = { ...(altCost ? planFromCostDef(altCost, x) : during?.free ? emptyPlan() : { ...emptyPlan(), mana: substituteX(chars.manaCost, typeof x === 'number' ? x : 0) }), spend: spendFor(x) };
    return flashExtra > 0 ? addPlans(plan, planFromCostDef({ mana: [{ kind: 'generic', amount: flashExtra }] }, x)) : plan; // FAST5 T56
  };
  // M11-1, CR 903.8: the commander tax is a mandatory additional cost (CR 118.9d: paid however the spell is cast)
  const tax = commanderTaxCost(s, o);
  // C10 (CR 601.2f, 118.8): "by paying 3 life in addition to paying their other costs": the graveyard permission's cost is paid with the others
  // std-exile-play-2-1 (CR 601.2f, 118.8): likewise a linked permission's ("by removing three counters from among creatures you control in addition to ...")
  // std-exile-play-1-3 (CR 601.2f, 601.3): "Each spell cast this way costs {1} more to cast" on the permission for named objects the card is cast with (one without the
  // increase is used first: statics/play-permits.ts#namedPermitIncrease)
  const permitIncrease = permitted && !byTop && !fused && !during ? namedPermitIncrease(s, player, id) : null;
  const mandatory = [...mandatoryCosts(options.additional), ...(tax ? [tax] : []), ...(gyUse?.addCost ? [gyUse.addCost] : []), ...(linkUse?.addCost ? [linkUse.addCost] : []), ...(flashAddCost ? [flashAddCost] : []), ...(permitIncrease ? [permitIncrease] : [])];
  // CR 601.2f: what is paid is the total cost after cost increases and reductions (WP16), so the check is made on the modified cost.
  const payNow = (plan: CostPlan): Denial | null => {
    const m = modifiedPlan(s, player, id, plan, chars);
    if ('denial' in m) return m.denial;
    return alt?.name === 'emerge' ? emergePayable(s, player, id, m.plan) : alt?.tapReduces ? tapReducePayable(s, player, id, m.plan) : payableWithOptions(s, player, id, m.plan);
  };
  const baseHasX = altCost ? costHasX(altCost) : !during?.free && countX(chars.manaCost) > 0; // CR 107.3a: X in an alternative cost is announced; without one X is 0 (CR 107.3b)
  // r3-cost (CR 107.3, 601.2b): "X can't be greater than ..." must be readable now
  if (xCap(s, player, id, options.additional) === undefined) return { denial: deny(`This engine build can't read the largest X ${chars.name} allows, so it is not offered.`, 'CR 107.3', 'CR 601.2b') };

  // CR 601.2c, 601.2h: a target filter that reads X needs SOME X the player can pay for to have a target (WP30 review: the legal actions are exact enough for the
  // UI). The bound is the largest X the base and mandatory costs allow (the X of optional costs and modes comes later and only adds to the cost); a spell
  // with no X to announce has X = 0.
  // pc-statics-1: and a spell with X in its cost, whose targets may be protected from "mana value N or less" (rules/targets.ts#targetOptions judges it with the largest X)
  if (programs.some(programFiltersMentionX) || baseHasX) {
    const hasX = baseHasX || mandatory.some(costHasX);
    const scanAll = costFilterHasX(altCost) || mandatory.some(costFilterHasX);
    const xs = hasX ? payableXs((n) => payNow(addPlans(base(n), planFromCostDefs(mandatory, n))) === null, scanAll) : [0];
    aenv.xMax = xs.length ? xs[xs.length - 1]! : 0;
    if (baseHasX) aenv.castingSpell = true; // pc-statics-1
  }
  const noTarget = deny(`${chars.name} needs a target but there is no legal one.`, 'CR 601.2c', 'CR 115.1');
  const unplayable = programsDenial(s, programs, player, id, noTarget, undefined, aenv);

  const required = addPlans(base('unannounced'), planFromCostDefs(mandatory, 'unannounced'));
  let blocked = unplayable ?? payNow(required);
  // FAST5X E23 (CR 601.2b, 106.6, 202.3e): mana restricted to spells of some mana value may pay for an X spell only with a large enough X ("spells with mana
  // value 4 or greater"): such a spell is castable when SOME X is payable
  // (only with restricted mana at hand: every value of X up to the cap is tried, CR 107.3a)
  if (blocked && !unplayable && (baseHasX || mandatory.some(costHasX)) && hasRestrictedMana(s, player)
    && payableXs((n) => payNow(addPlans(base(n), planFromCostDefs(mandatory, n))) === null, true).length > 0) blocked = null;
  // FAST5X E1 (CR 601.2b-c, 601.2f): an optional additional cost the player may announce can make the spell castable: its targets (gift's "instead counter
  // target spell", CR 702.174m) or a reduction that reads it ("costs {2} less to cast if it's bargained")
  if (blocked && !optionalCostMakesCastable(s, o, face, player, options.additional, required, {
    targets: (paid) => programsDenial(s, programs, player, id, noTarget, undefined, { ...aenv, costsPaid: { ...aenv.costsPaid, ...paid } }) === null,
    payable: (st, plan) => {
      const m = modifiedPlan(st, player, id, plan, chars);
      return !('denial' in m) && (alt?.name === 'emerge' ? emergePayable(st, player, id, m.plan) : alt?.tapReduces ? tapReducePayable(st, player, id, m.plan) : payableWithOptions(st, player, id, m.plan)) === null;
    },
  })) return { denial: blocked };
  // M6-5, CR 601.2b, 601.2h: one cost of every mandatory choice group must be payable with the rest
  const noGroup = groupedCostsDenial(options.additional, (chosen) => payNow(addPlans(required, planFromCostDefs(chosen, 'unannounced'))) === null, chars.name);
  if (noGroup) return { denial: noGroup };
  // CR 601.2b, 700.2: the number of modes the card requires must be choosable AND payable (each mode's own cost is added, CR 700.2h); a spell that can't get its modes isn't castable.
  const noModes = modesDenial(s, programs, player, id, undefined, aenv, (costs) => payNow(addPlans(required, planFromCostDefs(costs, 'unannounced'))) === null);
  if (noModes) return { denial: noModes };

  const info: CastInfo = { object: o, face, chars, method, baseHasX, fused, programs, base, additional: options.additional };
  if (alt) info.alt = alt;
  if (provider) info.provider = provider;
  if (topUse?.key) info.topOnce = topUse.key;
  if (topUse?.entersWith) info.topEnters = { counters: topUse.entersWith, source: topUse.source ?? '' }; // std-rx27 (CR 614.1c)
  if (gyUse) info.gyPermit = gyUse;
  if (permitIncrease) info.permitIncrease = permitIncrease; // std-exile-play-1-3
  const singleKey = permitted && !byTop && !fused && namedPermit(s, player, id, false) ? namedSingleKey(s, player, id, false) : null;
  if (singleKey !== null) info.singleKey = singleKey; // std-rx27
  if (linkUse && (linkUse.key !== null || linkUse.entersWith || linkUse.addCost)) info.linkedPermit = { ...linkUse, key: linkUse.free ? null : linkUse.key }; // std-rx27 (a free one's key: grantedAlt)
  if (flashAddCost) info.flashAddCost = flashAddCost;
  if (anyManaType) info.anyManaType = anyManaType === 'color' ? 'color' : true;
  // r5-repl (CR 614.1a, 400.7): "If that spell would be put into a graveyard, exile it instead" of the permission it is cast with (not a top-card one)
  const gyInstead = permitted && !byTop && !fused ? graveyardInsteadPermit(s, player, id) : undefined;
  if (gyInstead) info.permitGraveyard = gyInstead;
  // p2-graveyard-2 (CR 614.1a, 400.7): ... and of the graveyard permission it is cast with ("If a spell cast this way would be put into your graveyard, exile it instead");
  // the card is its owner's, so "your graveyard" is the graveyard it would go to (CR 400.3)
  else if (gyUse?.graveyardInstead && (gyUse.graveyardInstead.yours !== true || o.owner === player)) info.permitGraveyard = { to: gyUse.graveyardInstead.to, source: gyUse.source };
  if (grantedUse) info.grantedAlt = grantedUse;
  return { info };
}

/**
 * FAST5X E1 (CR 601.2b-c, 601.2f, 702.166a, 702.174m): a spell that can't be cast without its optional additional costs may still be castable with one of
 * them announced: its targets depend on it ("Counter target creature spell. If the gift was promised, instead counter target spell.") or a cost reduction
 * reads it ("This spell costs {2} less to cast if it's bargained"). Each optional cost (not a choice group's) is tried alone: the targets with that cost
 * announced, and the total cost with the card looked at as the spell it would be (a hypothetical stack record on a copy of the state, read by
 * statics/match.ts `wasCast`) and that cost added to the plan. A cost that is choosing an opponent needs one (CR 702.174a). Pure.
 */
function optionalCostMakesCastable(
  s: GameState, o: GameObject, face: number, player: PlayerId, additional: readonly AdditionalOption[], required: CostPlan,
  check: { targets: (paid: CostsPaid) => boolean; payable: (s: GameState, plan: CostPlan) => boolean },
): boolean {
  for (const opt of additional) {
    if (!opt.optional || opt.choiceGroup !== undefined || opt.name === undefined) continue;
    if (opt.choosePlayer === 'opponent' && !s.players.some((p) => p.id !== player && !p.hasLost)) continue;
    // std-costs-1 (CR 601.2b, 601.2f): a cost whose announced number a reduction reads ("for each permanent sacrificed this way") is tried with each number
    if (opt.announceCount === true) {
      for (let n = 1; n <= countCap(s, player); n++) {
        const fixed = withAnnouncedCount(opt.cost, n);
        if (fixed === null) break;
        const paidN: CostsPaid = { additional: [opt.name], counts: { [opt.name]: n } };
        if (!check.targets(paidN)) break;
        const hypoN: GameState = { ...s, objects: { ...s.objects, [o.id]: { ...o, stack: { kind: 'spell', face, targets: [], costsPaid: paidN, caster: player } } } };
        if (check.payable(hypoN, addPlans(required, planFromCostDefs([fixed], 'unannounced')))) return true;
      }
      continue;
    }
    const costsPaid: CostsPaid = { additional: [opt.name], ...(isKickerName(opt.name) ? { kicked: 1 } : {}) };
    if (!check.targets(costsPaid)) continue;
    const hypo: GameState = { ...s, objects: { ...s.objects, [o.id]: { ...o, stack: { kind: 'spell', face, targets: [], costsPaid, caster: player } } } };
    if (check.payable(hypo, addPlans(required, planFromCostDefs([opt.cost], 'unannounced')))) return true;
  }
  return false;
}

/**
 * CR 205.4e: "A player can't cast a legendary instant or sorcery spell unless that player controls a legendary creature or a legendary planeswalker." `chars`
 * are the characteristics of the face (or fused halves) being cast; the permanents are read after continuous effects (CR 613: a creature that lost Legendary,
 * an animated legendary land, a control change via `controllerOf`). Pure.
 */
export function legendarySpellDenial(s: GameState, player: PlayerId, chars: Chars): Denial | null {
  if (!chars.supertypes.includes('Legendary') || !(hasType(chars, 'Instant') || hasType(chars, 'Sorcery'))) return null;
  for (const pid of s.zones.battlefield) {
    const p = s.objects[pid];
    if (!p) continue;
    const c = charsOfObject(s, p);
    if (c.controller === player && c.supertypes.includes('Legendary') && (hasType(c, 'Creature') || hasType(c, 'Planeswalker'))) return null;
  }
  return deny(`${chars.name} is a legendary ${hasType(chars, 'Instant') ? 'instant' : 'sorcery'}: you can cast it only while you control a legendary creature or a legendary planeswalker.`, 'CR 205.4e', 'CR 601.3');
}

/** CR 702.119: the emerge cost can be paid when SOME permanent can be sacrificed for it and the reduced total is payable. */
function emergePayable(s: GameState, player: PlayerId, id: ObjectId, plan: CostPlan): Denial | null {
  if (emergePayableCandidates(s, player, id, plan).length > 0) return null;
  return payableWithOptions(s, player, id, plan) ?? deny('You have no permanent to sacrifice for the emerge cost.', 'CR 702.119a');
}

/**
 * FAST5X E6 (CR 702.187b, 400.7): mayhem's "as long as you discarded this card this turn": this turn's history has a discard (CR 701.9) whose subject is this
 * very object (the history names the card by its id in the zone it went to, rules/history.ts), by its owner (only the hand's owner discards from it). A card
 * discarded and then returned to the graveyard another way is a new object, so it does not count. Pure.
 */
export function discardedThisTurn(s: GameState, o: GameObject): boolean {
  return s.history.some((h) => h.turn === s.turn.number && h.ev === 'action' && h.facts['verb'] === 'discard' && h.subject === o.id && (h.actor === undefined || h.actor === o.owner));
}

/** FAST5X E6 (CR 702.180a): the part of a harmonize cost that taps the chosen creature ("tapping up to one untapped creature you control"). */
const tapReducePart = (chosen?: ObjectId): PlanPart => ({ kind: 'tapUntapped', filter: { types: ['Creature'] }, count: 1, ...(chosen !== undefined ? { chosen: [chosen] } : {}) });

/** The power a creature tapped for a harmonize cost reduces the total cost by (CR 702.180a: generic mana equal to its power; none below 0), or null when unknown. */
function tapReduceAmount(s: GameState, id: ObjectId): number | null {
  const o = s.objects[id];
  if (!o) return null;
  const p = ptNumbers(charsOfObject(s, o)).power;
  return p === null ? null : Math.max(0, p);
}

/**
 * FAST5X E6 (CR 702.180a-b, 601.2f, 118.7a): the total cost with the creature chosen for the harmonize cost: reduced by generic mana equal to its power, and the
 * creature tapped as part of the payment (an already chosen tap part, paid before the mana, rules/pay.ts). Null when its power can't be read.
 */
export function tapReduction(s: GameState, plan: CostPlan, id: ObjectId): CostPlan | null {
  const n = tapReduceAmount(s, id);
  if (n === null) return null;
  return { ...plan, mana: reduceGeneric(plan.mana, n).mana, other: [...plan.other, tapReducePart(id)] };
}

/** The creatures that may be tapped for a harmonize cost whose total cost is `plan` (untapped creatures the player controls, CR 702.180a) and keep it payable. */
export function tapReduceCandidates(s: GameState, player: PlayerId, spellId: ObjectId, plan: CostPlan): ObjectId[] {
  return partCandidates(s, player, null, tapReducePart(), plan).filter((c) => {
    const reduced = tapReduction(s, plan, c);
    return reduced !== null && payableWithOptions(s, player, spellId, reduced) === null;
  });
}

/** CR 702.180a: a harmonize cost can be paid with no creature tapped ("up to one") or with some creature whose tap leaves the total payable. */
function tapReducePayable(s: GameState, player: PlayerId, id: ObjectId, plan: CostPlan): Denial | null {
  const plain = payableWithOptions(s, player, id, plan);
  if (plain === null || tapReduceCandidates(s, player, id, plan).length > 0) return null;
  return plain;
}

/** Cost increases and reductions (CR 601.2f, 118.7): the modifiers of statics/costmods.ts applied to the plan's mana. A cost that can't be worked out reverses the cast. */
export function applyCostModifiers(g: Game, player: PlayerId, spell: GameObject, plan: CostPlan): CostPlan {
  const m = modifiedPlan(g.s, player, spell.id, plan);
  if ('denial' in m) throwDenial(m.denial);
  return m.plan;
}

/**
 * The plan with the cost modifiers that apply to the spell (a card about to be cast, seen as the face `chars`, or the spell on the stack), or why its total cost
 * can't be determined (a modifier's amount the engine can't evaluate: never a guess, design 1.1.4). Pure. The history count (`happenedCount`: "for each creature
 * that died this turn") is evaluated here because statics may not read rules/history.ts (design 5.4). Owner of the modifiers: WP16 (statics/costmods.ts).
 */
export function modifiedPlan(s: GameState, player: PlayerId, spell: ObjectId, plan: CostPlan, chars?: Chars): { plan: CostPlan } | { denial: Denial } {
  const hits = costModsFor(s, spell, player, chars);
  if (hits.length === 0) return { plan };
  const history = (q: Quantity, hit: CostModHit): number | undefined =>
    typeof q !== 'number' && q.q === 'happenedCount' ? happenedCountOf(s, q, { you: hit.controller, ...(hit.source !== null ? { sourceId: hit.source } : {}) }) : undefined;
  const r = modifyMana(plan.mana, hits, history);
  if ('unknown' in r) return { denial: deny(`The engine can't work out the cost change "${r.unknown.text}" (${r.unknown.name}), so the total cost of this spell is unknown.`, 'CR 601.2f') };
  // r5-cost (CR 601.2f, 119.4): "cost an additional 3 life to cast": the total cost includes paying that life (`CostModDef.change.life`)
  const life = hits.flatMap((h) => (h.def.change.kind === 'increase' && h.def.change.life !== undefined && h.def.change.life > 0 ? [{ kind: 'payLife' as const, amount: h.def.change.life }] : []));
  return { plan: { ...plan, mana: r.mana, ...(life.length > 0 ? { other: [...plan.other, ...life] } : {}) } };
}

/**
 * What a spell remembers when it becomes a permanent (CR 400.7d, 607.2i): the costs paid (kicker, buyback, the alternative cost), X, the zone it was cast from
 * and the turn. Copied to `GameObject.cast` by the resolution (core/resolve.ts), so "if it was kicked" and "when it enters, if it was cast" work after the spell has gone.
 */
export function castRecordOf(spell: GameObject, turn: number): NonNullable<GameObject['cast']> | undefined {
  const info = spell.stack;
  if (!info || info.kind !== 'spell' || info.isCopy) return undefined;
  const paid = JSON.parse(JSON.stringify(info.costsPaid)) as typeof info.costsPaid;
  return { costsPaid: paid, ...(info.x !== undefined ? { x: info.x } : {}), from: info.castFrom ?? 'hand', ...(paid.alternative !== undefined ? { via: paid.alternative } : {}), turn, ...(info.caster !== undefined ? { by: info.caster } : {}),
    ...(info.controlLost === true ? { controlLost: true as const } : {}) }; // std-rx22: CR 702.62a, the caster lost control of the spell
}

export function castSpell(g: Game, action: Extract<Action, { type: 'cast' }>, during?: ResolutionCastOptions): void {
  const { player } = action;
  const check = castCheck(g.s, player, action.card, action.face, action.method, during);
  if ('denial' in check) {
    assertAllowed(check.denial);
    return;
  }
  const { info } = check;
  const name = g.player(player).name;
  const faceDown = info.provider?.faceDown === true; // M6-3 INTERFACE CHANGE: CR 708.4, 708.5 (actions/cast-options.ts#CastOptionProvider.faceDown)
  const spellName = faceDown ? 'a face-down spell' : info.chars.name;

  // Casting restrictions the engine can't check (conditional wording) are shown, never silently skipped.
  for (const a of info.chars.abilities) {
    if (a.def.kind !== 'manual') continue;
    for (const line of a.def.text.split('\n')) {
      if (isCastRestrictionLine(line)) {
        g.log(`${spellName} has a casting restriction the engine can't check yet: "${line.trim()}" Make sure it was legal to cast.`, { rules: ['CR 601.3'], level: 'manual' });
      }
    }
  }

  // M11-1, CR 903.8: a commander cast from the command zone: its tax (an additional cost) and, once cast, one more cast counted (read before it moves)
  const taxCost = commanderTaxCost(g.s, info.object);
  const fromCommandZone = info.object.zone === 'command' && isCommander(g.s, info.object);

  // CR 601.2a: the card becomes a spell on the stack, controlled by the caster.
  const castFrom = castOriginOf(info.object); // trek-11 (CR 400.11): 'outside' for a card from outside the game
  const stackId = moveObject(g, info.object.id, 'stack', { face: info.face, controller: player, cause: 'cast', ...(faceDown ? { faceDown: true } : {}) }); // M6-3: CR 708.4
  if (!stackId) throw new IllegalAction('The card could not be put on the stack.', ['CR 601.2a']);
  if (info.topOnce !== undefined) g.s.turnActivations[info.topOnce] = (g.s.turnActivations[info.topOnce] ?? 0) + 1; // FAST5X E14: "once each turn" (CR 601.3)
  const gyKey = info.gyPermit?.key;
  if (gyKey) g.s.turnActivations[gyKey] = (g.s.turnActivations[gyKey] ?? 0) + 1; // C10: "once during each of your turns" (CR 601.3)
  if (info.singleKey) g.s.turnActivations[info.singleKey] = (g.s.turnActivations[info.singleKey] ?? 0) + 1; // std-rx27: "a card" (CR 601.3)
  const lnkKey = info.linkedPermit?.key;
  if (lnkKey) g.s.turnActivations[lnkKey] = (g.s.turnActivations[lnkKey] ?? 0) + 1; // std-rx27: "once each turn, you may cast ... from among cards exiled with ~" (CR 601.3)
  const altKey = info.grantedAlt?.key;
  if (altKey) g.s.turnActivations[altKey] = (g.s.turnActivations[altKey] ?? 0) + 1; // r3-cost: "once each turn, you may pay {0} rather than ..." (CR 118.9)
  const spell = g.obj(stackId);
  spell.stack = { kind: 'spell', face: info.face, targets: [], costsPaid: info.alt ? { alternative: info.alt.name } : {}, castFrom, caster: player }; // FAST4 T27: the caster (CR 601.2a)
  if (info.fused) spell.stack.fused = true; // CR 702.102a
  // C10 (CR 614.1c): "If you cast a spell this way, that artifact enters with a finality counter on it": the spell remembers it (effects/rule-replacements/permit-enters.ts)
  if (info.gyPermit?.exileOnLeave === true) spell.stack.exileOnLeave = true; // std-rx24 (CR 702.133a): jump-start, as harmonize below
  if (info.permitGraveyard) spell.stack.permitGraveyardInstead = info.permitGraveyard; // r5-repl (CR 614.1a): effects/rule-replacements/permit-graveyard.ts
  if (info.gyPermit?.entersWith) {
    spell.stack.permitEnters = { counters: JSON.parse(JSON.stringify(info.gyPermit.entersWith)) as NonNullable<typeof info.gyPermit.entersWith>, source: info.gyPermit.source };
    if (info.gyPermit.entersSubtypes) spell.stack.permitEnters.subtypes = [...info.gyPermit.entersSubtypes]; // std-freecast-2 (CR 614.1c, 205.1b)
  }
  // std-rx27 (CR 614.1c): "If you cast a spell this way, that creature enters with a finality counter on it" of the linked permission it is cast with
  if (info.topEnters) spell.stack.permitEnters = { counters: JSON.parse(JSON.stringify(info.topEnters.counters)) as CounterSpec[], source: info.topEnters.source }; // std-rx27
  if (info.linkedPermit?.entersWith) spell.stack.permitEnters = { counters: JSON.parse(JSON.stringify(info.linkedPermit.entersWith)) as NonNullable<typeof info.linkedPermit.entersWith>, source: info.linkedPermit.source };
  // FAST5X E2 (CR 702.185a, 400.7g): the static ability of the alternative cost that functions on the stack ("exile the permanent this spell becomes at the
  // beginning of the next end step"), kept with the spell so a granted warp still applies to it; core/resolve.ts creates the delayed triggered ability
  if (info.alt?.delay) spell.stack.altDelay = JSON.parse(JSON.stringify(info.alt.delay)) as NonNullable<typeof info.alt.delay>;
  if (info.alt?.exileOnLeave) spell.stack.exileOnLeave = true; // FAST5X E6 (CR 702.180a): harmonize's "exile this card ... any time it would leave the stack"
  info.provider?.onStack(g, spell); // M6-0 (m6 design 2.6): the status a cast option gives the spell (face down, prototyped, back face up, mutating)
  lockNextSpellKeywords(g, player, stackId); // std-rx26: "the next spell you cast this turn has convoke" applies from now on, while its costs are determined (CR 601.2a, 601.2f)
  const paid = spell.stack.costsPaid;
  const aenv: AnnounceEnv = { s: g.s, player, sourceId: stackId, costsPaid: paid, castFrom };

  // the spell is on the stack now: its new object is what restricted mana is checked against; FAST5X E29: any type of mana (CR 609.4b)
  const stackSpend = { kind: 'spell' as const, id: stackId, ...(info.anyManaType ? { anyType: info.anyManaType === 'color' ? ('color' as const) : (true as const) } : {}) };
  // FAST5X E23 (CR 202.3e, 106.6): planned for a value of X, the spell's mana value counts it ("spells with mana value 4 or greater")
  const basePlan = (x: CostX): CostPlan => ({ ...info.base(x), spend: typeof x === 'number' ? { ...stackSpend, x } : stackSpend });

  // CR 601.2f: cost modifiers (hook), then the emerge reduction of the sacrificed creature's mana value (CR 702.119a) on the TOTAL cost. `pick` is set below.
  let pick: ObjectId | undefined;
  // FAST5X E6 (CR 702.180a-b): the creature chosen to be tapped for a harmonize cost; its power reduces the total cost (read as the total is determined, 601.2f)
  let tapped: ObjectId | undefined;
  const finish = (plan: CostPlan): CostPlan => {
    const modified = applyCostModifiers(g, player, spell, plan);
    const emerged = pick === undefined ? modified : emergeReduction(g.s, modified, pick) ?? modified;
    if (tapped === undefined) return emerged;
    const reduced = tapReduction(g.s, emerged, tapped);
    if (!reduced) throw new IllegalAction(`The power of ${g.nameOf(tapped)} can't be read, so the total cost of ${spellName} is unknown.`, ['CR 702.180a', 'CR 601.2f']);
    return reduced;
  };
  // Could the player pay this plan (every payment option considered, CR 601.2f-h) once the modifiers and the emerge reduction are applied?
  const payable = (plan: CostPlan): boolean => payableWithOptions(g.s, player, stackId, finish(plan)) === null;

  // CR 601.2b, 118.8: the costs paid besides the base cost: mandatory additional costs, chosen optional ones (kicker, buyback, entwine; multikicker any number of
  // times) and the costs of the chosen modes. They are kept as definitions so that each is built again with the announced X (CR 107.3a).
  const costs: CostDef[] = [];
  announceMandatoryCosts(info.additional, paid, costs); // moved unchanged to actions/cast-costs.ts (M6-0, m6 design 4.1)
  if (taxCost) costs.push(taxCost); // M11-1: CR 903.8, 118.8
  if (info.gyPermit?.addCost) costs.push(info.gyPermit.addCost); // C10: the graveyard permission's additional cost (CR 601.2f, 118.8)
  if (info.linkedPermit?.addCost) costs.push(info.linkedPermit.addCost); // std-exile-play-2-1: the linked permission's (CR 601.2f, 118.8)
  if (info.permitIncrease) costs.push(info.permitIncrease); // std-exile-play-1-3: the permission's cost increase (CR 601.2f)
  if (info.flashAddCost) costs.push(info.flashAddCost); // std-rx10: the flash permission's additional cost (CR 601.3b, 118.8)

  // CR 601.2b: the way it is cast. An emerge cost names the permanent to sacrifice now (CR 702.119c); only ones that leave the total payable are offered.
  if (info.alt?.name === 'emerge') {
    // CR 601.2f, 702.119a: judged on the total cost after increases and reductions, as castCheck judges it (WP16 review fix)
    const candidates = emergePayableCandidates(g.s, player, stackId, applyCostModifiers(g, player, spell, addPlans(basePlan('unannounced'), planFromCostDefs(costs, 'unannounced'))));
    if (candidates.length === 0) throw new IllegalAction(`You have no permanent to sacrifice that leaves the emerge cost of ${spellName} payable.`, ['CR 702.119a', 'CR 601.2h']);
    pick = g.choose({
      kind: 'chooseObjects', player, prompt: `Choose the permanent to sacrifice for the emerge cost of ${spellName}.`, options: candidates, min: 1, max: 1, cancellable: true, rules: ['CR 702.119a', 'CR 702.119c', 'CR 601.2b'],
    }).ids[0]!;
  }
  // FAST5X E6 (CR 702.180b, 601.2b): a harmonize cost: choose up to one untapped creature you control to tap as the total cost is paid. Only creatures whose tap
  // leaves the total payable are offered; none is required when the cost can be paid without one.
  if (info.alt?.tapReduces === 'power') {
    const total = applyCostModifiers(g, player, spell, addPlans(basePlan('unannounced'), planFromCostDefs(costs, 'unannounced')));
    const candidates = tapReduceCandidates(g.s, player, stackId, total);
    const plainOk = payableWithOptions(g.s, player, stackId, total) === null;
    const method = info.alt.name.replace(/:\d+$/, '');
    if (candidates.length === 0 && !plainOk) throw new IllegalAction(`You can't pay the ${method} cost of ${spellName}.`, ['CR 702.180a', 'CR 601.2h']);
    if (candidates.length > 0) {
      tapped = g.choose({
        kind: 'chooseObjects', player, prompt: `You may choose an untapped creature you control to tap for the ${method} cost of ${spellName}: the cost is reduced by generic mana equal to its power.`,
        options: candidates, min: plainOk ? 0 : 1, max: 1, cancellable: true, rules: ['CR 702.180a', 'CR 702.180b', 'CR 601.2b'],
      }).ids[0];
      if (tapped !== undefined) g.log(`${name} chooses to tap ${g.nameOf(tapped)} for the ${method} cost of ${spellName}.`, { rules: ['CR 702.180b'], level: 'info' });
    }
  }

  announceOptionalCosts({ g, player, name, spellName, stackId, additional: info.additional, programs: info.programs, paid, aenv, costs, basePlan, payable }); // actions/cast-costs.ts (M6-0)

  // CR 601.2b, 700.2: modes. The additional costs announced above may change how many (kicked, entwine, CR 601.4); the cost of the whole chosen SET is checked (CR 700.2h).
  const modes = chooseModes(g, player, info.programs, stackId, stackId, spellName, aenv, (modeCs) => payable(addPlans(basePlan('unannounced'), planFromCostDefs([...costs, ...modeCs], 'unannounced'))));
  if (modes) spell.stack.modes = modes;
  const programs = effectivePrograms(info.programs, modes);
  let allCosts = [...costs, ...modeCosts(info.programs, modes)];
  const planAt = (x: number): CostPlan => addPlans(basePlan(x), planFromCostDefs(allCosts, x));

  // CR 601.2b, 107.3a: X, announced when any cost that will be paid has one. The largest X is what the player can pay for with every payment option considered;
  // with an X in a cost part's filter ("sacrifice a creature with mana value X") only some values can be paid, and every value up to the cap is tried.
  let x = 0;
  const announcedX = info.baseHasX || allCosts.some(costHasX);
  if (announcedX) {
    // FAST5X E23 (CR 106.6, 202.3e): restricted mana may pay only from some X on ("spells with mana value 4 or greater"): then every value is tried
    // r3-cost (CR 107.3, 601.2b): and no larger than an additional cost's "X can't be greater than ..." allows
    const cap = xCap(g.s, player, stackId, info.additional);
    if (cap === undefined) throw new IllegalAction(`The largest X ${spellName} allows can't be read.`, ['CR 107.3', 'CR 601.2b']);
    const xs = payableXs((n) => payable(planAt(n)), costFilterHasX(info.alt?.cost) || allCosts.some(costFilterHasX) || hasRestrictedMana(g.s, player)).filter((n) => n <= cap);
    if (xs.length === 0) throw new IllegalAction(`You can't pay for ${spellName} with any value of X.`, ['CR 601.2h', 'CR 107.3a']);
    x = chooseX(g, player, xs[xs.length - 1]!, spellName, xs);
    spell.stack.x = x;
  }

  // CR 601.2c-d: targets (none for target-less spells) and the division.
  aenv.x = x;
  const announced = announceTargets(g, player, programs, stackId, stackId, spellName, aenv);
  spell.stack.targets = announced.targets;
  if (Object.keys(announced.division).length > 0) spell.stack.division = announced.division;
  allCosts = withTargetTotals(allCosts, spellTargetTotal(g.s, spell.stack.targets)); // std-costs-1: CR 601.2f, the total cost reads the chosen targets

  // CR 601.2e: the game checks that the proposed spell can be cast; CR 601.2f: total cost, then the payment options (convoke, delve, improvise).
  const total = applyPaymentOptions(g, player, stackId, resolveAnyCounts(g, player, null, finish(planAt(x)), spellName), spellName);

  // CR 601.2g-h: payment.
  const paidNow = payPlan(g, player, null, total, spellName, { announcedX });
  paid.manaSpent = paidNow.manaSpent;
  // Mana that makes the spell uncounterable (Cavern of Souls, CR 106.6) leaves a flag on the spell for hookpoints.canBeCountered.
  if (paidNow.manaSpent.some((u) => u.restriction?.spellRider === 'cantBeCountered')) (spell.stack.flags ??= []).push(FLAG_CANT_BE_COUNTERED);
  applySpentRiders(g, player, stackId, paidNow.manaSpent); // std-mana-1: "if that mana is spent on <spells>, it gains <keyword> until end of turn" (CR 106.6)
  if (paidNow.lifePaid) paid.lifePaid = paidNow.lifePaid;
  if (paidNow.costObjects.length) paid.costObjects = paidNow.costObjects;
  if (paidNow.sacrificed?.length) paid.sacrificed = paidNow.sacrificed; // FAST3 T18: "the sacrificed creature" (CR 608.2h)
  if (paidNow.returned?.length) paid.returned = paidNow.returned; // FAST5X E7: "the returned creature" (CR 608.2h, 702.188a, 702.190b)
  if (paidNow.discarded?.length) paid.discarded = paidNow.discarded; // CLOUD C8: "the discarded card" of an additional cost (CR 601.2b, 400.7j)
  if (paidNow.exiled) paid.exiled = paidNow.exiled; // CLOUD C8: "the exiled card" of an additional cost (CR 601.2b, 400.7j)
  if (paidNow.beheld?.length) paid.beheld = paidNow.beheld; // FAST5X E11: "if a Dragon was beheld" (CR 701.4b)
  if (paidNow.chosenObjects?.length) paid.chosenObjects = paidNow.chosenObjects; // std-costs-2: "the chosen creature or card" (ObjRef costChosenObject)
  if (paidNow.revealed?.length) paid.revealed = paidNow.revealed; // p2-refs-1: "the revealed card" (ObjRef costRevealed)
  if (paidNow.costLinks) paid.costLinks = paidNow.costLinks; // FAST5X E11: "behold a Goblin and exile it" ... "the exiled card" (CR 607.2q)
  // std-rq (CR 702.194a, 601.2h): each creature tapped for the spell's teamwork cost "becomes tapped to pay a teamwork cost" as the cost is paid (the one cast-time
  // cost that taps creatures by total power)
  if ((paid.additional ?? []).includes('teamwork')) for (const id of paidNow.tappedPower ?? []) g.emit({ type: 'crewTapped', objectId: stackId, by: id, as: 'teamwork', player });
  // FAST5X E7 (CR 702.190b, 601.2h): the permanent this spell becomes will attack what the creature returned for the cost was attacking as it left (its last
  // known information: leaving the battlefield removed it from combat, CR 506.4)
  if (info.alt?.entersAttacking === 'returned') {
    const was = paidNow.returned?.[0] !== undefined ? g.s.lki[paidNow.returned[0]]?.combat : undefined;
    spell.stack.entersAttacking = { defender: was?.defender ?? null, defendingPlayer: was?.defendingPlayer ?? null };
  }

  // CR 601.2i: the spell has been cast.
  // Storm (CR 702.40a) counts the spells cast this turn by ALL players before this one, not only the caster's.
  const spellsBefore = g.s.players.reduce((n, p) => n + p.turnStats.spellsCast, 0);
  g.player(player).turnStats.spellsCast++;
  // pc-exile-play-2 (CR 601.2i): the spell's place among the spells its caster cast this turn, and among those cast from the same zone ("the first spell you cast from exile each turn")
  {
    const ts = g.player(player).turnStats;
    const counts = (ts.castFromCount ??= {});
    counts[castFrom ?? 'hand'] = (counts[castFrom ?? 'hand'] ?? 0) + 1;
    spell.stack.castOrdinal = { turn: ts.spellsCast, fromZone: counts[castFrom ?? 'hand']! };
  }
  // M11-1, CR 903.8, 702.124d: one more cast of THIS commander from the command zone, counted as it becomes cast whatever happens to the spell later
  const commander = fromCommandZone ? commanderOfCard(g.s, spell.cardId) : undefined;
  if (commander) commander.rec.casts++;
  takeNextSpellRiders(g, player, stackId); // Standard round 10: "the next spell you cast this turn can't be countered" applies as the spell becomes cast (CR 601.2i, 101.2)
  recordCastChecks(g, stackId, player, programs); // FAST5X E17: "if you controlled a Mount as you cast this spell" is decided now (CR 601.2i)
  // FAST5X E19 (CR 106.3, 601.2h): the subtypes of the source of each mana spent, when any had some ("if mana from a Treasure was spent to cast it")
  const manaFrom = paid.manaSpent.some((u) => u.sourceSubtypes !== undefined) ? paid.manaSpent.map((u) => [...(u.sourceSubtypes ?? [])]) : undefined;
  // std-lci (CR 106.3): the sources of the mana spent ("whenever you cast a permanent spell using mana produced by ~", triggers/match.ts)
  const manaSources = [...new Set(paid.manaSpent.flatMap((u) => (u.sourceId !== undefined ? [u.sourceId] : [])))];
  g.emit({ type: 'spellCast', objectId: stackId, player, spellsBefore, manaSpent: paid.manaSpent.length, ...(manaFrom ? { manaFrom } : {}), ...(manaSources.length > 0 ? { manaSources } : {}) }); // FAST5X E9: increment (CR 702.191a) reads the mana spent
  manaSpentTriggers(g, stackId, player, paid.manaSpent); // std-copy-3: "When that mana is spent to cast a red instant or sorcery spell, ..." (CR 106.6, 603.2)
  emitBecameTarget(g, stackId, player, spell.stack.targets);
  emitCrime(g, stackId, player, spell.stack.targets); // FAST5X E20: CR 700.13
  recordSpellMana(g, player, paid.manaSpent.length); // FAST5X E20: CR 700.14, expend
  const how = info.alt ? `${info.alt.name === 'flashback' ? ' with flashback' : ` with ${info.alt.name}`}${during ? ' while an effect resolves' : ''}` : during ? `${during.free ? ' without paying its mana cost' : ''} while an effect resolves` : '';
  const extras = (paid.additional ?? []).filter((n) => !isKickerName(n));
  const taxText = taxCost?.mana ? manaCostText(taxCost.mana) : `${taxCost?.other?.find((x) => x.kind === 'payLife')?.amount ?? 0} life`; // CMD2: a tax paid in life (CR 903.8)
  const taxPaid = taxCost ? ` from the command zone (commander tax ${taxText})` : fromCommandZone ? ' from the command zone'
    : info.gyPermit ? (castFrom === 'outside' ? ` from outside the game (${info.gyPermit.source})` : ` from their graveyard (${info.gyPermit.source})`) : ''; // C10; trek-11
  g.log(`${name} casts ${spellName}${taxPaid}${how}${info.fused ? ' as a fused split spell' : ''}${x > 0 ? ` with X = ${x}` : ''}${paid.kicked ? (paid.kicked > 1 ? ` kicked ${paid.kicked} times` : ' kicked') : ''}${extras.length ? ` (${extras.join(', ')})` : ''}${describeTargets(g, spell.stack.targets)}.`, {
    rules: ['CR 601.2', ...(info.alt?.name === 'flashback' ? ['CR 702.34a'] : []), ...(info.fused ? ['CR 702.102a'] : []), ...(fromCommandZone ? ['CR 903.8'] : []), ...(info.gyPermit ? ['CR 601.3'] : [])],
    level: 'action',
  });
}

/**
 * std-copy-3 (CR 106.6, 603.2, 601.2i): the mana spent to cast the spell that carries "When that mana is spent to cast <spells>, <do>" (`ManaUnit.whenSpent`): each such
 * unit spent on a spell that matches its filter as it becomes cast triggers once, put on the stack the next time a player would receive priority, its controller and
 * source those of the ability that added the mana, "that spell" the spell (the event of a `cast`). A unit spent otherwise triggers nothing.
 */
function manaSpentTriggers(g: Game, stackId: ObjectId, player: PlayerId, spent: readonly ManaUnit[]): void {
  const o = g.s.objects[stackId];
  if (!o) return;
  for (const u of spent) {
    const t = u.whenSpent;
    if (t === undefined) continue;
    if (!matchesFilter(g.s, o, t.spells, filterCtxOutside(g.s, { controller: t.controller, sourceId: t.sourceId }))) continue;
    const source = g.s.objects[t.sourceId];
    putReflexiveTrigger(g, {
      source: { id: t.sourceId, zone: source?.zone ?? g.s.lki[t.sourceId]?.leftZone ?? 'battlefield' }, controller: t.controller,
      text: `When that mana is spent to cast ${g.nameOf(stackId)}, its triggered ability resolves.`, targets: [], steps: structuredClone(t.do),
      context: { ev: 'cast', roles: { spell: { objects: [{ id: stackId, zone: 'stack' }] }, player: { players: [player] } }, before: {} },
    });
    g.log(`The mana ${g.nameOf(t.sourceId)} added was spent to cast ${g.nameOf(stackId)}: its triggered ability triggers.`, { rules: ['CR 106.6', 'CR 603.2'], level: 'info' });
  }
}

/**
 * WP14 INTERFACE CHANGE: casting a card while an effect resolves (CR 608.2g, the `cast` op of effects/handlers/tokens-cast.ts). The interpreter can't import this
 * module (design 5.4), so it is reached through effects/cast-hook.ts, installed here when the module loads. A card with several castable faces (split, modal
 * double-faced, adventure) asks which one (CR 709.3, 712.11b, 715.3); a face that can't be cast now is not offered.
 * WP32 INTERFACE CHANGE (additive): `opts.maxManaValue` offers only the faces whose resulting spell has at most that mana value (cascade CR 702.85a, discover
 * CR 701.57a: "if the resulting spell's mana value is less than ..."); cast without paying its mana cost, X is 0 (CR 107.3b), so it is the face's own.
 */
function castableFacesNow(g: Game, player: PlayerId, card: ObjectId, opts: ResolutionCastOptions): number[] {
  const def = g.s.defs[g.obj(card).defId];
  if (!def) return [];
  return castableFaces(def, opts.transformed === true).filter((f) => withinManaValue(def, f, opts) && !('denial' in castCheck(g.s, player, card, f, undefined, opts)));
}

// CR 712.8c: faceChars gives the back face of a transforming double-faced card the mana value of its front face (rules/base-chars.ts#costForManaValue).
const withinManaValue = (def: CardDef, face: number, opts: ResolutionCastOptions): boolean => opts.maxManaValue === undefined || faceChars(def, face).manaValue <= opts.maxManaValue;

installResolutionCaster({
  check: (g, player, card, opts) => {
    if (castableFacesNow(g, player, card, opts).length > 0) return null;
    const def = g.s.defs[g.obj(card).defId];
    if (def && opts.maxManaValue !== undefined && !castableFaces(def, opts.transformed === true).some((f) => withinManaValue(def, f, opts))) {
      return deny(`The spell would have a mana value greater than ${opts.maxManaValue}.`, 'CR 702.85a', 'CR 701.57a');
    }
    const r = castCheck(g.s, player, card, undefined, undefined, opts);
    return 'denial' in r ? r.denial : deny('No face of that card can be cast now.', 'CR 601.3');
  },
  cast: (g, player, card, opts) => {
    const faces = castableFacesNow(g, player, card, opts);
    if (faces.length === 0) return null;
    let face = faces[0]!;
    if (faces.length > 1) {
      const def = g.s.defs[g.obj(card).defId]!;
      const ans = g.choose({
        kind: 'chooseOption', player, prompt: `Which half of ${def.name} do you cast?`, min: 1, max: 1,
        options: faces.map((f) => ({ id: String(f), label: def.faces[f]!.name })), rules: ['CR 709.3', 'CR 712.11b', 'CR 715.3'],
      });
      face = Number(ans.ids[0] ?? face);
    }
    castSpell(g, { type: 'cast', player, card, face }, opts);
    return g.s.lki[card]?.newId ?? null; // CR 400.7h: the new object on the stack
  },
});

/**
 * std-costs-1 (CR 601.2c, 601.2f, 701.59a; Urgent Necropsy): "As an additional cost to cast this spell, collect evidence X, where X is the total mana value of the
 * permanents this spell targets": the targets are chosen before the total cost is determined, so once they are, the quantity of each cost that reads them
 * (`{q:'spellTargetTotal'}`, rules/target-total.ts) becomes that number. Costs that read no targets are returned as they are.
 */
function withTargetTotals(costs: CostDef[], total: number): CostDef[] {
  if (!JSON.stringify(costs).includes('"spellTargetTotal"')) return costs;
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (typeof v !== 'object' || v === null) return v;
    if ((v as { q?: unknown }).q === 'spellTargetTotal') return total;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
  };
  return costs.map((c) => fix(c) as CostDef);
}

/** pc-exile-play-1 (CR 609.4b, 107.4c): mana of any type (a static ability's) wins over mana as though of any color (a static ability's or the permission's). */
function staticAnyColorOrType(fromStatic: boolean | 'color', colorPermit: boolean): boolean | 'color' {
  return fromStatic === true ? true : colorPermit ? 'color' : fromStatic;
}
