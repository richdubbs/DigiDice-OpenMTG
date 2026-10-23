/**
 * Op handlers: counters (CR 122). Owner: WP12. The five stages of design 8.6: evaluate the count (fails to determine: nothing, CR 608.2b; never negative,
 * CR 107.1b), resolve the objects and players (legal targets only; an object that has left is a new object the effect can't find, CR 400.7), decide
 * (which kind of counter, for "remove a counter" from something with several kinds) BEFORE anything changes, act only through `propose` with `counters`
 * events (the performer calls rules/counters.ts#addCounters, or gives a player poison or other counters, CR 122.1), record and log the result.
 *
 * `StepResult.count` is the number of objects and players that actually got or lost counters (design 8.3; see lifedamage.ts), measured from the
 * `countersChanged` events the performers emitted.
 * The capability `op:<op>` exists because the op has a handler here AND a renderer (design 5.2).
 * Ops: putCounters removeCounters moveCounters.
 */
import type { EffectStep } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { LastKnown, ObjHandle } from '../../types/state';
import type { ExecCtx, OpHandlers, Proposed, StepHandler } from '../api';
import { askManual } from '../manual';
import { forbidden } from '../propose';
import { isCurrent, resolveObjs, resolveRecipients } from '../refs';
import { amountOf, announcedShares, NOTHING, proposeMeasured, recordActed, type Share } from './lifedamage';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;
type Holder = ObjHandle | PlayerId;

/**
 * The counters on an object or a player right now (CR 122.1; a player's poison counters live in `PlayerState.poison`, CR 122.1f). Kinds in a fixed order.
 * Exported for the native proliferate (actions-native-counters.ts, PUSH1 T1: INTERFACE CHANGE, one reader of counters instead of two).
 */
export function countersOn(cx: ExecCtx, on: Holder): Record<string, number> {
  const raw: Record<string, number> = typeof on === 'string'
    ? (() => { const p = cx.g.player(on); return { ...p.counters, ...(p.poison > 0 ? { poison: p.poison } : {}) }; })()
    : { ...(cx.g.s.objects[on.id]?.counters ?? {}) };
  const out: Record<string, number> = {};
  for (const k of Object.keys(raw).sort()) if ((raw[k] ?? 0) > 0) out[k] = raw[k]!; // determinism (design 8.8 rule 1)
  return out;
}

/** How many counters of `kind` a record holds (counter names are data: "toString" is not an inherited member). */
const countOf = (rec: Record<string, number>, kind: string): number => (Object.hasOwn(rec, kind) ? rec[kind]! : 0);

const holderName = (cx: ExecCtx, on: Holder): string => (typeof on === 'string' ? cx.g.player(on).name : cx.g.nameOf(on.id));

const counterWords = (n: number, kind: string): string => `${n} ${kind} counter${n === 1 ? '' : 's'}`;

/** The recipients of a counters step that can still be acted on: players in the game, objects still where they were (CR 400.7). */
const canHold = (cx: ExecCtx, h: Holder): boolean => (typeof h === 'string' ? !cx.g.player(h).hasLost : isCurrent(cx, h));

function holders(cx: ExecCtx, ref: Step<'putCounters'>['on']): Holder[] {
  const r = resolveRecipients(cx, ref);
  return [...r.objects, ...r.players].filter((h) => canHold(cx, h));
}

// ---- put (CR 122.1, 122.6) --------------------------------------------------------------------------------------------------------------------------------

/**
 * What each holder gets: `n` each, or, when the counters were divided among targets on casting ("distribute two +1/+1 counters among one or two target
 * creatures", a target spec with `divide.what: 'counters'`), the announced share of each target still legal (CR 601.2d, 608.2b). `null`: a division with
 * no announced amounts (the players are asked).
 */
function putShares(cx: ExecCtx, st: Step<'putCounters'>, n: number): Share[] | null {
  if (st.distribute === true) return distributedShares(cx, st, n);
  if (st.on.ref === 'target') {
    const specId = st.on.id;
    const spec = cx.program.targets.find((t) => t.id === specId);
    if (spec?.divide?.what === 'counters') return announcedShares(cx, specId, n);
  }
  return holders(cx, st.on).map((to) => ({ to, amount: n }));
}

/**
 * std-rx26 (CR 608.2c-d, 122.1; cites unverified): "distribute three stun counters among any number of tapped creatures your opponents control": no target, so the
 * controller chooses, as the step resolves, one to `n` of the objects of `on` that can hold counters now, then divides the `n` counters among them, each getting
 * at least one (the division rule of CR 601.2d, which the wording carries over). No such object: no counters are put.
 */
function distributedShares(cx: ExecCtx, st: Step<'putCounters'>, n: number): Share[] {
  const among = holders(cx, st.on).filter((h): h is ObjHandle => typeof h !== 'string');
  if (among.length === 0) return [];
  const max = Math.min(n, among.length);
  const what = `${counterWords(n, st.kind)}`;
  const ids = cx.g.choose({
    kind: 'chooseObjects', player: cx.controller, prompt: `Distribute ${what} among which of them? Choose 1 to ${max}.`, options: among.map((h) => h.id), min: 1, max, rules: ['CR 608.2d', 'CR 122.1'],
  }).ids;
  const chosen = among.filter((h) => ids.includes(h.id));
  if (chosen.length <= 1) return chosen.map((to) => ({ to, amount: n }));
  const amounts = cx.g.choose({
    kind: 'chooseDivision', player: cx.controller, prompt: `Divide ${what} among ${chosen.map((h) => cx.g.nameOf(h.id)).join(', ')}; each gets at least 1.`, what: 'counters', total: n,
    targets: chosen.map((h) => ({ id: h.id, label: cx.g.nameOf(h.id) })), rules: ['CR 608.2d', 'CR 601.2d'],
  }).amounts;
  return chosen.map((to, i) => ({ to, amount: amounts[i] ?? 0 }));
}

const putCounters: StepHandler<Step<'putCounters'>> = (cx, st) => {
  let n = amountOf(cx, st.count); // 1. evaluate
  if (n === undefined || n === 0) return NOTHING; // fails to determine (CR 608.2b), or no counters at all
  // std-mana-2 (CR 608.2d): "put up to three lore counters on it": how many, from none to N (one object only: model/cap-walk.ts)
  if (st.upTo === true) {
    const on = holders(cx, st.on);
    if (on.length === 0 || !on.some((h) => canHold(cx, h))) return NOTHING;
    const pick = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Put how many ${st.kind} counters on ${holderName(cx, on[0]!)}? (up to ${n})`, min: 0, max: n, rules: ['CR 122.1', 'CR 608.2d'] }).n;
    n = Math.max(0, Math.min(pick, n));
    if (n === 0) return NOTHING;
  }
  const shares = putShares(cx, st, n); // 2. resolve
  if (shares === null) return askManual(cx, st.span ?? 'Put the counters as divided on casting.', 'the announced division of the counters is missing (CR 601.2d)');
  const acted: Holder[] = [];
  for (const { to, amount } of shares) { // 4. act (CR 122.6: a replacement may modify it)
    if (amount <= 0 || !canHold(cx, to)) continue;
    const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on: to, kind: st.kind, count: amount });
    if (put <= 0) continue;
    acted.push(to);
    cx.g.log(`${counterWords(put, st.kind)} put on ${holderName(cx, to)}.`, { rules: ['CR 122.1', 'CR 122.6', ...(amount !== n ? ['CR 601.2d'] : [])], level: 'action' });
  }
  return recordActed(cx, st.as, acted); // 5. record
};

// ---- remove (CR 122.1) ------------------------------------------------------------------------------------------------------------------------------------

/**
 * Which counters to remove from one holder: a specific kind (as many as there are, at most the count), every counter ("remove all counters"), or `n`
 * counters of the kinds the controller chooses. A choice is asked only when there is one: a holder with a single kind of counter needs none (CR 608.2d).
 */
/** FAST4 T31: the option that ends an "up to" removal early (CR 608.2d: the controller may remove fewer, down to none). */
const STOP = '__stop';

/** The value forms of the counter ops this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). */
export const OP_FORMS: readonly string[] = ['op:removeCounters.upTo', 'op:moveCounters.every' /* FAST5X E21 */, 'op:putCounters.distribute' /* std-rx26 */, 'op:putCounters.upTo' /* std-mana-2 */,
  'op:moveCounters.anyKind' /* p2-counters-move-1 */, 'op:moveCounters.upTo' /* p2-counters-move-1 */];

function removalPlan(cx: ExecCtx, st: Step<'removeCounters'>, on: Holder, n: number | 'all'): Record<string, number> {
  const present = countersOn(cx, on);
  // CLOUD std-ecl (CR 122.1, 608.2d): "remove any number of counters from target creature" is `upTo` with `count: 'all'`: from none to every counter it has,
  // the controller saying how many of each kind (there is no total to keep, so one question per kind)
  if (st.upTo === true && n === 'all') {
    const plan: Record<string, number> = {};
    for (const kind of Object.keys(present)) {
      if (st.kind !== 'any' && kind !== st.kind) continue;
      const have = countOf(present, kind);
      if (have <= 0) continue;
      const take = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Remove how many ${kind} counters from ${holderName(cx, on)}? (up to ${have})`, min: 0, max: have, rules: ['CR 122.1', 'CR 608.2d'] }).n;
      const t = Math.max(0, Math.min(take, have));
      if (t > 0) plan[kind] = t;
    }
    return plan;
  }
  const upTo = st.upTo === true && n !== 'all';
  if (st.kind !== 'any') {
    const have = countOf(present, st.kind);
    let take = n === 'all' ? have : Math.min(n, have); // you can't remove counters that aren't there
    if (upTo && take > 0) {
      // FAST4 T31 (CR 608.2d): "remove up to N <kind> counters": how many, from none to N
      take = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Remove how many ${st.kind} counters from ${holderName(cx, on)}? (up to ${take})`, min: 0, max: take, rules: ['CR 122.1', 'CR 608.2d'] }).n;
      take = Math.max(0, Math.min(take, have));
    }
    return take > 0 ? { [st.kind]: take } : {};
  }
  if (n === 'all') return present;
  const left = { ...present };
  const plan: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const kinds = Object.keys(left).filter((k) => left[k]! > 0);
    if (kinds.length === 0) break;
    let kind = kinds[0]!;
    if (upTo) {
      // FAST4 T31 (CR 122.1, 608.2d): "remove up to N counters": each counter's kind, or stop here (also before the first one)
      const ans = cx.g.choose({
        kind: 'chooseOption', player: cx.controller, min: 1, max: 1,
        prompt: `Choose the kind of counter to remove from ${holderName(cx, on)} (up to ${n}; ${i} removed so far), or stop.`,
        options: [...kinds.map((k) => ({ id: k, label: `${k} (${left[k]})` })), { id: STOP, label: 'Remove no more' }], rules: ['CR 122.1', 'CR 608.2d'],
      });
      const id = ans.ids[0];
      if (id === STOP || id === undefined || !kinds.includes(id)) break;
      kind = id;
    } else if (kinds.length > 1) {
      const ans = cx.g.choose({
        kind: 'chooseOption', player: cx.controller, min: 1, max: 1,
        prompt: `Choose the kind of counter to remove from ${holderName(cx, on)}${n > 1 ? ` (${i + 1} of ${n})` : ''}.`,
        options: kinds.map((k) => ({ id: k, label: `${k} (${left[k]})` })), rules: ['CR 122.1', 'CR 608.2d'],
      });
      kind = ans.ids[0] && kinds.includes(ans.ids[0]) ? ans.ids[0] : kind;
    }
    left[kind]! -= 1;
    plan[kind] = (plan[kind] ?? 0) + 1;
  }
  return plan;
}

const removeCounters: StepHandler<Step<'removeCounters'>> = (cx, st) => {
  const n = st.count === 'all' ? 'all' : amountOf(cx, st.count); // 1. evaluate
  if (n === undefined || n === 0) return NOTHING;
  const targets = holders(cx, st.from); // 2. resolve
  const plans = targets.map((on) => ({ on, plan: removalPlan(cx, st, on, n) })); // 3. decide for every holder before anything changes (design 8.6)
  const acted: Holder[] = [];
  const tally = new Map<string, number>(); // std-rx14 (CR 122.1, 608.2c): what was actually removed, for "for each lore counter removed this way"
  for (const { on, plan } of plans) { // 4. act
    const removed: string[] = [];
    for (const kind of Object.keys(plan)) {
      const count = plan[kind]!;
      const took = count > 0 ? proposeMeasured(cx, { ev: 'counters', change: 'removed', on, kind, count }) : 0;
      if (took > 0) removed.push(counterWords(took, kind));
      if (took > 0) tally.set(kind, (tally.get(kind) ?? 0) + took);
    }
    if (removed.length === 0) continue;
    acted.push(on);
    cx.g.log(`${removed.join(' and ')} removed from ${holderName(cx, on)}.`, { rules: ['CR 122.1'], level: 'action' });
  }
  return { ...recordActed(cx, st.as, acted), countersRemoved: tally }; // 5. record
};

// ---- move (CR 122.5, 122.8, 122.9) -----------------------------------------------------------------------------------------------------------------------

/**
 * The object whose counters are to be moved has left the battlefield. Its counters ceased to exist (CR 400.7), so normally nothing moves (CR 122.5: "if
 * either object is no longer in the correct zone"). Two rules instead put the same number of counters it had on the other object, from its last known
 * information:
 *  - CR 122.8: a TRIGGERED ability whose trigger condition or effect checks that the object left the battlefield: the triggering event is it leaving the
 *    battlefield (the look-back snapshot of a zone change, "when this dies"), or an earlier step of this effect moved it off (a re-based binding).
 *  - CR 122.9: an ACTIVATED ability one of whose costs sacrificed it (`CostsPaid.costObjects` names the card it became).
 * Anything else (graft whose creature was bounced in response) is `undefined`: nothing moves. `'ask'`: an activated ability's source token that left the
 * battlefield (a token ceases to exist, so the cost record cannot name it: whether it was the sacrifice cost is asked, never guessed).
 */
function leftWithCounters(cx: ExecCtx, from: ObjHandle): { info: LastKnown; rule: 'CR 122.8' | 'CR 122.9' } | 'ask' | undefined {
  const kind = cx.stack?.kind;
  if (kind === 'triggered') {
    const ev = cx.event;
    if (ev?.ev === 'zoneChange') {
      const looked = ev.before[from.id] ?? Object.values(ev.before).find((l) => l.newId === from.id);
      if (looked?.leftZone === 'battlefield') return { info: looked, rule: 'CR 122.8' };
    }
    for (const b of cx.bindings.values()) {
      const snap = b.snapshots[from.id];
      if (snap?.leftZone === 'battlefield' && from.zone !== 'battlefield' && b.objects.some((h) => h.id === from.id && h.zone === from.zone)) return { info: snap, rule: 'CR 122.8' };
    }
    return undefined;
  }
  if (kind === 'activated') {
    const lki = cx.g.s.lki[from.id];
    if (lki?.leftZone !== 'battlefield') return undefined;
    const paid = cx.stack?.costsPaid.costObjects ?? [];
    if (paid.includes(from.id) || (lki.newId !== undefined && paid.includes(lki.newId))) return { info: lki, rule: 'CR 122.9' };
    if (lki.object.kind === 'token' && from.id === cx.source.id) return 'ask';
  }
  return undefined;
}

/**
 * Move counters of one kind from one object to another: remove them from the first, then put that many on the second (CR 122.5). Moving is all or
 * nothing: if the put or the removal can't happen (a "can't" effect, CR 614.17), neither is done, so the check comes first. CR 122.8 and 122.9 put the
 * number an object that left had (`leftWithCounters`).
 */
const moveCounters: StepHandler<Step<'moveCounters'>> = (cx, st) => {
  if (st.kind === 'any' || st.upTo === true) return moveEveryCounter(cx, st);
  const n = st.count === 'all' ? 'all' : amountOf(cx, st.count); // 1. evaluate
  if (n === undefined || n === 0) return NOTHING;
  const froms = resolveObjs(cx, st.from); // 2. resolve
  const tos = resolveObjs(cx, st.to);
  if (froms.length > 1 || tos.length > 1) return askManual(cx, st.span ?? 'Move the counters.', 'counters are moved from or onto more than one object (CR 122.5)');
  const from = froms[0];
  const to = tos[0];
  if (!from || !to || !isCurrent(cx, to)) return NOTHING; // nothing chosen ("up to one"), or an illegal target / an object that left (CR 608.2b, 400.7)
  if (from.id === to.id) return NOTHING; // CR 122.5: the first and second objects are the same object
  let count: number;
  let removal: Proposed | null = null;
  let rule = 'CR 122.5';
  // An object still on the battlefield gives up its own counters. One that left (a stale handle, or the card it became, which a re-based binding names)
  // has none: only CR 122.8 / 122.9 use the counters it had. A current object in another zone (a card in exile with time counters) gives up its own.
  const left = isCurrent(cx, from) && from.zone === 'battlefield' ? undefined : leftWithCounters(cx, from);
  if (left === 'ask') return askManual(cx, st.span ?? 'Put its counters on the other object.', 'a token that left the battlefield: was it sacrificed to pay the cost? (CR 122.9)');
  if (left) {
    const had = countOf(left.info.object.counters, st.kind); // CR 608.2h, 603.10a
    count = n === 'all' ? had : Math.min(n, had);
    rule = left.rule;
  } else {
    if (!isCurrent(cx, from)) return NOTHING; // CR 122.5: no longer in the correct zone
    const have = countOf(countersOn(cx, from), st.kind);
    count = n === 'all' ? have : Math.min(n, have); // CR 122.5: counters it doesn't have can't be moved
    removal = { ev: 'counters', change: 'removed', on: from, kind: st.kind, count };
  }
  if (count === 0) return NOTHING;
  const put: Proposed = { ev: 'counters', change: 'put', on: to, kind: st.kind, count };
  if (forbidden(cx.g, put) || (removal && forbidden(cx.g, removal))) { // CR 122.5: "if either of these actions isn't possible ... no counter is removed or put"
    cx.g.log(`No ${st.kind} counters are moved onto ${cx.g.nameOf(to.id)}: one of the two actions can't happen.`, { rules: ['CR 122.5', 'CR 614.17'], level: 'action' });
    return NOTHING;
  }
  if (removal) { // 4. act: remove, then put what was removed
    const removed = proposeMeasured(cx, removal);
    if (removed <= 0) return NOTHING;
    count = removed;
  }
  const moved = proposeMeasured(cx, { ...put, count });
  if (moved > 0) {
    const what = rule === 'CR 122.5'
      ? `${counterWords(moved, st.kind)} moved from ${cx.g.nameOf(from.id)} onto ${cx.g.nameOf(to.id)}.`
      : `${cx.g.nameOf(from.id)} has left the battlefield: the same number of ${st.kind} counters it had (${moved}) is put on ${cx.g.nameOf(to.id)} instead.`;
    cx.g.log(what, { rules: [rule, 'CR 122.1'], level: 'action' });
  }
  return recordActed(cx, st.as, moved > 0 ? [to] : []); // 5. record
};

/**
 * FAST5X E21: "put its counters on target creature you control" (`kind: 'any'`, `count: 'all'`): every counter of every kind the first object has (CR 122.5),
 * or, when it has left the battlefield and CR 122.8 / 122.9 apply, the same number of each kind of counter it had (its last known information, CR 608.2h,
 * 603.10a). Nothing happens if it had none, if the second object is gone or is the same object (CR 122.5, 400.7, 608.2b). Each kind is moved on its own,
 * all or nothing (CR 122.5: a kind that can't be removed or put stays where it is); the kinds go in a fixed order (design 8.8 rule 1).
 * p2-counters-move-1: also a number of counters of any kind, and "any number of" counters (`upTo`); `movePlan` says which counters move.
 */
function moveEveryCounter(cx: ExecCtx, st: Step<'moveCounters'>): ReturnType<StepHandler<Step<'moveCounters'>>> {
  const n = st.count === 'all' ? 'all' : amountOf(cx, st.count); // 1. evaluate
  if (n === undefined || n === 0) return NOTHING;
  const froms = resolveObjs(cx, st.from);
  const tos = resolveObjs(cx, st.to);
  if (froms.length > 1 || tos.length > 1) return askManual(cx, st.span ?? 'Move the counters.', 'counters are moved from or onto more than one object (CR 122.5)');
  const from = froms[0];
  const to = tos[0];
  if (!from || !to || !isCurrent(cx, to)) return NOTHING; // nothing chosen ("up to one"), an illegal target, or an object that left (CR 608.2b, 400.7)
  if (from.id === to.id) return NOTHING; // CR 122.5
  const left = isCurrent(cx, from) && from.zone === 'battlefield' ? undefined : leftWithCounters(cx, from);
  if (left === 'ask') return askManual(cx, st.span ?? 'Put its counters on the other object.', 'a token that left the battlefield: was it sacrificed to pay the cost? (CR 122.9)');
  if (!left && !isCurrent(cx, from)) return NOTHING; // CR 122.5: no longer in the correct zone
  const had: Record<string, number> = {};
  if (left) {
    const lk = left.info.object.counters; // CR 608.2h, 603.10a
    for (const k of Object.keys(lk).sort()) if ((lk[k] ?? 0) > 0) had[k] = lk[k]!;
  } else Object.assign(had, countersOn(cx, from));
  const plan = movePlan(cx, st, cx.g.nameOf(from.id), had, n); // 3. decide before anything changes (design 8.6)
  let movedAny = false;
  for (const kind of Object.keys(plan)) {
    let count = plan[kind]!;
    const removal: Proposed | null = left ? null : { ev: 'counters', change: 'removed', on: from, kind, count };
    const put: Proposed = { ev: 'counters', change: 'put', on: to, kind, count };
    if (forbidden(cx.g, put) || (removal && forbidden(cx.g, removal))) {
      cx.g.log(`No ${kind} counters are moved onto ${cx.g.nameOf(to.id)}: one of the two actions can't happen.`, { rules: ['CR 122.5', 'CR 614.17'], level: 'action' });
      continue;
    }
    if (removal) {
      const removed = proposeMeasured(cx, removal);
      if (removed <= 0) continue;
      count = removed;
    }
    if (!isCurrent(cx, to)) break; // a replacement moved it (CR 400.7)
    const moved = proposeMeasured(cx, { ...put, count });
    if (moved <= 0) continue;
    movedAny = true;
    const what = left
      ? `${cx.g.nameOf(from.id)} has left the battlefield: the same number of ${kind} counters it had (${moved}) is put on ${cx.g.nameOf(to.id)}.`
      : `${counterWords(moved, kind)} moved from ${cx.g.nameOf(from.id)} onto ${cx.g.nameOf(to.id)}.`;
    cx.g.log(what, { rules: [left ? left.rule : 'CR 122.5', 'CR 122.1'], level: 'action' });
  }
  return recordActed(cx, st.as, movedAny ? [to] : []);
}

/**
 * p2-counters-move-1 (CR 122.5, 608.2d; cites unverified): which counters of `had` (the first object's counters, or the ones it had when it left) a move takes,
 * kind -> number, in a fixed kind order (design 8.8 rule 1):
 *  - `count: 'all'`: every counter of the step's kind, or of every kind for `kind: 'any'` ("put its counters on", "move all counters from");
 *  - `upTo` with `count: 'all'`: "move any number of [<kind>] counters": for each kind there, how many, from none to all (no total to keep, so one question per kind);
 *  - a number with `kind: 'any'`: "move a counter / two counters": the kind of each counter in turn, asked only when there is more than one kind left; with `upTo`
 *    the controller may also stop. You can't move counters that aren't there (CR 122.5), so the plan never exceeds `had`.
 */
function movePlan(cx: ExecCtx, st: Step<'moveCounters'>, fromName: string, had: Record<string, number>, n: number | 'all'): Record<string, number> {
  const kinds = Object.keys(had).filter((k) => had[k]! > 0 && (st.kind === 'any' || k === st.kind));
  if (n === 'all' && st.upTo !== true) return Object.fromEntries(kinds.map((k) => [k, had[k]!]));
  const plan: Record<string, number> = {};
  if (n === 'all') {
    for (const kind of kinds) {
      const have = had[kind]!;
      const take = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Move how many ${kind} counters from ${fromName}? (up to ${have})`, min: 0, max: have, rules: ['CR 122.5', 'CR 608.2d'] }).n;
      const t = Math.max(0, Math.min(take, have));
      if (t > 0) plan[kind] = t;
    }
    return plan;
  }
  if (st.kind !== 'any') { // a fixed kind with `upTo`: how many, none to n
    const most = kinds.length === 0 ? 0 : Math.min(n, had[st.kind]!);
    if (most === 0) return plan;
    const take = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Move how many ${st.kind} counters from ${fromName}? (up to ${most})`, min: 0, max: most, rules: ['CR 122.5', 'CR 608.2d'] }).n;
    const t = Math.max(0, Math.min(take, most));
    if (t > 0) plan[st.kind] = t;
    return plan;
  }
  const left = { ...had };
  for (let i = 0; i < n; i++) {
    const open = Object.keys(left).filter((k) => left[k]! > 0);
    if (open.length === 0) break;
    let kind = open[0]!;
    if (st.upTo === true || open.length > 1) {
      const options = [...open.map((k) => ({ id: k, label: `${k} (${left[k]})` })), ...(st.upTo === true ? [{ id: STOP, label: 'Move no more' }] : [])];
      const ans = cx.g.choose({ kind: 'chooseOption', player: cx.controller, min: 1, max: 1, prompt: `Choose the kind of counter to move from ${fromName}${n > 1 ? ` (${i + 1} of ${n})` : ''}.`, options, rules: ['CR 122.5', 'CR 608.2d'] });
      const id = ans.ids[0];
      if (id === STOP) break;
      if (id !== undefined && open.includes(id)) kind = id;
    }
    left[kind]! -= 1;
    plan[kind] = (plan[kind] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(plan).sort().map((k) => [k, plan[k]!]));
}

export const COUNTERS_HANDLERS: OpHandlers = {
  putCounters,
  removeCounters,
  moveCounters,
};
