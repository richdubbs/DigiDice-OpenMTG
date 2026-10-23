/**
 * What a replacement body needs from the rest of the interpreter (M6-1, m6 design 3.1.5, 3.2): run effect steps (`instead`, a prevention effect's `then`),
 * propose an event of its own (the redirected part of some damage), and read a proposal as a semantic event (the `event` roles the steps of an `instead`
 * read). The body modules are parts of effects/registries.ts and must not import the dispatchers (effects/run.ts, effects/propose.ts,
 * effects/replacements.ts) or there is an import cycle (registries.ts, "Import rules"); those modules install their functions here when they load, as
 * effects/perform-events.ts#installEntryPipeline does for the pipeline. A body that runs with nothing installed is an EngineBug, never a silent no-op.
 */
import { EngineBug, type Game } from '../core/game';
import type { EffectStep } from '../types/ability';
import type { SemEvent } from '../types/state';
import type { ExecCtx, Proposed } from './api';
import type { Performed } from './perform-events';

type Runner = (cx: ExecCtx, steps: EffectStep[]) => void;
type Proposer = (g: Game, e: Proposed) => Performed | null;
type SemOf = (g: Game, e: Proposed) => SemEvent;

let runner: Runner | null = null;
let proposer: Proposer | null = null;
let semOfFn: SemOf | null = null;

export function installNestedRunner(f: Runner): void {
  runner = f;
}
export function installNestedProposer(f: Proposer): void {
  proposer = f;
}
export function installSemOf(f: SemOf): void {
  semOfFn = f;
}

/** Run effect steps in an interpreter context (effects/run.ts#runSteps). */
export function runNested(cx: ExecCtx, steps: EffectStep[]): void {
  if (!runner) throw new EngineBug('runNested: the step runner is not installed (effects/funnels.ts was not loaded)');
  runner(cx, steps);
}

/** Propose an event through the whole pipeline and perform it (effects/propose.ts#proposeResult), in the current replacement chain (CR 614.5). */
export function proposeNested(g: Game, e: Proposed): Performed | null {
  if (!proposer) throw new EngineBug('proposeNested: the pipeline is not installed (effects/funnels.ts was not loaded)');
  return proposer(g, e);
}

// ---- the branch of a performed event (CR 614.5) -------------------------------------------------------------------------------------------------------

/**
 * The set of used replacement effects of the proposal each final event came out of (CR 614.5; m6 design 3.1.5), written by effects/propose.ts#runPipeline,
 * so the performer can propose what the event entails in the same branch (the counters a permanent enters with, CR 614.16, 122.6). Keyed by the event object
 * the pipeline returned; transient (garbage with the event).
 */
export const CHAIN_OF = new WeakMap<Proposed, ReadonlySet<string>>();

/**
 * w8-followups (CR 616.1, 609.3): the answer each optional replacement effect's controller gave in a proposal, keyed by that proposal's set of used effects (the
 * set effects/propose.ts#runPipeline fills, which is the chain's `used` while a body of that proposal runs); transient, rebuilt on re-execution.
 */
export const OPTIONAL_ANSWERS = new WeakMap<ReadonlySet<string>, Map<string, boolean>>();

/** Run `f` with the replacement chain set to `used` (a child of the current chain), restoring it whatever happens (CR 614.5). */
export function inBranch<T>(g: Game, used: ReadonlySet<string> | undefined, f: () => T): T {
  const saved = g.chain;
  g.chain = { used: used ?? saved?.used ?? new Set<string>(), parent: saved };
  try {
    return f();
  } finally {
    g.chain = saved;
  }
}

// ---- "immediately afterward" (CR 615.5) ---------------------------------------------------------------------------------------------------------------

/** The collectors of the proposals being worked out (innermost last): what a body defers runs after its proposal's event (or after nothing, if none happens). */
const AFTER: (() => void)[][] = [];

/** Run `f` (one proposal's pipeline) with a collector of its own; returns the deferred work, which the caller runs after the event (effects/propose.ts). */
export function collectingAfter<T>(f: () => T): { value: T; after: (() => void)[] } {
  const list: (() => void)[] = [];
  AFTER.push(list);
  try {
    return { value: f(), after: list };
  } finally {
    AFTER.pop();
  }
}

/**
 * CR 615.5: "Some prevention effects also include an additional effect ... The prevention takes place at the time the original event would have happened; the
 * rest of the effect takes place immediately afterward." A body defers that rest to after its proposal's event; outside any proposal it runs at once.
 */
export function deferAfter(f: () => void): void {
  const top = AFTER[AFTER.length - 1];
  if (top) top.push(f);
  else f();
}

/** The semantic event a proposal would be (effects/replacements.ts#semOf). */
export function semOfNested(g: Game, e: Proposed): SemEvent {
  if (!semOfFn) throw new EngineBug('semOfNested: the semantic reader is not installed (effects/funnels.ts was not loaded)');
  return semOfFn(g, e);
}
