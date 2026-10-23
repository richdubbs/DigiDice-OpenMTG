/**
 * WP29: the worked examples of CR 613 (interaction of continuous effects) for the layers milestone 5 runs (2 is fail-closed, 4, 5, 6, 7a-7d; design 9,
 * 14), on real fixture cards compiled by the default compiler, driven through applyAction; nothing is mocked. Where the example's own card is not
 * automated, the test names the equivalent card and why. The layer system's own unit tests are in test/m5/statics (rules-613.test.ts: 613.3, 613.6 with
 * Humility and Opalescence, 613.7, 613.8 dependency incl. Blood Moon).
 *
 * Not run here: 613.6's first example ("This creature gets +1/+1 and becomes the color of your choice until end of turn", layers 5 and 7c: no automated
 * card has that wording; the Mutavault test below shows 613.6 with layers 4 and 7b instead), the "noncreature artifacts become 2/2 artifact creatures" and Svogthos examples
 * (no automated card), 613.7a (Rune of Flight on Colossus Hammer: no automated "Equipped creature ... loses flying"), layers 1a, 1b and 3 (milestone 6).
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, type AbilityDef } from '../../../src/index';
import { advanceTo, find, scenario } from '../helpers';
import { activate, cast, equivalent, gamePath, pt, resolveTop, target } from './helpers';

describe('CR 613.4d: layer 7d, switching power and toughness', () => {
  const lands = ['Forest', 'Island', 'Island', 'Mountain', 'Mountain', 'Mountain'];

  it('CR 613.4d example 1: a 1/3 (Maritime Guard) given +0/+1 (Armorer Guildmage) and switched (Twisted Image) is 4/1; then +5/+0 (Screaming Fury) makes it 4/6', () => {
    const s0 = scenario(['Maritime Guard', 'Armorer Guildmage', 'Twisted Image', 'Screaming Fury', ...lands], {
      p1: { hand: ['Twisted Image', 'Screaming Fury'], battlefield: ['Maritime Guard', 'Armorer Guildmage', ...lands] },
    });
    const guard = find(s0, 'Maritime Guard', 'battlefield');
    let s = resolveTop(activate(s0, find(s0, 'Armorer Guildmage', 'battlefield'), [target(guard)], /\+0\/\+1/));
    expect(pt(s, guard)).toEqual([1, 4]);
    s = resolveTop(cast(s, 'Twisted Image', [target(guard)]));
    expect(pt(s, guard)).toEqual([4, 1]);
    s = resolveTop(cast(s, 'Screaming Fury', [target(guard)]));
    expect(pt(s, guard)).toEqual([4, 6]); // "unswitched" 6/4
  });

  it('CR 613.4d example 2: if the +0/+1 effect ends before the switch effect ends (Blessed Orator leaves the battlefield), the creature becomes 3/1', () => {
    const s0 = scenario(['Maritime Guard', 'Blessed Orator', 'Twisted Image', 'Unsummon', ...lands], {
      p1: { hand: ['Twisted Image', 'Unsummon'], battlefield: ['Maritime Guard', 'Blessed Orator', ...lands] },
    });
    const guard = find(s0, 'Maritime Guard', 'battlefield');
    expect(pt(s0, guard)).toEqual([1, 4]); // "Other creatures you control get +0/+1."
    let s = resolveTop(cast(s0, 'Twisted Image', [target(guard)]));
    expect(pt(s, guard)).toEqual([4, 1]);
    s = resolveTop(cast(s, 'Unsummon', [target(find(s, 'Blessed Orator', 'battlefield'))]));
    expect(pt(s, guard)).toEqual([3, 1]);
  });

  it('CR 613.4d example 3: two switches cancel each other: the 1/3 with +0/+1 switched twice is 1/4', () => {
    const s0 = scenario(['Maritime Guard', 'Blessed Orator', 'Twisted Image', ...lands], {
      p1: { hand: ['Twisted Image', 'Twisted Image'], battlefield: ['Maritime Guard', 'Blessed Orator', ...lands] },
    });
    const guard = find(s0, 'Maritime Guard', 'battlefield');
    let s = resolveTop(cast(s0, 'Twisted Image', [target(guard)]));
    s = resolveTop(cast(s, 'Twisted Image', [target(guard)]));
    expect(pt(s, guard)).toEqual([1, 4]);
  });
});

describe('CR 613.5: the layer system is applied continually', () => {
  it('CR 613.5 example 1: Honor of the Pure and a black 2/2 (Bog Raiders); turned white (Niveous Wisps, layer 5) it is 3/3; when the color change ends it is 2/2 again', () => {
    const s0 = scenario(['Honor of the Pure', 'Bog Raiders', 'Niveous Wisps', 'Plains'], { p1: { hand: ['Niveous Wisps'], battlefield: ['Honor of the Pure', 'Bog Raiders', 'Plains'] } });
    const raiders = find(s0, 'Bog Raiders', 'battlefield');
    expect(pt(s0, raiders)).toEqual([2, 2]);
    let s = resolveTop(cast(s0, 'Niveous Wisps', [target(raiders)]));
    expect(getChars(s, raiders).colors).toEqual(['W']);
    expect(pt(s, raiders)).toEqual([3, 3]);
    // The example changes the color again (to red); here the "until end of turn" color change ends in the cleanup step (CR 514.2), with the same result.
    s = advanceTo(s, 2, 'upkeep');
    expect(getChars(s, raiders).colors).toEqual(['B']);
    expect(pt(s, raiders)).toEqual([2, 2]);
  });

  it('CR 613.5 example 2: Gray Ogre with a +1/+1 counter, +4/+4 (Titanic Growth), "+0/+2" (Castle) and a base P/T setter (Diminish, base 1/1 for the example\'s 0/1) is 6/8', () => {
    const lands = ['Forest', 'Plains', 'Island', 'Mountain', 'Mountain', 'Mountain', 'Mountain'];
    const s0 = scenario(['Gray Ogre', 'Titanic Growth', 'Castle', 'Diminish', ...lands], {
      p1: { hand: ['Titanic Growth', 'Castle', 'Diminish'], battlefield: [{ name: 'Gray Ogre', counters: { '+1/+1': 1 } }, ...lands] },
    });
    const ogre = find(s0, 'Gray Ogre', 'battlefield');
    expect(pt(s0, ogre)).toEqual([3, 3]); // layer 7c: the counter
    let s = resolveTop(cast(s0, 'Titanic Growth', [target(ogre)]));
    expect(pt(s, ogre)).toEqual([7, 7]);
    s = resolveTop(cast(s, 'Castle'));
    expect(pt(s, ogre)).toEqual([7, 9]);
    s = resolveTop(cast(s, 'Diminish', [target(ogre)]));
    // layer 7b sets the base 1/1 first; 7c then adds +4/+4, +0/+2 and the counter's +1/+1 (the example's 0/1 gives 5/8)
    expect(pt(s, ogre)).toEqual([6, 8]);
  });
});

describe('CR 613.6: one effect applies in each of its layers to the same set of objects', () => {
  it('Mutavault\'s "becomes a 2/2 creature with all creature types until end of turn. It\'s still a land" applies in layers 4 and 7b; +4/+4 (layer 7c) makes it a 6/6 land creature', () => {
    const s0 = scenario(['Mutavault', 'Titanic Growth', 'Forest'], { p1: { hand: ['Titanic Growth'], battlefield: ['Mutavault', 'Forest', 'Forest', 'Forest'] } });
    const vault = find(s0, 'Mutavault', 'battlefield');
    let s = resolveTop(activate(s0, vault));
    expect(getChars(s, vault).types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(pt(s, vault)).toEqual([2, 2]);
    s = resolveTop(cast(s, 'Titanic Growth', [target(vault)]));
    expect(pt(s, vault)).toEqual([6, 6]);
    expect(getChars(s, vault).types).toEqual(expect.arrayContaining(['Land', 'Creature']));
  });

  it('CR 613.6 example (Act of Treason, layers 2 and 6; MX2: layer 2 runs, core/control.ts): the creature is yours and has haste', () => {
    expect(gamePath('Act of Treason').automation.level).toBe('full');
    const s0 = scenario(['Act of Treason', 'Hill Giant', 'Mountain'], { p1: { hand: ['Act of Treason'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = resolveTop(cast(s0, 'Act of Treason', [target(giant)]));
    expect(getChars(s, giant).controller).toBe('p1');
    expect(s.objects[giant]!.controller).toBe('p1');
    expect(hasKeyword(getChars(s, giant), 'haste')).toBe(true);
  });
});

describe('CR 613.9: one continuous effect can override another', () => {
  // Grounded's "Enchanted creature loses flying." has no template (the card is partial on the game path); the equivalent card carries hand-built layer-6 JSON of the same behavior (the one equivalent the render gate accepts).
  const grounded = equivalent({ name: 'Grounded', type_line: 'Enchantment — Aura', mana_cost: '{1}{G}', colors: ['G'] }, [
    { kind: 'keyword', keyword: 'enchant', filter: { types: ['Creature'] }, text: 'Enchant creature' },
    { kind: 'static', text: 'Enchanted creature loses flying.', effects: [{ s: 'continuous', affects: { ref: 'attachedTo' }, mods: [{ layer: 6, remove: ['flying'] }] }] },
  ] as AbilityDef[]);
  const board = () => scenario(['Flight', 'Grizzly Bears', 'Island', 'Forest'], {
    p1: { hand: ['Flight', 'Grounded'], battlefield: ['Grizzly Bears', 'Island', 'Forest', 'Forest'] }, defs: [grounded],
  });

  it('the game path leaves Grounded\'s sentence manual (never applied half)', () => {
    expect(gamePath('Grounded').automation.unsupported).toEqual(['Enchanted creature loses flying.']);
  });

  it('CR 613.9 example 1: "has flying" (Flight) then "loses flying" (Grounded): the later timestamp wins and the creature has no flying', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = resolveTop(cast(s0, 'Flight', [target(bears)]));
    expect(hasKeyword(getChars(s, bears), 'flying')).toBe(true);
    s = resolveTop(cast(s, 'Grounded', [target(bears)]));
    expect(hasKeyword(getChars(s, bears), 'flying')).toBe(false);
  });

  it('CR 613.9 example 1, other order: "loses flying" first, then "has flying": the creature has flying', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = resolveTop(cast(s0, 'Grounded', [target(bears)]));
    s = resolveTop(cast(s, 'Flight', [target(bears)]));
    expect(hasKeyword(getChars(s, bears), 'flying')).toBe(true);
  });

  it('CR 613.9 example 2: "White creatures get +1/+1" (Crusade) applies to a creature made white (Niveous Wisps), whatever its previous color', () => {
    const s0 = scenario(['Crusade', 'Bog Raiders', 'Niveous Wisps', 'Plains'], { p1: { hand: ['Niveous Wisps'], battlefield: ['Crusade', 'Plains'] }, p2: { battlefield: ['Bog Raiders'] } });
    const raiders = find(s0, 'Bog Raiders', 'battlefield');
    expect(pt(s0, raiders)).toEqual([2, 2]);
    const s = resolveTop(cast(s0, 'Niveous Wisps', [target(raiders)]));
    expect(pt(s, raiders)).toEqual([3, 3]); // Crusade has no "you control": the opponent's creature gets it too
  });
});
