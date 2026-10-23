/**
 * How long resolved effects last (CR 611.2a-b, 514.2, 500.5, 610.3): the object form of `Duration` (design 3.7) for the three kinds of record that carry one,
 * resolved continuous effects (`ContinuousEffectRec`), delayed triggers with a stated duration (`DelayedTriggerRec.duration`, CR 603.7b) and the chips of manual
 * shields (`ManualReminder.until`). Owner: WP15 (with its edits of core/turn.ts and core/steps.ts, which call it).
 *
 * | Duration         | Ends                                                                 | Called from                                         |
 * |------------------|----------------------------------------------------------------------|-----------------------------------------------------|
 * | endOfTurn        | cleanup step, with damage removal (CR 514.2)                         | core/steps.ts cleanup                               |
 * | endOfCombat      | end of the combat phase (CR 500.5a)                                  | core/steps.ts endOfStepCleanup                      |
 * | permanent        | never (CR 611.2a)                                                    |                                                     |
 * | untilNextTurn    | as that player's next turn begins                                    | core/turn.ts beginNextTurn                          |
 * | endOfNextTurn    | becomes endOfTurn as that player's next turn begins, so it ends in that turn's cleanup step (FAST5X E29, CR 611.2a, 514.2) | core/turn.ts beginNextTurn |
 * | duringNextTurn   | dormant until the extra turn it names begins (`turn`), then endOfTurn; ends unused when that turn is skipped (std-control-1, audit-fix-2, CR 500.7, 611.2a) | core/turn.ts beginNextTurn |
 * | untilExiledWith  | the first time an effect of the source object exiled another card after it began (r5-dig, CR 611.2a, 607.2a) | `endDurations` |
 * | remainsExiled    | the first time none of the objects its permission names is still in exile (FAST5X E29, CR 611.2b, 400.7) | `endDurations`              |
 * | untilNextStep    | as the next such step (of that player's turn) begins                 | core/turn.ts beginStep                              |
 * | whileSource      | the first time the source is no longer there / controlled / attached (to what it was attached to) / tapped (CR 611.2b) | `endDurations`, each time a player would get priority |
 * | whileObject      | the first time the object it names (not the source) left the battlefield / is untapped / has no such counter (std-rx32, CR 611.2b) | `endDurations`, and read live by the layer system (statics/while-object.ts) |
 * | asLongAs         | the first time the condition is false (design 3.7: never restarts)   | `endDurations`                                      |
 * | until            | when the event happens after the effect began (CR 610.3)             | `endDurations`, over the engine events since the last call |
 *
 * FAST4 MX1: a fourth kind of record lasts `until` an event, the zone changes of CR 610.3 (`GameState.untilMoves`, written by the `move` handler). When its
 * event happens the record ends like the others, and the second one-shot effect returns its objects (`installUntilReturner`, effects/until-return.ts): the
 * records ended by the same call return together (CR 610.3d), before triggers are collected and state-based actions checked, so no player can act between
 * the event and the return. Known gap: an event in the middle of a resolving spell's steps is followed by the return when that resolution is over, not between
 * two of its steps (no printed card's later steps can see the difference that we know of).
 *
 * `whileSource` is also judged by the layer system every time it reads a resolved effect (statics/live.ts), so a characteristic never shows an ended effect;
 * the record is deleted here. `asLongAs` and `until` end at the next call of `endDurations`: before triggers are collected and state-based actions are checked,
 * i.e. before any player can act on the stale effect. For `until` this is the event listener of design 3.7 (an effect read later in the SAME resolution or
 * turn-based action still sees it); `asLongAs` must be judged live (design 3.7), so its capability `dur:asLongAs` is not advertised (effects/eval.ts) until the
 * layer system can. A condition about the history is judged on an up-to-date history (`syncHistory`, CR 603.10: it is otherwise written only as triggers are
 * collected, which comes after this).
 */
import type { Duration, PlayerPred, PlayerRef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { type ContinuousEffectRec, type ObjHandle, type SemEvent, type Step, type UntilMoveRec } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import { playerPredMatches } from '../rules/predicates';
import { holds } from '../triggers/cond';
import { lookBackApplies } from '../triggers/lookback';
import { matchEvent } from '../triggers/match';
import { normalize, splitBatches } from '../triggers/normalize';
import { syncHistory } from '../triggers/stack';
import { EngineBug, type Game } from './game';
import { syncControl } from './control';
import { whileObjectHolds } from '../statics/while-object';

/** What every record with a duration has (the three kinds of record are read through this view). */
interface Lasting {
  id: string;
  source: ObjHandle | null;
  controller: PlayerId;
  duration: Duration;
  /** For `whileSource` `attached`: what the source was attached to as the effect began (resolved continuous effects only). */
  attachedTo?: ObjectId | PlayerId;
}

// ---- per-run bookkeeping (a run starts at a settled state, so every index starts at 0; nothing about a game is kept across runs) -----------------------

/** How many of `g.events` `endDurations` has looked at. */
const seen = new WeakMap<Game, number>();
/** First event index that may end an `until` duration, per record created in this run: an event before the effect began cannot end it (CR 610.3a-b). */
const armed = new WeakMap<Game, Map<string, number>>();

/** Called by whoever creates a record with an `until` duration (the `effect` and `delay` handlers): events that already happened don't end it. */
export function armDuration(g: Game, id: string): void {
  let m = armed.get(g);
  if (!m) armed.set(g, (m = new Map()));
  m.set(id, g.events.length);
}

/** The one place a resolved continuous effect joins the state (CR 611.2, called by the `effect` handler). An `until` duration counts events from now on. */
export function addEffectRecord(g: Game, rec: ContinuousEffectRec): void {
  g.s.continuousEffects.push(rec);
  if (rec.duration.d === 'until') armDuration(g, rec.id);
}

// ---- the second one-shot effect of CR 610.3 (installed by effects/until-return.ts: core does not import the interpreter) ------------------------------

type UntilReturner = (g: Game, ended: readonly UntilMoveRec[]) => void;
let untilReturner: UntilReturner | null = null;

/** FAST4 MX1: effects/until-return.ts installs what returns the objects of ended `untilMoves` records (CR 610.3, 610.3c-d). */
export function installUntilReturner(f: UntilReturner): void {
  untilReturner = f;
}

/** FAST4 MX1: the one place a zone change "until" an event joins the state (the `move` handler). Its event counts from now on (CR 610.3a-b). */
export function addUntilMove(g: Game, rec: UntilMoveRec): void {
  g.s.untilMoves = [...(g.s.untilMoves ?? []), rec];
  armDuration(g, rec.id);
}

// ---- the three lists --------------------------------------------------------------------------------------------------------------------------------------

function lastings(g: Game): Lasting[] {
  const out: Lasting[] = [];
  for (const e of g.s.continuousEffects) {
    out.push({ id: e.id, source: e.source, controller: e.controller, duration: e.duration, ...(e.attachedTo !== undefined ? { attachedTo: e.attachedTo } : {}) });
  }
  for (const d of g.s.delayedTriggers) if (d.duration) out.push({ id: d.id, source: d.source, controller: d.controller, duration: d.duration });
  for (const r of g.s.reminders) out.push({ id: r.id, source: r.source ?? null, controller: r.controller, duration: r.until });
  return out;
}

/** Delete the records with these ids from all three lists, saying why in the log once. */
function expire(g: Game, ids: ReadonlySet<string>, why: string, rules: string[]): void {
  if (ids.size === 0) return;
  const ce = g.s.continuousEffects.filter((e) => !ids.has(e.id));
  if (ce.length !== g.s.continuousEffects.length) g.s.continuousEffects = ce;
  const dt = g.s.delayedTriggers.filter((d) => !(d.duration && ids.has(d.id)));
  if (dt.length !== g.s.delayedTriggers.length) g.s.delayedTriggers = dt;
  const rm = g.s.reminders.filter((r) => !ids.has(r.id));
  if (rm.length !== g.s.reminders.length) g.s.reminders = rm;
  g.log(`${ids.size === 1 ? 'An effect ends' : `${ids.size} effects end`}: ${why}.`, { rules, level: 'info' });
  syncControl(g); // MX2: a control-changing effect that ended gives control back (CR 613.1b)
}

const playersOfRef = (ref: PlayerRef): PlayerId[] | undefined => (ref.ref === 'fixed' ? ref.players : undefined);

/** Does the active player fit the duration's player (a fixed set written by the `effect` handler, or a predicate relative to the record's controller)? */
function whoseMatches(pred: PlayerPred | undefined, player: PlayerId, controller: PlayerId): boolean {
  return playerPredMatches(pred, player, controller, (r) => playersOfRef(r)) === true;
}

// ---- turn and step boundaries ------------------------------------------------------------------------------------------------------------------------------

/** "Until end of turn" (CR 514.2) and "until end of combat" (CR 500.5a): the simple forms, which the step code ends with its own filter for the legacy records. */
export function expireSimple(g: Game, d: 'endOfTurn' | 'endOfCombat'): void {
  const ids = new Set(lastings(g).filter((x) => x.duration.d === d).map((x) => x.id));
  if (ids.size === 0) return;
  // The continuous effects of this form are also removed by core/steps.ts (both the legacy and the typed records); this removes the delayed triggers and chips.
  expire(g, ids, d === 'endOfTurn' ? 'until end of turn' : 'until end of combat', [d === 'endOfTurn' ? 'CR 514.2' : 'CR 500.5a']);
}

/** "Until your next turn": as that turn begins, before its untap step (CR 500.1, 611.2a). M12-2: and the goad of that player ends (CR 701.15a). */
export function expireAtTurnStart(g: Game, active: PlayerId): void {
  const ids = new Set(lastings(g).filter((x) => x.duration.d === 'untilNextTurn' && (playersOfRef(x.duration.whose) ?? [x.controller]).includes(active)).map((x) => x.id));
  expire(g, ids, `${g.player(active).name}'s turn begins`, ['CR 611.2a']);
  lastTurnBegins(g, active);
  nextTurnBegins(g);
  expireGoad(g, active, ['CR 701.15a']);
}

/**
 * M12-2 (m12 design D14, 4.2): CR 701.15a, a creature is goaded "until the next turn of the controller of that spell or ability": the entries of `goader`
 * (`GameObject.goaded`) end as that player's turn begins, or as it would have begun when they left the game (CR 800.4m). Nothing writes `goaded` before
 * M12-3's native goad, and a two-player game has none (D16): then this does nothing.
 */
function expireGoad(g: Game, goader: PlayerId, rules: string[]): void {
  for (const id of g.s.zones.battlefield) {
    const o = g.s.objects[id];
    if (!o?.goaded?.some((x) => x.by === goader)) continue;
    const rest = o.goaded.filter((x) => x.by !== goader);
    if (rest.length > 0) o.goaded = rest;
    else delete o.goaded;
    g.log(`${g.nameOf(id)} is no longer goaded by ${g.player(goader).name}.`, { rules, level: 'info' });
  }
}

/**
 * M12-2 (m12 design D14; CR 800.4k, 800.4m): the turn of a player who left the game would have begun now (it doesn't, CR 800.4k): the effects that last until
 * that player's next turn or until a point in it ("until your next upkeep", "during your next untap step") end now: "They neither expire immediately nor
 * last indefinitely." Their goad ends too. Called by core/turn.ts#nextTurnPlayer when the turn order passes the leaver's seat or skips their extra turn.
 */
export function expireAtLeaversTurn(g: Game, leaver: PlayerId): void {
  const inThatTurn = (x: Lasting): boolean => {
    const d = x.duration;
    if (d.d === 'untilNextTurn') return (playersOfRef(d.whose) ?? [x.controller]).includes(leaver);
    if (d.d === 'untilNextStep' || d.d === 'throughNextUntap') return d.whose !== undefined && whoseMatches(d.whose, leaver, x.controller);
    return false;
  };
  const ids = new Set(lastings(g).filter(inThatTurn).map((x) => x.id));
  expire(g, ids, `${g.player(leaver).name}'s turn would have begun (they left the game)`, ['CR 800.4m', 'CR 611.2a']);
  expireGoad(g, leaver, ['CR 701.15a', 'CR 800.4m']);
}

/**
 * FAST5X E29: "until the end of your next turn" (`endOfNextTurn`, CR 611.2a, 514.2): as that player's turn begins, the turn the record waited for is this one,
 * so from now on it lasts "until end of turn" and the cleanup step of this turn ends it (core/steps.ts, `expireSimple`). A record that began during this
 * player's own turn was not converted as that turn began (it did not exist yet), so it lasts through the player's following turn, as written.
 */
function lastTurnBegins(g: Game, active: PlayerId): void {
  const due = (d: Duration | undefined, controller: PlayerId): boolean => d?.d === 'endOfNextTurn' && (playersOfRef(d.whose) ?? [controller]).includes(active);
  const END: Duration = { d: 'endOfTurn' };
  if (g.s.continuousEffects.some((e) => due(e.duration, e.controller))) {
    g.s.continuousEffects = g.s.continuousEffects.map((e) => (due(e.duration, e.controller) ? { ...e, duration: END } : e));
  }
  // std-rt (CR 603.7b, 611.2a): a delayed trigger ends "at end of turn" by the turn it counts from (triggers/delayed.ts#expired: a later turn ends it), so the
  // converted record counts from this turn, from its first step: "Until the end of your next turn, whenever you cast a spell, ..." triggers all through that turn
  if (g.s.delayedTriggers.some((d) => due(d.duration, d.controller))) {
    const turn = g.s.turn.number;
    g.s.delayedTriggers = g.s.delayedTriggers.map((d) => (due(d.duration, d.controller) ? { ...d, duration: END, createdTurn: turn, vars: { ...d.vars, $step: -1 } } : d));
  }
  if (g.s.reminders.some((r) => due(r.until, r.controller))) {
    g.s.reminders = g.s.reminders.map((r) => (due(r.until, r.controller) ? { ...r, until: END } : r));
  }
}

/**
 * std-control-1 (CR 500.7, 611.2a): "During that turn, ..." after "Take an extra turn after this one." (`duringNextTurn`): a record that began in an earlier turn
 * applies from now on, through this turn, so it becomes "until end of turn" and this turn's cleanup step ends it. Only resolved continuous effects carry it
 * (model/cap-walk.ts: restrictions only).
 */
function nextTurnBegins(g: Game): void {
  const t = g.s.turn;
  const turn = t.number;
  // audit-fix-2 (CR 500.7): with `turn`, only as THAT extra turn begins; a record whose turn is no longer queued (skipped, its player left the game, CR 800.4a)
  // and is not this one can never apply, and ends
  const due = (e: ContinuousEffectRec): boolean => e.duration.d === 'duringNextTurn' && (e.duration.turn === undefined ? e.startedTurn < turn : e.duration.turn === t.extraTurnId);
  const gone = (e: ContinuousEffectRec): boolean => e.duration.d === 'duringNextTurn' && e.duration.turn !== undefined && e.duration.turn !== t.extraTurnId && !(t.extraTurnIds ?? []).includes(e.duration.turn);
  if (g.s.continuousEffects.some(gone)) g.s.continuousEffects = g.s.continuousEffects.filter((e) => !gone(e));
  if (g.s.continuousEffects.some(due)) g.s.continuousEffects = g.s.continuousEffects.map((e) => (due(e) ? { ...e, duration: { d: 'endOfTurn' } } : e));
}

/** "Until your next upkeep" and the like: as that step begins (CR 500.6, 611.2a). */
export function expireAtStepStart(g: Game, step: Step): void {
  const active = g.s.turn.activePlayer;
  const ids = new Set(
    lastings(g).filter((x) => x.duration.d === 'untilNextStep' && x.duration.step === step && whoseMatches(x.duration.whose, active, x.controller)).map((x) => x.id),
  );
  expire(g, ids, `the ${step} step begins`, ['CR 611.2a']);
}

/**
 * MX5: "doesn't untap during its controller's next untap step" (`throughNextUntap`, CR 502.3, 611.2a): as the active player's untap step ends (after the
 * permanents untapped). A record with `whose` ends in that player's untap step. A record without it ends in the untap step of the controller of the one
 * object its restriction is about (the `effect` handler stores one record per object), judged now: a permanent that changed controllers stays tapped
 * during its new controller's next untap step. A record whose object is gone (a new object, CR 400.7) ends too: it can never apply again. A delayed trigger
 * or chip with no player ends in the first untap step. Called by core/steps.ts at the end of the untap step's turn-based actions; a skipped untap step
 * (CR 500.11) never calls it.
 */
export function expireAfterUntapStep(g: Game, active: PlayerId): void {
  /** The one object of a record's restriction: its id, '' when it is gone, null when the record is not about one object. */
  const objectOf = (id: string): ObjectId | '' | null => {
    const e = g.s.continuousEffects.find((r) => r.id === id)?.effect;
    if (!e || e.s !== 'restrict' || e.subject.ref !== 'fixed' || !('objects' in e.subject) || e.subject.objects.length !== 1) return null;
    const h = e.subject.objects[0]!;
    const o = g.s.objects[h.id];
    return o && o.zone === h.zone ? h.id : '';
  };
  const ids = new Set(lastings(g).filter((x) => {
    const d = x.duration;
    if (d.d !== 'throughNextUntap') return false;
    if (d.whose !== undefined) return whoseMatches(d.whose, active, x.controller);
    const id = objectOf(x.id);
    return id === null || id === '' || g.s.objects[id]!.controller === active;
  }).map((x) => x.id));
  expire(g, ids, `${g.player(active).name}'s untap step ends`, ['CR 502.3', 'CR 611.2a']);
}

// ---- the checks made each time a player would receive priority ---------------------------------------------------------------------------------------------

/**
 * CR 611.2b: is the source still where, and as, a "for as long as" duration needs it? For `attached`, `attachedTo` is what it was attached to as the effect
 * began ("remains attached to it": attached to something else is over, CR 301.5c); without it, attached to anything.
 */
export function sourceHolds(g: Game, source: ObjHandle | null, controller: PlayerId, as: Extract<Duration, { d: 'whileSource' }>['as'], attachedTo?: ObjectId | PlayerId): boolean {
  const o = source ? g.s.objects[source.id] : undefined;
  if (!o || !source || o.zone !== source.zone || o.zone !== 'battlefield' || o.phasedOut) return false; // a new object is not the source (CR 400.7)
  switch (as) {
    case 'onBattlefield': return true;
    case 'controlled': return charsOfObject(g.s, o).controller === controller; // the controller after layer 2 (CR 613.1b)
    case 'attached': return attachedTo !== undefined ? o.attachedTo === attachedTo : o.attachedTo !== undefined;
    case 'tapped': return o.tapped;
  }
}

/** Is a state duration (`whileSource`, `asLongAs`) over? `undefined` from a condition this build cannot evaluate keeps the effect (it is not guessed away). */
function stateOver(g: Game, x: Lasting): boolean {
  const d = x.duration;
  if (d.d === 'whileSource') return x.source !== null && !sourceHolds(g, x.source, x.controller, d.as, x.attachedTo);
  if (d.d === 'asLongAs') return holds(g, d.cond, { source: x.source ?? { id: '', zone: 'command' }, controller: x.controller, event: null }) === false;
  if (d.d === 'remainsExiled') return !namedStillExiled(g, x.id);
  if (d.d === 'whileObject') return !whileObjectHolds(g.s, d); // std-rx32 (CR 611.2b, 400.7)
  // r5-dig (CR 611.2a, 607.2a): "until you exile another card with ~": an effect of the source object exiled a card after this effect began
  if (d.d === 'untilExiledWith') return x.source !== null && (g.s.exiledWith?.[x.source.id] ?? 0) > (d.after ?? 0);
  return false;
}

/**
 * FAST5X E29 (CR 611.2b, 400.7): is one of the objects a "for as long as it remains exiled" record's permissions name still that object in exile? A record
 * that is not a resolved permission for named objects (a delayed trigger, a chip: the capability check keeps them from having this duration) names none.
 */
function namedStillExiled(g: Game, id: string): boolean {
  const e = g.s.continuousEffects.find((r) => r.id === id)?.effect;
  if (!e || e.s !== 'permit') return false;
  const is = e.of?.is;
  if (!is || is.ref !== 'fixed' || !('objects' in is)) return false;
  return is.objects.some((h) => h.zone === 'exile' && g.s.objects[h.id]?.zone === 'exile');
}

/** Does this event end an `until` duration (CR 610.3)? Matched like a trigger of the record's source (look-back where the pattern needs it, CR 603.10). */
function eventEnds(g: Game, x: Lasting, e: SemEvent): boolean {
  if (x.duration.d !== 'until') return false;
  if (e.seq < (armed.get(g)?.get(x.id) ?? 0)) return false; // before the effect began
  const pattern = x.duration.event;
  return matchEvent(pattern, e, { g, source: x.source?.id ?? '', controller: x.controller, lookBack: lookBackApplies(pattern, e) });
}

/**
 * End every state and event duration that is over (design 3.7). Called by core/turn.ts#advance each time a player would receive priority, before triggers are
 * collected and state-based actions checked. Does nothing (and reads no event) when no record has such a duration.
 */
export function endDurations(g: Game): void {
  const from = seen.get(g) ?? 0;
  seen.set(g, g.events.length);
  if ((g.s.untilMoves?.length ?? 0) > 0) endUntilMoves(g, from);
  const all = lastings(g).filter((x) => x.duration.d === 'whileSource' || x.duration.d === 'whileObject' || x.duration.d === 'asLongAs' || x.duration.d === 'until' || x.duration.d === 'remainsExiled' || x.duration.d === 'untilExiledWith');
  if (all.length === 0) return;
  if (all.some((x) => x.duration.d === 'asLongAs')) syncHistory(g); // a `happened` / `happenedCount` condition sees what happened so far (CR 603.10)
  const over = new Set<string>();
  for (const x of all) if (stateOver(g, x)) over.add(x.id);
  expire(g, over, 'its "for as long as" duration is over', ['CR 611.2b']);
  const waiting = all.filter((x) => x.duration.d === 'until' && !over.has(x.id));
  if (waiting.length === 0 || from >= g.events.length) return;
  const ended = new Set<string>();
  for (const evs of splitBatches(g.events.slice(from))) {
    const first = g.events.indexOf(evs[0]!);
    for (const e of normalize(g, evs, first)) for (const x of waiting) if (!ended.has(x.id) && eventEnds(g, x, e)) ended.add(x.id);
  }
  expire(g, ended, 'the event it lasted until happened', ['CR 610.3', 'CR 611.2a']);
}

/**
 * FAST4 MX1 (CR 610.3): the `untilMoves` records whose event happened among the events since the last call end, and their objects return, all at once
 * (CR 610.3d). A record none of whose objects is still where the move put it is dropped silently: nothing can return (a new object, CR 400.7).
 */
function endUntilMoves(g: Game, from: number): void {
  const recs = g.s.untilMoves ?? [];
  const present = (h: ObjHandle): boolean => g.s.objects[h.id]?.zone === h.zone;
  const ended: UntilMoveRec[] = [];
  if (from < g.events.length) {
    const waiting = recs.map((r) => ({ rec: r, x: { id: r.id, source: r.source, controller: r.controller, duration: r.duration } as Lasting }));
    const hit = new Set<string>();
    for (const evs of splitBatches(g.events.slice(from))) {
      const first = g.events.indexOf(evs[0]!);
      for (const e of normalize(g, evs, first)) for (const w of waiting) if (!hit.has(w.rec.id) && eventEnds(g, w.x, e)) hit.add(w.rec.id);
    }
    for (const r of recs) if (hit.has(r.id)) ended.push(r);
  }
  const keep = recs.filter((r) => !ended.includes(r) && r.objects.some((o) => present(o.object)));
  if (keep.length !== recs.length) g.s.untilMoves = keep;
  const returning = ended.filter((r) => r.objects.some((o) => present(o.object)));
  if (returning.length === 0) return;
  if (!untilReturner) throw new EngineBug('endDurations: the CR 610.3 returner is not installed (effects/funnels.ts was not loaded)');
  untilReturner(g, returning);
}
