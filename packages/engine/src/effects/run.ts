/**
 * The interpreter spine (design 8.3, 8.8). Owner: WP10.
 *
 * `resolveStackObject` resolves an instant or sorcery spell or an ability on the stack (CR 608.2): it flattens the chosen modes and the ability's own steps
 * into ONE program (CR 700.2d), checks an intervening "if" again (CR 608.2a, 603.4), checks the targets ONCE over every chosen mode (CR 608.2b), runs the
 * steps in order (CR 608.2c) and finishes the object (CR 608.2n) with milestone 3's layout rules (flashback, aftermath, Adventure, Omen). Permanent spells
 * (CR 608.3) stay in core/resolve.ts: they have no effect program, only the Aura target of CR 303.4f.
 *
 * Steps run through `OP_HANDLERS`; a step without a handler is never skipped (guard G11): its players resolve it by hand. Every handler acts through the
 * proposal pipeline (WP11); this module itself only moves the finished object off the stack, as milestone 3 did.
 */
import type { Game } from '../core/game';
import { countResolution } from '../rules/resolutions';
import { EngineBug } from '../core/errors';
import { modeInstances } from '../rules/mode-instances';
import type { AbilityDef, Duration, EffectProgram, EffectStep } from '../types/ability';
import type { PlayerId } from '../types/ids';
import type { GameObject } from '../types/state';
import { abilityDefOnStack } from '../rules/abilities';
import { charsOfObject, isPermanentCard } from '../rules/characteristics';
import { HISTORY_FILTER_FIELDS } from '../rules/history';
import { noteLimitedAction } from '../triggers/collect';
import { interveningIfHolds } from '../triggers/cond';
import { syncHistory } from '../triggers/stack';
import type { ExecCtx, OpHandlers, ResolveStackObject, StepResult } from './api';
import { makeCtx, recheckAll } from './ctx';
import { evalCond } from './eval';
import { askManual, notesOf, startNotes } from './manual';
import { performAbilityGone, performLink } from './perform';
import { readLink } from '../statics/links';
import { OVERLOAD, overloadProgram } from './overload';

const NOTHING: StepResult = { performed: false, count: 0 };

// ---- the handler table ----------------------------------------------------------------------------------------------------------------------------------

/**
 * `effects/handlers/index.ts` (which imports every handler family, and the control family imports `runSteps` from here) hands its table over when it loads, so
 * the two modules do not import each other (design 5.4: no cycles). A function registry, not game data. Mutations of the table (tests) are seen here.
 */
let handlers: OpHandlers | null = null;

export function installOpHandlers(table: OpHandlers): void {
  handlers = table;
}

type AnyHandler = (cx: ExecCtx, st: EffectStep) => StepResult;

function handlerFor(op: string): AnyHandler | undefined {
  if (!handlers) throw new EngineBug('effects/handlers/index.ts is not loaded: import it before running steps');
  return Object.hasOwn(handlers, op) ? (handlers as Record<string, AnyHandler | undefined>)[op] : undefined;
}

// ---- history (open item of the W1 merge: WP4's `happened` / `happenedCount` and the history filter fields read GameState.history) ------------------------

const HISTORY_KEYS: ReadonlySet<string> = new Set(HISTORY_FILTER_FIELDS);

/** Does this piece of the model read `GameState.history` (a `happened` condition, a `happenedCount` quantity, a history filter field)? */
export function mentionsHistory(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(mentionsHistory);
  if (x === null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o['cond'] === 'happened' || o['cond'] === 'firstTime' || o['cond'] === 'someMatch' /* r5-trig */ || o['cond'] === 'firstSpellCast' /* trek-2 */ || o['q'] === 'happenedCount' || o['q'] === 'happenedDistinct') return true; // CLOUD std-tmt: happenedDistinct
  for (const k of Object.keys(o)) if (HISTORY_KEYS.has(k) || mentionsHistory(o[k])) return true;
  return false;
}

/**
 * The history is written when triggers are collected, the next time a player would get priority; in the middle of a resolution it would miss what this
 * resolution has already done. So before a node that reads it is evaluated, the history is brought up to date (triggers/stack.ts#syncHistory, CR 603.10,
 * 608.2h).
 */
export function syncHistoryFor(g: Game, node: unknown): void {
  if (mentionsHistory(node)) syncHistory(g);
}

// ---- programs ------------------------------------------------------------------------------------------------------------------------------------------

/**
 * One program out of a possibly modal one: the chosen modes in printed order (CR 700.2d; a mode chosen twice runs twice), then the program's own targets
 * and steps. The same order as announcement (actions/announce.ts#effectivePrograms), so `StackInfo.targets[i]` belongs to `targets[i]`. `origins` learns the
 * text each top-level step stands for (the mode's text or `text`).
 */
export function flattenProgram(p: EffectProgram, modes: number[] | undefined, text: string, origins: Map<EffectStep, string>): EffectProgram {
  const targets: EffectProgram['targets'] = [];
  const steps: EffectStep[] = [];
  const add = (from: EffectProgram, origin: string): void => {
    targets.push(...from.targets);
    for (const st of from.steps) {
      if (!origins.has(st)) origins.set(st, origin);
      steps.push(st);
    }
  };
  if (p.modes) {
    // std-blb (CR 700.2d): a mode chosen twice runs twice, each instance with its own targets (rules/mode-instances.ts)
    for (const inst of modeInstances(p, modes)) {
      if (!inst) throw new EngineBug(`A chosen mode does not exist (${p.modes.options.length} modes)`);
      add(inst.program, inst.option.text);
    }
  }
  add(p, text);
  return { targets, steps };
}

interface Plan {
  program: EffectProgram;
  origins: Map<EffectStep, string>;
  sourceName: string;
  text: string;
  /** The ability definition, for an ability (its intervening "if"). */
  def?: AbilityDef;
}

/** A manual ability as a step; its `reminder` (the chip of a manual shield, design 8.9, 10.5) goes with it, so the chip is made after the answer. */
const manualStep = (text: string, reason: string, reminder?: Duration): EffectStep => ({ op: 'manual', text, reason, ...(reminder ? { reminder } : {}) });

/**
 * CR 113.3a: only spell abilities are followed as instructions while an instant or sorcery resolves. A manual line of shape 'spell' (or 'unknown', the basic
 * compiler's mixed bucket) is resolved by hand where it is printed; a manual triggered, static or activated line (a cycling trigger, "can't be countered",
 * an unsupported keyword) has its own affordance (design 10.5: the "Triggers to check" tray, the rules reminders panel) and is not asked here.
 */
const RESOLVES_WITH_SPELL: ReadonlySet<string> = new Set(['spell', 'unknown']);

/**
 * The program of an instant or sorcery: every spell ability of the object in printed order (one per face, design D25; both halves of a fused split spell),
 * with each manual spell ability at its place as a manual step (it is resolved by hand where it is printed, CR 608.2c, 113.3a).
 */
function spellPlan(g: Game, obj: GameObject): Plan {
  const c = charsOfObject(g.s, obj);
  const origins = new Map<EffectStep, string>();
  const targets: EffectProgram['targets'] = [];
  const steps: EffectStep[] = [];
  const texts: string[] = [];
  // FAST5X E1: in PRINTED order, keyword expansions at their keyword's place: the spell ability a printed "Gift a card" stands for comes before the card's
  // other spell abilities (CR 702.174b, 702.174j: "the effect of a gift ability always happens before any other spell abilities of the card"). The key list
  // has printed abilities first and expansions after them; abilities with no printed place (index -1) keep their order at the end.
  const place = (a: (typeof c.abilities)[number]): number => (a.index < 0 ? Number.MAX_SAFE_INTEGER : a.face * 100_000 + a.index);
  const ordered = c.abilities.map((a, i) => ({ a, i })).sort((x, y) => place(x.a) - place(y.a) || x.i - y.i).map((x) => x.a);
  for (const a of ordered) {
    if (a.def.kind === 'spell') {
      // CR 702.96a-b: a spell cast for its overload cost has no targets and says "each" where it said "target" (actions/overload.ts; the cast refused it if it can't be rewritten)
      const effect = obj.stack!.costsPaid.alternative === OVERLOAD ? overloadProgram(a.def.effect) ?? a.def.effect : a.def.effect;
      const p = flattenProgram(effect, obj.stack!.modes, a.def.text, origins);
      targets.push(...p.targets);
      steps.push(...p.steps);
      texts.push(a.def.text);
    } else if (a.def.kind === 'manual' && RESOLVES_WITH_SPELL.has(a.def.shape)) {
      const st = manualStep(a.def.text, a.def.reason, a.def.reminder);
      origins.set(st, a.def.text);
      steps.push(st);
      texts.push(a.def.text);
    }
  }
  return { program: { targets, steps }, origins, sourceName: c.name, text: texts.join('\n') || c.name };
}

/** The program of an ability on the stack (activated, triggered, a chapter, or a manual ability whose effect was understood, design 8.4 "Trigger now"). */
function abilityPlan(g: Game, obj: GameObject): Plan {
  const info = obj.stack!;
  const sourceName = info.sourceName ?? 'an ability';
  const def = abilityDefOnStack(g.s, obj);
  const origins = new Map<EffectStep, string>();
  const plan = (program: EffectProgram, text: string): Plan => ({ program: flattenProgram(program, info.modes, text, origins), origins, sourceName, text, ...(def ? { def } : {}) });
  switch (def?.kind) {
    case 'activated': case 'triggered': case 'chapter':
      return plan(def.effect, def.text);
    case 'manual':
      return plan(def.effect ?? { targets: [], steps: [manualStep(def.text, def.reason, def.reminder)] }, def.text);
    default: {
      // Never silently skipped: the players are told what the engine could not find and resolve it by hand (guard G11).
      const text = `the ability of ${sourceName} (the engine cannot find its definition)`;
      return plan({ targets: [], steps: [manualStep(text, 'ability not found')] }, text);
    }
  }
}

// ---- running steps -------------------------------------------------------------------------------------------------------------------------------------

/** Design 8.8 rule 6: a resolution that executes more steps than this (a `repeat` or `forEach` gone wrong) stops and is finished by hand. */
export const STEP_BUDGET = 10_000;

/** Thrown when the step budget is spent; caught only by `resolveStackObject`, which asks the players to finish by hand. Never a NeedDecision. */
export class StepBudgetExceeded extends Error {
  constructor() {
    super(`The resolution executed more than ${STEP_BUDGET} steps.`);
    this.name = 'StepBudgetExceeded';
  }
}

/** Charge `n` steps to the budget (also once per `repeat` / `forEach` iteration, so a loop with an empty body can't run away). */
export function spend(cx: ExecCtx, n: number): void {
  const notes = notesOf(cx);
  notes.steps += n;
  if (notes.steps > STEP_BUDGET) throw new StepBudgetExceeded();
}

/** Steps that contain steps, or are manual: not listed as "done" sentences (design 10.5). */
const COMPOUND: ReadonlySet<string> = new Set(['if', 'may', 'pay', 'forEach', 'repeat', 'manual', 'delay', 'reflexive', 'rollDie', 'flipCoin', 'clash' /* p2-player-rules-2 */]);

/**
 * A step that did not run (guard false, resolved by hand) still answers `did` and binds its name, as nothing (CR 609.3; design 3.1 rule 6). Always
 * overwritten: inside a `forEach` / `repeat` / multi-player `may` the name may still hold what an earlier iteration bound, and a dependent step must not act
 * on that again (CR 608.2c). The lint forbids binding one name twice on a path (model/lint-flow.ts, `duplicate-name`), so nothing else is lost.
 */
function recordSkipped(cx: ExecCtx, st: EffectStep, res: StepResult): void {
  // C6 review (CR 101.3): the players who couldn't do what a step that did not run asked are nobody; the lint counts `cantAs` as bound after the step as it does `as`
  if ((st.op === 'discard' || st.op === 'sacrificeChoice') && typeof st.cantAs === 'string') cx.bindings.set(st.cantAs, { objects: [], players: [], snapshots: {} });
  if (!st.as) return;
  cx.results.set(st.as, res);
  cx.bindings.set(st.as, { objects: [], players: [], snapshots: {} });
}

/**
 * The text of a run of steps the engine cannot perform: their sentences if each has one, otherwise what they stand for (the mode or the ability). Steps
 * lowered from one sentence share its span: each sentence is shown once, never once per step (the player would perform it twice).
 */
function textOf(cx: ExecCtx, group: EffectStep[]): string {
  const notes = notesOf(cx);
  if (group.every((st) => st.span)) return [...new Set(group.map((st) => st.span!))].join(' ');
  return notes.origins.get(group[0]!) ?? notes.text;
}

/** Guard G11 for a run of consecutive steps without a handler: ONE prompt for the sentence(s) they stand for, never a silent skip. */
function askUnhandled(cx: ExecCtx, group: EffectStep[]): StepResult {
  const ops = [...new Set(group.map((st) => st.op))].join(', ');
  return askManual(cx, textOf(cx, group), `the engine cannot perform this step yet (${ops})`);
}

/**
 * Run steps in order (CR 608.2c): the guard of each step, its handler, its result under `as`. Steps without a handler are resolved by hand (consecutive ones
 * that stand for the same text in one prompt). Returns whether any step was carried out and the sum of their counts.
 */
export function runSteps(cx: ExecCtx, steps: EffectStep[]): StepResult {
  const notes = notesOf(cx);
  let performed = false;
  let byHand = false; // merge wave 8 (audit D2): a step of the list was resolved by hand
  let count = 0;
  let lostBy: Map<PlayerId, number> | undefined; // cloud std-spm (CR 119.3): the life the steps made each player lose (`StepResult.lifeLostBy`)
  let removed: Map<string, number> | undefined; // std-rx14 (CR 122.1): the counters the steps removed (`StepResult.countersRemoved`)
  let putIn: Map<string, number> | undefined; // trek-6 (CR 122.6): the counters the steps put (`StepResult.countersPut`)
  for (let i = 0; i < steps.length; i++) {
    if (controllerLeft(cx)) break; // M12-2: CR 800.4a, its controller left the game: the resolution stops at once (`resolveStackObject`)
    const st = steps[i]!;
    spend(cx, 1);
    if (st.guard) {
      syncHistoryFor(cx.g, st.guard);
      if (!evalCond(cx, st.guard)) {
        recordSkipped(cx, st, NOTHING);
        continue;
      }
    }
    const handler = handlerFor(st.op);
    let res: StepResult;
    if (!handler) {
      const group = [st];
      const origin = notes.origins.get(st);
      while (i + 1 < steps.length) {
        const next = steps[i + 1]!;
        const sameText = notes.origins.get(next) === origin && (next.span === undefined) === (st.span === undefined);
        // A step met twice (a mode chosen twice, CR 700.2d) is asked twice: one prompt must never stand for two performances of one sentence.
        if (next.guard || handlerFor(next.op) || !sameText || group.includes(next)) break;
        group.push(next);
        i++;
      }
      spend(cx, group.length - 1);
      res = askUnhandled(cx, group);
      for (const g of group) recordSkipped(cx, g, res);
    } else {
      syncHistoryFor(cx.g, st);
      res = handler(cx, st);
      if (st.as) cx.results.set(st.as, res);
      // A compound step's own steps list their sentences themselves; steps lowered from one sentence list it once.
      if (st.span && !COMPOUND.has(st.op) && notes.done.at(-1) !== st.span) notes.done.push(st.span);
    }
    if (res.performed) performed = true;
    if (res.byHand === true) byHand = true; // merge wave 8 (audit D2)
    count += res.count;
    if (res.lifeLostBy !== undefined) for (const [p, n] of res.lifeLostBy) (lostBy ??= new Map()).set(p, (lostBy.get(p) ?? 0) + n);
    if (res.countersRemoved !== undefined) for (const [k, n] of res.countersRemoved) (removed ??= new Map()).set(k, (removed.get(k) ?? 0) + n);
    if (res.countersPut !== undefined) for (const [k, n] of res.countersPut) (putIn ??= new Map()).set(k, (putIn.get(k) ?? 0) + n);
  }
  const hand = { ...(byHand ? { byHand: true as const } : {}), ...(removed !== undefined ? { countersRemoved: removed } : {}), ...(putIn !== undefined ? { countersPut: putIn } : {}) };
  if (lostBy === undefined) return { performed, count, ...hand };
  return { performed, count, lifeLost: [...lostBy.values()].reduce((a, b) => a + b, 0), lifeLostBy: lostBy, ...hand };
}

/**
 * M12-2 (m12 design D8; CR 800.4a): has the controller of what is resolving left the game? Their spells and abilities left the game with them (owned spells
 * leave, abilities cease to exist, the rest is exiled: core/leave.ts), so a resolution in progress stops at once; what it already did stays done. Only in a
 * multiplayer game: a two-player game is over when a player loses (CR 104.2a).
 */
const controllerLeft = (cx: ExecCtx): boolean => cx.g.s.options.multiplayer !== undefined && cx.g.player(cx.controller).hasLost;

/** The step the engine cannot run (or a node degraded to manual): ask the controller to resolve it by hand, never skip it silently (guard G11). */
export function manualFallback(_g: Game, cx: ExecCtx, step: EffectStep): StepResult {
  return askUnhandled(cx, [step]);
}

// ---- finishing ----------------------------------------------------------------------------------------------------------------------------------------------

/** Where a spell goes when it leaves the stack without becoming a permanent: core/resolve.ts#leaveStack (milestone 3's layout rules). */
export type LeaveStack = (g: Game, obj: GameObject, resolved: boolean) => void;

let leaveStack: LeaveStack | null = null;

/** core/resolve.ts hands its `leaveStack` over when it loads (it imports this module, so this module can't import it back: design 5.4, no cycles). */
export function installLeaveStack(f: LeaveStack): void {
  leaveStack = f;
}

/**
 * CR 608.2n: an ability ceases to exist; an instant or sorcery goes to its owner's graveyard unless it leaves the stack another way (flashback, aftermath,
 * Adventure, Omen: milestone 3's layout rules, which stay native in milestone 5, design 15.3 ruling 8). `resolved` is false when it did not resolve
 * (CR 608.2a, 608.2b): then the "as it resolves" replacements of Adventures and Omens don't apply.
 */
export function finishSpell(g: Game, obj: GameObject, resolved: boolean): void {
  if (obj.kind === 'ability') {
    performAbilityGone(g, obj.id); // CR 608.2n: an ability leaving the stack ceases to exist
    return;
  }
  if (!leaveStack) throw new EngineBug('core/resolve.ts is not loaded: it provides the rules for a spell leaving the stack');
  leaveStack(g, obj, resolved);
}

/**
 * LNK1 (CR 607.1, 608.2b): a target spec with `link` remembers, on the source object, the players and objects chosen for it that are still legal as the ability
 * resolves (the ones it affects; an illegal one is not affected), added to what earlier resolutions remembered (a copy, a second trigger: each player it
 * affected). Only while the source is the object the ability belongs to (performLink, CR 400.7): a creature that left before its "enters" ability resolved
 * links nothing, so its "leaves" ability, which reads the link, does nothing.
 */
function rememberTargets(cx: ExecCtx, program: EffectProgram): void {
  for (const spec of program.targets) {
    if (spec.link === undefined) continue;
    const slots = (cx.targets.get(spec.id) ?? []).filter((t) => t.legal);
    if (slots.length === 0) continue;
    const before = readLink(cx.g.s.objects[cx.source.id], spec.link);
    const players = [...new Set([...(before?.players ?? []), ...slots.flatMap((t) => (t.player !== undefined ? [t.player] : []))])];
    const objects = [...(before?.objects ?? [])];
    for (const t of slots) if (t.handle && !objects.some((h) => h.id === t.handle!.id && h.zone === t.handle!.zone)) objects.push(t.handle);
    performLink(cx.g, cx.source, spec.link, { ...(players.length > 0 ? { players } : {}), ...(objects.length > 0 ? { objects } : {}) });
  }
}

/**
 * FAST5X E21 (CR 603.2h): a triggered ability with "Do this only once each turn" (`limit.action`): the counter of the ability of its source this turn (the key
 * triggers/collect.ts#applyLimit reads) and the name of its one `may` step, whose result says whether the player took the action.
 * Cloud std-spm: the `may` may be followed by steps that run only if the player took it ("If you do, draw a card", parser/lower/ability.ts#onceAction).
 */
function limitedAction(g: Game, obj: GameObject, def: AbilityDef | undefined, program: EffectProgram): { key: string; name: string; max: number } | undefined {
  if (def?.kind !== 'triggered' || def.limit?.action !== true || def.limit.per !== 'turn') return undefined;
  // std-rx27 (CR 603.2h): or the optional cast after looks ("look at the top card of your library. You may cast that card ...", parser/lower/ability.ts#onceCastAt)
  const last = program.steps[program.steps.length - 1];
  const castAfterLooks = last?.op === 'cast' && last.optional === true && program.steps.length > 1 && program.steps.slice(0, -1).every((s) => s.op === 'look');
  const step = castAfterLooks ? last : program.steps[0];
  const key = obj.stack?.abilityRef?.key;
  const sourceId = obj.stack?.sourceId;
  if ((step?.op !== 'may' && !castAfterLooks) || step?.as === undefined || key === undefined || sourceId === undefined) return undefined;
  return { key: `${sourceId}|trigger:${key}`, name: step.as, max: def.limit.max };
}

// ---- the entry point ------------------------------------------------------------------------------------------------------------------------------------------

/** Entry point called by core/resolve.ts for the top object of the stack when it is an instant, a sorcery or an ability (CR 608.2). */
export const resolveStackObject: ResolveStackObject = (g, obj) => {
  if (!obj.stack) throw new EngineBug(`resolveStackObject: ${obj.id} is not on the stack`);
  const isAbility = obj.kind === 'ability';
  if (!isAbility && isPermanentCard(charsOfObject(g.s, obj))) throw new EngineBug('resolveStackObject: a permanent spell becomes a permanent (CR 608.3); core/resolve.ts resolves it');
  const plan = isAbility ? abilityPlan(g, obj) : spellPlan(g, obj);
  const cx = makeCtx(g, obj, plan.program);
  startNotes(cx, { sourceName: plan.sourceName, text: plan.text, origins: plan.origins });
  const what = isAbility ? `The ability of ${plan.sourceName}` : plan.sourceName;

  // CR 608.2a, 603.4: a triggered ability with an intervening "if" checks it again; if it is false the ability is removed from the stack and does nothing.
  if (plan.def?.kind === 'triggered' && plan.def.interveningIf) {
    syncHistoryFor(g, plan.def.interveningIf);
    if (!interveningIfHolds(g, plan.def.interveningIf, { source: cx.source, controller: cx.controller, event: cx.event })) {
      g.log(`${what} does nothing: its "if" condition is no longer true.`, { rules: ['CR 608.2a', 'CR 603.4'], level: 'info' });
      finishSpell(g, obj, false);
      return;
    }
  }

  // CR 608.2b: ONE check over the targets of every chosen mode; it does not resolve only if it has targets and all of them are illegal.
  const { legal, total } = recheckAll(cx);
  if (total > 0 && legal === 0) {
    g.log(`${what} fizzles: all of its targets are illegal.`, { rules: ['CR 608.2b'], level: 'info' });
    finishSpell(g, obj, false);
    return;
  }

  rememberTargets(cx, plan.program);
  // FAST5X E17 (CR 608.2): it resolves: "the Nth time this ability has resolved this turn" counts this resolution (rules/resolutions.ts)
  if (isAbility) countResolution(g, obj.stack);

  // FAST5X E21 (CR 603.2h): "you may <action>. Do this only once each turn": once the action was taken this turn (by another instance of the ability that
  // triggered earlier), it is not offered again
  const once = limitedAction(g, obj, plan.def, plan.program);
  if (once && (g.s.turnActivations[once.key] ?? 0) >= once.max) {
    g.log(`${what} does nothing: its action was already taken this turn ("do this only once each turn").`, { rules: ['CR 603.2h'], level: 'info' });
    finishSpell(g, obj, true);
    return;
  }

  // CR 608.2c: the instructions in order; illegal targets resolve to nothing inside the handlers (CR 608.2b).
  // M12-2 (m12 design 4.5): the decisions asked meanwhile name their asker, this controller (CR 800.4f-h; read in a multiplayer game only, core/game.ts)
  const outer = g.effectController;
  g.effectController = cx.controller;
  try {
    runSteps(cx, plan.program.steps);
  } catch (e) {
    if (!(e instanceof StepBudgetExceeded)) throw e;
    g.log(`${what} executed more than ${STEP_BUDGET} steps; the rest of it is resolved by hand.`, { rules: ['CR 608.2c'], level: 'warning' });
    askManual(cx, `the rest of ${plan.text}`, 'budget');
  } finally {
    g.effectController = outer;
  }
  if (controllerLeft(cx)) {
    // M12-2 (m12 design D8): CR 800.4a, its controller left the game during the resolution: it stopped at once, and it is gone (core/leave.ts: it left the
    // game, ceased to exist or was exiled); it did not finish resolving
    g.log(`${what} stops resolving: its controller left the game.`, { rules: ['CR 800.4a'], level: 'info' });
    return;
  }

  if (once && cx.results.get(once.name)?.performed === true) noteLimitedAction(g, once.key); // CR 603.2h: the action was taken

  g.emit({ type: 'resolved', objectId: obj.id });
  g.log(`${what} resolves.`, { rules: ['CR 608.2'], level: 'info' });
  // CR 608.2m: an object that left the stack while resolving has resolved fully; nothing more happens to it.
  if (g.s.objects[obj.id]?.zone === 'stack') finishSpell(g, obj, true);
};
