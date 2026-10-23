/**
 * triggers/: event normalization, trigger collection, delayed/reflexive/state triggers, stack placement. Owner: WP8 (all files in this directory).
 *
 * Files:
 *   triggers/api.ts          this file
 *   triggers/normalize.ts    GameEvent[] -> SemEvent[] (batches: splitBatches, normalize)
 *   triggers/history.ts      GameState.history: facts written from the normalized events, read back by the `happened` condition, `happenedCount` and the history filters
 *   triggers/match.ts        matchEvent(pattern, sem, ctx): the ONE matcher for triggers, replacements, delayed triggers, durations, history filters
 *   triggers/filters.ts      object and player predicates for patterns (self/other, controller/owner as PlayerPred, anyOf/not, stack kinds)
 *   triggers/lookback.ts     lookBackKinds(pattern): CR 603.10a-g, decided from the pattern; lookBackApplies(pattern, event)
 *   triggers/collect.ts      collectTriggers(g, batch): candidates, intervening if (603.4), triggerMod count (603.2d), limits (603.2h), Saga chapters (714.2)
 *   triggers/context.ts      EventContext of a trigger from the events that caused it
 *   triggers/cond.ts         conditions at trigger time (intervening if, state triggers) and the re-check on resolution (interveningIfHolds)
 *   triggers/delayed.ts      delayed (603.7) and reflexive (603.12) records and abilities
 *   triggers/forms.ts        the event-pattern forms and triggered-mana-ability test the build may not honor (capability names `feature:ev.*`, `feature:trigger.mana`)
 *   triggers/state.ts        state triggers (603.8), checked every time triggers are collected (before each state-based action pass, and again after it)
 *   triggers/stack.ts        collectPendingTriggers, syncHistory, putPendingTriggersOnStack: APNAP (603.3b), modes (603.3c), targets (603.3d); putReflexiveTrigger
 *   triggers/wiring.ts       what triggers/ needs from layers it may not import (design 5.4): the announcement functions and the condition evaluator
 * core/triggers.ts is the hook M3 left for core/turn.ts: it hands triggers/ the announcement functions of actions/announce.ts and the condition evaluator of
 * effects/eval.ts (wiring.ts), and re-exports triggers/stack.ts#putPendingTriggersOnStack, #collectPendingTriggers and #syncHistory.
 *
 * When triggers are collected: core/turn.ts#advance calls `collectPendingTriggers` each time a player would receive priority, BEFORE the state-based action pass
 * (CR 603.2, 603.10, 704.3): the events so far are matched against the state they happened in, and a pass's own events are collected in the next window.
 */
import type { Game } from '../core/game';
import type { EventPattern } from '../types/ability';
import type { GameEvent } from '../types/events';
import type { ObjectId } from '../types/ids';
import type { PendingTrigger } from '../types/state';
import type { LookBackKind, SemEvent } from '../types/state';

/** Pure: the engine events of one simultaneous action become one batch of semantic events. */
export type Normalize = (g: Game, events: GameEvent[], batch: number) => SemEvent[];

export interface MatchContext {
  g: Game;
  /** The object whose ability (or the effect's source) owns the pattern; "self"/"other" filters are relative to it. */
  source: ObjectId;
  /** The controller "you"/"opponent" are relative to. */
  controller: string;
  /**
   * FAST5X E8 INTERFACE CHANGE (additive): the half of its source the triggered ability is printed on (CR 709.5j: "this door"), when the ability is printed;
   * absent otherwise (a pattern that names "this door" then matches nothing).
   */
  face?: number;
  /** Evaluate against snapshots in `e.before` instead of the current state (look-back events). */
  lookBack: boolean;
}

/** Does `e` match `pattern`? Filters are evaluated against the AFTER state, or the before snapshot for look-back events (CR 603.10). */
export type MatchEvent = (pattern: EventPattern, e: SemEvent, cx: MatchContext) => boolean;

/** Which CR 603.10 look-back applies to a pattern (empty = none). */
export type LookBackKinds = (pattern: EventPattern) => LookBackKind[];

/**
 * Collect the triggers caused by one batch (design 8.4):
 *  1. candidates: every permanent; every object in a zone where one of its abilities functions; every object that left a zone DURING the batch when a look-back kind applies;
 *  2. enumerate triggered abilities through the characteristics function (granted and generated ones count); for look-back use the snapshot's abilities;
 *  3. matchEvent for each pattern of trigger.on; CR 603.6b: a Humility-style effect that removes the ability "as it enters" stops an enters trigger;
 *  4. evaluate interveningIf (603.4); 5. count: 1 + sum of applicable TriggerModDef.additional (603.2d, never for delayed/reflexive/self);
 *  6. build the PendingTrigger with the EventContext and RETURN it (the frozen text said "enqueue"; the signature is unchanged): triggers/stack.ts#collectPendingTriggers
 *     adds the result to `GameState.pendingTriggers`. Delayed triggers whose event is in the batch are included (delayed.ts).
 *
 * NOT a dry run. Collecting a batch consumes what a triggering consumes: the counters of "do this only once each turn" / "only once" limits (CR 603.2h, kept in
 * `turnActivations` and the source's `chosen`), the ids of `counters.effect`, the log lines, and the delayed trigger records that fire (a record without a duration is
 * deleted, with a duration its `firedCount` grows). Asking twice about the same batch gives a different answer. Anything that only wants to know whether an event
 * matches a pattern (replacement effects, durations, history) uses `matchEvent`, which has no side effects.
 */
// FAST4 T27 INTERFACE CHANGE (additive, optional): `historyStart`, the index of `g.s.history` where the batch's own entries begin (the history before it is
// what happened earlier this turn: "for the first time each turn", `TriggerDef.first`); absent, the batch is taken as not recorded yet.
export type CollectTriggers = (g: Game, batch: SemEvent[], historyStart?: number) => PendingTrigger[];

/** Called from core/turn.ts#advance each time a player would receive priority. Returns true if any trigger was put on the stack. */
export type PutPendingTriggersOnStack = (g: Game) => boolean;

/** Called each time triggers are collected, before and after each state-based action pass (CR 603.8): triggers state triggers that do not already have a copy on the stack. */
export type CheckStateTriggers = (g: Game) => PendingTrigger[];

