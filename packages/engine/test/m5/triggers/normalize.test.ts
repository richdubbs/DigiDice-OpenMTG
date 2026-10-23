/**
 * WP8: the normalizer turns the engine's events into semantic events with roles, last known information and batch ids (design 3.5, 4.1).
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../../src/index';
import { createToken, drawCards, moveObject } from '../../../src/core/zones';
import { addCounters } from '../../../src/rules/counters';
import { dealDamage } from '../../../src/rules/damage';
import { compileCard } from '../../../src/index';
import { splitBatches } from '../../../src/triggers/normalize';
import { batchesOf, find, gameOf, scenario } from './helpers';
import { vanilla } from './cards';

const base = () => scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other')], p1: { battlefield: ['Test Vanilla', 'Plains'], hand: ['Test Other'] }, p2: { battlefield: [] } });

describe('batches (CR 603.2c, 603.6a, 603.10a): events that happened together are normalized together', () => {
  const ev = (type: GameEvent['type'], extra: object = {}): GameEvent => ({ type, ...extra }) as GameEvent;

  it('a step or turn beginning starts a new batch; a resolved spell or ability ends one', () => {
    const events = [
      ev('lifeChanged', { player: 'p1', delta: 1, life: 21 }),
      ev('stepBegan', { step: 'upkeep', activePlayer: 'p1' }),
      ev('lifeChanged', { player: 'p1', delta: 1, life: 22 }),
      ev('resolved', { objectId: 'o1' }),
      ev('lifeChanged', { player: 'p1', delta: -1, life: 21 }), // state-based actions after a resolution are a separate event (CR 704.3)
      ev('turnBegan', { turn: 2, activePlayer: 'p2' }),
      ev('stepBegan', { step: 'untap', activePlayer: 'p2' }),
    ];
    expect(splitBatches(events).map((b) => b.map((e) => e.type))).toEqual([
      ['lifeChanged'], ['stepBegan', 'lifeChanged', 'resolved'], ['lifeChanged'], ['turnBegan'], ['stepBegan'],
    ]);
    expect(splitBatches([])).toEqual([]);
  });
});

describe('zone changes (CR 400.7, 603.6, 603.10)', () => {
  it('the subject is the new object in a public zone (CR 400.7e), the snapshot of the old one is kept, and the player is the controller as it last was', () => {
    const s0 = base();
    const old = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0);
    const newId = moveObject(g, old, 'graveyard', { cause: 'destroy' })!;
    const [batch] = batchesOf(g);
    const zc = batch!.find((e) => e.ev === 'zoneChange')!;
    expect(zc.roles.subject).toEqual({ objects: [{ id: newId, zone: 'graveyard' }] });
    expect(zc.roles.player).toEqual({ players: ['p1'] });
    expect(zc.data).toMatchObject({ from: 'battlefield', to: 'graveyard', oldId: old, newId, cause: 'destroy' });
    expect(zc.before[old]!.object.id).toBe(old);
    expect(zc.before[old]!.leftZone).toBe('battlefield');
    expect(zc.before[old]!.chars!.name).toBe('Test Vanilla');
  });

  it('into a hidden zone the new object cannot be found (CR 400.7): the subject is the last known object', () => {
    const s0 = base();
    const old = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0);
    moveObject(g, old, 'hand', { cause: 'returnToHand' });
    const zc = batchesOf(g)[0]!.find((e) => e.ev === 'zoneChange')!;
    expect(zc.roles.subject).toEqual({ objects: [{ id: old, zone: 'battlefield' }] });
  });

  it('a sacrifice, a discard and a destroy are also actions; a token is created as well as having entered', () => {
    const s0 = base();
    const g = gameOf(s0);
    moveObject(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard', { cause: 'sacrifice' });
    moveObject(g, find(s0, 'Test Other', 'hand', 'p1'), 'graveyard', { cause: 'discard' });
    createToken(g, compileCard({ name: 'Test Token', layout: 'token', type_line: 'Token Creature — Test', power: '1', toughness: '1', oracle_text: '' }), 'p2');
    const evs = batchesOf(g).flat();
    expect(evs.filter((e) => e.ev === 'action').map((e) => [e.data['verb'], e.roles.player])).toEqual([
      ['sacrifice', { players: ['p1'] }], ['discard', { players: ['p1'] }],
    ]);
    const created = evs.filter((e) => e.ev === 'createToken');
    expect(created).toHaveLength(1);
    expect(created[0]!.roles.player).toEqual({ players: ['p2'] });
    expect(evs.filter((e) => e.ev === 'zoneChange')).toHaveLength(3);
    expect(evs.find((e) => e.ev === 'zoneChange' && e.data['cause'] === 'create token')!.data['from']).toBeUndefined(); // it came from nowhere
  });

  it('events carry the index of the engine event they came from, and the batch id they share', () => {
    const g = gameOf(base());
    drawCards(g, 'p1', 2);
    g.emit({ type: 'stepBegan', step: 'end', activePlayer: 'p1' });
    const [a, b] = batchesOf(g);
    expect(a!.every((e) => e.batch === a![0]!.batch)).toBe(true);
    expect(b![0]!.batch).not.toBe(a![0]!.batch);
    expect(b![0]!.seq).toBeGreaterThan(a![a!.length - 1]!.seq);
  });
});

describe('the other events', () => {
  it('draws are numbered within the turn: "the second card you draw each turn" (CR 121.2)', () => {
    const g = gameOf(base());
    drawCards(g, 'p1', 3);
    expect(batchesOf(g).flat().filter((e) => e.ev === 'draw').map((e) => e.data['nth'])).toEqual([1, 2, 3]);
  });

  it('counter totals are known after each change (CR 122.7: the Nth counter)', () => {
    const s0 = base();
    const id = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0);
    addCounters(g, id, '+1/+1', 2);
    addCounters(g, id, '+1/+1', 1);
    addCounters(g, id, '+1/+1', -2);
    const cs = batchesOf(g).flat().filter((e) => e.ev === 'counters');
    expect(cs.map((e) => [e.data['change'], e.data['amount'], e.data['total']])).toEqual([['put', 2, 2], ['put', 1, 3], ['removed', 2, 1]]);
  });

  it('damage names its source, the recipient (a player or an object) and keeps the source\'s snapshot when it is gone', () => {
    const s0 = base();
    const src = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0);
    dealDamage(g, src, 'p2', 2, { combat: true });
    const dmg = batchesOf(g).flat().find((e) => e.ev === 'damage')!;
    expect(dmg.roles.recipient).toEqual({ players: ['p2'] });
    expect(dmg.roles.source).toEqual({ objects: [{ id: src, zone: 'battlefield' }] });
    expect(dmg.data).toMatchObject({ amount: 2, combat: true, toPlayer: true });
    moveObject(g, src, 'graveyard');
    g.emit({ type: 'damageDealt', source: src, target: 'p1', amount: 1, combat: false });
    const last = batchesOf(g).flat().filter((e) => e.ev === 'damage').pop()!;
    expect(last.before[src]!.leftZone).toBe('battlefield'); // the creature is gone; what it was is known
  });

  it('attackers become one event each with the number of attackers declared; blockers a "blocks" and a "becomes blocked" event', () => {
    const s0 = scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other')], p1: { battlefield: ['Test Vanilla', 'Test Other'] }, p2: { battlefield: [] } });
    const a = find(s0, 'Test Vanilla', 'battlefield');
    const b = find(s0, 'Test Other', 'battlefield');
    const g = gameOf(s0);
    g.emit({ type: 'attackersDeclared', attackers: [{ attacker: a, defender: 'p2' }, { attacker: b, defender: 'p2' }] });
    g.emit({ type: 'blockersDeclared', blocks: [{ blocker: b, attacker: a }, { blocker: a, attacker: a }] });
    const evs = batchesOf(g).flat();
    expect(evs.filter((e) => e.ev === 'attacks').map((e) => [e.data['count'], e.data['alone']])).toEqual([[2, false], [2, false]]);
    expect(evs.filter((e) => e.ev === 'becomesBlocked').map((e) => e.data['first'])).toEqual([true, false]); // once per attacker (CR 509.3c)
    expect(evs.filter((e) => e.ev === 'blocks')).toHaveLength(2);
  });

  it('becoming the target of a spell or ability exposes the object, the spell and its source (CR 603.2e, 115)', () => {
    const s0 = base();
    const id = find(s0, 'Test Vanilla', 'battlefield');
    const g = gameOf(s0);
    g.emit({ type: 'becameTarget', objectId: id, byStackId: 'o999', byController: 'p2' });
    const e = batchesOf(g).flat().find((x) => x.ev === 'becomes')!;
    expect(e.data['what']).toBe('targeted');
    expect(e.roles.subject).toEqual({ objects: [{ id, zone: 'battlefield' }] });
    expect(e.roles.spell).toEqual({ objects: [{ id: 'o999', zone: 'stack' }] });
    expect(e.roles.player).toEqual({ players: ['p1'] }); // the target's controller
  });
});
