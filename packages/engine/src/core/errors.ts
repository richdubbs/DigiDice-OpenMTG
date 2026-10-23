/**
 * The error and control-flow types of the engine core. They live in their own module (milestone 5, WP0) so that pure rule code
 * (rules/denial.ts, rules/characteristics.ts) can throw them without importing core/game.ts, which imports the answer validator, which imports
 * the combat rules: that chain was an import cycle through the whole rules layer. core/game.ts re-exports all three, so existing imports still work.
 */
import type { Decision } from '../types/decisions';

/** Thrown by `Game.choose` when a decision is needed that has not been answered yet; only core/apply.ts catches it. */
export class NeedDecision {
  constructor(public readonly decision: Decision) {}
}

/** An illegal action or answer (CR 733). Carries a player-facing explanation. */
export class IllegalAction extends Error {
  constructor(message: string, public readonly rules: string[] = []) {
    super(message);
    this.name = 'IllegalAction';
  }
}

/**
 * AF1 INTERFACE CHANGE: an answer to a decision that is not one of the choices offered (core/validate.ts), or a set of choices that breaks a rule of the
 * announcement once chosen (CR 115.1 group limit, CR 115.3 "another target"). Always an `IllegalAction`: the answer is rejected and the same decision stays
 * pending (core/apply.ts, CR 733). Code that turns some `IllegalAction`s into an outcome ("no legal target: the trigger is removed", CR 603.3d) never does so
 * for this one: a player must not lose a triggered ability, or get rid of their own, by answering illegally. The post-answer checks of announce-targets throw
 * it only when a legal answer to the same decision provably exists (rules/targets.ts#specsFeasibility); otherwise there is no legal choice and they throw a
 * plain `IllegalAction` (AF1 review: a non-cancellable decision must never reject every answer forever).
 */
export class IllegalAnswer extends IllegalAction {
  constructor(message: string, rules: string[] = []) {
    super(message, rules);
    this.name = 'IllegalAnswer';
  }
}

/** Internal invariant violation: a bug in the engine, never a player mistake. */
export class EngineBug extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineBug';
  }
}
