/**
 * edh-d-97 (CR 107.3f, 603.3d, 608.2b; Relentless Dead): an X that appears in a triggered ability's text but in no cost it announced is chosen by its controller as it
 * resolves ("When this creature dies, you may pay {X}. If you do, return another target Zombie creature card with mana value X from your graveyard to the battlefield").
 * Its targets are chosen before that (CR 603.3d), when X has no value: a comparison with X in a target filter holds for some X, so it is relaxed when the targets are
 * chosen and when resolution begins (CR 608.2b); once the controller has chosen X as they pay (effects/handlers/pay.ts#payChosenX), the targets whose filter reads X
 * are checked with that X, and a target it no longer allows is illegal for the rest of the resolution (effects/ctx.ts#recheckXTargets).
 *
 * Only the payment the engine lets its controller choose X for (effects/handlers/pay.ts#choosesX): the first instruction of the ability, "you may pay {X}" by its
 * controller, once, with no "unless" branch. Any other shape keeps X as the resolution reads it (model/lint-nodes.ts refuses those that target with X).
 */
import type { CostDef, EffectProgram, EffectStep } from './ability';

const variableMana = (cost: CostDef): boolean => (cost.mana ?? []).some((m) => m.kind === 'variable');

/** Is `step` the controller's own optional "pay {X}" whose X they choose as it resolves? */
export function choosesXStep(step: EffectStep | undefined): boolean {
  if (step === undefined || step.op !== 'pay') return false;
  return step.who.ref === 'you' && step.times === undefined && step.mandatory !== true && step.else === undefined && step.upTo === undefined && step.anyAmount !== true && step.everyPlayer !== true && variableMana(step.cost);
}

/** Does the program (no modes) begin with such a payment, so that its X is chosen as it resolves? */
export function choosesXOnResolution(program: EffectProgram): boolean {
  return program.modes === undefined && choosesXStep(program.steps[0]);
}
