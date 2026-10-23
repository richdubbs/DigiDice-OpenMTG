/**
 * The rule replacements of Sagas (CR 714.3a-b, read ahead 702.155b; m6 design 3.7). Owner: M6-6.
 *
 * Empty on purpose. CR 714.3a-b give every Saga INTRINSIC ABILITIES ("This Saga enters with a lore counter on it"; with read ahead, "As this Saga enters, choose
 * a number ..." and "This Saga enters with the chosen number of lore counters on it"), so they are rule-generated abilities of the object
 * (statics/levels.ts#sagaRuleAbilities through statics/abilities.ts#ruleAbilitiesFor, keys `r:saga` / `r:readAhead`) rather than replacement effects without a
 * source: the entering pipeline then reads them from the permanent as it would exist on the battlefield (CR 614.12: a Copy Enchantment entering as a copy of a
 * Saga is a Saga, a Saga entering face down is not), "loses all abilities" removes them like any ability, and the self-candidate path of
 * effects/replacements.ts applies them in the CR 616.1 order with the other replacement effects. (A part file here could not build that hypothetical permanent:
 * effects/entering.ts imports effects/registries.ts, an import cycle.)
 */
import type { RuleReplacement } from '../registries';

export const SAGA_RULE_REPLACEMENTS: readonly RuleReplacement[] = [];
