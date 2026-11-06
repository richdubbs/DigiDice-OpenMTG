/**
 * Commander effort (coordinator C), round edh-c-41: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 614.1a, 700.4, 401.4            "If ~ would die, put it on top of its owner's library instead"
 *   CR 613.4b, 611.2a, 608.2h          "~'s base power becomes equal to target creature's power" / "~'s base toughness becomes equal to 1 plus the number of creature cards in your graveyard"
 *   CR 119.4b, 118.3b, 107.1b, 602.2b  "Pay half your life, rounded up" (zero or negative life: it costs nothing)
 *   CR 120.2b, 120.3a, 120.3e          "~ deals 3 damage to each tapped creature and 1 damage to you and each Elf you control"
 *   CR 502.3, 611.2a, 702.18a          "~ gains shroud until end of turn and doesn't untap during your next untap step"
 *   CR 613.1d, 613.4c, 205.1a          "Until end of turn, ~ becomes a Dragon, gets +5/+3, and gains flying and trample" / "~ loses defender and becomes a Human until end of turn"
 *   CR 305.6, 205.3i, 608.2h           "Until end of turn, ~ gets +1/+1 for each basic land type among lands you control"
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, find, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const inYard = (s: GameState, name: string, player = 'p1'): boolean => (s.zones.graveyard[player] ?? []).some((id) => nameOf(s, id) === name);
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const activate = (s: GameState, name: string, picks: Parameters<typeof settle>[1] = {}, ability = 'p:0:0'): GameState =>
  resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, name, 'battlefield', 'p1'), ability }), picks), picks);

// ---- dies: put on top of the library ---------------------------------------------------------------------------------------------------------------------------
const TOPPER = card('Test Topper', 'Creature — Zombie', 'If this creature would die, put it on top of its owner\'s library instead.', ['2', '2']);
const GRUNT = card('Test Grunt', 'Creature — Goblin', '', ['2', '2']);
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');

describe('CR 614.1a, 700.4, 401.4: "If ~ would die, put it on top of its owner\'s library instead"', () => {
  it('is automated; a destroyed Topper goes on top of its owner\'s library, not the graveyard; another creature dies as usual', () => {
    expect(full(TOPPER)).toBe(true);
    let s = scenario(['Swamp'], { defs: [TOPPER, DOOM, GRUNT], p1: { hand: ['Test Doom', 'Test Doom'], battlefield: ['Test Topper', 'Test Grunt'] } });
    const topper = find(s, 'Test Topper', 'battlefield');
    s = resolveAll(cast(s, 'Test Doom', { targets: [{ kind: 'object', id: topper }] }));
    expect(inYard(s, 'Test Topper')).toBe(false);
    expect(nameOf(s, s.zones.library['p1']![0]!)).toBe('Test Topper');
    s = resolveAll(cast(s, 'Test Doom', { targets: [{ kind: 'object', id: find(s, 'Test Grunt', 'battlefield') }] }));
    expect(inYard(s, 'Test Grunt')).toBe(true);
    expect(nameOf(s, s.zones.library['p1']![0]!)).toBe('Test Topper');
  });
});

// ---- base power / base toughness becomes equal ------------------------------------------------------------------------------------------------------------------
const MANGLER = card('Test Mangler', 'Creature — Beast', '{0}: ~\'s base power becomes equal to target creature\'s power.', ['1', '3']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['4', '1']);
const WALLTOMB = card('Test Walltomb', 'Creature — Wall', '{0}: ~\'s base toughness becomes equal to 1 plus the number of creature cards in your graveyard.', ['0', '1']);

describe('CR 613.4b, 611.2a, 608.2h: "~\'s base power becomes equal to target creature\'s power"', () => {
  it('is automated; the base power is the target\'s power as the ability resolves and stays that number when the target\'s power changes later; toughness is untouched', () => {
    expect(full(MANGLER)).toBe(true);
    let s = scenario([], { defs: [MANGLER, BRUTE], p1: { battlefield: ['Test Mangler', 'Test Brute'] } });
    const brute = find(s, 'Test Brute', 'battlefield');
    s = activate(s, 'Test Mangler', { targets: [{ kind: 'object', id: brute }] });
    expect(pt(s, find(s, 'Test Mangler', 'battlefield'))).toBe('4/3');
    s = tweak(s, (t) => { t.objects[brute]!.counters['+1/+1'] = 2; });
    expect(pt(s, brute)).toBe('6/3');
    expect(pt(s, find(s, 'Test Mangler', 'battlefield'))).toBe('4/3'); // locked at resolution (CR 608.2h)
  });
  it('negative: the target is untouched, and a creature the ability did not name keeps its own power', () => {
    let s = scenario([], { defs: [MANGLER, BRUTE, GRUNT], p1: { battlefield: ['Test Mangler', 'Test Brute', 'Test Grunt'] } });
    s = activate(s, 'Test Mangler', { targets: [{ kind: 'object', id: find(s, 'Test Brute', 'battlefield') }] });
    expect(pt(s, find(s, 'Test Brute', 'battlefield'))).toBe('4/1');
    expect(pt(s, find(s, 'Test Grunt', 'battlefield'))).toBe('2/2');
  });
});

describe('CR 613.4b, 611.2a, 608.2h: "~\'s base toughness becomes equal to 1 plus the number of creature cards in your graveyard"', () => {
  it('is automated; the toughness is 1 plus the creature cards in your graveyard when it resolves (noncreature cards and the opponent\'s graveyard do not count), and stays', () => {
    expect(full(WALLTOMB)).toBe(true);
    let s = scenario([], { defs: [WALLTOMB, GRUNT, DOOM], p1: { battlefield: ['Test Walltomb'], graveyard: ['Test Grunt', 'Test Grunt', 'Test Doom'] }, p2: { graveyard: ['Test Grunt'] } });
    s = activate(s, 'Test Walltomb');
    expect(pt(s, find(s, 'Test Walltomb', 'battlefield'))).toBe('0/3');
    s = tweak(s, (t) => { const o = t.objects[find(t, 'Test Grunt', 'graveyard', 'p2')]!; o.owner = 'p1'; t.zones.graveyard['p2'] = []; t.zones.graveyard['p1']!.push(o.id); });
    expect(pt(s, find(s, 'Test Walltomb', 'battlefield'))).toBe('0/3'); // not read again
    s = activate(s, 'Test Walltomb');
    expect(pt(s, find(s, 'Test Walltomb', 'battlefield'))).toBe('0/4');
  });
});

// ---- pay half your life ---------------------------------------------------------------------------------------------------------------------------------------
const EVIL = card('Test Evil', 'Enchantment', 'Pay half your life, rounded up: ~ becomes a 4/4 Horror creature with flying.');

describe('CR 119.4, 107.1a, 118.3, 602.2b: "Pay half your life, rounded up"', () => {
  const withLife = (n: number): GameState => tweak(scenario([], { defs: [EVIL], p1: { battlefield: ['Test Evil'] } }), (t) => { t.players.find((x) => x.id === 'p1')!.life = n; });
  it('is automated; at 20 life it costs 10, at 7 life it costs 4 (rounded up), and the permanent becomes a 4/4 flying creature that is no longer an enchantment', () => {
    expect(full(EVIL)).toBe(true);
    let s = activate(withLife(20), 'Test Evil');
    expect(life(s, 'p1')).toBe(10);
    const c = getChars(s, find(s, 'Test Evil', 'battlefield'))!;
    expect(`${c.power}/${c.toughness}`).toBe('4/4');
    expect(c.types).toContain('Creature');
    expect(c.types).not.toContain('Enchantment');
    expect(hasKeyword(c, 'flying')).toBe(true);
    s = activate(withLife(7), 'Test Evil');
    expect(life(s, 'p1')).toBe(3);
  });
  it('negative: at zero life half is zero and it costs nothing (and never gains life); a negative life total changes nothing either (Scryfall ruling 2004-10-04)', () => {
    expect(life(activate(withLife(0), 'Test Evil'), 'p1')).toBe(0);
    expect(life(activate(withLife(-3), 'Test Evil'), 'p1')).toBe(-3);
  });
});

// ---- damage to a group and to you and your group -------------------------------------------------------------------------------------------------------------
const STORM = card('Test Storm', 'Instant', '~ deals 3 damage to each tapped creature and 1 damage to you and each Elf you control.');
const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);

describe('CR 120.2b, 120.3a, 120.3e: "~ deals 3 damage to each tapped creature and 1 damage to you and each Elf you control"', () => {
  it('is automated; the tapped creatures take 3, you and your Elves take 1, an untapped creature that is not an Elf takes nothing', () => {
    expect(full(STORM)).toBe(true);
    let s = scenario([], { defs: [STORM, ELF, OGRE, GRUNT], p1: { hand: ['Test Storm'], battlefield: ['Test Elf', 'Test Ogre'] }, p2: { battlefield: ['Test Grunt', 'Test Ogre'] } });
    const oppOgre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = tweak(s, (t) => { t.objects[oppOgre]!.tapped = true; });
    s = resolveAll(cast(s, 'Test Storm'));
    expect(life(s, 'p1')).toBe(19);
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[find(s, 'Test Elf', 'battlefield', 'p1')]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Ogre', 'battlefield', 'p1')]!.damage).toBe(0);
    expect(s.objects[find(s, 'Test Grunt', 'battlefield', 'p2')]!.damage).toBe(0);
    expect(s.zones.battlefield.includes(oppOgre)).toBe(false); // the tapped 3/3 took 3 damage
  });
});

// ---- gains shroud and doesn't untap ---------------------------------------------------------------------------------------------------------------------------
const SPAWN = card('Test Spawn', 'Creature — Homarid', '{0}: ~ gains shroud until end of turn and doesn\'t untap during your next untap step. Tap ~.', ['3', '3']);

describe('CR 502.3, 611.2a, 702.18a: "~ gains shroud until end of turn and doesn\'t untap during your next untap step. Tap ~."', () => {
  it('is automated; the creature has shroud, is tapped, and is still tapped after its controller\'s next untap step (it untaps in the one after)', () => {
    expect(full(SPAWN)).toBe(true);
    let s = activate(scenario([], { defs: [SPAWN], p1: { battlefield: ['Test Spawn'] } }), 'Test Spawn');
    const id = find(s, 'Test Spawn', 'battlefield');
    expect(hasKeyword(getChars(s, id)!, 'shroud')).toBe(true);
    expect(s.objects[id]!.tapped).toBe(true);
    const t2 = advanceTo(s, 2, 'upkeep');
    expect(hasKeyword(getChars(t2, id)!, 'shroud')).toBe(false); // until end of turn
    const t3 = advanceTo(t2, 3, 'upkeep'); // p1's next untap step: it stays tapped
    expect(t3.objects[id]!.tapped).toBe(true);
    expect(advanceTo(t3, 5, 'upkeep').objects[id]!.tapped).toBe(false); // and untaps in the one after
  });
});

// ---- becomes a subtype, gets and gains / loses a keyword and becomes ---------------------------------------------------------------------------------------------
const KNIGHT = card('Test Drake Knight', 'Creature — Human Knight', '{0}: Until end of turn, ~ becomes a Dragon, gets +5/+3, and gains flying and trample.', ['2', '2']);
const MERFOLK = card('Test Wishful', 'Creature — Merfolk', 'Defender\n{0}: ~ loses defender and becomes a Human until end of turn.', ['1', '1']);

describe('CR 613.1d, 613.4c, 205.1a: "Until end of turn, ~ becomes a Dragon, gets +5/+3, and gains flying and trample"', () => {
  it('is automated; it is a Dragon only (its other creature types are gone, Scryfall ruling 2009-02-01) with flying and trample and 7/5; another creature is untouched', () => {
    expect(full(KNIGHT)).toBe(true);
    const s = activate(scenario([], { defs: [KNIGHT, GRUNT], p1: { battlefield: ['Test Drake Knight', 'Test Grunt'] } }), 'Test Drake Knight');
    const c = getChars(s, find(s, 'Test Drake Knight', 'battlefield'))!;
    expect(`${c.power}/${c.toughness}`).toBe('7/5');
    expect(c.subtypes).toEqual(['Dragon']);
    expect(hasKeyword(c, 'flying') && hasKeyword(c, 'trample')).toBe(true);
    expect(pt(s, find(s, 'Test Grunt', 'battlefield'))).toBe('2/2');
  });
});

describe('CR 613.1d, 205.1a: "~ loses defender and becomes a Human until end of turn"', () => {
  it('is automated; it loses defender and is a Human, no longer a Merfolk (Scryfall ruling 2019-10-04)', () => {
    expect(full(MERFOLK)).toBe(true);
    const s0 = scenario([], { defs: [MERFOLK], p1: { battlefield: ['Test Wishful'] } });
    expect(hasKeyword(getChars(s0, find(s0, 'Test Wishful', 'battlefield'))!, 'defender')).toBe(true);
    const s = activate(s0, 'Test Wishful', {}, 'p:0:1');
    const c = getChars(s, find(s, 'Test Wishful', 'battlefield'))!;
    expect(hasKeyword(c, 'defender')).toBe(false);
    expect(c.subtypes).toEqual(['Human']);
  });
});

// ---- domain pump ---------------------------------------------------------------------------------------------------------------------------------------------
const ROOT = card('Test Rootling', 'Creature — Lizard', '{0}: Until end of turn, ~ gets +1/+1 for each basic land type among lands you control.', ['1', '1']);

describe('CR 305.6, 205.3i, 608.2h: "Until end of turn, ~ gets +1/+1 for each basic land type among lands you control"', () => {
  it('is automated; Forest, Island and a second Island are two basic land types (+2/+2); the opponent\'s lands do not count', () => {
    expect(full(ROOT)).toBe(true);
    const s = activate(scenario(['Forest', 'Island', 'Mountain', 'Swamp'], { defs: [ROOT], p1: { battlefield: ['Test Rootling', 'Forest', 'Island', 'Island'] }, p2: { battlefield: ['Mountain', 'Swamp'] } }), 'Test Rootling');
    expect(pt(s, find(s, 'Test Rootling', 'battlefield'))).toBe('3/3');
  });
  it('negative: with no lands the creature gets nothing', () => {
    const s = activate(scenario([], { defs: [ROOT], p1: { battlefield: ['Test Rootling'] } }), 'Test Rootling');
    expect(pt(s, find(s, 'Test Rootling', 'battlefield'))).toBe('1/1');
  });
});
