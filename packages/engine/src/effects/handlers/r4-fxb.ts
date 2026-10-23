/**
 * Op handlers of slice r4-fxb (Standard round 4), in a table of their own so the WP-owned tables keep their pinned contents (design 5.2: `op:<op>` is a
 * capability because it has a handler here AND a renderer). Ops: changeTarget (CR 115.7a, ./change-target.ts), extraStep (CR 500.9; core/turn-effects.ts).
 */
import { addExtraStep } from '../../core/turn-effects';
import type { OpHandlers, StepResult } from '../api';
import { evalQty } from '../eval';
import { changeTarget } from './change-target';

const NOTHING: StepResult = { performed: false, count: 0 };

export const R4_FXB_HANDLERS: OpHandlers = {
  changeTarget,
  /** CR 500.9 (unverified): `count` additional steps of a kind directly after this step, or after this phase (`afterPhase`); a count that can't be determined adds none (CR 608.2b). */
  extraStep: (cx, step) => {
    const n = step.count === undefined ? 1 : evalQty(cx, step.count);
    if (n === undefined) return NOTHING; // CR 608.2b
    const k = Math.max(0, Math.floor(n));
    for (let i = 0; i < k; i++) addExtraStep(cx.g, step.step, step.afterPhase === true);
    return { performed: k > 0, count: k };
  },
};
