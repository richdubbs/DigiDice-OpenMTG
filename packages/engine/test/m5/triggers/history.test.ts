/**
 * WP8: `GameState.history` (design 3.4, 4.1): "this turn" facts for conditions, quantities and history filters (CR 603.4 style), written from the normalized
 * events and stamped with the turn they happened in (never pruned: the scope game reads them all).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { dealDamage } from '../../../src/rules/damage';
import { newCombat } from '../../../src/rules/combat-state';
import { collectPendingTriggers } from '../../../src/core/triggers';
import { EngineBug } from '../../../src/core/errors';
import { countHistory, entryMatches, happened, objectHistory } from './history-api';
import { creatureDies, vanilla } from './cards';
import { find, gameOf, move, scenario } from './helpers';

const start = (): GameState => scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other', ['3', '3'])], p1: { battlefield: ['Test Vanilla', 'Plains'], hand: ['Test Other'] }, p2: { battlefield: ['Test Other'] } });

describe('what is recorded', () => {
  it('a creature dying is recorded with what it was: its types, controller and mana value (last known information)', () => {
    const s0 = start();
    const g = gameOf(s0);
    g.s.history = [];
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    const e = g.s.history.find((h) => h.ev === 'zoneChange')!;
    expect(e).toMatchObject({ turn: g.s.turn.number, actor: 'p1' });
    expect(e.facts).toMatchObject({ from: 'battlefield', to: 'graveyard', name: 'Test Vanilla', controller: 'p1', types: '|Creature|', power: 2, token: false, isCard: true }); // WP4's convention (rules/history.ts#objectFacts)
  });

  it('step events are kept too (a `step` pattern can be read back; the beginning of combat also gives the combat number); mana abilities are not (one entry per land would drown the rest)', () => {
    const g = gameOf(start());
    g.s.history = [];
    g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' });
    g.emit({ type: 'stepBegan', step: 'beginCombat', activePlayer: 'p1' });
    g.emit({ type: 'manaAdded', player: 'p1', mana: ['W'], sourceId: find(g.s, 'Plains', 'battlefield'), viaActivation: true });
    collectPendingTriggers(g);
    expect(g.s.history.map((h) => h.facts['step'])).toEqual(['upkeep', 'beginCombat']);
  });
});

describe('reading it back (the happened condition, the happenedCount quantity, the history filters)', () => {
  it('"a creature died this turn": the scope turn, and "you"/"opponent" relative to the asker', () => {
    const s0 = start();
    const g = gameOf(s0);
    expect(happened(g.s, { cond: 'happened', event: creatureDies, scope: 'turn' }, 'p1')).toBe(false);
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    expect(happened(g.s, { cond: 'happened', event: creatureDies, scope: 'turn' }, 'p1')).toBe(true);
    expect(countHistory(g.s, { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }, 'turn', 'p1')).toBe(1);
    expect(countHistory(g.s, { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }, 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }, 'turn', 'p2')).toBe(1);
    expect(happened(g.s, { cond: 'happened', event: creatureDies, scope: 'turn', times: { op: '>=', value: 2 } }, 'p1')).toBe(false);
  });

  it('counts events and honors "by": two spells cast, by whom', () => {
    const g = gameOf(start());
    for (const [player, id] of [['p1', 'a'], ['p1', 'b'], ['p2', 'c']] as const) g.emit({ type: 'spellCast', objectId: id, player });
    collectPendingTriggers(g);
    expect(countHistory(g.s, { ev: 'cast' }, 'turn', 'p1', 'you')).toBe(2);
    expect(countHistory(g.s, { ev: 'cast' }, 'turn', 'p1', 'opponent')).toBe(1);
    expect(countHistory(g.s, { ev: 'cast' }, 'turn', 'p1')).toBe(3);
    expect(happened(g.s, { cond: 'happened', event: { ev: 'cast', player: 'you' }, scope: 'turn', times: { op: '>=', value: 2 } }, 'p1')).toBe(true);
  });

  it('the history filters of objects: entered this turn, dealt damage this turn, attacked this turn', () => {
    const s0 = start();
    const g = gameOf(s0);
    const mine = find(s0, 'Test Vanilla', 'battlefield');
    const entered = move(g, find(s0, 'Test Other', 'hand', 'p1'), 'battlefield', { cause: 'resolve' })!;
    dealDamage(g, mine, find(s0, 'Test Other', 'battlefield', 'p2'), 1);
    g.emit({ type: 'attackersDeclared', attackers: [{ attacker: mine, defender: 'p2' }] });
    collectPendingTriggers(g);
    expect(objectHistory(g.s, entered, 'enteredThisTurn')).toBe(true);
    expect(objectHistory(g.s, mine, 'enteredThisTurn')).toBe(false);
    expect(objectHistory(g.s, find(s0, 'Test Other', 'battlefield', 'p2'), 'dealtDamageThisTurn')).toBe(true);
    expect(objectHistory(g.s, mine, 'dealtDamageThisTurn')).toBe(false);
    expect(objectHistory(g.s, mine, 'attackedThisTurn')).toBe(true);
    expect(objectHistory(g.s, entered, 'attackedThisTurn')).toBe(false);
  });

  it('the combat number tells the combats of a turn apart (scope combat)', () => {
    const g = gameOf(start());
    g.s.history = [];
    g.s.combat = newCombat(g.s); // what core/combat.ts#beginCombat does: the combat phase is numbered (CR 500.8) and the entries are stamped with it
    g.emit({ type: 'stepBegan', step: 'beginCombat', activePlayer: 'p1' });
    g.emit({ type: 'damageDealt', source: find(g.s, 'Test Vanilla', 'battlefield'), target: 'p2', amount: 2, combat: true });
    collectPendingTriggers(g);
    g.s.combat = newCombat(g.s); // an extra combat phase
    g.emit({ type: 'stepBegan', step: 'beginCombat', activePlayer: 'p1' }); // the second
    g.emit({ type: 'damageDealt', source: find(g.s, 'Test Vanilla', 'battlefield'), target: 'p2', amount: 2, combat: true });
    collectPendingTriggers(g);
    const dmg: Parameters<typeof countHistory>[1] = { ev: 'damage', combat: true };
    expect(countHistory(g.s, dmg, 'turn', 'p1')).toBe(2);
    expect(countHistory(g.s, dmg, 'combat', 'p1')).toBe(1);
  });

  it('a pattern the facts cannot answer is never answered silently: it throws (the capability walker makes such a card manual), and identity is answered from the ids', () => {
    const g = gameOf(start());
    move(g, find(g.s, 'Test Vanilla', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    const e = g.s.history.find((h) => h.ev === 'zoneChange' && h.facts['to'] === 'graveyard')!;
    expect(() => entryMatches({ ev: 'zoneChange', subject: { sharesWith: { with: { ref: 'self' }, quality: 'color' } } }, e, 'p1')).toThrow(EngineBug);
    expect(entryMatches({ ev: 'zoneChange', subject: { types: ['Creature'] } }, e, 'p1')).toBe(true);
    expect(entryMatches({ ev: 'zoneChange', subject: { types: ['Land'] } }, e, 'p1')).toBe(false);
  });
});

describe('scopes', () => {
  it('a new turn does not forget the old one: the scope turn looks at this turn only, the scope game at all of them (every kind of event, see history-fixes.test.ts)', () => {
    const g = gameOf(start());
    g.s.history = [];
    g.emit({ type: 'spellCast', objectId: 'a', player: 'p1' });
    move(g, find(g.s, 'Test Vanilla', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    expect(g.s.history.map((h) => h.ev)).toEqual(expect.arrayContaining(['cast', 'zoneChange']));
    g.s.turn.number++;
    g.emit({ type: 'lifeChanged', player: 'p1', delta: 1, life: 21 });
    collectPendingTriggers(g);
    expect(g.s.history.filter((h) => h.turn < g.s.turn.number).map((h) => h.ev)).toEqual(expect.arrayContaining(['cast', 'zoneChange']));
    expect(countHistory(g.s, { ev: 'cast' }, 'game', 'p1')).toBe(1);
    expect(countHistory(g.s, { ev: 'cast' }, 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, creatureDies, 'game', 'p1')).toBe(1);
  });
});
