/**
 * Manual step support (design 8.9, 10.1, 10.5). Owner: WP10.
 *
 * A manual node is never skipped: its controller (or the player the node names) is shown the sentence in context (what was bound so far, which sentences of
 * the ability already resolved automatically, why the engine asks) in a `manualResolve` decision and adjusts the game by hand with `ManualOp`s, each logged at
 * level `manual` by core/manual.ts#applyManualOps. Steps before it have run; steps after it run next.
 *
 * This module also keeps the per-resolution notes the interpreter needs besides `ExecCtx` (the fallback text of each step, the sentences already done, the
 * step budget). They live in a WeakMap keyed by the context: an `ExecCtx` is rebuilt on every re-execution (design 8.8), so the notes are too, and nothing
 * here survives an action.
 */
import type { Duration, EffectStep } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ManualReminder } from '../types/state';
import { canSee } from '../core/view';
import type { ExecCtx, StepResult } from './api';
import { performManualSteps, performReminder } from './perform';

/**
 * Features this module implements (capability names `feature:<name>`, design 5.2). `manual.reminder` is NOT registered: the reminder chip is created
 * (`ManualReminder`), but nothing removes it when its duration ends yet (durations are WP15's, `core/steps.ts`), so the feature does not work end to end.
 */
export const FEATURES: readonly string[] = [];

/** What one resolution remembers besides the context (never stored in GameState). */
export interface RunNotes {
  /** Name of the spell, or of the source of the ability, for prompts and the log. */
  sourceName: string;
  /** The text a top-level step stands for when it has no `span` of its own: the mode or the ability it came from. */
  origins: Map<EffectStep, string>;
  /** The text used when nothing better is known (the ability's text). */
  text: string;
  /** Display text of the steps resolved automatically so far, in order (design 10.5: "the parts already resolved are shown as done"). */
  done: string[];
  /** Steps executed so far in this resolution (design 8.8 rule 6, the step budget). */
  steps: number;
}

const NOTES = new WeakMap<ExecCtx, RunNotes>();

function nameOfSource(cx: ExecCtx): string {
  if (cx.stack?.sourceName) return cx.stack.sourceName;
  const s = cx.g.s;
  return s.objects[cx.source.id] || s.lki[cx.source.id] ? cx.g.nameOf(cx.source.id) : 'an effect';
}

/** The notes of a resolution, created with defaults for a context the interpreter did not build itself (a handler's own context). */
export function notesOf(cx: ExecCtx): RunNotes {
  let n = NOTES.get(cx);
  if (!n) {
    const sourceName = nameOfSource(cx);
    n = { sourceName, origins: new Map(), text: sourceName, done: [], steps: 0 };
    NOTES.set(cx, n);
  }
  return n;
}

/** Start the notes of a resolution (effects/run.ts#resolveStackObject). */
export function startNotes(cx: ExecCtx, init: { sourceName: string; text: string; origins: Map<EffectStep, string> }): RunNotes {
  const n: RunNotes = { ...init, done: [], steps: 0 };
  NOTES.set(cx, n);
  return n;
}

/** The display name of an object for `viewer`: a card the viewer may not see stays anonymous (CR 400.2). */
export function shownTo(cx: ExecCtx, id: ObjectId, viewer: PlayerId): string {
  const s = cx.g.s;
  const o = s.objects[id] ?? s.lki[id]?.object;
  if (!o) return 'an object that no longer exists';
  return canSee(s, o, viewer) ? cx.g.nameOf(id) : 'a card';
}

/** Names bound so far, with what they stand for (design 10.5: "it = Grizzly Bears"). */
export function boundSummary(cx: ExecCtx, viewer: PlayerId): { name: string; objects: string[] }[] {
  const out: { name: string; objects: string[] }[] = [];
  for (const [name, b] of cx.bindings) {
    out.push({ name, objects: [...b.objects.map((h) => shownTo(cx, h.id, viewer)), ...b.players.map((p) => cx.g.player(p).name)] });
  }
  return out;
}

/**
 * M12F (CR 701.38a): text that holds a vote ("starting with you, each player votes for ...", "each player secretly votes for ..."), never text that only reads
 * one ("for each evidence vote", "each opponent who voted for a choice you voted for") or changes how players vote ("you choose how each player votes").
 */
export const HOLDS_A_VOTE = /(?<!how )\beach player (?:secretly )?votes\b/i;

/**
 * Ask the controller (or `opts.player`) to resolve `text` by hand: a `manualResolve` decision, then the answer's `ManualOp`s applied and logged at level
 * `manual`. With `reminder` the answer also leaves a `ManualReminder` chip lasting that long (a manual shield, design 10.5). `performed` is true when the player
 * changed something (at least one operation).
 *
 * M12F: when the text holds a vote (`HOLDS_A_VOTE`, or `opts.votes` from the vote action's own manual exits), the players have finished voting by hand once it
 * is answered: the `votesFinished` event is emitted without ballots, so "whenever players finish voting" triggers (CR 701.38a) are never silently missed.
 * `opts.votes: false` says the caller emits it itself.
 */
export function askManual(cx: ExecCtx, text: string, reason: string, reminder?: Duration, opts: { player?: PlayerId; votes?: boolean } = {}): StepResult {
  const g = cx.g;
  const notes = notesOf(cx);
  const player = opts.player ?? cx.controller;
  const bound = boundSummary(cx, player);
  const resolving = cx.stackId !== null && g.s.objects[cx.stackId]?.zone === 'stack' ? cx.stackId : undefined;
  // MRE (C6 gap 6): asked in steps; each answer's ops are applied as it is given and an answer with `continue: true` asks again with the new game.
  const ops = performManualSteps(g, player, {
    kind: 'manualResolve',
    player,
    prompt: `Resolve ${notes.sourceName} by hand: ${text}`,
    sourceName: notes.sourceName,
    text,
    ...(resolving !== undefined ? { resolvingId: resolving } : {}),
    ...(bound.length > 0 ? { bound } : {}),
    ...(notes.done.length > 0 ? { done: [...notes.done] } : {}),
    ...(reminder ? { reminder } : {}),
    reason,
    rules: ['CR 608.2'],
  }, cx.stackId ?? undefined); // the resolving object is the source of manual damage (CR 120.3) and can't be moved by hand
  if (reminder) {
    // The chip of a manual shield (design 10.5), shown until `until` passes. Ending it is the duration machinery's job (WP15): see FEATURES.
    const chip: ManualReminder = { id: g.newEffectId(), text, sourceName: notes.sourceName, controller: player, until: reminder, createdTurn: g.s.turn.number };
    performReminder(g, chip);
    g.log(`${notes.sourceName}: remember until it ends: ${text}`, { rules: ['CR 608.2'], level: 'manual' });
  }
  if (opts.votes ?? HOLDS_A_VOTE.test(text)) g.emit({ type: 'votesFinished', starter: player }); // M12F: voted by hand (CR 701.38a)
  return { performed: ops.length > 0, count: ops.length, byHand: true }; // merge wave 8 (audit D2): resolved by hand
}
