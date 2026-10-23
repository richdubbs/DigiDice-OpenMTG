/**
 * What triggers/ needs from layers it may not import (design 5.4: triggers import types, statics, rules, core and keywords, never actions or the effects
 * interpreter). `core/triggers.ts`, which may, hands them over once at start-up; nothing here is game state.
 *
 *  - the announcement functions of actions/announce.ts, so a triggered ability chooses its modes and targets with "the same functions" as a spell (design 8.2.7);
 *  - the condition evaluator of effects/eval.ts (WP4), so an intervening "if" is judged by the one evaluator that exists for conditions when it knows the
 *    condition; `triggers/cond.ts` has a small evaluator of its own for the conditions that need no resolution context, which is what runs until WP4 has merged.
 */
import type { Game } from '../core/game';
import type { Condition, EffectProgram } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { CostsPaid, GameState, TargetChoice } from '../types/state';
import type { ExecCtx } from '../effects/api';

/** What an announcement reads about the object being announced (structurally `actions/announce-cond.ts#AnnounceEnv`; triggers/ may not import actions/). A triggered ability has paid nothing. */
export interface TriggerAnnounceEnv {
  s: GameState;
  player: PlayerId;
  sourceId: ObjectId;
  costsPaid: CostsPaid;
  x?: number;
  /** r3-choose (CR 700.2, 603.3c): the ability whose modes are remembered for "choose one that hasn't been chosen" (`AnnounceEnv.modeMemory`). */
  modeMemory?: { key: string; triggered: boolean };
  /** r3-choose (CR 603.3d): the triggering event's amount, read by a calculated number of targets (`AnnounceEnv.eventAmount`). */
  eventAmount?: number;
}

export interface TriggerAnnouncer {
  /** CR 603.3c: the modes of the (first) modal program; undefined when nothing is modal. */
  chooseModes(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, aenv?: TriggerAnnounceEnv): number[] | undefined;
  /**
   * CR 603.3d = 601.2c-d: one list of chosen targets per target spec of the effective programs, and the division of damage or counters among them (CR 601.2d).
   * Throws `IllegalAction` when a required target cannot be chosen.
   */
  chooseTargets(g: Game, player: PlayerId, programs: EffectProgram[], sourceId: ObjectId, stackId: ObjectId, what: string, aenv: TriggerAnnounceEnv): { targets: TargetChoice[][]; division: Record<string, number[]> };
  /** CR 700.2: the programs that apply once modes are chosen. */
  effectivePrograms(programs: EffectProgram[], modes: number[] | undefined): EffectProgram[];
  /** The target kinds, fields and value forms of the program (and of its modes) that this build cannot announce yet (`model/forms.ts` names); empty = every spec can be read. */
  unsupportedForms(program: EffectProgram): string[];
}

export interface ConditionEvaluator {
  /** Does the interpreter's evaluator know this condition (its capability `cond:<cond>`)? */
  knows(cond: Condition): boolean;
  evaluate(cx: ExecCtx, cond: Condition): boolean;
}

export interface TriggerWiring {
  announcer: TriggerAnnouncer;
  conditions?: ConditionEvaluator;
}

let wiring: TriggerWiring | null = null;

/** Called once by core/triggers.ts. */
export function configureTriggers(w: TriggerWiring): void {
  wiring = w;
}

export function announcer(): TriggerAnnouncer {
  if (!wiring) throw new Error('triggers: the announcement functions were not wired (import core/triggers.ts, design 5.4)');
  return wiring.announcer;
}

export const conditionEvaluator = (): ConditionEvaluator | undefined => wiring?.conditions;
