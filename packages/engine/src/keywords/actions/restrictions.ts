/** CR 701 actions that restrict a permanent for a while: detain (701.35). A pure macro over the primitive `effect` op. Owner: WP3. */
import type { ActionMacro } from '../types';
import type { EffectStep, ObjRef } from '../../types/ability';
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
    const detainEffect = (subject: ObjRef): EffectStep => ({
      op: 'effect',
      effects: [
        { s: 'restrict', subject, mode: 'cant', action: 'attack' },
        { s: 'restrict', subject, mode: 'cant', action: 'block' },
        { s: 'restrict', subject, mode: 'cant', action: 'activate' },
      ],
      duration: { d: 'untilNextTurn', whose: { ref: 'you' } },
    });
    // edh-d-6 (CR 701.35a, 611.2c; Lavinia of the Tenth): "detain each nonland permanent your opponents control with mana value 4 or less" detains the permanents there are as the
    // ability resolves, one by one; a permanent that enters (or a creature that comes under their control) afterwards is not detained, which a live `each` filter would do
    if (step.subject.ref === 'each') {
      const name = 'detained';
      return carry(step, [{ op: 'forEach', over: step.subject, as: name, do: [detainEffect({ ref: 'bound', name })] }]);
    }
    return carry(step, [detainEffect(step.subject as ObjRef)]);
  },
};
