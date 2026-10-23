/**
 * p2-damage-1 (Phase 2 lane p2-damage): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 120.3, 109.4        "Each creature deals 1 damage to its controller.": each player is dealt 1 for each creature they control, a stolen creature hits the player
 *                          who controls it, not its owner
 *   CR 603.2, 608.2h       "Whenever a creature is dealt damage, ~ deals that much damage to that creature's controller.": the damaged creature's controller is dealt
 *                          that much; damage to a player triggers nothing
 *   CR 608.2f, 120.3       "deals damage to each player equal to the number of lands they control" / "half that player's life total, rounded down": each player's own
 *                          count; a player with none is dealt nothing
 *   CR 701.19c, 611.2a     "A creature dealt damage this way can't be regenerated this turn.": a regeneration shield does not save the creature; without the rider
 *                          it does
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId, TargetChoice } from '../../../src/index';
import { act, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const onField = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

const BACKLASH = card('Test Backlash', 'Sorcery', 'Each creature deals 1 damage to its controller.');
const ECHO = card('Test Echo', 'Enchantment', "Whenever a creature is dealt damage, this enchantment deals that much damage to that creature's controller.");
const SOIL = card('Test Soil', 'Sorcery', 'This spell deals damage to each player equal to the number of lands they control.');
const HALVER = card('Test Halver', 'Creature — Ogre', "{T}: This creature deals damage to each player equal to half that player's life total, rounded down.", ['1', '1']);
const SCORCH = card('Test Scorch', 'Instant', 'This spell deals 2 damage to any target. A creature dealt damage this way can\'t be regenerated this turn.');
const SINGE = card('Test Singe', 'Instant', 'This spell deals 2 damage to any target.');
const TROLL = card('Test Troll', 'Creature — Troll', '{0}: Regenerate this creature.', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const DEFS: CardDef[] = [BACKLASH, ECHO, SOIL, HALVER, SCORCH, SINGE, TROLL, BEAR, OGRE];

const cast = (s0: GameState, name: string, targets: TargetChoice[] = []): GameState => resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets }), { targets });

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [BACKLASH, ECHO, SOIL, HALVER, SCORCH, TROLL]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 120.3, 109.4: "Each creature deals 1 damage to its controller."', () => {
  it('Alice controls two creatures, Bob one: Alice is dealt 2, Bob 1', () => {
    let s = scenario([], { p1: { hand: ['Test Backlash'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = cast(s, 'Test Backlash');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([18, 19]);
  });
  it('a creature Alice owns that Bob controls hits Bob, its controller (CR 108.4)', () => {
    let s = scenario([], { p1: { hand: ['Test Backlash'], battlefield: ['Test Bear'] }, defs: DEFS });
    s = structuredClone(s);
    s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.controller = 'p2';
    s = cast(s, 'Test Backlash');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 19]);
  });
});

describe('CR 603.2, 608.2h: "Whenever a creature is dealt damage, ~ deals that much damage to that creature\'s controller."', () => {
  it('Bob\'s Ogre is dealt 2: Bob is dealt 2', () => {
    let s = scenario([], { p1: { hand: ['Test Singe'], battlefield: ['Test Echo'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Singe', [obj(find(s, 'Test Ogre', 'battlefield', 'p2'))]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 18]);
  });
  it('damage to a player is no creature dealt damage: nothing more', () => {
    let s = scenario([], { p1: { hand: ['Test Singe'], battlefield: ['Test Echo'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = cast(s, 'Test Singe', [{ kind: 'player', id: 'p2' }]);
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 18]);
  });
});

describe('CR 608.2f, 120.3: damage to each player equal to that player\'s own count', () => {
  it('"the number of lands they control": Alice with three lands is dealt 3, Bob with none nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Soil'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: DEFS });
    s = cast(s, 'Test Soil');
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([17, 20]);
  });
  it('"half that player\'s life total, rounded down": 20 and 15 are dealt 10 and 7', () => {
    let s = scenario([], { p1: { battlefield: ['Test Halver'] }, defs: DEFS });
    s = structuredClone(s);
    s.players.find((p) => p.id === 'p2')!.life = 15;
    s.objects[find(s, 'Test Halver', 'battlefield', 'p1')]!.controlledSinceTurn = 0;
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Halver', 'battlefield', 'p1'), ability: 'p:0:0' })));
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([10, 8]);
  });
});

describe('CR 701.19c, 611.2a: "A creature dealt damage this way can\'t be regenerated this turn."', () => {
  const shielded = (spell: string): GameState => {
    let s = scenario([], { p1: { hand: [spell] }, p2: { battlefield: ['Test Troll'] }, defs: DEFS });
    const troll = find(s, 'Test Troll', 'battlefield', 'p2');
    s = settle(act(s, { type: 'pass', player: 'p1' }));
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p2', source: troll, ability: 'p:0:0' })));
    expect(s.continuousEffects.some((e) => JSON.stringify(e).includes('regenerat'))).toBe(true);
    return cast(s, spell, [obj(troll)]);
  };
  it('the regeneration shield does not save the Troll dealt lethal damage by the spell', () => {
    expect(onField(shielded('Test Scorch'), 'Test Troll')).toBe(false);
  });
  it('without the rider, the shield regenerates it (CR 701.19a)', () => {
    expect(onField(shielded('Test Singe'), 'Test Troll')).toBe(true);
  });
});
