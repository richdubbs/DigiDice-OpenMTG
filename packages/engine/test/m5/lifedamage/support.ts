/**
 * Helpers for the WP12 tests (effects/handlers/{lifedamage,counters}.ts).
 *
 *  - `withExamples`: real fixture cards whose abilities are replaced by the JSON of design section 13 (what the milestone 5 compiler will produce), so
 *    announcement (WP7) asks for exactly the targets, X and division the model says.
 *  - `resolveTop`: a stand-in for WP10's `resolveStackObject` (design 8.3), which is still a stub: flatten the spell ability of the face that was cast,
 *    build the context (ONE legality check, CR 608.2b), run each step through `OP_HANDLERS`. The real spine replaces it at the WP10 merge; the
 *    integration test (integration.test.ts) runs the same cards through `applyAction` once WP10 and WP11 are real.
 *  - `resolveAbility`: the same for a triggered or activated ability of a section 13 card, put on the stack by hand with its targets and trigger event.
 *  - `runStep`: one step of a hand-built program on a spell put on the stack directly (the WP4 helpers).
 */
import { Game } from '../../../src/core/game';
import type { ExecCtx, StepResult } from '../../../src/effects/api';
import { makeCtx, recheckAll } from '../../../src/effects/ctx';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import type { AbilityDef, DecisionAnswer, EffectProgram, EffectStep, GameState, ObjectId } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { EXAMPLES } from '../model/examples';
import { ctxOn, putOnStack, type StackSpec } from '../eval/helpers';

export { putOnStack };

/** Replace the abilities of the named cards' definitions by the section 13 JSON (test setup only). */
export function withExamples(s: GameState, ...names: string[]): GameState {
  const t = clone(s);
  for (const name of names) {
    const ex = EXAMPLES.find((e) => e.name === name);
    if (!ex) throw new Error(`No worked example "${name}" in design section 13`);
    const id = Object.keys(t.defs).find((k) => t.defs[k]!.name === name);
    if (!id) throw new Error(`"${name}" is not in the scenario`);
    const def = t.defs[id]!;
    t.defs = { ...t.defs, [id]: { ...def, faces: def.faces.map((f, i) => ({ ...f, abilities: ex.faces[i]?.abilities ?? f.abilities })) } };
  }
  return t;
}

/** Run one step's handler as the spine would, storing its result under `as`. */
export function runOne(cx: ExecCtx, step: EffectStep): StepResult {
  const handler = (OP_HANDLERS as Record<string, ((c: ExecCtx, st: EffectStep) => StepResult) | undefined>)[step.op];
  if (!handler) throw new Error(`no handler for ${step.op}`);
  const res = handler(cx, step);
  if (step.as) cx.results.set(step.as, res);
  return res;
}

export interface Resolution {
  state: GameState;
  cx: ExecCtx;
  /** False when every target was illegal (CR 608.2b): nothing ran. */
  resolved: boolean;
  results: StepResult[];
}

/** WP10 stand-in: resolve the spell on top of the stack (its effect only: the card stays where it is; `finishSpell` is WP10's). */
export function resolveTop(s: GameState, answers: DecisionAnswer[] = []): Resolution {
  const state = clone(s);
  const id = state.zones.stack[state.zones.stack.length - 1];
  if (!id) throw new Error('the stack is empty');
  const obj = state.objects[id]!;
  const def = state.defs[obj.defId]!;
  const spell = def.faces[obj.face]!.abilities.find((a): a is Extract<AbilityDef, { kind: 'spell' }> => a.kind === 'spell');
  if (!spell) throw new Error(`${def.name} has no spell ability on face ${obj.face}`);
  const cx = makeCtx(new Game(state, answers), obj, spell.effect);
  const { legal, total } = recheckAll(cx);
  if (total > 0 && legal === 0) return { state, cx, resolved: false, results: [] };
  return { state, cx, resolved: true, results: spell.effect.steps.map((st) => runOne(cx, st)) };
}

/**
 * WP10 stand-in for an ability: put the `index`-th ability of kind `kind` of `spec.name`'s definition (the section 13 JSON after `withExamples`) on the
 * stack the way announcement leaves it (`spec.targets`, `spec.event`), then resolve it like `resolveTop` (ONE legality check, CR 608.2b). The intervening
 * "if" (CR 603.4) is WP10's and is not checked here.
 */
export function resolveAbility(s: GameState, kind: 'triggered' | 'activated', spec: StackSpec, index = 0, answers: DecisionAnswer[] = []): Resolution {
  const state = clone(s);
  const defId = Object.keys(state.defs).find((k) => state.defs[k]!.name === spec.name);
  if (!defId) throw new Error(`"${spec.name}" is not in the scenario`);
  const ability = state.defs[defId]!.faces[0]!.abilities.filter((a): a is Extract<AbilityDef, { kind: 'triggered' | 'activated' }> => a.kind === kind)[index];
  if (!ability) throw new Error(`${spec.name} has no ${kind} ability #${index}`);
  const id = putOnStack(state, { ...spec, kind });
  const cx = makeCtx(new Game(state, answers), state.objects[id]!, ability.effect);
  const { legal, total } = recheckAll(cx);
  if (total > 0 && legal === 0) return { state, cx, resolved: false, results: [] };
  return { state, cx, resolved: true, results: ability.effect.steps.map((st) => runOne(cx, st)) };
}

/** Put a spell with a hand-built program on the stack and run one step of it (`program.steps[0]` unless given). */
export function runStep(s: GameState, spec: StackSpec, program: EffectProgram, answers: DecisionAnswer[] = []): { state: GameState; cx: ExecCtx; result: StepResult; id: ObjectId } {
  const state = clone(s);
  const id = putOnStack(state, spec);
  const cx = ctxOn(state, id, program, answers);
  const result = runOne(cx, program.steps[0]!);
  return { state, cx, result, id };
}
