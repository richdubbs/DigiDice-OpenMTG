/**
 * A test stand-in for the interpreter spine (WP10, still a stub): it builds the real `ExecCtx` (`makeCtx`, WP4) over a stack object, runs the steps through the
 * real `OP_HANDLERS` in order (CR 608.2c) and re-executes from the settled base state with the answers given so far, which is how the engine resolves
 * (docs/ARCHITECTURE.md, "The decision model"). A `NeedDecision` stops the run and returns the decision. Ops of other packages that the acceptance cards need
 * (`move` for Fact or Fiction, WP14) get a minimal fake here.
 */
import { Game } from '../../../src/core/game';
import { NeedDecision } from '../../../src/core/errors';
import { moveObject } from '../../../src/core/zones';
import type { ExecCtx, StepResult } from '../../../src/effects/api';
import { makeCtx } from '../../../src/effects/ctx';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { currentObjs, resolveObjs } from '../../../src/effects/refs';
import type { AbilityDef, CardDef, Decision, DecisionAnswer, EffectProgram, EffectStep, GameEvent, GameState, ObjectId, TargetChoice } from '../../../src/index';
import type { CostsPaid, ZoneKind } from '../../../src/types/state';
import { clone } from '../../../src/util/clone';
import { putOnStack } from '../eval/helpers';
import { synth } from '../helpers';

type Handler = (cx: ExecCtx, st: EffectStep) => StepResult;

/** WP14's `move`, reduced to what the acceptance cards need: move the current objects of the reference to the zone, on top or bottom of a library (CR 400.7). */
const fakeMove: Handler = (cx, st) => {
  if (st.op !== 'move') throw new Error('not a move');
  const hs = currentObjs(cx, resolveObjs(cx, st.what));
  const position = st.to.position === 'top' || st.to.position === 'bottom' ? { position: st.to.position } : {};
  for (const h of hs) moveObject(cx.g, h.id, st.to.zone as ZoneKind, { cause: 'test move', ...position });
  return { performed: hs.length > 0, count: hs.length };
};
const FAKE_HANDLERS: Record<string, Handler> = { move: fakeMove };

export interface Outcome {
  s: GameState;
  events: GameEvent[];
  pending: Decision | null;
  cx: ExecCtx | null;
  results: Map<string, StepResult>;
}

/** Run `program` for the stack object `id` of `base` (a clone is used) with these answers. */
export function runOn(base: GameState, id: ObjectId, program: EffectProgram, answers: DecisionAnswer[] = []): Outcome {
  const g = new Game(clone(base), answers);
  const results = new Map<string, StepResult>();
  let cx: ExecCtx | null = null;
  try {
    cx = makeCtx(g, g.s.objects[id]!, program);
    for (const st of program.steps) {
      const h = ((OP_HANDLERS as Record<string, Handler | undefined>)[st.op] ?? FAKE_HANDLERS[st.op]);
      if (!h) throw new Error(`no handler for ${st.op} in the WP13 harness`);
      const r = h(cx, st);
      if (st.as) { cx.results.set(st.as, r); results.set(st.as, r); }
      results.set(`#${program.steps.indexOf(st)}`, r);
    }
    return { s: g.s, events: g.events, pending: null, cx, results };
  } catch (e) {
    if (e instanceof NeedDecision) return { s: g.s, events: g.events, pending: e.decision, cx, results };
    throw e;
  }
}

/** Run to the end, answering every decision with `answer` (re-executing from `base` each time, as the engine does). */
export function runAll(base: GameState, id: ObjectId, program: EffectProgram, answer: (d: Decision, s: GameState) => DecisionAnswer, max = 50): Outcome & { decisions: Decision[] } {
  const answers: DecisionAnswer[] = [];
  const decisions: Decision[] = [];
  for (let i = 0; i < max; i++) {
    const out = runOn(base, id, program, answers);
    if (!out.pending) return { ...out, decisions };
    decisions.push(out.pending);
    answers.push(answer(out.pending, out.s));
  }
  throw new Error('too many decisions');
}

export interface SpellSpec {
  /** Definition name in the scenario; a sorcery with `program` as its only ability when `program` is given. */
  name: string;
  controller?: string;
  targets?: TargetChoice[][];
  x?: number;
  costsPaid?: CostsPaid;
  kind?: 'spell' | 'activated' | 'triggered';
  sourceId?: ObjectId;
}

/** Put a spell or an ability on the stack of a copy of `s` (test setup only). */
export function onStack(s0: GameState, spec: SpellSpec): { s: GameState; id: ObjectId } {
  const s = clone(s0);
  const id = putOnStack(s, {
    name: spec.name, owner: spec.controller ?? 'p1', kind: spec.kind ?? 'spell',
    ...(spec.targets ? { targets: spec.targets } : {}), ...(spec.x !== undefined ? { x: spec.x } : {}), ...(spec.costsPaid ? { costsPaid: spec.costsPaid } : {}),
    ...(spec.sourceId ? { sourceId: spec.sourceId } : {}),
  });
  return { s, id };
}

/** A sorcery whose only ability is `program` (the JSON the compiler will produce). */
export const sorcery = (name: string, program: EffectProgram, text = '(synthetic)'): CardDef =>
  synth({ name, cost: '{1}', type: 'Sorcery', abilities: [{ kind: 'spell', text, effect: program }] });

export const prog = (steps: EffectStep[], targets: EffectProgram['targets'] = []): EffectProgram => ({ targets, steps });

/** The ability on the stack behind a stack object made by real casting or activation: the spell ability of the face, or the printed ability it points to. */
export function stackProgram(s: GameState, id: ObjectId): EffectProgram {
  const o = s.objects[id]!;
  const info = o.stack!;
  if (info.kind === 'spell') {
    const face = s.defs[o.defId]!.faces[info.face ?? 0]!;
    const a = face.abilities.find((x): x is Extract<AbilityDef, { kind: 'spell' }> => x.kind === 'spell');
    if (!a) throw new Error('no spell ability');
    return a.effect;
  }
  const src = s.objects[info.sourceId!] ?? s.lki[info.sourceId!]!.object;
  const ref = info.abilityRef!;
  const a = s.defs[src.defId]!.faces[ref.face]!.abilities[ref.index]!;
  if (a.kind !== 'activated' && a.kind !== 'triggered') throw new Error('not an activated or triggered ability');
  return a.effect;
}

/** The id of the top object of the stack. */
export const top = (s: GameState): ObjectId => s.zones.stack[s.zones.stack.length - 1]!;

export const defName = (s: GameState, id: ObjectId): string => s.defs[(s.objects[id] ?? s.lki[id]!.object).defId]!.name;
export const lib = (s: GameState, p: string): ObjectId[] => s.zones.library[p]!;
export const hand = (s: GameState, p: string): ObjectId[] => s.zones.hand[p]!;
export const yard = (s: GameState, p: string): ObjectId[] => s.zones.graveyard[p]!;
export const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => defName(s, id));
