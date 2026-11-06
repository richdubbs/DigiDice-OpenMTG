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
import { performAction } from '../perform';
import { forbidden } from '../propose';
import { isCurrent, readInfo, resolveObjs, resolvePlayers, resolveRecipients } from '../refs';
import { countersOn } from './counters-read';
import { amountOf, announcedShares, NOTHING, proposeMeasured, recordActed, type Share } from './lifedamage';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;
type Holder = ObjHandle | PlayerId;

export { countersOn }; // edh-perms-15: read in counters-read.ts (choose.ts needs it without importing this module: import cycles, design 5.4)

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

const putCounters: StepHandler<Step<'putCounters'>> = (cx, rawStep) => {
  // edhn63 (CR 122.1, 122.6, 608.2h; Captain Marvel, Apex Avenger, Bold Plagiarist): "put the same number and kind of counters on ~": each kind the triggering counters event
  // put, the same number of it (`same`) or one of it (`oneEach`), as one put per kind. The event's counters are fixed once it happened; none (the event is not a counters event): nothing.
  // edhn63 (CR 122.1, 122.6, 608.2h; Denry Klin, Editor in Chief): "put the same number of each kind of counter on that creature": each kind of counter the model object has now (or last had), as one put per kind
  if (rawStep.copyFrom !== undefined) {
    const src = resolveObjs(cx, rawStep.copyFrom)[0];
    const info = src === undefined ? undefined : readInfo(cx, src);
    if (info === undefined) return NOTHING;
    const { copyFrom: _from, ...base } = rawStep;
    let last: ReturnType<StepHandler<Step<'putCounters'>>> = NOTHING;
    const tally = new Map<string, number>();
    for (const [kind, n] of Object.entries(info.object.counters).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (n <= 0) continue;
      const r = putCounters(cx, { ...base, kind, count: n }) as { countersPut?: Map<string, number> };
      for (const [k, v] of r.countersPut ?? []) tally.set(k, (tally.get(k) ?? 0) + v);
      last = r as typeof last;
    }
    return tally.size === 0 ? last : { ...last, countersPut: tally };
  }
  if (rawStep.ofEvent !== undefined) {
    const kinds = cx.event?.counterKinds;
    if (kinds === undefined) return NOTHING;
    const { ofEvent, ...base } = rawStep;
    let last: ReturnType<StepHandler<Step<'putCounters'>>> = NOTHING;
    const tally = new Map<string, number>();
    for (const kind of Object.keys(kinds).sort()) {
      const r = putCounters(cx, { ...base, kind, count: ofEvent === 'same' ? kinds[kind]! : 1 }) as { countersPut?: Map<string, number> };
      for (const [k, v] of r.countersPut ?? []) tally.set(k, (tally.get(k) ?? 0) + v);
      last = r as typeof last;
    }
    return tally.size === 0 ? last : { ...last, countersPut: tally };
  }
  // edh-perms-15 (CR 122.1, 608.2d): "put another counter of that kind": the kind chosen earlier in this resolution; none chosen (the holder had no counters): nothing happens
  let st = rawStep;
  if (rawStep.kindOfChoice !== undefined) {
    const kind = cx.choices?.get(rawStep.kindOfChoice)?.values?.[0];
    if (kind === undefined) return NOTHING;
    st = { ...rawStep, kind };
    // edh-d-89 (CR 122.1, 608.2c; Aven Courier): "if it doesn't have a counter of that kind on it": a recipient that has one gets none (judged as the counter would be put)
    if (rawStep.ifNone === true) {
      const without = holders(cx, rawStep.on).filter((h) => (countersOn(cx, h)[kind] ?? 0) === 0);
      if (without.length === 0) return NOTHING;
    }
  }
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
  // edh-players-19 (CR 122.6, 608.2d): "target player puts a +1/+1 counter on each creature they control": the player the step names puts them (events read `by`)
  let putter: PlayerId | undefined;
  if (st.by !== undefined) {
    const named = resolvePlayers(cx, st.by);
    if (named.length !== 1) return NOTHING; // no such player (an illegal target), or not one player: the instruction is not carried out (CR 608.2b)
    putter = named[0]!;
  }
  const performer = cx.performer;
  if (putter !== undefined) cx.performer = putter;
  try {
  const acted: Holder[] = [];
  const tally = new Map<string, number>(); // trek-6 (CR 122.6, 608.2c): what was actually put, for "if you put two or more +1/+1 counters on creatures this way"
  for (const { to, amount } of shares) { // 4. act (CR 122.6: a replacement may modify it)
    if (amount <= 0 || !canHold(cx, to)) continue;
    const put = proposeMeasured(cx, { ev: 'counters', change: 'put', on: to, kind: st.kind, count: amount });
    if (put <= 0) continue;
    tally.set(st.kind, (tally.get(st.kind) ?? 0) + put);
    acted.push(to);
    cx.g.log(`${counterWords(put, st.kind)} put on ${holderName(cx, to)}.`, { rules: ['CR 122.1', 'CR 122.6', ...(amount !== n ? ['CR 601.2d'] : [])], level: 'action' });
  }
  // edh-c-48 (CR 702.100a; Renegade Krasis ruling 2013-04-15): the creature evolves when its evolve ability puts a +1/+1 counter on it (once, however many a replacement made it)
  if (st.evolve === true) for (const h of acted) if (typeof h !== 'string') performAction(cx.g, { verb: 'evolve', actor: cx.controller, objectId: h.id });
  return { ...recordActed(cx, st.as, acted), countersPut: tally }; // 5. record
  } finally {
    if (performer === undefined) delete cx.performer;
    else cx.performer = performer;
  }
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
  'op:moveCounters.anyKind' /* p2-counters-move-1 */, 'op:moveCounters.upTo' /* p2-counters-move-1 */, 'op:moveCounters.distribute' /* p2-counters-move-4 */,
  'op:moveCounters.among', 'op:moveCounters.eachNewKind', 'op:moveCounters.atLeastOne' /* edh-misc-6 */, 'op:putCounters.kindOfChoice' /* edh-perms-15 */, 'op:putCounters.by' /* edh-players-19 */, 'op:removeCounters.kindOfChoice' /* edh-perms-24 */, 'op:putCounters.evolve' /* edh-c-48 */, 'op:moveCounters.fromGroup' /* edh-c-27 */, 'op:removeCounters.among' /* edhn63 */, 'op:putCounters.ofEvent' /* edhn63 */, 'op:putCounters.copyFrom' /* edhn63 */,
  'op:putCounters.ifNone', // edh-d-89: CR 122.1, 608.2c ("if it doesn't have a counter of that kind on it")
];

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

/**
 * edhn63 (CR 122.1, 608.2d; capability `op:removeCounters.among`): "remove any number of +1/+1 counters from among creatures you control" (Galloping Lizrog),
 * "remove up to three stun counters from among all permanents" (Sensational Spider-Man), "remove three quest counters from among permanents you control"
 * (Overseer of Vault 76): `count` is the total over the whole group. The controller chooses how many (an "up to" or "any number"), then which permanent (and which
 * kind, for `kind: 'any'`) gives each counter; a choice is asked only when there is one. A fixed count the group can't supply removes none (the Overseer ruling: exactly that many); "up to" takes what there is.
 */
function removeAmong(cx: ExecCtx, st: Step<'removeCounters'>): ReturnType<StepHandler<Step<'removeCounters'>>> {
  const n = st.count === 'all' ? 'all' : amountOf(cx, st.count);
  if (n === undefined || n === 0) return NOTHING;
  const group = holders(cx, st.from).filter((h): h is ObjHandle => typeof h !== 'string');
  const slots: { on: ObjHandle; kind: string; have: number }[] = [];
  for (const on of group) {
    const present = countersOn(cx, on);
    for (const kind of Object.keys(present)) {
      if (st.kind !== 'any' && kind !== st.kind) continue;
      const have = countOf(present, kind);
      if (have > 0) slots.push({ on, kind, have });
    }
  }
  if (slots.length === 0) return NOTHING;
  const total = slots.reduce((a, b) => a + b.have, 0);
  const take = new Map<number, number>(); // slot index -> counters to remove
  if (n === 'all') {
    // "any number": one question per member and kind (there is no total to keep)
    slots.forEach((sl, i) => {
      const k = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Remove how many ${sl.kind} counters from ${holderName(cx, sl.on)}? (up to ${sl.have})`, min: 0, max: sl.have, rules: ['CR 122.1', 'CR 608.2d'] }).n;
      if (k > 0) take.set(i, Math.max(0, Math.min(k, sl.have)));
    });
  } else {
    // an exact count the group can't supply is not done (Overseer of Vault 76 ruling 2024-03-08: "exactly three quest counters"; CR 608.2d); "up to" takes what there is
    if (st.upTo !== true && total < n) return NOTHING;
    let want = Math.min(n, total);
    if (st.upTo === true && want > 0) want = Math.max(0, Math.min(want, cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Remove how many counters from among ${group.map((h) => holderName(cx, h)).join(', ')}? (up to ${want})`, min: 0, max: want, rules: ['CR 122.1', 'CR 608.2d'] }).n));
    const left = slots.map((sl) => sl.have);
    for (let i = 0; i < want; i++) {
      const open = slots.map((_, j) => j).filter((j) => left[j]! > 0);
      let pick = open[0]!;
      if (open.length > 1 && want < total) {
        const ans = cx.g.choose({
          kind: 'chooseOption', player: cx.controller, min: 1, max: 1, prompt: `Choose a counter to remove (${i + 1} of ${want}).`,
          options: open.map((j) => ({ id: String(j), label: `${slots[j]!.kind} on ${holderName(cx, slots[j]!.on)} (${left[j]})` })), rules: ['CR 122.1', 'CR 608.2d'],
        });
        const j = Number(ans.ids[0]);
        if (open.includes(j)) pick = j;
      }
      left[pick]! -= 1;
      take.set(pick, (take.get(pick) ?? 0) + 1);
    }
  }
  const acted: Holder[] = [];
  const tally = new Map<string, number>();
  for (const [i, count] of take) {
    const sl = slots[i]!;
    const took = proposeMeasured(cx, { ev: 'counters', change: 'removed', on: sl.on, kind: sl.kind, count, by: cx.controller });
    if (took <= 0) continue;
    tally.set(sl.kind, (tally.get(sl.kind) ?? 0) + took);
    if (!acted.some((h) => typeof h !== 'string' && h.id === sl.on.id)) acted.push(sl.on);
    cx.g.log(`${counterWords(took, sl.kind)} removed from ${holderName(cx, sl.on)}.`, { rules: ['CR 122.1'], level: 'action' });
  }
  return { ...recordActed(cx, st.as, acted), countersRemoved: tally };
}

const removeCounters: StepHandler<Step<'removeCounters'>> = (cx, rawStep) => {
  // edh-perms-24 (CR 122.1, 608.2d; Clockspinning): "remove that counter": the kind chosen earlier in this resolution; none chosen (the holder had no counters): nothing happens
  let st = rawStep;
  if (rawStep.kindOfChoice !== undefined) {
    const kind = cx.choices?.get(rawStep.kindOfChoice)?.values?.[0];
    if (kind === undefined) return NOTHING;
    st = { ...rawStep, kind };
  }
  if (st.among === true) return removeAmong(cx, st); // edhn63
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
      // edhd68 (CR 603.2c, 702.62a; Watcher of Hours, Amy Pond): time counters come off one at a time, so "whenever you remove a time counter" triggers once for each
      let took = 0;
      if (kind === 'time' && count > 1) { for (let i = 0; i < count; i++) { const t = proposeMeasured(cx, { ev: 'counters', change: 'removed', on, kind, count: 1, by: cx.controller }); took += t; if (t === 0) break; } }
      else took = count > 0 ? proposeMeasured(cx, { ev: 'counters', change: 'removed', on, kind, count, by: cx.controller }) : 0;
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
  if (st.distribute === true) return moveDistributed(cx, st); // p2-counters-move-4
  if (st.among === true) return moveAmong(cx, st); // edh-misc-6
  if (st.kind === 'any' || st.upTo === true || st.eachNewKind === true) return moveEveryCounter(cx, st);
  const n = st.count === 'all' ? 'all' : amountOf(cx, st.count); // 1. evaluate
  if (n === undefined || n === 0) return NOTHING;
  const froms = resolveObjs(cx, st.from); // 2. resolve
  const tos = resolveObjs(cx, st.to);
  // edh-c-27 (CR 122.5, 608.2h; Spike Cannibal; capability `op:moveCounters.fromGroup`): "move all +1/+1 counters from all creatures onto it": every counter of the one kind on each object of
  // the group, in the order the group lists them, moved one object at a time (each all or nothing), onto the one receiver
  if (froms.length > 1 && tos.length === 1 && st.count === 'all' && st.upTo !== true) return moveFromGroup(cx, st, froms, tos[0]!);
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
  // edh-d-93 (CR 122.5, 608.2c; Black Panther, Wakandan King): the counters moved are the counters taken from the first object (`count`: removed, or the number it had for CR 122.8/122.9),
  // never the extra ones a replacement of the put adds (review finding: Hardened Scales); read by "If one or more +1/+1 counters are moved this way, ... that much"
  return { ...recordActed(cx, st.as, moved > 0 ? [to] : []), ...(moved > 0 ? { countersPut: new Map([[st.kind, count]]) } : {}) }; // 5. record
};

/**
 * edh-c-27: the group form of the move of every counter of one kind (CR 122.5, 608.2c): each giver on the battlefield other than the receiver loses all of that kind, then ONE put of the
 * total goes onto the receiver (a replacement of the put, "that many plus one", applies once; review finding).
 */
function moveFromGroup(cx: ExecCtx, st: Step<'moveCounters'>, froms: ObjHandle[], to: ObjHandle): ReturnType<StepHandler<Step<'moveCounters'>>> {
  if (st.kind === 'any' || !isCurrent(cx, to)) return NOTHING;
  if (forbidden(cx.g, { ev: 'counters', change: 'put', on: to, kind: st.kind, count: 1 })) return NOTHING; // CR 614.17: if the put can't happen, nothing is removed
  let total = 0;
  for (const from of froms) {
    if (from.id === to.id || !isCurrent(cx, from) || from.zone !== 'battlefield') continue; // CR 122.5: the same object, or one that left
    const have = countOf(countersOn(cx, from), st.kind);
    if (have <= 0) continue;
    const removal: Proposed = { ev: 'counters', change: 'removed', on: from, kind: st.kind, count: have };
    if (forbidden(cx.g, removal)) continue;
    const removed = proposeMeasured(cx, removal);
    if (removed > 0) {
      total += removed;
      cx.g.log(`${counterWords(removed, st.kind)} removed from ${cx.g.nameOf(from.id)} to be moved onto ${cx.g.nameOf(to.id)}.`, { rules: ['CR 122.5'], level: 'action' });
    }
  }
  if (total <= 0 || !isCurrent(cx, to)) return recordActed(cx, st.as, []);
  const moved = proposeMeasured(cx, { ev: 'counters', change: 'put', on: to, kind: st.kind, count: total });
  if (moved > 0) cx.g.log(`${counterWords(moved, st.kind)} put on ${cx.g.nameOf(to.id)}.`, { rules: ['CR 122.5', 'CR 122.1'], level: 'action' });
  return recordActed(cx, st.as, moved > 0 ? [to] : []);
}

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
  const plan = movePlan(cx, st, cx.g.nameOf(from.id), had, n, countersOn(cx, to)); // 3. decide before anything changes (design 8.6)
  const movedAny = applyMovePlan(cx, from, to, plan, left);
  return recordActed(cx, st.as, movedAny ? [to] : []);
}

/**
 * Moves what `plan` says (kind -> number, in a fixed kind order) from `from` onto `to`, each kind on its own and all or nothing (CR 122.5: a kind that can't be
 * removed or put stays where it is). `left` is the last known information of a giver that left the battlefield (CR 122.8, 122.9: the same number is put without a
 * removal). True when some counter moved.
 */
function applyMovePlan(cx: ExecCtx, from: ObjHandle, to: ObjHandle, plan: Record<string, number>, left: Exclude<ReturnType<typeof leftWithCounters>, 'ask'>): boolean {
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
  return movedAny;
}

/**
 * p2-counters-move-1 (CR 122.5, 608.2d; cites unverified): which counters of `had` (the first object's counters, or the ones it had when it left) a move takes,
 * kind -> number, in a fixed kind order (design 8.8 rule 1):
 *  - `count: 'all'`: every counter of the step's kind, or of every kind for `kind: 'any'` ("put its counters on", "move all counters from");
 *  - `upTo` with `count: 'all'`: "move any number of [<kind>] counters": for each kind there, how many, from none to all (no total to keep, so one question per kind);
 *  - a number with `kind: 'any'`: "move a counter / two counters": the kind of each counter in turn, asked only when there is more than one kind left; with `upTo`
 *    the controller may also stop. You can't move counters that aren't there (CR 122.5), so the plan never exceeds `had`.
 */
function movePlan(cx: ExecCtx, st: Step<'moveCounters'>, fromName: string, had: Record<string, number>, n: number | 'all', toHas: Record<string, number> = {}): Record<string, number> {
  const kinds = Object.keys(had).filter((k) => had[k]! > 0 && (st.kind === 'any' || k === st.kind));
  // edh-misc-6 (CR 122.5, 608.2d): "move a counter of each kind not on <the receiver>": one of every kind the giver has and the receiver lacks as the step begins
  if (st.eachNewKind === true) return Object.fromEntries(kinds.filter((k) => (toHas[k] ?? 0) === 0).map((k) => [k, 1]));
  if (n === 'all' && st.upTo !== true) return Object.fromEntries(kinds.map((k) => [k, had[k]!]));
  const plan: Record<string, number> = {};
  if (n === 'all') {
    for (const [i, kind] of kinds.entries()) {
      const have = had[kind]!;
      // edh-misc-6 (CR 608.2d): "move one or more counters": at least one in all, so the last kind can't be refused when nothing else moves
      const least = st.atLeastOne === true && i === kinds.length - 1 && Object.keys(plan).length === 0 ? 1 : 0;
      const take = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Move how many ${kind} counters from ${fromName}? (${least === 1 ? 'at least 1, ' : ''}up to ${have})`, min: least, max: have, rules: ['CR 122.5', 'CR 608.2d'] }).n;
      const t = Math.max(least, Math.min(take, have));
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

/**
 * edh-misc-6 (CR 122.5, 608.2d; capability `op:moveCounters.among`): "move any number of counters from among creatures you control onto that creature" (Slippery
 * Bogbonder). One object receives, a group gives: for each giver in turn (the receiver gives none, 122.5) the controller chooses how many counters of each kind it
 * gives, none to all; everything is decided first (design 8.6), then each giver's counters move on their own, each kind all or nothing.
 */
function moveAmong(cx: ExecCtx, st: Step<'moveCounters'>): ReturnType<StepHandler<Step<'moveCounters'>>> {
  // edhn63: also a named kind ("move any number of +1/+1 counters from other permanents you control onto this creature"; movePlan keeps to the kind)
  if (st.upTo !== true || st.count !== 'all') return askManual(cx, st.span ?? 'Move the counters.', 'counters moved from among a group other than any number of counters (CR 122.5)');
  const tos = resolveObjs(cx, st.to);
  if (tos.length > 1) return askManual(cx, st.span ?? 'Move the counters.', 'counters are moved onto more than one object (CR 122.5)');
  const to = tos[0];
  if (!to || !isCurrent(cx, to)) return NOTHING; // an illegal target, or an object that left (CR 608.2b, 400.7)
  const givers = resolveObjs(cx, st.from).filter((h) => h.id !== to.id && isCurrent(cx, h) && h.zone === 'battlefield');
  const plans = givers.map((from) => ({ from, plan: movePlan(cx, st, cx.g.nameOf(from.id), countersOn(cx, from), 'all') }));
  let movedAny = false;
  for (const { from, plan } of plans) if (Object.keys(plan).length > 0 && isCurrent(cx, from) && applyMovePlan(cx, from, to, plan, undefined)) movedAny = true;
  return recordActed(cx, st.as, movedAny ? [to] : []);
}

/**
 * p2-counters-move-4 (CR 122.5, 608.2d; cites unverified): "you may move any number of +1/+1 counters from ~ onto other creatures" (Forgotten Ancient). One object
 * gives, a group receives: the controller chooses how many counters of the step's kind move (none to all it has, `upTo` with `count: 'all'`; a number caps it), then
 * which objects of the group get them (one to that many) and how many each gets, at least one (as a distribution, std-rx26). Each share is one move, all or nothing
 * (CR 122.5); a share whose object left or is the giver itself moves nothing. Only a fixed kind and a giver on the battlefield: anything else is asked by hand.
 */
function moveDistributed(cx: ExecCtx, st: Step<'moveCounters'>): ReturnType<StepHandler<Step<'moveCounters'>>> {
  if (st.kind === 'any') return askManual(cx, st.span ?? 'Move the counters.', 'counters of any kind divided among a group (CR 122.5)');
  const cap = st.count === 'all' ? 'all' : amountOf(cx, st.count); // 1. evaluate
  if (cap === undefined || cap === 0) return NOTHING;
  const froms = resolveObjs(cx, st.from); // 2. resolve
  if (froms.length !== 1) return askManual(cx, st.span ?? 'Move the counters.', 'counters divided from more than one object (CR 122.5)');
  const from = froms[0]!;
  if (!isCurrent(cx, from) || from.zone !== 'battlefield') return NOTHING; // CR 122.5: no longer in the correct zone
  const among = resolveObjs(cx, st.to).filter((h) => isCurrent(cx, h) && h.id !== from.id);
  const have = countOf(countersOn(cx, from), st.kind);
  const most = cap === 'all' ? have : Math.min(cap, have);
  if (most === 0 || among.length === 0) return NOTHING;
  let n = most;
  if (st.upTo === true) { // 3. decide: how many, then where (design 8.6)
    n = cx.g.choose({ kind: 'chooseNumber', player: cx.controller, prompt: `Move how many ${st.kind} counters from ${cx.g.nameOf(from.id)}? (up to ${most})`, min: 0, max: most, rules: ['CR 122.5', 'CR 608.2d'] }).n;
    n = Math.max(0, Math.min(n, most));
    if (n === 0) return NOTHING;
  }
  const max = Math.min(n, among.length);
  const ids = cx.g.choose({ kind: 'chooseObjects', player: cx.controller, prompt: `Move ${counterWords(n, st.kind)} onto which of them? Choose 1 to ${max}.`, options: among.map((h) => h.id), min: 1, max, rules: ['CR 122.5', 'CR 608.2d'] }).ids;
  const chosen = among.filter((h) => ids.includes(h.id));
  if (chosen.length === 0) return NOTHING;
  const amounts = chosen.length === 1 ? [n] : cx.g.choose({
    kind: 'chooseDivision', player: cx.controller, prompt: `Divide ${counterWords(n, st.kind)} among ${chosen.map((h) => cx.g.nameOf(h.id)).join(', ')}; each gets at least 1.`, what: 'counters', total: n,
    targets: chosen.map((h) => ({ id: h.id, label: cx.g.nameOf(h.id) })), rules: ['CR 608.2d', 'CR 122.5'],
  }).amounts;
  const acted: ObjHandle[] = [];
  chosen.forEach((to, i) => { // 4. act: each share is one move, all or nothing
    const want = Math.max(0, Math.min(amounts[i] ?? 0, countOf(countersOn(cx, from), st.kind)));
    if (want === 0 || !isCurrent(cx, to) || !isCurrent(cx, from)) return;
    const removal: Proposed = { ev: 'counters', change: 'removed', on: from, kind: st.kind, count: want };
    const put: Proposed = { ev: 'counters', change: 'put', on: to, kind: st.kind, count: want };
    if (forbidden(cx.g, put) || forbidden(cx.g, removal)) {
      cx.g.log(`No ${st.kind} counters are moved onto ${cx.g.nameOf(to.id)}: one of the two actions can't happen.`, { rules: ['CR 122.5', 'CR 614.17'], level: 'action' });
      return;
    }
    const removed = proposeMeasured(cx, removal);
    if (removed <= 0) return;
    const moved = proposeMeasured(cx, { ...put, count: removed });
    if (moved <= 0) return;
    acted.push(to);
    cx.g.log(`${counterWords(moved, st.kind)} moved from ${cx.g.nameOf(from.id)} onto ${cx.g.nameOf(to.id)}.`, { rules: ['CR 122.5', 'CR 122.1'], level: 'action' });
  });
  return recordActed(cx, st.as, acted); // 5. record
}

export const COUNTERS_HANDLERS: OpHandlers = {
  putCounters,
  removeCounters,
  moveCounters,
};
