/**
 * WP8 review fixes for `GameState.history` (design 3.4, 4.1): CR 603.4 style "happened this turn / this game" reads.
 *  - the scope `game` keeps every kind of event, not only casts;
 *  - `syncHistory(g)` brings the history up to date in the middle of a resolution, without collecting triggers, and nothing is recorded twice;
 *  - `counters` and `step` entries can be read back (they were recorded but never matched);
 *  - every entry is stamped with the turn it happened in, not the turn it was collected in (the opening hands are turn 0).
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern, GameState } from '../../../src/index';
import { collectPendingTriggers, syncHistory } from '../../../src/core/triggers';
import { addCounters } from '../../../src/rules/counters';
import { countHistory, entryMatches, happened } from './history-api';
import { creatureDies, vanilla, watcherOf } from './cards';
import { find, gameOf, move, passTo, scenario } from './helpers';

const start = (): GameState => scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other', ['3', '3']), watcherOf('Test Watcher', [creatureDies])], p1: { battlefield: ['Test Vanilla', 'Plains'] }, p2: { battlefield: ['Test Other'] } });
const dies = (g: ReturnType<typeof gameOf>, name: string, owner: 'p1' | 'p2' = 'p1'): void => { move(g, find(g.s, name, 'battlefield', owner), 'graveyard'); };

describe('CR 603.4: the scope "this game" sees every kind of event, not only casts', () => {
  it('a creature died in an earlier turn: "this game" still says so, "this turn" does not', () => {
    const g = gameOf(start());
    dies(g, 'Test Vanilla');
    collectPendingTriggers(g);
    expect(happened(g.s, { cond: 'happened', event: creatureDies, scope: 'game' }, 'p1')).toBe(true);
    // the next turn begins and is collected
    g.s.turn.number++;
    g.emit({ type: 'turnBegan', turn: g.s.turn.number, activePlayer: 'p2' });
    collectPendingTriggers(g);
    expect(happened(g.s, { cond: 'happened', event: creatureDies, scope: 'game' }, 'p1')).toBe(true);
    expect(countHistory(g.s, creatureDies, 'game', 'p1')).toBe(1);
    expect(happened(g.s, { cond: 'happened', event: creatureDies, scope: 'turn' }, 'p1')).toBe(false);
    expect(countHistory(g.s, creatureDies, 'turn', 'p1')).toBe(0);
    // and it adds up with the new turn's
    dies(g, 'Test Other', 'p2');
    collectPendingTriggers(g);
    expect(countHistory(g.s, creatureDies, 'game', 'p1')).toBe(2);
    expect(countHistory(g.s, creatureDies, 'turn', 'p1')).toBe(1);
  });
});

describe('CR 603.4: syncHistory brings the history up to date while a spell is still resolving', () => {
  it('before it runs, a death is not in the history; after it, it is; the trigger it caused is still collected later; nothing is recorded twice', () => {
    const s0 = scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other'), watcherOf('Test Watcher', [creatureDies])], p1: { battlefield: ['Test Vanilla', 'Test Other', 'Test Watcher'] } });
    const g = gameOf(s0);
    const q = { cond: 'happened', event: creatureDies, scope: 'turn' } as const;
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    expect(happened(g.s, q, 'p1')).toBe(false);
    const logLength = g.s.log.length;
    const effects = g.s.counters.effect;
    syncHistory(g);
    expect(happened(g.s, q, 'p1')).toBe(true);
    expect(g.s.pendingTriggers).toEqual([]); // no side effect but the history: nothing triggered yet,
    expect(g.s.log.length).toBe(logLength); // nothing logged,
    expect(g.s.counters.effect).toBe(effects); // no counter consumed
    syncHistory(g);
    expect(countHistory(g.s, creatureDies, 'turn', 'p1')).toBe(1); // asking again records nothing new
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers.map((t) => t.sourceName)).toEqual(['Test Watcher']); // the watcher still sees it
    expect(countHistory(g.s, creatureDies, 'turn', 'p1')).toBe(1); // and the collection did not record it a second time
    // events after the sync are recorded by the collection as before
    move(g, find(s0, 'Test Other', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    expect(countHistory(g.s, creatureDies, 'turn', 'p1')).toBe(2);
  });
});

describe('counters and steps can be read back from the history', () => {
  it('"a +1/+1 counter was put on a creature this turn", for a creature, for a player, and with the Nth counter', () => {
    const s0 = start();
    const g = gameOf(s0);
    const id = find(s0, 'Test Vanilla', 'battlefield');
    addCounters(g, id, '+1/+1', 2);
    collectPendingTriggers(g);
    const put = (p: Partial<Extract<EventPattern, { ev: 'counters' }>>): EventPattern => ({ ev: 'counters', change: 'put', on: { types: ['Creature'] }, ...p });
    expect(countHistory(g.s, put({}), 'turn', 'p1')).toBe(1);
    expect(countHistory(g.s, put({ kind: '+1/+1' }), 'turn', 'p1')).toBe(1);
    expect(countHistory(g.s, put({ kind: 'lore' }), 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, put({ change: 'removed' }), 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, put({ on: { types: ['Land'] } }), 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, put({ atLeast: 2 }), 'turn', 'p1')).toBe(1); // the second counter was reached with this event
    expect(countHistory(g.s, put({ atLeast: 3 }), 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, put({ atLeast: { q: 'X' } as never }), 'turn', 'p1')).toBe(0); // a quantity: fail closed
    expect(countHistory(g.s, put({ on: { player: 'any' } }), 'turn', 'p1')).toBe(0); // not a counter on a player
  });

  it('counters on a player (poison) are read as the player', () => {
    const g = gameOf(start());
    g.emit({ type: 'countersChanged', target: 'p2', counter: 'poison', delta: 1 });
    collectPendingTriggers(g);
    const p = (who: 'you' | 'opponent'): EventPattern => ({ ev: 'counters', change: 'put', kind: 'poison', on: { player: who } });
    expect(countHistory(g.s, p('opponent'), 'turn', 'p1')).toBe(1);
    expect(countHistory(g.s, p('you'), 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, { ev: 'counters', change: 'put', kind: 'poison', on: { types: ['Creature'] } }, 'turn', 'p1')).toBe(0);
  });

  it('"it is your upkeep" style: a step began this turn, whose turn it was', () => {
    const g = gameOf(start());
    g.s.history = [];
    g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' });
    collectPendingTriggers(g);
    const step = (whose: 'you' | 'opponent'): EventPattern => ({ ev: 'step', step: 'upkeep', whose });
    expect(countHistory(g.s, step('you'), 'turn', 'p1')).toBe(1);
    expect(countHistory(g.s, step('opponent'), 'turn', 'p1')).toBe(0);
    expect(countHistory(g.s, { ev: 'step', step: 'end' }, 'turn', 'p1')).toBe(0);
    const e = g.s.history.find((h) => h.ev === 'step' && h.facts['step'] === 'upkeep')!;
    expect(entryMatches({ ev: 'step', step: 'upkeep' }, e, 'p1')).toBe(true);
  });
});

describe('every entry is stamped with the turn it happened in (design 4.1)', () => {
  it('the opening hands are turn 0: at the first main phase nobody has drawn "this turn" and no draw has a nonsense Nth', () => {
    const s = start();
    expect(s.turn.number).toBe(1);
    expect(countHistory(s, { ev: 'draw' }, 'turn', 'p1')).toBe(0);
    expect(s.history.every((h) => h.ev !== 'draw' || h.turn === 0)).toBe(true);
    expect(s.history.filter((h) => h.turn === 0 && h.ev === 'draw').every((h) => h.facts['nth'] === undefined)).toBe(true);
    expect(s.players.every((p) => p.turnStats.cardsDrawn === 0)).toBe(true);
  });

  it('the draw of the next turn is a turn-2 draw with nth 1', () => {
    const s = passTo(start(), 2, 'draw');
    const draws = s.history.filter((h) => h.ev === 'draw' && h.turn === 2);
    expect(draws).toHaveLength(1);
    expect(draws[0]!.facts['nth']).toBe(1);
    expect(countHistory(s, { ev: 'draw' }, 'turn', 'p2')).toBe(1);
  });

  it('a window that spans a turn boundary stamps each batch with its own turn', () => {
    const g = gameOf(start());
    dies(g, 'Test Vanilla'); // turn 1
    g.s.turn.number++;
    g.emit({ type: 'turnBegan', turn: g.s.turn.number, activePlayer: 'p2' });
    dies(g, 'Test Other', 'p2'); // turn 2
    collectPendingTriggers(g); // ONE collection for both
    const deaths = g.s.history.filter((h) => h.ev === 'zoneChange' && h.facts['to'] === 'graveyard');
    expect(deaths.map((h) => h.turn)).toEqual([g.s.turn.number - 1, g.s.turn.number]);
    expect(countHistory(g.s, creatureDies, 'turn', 'p1')).toBe(1);
  });

  it('the step events say the turn they began in, so a delayed "next upkeep" trigger cannot fire early', () => {
    const g = gameOf(start());
    g.s.history = [];
    g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p1' });
    g.s.turn.number++;
    g.emit({ type: 'turnBegan', turn: g.s.turn.number, activePlayer: 'p2' });
    g.emit({ type: 'stepBegan', step: 'upkeep', activePlayer: 'p2' });
    collectPendingTriggers(g);
    const steps = g.s.history.filter((h) => h.ev === 'step' && h.facts['step'] === 'upkeep').map((h) => h.turn);
    expect(steps).toEqual([g.s.turn.number - 1, g.s.turn.number]);
  });
});
