/**
 * Putting triggered abilities on the stack: APNAP order (CR 603.3b), modes (603.3c), targets (603.3d). Owner: WP8. Contract:
 * triggers/api.ts#PutPendingTriggersOnStack. core/triggers.ts re-exports `putPendingTriggersOnStack` (after wiring the announcement functions, wiring.ts), and
 * core/turn.ts#advance calls it each time a player would receive priority (CR 117.5, 603.3).
 *
 * Flow of one call:
 *  1. the engine events since the last call are cut into batches (normalize.ts), normalized, written to `GameState.history` and handed to the collector
 *     (collect.ts, delayed.ts); state triggers (state.ts) are checked; everything that triggered joins `GameState.pendingTriggers`;
 *  2. each player in APNAP order (CR 101.4) puts the triggers they control on the stack, in the order they choose when there is more than one that differs
 *     (an `order` decision, CR 603.3b): the active player's go on first, so the non-active player's resolve first;
 *  3. each trigger becomes an ability object on the stack: modes are chosen (603.3c), then targets (603.3d), with the functions that announce a spell; if a mode
 *     or a required target cannot be chosen the ability is removed from the stack (603.3c-d). Choices here are NOT cancellable: a trigger cannot be undone.
 */
import type { Game } from '../core/game';
import { IllegalAction, IllegalAnswer } from '../core/errors';
import { freshObject, moveObject } from '../core/zones';
import type { AbilityDef, EffectProgram, EffectStep, ManualAbilityDef, ModeSpec, Name, TargetSpec, EventPattern } from '../types/ability';
import { byHandAbilities, byHandDenial } from '../rules/by-hand';
import type { ObjectId, PlayerId } from '../types/ids';
import type { EventContext, ObjHandle, PendingTrigger, SemEvent, TargetChoice } from '../types/state';
import { pendingTriggerDef } from '../rules/abilities';
import { emitCrime } from '../rules/crime';
import { programHasTargets } from '../rules/targets';
import { resolutionX } from '../rules/filter-env';
import type { PutPendingTriggersOnStack } from './api';
import { collectTriggers } from './collect';
import { reflexiveAbility } from './delayed';
import { intrinsicTriggers } from './intrinsic';
import { recordHistory } from './history';
import { normalize, splitBatches, turnAt } from './normalize';
import { checkStateTriggers, suppressStateTrigger } from './state';
import { announcer } from './wiring';
import './miracle'; // FAST5X E26: installs miracle's reveal as a card is drawn (CR 702.94a, core/zones.ts#drawCard)


/** r3-choose: the name under which the modes an ability chose are remembered (`ModeSpec.unchosen`): which ability of its object it is. */
const abilityMemoryKey = (r: { source: string; face: number; index: number; key?: string }): string => `${r.source}:${r.face}:${r.index}${r.key !== undefined ? `:${r.key}` : ''}`;

/** How many of `g.events` earlier calls have already turned into triggers (per game run; a run starts at a settled state, so it starts at 0). */
const collected = new WeakMap<Game, number>();
/** How many of `g.events` are already in `GameState.history` (`syncHistory` may get ahead of `collected`; never behind). */
const recorded = new WeakMap<Game, number>();
/**
 * FAST4 T27: for each engine event of the run (by its index in `g.events`, the `seq` of its semantic events), the length `GameState.history` had just before
 * its entries were written: where a batch's own entries begin, whichever of `collectPendingTriggers` or `syncHistory` wrote them (`TriggerDef.first`).
 */
const historyAt = new WeakMap<Game, Map<number, number>>();
/** Standard round 5, r5-trig: for each batch of the run (`SemEvent.batch`), the length `GameState.history` had when its first entry was written (`HistoryEntry.batch`). */
const batchAt = new WeakMap<Game, Map<number, number>>();

/** Write the history of these semantic events (of one batch) and remember where each engine event's entries begin (`historyAt`). */
function record(g: Game, sem: SemEvent[], turn: number): void {
  let at = historyAt.get(g);
  if (at === undefined) historyAt.set(g, (at = new Map()));
  let bat = batchAt.get(g);
  if (bat === undefined) batchAt.set(g, (bat = new Map()));
  for (const e of sem) {
    if (!at.has(e.seq)) at.set(e.seq, g.s.history.length);
    if (!bat.has(e.batch)) bat.set(e.batch, g.s.history.length);
    recordHistory(g.s, [e], turn, bat.get(e.batch)); // r5-trig (CR 603.2c): the entries of one batch share its stamp
  }
}

/** Where the history entries of this batch begin (`historyAt`); a batch none of whose events was recorded in this run begins at the end. */
function historyStartOf(g: Game, sem: readonly SemEvent[]): number {
  const at = historyAt.get(g);
  let start = g.s.history.length;
  if (at !== undefined) for (const e of sem) { const i = at.get(e.seq); if (i !== undefined && i < start) start = i; }
  return start;
}

/**
 * Turn the events since the last call into triggers and add them to `pendingTriggers`: normalize, write history, collect (design 8.4), check state triggers
 * (CR 603.8). Exported for the one place outside `advance` that needs triggers early (the cleanup step, CR 514.3a), and called by `advance` before each
 * state-based action pass (CR 603.2, 704.3).
 */
export function collectPendingTriggers(g: Game): void {
  const from = collected.get(g) ?? 0;
  const events = g.events.slice(from);
  collected.set(g, g.events.length);
  const done = recorded.get(g) ?? 0; // history up to here was written by syncHistory
  recorded.set(g, Math.max(done, g.events.length));
  for (const evs of splitBatches(events)) {
    const first = g.events.indexOf(evs[0]!);
    const sem = normalize(g, evs, first);
    record(g, sem.filter((e) => e.seq >= done), turnAt(g, first));
    g.s.pendingTriggers.push(...collectTriggers(g, sem, historyStartOf(g, sem)));
    g.s.pendingTriggers.push(...intrinsicTriggers(g, sem)); // FXC: CR 310.12b, the Siege defeat trigger (triggers/intrinsic.ts)
  }
  g.s.pendingTriggers.push(...checkStateTriggers(g));
}

/**
 * Bring `GameState.history` up to date with every engine event so far, and do nothing else: no trigger is collected, nothing is logged, no counter is used. The
 * history is otherwise written when triggers are collected (the next time a player would get priority), so a `happened` condition or `happenedCount` quantity
 * evaluated in the middle of a resolution would not see what that resolution has already done; the interpreter calls this before evaluating them (WP4, WP10).
 * What it recorded is not recorded a second time by the collection.
 */
export function syncHistory(g: Game): void {
  const from = recorded.get(g) ?? 0;
  if (from >= g.events.length) return;
  recorded.set(g, g.events.length);
  // Review 2026-10-26 F14 (CR 603.2c): `from` may fall in the middle of a batch (a resolution that reads the history twice): the batch is cut and normalized from
  // its true beginning, as `collectPendingTriggers` will cut it, so all its entries share one `HistoryEntry.batch` stamp (rules/history.ts#firstTimeThisTurn reads
  // one event as one time); only the events not yet recorded are written, as the collection filters them
  for (const evs of splitBatches(g.events.slice(batchStartOf(g, from)))) {
    const first = g.events.indexOf(evs[0]!);
    record(g, normalize(g, evs, first).filter((e) => e.seq >= from), turnAt(g, first));
  }
}

/**
 * Review 2026-10-26 F14: the index in `g.events` where the batch holding the engine event `i` begins, as `collectPendingTriggers` will cut it (`splitBatches` of
 * the events since the last collection): at a step or turn that began, just after a resolution, or at the first event not yet collected.
 */
function batchStartOf(g: Game, i: number): number {
  const lo = collected.get(g) ?? 0;
  for (let j = i; j > lo; j--) {
    const e = g.events[j]!;
    if (e.type === 'stepBegan' || e.type === 'turnBegan' || g.events[j - 1]!.type === 'resolved') return j;
  }
  return lo;
}

/** Two triggers with the same ability and the same event do the same thing in either order: there is nothing to decide (CR 603.3b). */
function sameEffect(g: Game, a: PendingTrigger, b: PendingTrigger): boolean {
  const da = pendingTriggerDef(g.s, a);
  const db = pendingTriggerDef(g.s, b);
  return da !== undefined && db !== undefined && JSON.stringify(da) === JSON.stringify(db) && JSON.stringify([a.context.roles, a.context.amount]) === JSON.stringify([b.context.roles, b.context.amount]);
}

/** CR 603.3b: the controller puts their triggers on the stack in any order they choose. The first one in the answer goes on first and so resolves last. */
function orderTriggers(g: Game, player: PlayerId, mine: PendingTrigger[]): PendingTrigger[] {
  if (mine.every((t) => sameEffect(g, mine[0]!, t))) return mine;
  const ans = g.choose({
    kind: 'order',
    player,
    prompt: 'Order your triggered abilities. The first one is put on the stack first, the last one on top of it and resolves first.',
    items: mine.map((t) => ({ id: t.id, label: `${t.sourceName}: ${pendingTriggerDef(g.s, t)?.text ?? 'triggered ability'}` })),
    rules: ['CR 603.3b'],
  });
  return ans.ids.map((id) => mine.find((t) => t.id === id)!);
}

/**
 * The announcement functions ask cancellable decisions because casting a spell can be taken back (CR 733.1). A triggered ability cannot: it has already
 * triggered, and cancelling would undo whatever action led to this point. `g` with `choose` forced to non-cancellable is what they get here.
 */
function uncancellable(g: Game): Game {
  return new Proxy(g, {
    get(target, prop) {
      if (prop === 'choose') return (input: Parameters<Game['choose']>[0]) => target.choose({ ...input, cancellable: false });
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target),
  });
}

/**
 * CR 115.1, 603.3d, 702.21a (WP32): each object or player chosen as a target of a triggered ability "becomes the target" of that ability once it is on the stack
 * with its targets, exactly as for a spell (actions/announce-targets.ts#emitBecameTarget, which triggers/ may not import, design 5.4) or an activated ability.
 * Ward and "whenever this becomes the target of a spell or ability" see triggered abilities too. Once per distinct target.
 */
/**
 * r4-fxz (CR 107.3, 603.2): every event of the triggered ability is the cast of a spell with {X} in its mana cost ("Whenever you cast a spell with {X} in its mana
 * cost, ..."): the ability's X is that spell's. The same shape model/lint-nodes.ts#castsSpellWithX lets an X through (the layers may not share the function).
 */
function castsSpellWithX(def: { trigger: { on: readonly EventPattern[]; batch?: boolean } }): boolean {
  const on = def.trigger.batch === true ? [] : def.trigger.on;
  return on.length > 0 && on.every((p) => p.ev === 'cast' && p.spell?.manaCostHasX === true);
}

/**
 * std-rx30 (CR 702.37f, 702.168e): "When this creature is turned face up, ...": the one event of the trigger is the source itself turning face up; its X is the X chosen
 * as it was turned face up. The same shape model/lint-nodes.ts#turnsFaceUpSelf lets an X through (the layers may not share the function).
 */
function turnsFaceUpSelf(def: AbilityDef): boolean {
  if (def.kind !== 'triggered' || def.trigger.batch === true || def.trigger.on.length !== 1) return false;
  const p = def.trigger.on[0]!;
  return p.ev === 'becomes' && p.what === 'turnedFaceUp' && JSON.stringify(p.object) === JSON.stringify({ self: true });
}

/** wave 7 merge: "When you cast this spell, ...": every event of the trigger is the cast of the ability's own source (a spell with or without an X). */
function castsSelf(def: { trigger: { on: readonly EventPattern[]; batch?: boolean } }): boolean {
  const on = def.trigger.batch === true ? [] : def.trigger.on;
  return on.length > 0 && on.every((p) => p.ev === 'cast' && p.spell?.self === true);
}

/** CLOUD std-dft: is `id` the subject of the event (the cycled card of a `cycle` action)? */
const subjectIs = (c: EventContext, id: ObjectId): boolean => {
  const v = c.roles.subject;
  return v !== undefined && 'objects' in v && v.objects.some((h: ObjHandle) => h.id === id);
};

function emitBecameTarget(g: Game, stackId: ObjectId, controller: PlayerId, targets: readonly (readonly TargetChoice[])[]): void {
  const seen = new Set<string>();
  for (const t of targets.flat()) {
    const key = `${t.kind}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.emit({ type: 'becameTarget', objectId: t.id, byStackId: stackId, byController: controller });
  }
}

/** The program of a manual triggered ability put on the stack by hand without an effect: nothing to announce (it resolves by hand). */
const NO_EFFECT: EffectProgram = { targets: [], steps: [] };

/** The same ability definition (last known characteristics may hold a copy of a printed one: compared by content then). */
const sameDef = (a: unknown, b: unknown): boolean => a === b || (b !== undefined && JSON.stringify(a) === JSON.stringify(b));

const defIdOf = (g: Game, id: ObjectId): string => g.s.objects[id]?.defId ?? g.s.lki[id]?.object.defId ?? Object.keys(g.s.defs)[0]!;

/**
 * CR 603.3: put one triggered ability on the stack as an object that is not a card, controlled by the player who controlled the source when it triggered
 * (CR 603.3a), then choose its modes and targets (CR 603.3c-d). Returns the stack object, or null if the ability was removed from the stack because a choice
 * could not be made. Raises the player's decisions through `g.choose`.
 */
export function putTriggerOnStack(g: Game, t: PendingTrigger): ObjectId | null {
  const def = pendingTriggerDef(g.s, t);
  // A manual triggered ability whose effect was understood ("Trigger now", design 8.4) goes through the same announcement as an automatic one. MRE: one put on
  // the stack by hand without an effect the engine can announce (`triggerNow`) comes with its definition inline and no effect: it announces nothing and
  // resolves through the manualResolve decision (effects/run.ts#abilityPlan, CR 608.2).
  const byHand = def?.kind === 'manual' && def.shape === 'triggered' && def.effect === undefined && t.inline === def;
  const effect = byHand ? NO_EFFECT : def?.kind === 'triggered' || def?.kind === 'chapter' || (def?.kind === 'manual' && def.shape === 'triggered') ? def.effect : undefined;
  if (!def || !effect) {
    g.log(`${t.sourceName}: the engine can't find the triggered ability that triggered (${t.abilityRef.key ?? t.abilityRef.index}); it is ignored.`, { rules: ['CR 603.3'], level: 'warning' });
    return null;
  }
  // CR 605.1b, 605.4a: a triggered mana ability never uses the stack; since WP32 it is not collected here at all (collect.ts mode `stack`) but resolved at once
  // right after the mana ability that triggered it (mana-now.ts). One that reaches this point triggered from another event, and then it is no mana ability
  // (CR 605.5a): it follows the normal rules for triggered abilities.
  const a = announcer();
  const gg = uncancellable(g);
  const program: EffectProgram = effect;
  // Fail closed (design D2): a spec, mode or count this build does not honor (model/forms.ts) is never announced with the field ignored, as a spell is not offered
  // (actions/announce.ts#programsDenial). `unsupportedForms` looks into every mode's program too.
  const missing = [...new Set(a.unsupportedForms(program))];
  if (missing.length > 0) {
    g.log(`${t.sourceName}: this engine build can't announce part of its triggered ability yet (${missing.join(', ')}), so it is not put on the stack; do it by hand: ${def.text}`, { rules: ['CR 603.3', 'CR 603.3c', 'CR 603.3d'], level: 'manual' });
    return null;
  }
  const obj = freshObject(g, { kind: 'ability', defId: defIdOf(g, t.sourceId), owner: t.controller, controller: t.controller }, 'stack');
  // CR 113.7a: once on the stack, an ability exists independently of its source. One that is not printed text of its source (keyword-generated like ward and
  // cascade, granted, rule) carries its definition, as an activated one does (actions/activate.ts): the source may leave its zone or lose the ability before
  // it resolves (CR 400.7), and rules/abilities.ts#abilityDefOnStack could then find it nowhere.
  // M6-8 (CR 612, 113.7a): a printed ability whose text a text-changing effect changed carries what it says now, not its card's printed definition.
  const printed = t.abilityRef.source === 'printed' ? g.s.defs[defIdOf(g, t.sourceId)]?.faces[t.abilityRef.face]?.abilities[t.abilityRef.index] : undefined;
  const inline = t.inline ?? (t.abilityRef.source !== 'printed' || !sameDef(def, printed) ? def : undefined);
  // CLOUD std-dft (CR 107.3a, 702.29a): the cycled card's own "when you cycle ~" ability reads as X the X announced for its cycling cost (the event's subject
  // is the card, now in the graveyard: this ability's source). Every other triggered ability has no X of its own (below).
  const cycleX = t.context.x !== undefined && t.context.ev === 'action' && subjectIs(t.context, t.sourceId) ? t.context.x : undefined;
  // r4-fxz (CR 107.3, 603.2): "Whenever you cast a spell with {X} in its mana cost, look at the top X cards of your library": the X announced for that spell
  // (model/lint-nodes.ts#castsSpellWithX allows the X only in such an ability); a spell with no X announced (cast for an alternative cost) has X 0
  // wave 7 merge (r4-fxb's "When you cast this spell, copy it X times", CR 107.3, 608.2h, 707.10): a cast trigger of the spell itself reads the same event X,
  // so the X is that of the cast even once the spell has left the stack (countered before the trigger resolves); r4-fxb's read of the spell on the stack
  // (effects/eval.ts spellX) is folded into this one mechanism
  const castX = t.context.ev === 'cast' && def.kind === 'triggered' && (castsSpellWithX(def) || castsSelf(def)) ? (t.context.x ?? 0) : undefined;
  // std-rx30 (CR 702.37f, 702.168e): "When this creature is turned face up, exile up to X other target creatures": the X chosen as it was turned face up (model/lint-nodes.ts#turnsFaceUpSelf)
  const faceUpX = cycleX === undefined && castX === undefined && turnsFaceUpSelf(def) ? (g.s.objects[t.sourceId]?.faceUpX ?? 0) : undefined;
  obj.stack = {
    kind: 'triggered', sourceId: t.sourceId, sourceName: t.sourceName, abilityRef: t.abilityRef, targets: [], costsPaid: {}, event: t.context, ...(inline ? { inline } : {}), pendingId: t.id, // std-copy-6: "that ability" (effects/refs.ts)
    ...(cycleX !== undefined ? { x: cycleX } : castX !== undefined ? { x: castX } : faceUpX !== undefined ? { x: faceUpX } : {}),
  };
  g.s.objects[obj.id] = obj;
  g.s.zones.stack.push(obj.id);
  const remove = (why: string, rule: string): null => {
    g.log(`${t.sourceName}'s triggered ability is removed from the stack: ${why}`, { rules: [rule], level: 'info' });
    if (!t.inline && def.kind === 'triggered' && def.trigger.on.some((p) => p.ev === 'state')) suppressStateTrigger(g, t.sourceId, t.abilityRef.key); // CR 603.8: no endless re-triggering
    moveObject(g, obj.id, 'graveyard'); // an ability that leaves the stack ceases to exist
    return null;
  };
  const what = `${t.sourceName}'s ability`;
  // A triggered ability has announced and paid nothing: no kicker (CR 603.3c, 601.2b), and no X of its own: X is what its resolution will read, the X its
  // source was cast with (CR 107.3m), else 0 (WP30 review: its targets and conditions read the same X now as when it resolves, CR 603.3d, 608.2b).
  // r3-choose (CR 603.3c, 700.2): the modes this ability of the object already had chosen ("choose one that hasn't been chosen"), remembered under its key
  const aenv = { s: g.s, player: t.controller, sourceId: t.sourceId, costsPaid: {}, x: resolutionX(g.s, t.controller, t.sourceId, obj.id), modeMemory: { key: abilityMemoryKey(t.abilityRef), triggered: true }, ...(t.context.amount !== undefined ? { eventAmount: t.context.amount } : {}), ...(t.context.modesChosen !== undefined ? { modesChosen: t.context.modesChosen } : {}) };
  // CR 603.3c: modes. A mode that would be illegal can't be chosen; no mode, no ability.
  if (program.modes) {
    if (!programHasTargets(g.s, program, t.controller, t.sourceId, obj.id, undefined, aenv.x)) return remove('no mode can be chosen.', 'CR 603.3c');
    const modes = a.chooseModes(gg, t.controller, [program], t.sourceId, obj.id, what, aenv);
    if (!modes || modes.length === 0) return remove('no mode was chosen.', 'CR 603.3c');
    obj.stack.modes = modes;
  }
  // CR 603.3d = 601.2c-d: targets, then division. No legal choice, no ability.
  // AF1 (audit FAST1): only "no legal choice can be made" removes the ability. An answer that is not one of the legal choices offered (an illegal object, too
  // few targets while a legal one exists, a set that breaks a group limit) is rejected and the same decision is asked again, exactly as for a spell
  // (core/errors.ts#IllegalAnswer, CR 601.2c, 733): no player can drop a triggered ability, their own or another's, by answering illegally. The announcement
  // throws IllegalAnswer only when a legal answer to the same decision provably exists; with no legal SET of targets (each candidate legal alone, "another
  // target" with too few objects) it throws IllegalAction before asking, so the ability is removed and the decision never re-asks forever (AF1 review).
  try {
    const announced = a.chooseTargets(gg, t.controller, a.effectivePrograms([program], obj.stack.modes), t.sourceId, obj.id, what, aenv);
    obj.stack.targets = announced.targets;
    if (Object.keys(announced.division).length > 0) obj.stack.division = announced.division; // CR 601.2d
  } catch (e) {
    if (e instanceof IllegalAnswer) throw e;
    if (e instanceof IllegalAction) return remove(e.message, 'CR 603.3d');
    throw e;
  }
  g.emit({ type: 'abilityTriggered', objectId: obj.id, sourceId: t.sourceId, player: t.controller });
  emitBecameTarget(g, obj.id, t.controller, obj.stack.targets);
  emitCrime(g, obj.id, t.controller, obj.stack.targets); // FAST5X E20: CR 700.13, putting a triggered ability on the stack
  const targeting = obj.stack.targets.flat().map((x) => (x.kind === 'player' ? g.player(x.id).name : g.nameOf(x.id)));
  g.log(`${g.player(t.controller).name} puts ${t.sourceName}'s triggered ability on the stack${targeting.length ? ` targeting ${targeting.join(', ')}` : ''}.`, { rules: ['CR 603.3'], level: 'action' });
  return obj.id;
}

/**
 * "Trigger now" (design 8.4, 10.5): a triggered ability the engine cannot detect (`ManualAbilityDef` of shape `triggered`) triggered, as its controller attests
 * (CR 603.2). With an understood `effect` it goes on the stack through normal announcement: modes, targets (CR 603.3c-d). MRE (C6 gap 7): without one (or with
 * one this build can't announce) it goes on the stack with its definition inline and no effect, and resolves through the manualResolve decision, in steps.
 * Logged publicly with the card's name and the ability's text. Returns the stack object, or null if it was removed. The action is `manualTrigger`
 * (core/by-hand.ts); `rules/by-hand.ts` says which abilities qualify.
 */
export function triggerNow(g: Game, controller: PlayerId, sourceId: ObjectId, abilityKey: string): ObjectId | null {
  const denial = byHandDenial(g.s, controller, sourceId, abilityKey, 'manualTrigger');
  if (denial) throw new IllegalAction(denial.message, denial.rules);
  const o = g.obj(sourceId);
  const info = byHandAbilities(g.s, o, 'manualTrigger').find((a) => a.key === abilityKey)!;
  const name = g.nameOf(o.id);
  g.log(`${g.player(controller).name} puts ${name}'s triggered ability on the stack by hand: ${info.def.text.split('\n').join(' ')}`, { rules: ['CR 603.2', 'CR 603.3'], level: 'manual' });
  const announceable = info.def.effect !== undefined && announcer().unsupportedForms(info.def.effect).length === 0;
  const manualOnly: ManualAbilityDef | undefined = announceable ? undefined : (({ effect: _e, ...rest }) => rest)(info.def);
  return putTriggerOnStack(g, {
    id: `t${g.s.counters.effect++}`, sourceId, sourceName: name, controller,
    abilityRef: { source: info.origin, face: info.face, index: info.index, key: info.key },
    context: { ev: 'state', roles: {}, before: {} },
    ...(manualOnly ? { inline: manualOnly } : {}),
  });
}

/**
 * CR 603.12: a resolving spell or ability creates a reflexive triggered ability ("When you do, ..."). It follows the delayed-trigger rules (CR 603.7) except that
 * it is checked immediately: it TRIGGERS now, but like every triggered ability it goes on the stack the next time a player would receive priority (CR 603.3), in
 * APNAP order with the other abilities that triggered meanwhile and in the order its controller chooses among their own (CR 603.3b), and its targets are chosen
 * then (CR 603.3d), after the parent has finished resolving. So this only queues it in `GameState.pendingTriggers` (an inline ability and its target specs) and
 * returns the queued trigger; `putPendingTriggersOnStack` does the rest. `bound` and `vars` are what the parent resolution has bound so far.
 */
export function putReflexiveTrigger(
  g: Game,
  a: { source: ObjHandle; controller: PlayerId; text: string; targets: TargetSpec[]; steps: EffectStep[]; bound?: Record<Name, ObjHandle[]>; vars?: Record<string, number>; context?: EventContext | null; modes?: ModeSpec },
): PendingTrigger {
  const ability = reflexiveAbility(a.text, a.targets, a.steps, a.bound, a.vars, a.modes); // r5-cost: with its modes (CR 603.12, 700.2)
  const src = g.s.objects[a.source.id] ?? g.s.lki[a.source.id]?.object;
  const t: PendingTrigger = {
    id: `t${g.s.counters.effect++}`,
    sourceId: a.source.id,
    sourceName: src ? g.nameOf(src.id) : 'a reflexive triggered ability',
    controller: a.controller,
    abilityRef: { source: 'reflexive', face: 0, index: 0, key: `reflexive:${g.s.counters.effect}` },
    context: a.context ?? { ev: 'resolves', roles: {}, before: {} },
    inline: ability,
    targetSpecs: a.targets,
  };
  g.s.pendingTriggers.push(t);
  return t;
}

/** CR 603.3, 603.3b: see the file comment. Returns true if any triggered ability was handled (put on the stack or removed from it). */
export const putPendingTriggersOnStack: PutPendingTriggersOnStack = (g) => {
  collectPendingTriggers(g);
  if (g.s.pendingTriggers.length === 0) return false;
  let any = false;
  for (const player of g.apnap()) {
    const mine = g.s.pendingTriggers.filter((t) => t.controller === player);
    if (mine.length === 0) continue;
    for (const t of mine.length > 1 ? orderTriggers(g, player, mine) : mine) {
      g.s.pendingTriggers = g.s.pendingTriggers.filter((x) => x.id !== t.id);
      putTriggerOnStack(g, t);
      any = true;
    }
  }
  if (g.s.pendingTriggers.length > 0) {
    // Triggers of a player who has left the game (CR 800.4a) go with them.
    g.s.pendingTriggers = [];
    any = true;
  }
  return any;
};
