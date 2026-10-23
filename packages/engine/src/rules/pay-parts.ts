/**
 * Paying one non-mana cost part (CR 118.3, 601.2h). Owner: WP7. rules/pay.ts decides the ORDER (tap costs, mana, the other parts, then the parts with random
 * elements or that move cards out of the library, CR 601.2h) and which objects pay each part; this module performs one part with the objects chosen for it.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import { IllegalAction, type Game } from '../core/game';
import { moveObject } from '../core/zones';
import { addEffectRecord } from '../core/durations';
import { randomInt } from '../rng';
import { forageOptions, partText, type PlanPart } from './cost';
import { amongCounterHolders, isRandomPart, partCandidates } from './cost-pick';
import { givePoison, payLife } from './life';
import { charsOfObject } from './characteristics';
import type { Paid } from './pay';

/**
 * Cloud r3-repl INTERFACE CHANGE (CR 118.3, 122.6, 614.1a): the counters a cost puts on a permanent go through the proposal pipeline (a `counters` proposal with the
 * cause 'cost' by the paying player), installed by effects/funnels.ts. Returns the counters put. Without it they are put directly, as before.
 */
export type CostCounterFunnel = (g: Game, player: PlayerId, target: ObjectId, kind: string, count: number) => number;
let costCounterFunnel: CostCounterFunnel | null = null;
export function installCostCounterFunnel(f: CostCounterFunnel | null): void {
  costCounterFunnel = f;
}

/**
 * Review of Cloud r3-repl (CR 606.4, 118.3, 122.6, 614.1a): put the counters a cost puts on a permanent (a +N loyalty cost as well, rules/pay.ts) through the
 * funnel, or directly without one; returns the counters put. A replacement may change their number ("put twice that many", Innkeeper's Talent: a +1 loyalty
 * ability gets two; "that many minus one" may leave none): the cost is still paid. A "can't have counters put on it" effect is refused before payment
 * (rules/cost.ts#partsDenial, rules/cost-pick.ts, WP31).
 */
export function putCostCounters(g: Game, player: PlayerId, target: ObjectId, kind: string, count: number): number {
  if (costCounterFunnel) return costCounterFunnel(g, player, target, kind, count);
  const o = g.obj(target);
  o.counters[kind] = (o.counters[kind] ?? 0) + count;
  g.emit({ type: 'countersChanged', target, counter: kind, delta: count, by: player }); // FAST5X E21: the player paying puts them (CR 118.3, 122.6)
  return count;
}

/**
 * Move an object to pay a cost. WP31 review backstop (CR 614.17b, 118.3): a move a "can't" effect refused (the object is still where it was) is never counted
 * as paid: the action is illegal and taken back. The cost checks refuse such objects before; this keeps a missed one from paying silently.
 */
function costMove(g: Game, id: ObjectId, to: 'graveyard' | 'hand' | 'exile', cause: string, label: string): ObjectId | null {
  const from = g.obj(id).zone;
  const n = moveObject(g, id, to, { cause });
  if (n === null && g.maybeObj(id)?.zone === from) throw new IllegalAction(`${g.nameOf(id)} can't pay for ${label}: that event can't happen.`, ['CR 614.17b', 'CR 118.3']);
  return n;
}

/** CLOUD C8 (CR 400.2, 400.7j): the zones where the spell or ability a cost was paid for can find the card the cost moved there. */
const PUBLIC_COST_ZONES: ReadonlySet<string> = new Set(['graveyard', 'exile', 'battlefield', 'stack', 'command']);

/** Pay one non-tap cost part with the objects chosen for it. */
export function payPart(g: Game, player: PlayerId, sourceId: ObjectId | null, part: PlanPart, picked: ObjectId[], label: string, paid: Paid): void {
  const name = g.player(player).name;
  const gone = (id: ObjectId): never => {
    throw new IllegalAction(`${g.nameOf(id)} is no longer available to pay for ${label}.`, ['CR 118.3']);
  };
  /** Move every picked object, remember the new objects as cost objects (CR 400.7j) and log each. */
  const moveEach = (ids: ObjectId[], to: 'graveyard' | 'hand' | 'exile', cause: string, verb: string, rules: string[]): void => {
    for (const id of ids) {
      if (!g.maybeObj(id)) gone(id);
      const nm = g.nameOf(id);
      const n = costMove(g, id, to, cause, label);
      if (n) paid.costObjects.push(n);
      g.log(`${name} ${verb} ${nm} (cost of ${label}).`, { rules, level: 'info' });
    }
  };
  switch (part.kind) {
    case 'payLife':
      if (!payLife(g, player, part.amount, `paying the cost of ${label}`, ['CR 118.3b', 'CR 119.4'])) throw new IllegalAction(`You can't pay ${part.amount} life for ${label}.`, ['CR 119.4', 'CR 119.8']);
      paid.lifePaid += part.amount;
      return;
    case 'payEnergy': {
      const p = g.player(player);
      if ((p.counters.energy ?? 0) < part.amount) throw new IllegalAction(`You can't pay ${part.amount} energy for ${label}.`, ['CR 107.14', 'CR 118.3']);
      p.counters.energy = (p.counters.energy ?? 0) - part.amount;
      if (p.counters.energy === 0) delete p.counters.energy;
      g.emit({ type: 'countersChanged', target: player, counter: 'energy', delta: -part.amount });
      g.log(`${name} pays ${part.amount} energy (cost of ${label}).`, { rules: ['CR 107.14', 'CR 118.3'], level: 'info' });
      return;
    }
    case 'removeCounters': {
      if (part.among) {
        removeCountersAmong(g, player, sourceId, part, label); // r3-cost: "from among <permanents>" (CR 118.3, 122.1)
        return;
      }
      const target = part.filter ? g.maybeObj(picked[0]) : sourceId ? g.maybeObj(sourceId) : undefined; // on a chosen permanent, or on the source
      if (!target) throw new IllegalAction('The permanent to remove counters from is gone.', ['CR 118.3']);
      if (part.counter === 'any') {
        removeAnyCounters(g, player, target.id, part.count, label);
        return;
      }
      if ((target.counters[part.counter] ?? 0) < part.count) throw new IllegalAction(`${g.nameOf(target.id)} no longer has ${part.count} ${part.counter} counters.`, ['CR 118.3']);
      target.counters[part.counter] = (target.counters[part.counter] ?? 0) - part.count;
      if (target.counters[part.counter] === 0) delete target.counters[part.counter];
      g.emit({ type: 'countersChanged', target: target.id, counter: part.counter, delta: -part.count });
      return;
    }
    case 'putCounters': {
      const target = part.self ? (sourceId ? g.maybeObj(sourceId) : undefined) : g.maybeObj(picked[0]);
      if (!target || target.zone !== 'battlefield') throw new IllegalAction('The permanent to put counters on is gone.', ['CR 118.3']);
      // Cloud r3-repl (CR 118.3, 122.6, 614.1a): the counters a cost puts are proposed like any other (the funnel of effects/funnels.ts, cause 'cost'), so "if you
      // would put one or more counters" (Innkeeper's Talent) and "if one or more +1/+1 counters would be put" apply to them; "if an EFFECT would" does not (CR 614.16)
      const n = putCostCounters(g, player, target.id, part.counter, part.count);
      g.log(`${name} puts ${n} ${part.counter} counter${n === 1 ? '' : 's'} on ${g.nameOf(target.id)} (cost of ${label}).`, { rules: ['CR 122.1', 'CR 118.3'], level: 'info' });
      return;
    }
    case 'mill': {
      // CR 701.17a-b: the top cards of the library go to the graveyard; a cost that mills more than the library holds can't be paid.
      const lib = g.s.zones.library[player] ?? [];
      if (lib.length < part.count) throw new IllegalAction(`You can't mill ${part.count} cards: your library has fewer.`, ['CR 701.17b', 'CR 118.3']);
      for (const id of lib.slice(0, part.count)) {
        const n = moveObject(g, id, 'graveyard', { cause: 'mill' });
        if (n) paid.costObjects.push(n);
      }
      g.log(`${name} mills ${part.count} card${part.count === 1 ? '' : 's'} (cost of ${label}).`, { rules: ['CR 701.17a', 'CR 118.3'], level: 'info' });
      return;
    }
    case 'reveal':
      for (const id of picked) {
        if (!g.maybeObj(id)) gone(id);
        g.emit({ type: 'actionPerformed', verb: 'reveal', actor: player, objectId: id });
        const where = g.maybeObj(id)?.zone === 'command' ? 'the command zone' : 'their hand'; // M11-1: CR 702.49d
        g.log(`${name} reveals ${g.nameOf(id)} from ${where} (cost of ${label}).`, { rules: ['CR 701.20a', 'CR 118.3'], level: 'info' });
        // p2-refs-1 (CR 601.2b, 608.2h): a revealed card other than ~ is remembered where it is (ObjRef costRevealed, "the revealed card's mana value")
        const o = g.maybeObj(id);
        if (part.self !== true && o) (paid.revealed ??= []).push({ id, zone: o.zone });
      }
      return;
    case 'behold':
      behold(g, player, part, picked, label, paid);
      return;
    case 'chooseObject':
      // std-costs-2 (CR 601.2b, 601.2h): the chosen objects are only named; each is remembered with the zone it is in (ObjRef costChosenObject)
      for (const id of picked) {
        const o = g.maybeObj(id);
        if (!o || !part.filters.some((f) => f.zone === o.zone)) gone(id);
        (paid.chosenObjects ??= []).push({ id, zone: o!.zone });
        g.log(`${name} chooses ${g.nameOf(id)} (cost of ${label}).`, { rules: ['CR 601.2b', 'CR 118.3'], level: 'info' });
      }
      return;
    case 'collectEvidence': {
      const before = paid.costObjects.length;
      moveEach(picked, 'exile', 'exile', 'exiles', ['CR 701.59a', 'CR 118.3']);
      // std-rx27 (CR 607.2a): the cards it exiled are "exiled with" the source, for its linked ability (actions/activate.ts stores them on the source)
      if (part.link !== undefined) for (const id of paid.costObjects.slice(before)) if (g.maybeObj(id)?.zone === 'exile') ((paid.costLinks ??= {})[part.link] ??= []).push({ id, zone: 'exile' });
      g.emit({ type: 'actionPerformed', verb: 'collectEvidence', actor: player });
      return;
    }
    case 'forage':
      forage(g, player, label, paid);
      return;
    case 'exert':
      // FAST5X E28, CR 701.43a, 118.3: "Exert ~" exerts the source of the ability (CR 701.43c: only on the battlefield)
      if (!sourceId || !exertPermanent(g, player, sourceId, `cost of ${label}`)) throw new IllegalAction(`Only a permanent on the battlefield can be exerted for ${label}.`, ['CR 701.43c', 'CR 118.3']);
      return;
    case 'confirm': {
      // A cost word the compiler didn't understand: the controller says whether they paid it by hand; declining cancels (CR 733.1, design 10.1).
      const yes = g.choose({
        kind: 'yesNo', player, prompt: `Pay this cost by hand and confirm: ${part.text} (cost of ${label}).`, yesLabel: 'I paid it', noLabel: 'I did not', cancellable: true, rules: ['CR 118.3', 'CR 733.1'],
      }).yes;
      if (!yes) throw new IllegalAction(`The cost "${part.text}" was not paid; cancel to take the action back.`, ['CR 118.3', 'CR 733.1']);
      g.log(`${name} confirms having paid: ${part.text} (cost of ${label}).`, { rules: ['CR 118.3'], level: 'manual' });
      return;
    }
    case 'manual':
      throw new IllegalAction(`This cost can't be paid automatically yet: ${part.text}`, ['CR 118.3']);
    case 'revealChosen': {
      // std-combat-5 (CR 608.2d, 607.2d, 118.3): the value the source's choice holds, read on the source as it last existed when another part of this cost moved it
      // ("Sacrifice this enchantment, Reveal the creature type you chose"); revealed to every player from now on (its secrecy ends, core/view.ts)
      const now = sourceId !== null ? g.s.objects[sourceId] : undefined;
      const src = now ?? (sourceId !== null ? g.s.lki[sourceId]?.object : undefined);
      const v = src?.links?.[part.link];
      const values = v?.values ?? [];
      if (values.length === 0) throw new IllegalAction(`Nothing was chosen, so the cost of ${label} can't be paid.`, ['CR 118.3', 'CR 607.2d']);
      if (now !== undefined && v?.secret !== undefined) {
        const { secret: _secret, ...open } = v;
        now.links![part.link] = open;
      }
      g.log(`${name} reveals the chosen creature type: ${values.join(', ')} (cost of ${label}).`, { rules: ['CR 608.2d', 'CR 118.3'], level: 'action' });
      return;
    }
    case 'getCounters': {
      // FAST5X E27 (CR 122.1f, 702.21a): the paying player gets the poison counters; a player who can't get counters can't pay (CR 614.17b, rules/cost.ts#partsDenial)
      const before = g.player(player).poison;
      givePoison(g, player, part.amount, `cost of ${label}`);
      if (g.player(player).poison - before !== part.amount) throw new IllegalAction(`${name} can't get poison counters, so the cost of ${label} can't be paid.`, ['CR 122.1f', 'CR 614.17b', 'CR 118.3']);
      return;
    }
    case 'oneOf':
      // FAST5X E27: a choice between costs is resolved before anything is paid (rules/pay.ts#resolveOneOf); never paid unresolved, never free
      throw new IllegalAction(`Choose which cost of ${label} to pay first (${partText(part)}).`, ['CR 601.2b', 'CR 118.3']);
    case 'discard': {
      let chosen = picked;
      if (part.hand) chosen = [...(g.s.zones.hand[player] ?? [])]; // CR 701.9: discard your hand
      else if (isRandomPart(part)) { // CR 701.9b: discarding at random
        const pool = partCandidates(g.s, player, sourceId, part);
        chosen = [];
        for (let i = 0; i < part.count; i++) chosen.push(pool.splice(randomInt(g.s.rng, pool.length), 1)[0]!);
      }
      for (const id of chosen) {
        if (!g.maybeObj(id)) gone(id);
        const nm = g.nameOf(id);
        const n = costMove(g, id, 'graveyard', 'discard', label);
        if (n) paid.costObjects.push(n);
        // CLOUD C8: "the discarded card" is the card the discard made of it where it went, a public zone (CR 400.7j; madness's exile too); one a replacement put into a
        // hidden zone is its handle in the hand, read from its last known information only (CR 400.7, 608.2h)
        const now = n !== null ? g.maybeObj(n) : undefined;
        (paid.discarded ??= []).push(now !== undefined && PUBLIC_COST_ZONES.has(now.zone) ? { id: now.id, zone: now.zone } : { id, zone: 'hand' });
        g.log(`${name} discards ${nm} (cost of ${label}).`, { rules: ['CR 701.9', 'CR 118.3'] });
      }
      return;
    }
    case 'sacrifice':
      moveEach(picked, 'graveyard', 'sacrifice', 'sacrifices', ['CR 701.21a', 'CR 118.3']);
      // FAST3 T18: "the sacrificed creature" reads these as they last existed on the battlefield (CR 608.2h; GameState.lki is keyed by these ids), whatever
      // zone a replacement effect sent them to and even when a token ceased to exist (CR 111.7)
      (paid.sacrificed ??= []).push(...picked);
      return;
    case 'returnToHand':
      moveEach(picked, 'hand', 'returnToHand', 'returns to their hand', ['CR 118.3']);
      // FAST5X E7: "the creature that was returned" (sneak, CR 702.190b) reads them as they last existed on the battlefield (CR 608.2h)
      (paid.returned ??= []).push(...picked);
      return;
    case 'exileFrom': {
      // FAST5X E13: remember what the cards became in exile (CR 400.7j): the source ("Exile this permanent", returned by craft, CR 702.167a) and the others
      // (craft's materials, "the exiled cards used to craft it", CR 702.167c)
      const before = paid.costObjects.length;
      // Standard round 3, r3-trig (CR 702.167a): craft's materials are exiled with the cause 'craft' ("when this creature is exiled from the battlefield while you're
      // activating a craft ability"); triggers/normalize.ts still sees the move as an exile (CAUSE_VERBS)
      moveEach(picked, 'exile', part.orGraveyard ? 'craft' : 'exile', 'exiles', part.orGraveyard ? ['CR 702.167a', 'CR 118.3'] : ['CR 118.3']);
      const now = paid.costObjects.slice(before).filter((id) => g.maybeObj(id)?.zone === 'exile');
      const rec = (paid.exiled ??= { others: [] });
      if (part.self) { if (now[0] !== undefined) rec.self = now[0]; } else rec.others.push(...now);
      // FAST5 T59 (CR 607.2q): what the cost exiled is read by a linked ability of the permanent the spell becomes (core/resolve.ts), as for "behold ... and exile it"
      if (part.link !== undefined) for (const id of now) ((paid.costLinks ??= {})[part.link] ??= []).push({ id, zone: 'exile' });
      return;
    }
    case 'tapUntapped':
    case 'tapPower':
    case 'untapTapped': // p2-cost-parts-1
      return; // paid before the mana
  }
}

/**
 * FAST5X E11, CR 701.4a: to behold a [quality] is to reveal a [quality] card from your hand or to choose a [quality] permanent you control. What was beheld is
 * remembered as it is now (CR 701.4b: "if a [quality] was beheld" reads that). "Behold a Goblin and exile it" then exiles the card or permanent (Champions of
 * Lorwyn); a part with a `link` remembers the exiled object for the linked ability of the permanent the spell becomes (CR 607.2q, core/resolve.ts; a copy of the spell links nothing, CR 707.10).
 */
function behold(g: Game, player: PlayerId, part: Extract<PlanPart, { kind: 'behold' }>, picked: ObjectId[], label: string, paid: Paid): void {
  const name = g.player(player).name;
  for (const id of picked) {
    const o = g.maybeObj(id);
    if (!o || (o.zone !== 'hand' && o.zone !== 'battlefield')) throw new IllegalAction(`${g.nameOf(id)} is no longer available to behold for ${label}.`, ['CR 701.4a', 'CR 118.3']);
    const c = charsOfObject(g.s, o);
    (paid.beheld ??= []).push({ types: [...c.types], subtypes: [...c.subtypes], supertypes: [...c.supertypes], id, zone: o.zone }); // std-rx28: id and zone (ObjRef costBeheld)
    const nm = g.nameOf(id);
    if (o.zone === 'hand') {
      g.emit({ type: 'actionPerformed', verb: 'reveal', actor: player, objectId: id });
      g.log(`${name} reveals ${nm} from their hand to behold it (cost of ${label}).`, { rules: ['CR 701.4a', 'CR 701.20a', 'CR 118.3'], level: 'info' });
    } else {
      g.log(`${name} beholds ${nm}, a permanent they control (cost of ${label}).`, { rules: ['CR 701.4a', 'CR 118.3'], level: 'info' });
    }
    g.emit({ type: 'actionPerformed', verb: 'behold', actor: player, objectId: id });
    if (!part.exile) continue;
    const n = costMove(g, id, 'exile', 'exile', label);
    if (n) {
      paid.costObjects.push(n);
      if (part.link !== undefined) ((paid.costLinks ??= {})[part.link] ??= []).push({ id: n, zone: 'exile' });
    }
    g.log(`${name} exiles ${nm} (cost of ${label}).`, { rules: ['CR 701.4a', 'CR 118.3'], level: 'info' });
  }
}

/**
 * r3-cost (CR 118.3, 122.1): "Remove two +1/+1 counters from among artifacts you control": the payer chooses, counter by counter, the permanent each one comes
 * from (no choice when one permanent is left to take from; for counters of any kind, then which kind); the counters are removed together once all are
 * chosen, one event per permanent and kind. Paid only when there are that many in all (rules/cost.ts#partsDenial checked it).
 */
function removeCountersAmong(g: Game, player: PlayerId, sourceId: ObjectId | null, part: Extract<PlanPart, { kind: 'removeCounters' }>, label: string): void {
  const plan = new Map<ObjectId, Record<string, number>>();
  const left = (id: ObjectId, kind: string): number => (g.obj(id).counters[kind] ?? 0) - (plan.get(id)?.[kind] ?? 0);
  const leftAny = (id: ObjectId): number => Object.keys(g.obj(id).counters).reduce((n, k) => n + Math.max(0, left(id, k)), 0);
  const holders = amongCounterHolders(g.s, player, sourceId, part);
  for (let i = 0; i < part.count; i++) {
    const open = holders.filter((id) => (part.counter === 'any' ? leftAny(id) : left(id, part.counter)) > 0);
    if (open.length === 0) throw new IllegalAction(`There are no longer ${part.count} counters to remove for ${label}.`, ['CR 118.3']);
    let id = open[0]!;
    if (open.length > 1) {
      const ans = g.choose({
        kind: 'chooseObjects', player, min: 1, max: 1, options: open,
        prompt: `Choose the permanent to remove a ${part.counter === 'any' ? '' : `${part.counter} `}counter from${part.count > 1 ? ` (${i + 1} of ${part.count})` : ''} (cost of ${label}).`,
        rules: ['CR 118.3', 'CR 122.1'],
      });
      if (ans.ids[0] !== undefined && open.includes(ans.ids[0])) id = ans.ids[0];
    }
    let kind = part.counter;
    if (kind === 'any') {
      const kinds = Object.keys(g.obj(id).counters).filter((k) => left(id, k) > 0);
      kind = kinds[0]!;
      if (kinds.length > 1) {
        const ans = g.choose({
          kind: 'chooseOption', player, min: 1, max: 1, prompt: `Choose the kind of counter to remove from ${g.nameOf(id)} (cost of ${label}).`,
          options: kinds.map((k) => ({ id: k, label: `${k} (${left(id, k)})` })), rules: ['CR 122.1', 'CR 118.3'],
        });
        if (ans.ids[0] !== undefined && kinds.includes(ans.ids[0])) kind = ans.ids[0];
      }
    }
    const p = plan.get(id) ?? {};
    p[kind] = (p[kind] ?? 0) + 1;
    plan.set(id, p);
  }
  for (const [id, kinds] of plan) {
    const o = g.obj(id);
    const words: string[] = [];
    for (const k of Object.keys(kinds)) {
      const n = kinds[k]!;
      o.counters[k] = (o.counters[k] ?? 0) - n;
      if (o.counters[k]! <= 0) delete o.counters[k];
      g.emit({ type: 'countersChanged', target: id, counter: k, delta: -n });
      words.push(`${n} ${k} counter${n === 1 ? '' : 's'}`);
    }
    g.log(`${g.player(player).name} removes ${words.join(' and ')} from ${g.nameOf(id)} (cost of ${label}).`, { rules: ['CR 122.1', 'CR 118.3'], level: 'info' });
  }
}

/**
 * CLOUD std-ecl (CR 122.1, 118.3): "Remove two counters from this creature" names no kind: the payer removes that many counters of any kinds from the
 * permanent. With one kind there is nothing to choose; with several, the payer chooses each counter's kind in turn (as the `removeCounters` effect does,
 * effects/handlers/counters.ts). Counters of each kind go together, one event per kind, like a cost of one kind (CR 122.1).
 */
function removeAnyCounters(g: Game, player: PlayerId, id: ObjectId, count: number, label: string): void {
  const o = g.obj(id);
  const kinds = (): string[] => Object.keys(o.counters).filter((k) => (o.counters[k] ?? 0) > 0);
  const total = kinds().reduce((n, k) => n + (o.counters[k] ?? 0), 0);
  if (total < count) throw new IllegalAction(`${g.nameOf(id)} no longer has ${count} counters.`, ['CR 118.3']);
  const left: Record<string, number> = {};
  for (const k of kinds()) left[k] = o.counters[k]!;
  const plan: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const open = Object.keys(left).filter((k) => left[k]! > 0);
    let kind = open[0]!;
    if (open.length > 1) {
      const ans = g.choose({
        kind: 'chooseOption', player, min: 1, max: 1,
        prompt: `Choose the kind of counter to remove from ${g.nameOf(id)}${count > 1 ? ` (${i + 1} of ${count})` : ''} (cost of ${label}).`,
        options: open.map((k) => ({ id: k, label: `${k} (${left[k]})` })), rules: ['CR 122.1', 'CR 118.3'],
      });
      if (ans.ids[0] !== undefined && open.includes(ans.ids[0])) kind = ans.ids[0];
    }
    left[kind]! -= 1;
    plan[kind] = (plan[kind] ?? 0) + 1;
  }
  const words: string[] = [];
  for (const k of Object.keys(plan)) {
    const n = plan[k]!;
    o.counters[k] = (o.counters[k] ?? 0) - n;
    if (o.counters[k] === 0) delete o.counters[k];
    g.emit({ type: 'countersChanged', target: id, counter: k, delta: -n });
    words.push(`${n} ${k} counter${n === 1 ? '' : 's'}`);
  }
  g.log(`${g.player(player).name} removes ${words.join(' and ')} from ${g.nameOf(id)} (cost of ${label}).`, { rules: ['CR 122.1', 'CR 118.3'], level: 'info' });
}

/**
 * FAST5X E28: "Exert ~" as a COST (CR 701.43a, 118.3): "To exert a permanent, you choose to have it not untap during your next untap step." That is the MX5
 * restriction "doesn't untap during your next untap step" (a `restrict` of `untapDuringUntapStep` lasting `throughNextUntap` of the exerting player,
 * core/durations.ts#expireAfterUntapStep, CR 502.3, 611.2a) on exactly this object (CR 611.2c). CR 701.43b: an untapped or already exerted permanent can be
 * exerted; every such effect ends in the same untap step. CR 701.43c: an object that isn't on the battlefield can't be exerted (false: nothing done). Emits the
 * `exert` action of the player. The keyword action as an EFFECT is effects/handlers/exert.ts, which calls this too (std-ry8), as does the exert "as it attacks"
 * (core/attack-options.ts, CR 701.43a, 508.1).
 */
export function exertPermanent(g: Game, player: PlayerId, id: ObjectId, why: string): boolean {
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield') return false;
  addEffectRecord(g, {
    id: g.newEffectId(), source: { id, zone: 'battlefield' }, sourceName: g.nameOf(id), controller: player, timestamp: g.newTimestamp(), startedTurn: g.s.turn.number,
    duration: { d: 'throughNextUntap', whose: 'you' },
    effect: { s: 'restrict', subject: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] }, mode: 'cant', action: 'untapDuringUntapStep' },
  });
  g.emit({ type: 'actionPerformed', verb: 'exert', actor: player, objectId: id });
  g.log(`${g.player(player).name} exerts ${g.nameOf(id)} (${why}): it won't untap during their next untap step.`, { rules: ['CR 701.43a'], level: 'info' });
  return true;
}

/** CR 701.61a: to forage is to exile three cards from your graveyard or sacrifice a Food. */
function forage(g: Game, player: PlayerId, label: string, paid: Paid): void {
  const name = g.player(player).name;
  const { yard: graveyard, food } = forageOptions(g.s, player); // WP31 review: what a "can't" effect lets the player exile or sacrifice (CR 614.17b)
  if (graveyard.length < 3 && food.length === 0) throw new IllegalAction(`You can't forage for ${label}.`, ['CR 701.61a', 'CR 614.17b', 'CR 118.3']);
  let how: 'exile' | 'food' = graveyard.length >= 3 ? 'exile' : 'food';
  if (graveyard.length >= 3 && food.length > 0) {
    const ans = g.choose({
      kind: 'chooseOption', player, prompt: `Forage for ${label}: exile three cards from your graveyard or sacrifice a Food.`,
      options: [{ id: 'exile', label: 'Exile three cards from your graveyard' }, { id: 'food', label: 'Sacrifice a Food' }], min: 1, max: 1, cancellable: true, rules: ['CR 701.61a'],
    });
    how = ans.ids[0] === 'food' ? 'food' : 'exile';
  }
  const pool = how === 'exile' ? graveyard : food;
  const count = how === 'exile' ? 3 : 1;
  const ids = pool.length === count ? pool : g.choose({
    kind: 'chooseObjects', player, prompt: `${how === 'exile' ? 'Exile three cards from your graveyard' : 'Sacrifice a Food'} to forage for ${label}.`, options: pool, min: count, max: count, cancellable: true, rules: ['CR 701.61a'],
  }).ids;
  for (const id of ids) {
    const nm = g.nameOf(id);
    const n = costMove(g, id, how === 'exile' ? 'exile' : 'graveyard', how === 'exile' ? 'exile' : 'sacrifice', label);
    if (n) paid.costObjects.push(n);
    g.log(`${name} ${how === 'exile' ? 'exiles' : 'sacrifices'} ${nm} to forage (cost of ${label}).`, { rules: ['CR 701.61a', 'CR 118.3'], level: 'info' });
  }
  g.emit({ type: 'actionPerformed', verb: 'forage', actor: player });
}
