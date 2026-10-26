/**
 * Round pc-players-3 (precon lane pc-players), played through the engine with synthetic cards (invented names and wordings, design 6.10). CR cites from memory, unverified.
 *
 *   CR 119.3, 608.2c   "Each opponent who lost life this turn sacrifices a creature ...": only an opponent whose life went down this turn
 *   CR 120.2, 603.2c   "Whenever a creature you control deals 5 or more damage to a player, draw a card": the damage one source dealt to a player at once; less, or to a creature, does not
 *   CR 608.2c, 109.4   "~ deals 4 damage to target player unless they control a Goblin": a Goblin the player controls spares them, one Alice controls does not
 */
import { describe, expect, it } from 'vitest';
import type { GameState, TargetChoice } from '../../../src/index';
import { act, find, life, scenario } from '../../m3/scenario';
import { card, full, named, resolveAll, settle } from '../cmd3/helpers';

const player = (id: string): TargetChoice => ({ kind: 'player', id });
const cast = (s0: GameState, name: string, p: Parameters<typeof settle>[1] = {}): GameState => resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), p), p);

const REAP = card('Test Reap', 'Sorcery', 'Each opponent who lost life this turn sacrifices a creature with the greatest power among creatures they control.');
const ZAP = card('Test Zap', 'Sorcery', '~ deals 1 damage to target player.');
const SMITE = card('Test Smite', 'Sorcery', '~ deals 4 damage to target player unless they control a Goblin.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const CANNON = card('Test Cannon', 'Creature — Construct', '{0}: ~ deals 6 damage to target player.', ['1', '1']);
const POP = card('Test Pop', 'Creature — Construct', '{0}: ~ deals 4 damage to target player.', ['1', '1']);
const SCOUT = card('Test Scout', 'Enchantment', 'Whenever a creature you control deals 5 or more damage to a player, draw a card.');
const DEFS = [REAP, ZAP, SMITE, BEAR, OGRE, GOBLIN, CANNON, POP, SCOUT];

describe('the synthetic cards are automated', () => {
  it('every synthetic spell plays fully', () => { for (const d of [REAP, ZAP, SMITE, CANNON, SCOUT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('CR 119.3: "Each opponent who lost life this turn sacrifices a creature with the greatest power among creatures they control"', () => {
  it('Bob lost life this turn (Zap): his biggest creature is sacrificed, his other creature stays', () => {
    let s = scenario([], { p1: { hand: ['Test Zap', 'Test Reap'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Zap', { targets: [player('p2')] });
    expect(life(s, 'p2')).toBe(19);
    s = cast(s, 'Test Reap');
    expect(named(s, 'Test Ogre').length).toBe(0);
    expect(named(s, 'Test Bear').length).toBe(1);
  });
  it('Bob has not lost life this turn: nothing is sacrificed', () => {
    const s = cast(scenario([], { p1: { hand: ['Test Reap'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: DEFS }), 'Test Reap');
    expect(named(s, 'Test Ogre').length + named(s, 'Test Bear').length).toBe(2);
  });
});

describe('CR 608.2c, 109.4: "deals 4 damage to target player unless they control a Goblin"', () => {
  it('Bob controls a Goblin: no damage', () => {
    const s = scenario([], { p1: { hand: ['Test Smite'] }, p2: { battlefield: ['Test Goblin'] }, defs: DEFS });
    expect(life(cast(s, 'Test Smite', { targets: [player('p2')] }), 'p2')).toBe(20);
  });
  it('only Alice controls a Goblin: Bob takes 4', () => {
    const s = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Goblin'] }, defs: DEFS });
    expect(life(cast(s, 'Test Smite', { targets: [player('p2')] }), 'p2')).toBe(16);
  });
  it('Bob controls no Goblin (a Bear): Bob takes 4', () => {
    const s = scenario([], { p1: { hand: ['Test Smite'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    expect(life(cast(s, 'Test Smite', { targets: [player('p2')] }), 'p2')).toBe(16);
  });
});

describe('CR 120.2, 603.2c: "Whenever a creature you control deals 5 or more damage to a player, draw a card."', () => {
  const run = (who: string): GameState => {
    let s = scenario([], { p1: { battlefield: ['Test Scout', who] }, defs: DEFS });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, who, 'battlefield', 'p1'), ability: 'p:0:0' });
    return resolveAll(settle(s, { targets: [player('p2')] }), { targets: [player('p2')] });
  };
  it('6 damage to Bob: Alice draws a card', () => { const s = run('Test Cannon'); expect(life(s, 'p2')).toBe(14); expect((s.zones.hand['p1'] ?? []).length).toBe(1); });
  it('4 damage (less than 5): no card', () => { const s = run('Test Pop'); expect(life(s, 'p2')).toBe(16); expect((s.zones.hand['p1'] ?? []).length).toBe(0); });
});
