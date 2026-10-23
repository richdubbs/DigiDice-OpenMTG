/** CR 701 actions that restrict a permanent for a while: detain (701.35). A pure macro over the primitive `effect` op. Owner: WP3. */
import type { ActionMacro } from '../types';
import { carry, manualAction } from './common';

/**
 * CR 701.35a: "Until the next turn of the controller of that spell or ability, that permanent can't attack or block and its activated abilities can't be
 * activated." The permanent is the step's `subject` (the target the sentence names); it is the controller of the detaining spell or ability (`you`, not the
 * step's `who`, which may be another player) whose next turn ends the effect. A resolved effect locks the permanent in (CR 611.2c) and the three restrictions
 * are rule actions (`attack`, `block`, `activate` of the permanent), so a permanent that stops being a creature is still detained for its abilities.
 */
export const DETAIN: ActionMacro = {
  name: 'detain',
  rule: 'CR 701.35',
  expand: (step) => {
    if (step.subject === undefined) return manualAction(step, 'detain needs the permanent it detains');
    const subject = step.subject;
    return carry(step, [
      {
        op: 'effect',
        effects: [
          { s: 'restrict', subject, mode: 'cant', action: 'attack' },
          { s: 'restrict', subject, mode: 'cant', action: 'block' },
          { s: 'restrict', subject, mode: 'cant', action: 'activate' },
        ],
        duration: { d: 'untilNextTurn', whose: { ref: 'you' } },
      },
    ]);
  },
};
