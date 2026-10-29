/**
 * Stack acceleration: with more than 5 objects on the stack the resolutions speed up, and slow back to normal at 5.
 * Pacing only: the engine resolves exactly as before (CR 608); what changes is how long the board takes to show each resolution and how long the
 * computer waits before passing on a big stack.
 *
 * `stackPace(n)` is a time factor for a stack of `n` objects: 1 up to STACK_PACE_THRESHOLD, then falling smoothly with the pile, (5/n)^2, down to
 * STACK_PACE_FLOOR (from 10 objects on), so the fastest a resolution ever plays is a quarter of its normal time and stays readable. The client's
 * board/fx/stackPace.ts re-exports it with the board's own uses of it (Godot plan phase 1: moved here so the computer, computer.ts, needs no client code).
 */

/** More objects than this on the stack and the resolutions speed up. */
export const STACK_PACE_THRESHOLD = 5;
/** The fastest pace: a quarter of the normal time (reached at 10 objects). */
export const STACK_PACE_FLOOR = 0.25;

export function stackPace(size: number): number {
  if (!(size > STACK_PACE_THRESHOLD)) return 1;
  const r = STACK_PACE_THRESHOLD / size;
  return Math.max(STACK_PACE_FLOOR, r * r);
}
