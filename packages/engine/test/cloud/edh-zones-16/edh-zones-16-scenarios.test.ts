/**
 * edh-zones-16 (Commander effort, lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against
 * the Comprehensive Rules of 2026-09-25.
 *
 *   CR 205.2a, 607.2d, 701.20a, 614.1a   "Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and the rest on
 *                                        the bottom of your library in a random order." (Abundant Harvest) and the same inside "If you would draw a card, you may instead ..." (Abundance)
 *   CR 701.20a, 110.2a, 205.2a, 608.2h    "Destroy target permanent an opponent controls. Its controller reveals cards from the top of their library until they reveal a permanent card that
 *                                        shares a card type with that permanent. They put that card onto the battlefield and the rest on the bottom of their library in a random order." (Wild Magic Surge)
 *   CR 107.3, 601.2b, 701.20a            "X can't be greater than the number of players in the game. Reveal cards from the top of your library until you reveal X land cards. ..." (Open the Way)
 *   CR 701.23a, 608.2c, 608.2f, 110.2a   "Exile target creature you don't control. For each creature exiled this way, its controller searches their library for a basic land card. Those players put
 *                                        those cards onto the battlefield tapped, then shuffle." (Winds of Abandon; overload exiles each creature you don't control)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { put } from '../../m3/scenario';
import { card, cast, drive, find, full, obj, resolveAll, scenario } from '../r5-cost/support';

type P = 'p1' | 'p2';
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: P): string[] => names(s, s.zones.hand[p]!).sort();
const libNames = (s: GameState, p: P): string[] => names(s, s.zones.library[p]!);
const bfNames = (s: GameState, p: P): string[] => names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === p)).sort();
const exileNames = (s: GameState): string[] => names(s, s.zones.exile).sort();
/** Replace a player's whole library with the named cards, top first. */
function setLibrary(s: GameState, p: P, list: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of list) put(s, p, 'library', n);
}

// ---- cards ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const HARVEST = card('Test Kind Harvest', 'Sorcery', 'Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and the rest on the bottom of your library in a random order.');
const PLENTY = card('Test Plenty', 'Enchantment', 'If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order.');
const SIGHT = card('Test Sight', 'Sorcery', 'Draw a card.', '{0}');
const POKE = card('Test Poke', 'Sorcery', 'Target player draws a card.', '{0}');
const TWICE = card('Test Twice', 'Sorcery', 'Draw two cards.', '{0}');
const SURGE = card('Test Wild Surge', 'Sorcery', 'Destroy target permanent an opponent controls. Its controller reveals cards from the top of their library until they reveal a permanent card that shares a card type with that permanent. They put that card onto the battlefield and the rest on the bottom of their library in a random order.', '{0}');
const WAY = card('Test Open Road', 'Sorcery', 'X can\'t be greater than the number of players in the game.\nReveal cards from the top of your library until you reveal X land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order.', '{X}');
const WINDS = card('Test Wind Away', 'Sorcery', 'Exile target creature you don\'t control. For each creature exiled this way, its controller searches their library for a basic land card. Those players put those cards onto the battlefield tapped, then shuffle.\nOverload {1}', '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', '{2}', ['2', '2']);
const RELIC = card('Test Relic', 'Artifact', '', '{1}');
const CHARM = card('Test Charm', 'Sorcery', 'You gain 1 life.', '{1}');
const TOTEM = card('Test Totem', 'Artifact Creature — Golem', '', '{3}', ['2', '2']);
const BASICS = ['Island', 'Forest', 'Plains'];
// edh-mana-keywords-12 (CR 208.5, Luxior's ruling 2022-04-29): a permanent made a creature with no power or toughness is 0/0 and dies, so the test's lands also get +1/+1
const AWAKEN = card('Test Awakening', 'Enchantment', 'Lands you control are creatures in addition to their other types. Lands you control get +1/+1.');
const DEFS = [POKE, TWICE, AWAKEN, HARVEST, PLENTY, SIGHT, SURGE, WAY, WINDS, BEAR, OX, RELIC, CHARM, TOTEM];

describe('the synthetic cards are automated', () => {
  it('play fully', () => {
    for (const d of [HARVEST, PLENTY, SURGE, WAY, WINDS]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('"Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind." (CR 205.2a, 607.2d, 701.20a; Abundant Harvest)', () => {
  const setup = (): GameState => {
    const s = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Kind Harvest'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Charm', 'Test Relic', 'Forest', 'Island', 'Test Bear']);
    return s;
  };
  it('land chosen: the cards are revealed down to the first land, which goes to the hand; the others go to the bottom', () => {
    const s = resolveAll(cast(setup(), 'Test Kind Harvest'), { options: [['0']] });
    expect(handNames(s, 'p1')).toEqual(['Forest']);
    expect(libNames(s, 'p1').slice(0, 2)).toEqual(['Island', 'Test Bear']);
    expect(libNames(s, 'p1').slice(2).sort()).toEqual(['Test Charm', 'Test Relic']);
  });
  it('nonland chosen: the first card that is not a land is the one taken, the lands below it stay', () => {
    const s = resolveAll(cast(setup(), 'Test Kind Harvest'), { options: [['1']] });
    expect(handNames(s, 'p1')).toEqual(['Test Charm']);
    expect(libNames(s, 'p1')).toEqual(['Test Relic', 'Forest', 'Island', 'Test Bear']);
  });
  it('NEGATIVE: no card of the chosen kind: every card is revealed, nothing is put into the hand and all of them go to the bottom', () => {
    const s0 = setup();
    setLibrary(s0, 'p1', ['Forest', 'Island', 'Forest']);
    const s = resolveAll(cast(s0, 'Test Kind Harvest'), { options: [['1']] });
    expect(handNames(s, 'p1')).toEqual([]);
    expect(libNames(s, 'p1').sort()).toEqual(['Forest', 'Forest', 'Island']);
  });
});

describe('"If you would draw a card, you may instead choose land or nonland and reveal cards ... Put that card into your hand and put all other cards revealed this way on the bottom of your library in any order." (CR 614.1a, 701.20a; Abundance)', () => {
  const setup = (): GameState => {
    const s = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Sight'], battlefield: ['Test Plenty'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Charm', 'Test Relic', 'Forest', 'Island']);
    return s;
  };
  it('accepted, land chosen: the draw does not happen; the first land is put into the hand and the cards above it go to the bottom', () => {
    const s = resolveAll(cast(setup(), 'Test Sight'), { yes: [true], options: [['0']] });
    expect(handNames(s, 'p1')).toEqual(['Forest']);
    expect(libNames(s, 'p1').slice(0, 1)).toEqual(['Island']);
    expect(libNames(s, 'p1').slice(1).sort()).toEqual(['Test Charm', 'Test Relic']);
  });
  it('accepted, nonland chosen: the first nonland card is put into the hand', () => {
    const s = resolveAll(cast(setup(), 'Test Sight'), { yes: [true], options: [['1']] });
    expect(handNames(s, 'p1')).toEqual(['Test Charm']);
    expect(libNames(s, 'p1')).toEqual(['Test Relic', 'Forest', 'Island']);
  });
  it('a library with no card of the chosen kind (or none at all): the draw is still replaced, nothing is put into the hand and the player does not lose for drawing from an empty library (ruling 2007-07-15)', () => {
    const s0 = setup();
    setLibrary(s0, 'p1', []);
    const s = resolveAll(cast(s0, 'Test Sight'), { yes: [true], options: [['0']] });
    expect(handNames(s, 'p1')).toEqual([]);
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(false);
  });
  it('a draw of two cards: each draw is replaced on its own (ruling 2004-10-04): the first accepted, the second declined', () => {
    const s0 = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Twice'], battlefield: ['Test Plenty'] }, p2: {} });
    setLibrary(s0, 'p1', ['Test Charm', 'Test Relic', 'Forest', 'Island']);
    const s = resolveAll(cast(s0, 'Test Twice'), { yes: [true, false], options: [['0']] });
    // the first draw: a land is put into the hand instead (the Charm and the Relic go to the bottom); the second draw is a card drawn as usual: the top card, now the Island
    expect(handNames(s, 'p1')).toEqual(['Forest', 'Island']);
  });
  it('NEGATIVE: declined, the card is drawn as usual and nothing is revealed', () => {
    const s = resolveAll(cast(setup(), 'Test Sight'), { yes: [false] });
    expect(handNames(s, 'p1')).toEqual(['Test Charm']);
    expect(libNames(s, 'p1')).toEqual(['Test Relic', 'Forest', 'Island']);
  });
  it('NEGATIVE: an opponent drawing a card is not replaced (only your draws are): no prompt, the card is drawn', () => {
    const s0 = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Poke'], battlefield: ['Test Plenty'] }, p2: {} });
    setLibrary(s0, 'p2', ['Test Charm', 'Forest']);
    const s = resolveAll(cast(s0, 'Test Poke', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(handNames(s, 'p2')).toEqual(['Test Charm']);
    expect(libNames(s, 'p2')).toEqual(['Forest']);
  });
});

describe('"Destroy target permanent an opponent controls. Its controller reveals cards ... until they reveal a permanent card that shares a card type with that permanent. They put that card onto the battlefield ..." (CR 701.20a, 110.2a; Wild Magic Surge)', () => {
  const setup = (target: string): GameState => {
    const s = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Wild Surge'] }, p2: { battlefield: [target] } });
    setLibrary(s, 'p2', ['Test Charm', 'Forest', 'Test Relic', 'Test Bear', 'Island']);
    return s;
  };
  it('a creature destroyed: its controller reveals down to the first creature card (the spell, the land and the artifact are passed), it enters under THEIR control; the rest go to the bottom of their library', () => {
    const s0 = setup('Test Ox');
    const s = resolveAll(cast(s0, 'Test Wild Surge', { targets: [[obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }));
    expect(bfNames(s, 'p2')).toEqual(['Test Bear']);
    expect(bfNames(s, 'p1')).not.toContain('Test Bear');
    expect(libNames(s, 'p2').slice(0, 1)).toEqual(['Island']);
    expect(libNames(s, 'p2').slice(1).sort()).toEqual(['Forest', 'Test Charm', 'Test Relic']);
  });
  it('an artifact creature destroyed: the first permanent card sharing ANY card type with it (the artifact) is the one, not the creature below it', () => {
    const s0 = setup('Test Totem');
    const s = resolveAll(cast(s0, 'Test Wild Surge', { targets: [[obj(find(s0, 'Test Totem', 'battlefield', 'p2'))]] }));
    expect(bfNames(s, 'p2')).toEqual(['Test Relic']);
  });
  it('last known information (CR 608.2h): a land that was a creature when it was destroyed shares the Creature type too, though the card in the graveyard is only a land', () => {
    const s0 = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Wild Surge'] }, p2: { battlefield: ['Test Awakening', 'Forest'] } });
    setLibrary(s0, 'p2', ['Test Charm', 'Test Bear', 'Forest']);
    const s = resolveAll(cast(s0, 'Test Wild Surge', { targets: [[obj(find(s0, 'Forest', 'battlefield', 'p2'))]] }));
    expect(bfNames(s, 'p2')).toContain('Test Bear');
  });
  it('NEGATIVE: no card shares a type: the whole library is revealed and goes back to the bottom, nothing enters', () => {
    const s0 = setup('Test Ox');
    setLibrary(s0, 'p2', ['Test Charm', 'Forest', 'Test Relic']);
    const s = resolveAll(cast(s0, 'Test Wild Surge', { targets: [[obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }));
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(libNames(s, 'p2').sort()).toEqual(['Forest', 'Test Charm', 'Test Relic']);
  });
});

describe('"X can\'t be greater than the number of players in the game. Reveal cards from the top of your library until you reveal X land cards. ..." (CR 107.3, 601.2b; Open the Way)', () => {
  const setup = (): GameState => {
    const s = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Open Road'], battlefield: ['Island', 'Island', 'Island', 'Island'] }, p2: {} });
    setLibrary(s, 'p1', ['Test Charm', 'Forest', 'Test Relic', 'Forest', 'Test Bear', 'Forest']);
    return s;
  };
  it('X is at most the number of players: with two players the number asked for is between 0 and 2', () => {
    const s = cast(setup(), 'Test Open Road', { x: [] }) as GameState;
    expect(s.zones.stack.length).toBe(1);
    expect(() => cast(setup(), 'Test Open Road', { x: [3] })).toThrow(/0 to 2/);
  });
  it('X = 2: the two first lands (Forest, Forest) enter tapped; everything revealed before them and after the first goes to the bottom', () => {
    const s = resolveAll(cast(setup(), 'Test Open Road', { x: [2] }));
    const lands = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Forest' && s.objects[id]!.controller === 'p1');
    expect(lands).toHaveLength(2);
    expect(lands.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(libNames(s, 'p1').slice(0, 2)).toEqual(['Test Bear', 'Forest']);
    expect(libNames(s, 'p1').slice(2).sort()).toEqual(['Test Charm', 'Test Relic']);
  });
  it('NEGATIVE: X = 3 is refused with two players (the cast takes a number from 0 to 2)', () => {
    expect(() => cast(setup(), 'Test Open Road', { x: [3] })).toThrow(/0 to 2/);
  });
});

describe('"For each creature exiled this way, its controller searches their library for a basic land card. Those players put those cards onto the battlefield tapped, then shuffle." (CR 701.23a, 608.2f; Winds of Abandon)', () => {
  const setup = (): GameState => {
    const s = scenario(BASICS, { defs: DEFS, p1: { hand: ['Test Wind Away'], battlefield: ['Test Bear', 'Island'] }, p2: { battlefield: ['Test Ox', 'Test Bear'] } });
    setLibrary(s, 'p2', ['Test Charm', 'Forest', 'Plains']);
    setLibrary(s, 'p1', ['Test Relic', 'Island']);
    return s;
  };
  it('the controller of the creature exiled searches THEIR library: a basic land enters tapped under their control; the caster gets nothing', () => {
    const s0 = setup();
    const forest = find(s0, 'Forest', 'library', 'p2');
    const s = resolveAll(cast(s0, 'Test Wind Away', { targets: [[obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }), { objects: [[forest]] });
    expect(exileNames(s)).toEqual(['Test Ox']);
    const lands = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Forest' && s.objects[id]!.controller === 'p2');
    expect(lands).toHaveLength(1);
    expect(s.objects[lands[0]!]!.tapped).toBe(true);
    expect(libNames(s, 'p2')).toEqual(['Test Charm', 'Plains']);
    expect(libNames(s, 'p1')).toEqual(['Test Relic', 'Island']);
  });
  it('NEGATIVE: a controller with no basic land card in the library finds nothing and the game goes on', () => {
    const s0 = setup();
    setLibrary(s0, 'p2', ['Test Charm', 'Test Relic']);
    const s = resolveAll(cast(s0, 'Test Wind Away', { targets: [[obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }));
    expect(exileNames(s)).toEqual(['Test Ox']);
    expect(bfNames(s, 'p2')).toEqual(['Test Bear']);
  });
  it('overload: every creature the caster does not control is exiled; each controller searches once for each creature (two creatures of one player: two searches, both lands enter tapped)', () => {
    const s0 = setup();
    put(s0, 'p2', 'library', 'Island');
    const lands = s0.zones.library.p2!.filter((id) => ['Forest', 'Plains', 'Island'].includes(nameOf(s0, id)));
    const s = resolveAll(cast(s0, 'Test Wind Away', {}, 'p1', 'overload'), { objects: [[lands[0]!], [lands[1]!]] });
    expect(exileNames(s)).toEqual(['Test Bear', 'Test Ox']);
    expect(bfNames(s, 'p1')).toEqual(['Island', 'Test Bear']);
    const entered = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && ['Forest', 'Plains', 'Island'].includes(nameOf(s, id)));
    expect(entered).toHaveLength(2);
    expect(entered.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});
