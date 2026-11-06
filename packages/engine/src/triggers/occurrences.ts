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
  // edh-d-4 (CR 603.2c, 506.3; Rigo, Oath of Kaya): "whenever you attack a player or planeswalker with one or more creatures" and "whenever an opponent attacks a planeswalker you control with one or more
  // creatures" are one occurrence for each player or planeswalker attacked (the Oath of Kaya ruling of 2019-05-03), grouped by the thing attacked
  const attackedThing = patterns.length > 0 && patterns.every((p) => p.ev === 'attacks' && (p.defender === 'planeswalker' || (p.defender === 'any' && p.orPlaneswalker === true)));
  // edh-next-40 (CR 603.2c; Layla Hassan): "When ~ enters and whenever one or more Assassins you control deal combat damage to a player": beside the object's own enters (an occurrence of its
  // own, no recipient) the damage pattern still gives one occurrence for each player dealt damage
  const oneDamage = (p: EventPattern): boolean => p.ev === 'damage' && p.recipient?.player !== undefined && p.recipient.object === undefined;
  const ownEnters = (p: EventPattern): boolean => p.ev === 'zoneChange' && (p as { subject?: { self?: boolean } }).subject?.self === true;
  // edh-d-91 (CR 603.2c, 510.2, 310.1; Zurgo and Ojutai ruling 2023-04-14: "The triggered ability will trigger once for each player or battle dealt combat damage by Dragons you control"):
  // "one or more ... deal combat damage to a player or battle" is one occurrence for each player AND each battle dealt damage, grouped by the recipient (a player or planeswalker pattern keeps its whole batch)
  const playerOrBattle = (p: EventPattern): boolean => p.ev === 'damage' && p.recipient?.player !== undefined && JSON.stringify(p.recipient.object) === '{"types":["Battle"]}';
  const anyBattle = patterns.length > 0 && patterns.every(playerOrBattle);
  const damaged = patterns.length > 0 && (patterns.every(oneDamage) || anyBattle || (patterns.length === 2 && patterns.some(oneDamage) && patterns.some(ownEnters)));
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
  if (patterns.length === 0 || (!actions && !attacked && !attackedOrWalker && !attackedThing && !damaged && !patterns.every((p) => p.ev === 'counters'))) return [matched as SemEvent[]];
  const out: SemEvent[][] = [];
  const byRecipient = new Map<string, SemEvent[]>();
  for (const e of matched) {
    // edh-d-91 (review): damage to a battle has its recipient in `roles.object` (triggers/normalize.ts#damageDealt), so a player-or-battle pattern groups by either
    const key = JSON.stringify(attackedThing ? e.roles.defender ?? null : attackedOrWalker ? e.data['defendingPlayer'] ?? null : attacked ? e.roles.defender ?? null : damaged ? (anyBattle ? e.roles.recipient ?? e.roles.object ?? null : e.roles.recipient ?? null) : actions || e.data['onPlayer'] === true ? e.roles.player ?? null : e.roles.subject ?? null);
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
  if (p.ev === 'life' && p.totalAmount === true) { const { amount: _a, ...rest } = p; return rest; } // edh-players-20: the amount is the player's total in the batch (byPlayerTotal)
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

/**
 * edh-players-8 (CR 603.2, 603.2c, 508.1a; Trouble in Pairs): a batch trigger that lists an attack declaration with a count of attackers beside single events of other kinds
 * ("whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn"). Only the attack declaration is a
 * batch: its occurrences are the attackers at each player attacked, those with enough of them (as a lone attack pattern's); every other matched event is an occurrence of its own.
 */
export function isMixedAttackList(patterns: readonly EventPattern[]): boolean {
  return patterns.length > 1 && patterns.some((p) => p.ev === 'attacks' && p.count !== undefined) && patterns.every((p) => p.ev === 'attacks' || p.ev === 'draw' || p.ev === 'cast' || p.ev === 'zoneChange' /* edh-d-70 (Kratos, Stoic Father): "whenever a God dies" beside the attack declaration: each death is its own event */);
}

/** The occurrences of a mixed list (above), in the order of their first event; `hitsOf` says which patterns each matched event fit. */
export function mixedAttackOccurrences(patterns: readonly EventPattern[], matched: readonly SemEvent[], hitsOf: ReadonlyMap<SemEvent, readonly EventPattern[]>): SemEvent[][] {
  const attackHits = matched.filter((e) => hitsOf.get(e)?.some((p) => p.ev === 'attacks') === true);
  const groups: SemEvent[][] = [];
  for (const p of patterns) {
    if (p.ev !== 'attacks') continue;
    const mine = attackHits.filter((e) => hitsOf.get(e)?.includes(p) === true);
    if (mine.length > 0) groups.push(...byAttackedCount([p], batchOccurrences([p], mine)));
  }
  for (const e of matched) if (!attackHits.includes(e)) groups.push([e]);
  return groups.sort((a, b) => matched.indexOf(a[0]!) - matched.indexOf(b[0]!));
}

/**
 * edh-players-20 (CR 603.2c, 510.2; Nelly Borca): "whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents" counts the whole
 * batch once for EACH opponent whose creatures dealt the damage (the subject names "an opponent"), with that opponent's creatures, so "the controller of those creatures" is one
 * player. Only a batch trigger of damage patterns whose source is an opponent's; null for any other (the whole batch is one occurrence, as before).
 */
export function bySourceController(patterns: readonly EventPattern[], matched: readonly SemEvent[], controllerOf: (e: SemEvent) => string | undefined): SemEvent[][] | null {
  if (patterns.length === 0 || !patterns.every((p) => p.ev === 'damage' && p.source?.controller === 'opponent' && p.recipient?.player !== undefined && p.recipient.object === undefined)) return null;
  const by = new Map<string, SemEvent[]>();
  for (const e of matched) {
    const key = controllerOf(e) ?? '';
    const group = by.get(key);
    if (group === undefined) by.set(key, [e]);
    else group.push(e);
  }
  return [...by.values()];
}

/**
 * edh-players-20 (CR 119.3, 603.2c; Ob Nixilis, Captive Kingpin): a `life` pattern with `totalAmount` compares its amount with the TOTAL life each player lost in the batch, not with each
 * life change alone: the matched events (judged without the amount, `perEventPattern`) of the players whose total passes. Every matched event for any other pattern.
 */
export function byPlayerTotal(patterns: readonly EventPattern[], matched: readonly SemEvent[], inCombatDamage: boolean): SemEvent[] {
  const totals = patterns.filter((p): p is Extract<EventPattern, { ev: 'life' }> => p.ev === 'life' && p.totalAmount === true);
  if (totals.length === 0 || totals.length !== patterns.length) return matched as SemEvent[];
  const sum = new Map<string, number>();
  const who = (e: SemEvent): string => JSON.stringify(e.roles.player ?? null);
  // only the combat damage of one step is dealt at once (CR 510.2); every other life change is an event of its own (CR 608.2c: the instructions of a resolution happen in order, 601.2g/605.3b:
  // each mana ability resolves at once), so it counts alone (review: two painlands paying for one spell are two losses of 1)
  const together = (e: SemEvent): boolean => inCombatDamage && e.data['fromDamage'] === true;
  for (const e of matched) if (together(e)) sum.set(who(e), (sum.get(who(e)) ?? 0) + (typeof e.data['amount'] === 'number' ? e.data['amount'] : 0));
  return matched.filter((e) => totals.some((p) => cmpMatches(p.amount, together(e) ? sum.get(who(e)) : (typeof e.data['amount'] === 'number' ? e.data['amount'] : undefined))));
}

/** The occurrences of an attack batch that have enough attackers at the player attacked (above); every occurrence for any other pattern. */
export function byAttackedCount(patterns: readonly EventPattern[], groups: SemEvent[][]): SemEvent[][] {
  const want = attackedCount(patterns);
  return want === undefined ? groups : groups.filter((g) => cmpMatches(want, g.length));
}
