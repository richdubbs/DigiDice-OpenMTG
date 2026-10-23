/**
 * Helpers for the WP14 tests (effects/handlers/{zones,tokens}*.ts).
 *
 *  - `withExamples` / `withAbilities`: real fixture cards whose abilities are replaced by the JSON of design section 13 (what the milestone 5 compiler will
 *    produce) or by hand-built abilities, so announcement (WP7) asks for exactly the targets the model says;
 *  - `resolveTop`: a stand-in for WP10's `resolveStackObject` (design 8.3), still a stub: flatten the effect of the spell or ability on top of the stack, build
 *    the context (ONE legality check, CR 608.2b), run each step through `OP_HANDLERS`. `may`, `search` and `shuffle` belong to WP10 and WP13, which are stubs
 *    too: `NEIGHBOR_FAKES` stands in for them (only what Path to Exile and the predefined tokens need). The integration test (integration.test.ts) runs the
 *    same cards through `applyAction` once WP10 and WP11 are real;
 *  - `runStep`: one step of a hand-built program on a spell put on the stack directly (the WP4 helpers);
 *  - `decisionOf`: the decision a re-execution would stop at (core/apply.ts catches `NeedDecision`; tests do it here).
 */
import { Game, NeedDecision } from '../../../src/core/game';
import { shuffleLibrary } from '../../../src/core/zones';
import type { ExecCtx, StepResult } from '../../../src/effects/api';
import { makeCtx, recheckAll } from '../../../src/effects/ctx';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { resolvePlayers } from '../../../src/effects/refs';
import { findObjects } from '../../../src/rules/filter';
import { filterCtxOutside } from '../../../src/rules/filter-env';
import { abilityDefOnStack } from '../../../src/rules/abilities';
import type { AbilityDef, Decision, DecisionAnswer, EffectProgram, EffectStep, GameState, ObjectId } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { EXAMPLES } from '../model/examples';
import { ctxOn, putOnStack, type StackSpec } from '../eval/helpers';

export { putOnStack };

/** Replace the abilities of the named cards' definitions by the section 13 JSON (test setup only). */
export function withExamples(s: GameState, ...names: string[]): GameState {
  let t = s;
  for (const name of names) {
    const ex = EXAMPLES.find((e) => e.name === name);
    if (!ex) throw new Error(`No worked example "${name}" in design section 13`);
    t = withAbilities(t, name, ...ex.faces.map((f) => f.abilities));
  }
  return t;
}

/** Replace the abilities of each face of a definition (test setup only). */
export function withAbilities(s: GameState, name: string, ...faces: AbilityDef[][]): GameState {
  const t = clone(s);
  const id = Object.keys(t.defs).find((k) => t.defs[k]!.name === name);
  if (!id) throw new Error(`"${name}" is not in the scenario`);
  const def = t.defs[id]!;
  t.defs = { ...t.defs, [id]: { ...def, faces: def.faces.map((f, i) => ({ ...f, abilities: faces[i] ?? f.abilities })) } };
  return t;
}

type Handler = (cx: ExecCtx, st: EffectStep) => StepResult;

/**
 * Stand-ins for the ops of neighbors that are still stubs (WP10 `may`, WP13 `search` and `shuffle`): just enough for Path to Exile and the Lander token. `may`
 * asks its player yes or no (CR 608.2d); `search` lets the player choose up to `max` matching cards of their library (CR 701.23); `shuffle` shuffles.
 */
export const NEIGHBOR_FAKES: Record<string, Handler> = {
  may: (cx, st) => {
    const s = st as Extract<EffectStep, { op: 'may' }>;
    const [p] = resolvePlayers(cx, s.who);
    if (!p) return { performed: false, count: 0 };
    const yes = cx.g.choose({ kind: 'yesNo', player: p, prompt: 'May?', rules: ['CR 608.2d'] }).yes;
    if (yes) runSteps(cx, s.do);
    return { performed: yes, count: yes ? 1 : 0 };
  },
  search: (cx, st) => {
    const s = st as Extract<EffectStep, { op: 'search' }>;
    const [p] = resolvePlayers(cx, s.who);
    if (!p) return { performed: false, count: 0 };
    const options = findObjects(cx.g.s, { ...s.filter, zone: 'library' }, filterCtxOutside(cx.g.s, { controller: cx.controller, sourceId: cx.source.id })).filter((o) => o.owner === p).map((o) => o.id);
    const max = typeof s.max === 'number' ? s.max : options.length;
    const ids = options.length === 0 ? [] : cx.g.choose({ kind: 'chooseObjects', player: p, prompt: 'Search', options, min: 0, max: Math.min(max, options.length), rules: ['CR 701.23'] }).ids;
    cx.bindings.set(s.as, { objects: ids.map((id) => ({ id, zone: 'library' as const })), players: [], snapshots: {} });
    return { performed: ids.length > 0, count: ids.length };
  },
  shuffle: (cx, st) => {
    const s = st as Extract<EffectStep, { op: 'shuffle' }>;
    for (const p of resolvePlayers(cx, s.who)) shuffleLibrary(cx.g, p);
    return { performed: true, count: 1 };
  },
};

/** Run one step's handler as the spine would, storing its result under `as`. */
export function runOne(cx: ExecCtx, step: EffectStep): StepResult {
  if (step.guard) throw new Error('the WP14 stand-in does not evaluate guards');
  const handler = (OP_HANDLERS as Record<string, Handler | undefined>)[step.op] ?? NEIGHBOR_FAKES[step.op];
  if (!handler) throw new Error(`no handler for ${step.op}`);
  const res = handler(cx, step);
  if (step.as) cx.results.set(step.as, res);
  return res;
}

export const runSteps = (cx: ExecCtx, steps: EffectStep[]): StepResult[] => steps.map((st) => runOne(cx, st));

export interface Resolution {
  state: GameState;
  cx: ExecCtx;
  /** False when every target was illegal (CR 608.2b): nothing ran. */
  resolved: boolean;
  results: StepResult[];
}

/** The program of the object on top of the stack: the spell ability of the face cast, or the ability's effect; chosen modes first (CR 700.2d). */
function programOf(state: GameState, id: ObjectId): EffectProgram {
  const obj = state.objects[id]!;
  let effect: EffectProgram | undefined;
  if (obj.kind === 'ability') {
    const def = abilityDefOnStack(state, obj);
    effect = def && 'effect' in def ? def.effect : undefined;
  } else {
    const def = state.defs[obj.defId]!;
    effect = def.faces[obj.stack?.face ?? obj.face]!.abilities.find((a): a is Extract<AbilityDef, { kind: 'spell' }> => a.kind === 'spell')?.effect;
  }
  if (!effect) throw new Error(`${obj.defId} has no effect to resolve`);
  if (!effect.modes) return effect;
  const chosen = [...(obj.stack?.modes ?? [])].sort((a, b) => a - b).map((m) => effect!.modes!.options[m]!.program);
  return { targets: [...chosen.flatMap((p) => p.targets), ...effect.targets], steps: [...chosen.flatMap((p) => p.steps), ...effect.steps] };
}

/** WP10 stand-in: resolve the spell or ability on top of the stack (its effect only: the spell stays where it is; `finishSpell` is WP10's). */
export function resolveTop(s: GameState, answers: DecisionAnswer[] = []): Resolution {
  const state = clone(s);
  const id = state.zones.stack[state.zones.stack.length - 1];
  if (!id) throw new Error('the stack is empty');
  const program = programOf(state, id);
  const cx = makeCtx(new Game(state, answers), state.objects[id]!, program);
  const { legal, total } = recheckAll(cx);
  if (total > 0 && legal === 0) return { state, cx, resolved: false, results: [] };
  return { state, cx, resolved: true, results: runSteps(cx, program.steps) };
}

/** Put a spell with a hand-built program on the stack and run its steps. */
export function runProgram(s: GameState, spec: StackSpec, program: EffectProgram, answers: DecisionAnswer[] = []): { state: GameState; cx: ExecCtx; results: StepResult[]; id: ObjectId } {
  const state = clone(s);
  const id = putOnStack(state, spec);
  const cx = ctxOn(state, id, program, answers);
  return { state, cx, results: runSteps(cx, program.steps), id };
}

/** One step of a hand-built program (`program.steps[0]`). */
export function runStep(s: GameState, spec: StackSpec, program: EffectProgram, answers: DecisionAnswer[] = []): { state: GameState; cx: ExecCtx; result: StepResult; id: ObjectId } {
  const r = runProgram(s, spec, { ...program, steps: program.steps.slice(0, 1) }, answers);
  return { state: r.state, cx: r.cx, result: r.results[0]!, id: r.id };
}

/** The decision `fn` stops at (what `applyAction` would return as `pending`), or throws if it doesn't stop. */
export function decisionOf(fn: () => unknown): Decision {
  try {
    fn();
  } catch (e) {
    if (e instanceof NeedDecision) return e.decision;
    throw e;
  }
  throw new Error('expected a decision');
}

/** A spell with one spell ability, for `withAbilities`. */
export const spellOf = (text: string, program: EffectProgram): AbilityDef => ({ kind: 'spell', text, effect: program });
