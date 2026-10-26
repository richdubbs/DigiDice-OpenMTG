/**
 * PUSH1 T2 (CR 603.2c, 510.2): which matched events of a batch are ONE occurrence of a trigger event, for the damage triggers.
 *
 * The combat damage of one combat damage step is dealt simultaneously as one event (CR 510.2). A damage trigger that names only ONE side of the damage triggers
 * once for all the combat damage that side dealt, or was dealt, in the step: "Whenever ~ deals combat damage" once however many creatures and players the
 * damage went to (the rulings of Umezawa's Jitte and Spirit Link), "Whenever ~ is dealt damage" once however many creatures dealt it (the enrage rulings).
 * "That much" is then the total (triggers/context.ts sums the amounts of a group). A trigger that names both sides ("deals combat damage to a player",
 * "a creature deals damage to ~") still triggers once per pair, and a "one or more" trigger keeps its own batch grouping (CR 603.2c).
 *
 * Noncombat damage is one event when one instruction dealt it (one damage step: the engine marks its damage events with a shared `group`, types/events.ts);
 * noncombat damage without such a mark (a manual damage operation, a keyword action) keeps one trigger per damage event.
 *
 * Pure: reads only the trigger patterns and the semantic events. A batch of a combat damage step holds that step's damage only (triggers/normalize.ts
 * starts a batch at every step).
 */
import type { EventPattern, NumberCmp } from '../types/ability';
import type { SemEvent } from '../types/state';
import { cmpMatches } from './filters';

/** The side of the damage a lone damage pattern names when it names exactly one of them; null otherwise. */
function namedSide(patterns: readonly EventPattern[]): 'source' | 'recipient' | null {
  if (patterns.length !== 1) return null;
  const p = patterns[0]!;
  if (p.ev !== 'damage') return null;
  if (p.source !== undefined && p.recipient === undefined) return 'source';
  if (p.source === undefined && p.recipient !== undefined) return 'recipient';
  return null;
}

/** The matched events in groups, one group per occurrence of the trigger event, in the order of their first event. */
export function occurrences(patterns: readonly EventPattern[], matched: readonly SemEvent[]): SemEvent[][] {
  const side = namedSide(patterns);
  if (side === null) return matched.map((e) => [e]);
  const out: SemEvent[][] = [];
  const bySide = new Map<string, SemEvent[]>();
  for (const e of matched) {
    const combat = e.data['combat'] === true;
    const mark = e.data['group'];
    if (e.ev !== 'damage' || (!combat && typeof mark !== 'number')) {
      out.push([e]);
      continue;
    }
    // the combat damage of the batch (one step, CR 510.2), or the noncombat damage of one instruction (CR 120.2b)
    const key = `${combat ? 'combat' : `group:${mark as number}`}|${JSON.stringify(side === 'source' ? e.roles.source ?? null : e.roles.object ?? e.roles.recipient ?? null)}`;
    let group = bySide.get(key);
    if (group === undefined) {
      group = [];
      bySide.set(key, group);
      out.push(group);
    }
    group.push(e);
  }
  return out;
}

/**
 * PUSH1 T2 review (CR 603.2c): the occurrences of a "one or more" (batch) trigger. "Whenever one or more +1/+1 counters are put on a creature you control"
 * counts the counters put on A creature: each creature (or player) that gets counters in the batch is one occurrence, with its own amount (the rulings of
 * Simic Ascendancy and Shalai and Hallar: it triggers once for each of those creatures). The event hole reads such a trigger only with a singular object
 * ("a creature", "~"; parser/holes/event.ts#counterEvents). M12F: "one or more ... deal damage to a player" is one occurrence per damaged player. Every
 * other batch trigger is the whole batch, once.
 */
export function batchOccurrences(patterns: readonly EventPattern[], matched: readonly SemEvent[]): SemEvent[][] {
  // FAST4 T27 (CR 603.2c): "Whenever a player discards one or more cards" is one occurrence for each PLAYER who discards in the batch (each player's discard
  // is an occurrence of its own: one event may contain several occurrences): the matched actions are grouped by the player who did them
  const actions = patterns.length > 0 && patterns.every((p) => p.ev === 'action');
  // std-tla (CR 603.2c, 508.1b): "whenever you attack a player", "whenever one or more Halflings you control attack a player": a declaration that attacks several
  // players is one occurrence for each player attacked, with the creatures attacking that player (a player named as the defender, never "or a planeswalker")
  // (TriggerDef.wholeBatch, "whenever one or more of your opponents are attacked", keeps the whole batch instead: triggers/collect.ts, CR 603.2c)
  const attacked = patterns.length > 0 && patterns.every((p) => p.ev === 'attacks' && p.defender !== undefined && p.defender !== 'planeswalker' && p.defender !== 'battle' && p.orPlaneswalker !== true);
  // pc-combat-1 (CR 603.2c, 508.5): ... and "one or more creatures attack one of your opponents or a planeswalker they control": one occurrence for each opponent
  // attacked, directly or through a planeswalker they control (the `defendingPlayer` of the attack)
  const attackedOrWalker = patterns.length > 0 && patterns.every((p) => p.ev === 'attacks' && p.defender === 'opponent' && p.orPlaneswalker === true);
  // M12 audit (CR 603.2c, 510.2): "whenever one or more creatures you control deal combat damage to a player" is one occurrence for each player dealt damage, with
  // the damage dealt to that player, so "that player" is that one player (the Professional Face-Breaker and Popular Entertainer rulings: damage to two players
  // at once triggers it twice); a pattern that also names a permanent ("a player or planeswalker") keeps the whole batch, and "to one or more players" is
  // `TriggerDef.wholeBatch` (triggers/collect.ts)
  const damaged = patterns.length > 0 && patterns.every((p) => p.ev === 'damage' && p.recipient?.player !== undefined && p.recipient.object === undefined);
  // p2-c-dieroll-1 (CR 706.1, 603.2c, unverified): "whenever you roll one or more dice" is one occurrence for each instruction by which a player rolls (core/dice.ts#rollDice)
  const rolled = patterns.length > 0 && patterns.every((p) => p.ev === 'dieRoll');
  if (rolled) {
    const byRoll = new Map<string, SemEvent[]>();
    for (const e of matched) {
      const key = JSON.stringify([e.roles.player ?? null, e.data['instruction'] ?? null]);
      const group = byRoll.get(key);
      if (group === undefined) byRoll.set(key, [e]);
      else group.push(e);
    }
    return [...byRoll.values()];
  }
  if (patterns.length === 0 || (!actions && !attacked && !attackedOrWalker && !damaged && !patterns.every((p) => p.ev === 'counters'))) return [matched as SemEvent[]];
  const out: SemEvent[][] = [];
  const byRecipient = new Map<string, SemEvent[]>();
  for (const e of matched) {
    const key = JSON.stringify(attackedOrWalker ? e.data['defendingPlayer'] ?? null : attacked ? e.roles.defender ?? null : damaged ? e.roles.recipient ?? null : actions || e.data['onPlayer'] === true ? e.roles.player ?? null : e.roles.subject ?? null);
    let group = byRecipient.get(key);
    if (group === undefined) {
      group = [];
      byRecipient.set(key, group);
      out.push(group);
    }
    group.push(e);
  }
  return out;
}

/**
 * std-mkm (CR 603.2c, 510.2, 120.2b): the amount of a lone damage pattern that names ONE side ("whenever ~ is dealt 3 or more damage", Innocent Bystander) is
 * the damage of one occurrence: all the damage that side was dealt (or dealt) at once, however many sources (recipients) shared it, the total `contextOf` reads
 * as "that much". So it is compared with the occurrence's total, never with one source's part of it: each event is matched without it (`perEventPattern`), and
 * the occurrences whose total fails it are dropped (`byOccurrenceAmount`). A pattern that names both sides keeps one occurrence per pair (one event).
 */
function occurrenceAmount(patterns: readonly EventPattern[]): NumberCmp | undefined {
  const p = patterns[0];
  return namedSide(patterns) !== null && p?.ev === 'damage' ? p.amount : undefined;
}

/** The pattern each event of a batch is matched with: without the occurrence's amount (above), else the pattern itself. */
export function perEventPattern(p: EventPattern, patterns: readonly EventPattern[]): EventPattern {
  // pc-combat-3 (CR 508.1a-b, 603.2c): the count of "an opponent attacks you with two or more creatures" is of the attackers at THAT player (each attack event is matched without it)
  if (attackedCount(patterns) !== undefined && p.ev === 'attacks') {
    const { count: _count, ...rest } = p;
    return rest;
  }
  if (p.ev !== 'damage' || occurrenceAmount(patterns) === undefined) return p;
  const { amount: _amount, ...rest } = p;
  return rest;
}

/** The occurrences whose total damage passes the amount of a one-sided damage pattern (above); every occurrence for any other pattern. */
export function byOccurrenceAmount(patterns: readonly EventPattern[], groups: SemEvent[][]): SemEvent[][] {
  const want = occurrenceAmount(patterns);
  if (want === undefined) return groups;
  return groups.filter((group) => cmpMatches(want, group.reduce((t, e) => t + (typeof e.data['amount'] === 'number' ? e.data['amount'] : 0), 0)));
}

/**
 * pc-combat-3 (CR 508.1a-b, 603.2c; Everett K. Ross): "Whenever an opponent attacks you with two or more creatures" counts the creatures attacking that player, not all the
 * attackers of the declaration (one attacking you and one attacking your planeswalker are not two). Only a lone attacks pattern with a player defender (no planeswalker) and a
 * count above one; the occurrences are the attackers at each player attacked (batchOccurrences), and the count is of the occurrence.
 */
function attackedCount(patterns: readonly EventPattern[]): NumberCmp | undefined {
  const p = patterns[0];
  if (patterns.length !== 1 || p?.ev !== 'attacks' || p.count === undefined || p.defender === undefined || p.defender === 'planeswalker' || p.defender === 'battle' || p.orPlaneswalker === true) return undefined;
  return typeof p.count.value === 'number' && p.count.value > 1 ? p.count : undefined;
}

/** The occurrences of an attack batch that have enough attackers at the player attacked (above); every occurrence for any other pattern. */
export function byAttackedCount(patterns: readonly EventPattern[], groups: SemEvent[][]): SemEvent[][] {
  const want = attackedCount(patterns);
  return want === undefined ? groups : groups.filter((g) => cmpMatches(want, g.length));
}
