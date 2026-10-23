/**
 * Triggered abilities (CR 603): putting pending triggers on the stack (CR 603.3) each time a player would receive priority. The work is done in triggers/
 * (design 8.4); this module is the hook milestone 3 left for `core/turn.ts#advance` and the one place that connects triggers/ to the layers it may not import
 * (design 5.4: triggers import types, statics, rules, core and keywords): the announcement functions of actions/announce.ts, so that a triggered ability chooses
 * its modes and targets with "the same functions" as a spell (design 8.2.7, CR 603.3c-d), and the condition evaluator of the interpreter (effects/eval.ts).
 *
 * WP32: it also installs the resolution of triggered mana abilities (CR 605.4a) into rules/mana.ts, which calls it right after a mana ability is activated:
 * triggers/mana-now.ts finds them, effects/mana-now.ts resolves them (rules/ may import neither, design 5.4).
 */
import type { Condition } from '../types/ability';
import { chooseModes, chooseTargets, effectivePrograms, unsupportedForms } from '../actions/announce';
import { COND_EVALUATORS, evalCond } from '../effects/eval';
import { resolveTriggeredManaAbility } from '../effects/mana-now';
import { installTriggeredManaResolver } from '../rules/mana';
import { triggeredManaAbilitiesFor } from '../triggers/mana-now';
import { putPendingTriggersOnStack as put } from '../triggers/stack';
import { configureTriggers } from '../triggers/wiring';

/** Does the interpreter's evaluator know every condition in this tree (its capability `cond:<cond>`)? */
const knows = (c: Condition): boolean => {
  if (!Object.hasOwn(COND_EVALUATORS, c.cond)) return false;
  if (c.cond === 'all' || c.cond === 'any') return c.of.every(knows);
  if (c.cond === 'not') return knows(c.of);
  return true;
};

configureTriggers({
  announcer: { chooseModes, chooseTargets, effectivePrograms, unsupportedForms },
  conditions: { knows, evaluate: evalCond },
});

// CR 605.4a: after each activation of a mana ability, its triggered mana abilities resolve at once, in APNAP order of their controllers (CR 101.4).
installTriggeredManaResolver((g, at) => {
  for (const { trigger, def } of triggeredManaAbilitiesFor(g, at)) resolveTriggeredManaAbility(g, trigger, def);
});

/** Returns true if any trigger was put on the stack (or removed from it because a choice could not be made, CR 603.3c-d). */
export const putPendingTriggersOnStack = put;
export { collectPendingTriggers, syncHistory } from '../triggers/stack';
