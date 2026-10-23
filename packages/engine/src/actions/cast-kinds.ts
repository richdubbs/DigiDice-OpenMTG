/**
 * The static effect kinds the cast path reads (`static:<s>`, design 5.2; m6 design 3.8, package M6-5a). Owner: M6-5 (pulled forward as M6-5a).
 *
 * `actions/cast-options.ts#castOptionsOf` reads `additionalCost` (CR 118.8, 601.2b: kicker, multikicker, buyback, entwine and the mandatory "As an additional
 * cost to cast this spell, ..." costs) and `alternativeCost` (CR 118.9: evoke, "You may ... rather than pay this spell's mana cost") from the PRINTED abilities of
 * the card being cast (`faceChars`, the card's own face, CR 601.2b), and `actions/cast.ts` announces, totals and pays them (CR 601.2b, 601.2f-h) and records them in
 * `CostsPaid` (CR 400.7d, 607.2i). model/capabilities.ts adds these names to `static:`; the keyword capabilities (kicker, multikicker, entwine, evoke, buyback) then
 * follow by themselves through `keywordCapabilities`.
 *
 * What these kinds do NOT cover, and the walker keeps manual (model/cap-walk.ts#castStaticForms): such an effect stored by a resolving spell (CR 611.2: the
 * `effect` op has nothing that would read it) or granted to another object by a layer 6 effect (the cast path reads only the printed face), both
 * `feature:castCost.lasting` / `feature:castCost.granted`; M6-12 registers the second (`CAST_COST_FEATURES`), the first stays unregistered.
 */
export const CAST_STATIC_KINDS: Readonly<Record<'additionalCost' | 'alternativeCost' | 'castWith', true>> = {
  additionalCost: true, // CR 118.8, 601.2b, 601.2f
  alternativeCost: true, // CR 118.9, 601.2b
  castWith: true, // FAST5X E2 (CR 601.3, 113.6f): "you may cast this card from your graveyard using its warp ability", actions/cast-options.ts#castOptionsOf
};

/**
 * M6-5 (m6 design 3.8): the `feature:` names the cast path honors beyond the two kinds above (model/capabilities.ts adds them): the choice between grouped
 * additional costs ("sacrifice a creature or pay {3}", CR 601.2b; `AdditionalCostDef.choiceGroup`, announced by actions/cast-costs.ts#announceGroupedCosts),
 * which model/cap-walk.ts asks for as `feature:additionalCost.choiceGroup`. Kept in this import-free file so model/capabilities.ts loads no engine module.
 */
export const CAST_COST_FEATURES: readonly string[] = [
  'additionalCost.choiceGroup',
  // M6-12 (m6 design 3.8): a cast-cost keyword or cost static GRANTED to a card by a continuous effect ("target instant or sorcery card in your graveyard gains
  // flashback {2}{R}{G} until end of turn"): actions/cast.ts#withGrantedCosts reads the card's granted abilities where it is (CR 601.2b, 613.1f)
  'castCost.granted',
  // FAST5X E2 (CR 702.185a, 603.7): an alternative cost's static ability that acts on the permanent the spell becomes (warp's delayed exile): actions/cast.ts
  // keeps it in `StackInfo.altDelay`, core/resolve.ts creates the delayed triggered ability as the permanent enters
  'alternativeCost.delay',
  // FAST5X E7 (CR 702.190a): an alternative cost that may be paid any time its caster could cast an instant while its `when` holds (sneak): actions/cast.ts#castCheck
  'alternativeCost.instantSpeed',
  // FAST5X E7 (CR 702.190b, 508.4): the permanent the spell becomes enters tapped and attacking what the creature returned for the cost attacked: actions/cast.ts
  // records it in `StackInfo.entersAttacking`, core/resolve.ts applies it
  'alternativeCost.entersAttacking',
  // FAST5X E6: mayhem's "as long as you discarded this card this turn" (CR 702.187b), harmonize's tapped creature that reduces the total cost by its power
  // (CR 702.180a-b) and its exile on leaving the stack (CR 702.180a): actions/cast.ts#castCheck and #castSpell, core/resolve.ts#leaveStack
  'alternativeCost.discardedThisTurn',
  'alternativeCost.tapReduces',
  'alternativeCost.exileOnLeave',
  // FAST5 T56 (CR 702.34a): flashback whose cost is the card's own mana cost, "The flashback cost is equal to its mana cost": actions/cast-options.ts#castOptionsOf
  'keyword.flashback.costIsManaCost',
  // cloud r3-mech (CR 702.187b): mayhem whose cost is the card's own mana cost: actions/cast-options.ts#castOptionsOf
  'keyword.mayhem.costIsManaCost',
  // r5-cost (CR 702.180a, 702.128a): harmonize and embalm whose cost is the object's mana cost, "Its harmonize cost is equal to its mana cost": keywords/expand.ts
  'keyword.costIsManaCost',
  // r3-cost (CR 107.3, 601.2b): "X can't be greater than the greatest toughness among creatures you control" on a mandatory additional cost with X: actions/cast.ts#xCap
  'additionalCost.xMax',
  // std-costs-2 (CR 601.2b, 607.2d): an optional additional cost that starts with choosing a creature type, remembered by the spell: actions/cast-costs.ts#announceOptionalCosts
  'additionalCost.chooseType',
  // std-costs-1 (CR 601.2b, 601.2f): "you may sacrifice any number of ... This spell costs {1} less to cast for each permanent sacrificed this way": the number is
  // announced with the optional cost and kept in `CostsPaid.counts` (actions/cast-costs.ts#announceOptionalCosts, actions/cast.ts#optionalCostMakesCastable)
  'additionalCost.announceCount',
];
