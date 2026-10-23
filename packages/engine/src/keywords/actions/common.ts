/** Shared helpers of the CR 701 action macros (design 7.5). A macro is a PURE function from one `{op:'action'}` step to primitive steps. Owner: WP3. */
import type { EffectStep, Ref } from '../../types/ability';

export type ActionStep = Extract<EffectStep, { op: 'action' }>;

/**
 * Give the produced steps the bookkeeping of the action step (`sentence`, `span` for logs and manual prompts) and its guard: a guarded action step becomes ONE
 * `if` step, so the guard governs the whole expansion and not only its first step.
 */
export function carry(step: ActionStep, produced: EffectStep[]): EffectStep[] {
  const stamp = (s: EffectStep): EffectStep => ({ ...s, ...(step.sentence !== undefined ? { sentence: step.sentence } : {}), ...(step.span !== undefined ? { span: step.span } : {}) });
  const out = produced.map(stamp);
  return step.guard === undefined ? out : [stamp({ op: 'if', cond: step.guard, then: out })];
}

/** A step the macro cannot expand (a parameter is missing): the players resolve it by hand, never silently skipped (docs/ARCHITECTURE.md, item 5). */
export function manualAction(step: ActionStep, reason: string): EffectStep[] {
  return carry(step, [{ op: 'manual', text: step.span ?? step.action, reason }]);
}

/** The thing that performs the action ("this permanent" when the step names no subject). */
export const subjectOf = (step: ActionStep): Ref => step.subject ?? { ref: 'self' };

/** How many times: the `n` of the step, 1 when absent. */
export const countOf = (step: ActionStep): NonNullable<ActionStep['n']> => step.n ?? 1;
