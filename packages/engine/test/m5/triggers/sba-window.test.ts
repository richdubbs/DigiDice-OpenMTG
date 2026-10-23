/**
 * WP8 review fixes: triggers are collected BEFORE each state-based action pass (CR 603.2, 603.6a, 603.10, 704.3), so that an event is judged against the
 * state it happened in and the SBA events are a separate window. Built through the real engine: real combat, a real resolving spell, real SBAs.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, GameState } from '../../../src/index';
import { collectPendingTriggers } from '../../../src/core/triggers';
import { trig, vanilla } from './cards';
import { castAuto, find, gameOf, keyword, move, passBoth, pass, put, runCombat, scenario, stackAbilities, synth, tweak } from './helpers';

const gain1 = { op: 'gainLife', who: { ref: 'you' }, amount: 1 } as const;
const creature = (name: string, pt: [string, string], abilities: AbilityDef[], cost = '{1}') => synth({ name, cost, type: 'Creature — Test', pt, abilities });
const reckonerOf = (name: string, pt: [string, string]) => creature(name, pt, [trig('Whenever ~ is dealt damage, you gain 1 life.', [{ ev: 'damage', recipient: { object: { self: true } } }], { steps: [gain1] })]);

const deathTramper = creature('Test Death Tramper', ['3', '3'], [
  keyword('trample'),
  trig('Whenever ~ deals combat damage to a player, you gain 1 life.', [{ ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }], { steps: [gain1] }),
]);
const dealer = creature('Test Dealer', ['2', '2'], [trig('Whenever ~ deals combat damage to a creature, you gain 1 life.', [{ ev: 'damage', source: { self: true }, combat: true, recipient: { object: { types: ['Creature'] } } }], { steps: [gain1] })]);
const zeroToughness = creature('Test Zero Toughness', ['1', '0'], [trig('When ~ enters, you gain 1 life.', [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }], { steps: [gain1] })]);
const auraWatcher = creature('Test Aura Watcher', ['1', '1'], [trig('Whenever an Aura is put into a graveyard from the battlefield, you gain 1 life.', [{ ev: 'zoneChange', subject: { subtypes: ['Aura'] }, from: 'battlefield', to: 'graveyard' }], { steps: [gain1] })]);
const deathWatcher = creature('Test Death Watcher', ['1', '1'], [trig('Whenever another creature dies, you gain 1 life.', [{ ev: 'zoneChange', subject: { types: ['Creature'], other: true }, from: 'battlefield', to: 'graveyard' }], { steps: [gain1] })]);
const deathtoucher = creature('Test Deathtoucher', ['1', '1'], [keyword('deathtouch')]);

const defs = [reckonerOf('Test Reckoner', ['3', '2']), reckonerOf('Test Sturdy Reckoner', ['2', '5']), deathTramper, dealer, zeroToughness, auraWatcher, deathWatcher, deathtoucher, vanilla(), vanilla('Test Big', ['2', '5'])];
const nameIn = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const gone = (s: GameState, id: string): boolean => !s.zones.battlefield.includes(id);

describe('CR 510.2, 603.2, 704.3: combat damage is one event and the state-based action pass that follows is another', () => {
  it('"Whenever ~ is dealt damage" triggers although the lethal damage kills it in the next state-based action pass (Boros Reckoner)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Reckoner'] }, p2: { battlefield: ['Test Vanilla'] } });
    const att = find(s0, 'Test Reckoner', 'battlefield');
    const s = runCombat(s0, { attack: [[att]], block: [[find(s0, 'Test Vanilla', 'battlefield'), att]], until: 'combatDamage' });
    expect(gone(s, att)).toBe(true); // it did die
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Reckoner', controller: 'p1' }]);
  });

  it('control: the same ability on a creature that survives the damage triggers too', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Sturdy Reckoner'] }, p2: { battlefield: ['Test Vanilla'] } });
    const att = find(s0, 'Test Sturdy Reckoner', 'battlefield');
    const s = runCombat(s0, { attack: [[att]], block: [[find(s0, 'Test Vanilla', 'battlefield'), att]], until: 'combatDamage' });
    expect(gone(s, att)).toBe(false);
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Sturdy Reckoner' }]);
  });

  it('"Whenever ~ deals combat damage to a creature" triggers when the two creatures trade', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Dealer'] }, p2: { battlefield: ['Test Vanilla'] } });
    const att = find(s0, 'Test Dealer', 'battlefield');
    const s = runCombat(s0, { attack: [[att]], block: [[find(s0, 'Test Vanilla', 'battlefield'), att]], until: 'combatDamage' });
    expect(gone(s, att)).toBe(true);
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Dealer' }]);
  });

  it('a trampler killed by a deathtouch blocker still triggers on the damage it dealt to the player (CR 510.2, 603.10)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Death Tramper'] }, p2: { battlefield: ['Test Deathtoucher'] } });
    const att = find(s0, 'Test Death Tramper', 'battlefield');
    const blocker = find(s0, 'Test Deathtoucher', 'battlefield');
    const s = runCombat(s0, { attack: [[att]], block: [[blocker, att]], assign: { [att]: [{ id: blocker, amount: 1 }, { id: 'p2', amount: 2 }] }, until: 'combatDamage' });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(gone(s, att)).toBe(true); // the deathtouch damage killed it in the state-based action pass
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Death Tramper', controller: 'p1' }]);
  });
});

describe('CR 603.6a, 704.5f: "When ~ enters" triggers although a state-based action kills the permanent right after it entered', () => {
  it('a 1/0 creature enters, dies to state-based actions, and its enters trigger is on the stack', () => {
    let s = scenario(['Plains'], { defs, p1: { battlefield: ['Plains'], hand: ['Test Zero Toughness'] } });
    s = passBoth(castAuto(s, 'Test Zero Toughness'));
    expect(s.zones.graveyard['p1']!.some((id) => nameIn(s, id) === 'Test Zero Toughness')).toBe(true);
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Zero Toughness', controller: 'p1' }]);
  });
});

describe('CR 603.10a, 704.3: two state-based action passes in one priority check are two events', () => {
  // Pacifism is put in after the scenario was built: unattached Auras would be put into the graveyard while the scenario passes priority to the main phase.
  const withAura = (watchers: string[], attachTo: 'watcher' | 'victim', damage: [string, number]): GameState => {
    const s0 = scenario(['Plains', 'Pacifism'], { defs, p1: { battlefield: [...watchers, 'Test Vanilla'] } });
    return tweak(s0, (t) => {
      const aura = put(t, 'p1', 'battlefield', 'Pacifism');
      const target = find(s0, attachTo === 'watcher' ? 'Test Aura Watcher' : 'Test Vanilla', 'battlefield');
      t.objects[aura]!.attachedTo = target;
      t.objects[find(s0, damage[0], 'battlefield')]!.damage = damage[1];
    });
  };

  it('a watcher that died in the first pass does not see the Aura that falls off in the second', () => {
    const s = pass(withAura(['Test Aura Watcher'], 'watcher', ['Test Aura Watcher', 1]));
    expect(s.zones.graveyard['p1']!.map((id) => nameIn(s, id)).sort()).toEqual(['Pacifism', 'Test Aura Watcher']);
    expect(stackAbilities(s)).toEqual([]);
  });

  it('a watcher that is still on the battlefield sees the Aura leave', () => {
    const s = pass(withAura(['Test Aura Watcher'], 'victim', ['Test Vanilla', 2]));
    expect(s.zones.graveyard['p1']!.map((id) => nameIn(s, id)).sort()).toEqual(['Pacifism', 'Test Vanilla']);
    expect(stackAbilities(s)).toMatchObject([{ source: 'Test Aura Watcher' }]);
  });
});

describe('CR 603.10a: only objects that left at the same time as the event look back', () => {
  it('a creature that died in an earlier window is not a "simultaneous leaver" of a later window', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Death Watcher', 'Test Vanilla'] }, p2: { battlefield: ['Test Big'] } });
    const g = gameOf(s0);
    const watcher = find(s0, 'Test Death Watcher', 'battlefield');
    move(g, watcher, 'graveyard'); // window 1: it dies alone
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]);
    // window 2: the dead watcher appears as the source of some damage while another creature dies
    g.emit({ type: 'resolved', objectId: 'x0' });
    g.emit({ type: 'damageDealt', source: watcher, target: find(s0, 'Test Big', 'battlefield'), amount: 1, combat: false });
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers).toEqual([]);
  });

  it('control: a watcher that dies at the same time as another creature still sees it (Blood Artist)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Death Watcher', 'Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Death Watcher', 'battlefield'), 'graveyard');
    move(g, find(s0, 'Test Vanilla', 'battlefield'), 'graveyard');
    collectPendingTriggers(g);
    expect(g.s.pendingTriggers.map((t) => t.sourceName)).toEqual(['Test Death Watcher']);
  });
});
