/**
 * Op handlers: damage and life (CR 119, 120, 701.14). Owner: WP12. Every handler has the five stages of design 8.6: evaluate the quantities (an `undefined`
 * amount "fails to determine" and the step does nothing, CR 608.2b), resolve the references (legal targets only; last known information for a source that
 * left, CR 608.2h), decide (nothing here: a division was announced with the spell, CR 601.2d), act ONLY through `propose` (the performers call
 * rules/damage.ts#dealDamage and rules/life.ts, design 8.5), and record the result.
 *
 * `StepResult.count` is the number of objects and players the step ACTUALLY affected (design 8.3: the events that happened; exactly what `as` binds, and
 * what the renderer prints for `q:'resultCount'`, "the number of <them>"). What happened is read from the events the performers emitted (`proposeMeasured`),
 * so damage prevented by protection or a shield (CR 702.16e, 615) and life a player can't lose (CR 119.8) are not counted, and `performed` (`cond:'did'`) is
 * false when none of it happened. An amount reading ("the damage dealt this way") is not what `count` means; it has no quantity yet.
 * The capability `op:<op>` exists because the op has a handler here AND a renderer (design 5.2).
 * Ops: damage gainLife loseLife setLife fight.
 */
import type { EffectStep, Name, ObjRef, PlayerRef, Quantity, Ref } from '../../types/ability';
import type { GameEvent } from '../../types/events';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { LastKnown, ObjHandle } from '../../types/state';
import { charsOfObject, ptNumbers } from '../../rules/characteristics';
import { excessDamageToCreature, type LifelinkLedger } from '../../rules/damage';
import { radiationGainsLife } from '../../statics/hooks'; // edh-next-93
import type { ExecCtx, OpHandlers, Proposed, StepHandler, StepResult } from '../api';
import { evalQty } from '../eval';
import { askManual, notesOf } from '../manual';
import { propose } from '../propose';
import { isCurrent, readInfo, resolveObjs, resolvePlayers, resolveRecipients } from '../refs';
import { performAction } from '../perform'; // edh-combat-6
import { readFor, readsEachPlayer } from './cards-util';
import { inDamageBatch } from '../damage-batch';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

/** The step did nothing (nothing to act on, or an amount that fails to determine, CR 608.2b). */
export const NOTHING: StepResult = { performed: false, count: 0 };

/**
 * An amount of damage, life or counters: `undefined` when it fails to determine (CR 608.2b), otherwise a whole number that is never negative
 * (CR 107.1b: "if a calculation that would determine the result of an effect yields a negative number, zero is used instead"; effects/eval.ts keeps the
 * sign for comparisons, so every handler clamps).
 */
export function amountOf(cx: ExecCtx, q: Quantity): number | undefined {
  const n = evalQty(cx, q);
  if (n === undefined || Number.isNaN(n)) return undefined;
  return Math.max(0, Math.floor(n));
}

/** Bind `as` to what the step acted on, so a later "it" / "that player" can refer to it (design 2.3 `StepBase.as`). Snapshots keep last known information. */
export function bindActed(cx: ExecCtx, as: Name | undefined, objects: ObjHandle[], players: PlayerId[]): void {
  if (!as) return;
  const snapshots: Record<string, LastKnown> = {};
  for (const h of objects) {
    const info = readInfo(cx, h);
    if (info) snapshots[h.id] = info;
  }
  cx.bindings.set(as, { objects, players, snapshots });
}

/** The step's result from what it acted on: `count` is how many distinct objects and players (design 8.3), and they are bound to `as`. */
export function recordActed(cx: ExecCtx, as: Name | undefined, acted: (ObjHandle | PlayerId)[]): StepResult {
  const objects: ObjHandle[] = [];
  const players: PlayerId[] = [];
  for (const r of acted) {
    if (typeof r === 'string') {
      if (!players.includes(r)) players.push(r);
    } else if (!objects.some((h) => h.id === r.id)) objects.push(r);
  }
  bindActed(cx, as, objects, players);
  const count = objects.length + players.length;
  return { performed: count > 0, count };
}

const idOf = (r: ObjHandle | PlayerId): ObjectId | PlayerId => (typeof r === 'string' ? r : r.id);

/** How much of `e` the engine event `x` says happened (the performers emit `damageDealt`, `lifeChanged` and `countersChanged`, design 8.5). */
function measure(e: Proposed, x: GameEvent): number {
  switch (e.ev) {
    case 'damage': return x.type === 'damageDealt' && x.target === idOf(e.to) ? x.amount : 0;
    case 'life': return x.type === 'lifeChanged' && x.player === e.player && (e.change === 'gain' ? x.delta > 0 : x.delta < 0) ? Math.abs(x.delta) : 0;
    case 'counters':
      return x.type === 'countersChanged' && x.target === idOf(e.on) && x.counter === e.kind && (e.change === 'put' ? x.delta > 0 : x.delta < 0) ? Math.abs(x.delta) : 0;
    default: return 0;
  }
}

/**
 * Propose `e` and return how much of it actually happened: 0 when the pipeline stopped it, otherwise what the performer did as its emitted events say
 * (a prevention shield may have lowered the damage to 0, protection prevents it inside dealDamage, CR 702.16e; "can't lose life" leaves the life total
 * alone, CR 119.8). Events are append-only, so the ones after the mark are this proposal's.
 */
export function proposeMeasured(cx: ExecCtx, e0: Proposed): number {
  // FAST5X E21 (CR 122.6, 608.2): the controller of the resolving spell or ability is the player who puts the counters its instructions put; std-rq (CR 608.2d):
  // the player of a `may` of one other player who puts them in the optional instructions ("that player may put a +1/+1 counter on ~")
  const e: Proposed = e0.ev === 'counters' && e0.change === 'put' && e0.by === undefined ? { ...e0, by: cx.performer ?? cx.controller } : e0;
  const mark = cx.g.events.length;
  if (!propose(cx.g, e)) return 0;
  let n = 0;
  for (let i = mark; i < cx.g.events.length; i++) n += measure(e, cx.g.events[i]!);
  return n;
}

/**
 * FAST5X E16 (CR 120.4a, 120.10, 608.2c): the excess damage the damage events emitted since `mark` by one of `sources` dealt to each permanent (rules/damage.ts
 * computes it as each part of the event is dealt), summed per permanent: what "the excess damage dealt [to that creature] this way" reads. Damage that was
 * prevented was not dealt (CR 120.4b): it has no event and no excess.
 */
function excessSince(cx: ExecCtx, mark: number, sources: ReadonlySet<ObjectId>): Map<ObjectId, number> {
  const out = new Map<ObjectId, number>();
  for (let i = mark; i < cx.g.events.length; i++) {
    const ev = cx.g.events[i]!;
    if (ev.type !== 'damageDealt' || ev.excess === undefined || !sources.has(ev.source)) continue;
    out.set(ev.target, (out.get(ev.target) ?? 0) + ev.excess);
  }
  return out;
}

/** std-rx20 (CR 120.3, 120.4b, 608.2c): the damage the damage events emitted since `mark` by one of `sources` dealt, summed: what "the damage dealt this way" reads. */
function dealtSince(cx: ExecCtx, mark: number, sources: ReadonlySet<ObjectId>): number {
  let n = 0;
  for (let i = mark; i < cx.g.events.length; i++) {
    const ev = cx.g.events[i]!;
    if (ev.type === 'damageDealt' && sources.has(ev.source)) n += ev.amount;
  }
  return n;
}

const nameOfRecipient = (cx: ExecCtx, r: ObjHandle | PlayerId): string => (typeof r === 'string' ? cx.g.player(r).name : cx.g.nameOf(r.id));

// ---- damage (CR 120) -------------------------------------------------------------------------------------------------------------------------------------

/** One recipient of a step and the amount it is to get (damage, or counters for a division of counters). */
export interface Share {
  to: ObjHandle | PlayerId;
  amount: number;
}

/**
 * The shares of a division announced on casting (CR 601.2d: "divide or distribute an effect (such as damage or counters)"): `StackInfo.division[specId]`,
 * parallel to the chosen targets. A target that is illegal on resolution is not affected (CR 608.2b): its share is lost, never given to the others.
 * No target chosen ("any number of targets", zero picked: CR 601.2c) is no share at all. A single target with no recorded division gets all of `total`.
 * Returns `null` when the division is missing for several targets: the caller asks the players (never guesses).
 */
export function announcedShares(cx: ExecCtx, specId: string, total: number): Share[] | null {
  const slots = cx.targets.get(specId) ?? [];
  if (slots.length === 0) return [];
  const division = cx.stack?.division?.[specId] ?? (slots.length === 1 ? [total] : undefined);
  if (!division || division.length !== slots.length) return null;
  const out: Share[] = [];
  slots.forEach((slot, i) => {
    if (!slot.legal) return; // CR 608.2b: the share of an illegal target is lost
    const to = slot.player ?? slot.handle;
    if (to) out.push({ to, amount: Math.max(0, division[i] ?? 0) });
  });
  return out;
}

/**
 * How a damage step's total is split among its recipients.
 *
 *  - no division: every recipient is dealt the whole amount ("deals 3 damage to each creature").
 *  - `announced` ("divided as you choose", CR 601.2d): `announcedShares`.
 *  - `evenlyRoundDown` / `evenlyRoundUp` ("divided evenly, rounded down", Fireball): computed on resolution among the targets that are STILL LEGAL.
 *    Pinned ruling 15.3 #1, checked against Fireball's Gatherer rulings of 2017-11-17 (source wotc, read through the Scryfall API
 *    api.scryfall.com/cards/df45a43e-a5b7-4fd4-873b-7b3c021be198/rulings): "The division involves only targets that are still legal as Fireball resolves",
 *    and "if the number of legal targets at the time Fireball resolves is greater than X, none of them will be dealt any damage". The design's
 *    provisional default (divide by the number announced) was the other answer; switching is the one line marked below.
 *
 * Returns `null` when the step cannot be split as written (an `announced` division with no announced amounts): the caller asks the players (never guesses).
 */
/**
 * The recipients of damage. std-rx19 (CR 506.2, 508.1b): the defender of an attack ("the player or planeswalker it's attacking") is the planeswalker or battle that
 * was attacked, else the player: never also the attacked permanent's controller, which reading the role as a player gives (effects/refs.ts#resolvePlayers, CLOUD
 * std-misc: "defending player" read through the role in a filter or a count still means that player).
 */
function damageRecipients(cx: ExecCtx, to: Step<'damage'>['to']): ReturnType<typeof resolveRecipients> {
  const r = resolveRecipients(cx, to);
  const ev = to as { ref: string; role?: string };
  return ev.ref === 'event' && ev.role === 'defender' && r.objects.length > 0 ? { objects: r.objects, players: [] } : r;
}

export function splitAmount(cx: ExecCtx, st: Step<'damage'>, total: number): Share[] | null {
  const how = st.divided;
  if (how === 'bySourceController') return dividedBySourceController(cx, st, total);
  if (how === 'announced') return st.to.ref === 'target' ? announcedShares(cx, st.to.id, total) : null;
  const r = damageRecipients(cx, st.to); // legal targets only (CR 608.2b)
  const recipients: (ObjHandle | PlayerId)[] = [...r.objects, ...r.players];
  if (how === undefined) return recipients.map((to) => ({ to, amount: total }));
  const n = recipients.length; // pinned ruling 15.3 #1: the targets still legal. (To divide by the number announced instead: `cx.targets.get(st.to.id)?.length`.)
  if (n === 0) return [];
  const each = how === 'evenlyRoundDown' ? Math.floor(total / n) : Math.ceil(total / n);
  return recipients.map((to) => ({ to, amount: each }));
}

/**
 * edh-next-139 (CR 608.2d, 120.2b, 120.3; Master of the Wild Hunt rulings 2018-03-16): `bySourceController`, "That creature deals damage equal to its power divided as its controller
 * chooses among any number of those Wolves": the damage is divided as the step resolves (not announced: the recipients are no targets), by the controller of the source (its last known
 * controller when it has left), among the recipients still there, each getting 0 or more and all of it given out. No recipient: no damage. More than one source: by hand.
 */
function dividedBySourceController(cx: ExecCtx, st: Step<'damage'>, total: number): Share[] | null {
  const sources = resolveObjs(cx, st.source);
  if (sources.length !== 1) return null;
  const src = sources[0]!;
  const r = damageRecipients(cx, st.to);
  const recipients: (ObjHandle | PlayerId)[] = [...r.objects.filter((h) => isCurrent(cx, h)), ...r.players];
  if (recipients.length === 0 || total <= 0) return [];
  const o = cx.g.maybeObj(src.id) ?? cx.g.s.lki[src.id]?.object;
  if (o === undefined) return null;
  const idOf = (x: ObjHandle | PlayerId): string => (typeof x === 'string' ? x : x.id);
  if (recipients.length === 1) return [{ to: recipients[0]!, amount: total }];
  const ans = cx.g.choose({
    kind: 'assignDamage', player: o.controller, prompt: `${notesOf(cx).sourceName}: divide ${total} damage from ${cx.g.nameOf(src.id)} among ${recipients.length} creatures.`,
    attacker: src.id, amount: total, recipients: recipients.map((x) => ({ id: idOf(x), lethal: 0 })), canTrample: false, rules: ['CR 608.2d', 'CR 120.2b'],
  });
  return recipients.map((to) => ({ to, amount: ans.amounts.find((a) => a.id === idOf(to))?.amount ?? 0 }));
}

/**
 * CR 120.3f, 702.15e: the damage of one step is one damage event, so each lifelink source's controller gains the life of ALL its damage as ONE life gain
 * (the performer collected it in the shared ledger instead of gaining it per recipient). The gain is proposed like any life gain, so "can't gain life"
 * and life-gain replacements apply to it (CR 119.7, 120.4c).
 */
export function settleLifelink(cx: ExecCtx, ledger: LifelinkLedger): void {
  for (const { controller, name, amount } of ledger.values()) {
    if (amount <= 0 || cx.g.player(controller).hasLost) continue;
    const gained = proposeMeasured(cx, { ev: 'life', change: 'gain', player: controller, amount });
    if (gained > 0) cx.g.log(`${cx.g.player(controller).name} gains ${gained} life from ${name}'s lifelink, once for all its damage.`, { rules: ['CR 120.3f', 'CR 702.15e'], level: 'action' });
  }
  ledger.clear();
}

/**
 * FAST2 T8: the recipients of `also`, each dealt its own amount by the same source in the same damage event as `to` ("~ deals 1 damage to each creature
 * and each player", "... and 2 damage to you"; CR 120.2b, 120.3f). An amount that fails to determine gives that part nothing (CR 608.2b); recipients are the
 * legal targets and the objects still there, as for `to`.
 */
function alsoShares(cx: ExecCtx, st: Step<'damage'>): Share[] {
  const out: Share[] = [];
  for (const a of st.also ?? []) {
    const amount = amountOf(cx, a.amount);
    if (amount === undefined) continue;
    const r = damageRecipients(cx, a.to);
    for (const to of [...r.objects, ...r.players]) out.push({ to, amount });
  }
  return out;
}

/**
 * FAST5 T49 (CR 120.1, 120.3, 120.2b, 608.2h): `perSource`, "creatures each deal damage equal to their power to ...": every source of the group deals its OWN
 * amount (read with `{ref:'subject'}` standing for that source), all amounts read before any damage is dealt, and everything is dealt as one simultaneous
 * event. A source that is not there deals nothing (CR 608.2b); an amount that fails to determine for one source gives that source nothing.
 */
function damagePerSource(cx: ExecCtx, st: Step<'damage'>): StepResult {
  const sources = resolveObjs(cx, st.source);
  if (sources.length === 0) return NOTHING;
  const before = cx.subject;
  // p2-damage-1 (CR 120.3, 109.4): the recipients are read with that source as the subject too ("each creature deals 1 damage to its controller"), all before any damage
  const amounts: { source: ObjHandle; shares: NonNullable<ReturnType<typeof splitAmount>> }[] = [];
  try {
    for (const source of sources) {
      cx.subject = source;
      const total = amountOf(cx, st.amount);
      const shares = total === undefined ? null : splitAmount(cx, st, total);
      if (shares !== null) amounts.push({ source, shares });
    }
  } finally {
    if (before === undefined) delete cx.subject;
    else cx.subject = before;
  }
  const ledger: LifelinkLedger = new Map();
  const hit: (ObjHandle | PlayerId)[] = [];
  const first = cx.g.events.length;
  for (const { source, shares } of amounts) {
    for (const { to, amount } of shares) {
      if (amount <= 0) continue; // CR 120.8
      if (typeof to !== 'string' && !isCurrent(cx, to)) continue; // it left (CR 400.7)
      const dealt = proposeMeasured(cx, { ev: 'damage', source, to, amount, combat: false, unpreventable: st.unpreventable === true, lifelink: ledger });
      if (dealt > 0) hit.push(to);
    }
  }
  for (const ev of cx.g.events.slice(first)) if (ev.type === 'damageDealt') ev.group = first;
  settleLifelink(cx, ledger);
  return recordActed(cx, st.as, hit);
}

/**
 * edh-replace-4 (CR 120.4a, 120.10; Ram Through): `excessToController`: the share of each creature recipient is cut into the damage up to lethal (to the creature) and
 * the excess (to the creature's controller), both dealt in the same damage event. Lethal and excess are read before any replacement or prevention effect (the ruling of
 * 2020-04-17), so a creature protected from the source still has its excess dealt to its controller. A recipient that is not a creature gets its whole share.
 */
function excessShares(cx: ExecCtx, source: ObjHandle, shares: Share[]): Share[] {
  const out: Share[] = [];
  for (const sh of shares) {
    if (typeof sh.to === 'string' || sh.amount <= 0 || !isCurrent(cx, sh.to)) { out.push(sh); continue; }
    const excess = excessDamageToCreature(cx.g, source.id, sh.to.id, sh.amount);
    if (excess <= 0) { out.push(sh); continue; }
    out.push({ to: sh.to, amount: sh.amount - excess }, { to: cx.g.obj(sh.to.id).controller, amount: excess });
  }
  return out;
}

/** edh-players-12: the share of each player of the group `to` names, the amount read with that player iterating (cards-util.ts#readFor); one that fails to determine gets nothing (CR 608.2b). */
function eachPlayerShares(cx: ExecCtx, st: Step<'damage'>): Share[] {
  const out: Share[] = [];
  for (const to of damageRecipients(cx, st.to).players) {
    const amount = readFor(cx, to, () => amountOf(cx, st.amount));
    if (amount !== undefined) out.push({ to, amount });
  }
  return out;
}

/**
 * edh-next-128 (CR 608.2d, 120.3, 306.8; Vial Smasher the Fierce, Curse of the Pierced Heart): `orPlaneswalker`, "to that player or a planeswalker that player controls":
 * for each player of `to`, the effect's controller chooses as the step resolves that player or one planeswalker that player controls now (no planeswalker: the player,
 * nothing to choose; Scryfall ruling 2020-11-10 on Vial Smasher). Not a target (CR 115.1). Then the plain step deals the damage to what was chosen, as one event.
 */
function damageToPlayerOrPlaneswalker(cx: ExecCtx, st: Step<'damage'>): StepResult {
  if (st.divided !== undefined || (st.also ?? []).length > 0 || st.perSource === true || st.excessToController === true) return askManual(cx, st.span ?? 'Deal the damage.', 'damage to a player or a planeswalker that player controls is not modelled together with a division, several recipients or sources, or excess damage');
  const players: PlayerId[] = [];
  const objects: { id: ObjectId; zone: 'battlefield' }[] = [];
  for (const p of resolvePlayers(cx, st.to as PlayerRef)) {
    const walkers = resolveObjs(cx, { ref: 'each', filter: { types: ['Planeswalker'], controller: { ref: 'fixed', players: [p] } } }).filter((h) => h.zone === 'battlefield' && isCurrent(cx, h));
    if (walkers.length === 0) { players.push(p); continue; } // nothing to choose (CR 608.2d)
    const pick = cx.g.choose({
      kind: 'chooseOption', player: cx.controller, min: 1, max: 1, prompt: `${cx.g.nameOf(cx.source.id)}: deal the damage to ${cx.g.player(p).name} or to a planeswalker that player controls?`,
      options: [{ id: `player:${p}`, label: cx.g.player(p).name }, ...walkers.map((h) => ({ id: `object:${h.id}`, label: cx.g.nameOf(h.id) }))], rules: ['CR 608.2d', 'CR 120.3'],
    }).ids[0];
    const w = pick !== undefined && pick.startsWith('object:') ? walkers.find((h) => `object:${h.id}` === pick) : undefined;
    if (w !== undefined) objects.push({ id: w.id, zone: 'battlefield' });
    else players.push(p);
    cx.g.log(`${cx.g.player(cx.controller).name} chooses ${w !== undefined ? cx.g.nameOf(w.id) : cx.g.player(p).name} to be dealt the damage.`, { rules: ['CR 608.2d'], level: 'action' });
  }
  const { orPlaneswalker: _flag, ...plain } = st;
  // every chosen recipient is dealt the whole amount, all in one damage event (CR 120.2b); a union of fixed parts is read by effects/refs.ts#resolveRecipients
  const to: Ref = objects.length === 0 ? { ref: 'fixed', players } : players.length === 0 ? { ref: 'fixed', objects } : { ref: 'union', of: [{ ref: 'fixed', objects }, { ref: 'fixed', players } as unknown as ObjRef] };
  return damage(cx, { ...plain, to });
}

const damage: StepHandler<Step<'damage'>> = (cx, st) => {
  if (st.orPlaneswalker === true) return damageToPlayerOrPlaneswalker(cx, st);
  if (st.excessToController === true && (st.perSource === true || st.divided !== undefined || (st.also ?? []).length > 0)) return askManual(cx, st.span ?? 'Deal the damage.', 'excess damage to the controller is not modelled together with a division, several recipients or several sources (CR 120.10)');
  if (st.perSource === true) return damagePerSource(cx, st);
  // edh-players-12 (CR 608.2e, 101.4, 107.1a, 120.2b): "~ deals damage to each opponent equal to the number of cards that player has drawn this turn" (Molten Psyche): an
  // amount that reads each recipient (`{ref:'iterating'}`) is read for each player of the group in turn, then every player is dealt their own amount, all as one event
  // edh-next-143 (CR 608.2d; Khorvath's Fury): ... or the players a "choose friend or foe" chose a word for ("each foe", the `chose` reference)
  const perPlayer = readsEachPlayer(st.to as { ref: string }, st.amount) && ((st.to as { who?: string }).who === 'opponent' || (st.to as { who?: string }).who === 'player' || (st.to as { ref: string }).ref === 'chose');
  if (perPlayer && (st.divided !== undefined || (st.also ?? []).length > 0 || st.excessToController === true)) return askManual(cx, st.span ?? 'Deal the damage.', 'an amount of each player of a group is not modelled together with a division, several recipients or excess damage (CR 120.10)');
  // 1. evaluate
  const total = perPlayer ? 0 : amountOf(cx, st.amount);
  if (total === undefined) return NOTHING; // fails to determine (CR 608.2b): Rabid Bite whose creature is gone
  // 2. resolve references: the source may have left (its last known information deals the damage, CR 608.2h, 113.7a); recipients must still be there
  const sources = resolveObjs(cx, st.source);
  if (sources.length === 0) return NOTHING; // an illegal source target deals no damage (CR 608.2b)
  const split = perPlayer ? eachPlayerShares(cx, st) : splitAmount(cx, st, total);
  if (split === null) return askManual(cx, st.span ?? 'Divide the damage as announced.', 'the announced division of the damage is missing (CR 601.2d)');
  const shares = [...split, ...alsoShares(cx, st)]; // FAST2 T8: the other recipients of the same damage event (CR 120.2b, 120.3f)
  // 3. no decisions: the division was announced (CR 601.2d) or is computed. 4. act only through the pipeline, as one damage event (CR 120.3f, 702.15e).
  const ledger: LifelinkLedger = new Map();
  const hit: (ObjHandle | PlayerId)[] = [];
  const first = cx.g.events.length; // PUSH1 T2: the damage events of this step are one simultaneous event (CR 120.2b): they share `group`
  // edhd67 review (CR 120.2b, 615.8): the damage of one step is one simultaneous event, so a "next time" shield on its source is used up by all of it (effects/damage-batch.ts)
  inDamageBatch(cx.g, () => {
    for (const source of sources) {
      for (const { to, amount } of st.excessToController === true ? excessShares(cx, source, shares) : shares) {
        if (amount <= 0) continue; // CR 120.8: 0 damage is no damage event (CR 614.7a)
        if (typeof to !== 'string' && !isCurrent(cx, to)) continue; // it left: a new object the effect can't find (CR 400.7)
        const dealt = proposeMeasured(cx, { ev: 'damage', source, to, amount, combat: false, unpreventable: st.unpreventable === true, lifelink: ledger }); // CR 120.2b
        if (dealt > 0) hit.push(to);
      }
    }
  });
  for (const ev of cx.g.events.slice(first)) if (ev.type === 'damageDealt') ev.group = first;
  settleLifelink(cx, ledger);
  // 5. record
  if (st.divided && split.length > 0) {
    const how = st.divided === 'announced' ? 'as announced' : st.divided === 'bySourceController' ? 'as its controller chose' : `evenly, rounded ${st.divided === 'evenlyRoundDown' ? 'down' : 'up'},`;
    cx.g.log(`${cx.g.nameOf(sources[0]!.id)}'s ${total} damage is divided ${how} among the legal targets: ${split.map((x) => `${x.amount} to ${nameOfRecipient(cx, x.to)}`).join(', ')}.`, {
      rules: ['CR 120.2b', 'CR 608.2b', ...(st.divided === 'announced' ? ['CR 601.2d'] : [])], level: 'action',
    });
  }
  const ids = new Set(sources.map((h) => h.id));
  // FAST5X E16 (CR 120.4a); std-rx20 (CR 120.3, 608.2c): and the damage the step really dealt ("the damage dealt this way")
  return { ...recordActed(cx, st.as, hit), excess: excessSince(cx, first, ids), dealt: dealtSince(cx, first, ids), stated: perPlayer ? undefined : total };
};

// ---- life (CR 119) ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * Each player gains or loses `amount` life, through the pipeline; returns the players whose life total actually changed (CR 119.7, 119.8 refuse it).
 * M12-3: `measured` adds up the life actually gained or lost (as the events measured it, after replacement effects), for "the life lost this way".
 * Cloud std-spm: and `measured.by` what each player gained or lost (`StepResult.lifeLostBy`, "if you lost life this way").
 */
function proposeLifeChange(cx: ExecCtx, players: PlayerId[], change: 'gain' | 'loss', amount: number, measured?: { total: number; by?: Map<PlayerId, number> }): PlayerId[] {
  const acted: PlayerId[] = [];
  if (amount <= 0) return acted; // gaining or losing 0 life is no event (CR 119.9 for gains; nothing changes for a loss)
  for (const player of players) {
    if (cx.g.player(player).hasLost) continue; // CR 800.4a: a player who left the game is not affected
    const n = proposeMeasured(cx, change === 'gain' ? { ev: 'life', change, player, amount, effectController: cx.controller } : { ev: 'life', change, player, amount }); // edh-d-54: effectController (Rain of Gore); the performer honors "can't gain/lose life" (CR 119.7, 119.8)
    if (n > 0) acted.push(player);
    if (measured && n > 0) measured.total += n;
    if (measured?.by && n > 0) measured.by.set(player, (measured.by.get(player) ?? 0) + n);
  }
  return acted;
}

/** The value forms of the gainLife and loseLife ops this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). */
export const OP_FORMS: readonly string[] = ['op:loseLife.perPlayerAmount', 'op:gainLife.perPlayerAmount', 'op:fight.pairs' /* p2-damage-2 */, 'op:fight.toughness' /* edh-c-111 */, 'op:damage.excessToController' /* edh-replace-4 */, 'op:damage.perPlayerAmount' /* edh-players-12 */, 'op:gainLife.also' /* edh-players-17 */, 'op:damage.orPlaneswalker' /* edh-next-128 */, 'op:damage.dividedBySourceController' /* edh-next-139 */];

const lifeHandler = (change: 'gain' | 'loss'): StepHandler<Step<'gainLife'> | Step<'loseLife'>> => (cx, st) => {
  // std-rx30 (CR 608.2e, 101.4, 107.1a): an amount that reads each player of the group ("Each player loses half their life") is read for each of them, then every
  // player gains or loses their own amount (cards-util.ts#readFor)
  if (readsEachPlayer(st.who, st.amount)) {
    const measured = { total: 0, by: new Map<PlayerId, number>() };
    const acted: PlayerId[] = [];
    for (const p of resolvePlayers(cx, st.who)) {
      const own = readFor(cx, p, () => amountOf(cx, st.amount));
      if (own === undefined) continue; // that player's amount fails to determine (CR 608.2b)
      acted.push(...proposeLifeChange(cx, [p], change, own, measured));
    }
    return change === 'loss' ? { ...recordActed(cx, st.as, acted), lifeLost: measured.total, lifeLostBy: measured.by } : recordActed(cx, st.as, acted);
  }
  const amount = amountOf(cx, st.amount); // 1. evaluate (CR 107.1b: never negative)
  if (amount === undefined) return NOTHING; // Sorin's Thirst whose target is gone gains no life (CR 608.2b)
  const players = resolvePlayers(cx, st.who); // 2. resolve: APNAP order for "each player" (CR 101.4)
  const measured = { total: 0, by: new Map<PlayerId, number>() };
  // edh-players-17 (CR 119.3, 608.2c): "you and that player each gain N life": the second group gains too; a player in both gains both amounts as one event
  const also = st.op === 'gainLife' && st.also !== undefined ? resolvePlayers(cx, st.also) : [];
  const acted: PlayerId[] = [];
  // edh-next-93 (CR 728.1, 119.3, 614.1a; Strong, the Brutish Thespian): the life loss of the rad counters' ability, for a player with a `radiationGainsLife` rule, is a life gain of that amount instead
  if (st.op === 'loseLife' && st.radiation === true && players.some((p) => radiationGainsLife(cx.g.s, p))) {
    const gainers = players.filter((p) => radiationGainsLife(cx.g.s, p));
    acted.push(...proposeLifeChange(cx, gainers, 'gain', amount, measured));
    acted.push(...proposeLifeChange(cx, players.filter((p) => !gainers.includes(p)), 'loss', amount, measured));
    return recordActed(cx, st.as, acted);
  }
  if (also.length === 0) acted.push(...proposeLifeChange(cx, players, change, amount, measured)); // 4. act (CR 119.3)
  else for (const p of [...new Set([...players, ...also])]) acted.push(...proposeLifeChange(cx, [p], change, amount * ((players.includes(p) ? 1 : 0) + (also.includes(p) ? 1 : 0)), measured));
  // 5. record; M12-3 (CR 119.3, 608.2c): "the life lost this way" is the life the players actually lost, summed over every player (`{q:'lifeLost'}`)
  // cloud std-spm: and what each of them lost (`{q:'lifeLost', who}`)
  return change === 'loss' ? { ...recordActed(cx, st.as, acted), lifeLost: measured.total, lifeLostBy: measured.by } : recordActed(cx, st.as, acted);
};

/** CR 119.5: setting a life total is gaining or losing the difference, so "can't gain/lose life" and life-change triggers apply. */
const setLife: StepHandler<Step<'setLife'>> = (cx, st) => {
  const v = evalQty(cx, st.value); // CR 107.1b: a value a life total is SET to may be negative, so it is not clamped
  if (v === undefined || Number.isNaN(v)) return NOTHING;
  const value = Math.floor(v);
  const acted: PlayerId[] = [];
  for (const player of resolvePlayers(cx, st.who)) {
    const p = cx.g.player(player);
    if (p.hasLost) continue;
    const delta = value - p.life; // read for each player when it is applied (CR 608.2h)
    if (delta === 0) continue;
    acted.push(...proposeLifeChange(cx, [player], delta > 0 ? 'gain' : 'loss', Math.abs(delta)));
  }
  if (acted.length > 0) cx.g.log(`Life total${acted.length > 1 ? 's' : ''} set to ${value}: ${acted.map((p) => cx.g.player(p).name).join(', ')}.`, { rules: ['CR 119.5'], level: 'action' });
  return recordActed(cx, st.as, acted);
};

// ---- fight (CR 701.14) -----------------------------------------------------------------------------------------------------------------------------------

/** A creature on the battlefield that can fight now (CR 701.14b), with its power; `null` power: an unevaluated "*" (milestone 6). */
function fighter(cx: ExecCtx, h: ObjHandle | undefined, by: 'power' | 'toughness' = 'power'): { h: ObjHandle; power: number | null } | undefined {
  if (!h || h.zone !== 'battlefield' || !isCurrent(cx, h)) return undefined;
  const o = cx.g.s.objects[h.id]!;
  if (o.phasedOut) return undefined; // CR 702.26b: treated as though it doesn't exist
  const c = charsOfObject(cx.g.s, o);
  if (!c.types.includes('Creature')) return undefined;
  const n = ptNumbers(c);
  return { h, power: by === 'toughness' ? n.toughness : n.power }; // edh-c-111: `power` is the number each deals (its toughness for Grim Contest)
}

const fight: StepHandler<Step<'fight'>> = (cx, st) => {
  if (st.pairs === true) return st.by !== undefined ? askManual(cx, st.span ?? 'Fight.', 'a damage by toughness is not modelled for several pairs') : fightPairs(cx, st);
  // 2. resolve: exactly one creature on each side; an illegal target is not among them (CR 608.2b)
  const as = resolveObjs(cx, st.a);
  const bs = resolveObjs(cx, st.b);
  if (as.length > 1 || bs.length > 1) return askManual(cx, st.span ?? 'Fight.', 'a fight names more than one creature on a side (CR 701.14a)');
  return fightBetween(cx, st, as[0], bs[0]);
};

/** One fight between two objects (CR 701.14): what the plain step does with the one creature of each side. */
function fightBetween(cx: ExecCtx, st: Step<'fight'>, ah: ObjHandle | undefined, bh: ObjHandle | undefined): StepResult {
  // edh-c-111 (CR 120.2b, 608.2b, 701.14; Grim Contest, ruling 2014-11-24): `by: 'toughness'`, "Each of those creatures deals damage equal to its toughness to the other": the
  // same simultaneous damage as a fight but NOT a fight (no "fights" trigger, nothing performs the action); an illegal target or a creature that left means neither deals damage
  const by = st.by === 'toughness' ? 'toughness' : 'power';
  const a = fighter(cx, ah, by);
  const b = fighter(cx, bh, by);
  if (!a || !b) {
    // CR 701.14b: if either is gone, no longer a creature, or an illegal target, NEITHER fights or deals damage
    cx.g.log('No fight happens: a creature that would fight is no longer a creature on the battlefield or is an illegal target.', { rules: ['CR 701.14b'], level: 'action' });
    return NOTHING;
  }
  if (a.power === null || b.power === null) return askManual(cx, st.span ?? 'Fight.', 'a fighting creature has a power the engine cannot compute yet');
  // 1. both powers are read BEFORE any damage: each deals damage equal to its power to the other (CR 701.14a), at the same time: one damage event
  const pa = Math.max(0, a.power); // CR 107.1b: a negative power deals no damage
  const pb = Math.max(0, b.power);
  const hits: { source: ObjHandle; to: ObjHandle; amount: number }[] = a.h.id === b.h.id
    ? [{ source: a.h, to: a.h, amount: 2 * pa }] // CR 701.14c: a creature that fights itself is dealt damage equal to twice its power
    : [{ source: a.h, to: b.h, amount: pa }, { source: b.h, to: a.h, amount: pb }];
  const ledger: LifelinkLedger = new Map();
  const mark = cx.g.events.length;
  for (const hit of hits) {
    if (hit.amount <= 0) continue; // CR 120.8
    proposeMeasured(cx, { ev: 'damage', source: hit.source, to: hit.to, amount: hit.amount, combat: false, unpreventable: false, lifelink: ledger }); // CR 701.14d: not combat damage
  }
  settleLifelink(cx, ledger);
  // they fought (CR 701.14a), even if every point of damage was prevented. FAST5X E16: the excess damage each was dealt (CR 120.4a; Rhino's Rampage)
  // edh-combat-6 (CR 701.14a, 603.2; Neyith of the Dire Hunt): each creature that fought is reported (a creature that fights itself once)
  if (by === 'power') for (const f of a.h.id === b.h.id ? [a.h] : [a.h, b.h]) performAction(cx.g, { verb: 'fight', actor: cx.controller, objectId: f.id });
  return { ...recordActed(cx, st.as, a.h.id === b.h.id ? [a.h] : [a.h, b.h]), excess: excessSince(cx, mark, new Set([a.h.id, b.h.id])) };
}

/**
 * p2-damage-2 (CR 701.14a, 608.2d): "each of those tokens fights a different one of those creatures": each creature of `a` that can fight, in order, fights one of
 * the creatures of `b` no earlier fight of this step used, the controller choosing which when there is more than one; a side with fewer creatures leaves the rest of
 * the other side without a fight. Each fight is one fight (CR 701.14b-d), as the plain step does it.
 */
const fightPairs: StepHandler<Step<'fight'>> = (cx, st) => {
  const as = resolveObjs(cx, st.a).filter((h) => fighter(cx, h) !== undefined);
  let bs = resolveObjs(cx, st.b).filter((h) => fighter(cx, h) !== undefined);
  const fought: ObjHandle[] = [];
  const excess = new Map<ObjectId, number>();
  for (const a of as) {
    const left = bs.filter((h) => h.id !== a.id);
    if (left.length === 0) break;
    let b = left[0]!;
    if (left.length > 1) {
      const ans = cx.g.choose({
        kind: 'chooseObjects', player: cx.controller, options: left.map((h) => h.id), min: 1, max: 1, rules: ['CR 701.14a', 'CR 608.2d'],
        prompt: `Choose the creature ${cx.g.nameOf(a.id)} fights (a different one for each).`,
      });
      b = left.find((h) => h.id === ans.ids[0]) ?? b;
    }
    bs = bs.filter((h) => h.id !== b.id);
    const mark = cx.g.events.length;
    const r = fightBetween(cx, { op: 'fight', a: st.a, b: st.b }, a, b);
    if (r === NOTHING) continue;
    for (const [id, n] of excessSince(cx, mark, new Set([a.id, b.id]))) excess.set(id, (excess.get(id) ?? 0) + n);
    fought.push(a, b);
  }
  return { ...recordActed(cx, st.as, fought), excess };
};

export const LIFEDAMAGE_HANDLERS: OpHandlers = {
  damage,
  gainLife: lifeHandler('gain') as StepHandler<Step<'gainLife'>>,
  loseLife: lifeHandler('loss') as StepHandler<Step<'loseLife'>>,
  setLife,
  fight,
};
