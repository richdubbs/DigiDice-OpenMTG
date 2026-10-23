/**
 * WP4, rules/history.ts: the history fields of ObjectFilter (`enteredThisTurn`, `dealtDamageThisTurn`, `attackedThisTurn`, `blockedThisTurn`) and the
 * `happened` / `happenedCount` readers read `GameState.history` (design 3.3, 3.4; CR 603.4). The entries are written the way the facts convention of
 * rules/history.ts says WP8's normalizer must write them (`makeHistoryEntry`, `objectFacts`).
 */
import { describe, expect, it } from 'vitest';
import { EngineBug } from '../../../src/core/errors';
import { evalCond, evalQty } from '../../../src/effects/eval';
import type { EventPattern, GameState, HistoryEntry, ObjectFilter, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { findObjects, matchesFilter, NO_ENV } from '../../../src/rules/filter';
import { countHistory, historyInScope, historyMatches, makeHistoryEntry, objectFacts, currentCombatNumber, type FactsEnv } from '../../../src/rules/history';
import { ctxOn, entry, find, scenario } from './helpers';

function board() {
  const s = scenario(['Grizzly Bears', 'Serra Angel', 'Hill Giant', 'Llanowar Elves', 'Lightning Bolt', 'Plains'], {
    p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Llanowar Elves', 'Plains'] },
    p2: { battlefield: ['Hill Giant'] },
  });
  s.history = []; // WP8 writes the history of the setup too (the opening hands, the first step): these tests write their own entries
  const id = (n: string, owner = 'p1') => find(s, n, 'battlefield', owner);
  const facts = (oid: ObjectId) => objectFacts(getChars(s, oid), s.objects[oid]!);
  const add = (e: HistoryEntry) => { s.history.push(e); return e; };
  return { s, id, facts, add };
}
const env = (_s: GameState, you = 'p1'): FactsEnv => ({ you, resolvePlayers: (ref) => (ref.ref === 'you' ? [you] : undefined) });

describe('the four history fields of ObjectFilter read this turn\'s entries (CR 603.4)', () => {
  it('enteredThisTurn: entered the battlefield this turn (as this object, CR 400.7); an entry from an earlier turn doesn\'t count', () => {
    const { s, id, facts, add } = board();
    const bears = id('Grizzly Bears');
    const elves = id('Llanowar Elves');
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: bears, facts: { ...facts(bears), from: 'hand', to: 'battlefield' } }));
    add({ ...makeHistoryEntry(s, { ev: 'zoneChange', subject: elves, facts: { ...facts(elves), from: 'hand', to: 'battlefield' } }), turn: s.turn.number - 1 });
    const ctx = { you: 'p1', env: NO_ENV };
    const names = (f: ObjectFilter) => findObjects(s, { types: ['Creature'], controller: 'you', ...f }, ctx).map((o) => o.defId);
    expect(names({ enteredThisTurn: true })).toEqual(['Grizzly Bears']);
    expect(names({ enteredThisTurn: false })).toEqual(['Serra Angel', 'Llanowar Elves']);
  });

  it('dealtDamageThisTurn (Death-Rattle Oni: "destroy all other creatures that were dealt damage this turn")', () => {
    const { s, id, facts, add } = board();
    const giant = id('Hill Giant', 'p2');
    const bears = id('Grizzly Bears');
    add(makeHistoryEntry(s, { ev: 'damage', subject: giant, actor: 'p2', facts: { ...facts(giant), amount: 2, combat: false, toPlayer: false } }));
    add(makeHistoryEntry(s, { ev: 'damage', subject: bears, actor: 'p1', facts: { ...facts(bears), amount: 0, combat: false, toPlayer: false } })); // 0 damage is no event (CR 614.7a)
    const oni = find(s, 'Grizzly Bears', 'battlefield'); // stands in for the source
    const ctx = { you: 'p1', sourceId: oni, env: NO_ENV };
    const hit = findObjects(s, { types: ['Creature'], other: true, dealtDamageThisTurn: true }, ctx).map((o) => o.defId);
    expect(hit).toEqual(['Hill Giant']);
    expect(matchesFilter(s, s.objects[id('Serra Angel')]!, { dealtDamageThisTurn: false }, ctx)).toBe(true);
    // the same fact the other way round: a creature that changed zones since is a different object and was not dealt damage (CR 400.7)
    s.history[0]!.subject = 'o999';
    expect(findObjects(s, { types: ['Creature'], dealtDamageThisTurn: true }, ctx)).toEqual([]);
  });

  it('attackedThisTurn and blockedThisTurn', () => {
    const { s, id, facts, add } = board();
    add(makeHistoryEntry(s, { ev: 'attacks', subject: id('Serra Angel'), actor: 'p1', facts: { ...facts(id('Serra Angel')), alone: true, count: 1, defenderKind: 'player', defendingPlayer: 'p2' } }));
    add(makeHistoryEntry(s, { ev: 'blocks', subject: id('Hill Giant', 'p2'), actor: 'p2', facts: { ...facts(id('Hill Giant', 'p2')), ['attacker.name']: 'Serra Angel' } }));
    const names = (f: ObjectFilter) => findObjects(s, { types: ['Creature'], ...f }, { you: 'p1', env: NO_ENV }).map((o) => o.defId);
    expect(names({ attackedThisTurn: true })).toEqual(['Serra Angel']);
    expect(names({ attackedThisTurn: false }).sort()).toEqual(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves']);
    expect(names({ blockedThisTurn: true })).toEqual(['Hill Giant']);
    expect(names({ blockedThisTurn: false, controller: 'you' })).toEqual(['Grizzly Bears', 'Serra Angel', 'Llanowar Elves']);
  });
});

describe('scopes: turn, combat, game', () => {
  it('a turn entry belongs to its turn; a game entry to every turn; a combat entry to the combat in progress only', () => {
    const { s, add } = board();
    add(entry({ ev: 'life', turn: s.turn.number, combat: 0, actor: 'p1', facts: { change: 'gain', amount: 1 } }));
    add(entry({ ev: 'life', turn: s.turn.number - 1, combat: 0, actor: 'p1', facts: { change: 'gain', amount: 1 } }));
    add(entry({ ev: 'life', turn: s.turn.number, combat: 1, actor: 'p1', facts: { change: 'gain', amount: 1 } }));
    expect(historyInScope(s, 'game')).toHaveLength(3);
    expect(historyInScope(s, 'turn')).toHaveLength(2);
    expect(historyInScope(s, 'combat')).toEqual([]); // no combat in progress
    s.combat = { number: 1, attacked: false, attackers: [], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] };
    expect(currentCombatNumber(s)).toBe(1);
    expect(historyInScope(s, 'combat')).toHaveLength(1);
    s.combat.number = 2; // a second combat phase this turn (CR 500.8)
    add(entry({ ev: 'life', turn: s.turn.number, combat: 2, actor: 'p1', facts: { change: 'gain', amount: 1 } }));
    expect(currentCombatNumber(s)).toBe(2);
    expect(historyInScope(s, 'combat')).toHaveLength(1);
  });

  it('makeHistoryEntry stamps the current turn and combat', () => {
    const { s } = board();
    s.turn.number = 4;
    expect(makeHistoryEntry(s, { ev: 'draw', actor: 'p1' })).toEqual({ turn: 4, combat: 0, ev: 'draw', actor: 'p1', facts: {} });
    s.combat = { number: 1, attacked: false, attackers: [], blockers: [], damageSteps: 0, extraDamageStep: false, firstStrikers: [] };
    expect(makeHistoryEntry(s, { ev: 'draw' }).combat).toBe(1);
  });
});

describe('happened / happenedCount: "a creature died this turn" and friends (CR 603.4, 700.4)', () => {
  const died: EventPattern = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };

  function turnOfDeaths() {
    const b = board();
    const { s, id, facts, add } = b;
    // Grizzly Bears (p1) and Hill Giant (p2) died; an Island token... a land died too (not a creature).
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o901', actor: 'p1', facts: { ...facts(id('Grizzly Bears')), from: 'battlefield', to: 'graveyard' } }));
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o902', actor: 'p2', facts: { ...facts(id('Hill Giant', 'p2')), from: 'battlefield', to: 'graveyard' } }));
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o903', actor: 'p1', facts: { ...facts(id('Plains')), from: 'battlefield', to: 'graveyard' } }));
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o904', actor: 'p1', facts: { ...facts(id('Serra Angel')), from: 'battlefield', to: 'exile' } }));
    add({ ...makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o905', actor: 'p1', facts: { ...facts(id('Llanowar Elves')), from: 'battlefield', to: 'graveyard' } }), turn: s.turn.number - 1 });
    return b;
  }

  it('happenedCount counts the events of the scope that match (creatures only, battlefield to graveyard only, this turn only)', () => {
    const { s } = turnOfDeaths();
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(evalQty(cx, { q: 'happenedCount', event: died, scope: 'turn' })).toBe(2);
    expect(evalQty(cx, { q: 'happenedCount', event: died, scope: 'game' })).toBe(3);
    expect(evalQty(cx, { q: 'happenedCount', event: died, scope: 'turn', by: 'you' })).toBe(1); // "that died under your control" style: by the actor
    expect(evalQty(cx, { q: 'happenedCount', event: { ...died, subject: { types: ['Creature'], controller: 'opponent' } }, scope: 'turn' })).toBe(1);
    expect(evalQty(cx, { q: 'happenedCount', event: { ...died, to: ['graveyard', 'exile'] }, scope: 'turn' })).toBe(3);
    expect(evalQty(cx, { q: 'happenedCount', event: { ...died, subject: { colors: ['G'] } }, scope: 'turn' })).toBe(1);
    expect(evalQty(cx, { q: 'happenedCount', event: { ...died, subject: { power: { op: '>=', value: 3 } } }, scope: 'turn' })).toBe(1);
    expect(evalQty(cx, { q: 'happenedCount', event: { ev: 'draw' }, scope: 'turn' })).toBe(0);
  });

  it('Death-Rattle Oni: "costs {2} less for each creature that died this turn" is a quantity over the history', () => {
    const { s } = turnOfDeaths();
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(evalQty(cx, { q: 'math', op: '*', args: [2, { q: 'happenedCount', event: died, scope: 'turn' }] })).toBe(4);
  });

  it('happened: at least one by default, or a comparison of the count ("if two or more creatures died this turn")', () => {
    const { s } = turnOfDeaths();
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(evalCond(cx, { cond: 'happened', event: died, scope: 'turn' })).toBe(true);
    expect(evalCond(cx, { cond: 'happened', event: died, scope: 'turn', times: { op: '>=', value: 2 } })).toBe(true);
    expect(evalCond(cx, { cond: 'happened', event: died, scope: 'turn', times: { op: '>=', value: 3 } })).toBe(false);
    expect(evalCond(cx, { cond: 'happened', event: died, scope: 'turn', times: { op: '==', value: 0 } })).toBe(false);
    expect(evalCond(cx, { cond: 'happened', event: { ev: 'draw' }, scope: 'turn', times: { op: '==', value: 0 } })).toBe(true);
    expect(evalCond(cx, { cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Artifact'] }, to: 'graveyard' }, scope: 'turn' })).toBe(false);
  });

  it('the controller\'s own events: cast, draw (nth), life, step, counters, attacks (alone, count, defender), blocks, damage, tokens, actions, dice, turns', () => {
    const { s, facts, id, add } = board();
    const bolt = 'o910';
    add(makeHistoryEntry(s, { ev: 'cast', subject: bolt, actor: 'p1', facts: { name: 'Lightning Bolt', types: '|Instant|', subtypes: '||', supertypes: '||', colors: '|R|', manaValue: 1, names: '|Lightning Bolt|', keywords: '||', token: false, isCard: true, controller: 'p1', owner: 'p1', id: bolt, from: 'hand' } }));
    add(makeHistoryEntry(s, { ev: 'cast', subject: 'o911', actor: 'p2', facts: { name: 'Hill Giant', types: '|Creature|', subtypes: '|Giant|', supertypes: '||', colors: '|R|', manaValue: 4, names: '|Hill Giant|', keywords: '||', token: false, isCard: true, controller: 'p2', owner: 'p2', id: 'o911', from: 'graveyard', copy: true } }));
    add(makeHistoryEntry(s, { ev: 'draw', actor: 'p1', facts: { nth: 1 } }));
    add(makeHistoryEntry(s, { ev: 'draw', actor: 'p1', facts: { nth: 2 } }));
    add(makeHistoryEntry(s, { ev: 'life', actor: 'p2', facts: { change: 'loss', amount: 3 } }));
    add(makeHistoryEntry(s, { ev: 'step', actor: 'p1', facts: { step: 'upkeep' } }));
    add(makeHistoryEntry(s, { ev: 'counters', subject: id('Grizzly Bears'), facts: { ...facts(id('Grizzly Bears')), change: 'put', kind: '+1/+1', total: 2, onPlayer: false } }));
    add(makeHistoryEntry(s, { ev: 'counters', actor: 'p2', facts: { change: 'put', kind: 'poison', total: 1, onPlayer: true, recipientPlayer: 'p2' } }));
    add(makeHistoryEntry(s, { ev: 'attacks', subject: id('Serra Angel'), actor: 'p1', facts: { ...facts(id('Serra Angel')), alone: false, count: 2, defenderKind: 'player', defendingPlayer: 'p2' } }));
    add(makeHistoryEntry(s, { ev: 'attacks', subject: id('Grizzly Bears'), actor: 'p1', facts: { ...facts(id('Grizzly Bears')), alone: false, count: 2, defenderKind: 'planeswalker' } }));
    add(makeHistoryEntry(s, { ev: 'damage', subject: id('Hill Giant', 'p2'), actor: 'p2', facts: { ...facts(id('Hill Giant', 'p2')), amount: 3, combat: true, toPlayer: false, ...objectFacts(getChars(s, id('Serra Angel')), s.objects[id('Serra Angel')]!, 'source.') } }));
    add(makeHistoryEntry(s, { ev: 'damage', actor: 'p2', facts: { amount: 2, combat: false, toPlayer: true, recipientPlayer: 'p2', ...objectFacts(getChars(s, id('Serra Angel')), s.objects[id('Serra Angel')]!, 'source.') } }));
    add(makeHistoryEntry(s, { ev: 'createToken', subject: 'o920', actor: 'p1', facts: { ...facts(id('Llanowar Elves')), token: true } }));
    add(makeHistoryEntry(s, { ev: 'action', subject: id('Plains'), actor: 'p1', facts: { ...facts(id('Plains')), verb: 'sacrifice' } }));
    add(makeHistoryEntry(s, { ev: 'dieRoll', actor: 'p1', facts: { result: 6 } }));
    add(makeHistoryEntry(s, { ev: 'beginTurn', actor: 'p1', facts: { extra: true } }));
    add(makeHistoryEntry(s, { ev: 'blocks', subject: id('Hill Giant', 'p2'), actor: 'p2', facts: { ...facts(id('Hill Giant', 'p2')), ...objectFacts(getChars(s, id('Serra Angel')), s.objects[id('Serra Angel')]!, 'attacker.') } }));
    add(makeHistoryEntry(s, { ev: 'becomes', subject: id('Serra Angel'), actor: 'p1', facts: { ...facts(id('Serra Angel')), what: 'tapped' } }));
    add(makeHistoryEntry(s, { ev: 'activate', actor: 'p1', subject: id('Llanowar Elves'), facts: { ...facts(id('Llanowar Elves')), mana: true } }));
    add(makeHistoryEntry(s, { ev: 'resolves', subject: bolt, facts: { name: 'Lightning Bolt', types: '|Instant|', subtypes: '||', supertypes: '||', colors: '|R|', manaValue: 1, names: '|Lightning Bolt|', keywords: '||', token: false, isCard: true, controller: 'p1', owner: 'p1', id: bolt } }));
    const e = env(s);
    const n = (p: EventPattern, by?: 'you' | 'opponent') => countHistory(s, p, 'turn', by, e);
    expect(n({ ev: 'cast', spell: { types: ['Instant'] } })).toBe(1);
    expect(n({ ev: 'cast' })).toBe(1); // the copy's entry doesn't count unless the pattern says orCopy
    expect(n({ ev: 'cast', orCopy: true })).toBe(2);
    expect(n({ ev: 'cast', player: 'opponent', orCopy: true })).toBe(1);
    expect(n({ ev: 'cast', from: 'hand' })).toBe(1);
    expect(n({ ev: 'draw', player: 'you' })).toBe(2);
    expect(n({ ev: 'draw', player: 'you', nth: 2 })).toBe(1);
    expect(n({ ev: 'life', change: 'loss', player: 'opponent' })).toBe(1);
    expect(n({ ev: 'life', change: 'loss', player: 'opponent', amount: { op: '>=', value: 4 } })).toBe(0);
    expect(n({ ev: 'life', change: 'gain' })).toBe(0);
    expect(n({ ev: 'step', step: 'upkeep', whose: 'you' })).toBe(1);
    expect(n({ ev: 'step', step: 'upkeep', whose: 'opponent' })).toBe(0);
    expect(n({ ev: 'counters', change: 'put', kind: '+1/+1', on: { types: ['Creature'] } })).toBe(1);
    expect(n({ ev: 'counters', change: 'put', on: { player: 'opponent' } })).toBe(1);
    expect(n({ ev: 'counters', change: 'put', on: { player: 'you' } })).toBe(0);
    expect(n({ ev: 'counters', change: 'put', on: { types: ['Creature'] }, atLeast: 2 })).toBe(1);
    expect(n({ ev: 'counters', change: 'put', on: { types: ['Creature'] }, atLeast: 3 })).toBe(0);
    expect(n({ ev: 'attacks' })).toBe(2);
    expect(n({ ev: 'attacks', alone: true })).toBe(0);
    expect(n({ ev: 'attacks', count: { op: '>=', value: 2 } })).toBe(2);
    expect(n({ ev: 'attacks', defender: 'opponent' })).toBe(1);
    expect(n({ ev: 'attacks', defender: 'planeswalker' })).toBe(1);
    expect(n({ ev: 'attacks', attacker: { keyword: 'flying' } })).toBe(1); // the facts keep the keywords (Serra Angel attacked)
    expect(n({ ev: 'blocks', blocker: { types: ['Creature'] }, attacker: { name: 'Serra Angel' } })).toBe(1);
    expect(n({ ev: 'blocks', attacker: { name: 'Grizzly Bears' } })).toBe(0);
    expect(n({ ev: 'damage', combat: true })).toBe(1);
    expect(n({ ev: 'damage', recipient: { player: 'opponent' } })).toBe(1);
    expect(n({ ev: 'damage', recipient: { object: { types: ['Creature'] } } })).toBe(1);
    expect(n({ ev: 'damage', source: { name: 'Serra Angel' } })).toBe(2);
    expect(n({ ev: 'damage', source: { name: 'Grizzly Bears' } })).toBe(0);
    expect(n({ ev: 'damage', amount: { op: '>=', value: 3 } })).toBe(1);
    expect(n({ ev: 'createToken', token: { token: true } })).toBe(1);
    expect(n({ ev: 'action', verb: 'sacrifice', object: { types: ['Land'] } })).toBe(1);
    expect(n({ ev: 'action', verb: 'discard' })).toBe(0);
    expect(n({ ev: 'dieRoll', result: { op: '==', value: 6 } })).toBe(1);
    expect(n({ ev: 'beginTurn', extra: true, whose: 'you' })).toBe(1);
    expect(n({ ev: 'becomes', what: 'tapped', object: { name: 'Serra Angel' } })).toBe(1);
    expect(n({ ev: 'activate', manaAbility: true })).toBe(1);
    expect(n({ ev: 'activate' })).toBe(0);
    expect(n({ ev: 'resolves', what: { types: ['Instant'] } })).toBe(1);
  });

  it('a pattern or filter field the facts cannot answer is a loud error, never a quiet zero', () => {
    const { s, id, facts, add } = board();
    add(makeHistoryEntry(s, { ev: 'zoneChange', subject: 'o901', facts: { ...facts(id('Grizzly Bears')), from: 'battlefield', to: 'graveyard' } }));
    const e = env(s);
    expect(() => countHistory(s, { ev: 'zoneChange', subject: { tapped: true } }, 'turn', undefined, e)).toThrow(EngineBug);
    expect(() => countHistory(s, { ev: 'state', cond: { cond: 'all', of: [] } }, 'turn', undefined, e)).not.toThrow(); // other events never match it
    s.history.push(entry({ ev: 'state', turn: s.turn.number }));
    expect(() => countHistory(s, { ev: 'state', cond: { cond: 'all', of: [] } }, 'turn', undefined, e)).toThrow(EngineBug);
    s.history.push(entry({ ev: 'blocks', turn: s.turn.number, subject: 'o1', facts: {} }));
    expect(() => countHistory(s, { ev: 'blocks', attacker: { name: 'X' } }, 'turn', undefined, e)).toThrow('has no "attacker.names" fact');
    expect(() => countHistory(s, { ev: 'blocks' }, 'turn', undefined, e)).not.toThrow(); // nothing asked about the missing facts
  });

  it('historyMatches: the filter fields over facts (controller, owner, name, token, isCard, self / other, not / anyOf, colorless, multicolored, mana value, supertypes, subtypes)', () => {
    const { id, facts } = board();
    const e = entry({ ev: 'zoneChange', subject: 'o901', facts: { ...facts(id('Serra Angel')), from: 'battlefield', to: 'graveyard' } });
    const ctx: FactsEnv = { you: 'p1', sourceId: 'o901' };
    const ok = (subject: ObjectFilter) => historyMatches(e, { ev: 'zoneChange', subject }, ctx);
    expect(ok({ controller: 'you', owner: 'you', name: 'Serra Angel', token: false, isCard: true, self: true })).toBe(true);
    expect(ok({ other: true })).toBe(false);
    expect(ok({ controller: 'opponent' })).toBe(false);
    expect(ok({ not: { colors: ['W'] } })).toBe(false);
    expect(ok({ anyOf: [{ colors: ['R'] }, { colors: ['W'] }] })).toBe(true);
    expect(ok({ colorless: false, multicolored: false, monocolored: true })).toBe(true);
    expect(ok({ manaValue: { op: '==', value: 5 }, power: { op: '>=', value: 4 }, toughness: { op: '<=', value: 4 } })).toBe(true);
    expect(ok({ subtypes: ['Angel'], notSubtypes: ['Human'], allTypes: ['Creature'], notTypes: ['Land'], notColors: ['B'], notName: 'Hill Giant', notSupertypes: ['Legendary'] })).toBe(true);
    expect(ok({ keyword: 'flying' })).toBe(true);
    expect(ok({ notKeyword: ['flying'] })).toBe(false);
    expect(ok({ supertypes: ['Legendary'] })).toBe(false);
    expect(ok({ zone: 'battlefield' })).toBe(true); // the pattern's own from / to say where
    expect(historyMatches(e, { ev: 'zoneChange', subject: {}, from: 'hand' }, ctx)).toBe(false);
  });
});

describe('a player reference in a history pattern is resolved through the context, or it is a loud error', () => {
  it('by / player given as a reference', () => {
    const { s, add } = board();
    add(makeHistoryEntry(s, { ev: 'draw', actor: 'p2', facts: { nth: 1 } }));
    expect(countHistory(s, { ev: 'draw', player: { ref: 'each', who: 'opponent' } }, 'turn', undefined, { you: 'p1', resolvePlayers: () => ['p2'] })).toBe(1);
    expect(() => countHistory(s, { ev: 'draw', player: { ref: 'each', who: 'opponent' } }, 'turn', undefined, { you: 'p1' })).toThrow(EngineBug);
  });
});
