/**
 * Stack acceleration: with more than 5 objects on the stack the resolutions speed up, and slow back to normal at 5.
 * Client pacing only: the engine resolves exactly as before (CR 608); what changes is how long the board takes to show each resolution and how
 * long the computer waits before passing on a big stack.
 *
 * `stackPace(n)` is a time factor for a stack of `n` objects: 1 up to STACK_PACE_THRESHOLD, then falling smoothly with the pile, (5/n)^2, down to
 * STACK_PACE_FLOOR (from 10 objects on), so the fastest a resolution ever plays is a quarter of its normal time and stays readable. It multiplies the
 * player's animation-speed setting (the animator's own floor, 0.2, still applies); with reduced motion or animations off nothing is animated anyway. As the
 * pile shrinks the factor climbs back, one resolution at a time, to exactly 1 at 5: the same curve both ways, so the speed-up and the slow-down are smooth.
 */
import { STACK_PACE_THRESHOLD, stackPace } from '@openmtg/play/stackPace';
import type { StepA } from './plan';

// The pace curve itself is @openmtg/play's (Godot plan phase 1: the computer there uses it too).
export { STACK_PACE_FLOOR, STACK_PACE_THRESHOLD, stackPace } from '@openmtg/play/stackPace';

/**
 * How many objects are on the stack as each step of a change's part A begins: the stack on screen before the change, one more for each spell or ability
 * put on it (counted in its own step), one fewer after each resolution or counter. A resolution counts itself (it is still on the stack as it resolves).
 */
export function stackDepths(steps: readonly StepA[], start: number): number[] {
  let n = start;
  return steps.map((s) => {
    if (s.kind === 'cast' || s.kind === 'ability') n += 1;
    const here = n;
    if (s.kind === 'resolve' || s.kind === 'countered') n = Math.max(0, n - 1);
    return here;
  });
}

/** The time one resolution may take at normal speed before the pacer shows the change anyway (ms; generous: a resolution with effects and a dwell). */
export const RESOLUTION_BUDGET_MS = 2400;

/**
 * Extra time (ms, at normal speed) a change gets before the pacer cuts it short, for its resolutions while the stack is above STACK_PACE_THRESHOLD: each
 * gets its budget at its (faster) pace, so an accelerated pile is seen resolving rather than skipped. Nothing for a stack of 5 or fewer: such a change
 * keeps the pacer's usual deadline exactly as before.
 */
export function acceleratedBudgetMs(steps: readonly StepA[], start: number): number {
  const depths = stackDepths(steps, start);
  let ms = 0;
  steps.forEach((s, i) => {
    const d = depths[i]!;
    if (s.kind === 'resolve' && d > STACK_PACE_THRESHOLD) ms += RESOLUTION_BUDGET_MS * stackPace(d);
  });
  return Math.round(ms);
}
