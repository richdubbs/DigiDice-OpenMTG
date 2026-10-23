/**
 * Delayed (CR 603.7) and reflexive (CR 603.12) triggered abilities: the `DelayedTriggerRec` records and their firing (design 8.4). Owner: WP8.
 *
 * The `delay` step (WP15) calls `createDelayedTrigger`; every batch is checked against the records by `collectDelayed` (called from collect.ts). The `reflexive`
 * step calls `reflexiveAbility` and puts the result on the stack with `putReflexiveTrigger` (stack.ts).
 *
 * What a record remembers (CR 603.7c): the names it captured, each with the zone the object was expected in, and the values fixed at creation (CR 608.2h). When it
 * fires, the ability that goes on the stack is the record's steps with those names replaced by what they stood for (`bakeSteps`): an object becomes
 * `{ref:'fixed', objects:[{id, zone}]}`, which the interpreter skips when the object is no longer in that zone (it is a new object, CR 400.7); a variable
 * becomes its number. The ability then needs nothing but itself, as CR 113.7a says (it exists independently of its source).
 *
 * Reserved keys of `DelayedTriggerRec.vars` (they cannot collide with a `let` name): `$step`, the index in STEP_ORDER of the step that was current at creation,
 * which decides what "the next end step" means (CR 603.7: created during the end step, the next one is next turn's).
 */
import type { Game } from '../core/game';
import type { Duration, EffectStep, ModeSpec, Name, PlayerPred, TargetSpec, TriggeredAbilityDef } from '../types/ability';
import type { PlayerId } from '../types/ids';
import { STEP_ORDER, type DelayedTriggerRec, type ObjHandle, type PendingTrigger, type SemEvent } from '../types/state';
import { contextOf } from './context';
import { playerMatches } from './filters';
import { lookupObject } from './filters';
import { isDelayedManaAbility } from './forms';
import { lookBackApplies } from './lookback';
import { matchEvent } from './match';
import { batchOccurrences, occurrences } from './occurrences';
import { holds } from './cond';

export const OWNER = 'WP8' as const;

/** First engine-event index that may fire a record, per game run: events before the record existed cannot trigger it (CR 603.7a). */
const armedAt = new WeakMap<Game, Map<string, number>>();

export interface DelayedArgs {
  /** CR 603.7d-g: the object that created it (the spell, the ability's source, the static ability's permanent). */
  source: ObjHandle;
  /** CR 603.7d-g: who controlled the spell or ability as it resolved. */
  controller: PlayerId;
  when: DelayedTriggerRec['when'];
  do: EffectStep[];
  captured?: Record<Name, ObjHandle[]>;
  vars?: Record<string, number>;
  /** A stated duration ("this turn") lets it trigger every time; without one it triggers once (CR 603.7b). */
  duration?: Duration;
  /** FAST5 T45: with a duration, triggers once only ("When you next cast ... this turn"). */
  once?: boolean;
  /** FAST5 T50 (CR 603.2c): "one or more ..." / "whenever you attack": all the events of a batch that fit are one occurrence. */
  batch?: boolean;
  /** std-tdm (CR 603.7, 603.3d): its own targets, chosen when it is put on the stack after it triggers (`delay.targets`). */
  targets?: TargetSpec[];
}

/** CR 603.7a: a delayed triggered ability is created while a spell or ability resolves; it cannot trigger before that. */
export function createDelayedTrigger(g: Game, a: DelayedArgs): DelayedTriggerRec {
  const rec: DelayedTriggerRec = {
    id: `d${g.s.counters.effect++}`,
    source: a.source,
    controller: a.controller,
    when: a.when,
    do: a.do,
    captured: a.captured ?? {},
    vars: { ...(a.vars ?? {}), $step: STEP_ORDER.indexOf(g.s.turn.step) },
    createdTurn: g.s.turn.number,
    ...(a.duration ? { duration: a.duration } : {}),
    ...(a.once === true ? { once: true } : {}),
    ...(a.batch === true ? { batch: true } : {}),
    ...(a.targets !== undefined && a.targets.length > 0 ? { targets: a.targets } : {}),
    firedCount: 0,
    createdAt: g.s.counters.timestamp, // M6-4, CR 701.27f: the next timestamp; a permanent that transforms later gets one at least this large
  };
  g.s.delayedTriggers.push(rec);
  let m = armedAt.get(g);
  if (!m) armedAt.set(g, (m = new Map()));
  m.set(rec.id, g.events.length);
  return rec;
}

/** Replace the names a delayed or reflexive ability captured by what they stood for (see the file comment). Pure. */
export function bakeSteps<T>(node: T, captured: Record<Name, ObjHandle[]>, vars: Record<string, number>): T {
  if (Array.isArray(node)) return node.map((x) => bakeSteps(x, captured, vars)) as T;
  if (node === null || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  if (o['ref'] === 'bound' && typeof o['name'] === 'string' && Object.hasOwn(captured, o['name'])) {
    return { ref: 'fixed', objects: captured[o['name']]!.map((h) => ({ id: h.id, zone: h.zone })) } as T;
  }
  if (o['q'] === 'var' && typeof o['name'] === 'string' && !o['name'].startsWith('$') && Object.hasOwn(vars, o['name'])) return vars[o['name']] as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = bakeSteps(v, captured, vars);
  return out as T;
}

/** The triggered ability a delayed record becomes when it fires (CR 603.7). */
export function delayedAbility(rec: DelayedTriggerRec, name: string): TriggeredAbilityDef {
  return {
    kind: 'triggered',
    text: `Delayed triggered ability of ${name}.`,
    trigger: { on: [] },
    // std-tdm (CR 603.7, 603.3d): a delayed trigger's own targets are announced as it is put on the stack, like any triggered ability's
    effect: { targets: bakeSteps(rec.targets ?? [], rec.captured, rec.vars), steps: bakeSteps(rec.do, rec.captured, rec.vars) },
  };
}

/**
 * CR 603.12: the triggered ability a resolving spell or ability creates for "when you do" / "when that happens this way". `bound` and `vars` are what the
 * parent resolution has bound so far; they are baked in like a delayed ability's captures.
 */
export function reflexiveAbility(text: string, targets: TargetSpec[], steps: EffectStep[], bound: Record<Name, ObjHandle[]> = {}, vars: Record<string, number> = {}, modes?: ModeSpec): TriggeredAbilityDef {
  // r5-cost (CR 603.12, 603.3c, 700.2): a reflexive trigger with modes chooses them as it is put on the stack; each mode's instructions read what the parent bound
  const baked = modes !== undefined ? { modes: { ...modes, options: modes.options.map((o) => ({ ...o, program: { ...o.program, steps: bakeSteps(o.program.steps, bound, vars) } })) } } : {};
  return { kind: 'triggered', text, trigger: { on: [] }, effect: { targets, ...baked, steps: bakeSteps(steps, bound, vars) } };
}

/** Durations the engine can end by itself here; every other duration is the business of the effect that created the record (WP15). */
function expired(g: Game, rec: DelayedTriggerRec): boolean {
  const t = g.s.turn;
  switch (rec.duration?.d) {
    case 'endOfTurn': return t.number > rec.createdTurn;
    case 'endOfCombat': return t.number > rec.createdTurn || STEP_ORDER.indexOf(t.step) > STEP_ORDER.indexOf('endCombat');
    default: return false;
  }
}

/** Forget the records whose duration ended. */
export function expireDelayed(g: Game): void {
  if (g.s.delayedTriggers.some((r) => expired(g, r))) g.s.delayedTriggers = g.s.delayedTriggers.filter((r) => !expired(g, r));
}

const stepIndex = (e: SemEvent): number => STEP_ORDER.indexOf(e.data['step'] as (typeof STEP_ORDER)[number]);

/** Does this event fire the record? Step triggers fire at the first such step AFTER the record was created (CR 603.7a). */
function fires(g: Game, rec: DelayedTriggerRec, e: SemEvent): boolean {
  if (e.seq < (armedAt.get(g)?.get(rec.id) ?? 0)) return false; // happened before the record existed (CR 603.7a)
  const w = rec.when;
  if (w.at === 'event') {
    const cx = { g, source: rec.source.id, controller: rec.controller, lookBack: false };
    return matchEvent(w.event, e, cx);
  }
  if (e.ev !== 'step') return false;
  const step = w.at === 'step' ? w.step : 'endCombat';
  // r5-fxb (CR 505.1, 603.7a): "your next main phase" is either main phase
  if (e.data['step'] !== step && !(w.at === 'step' && w.anyMain === true && (e.data['step'] === 'main1' || e.data['step'] === 'main2'))) return false;
  const whose: PlayerPred | undefined = w.at === 'step' ? w.whose : undefined;
  const who = e.roles.player && 'players' in e.roles.player ? e.roles.player.players[0] : undefined;
  if (!playerMatches(g.s, whose, who, { source: rec.source.id, controller: rec.controller })) return false;
  const turn = typeof e.data['turn'] === 'number' ? e.data['turn'] : g.s.turn.number;
  const created = rec.vars['$step'] ?? -1;
  if (w.at === 'step' && w.turn === 'next') return turn === rec.createdTurn + 1; // FAST5 T36: the turn after this one (CR 500.7, 603.7a)
  if (w.at === 'step' && w.turn === 'later') return turn > rec.createdTurn; // r4-fxz: "the end step on your next turn", a later turn only (CR 603.7a)
  return turn > rec.createdTurn || (turn === rec.createdTurn && stepIndex(e) > created);
}

/**
 * CR 603.7b: check every record against a batch. A record without a duration fires once, for the first event that fits (if several fit simultaneously its
 * controller chooses; the first stands in for that choice), and is then deleted; with a duration it fires for every event until the duration ends.
 * `mode` (WP32): a delayed triggered mana ability (forms.ts#isDelayedManaAbility, CR 605.1b) is collected only by the `mana` collection, every other record only
 * by the `stack` one (collect.ts#CollectMode).
 */
export function collectDelayed(g: Game, batch: readonly SemEvent[], mode: 'stack' | 'mana' = 'stack'): PendingTrigger[] {
  expireDelayed(g);
  const out: PendingTrigger[] = [];
  for (const rec of [...g.s.delayedTriggers]) {
    if (isDelayedManaAbility(rec) !== (mode === 'mana')) continue;
    let hits = batch.filter((e) => fires(g, rec, e));
    // std-rx32 (CR 603.4): an intervening "if" (the record's one `if` step marked `intervening`): an event for which it is false triggers nothing; undetermined, it triggers
    const gate = rec.do.length === 1 && rec.do[0]!.op === 'if' && rec.do[0]!.intervening === true ? bakeSteps(rec.do[0]!.cond, rec.captured, rec.vars) : undefined;
    if (gate !== undefined) hits = hits.filter((e) => holds(g, gate, { source: rec.source, controller: rec.controller, event: contextOf([e], {}, () => false) }) !== false);
    if (hits.length === 0) continue;
    // PUSH1 T2: with a duration, once per occurrence (the combat damage of a step is one event for a damage trigger naming one side, triggers/occurrences.ts)
    const single = !rec.duration || rec.once === true; // FAST5 T45: "when you next cast ... this turn" waits up to the duration but triggers once (CR 603.7b)
    // FAST5 T50 (CR 603.2c): a batch event ("one or more ...", "whenever you attack") is one occurrence for all the events of the batch that fit
    const used = !single
      ? (rec.when.at === 'event' ? (rec.batch === true ? batchOccurrences([rec.when.event], hits) : occurrences([rec.when.event], hits)) : hits.map((e) => [e]))
      : rec.batch === true ? [hits] : [[hits[0]!]];
    const src = lookupObject(g.s, rec.source.id);
    const name = src ? g.nameOf(src.id) : 'a delayed triggered ability';
    for (const group of used) {
      rec.firedCount++;
      out.push({
        id: `t${g.s.counters.effect++}`,
        sourceId: rec.source.id,
        sourceName: name,
        controller: rec.controller,
        // M6-4, CR 701.27f: `index` carries the record's creation time (the record itself is gone once a one-shot fires), read by effects/handlers/dfc-ops.ts
        abilityRef: { source: 'delayed', face: 0, index: rec.createdAt ?? 0, key: rec.id },
        context: contextOf(group, {}, (e) => rec.when.at === 'event' && lookBackApplies(rec.when.event, e)), // AF2: CR 603.10a, as the pattern decides
        inline: delayedAbility(rec, name),
      });
      g.log(`A delayed triggered ability of ${name} triggers.`, { rules: ['CR 603.7'], level: 'info' });
    }
    if (single) g.s.delayedTriggers = g.s.delayedTriggers.filter((r) => r.id !== rec.id);
  }
  return out;
}
