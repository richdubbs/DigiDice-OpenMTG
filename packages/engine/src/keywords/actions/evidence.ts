/**
 * FAST5X E12: the Murders at Karlov Manor keyword actions. Owner: FAST5X E12.
 *
 *  - suspect (CR 701.60a): "suspect <permanent>": it becomes suspected (the `designateObject` op, effects/handlers/levels.ts); CR 701.60c's menace and
 *    "can't block" come from the layer system (statics/suspect.ts). Step: `{op:'action', action:'suspect', who, subject}`.
 *  - collect evidence N (CR 701.59a-b): native, effects/handlers/evidence.ts. Step: `{op:'action', action:'collectEvidence', who, n}`. As a COST part
 *    (`{T}, Collect evidence 3:`, "as an additional cost to cast this spell, you may collect evidence 6") it is paid by rules/pay-parts.ts; the capability
 *    `action:collectEvidence` of this macro is what both need.
 */
import type { ObjRef } from '../../types/ability';
import type { ActionMacro } from '../types';
import { carry, manualAction } from './common';

export const SUSPECT: ActionMacro = {
  name: 'suspect',
  rule: 'CR 701.60a',
  expand: (step) => {
    const what = step.subject as ObjRef | undefined; // an object reference: a player is never suspected (CR 701.60b)
    if (what === undefined) return manualAction(step, 'suspect needs the creature it suspects');
    return carry(step, [{ op: 'designateObject', what, designation: 'suspected', ...(step.as !== undefined ? { as: step.as } : {}) }]);
  },
};

export const COLLECT_EVIDENCE: ActionMacro = { name: 'collectEvidence', rule: 'CR 701.59a', native: 'collectEvidence' };

export const EVIDENCE_MACROS: readonly ActionMacro[] = [SUSPECT, COLLECT_EVIDENCE];
