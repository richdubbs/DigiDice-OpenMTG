/**
 * Op handlers: cards, libraries and mana (CR 121, 701.9-701.25, 106). Owner: WP13. The aggregator (handlers/index.ts) spreads this table into OP_HANDLERS; the
 * capability `op:<op>` appears only when the op has a handler here AND a renderer (design 5.2), so an unfinished package can never make a card wrongly automated.
 * Ops: draw discard mill scry surveil reveal look search shuffle piles addMana exileUntil revealUntil (r3-dig) clash (p2-player-rules-2). The handlers live in cards-{draw,library,reveal,mana}.ts (exileUntil:
 * actions-native.ts, beside the loop of cascade and discover it shares).
 */
import type { OpHandlers } from '../api';
import { discardHandler, drawHandler, millHandler } from './cards-draw';
import { clashHandler, scryHandler, searchHandler, shuffleHandler, surveilHandler } from './cards-library';
import { addManaHandler } from './cards-mana';
import { lookHandler, pilesHandler, revealHandler, revealUntilHandler } from './cards-reveal';
import { exileUntilStep } from './actions-native'; // Cloud std-eoe: "exile cards from the top of your library until you exile a nonland card"

export const CARDS_HANDLERS: OpHandlers = {
  draw: drawHandler,
  discard: discardHandler,
  mill: millHandler,
  scry: scryHandler,
  surveil: surveilHandler,
  reveal: revealHandler,
  look: lookHandler,
  search: searchHandler,
  shuffle: shuffleHandler,
  piles: pilesHandler,
  addMana: addManaHandler,
  exileUntil: exileUntilStep, // Cloud std-eoe (CR 406.1, 608.2c)
  revealUntil: revealUntilHandler, // r3-dig (CR 701.20a, 608.2c)
  clash: clashHandler, // p2-player-rules-2 (CR 701.30): reveal the top card of a library, then top or bottom, as scry does
};

/**
 * Features this family implements (capability names `feature:<name>`, design 5.2), read by model/capabilities.ts.
 *   mana.restriction: a structured spending restriction on added mana (CR 106.6, design D8). The mana carries it (`ManaUnit.restriction`) and payment spends it
 *   only where its `spells` / `abilities` filters allow (rules/sources.ts). The "that spell can't be countered" rider is its own form
 *   (`feature:mana.rider.cantBeCountered`), registered by whoever makes countering honor the flag actions/cast.ts leaves on the spell; until then a card with
 *   the rider stays partial (std-lci registered it: both halves are there).
 *   mana.eventProduced (T38): "one mana of any type that land produced", read from the triggering mana ability's activation (EventContext.produced, CR 106.3, 605.1b).
 *   It is registered for a triggered ability; capability walking names it for any `addMana` of that kind, and an activated mana ability stays `feature:mana.steps`.
 */
// FAST5X E23: 'mana.restriction.abilityKeyword' (CR 702.6a), 'mana.restriction.turnFaceUp' (CR 116.2b), 'mana.restriction.notSpells' (CR 106.6), all read by
// rules/sources.ts#spendAllows
// std-lci: 'mana.rider.cantBeCountered' (CR 106.6, 101.2): actions/cast.ts leaves FLAG_CANT_BE_COUNTERED on a spell cast with such mana, and the counter op
// honors it (effects/handlers/zones-remove.ts, and statics/hooks.ts#canBeCountered for every other asker); a copy never has it (rules/stack-objects.ts)
export const FEATURES: readonly string[] = ['mana.restriction', 'mana.restriction.unlock', 'mana.eventProduced', 'mana.restriction.abilityKeyword', 'mana.restriction.turnFaceUp', 'mana.restriction.notSpells', 'mana.rider.cantBeCountered', 'mana.anyColor.from' /* r3-cost: cards-mana.ts, CR 106.1 */, 'piles.faceDown' /* r5-dig: cards-reveal.ts#faceDownPiles, CR 700.3 */, 'choose.cardKind' /* std-rx28: choose.ts and bodies/m5.ts ask a land or nonland card name, core/validate.ts checks it (CR 201.3) */, 'mana.spentRider.entersWith' /* pc-keywords-mana-2: core/mana-riders.ts, CR 614.1c */, 'mana.spentRider' /* std-mana-1: core/mana-riders.ts, CR 106.6 */, 'mana.couldProduce' /* p2-mana-1: cards-mana.ts#couldProduceTypes, CR 106.7 */, 'mana.devotionColor' /* p2-mana-2: cards-mana.ts, CR 700.5 */]; // 'mana.restriction.unlock': FAST5X E8 (CR 709.5e, rules/sources.ts#spendAllows); 'mana.eventProduced': T38
