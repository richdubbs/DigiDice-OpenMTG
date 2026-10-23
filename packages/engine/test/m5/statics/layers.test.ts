/**
 * Design 9.2 "the layer table": one group of tests per layer implemented in milestone 5 (2, 4, 5, 6, 7a, 7b, 7c, 7d), each checking the rule it implements
 * through the real characteristics function (`getChars`), with static abilities and resolved effects written as data. CR 613.1-613.4.
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, type AbilityDef, type GameState } from '../../../src/index';
import { computeAll } from '../../../src/statics/layers';
import { applyMods } from '../../../src/statics/mods';
import { activated } from '../helpers';
import { board, continuous, creature, each, enchantment, find, fixedOn, land, nth, SELF, staticOf, tweak, withEffect } from './fixtures';

const FLYING: AbilityDef = { kind: 'keyword', text: 'Flying', keyword: 'flying' };
const MANA_G: AbilityDef = activated('{T}: Add {G}.', { tap: true }) as AbilityDef;

const bear = creature('Test Bear', '2', '2');

describe('layer 2 (CR 613.1b): control-changing effects', () => {
  it('a resolved effect that gains control changes `controller` in the characteristics, not the stored field', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 2, controller: { ref: 'fixed', players: ['p2'] } }]));
    expect(getChars(s, id).controller).toBe('p2');
    expect(s.objects[id]!.controller).toBe('p1');
  });

  it('a static ability of an Aura: "You control enchanted creature" uses the Aura\'s controller (CR 303.4e, 109.5)', () => {
    const steal = enchantment('Test Steal', '{3}{U}{U}', [staticOf('You control enchanted creature.', [continuous({ ref: 'attachedTo' }, [{ layer: 2, controller: { ref: 'you' } }])])], 'Enchantment — Aura');
    let s = board([bear, steal], ['Test Bear'], ['Test Steal']);
    const [b, a] = [nth(s, 'Test Bear'), nth(s, 'Test Steal')];
    s = tweak(s, (t) => { t.objects[a]!.attachedTo = b; });
    expect(getChars(s, b).controller).toBe('p2');
    // the aura going away gives it back
    s = tweak(s, (t) => { delete t.objects[a]!.attachedTo; });
    expect(getChars(s, b).controller).toBe('p1');
  });

  it('layer 2 comes before the later layers: "creatures you control get +1/+1" reaches a creature stolen from the other player (CR 613.1b, 613.5)', () => {
    const anthem = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    let s = board([bear, anthem], ['Test Bear'], ['Test Anthem']);
    const b = nth(s, 'Test Bear');
    expect(getChars(s, b).power).toBe('2'); // p1's bear, p2's anthem
    s = withEffect(s, continuous(fixedOn(s, b), [{ layer: 2, controller: { ref: 'fixed', players: ['p2'] } }]));
    expect(getChars(s, b).controller).toBe('p2');
    expect(getChars(s, b).power).toBe('3');
  });
});

describe('layer 4 (CR 613.1d): type-changing effects', () => {
  const artifactMaker = enchantment('Test Forge', '{2}', [staticOf('Each creature is an artifact in addition to its other types.', [continuous(each({ types: ['Creature'] }), [{ layer: 4, types: { add: ['Artifact'] } }])])]);

  it('adds a card type (in addition to the others) to every object the filter matches, and only to those', () => {
    const s = board([bear, artifactMaker, land('Test Wastes')], ['Test Bear', 'Test Forge', 'Test Wastes']);
    expect(getChars(s, nth(s, 'Test Bear')).types).toEqual(['Creature', 'Artifact']);
    expect(getChars(s, nth(s, 'Test Wastes')).types).toEqual(['Land']);
    expect(getChars(s, nth(s, 'Test Forge')).types).toEqual(['Enchantment']);
  });

  it('losing the Creature type also loses the creature subtypes (CR 205.3d), but keeps the supertypes', () => {
    let s = board([creature('Test Legend', '2', '2', [], { type: 'Legendary Creature — Bear Warrior' })], ['Test Legend']);
    const id = nth(s, 'Test Legend');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 4, types: { set: ['Artifact'] } }]));
    const c = getChars(s, id);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual([]);
    expect(c.supertypes).toEqual(['Legendary']);
  });

  it('"becomes a Mountain" replaces the land types and, for a basic land type, the abilities generated from rules text (CR 305.7); the new type brings its mana ability (CR 305.6)', () => {
    let s = board([land('Test Tower', [MANA_G], 'Land — Forest Tower')], ['Test Tower']);
    const id = nth(s, 'Test Tower');
    const before = getChars(s, id);
    expect(before.abilities.map((a) => a.key)).toEqual(['p:0:0', 'r:basic:G']); // the printed ability and the one the Forest type gives it
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 4, subtypes: { set: ['Mountain'] } }]));
    const c = getChars(s, id);
    expect(c.subtypes).toEqual(['Mountain']); // Tower is a land type too, so it went with Forest
    expect(c.abilities.map((a) => a.key)).toEqual(['r:basic:R']); // the printed mana ability is gone with its old land types
  });

  it('"becomes a Mountain" keeps a creature type: only the subtypes of the same class are replaced (CR 205.3d)', () => {
    let s = board([creature('Test Dryad', '1', '1', [], { type: 'Land Creature — Forest Dryad' })], ['Test Dryad']);
    const id = nth(s, 'Test Dryad');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 4, subtypes: { set: ['Swamp'] } }]));
    expect(getChars(s, id).subtypes).toEqual(['Dryad', 'Swamp']);
  });

  it('changeling: every creature type (CR 702.73a), only on something that is a creature', () => {
    const changeling = creature('Test Changeling', '1', '1', [staticOf('Test Changeling is every creature type.', [continuous(SELF, [{ layer: 4, subtypes: { all: true } }], true)])], { type: 'Creature — Shapeshifter' });
    const s = board([changeling, land('Test Wastes')], ['Test Changeling']);
    const c = getChars(s, nth(s, 'Test Changeling'));
    for (const t of ['Shapeshifter', 'Elf', 'Goblin', 'Zombie', 'Time Lord']) expect(c.subtypes, t).toContain(t);
    expect(c.subtypes).not.toContain('Forest'); // no land types
  });

  it('a type granted in layer 4 is seen by a filter in a later layer of ANOTHER object\'s effect (all objects are computed layer by layer together)', () => {
    const lord = creature('Test Artifact Lord', '1', '1', [staticOf('Artifact creatures you control get +1/+1.', [continuous(each({ allTypes: ['Artifact', 'Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    const s = board([bear, artifactMaker, lord], ['Test Bear', 'Test Forge', 'Test Artifact Lord']);
    expect(getChars(s, nth(s, 'Test Bear')).power).toBe('3'); // an artifact creature thanks to the Forge, in layer 4, before the lord's layer 7c
  });
});

describe('layer 5 (CR 613.1e): color-changing effects', () => {
  const white = creature('Test White', '2', '2', [], { cost: '{1}{W}' });

  it('set, add and remove', () => {
    let s = board([white], ['Test White']);
    const id = nth(s, 'Test White');
    expect(getChars(s, id).colors).toEqual(['W']);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 5, colors: { add: ['U'] } }]));
    expect(getChars(s, id).colors).toEqual(['W', 'U']);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 5, colors: { remove: ['W'] } }]));
    expect(getChars(s, id).colors).toEqual(['U']);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 5, colors: { set: ['R', 'G'] } }]));
    expect(getChars(s, id).colors).toEqual(['R', 'G']);
  });

  it('"becomes the color of your choice": the color a linked ability chose (CR 607.2d)', () => {
    let s = board([white, creature('Test Chooser', '1', '1')], ['Test White', 'Test Chooser']);
    const [w, ch] = [nth(s, 'Test White'), nth(s, 'Test Chooser')];
    s = tweak(s, (t) => { t.objects[ch]!.links = { color: { values: ['red'] } }; });
    s = withEffect(s, continuous(fixedOn(s, w), [{ layer: 5, colors: { chosen: 'color' } }]), { source: ch });
    expect(getChars(s, w).colors).toEqual(['R']);
  });

  it('colorless stays colorless until an effect colors it, and a color filter sees the result (anthem for white creatures)', () => {
    const honor = enchantment('Test Honor', '{2}{W}', [staticOf('White creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], colors: ['W'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    let s = board([creature('Test Drone', '2', '2', [], { type: 'Artifact Creature — Construct' }), honor], ['Test Drone', 'Test Honor']);
    const d = nth(s, 'Test Drone');
    expect(getChars(s, d).colors).toEqual([]);
    expect(getChars(s, d).power).toBe('2');
    s = withEffect(s, continuous(fixedOn(s, d), [{ layer: 5, colors: { set: ['W'] } }])); // CR 613.5: Honor of the Pure's example
    expect(getChars(s, d).power).toBe('3');
  });
});

describe('layer 6 (CR 613.1f): abilities', () => {
  it('adds an ability with a granted key g:<effect id>:<n>, and a granted keyword shows in `keywords` and `hasKeyword`', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    expect(hasKeyword(getChars(s, id), 'flying')).toBe(false);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [FLYING, MANA_G] }]));
    const c = getChars(s, id);
    const eff = s.continuousEffects[0]!.id;
    expect(hasKeyword(c, 'flying')).toBe(true);
    expect(c.abilities.map((a) => a.key)).toEqual([`g:${eff}:0`, `g:${eff}:1`]);
    expect(c.abilities.map((a) => a.origin)).toEqual(['granted', 'granted']);
    expect(c.abilities[0]!.grantedBy).toBe(eff);
  });

  it('removes a named keyword and leaves the others; "loses all abilities" removes everything it has at that moment, in timestamp order', () => {
    let s = board([creature('Test Flyer', '2', '2', [FLYING, { kind: 'keyword', text: 'Haste', keyword: 'haste' }])], ['Test Flyer']);
    const id = nth(s, 'Test Flyer');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, remove: ['flying'] }]));
    expect(getChars(s, id).keywords.map((k) => k.keyword)).toEqual(['haste']);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, removeAll: true }]));
    expect(getChars(s, id).abilities).toEqual([]);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [FLYING] }])); // later timestamp: granted after the removal, so it stays
    expect(getChars(s, id).keywords.map((k) => k.keyword)).toEqual(['flying']);
  });

  it('an earlier grant is lost to a later "loses all abilities"', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [FLYING] }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, removeAll: true }]));
    expect(hasKeyword(getChars(s, id), 'flying')).toBe(false);
  });

  it('"can\'t have" removes the keyword and refuses it afterwards (CR 613.1f)', () => {
    let s = board([creature('Test Flyer', '2', '2', [FLYING])], ['Test Flyer']);
    const id = nth(s, 'Test Flyer');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, cantHave: ['flying'] }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [FLYING] }]));
    const c = getChars(s, id);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(c.cantHave).toEqual(['flying']);
  });

  it('a keyword counter grants its keyword (CR 122.1b)', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = tweak(s, (t) => { t.objects[id]!.counters['flying'] = 1; });
    expect(hasKeyword(getChars(s, id), 'flying')).toBe(true);
    expect(getChars(s, id).abilities[0]!.key).toBe(`g:ctr:${id}:0`);
  });

  it('a static ability grants an ability to other objects, live (CR 611.3a): "Creatures you control have flying."', () => {
    const lord = creature('Test Skylord', '2', '2', [staticOf('Other creatures you control have flying.', [continuous(each({ types: ['Creature'], controller: 'you', other: true }), [{ layer: 6, add: [FLYING] }])])]);
    let s = board([bear, lord], ['Test Bear', 'Test Skylord']);
    const [b, l] = [nth(s, 'Test Bear'), nth(s, 'Test Skylord')];
    expect(hasKeyword(getChars(s, b), 'flying')).toBe(true);
    expect(hasKeyword(getChars(s, l), 'flying')).toBe(false);
    s = tweak(s, (t) => { t.objects[b]!.controller = 'p2'; });
    expect(hasKeyword(getChars(s, b), 'flying')).toBe(false);
  });

  it('the intrinsic mana ability of a basic land type is a rule-generated ability with key r:basic:<C> (CR 305.6)', () => {
    const s = board([], [], []);
    expect(getChars(s, find(s, 'Plains', 'library')).abilities.map((a) => a.key)).toEqual(['r:basic:W']);
  });
});

describe('layer 7 (CR 613.4)', () => {
  it('7a: a characteristic-defining ability defines "*" power and toughness, in every zone (CR 604.3, 613.4a)', () => {
    const count = { q: 'count', of: each({ types: ['Creature'], controller: 'you' }) } as const;
    const cdaCreature = creature('Test Star', '*', '*', [staticOf('Test Star\'s power and toughness are each equal to the number of creatures you control.', [continuous(SELF, [{ layer: '7a', power: count, toughness: count }], true)])]);
    let s = board([cdaCreature, bear], ['Test Star', 'Test Bear', 'Test Bear']);
    const star = nth(s, 'Test Star');
    expect(getChars(s, star).power).toBe('3');
    expect(getChars(s, star).toughness).toBe('3');
    // in the graveyard it is still defined (a CDA works everywhere)
    s = tweak(s, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== star);
      t.objects[star]!.zone = 'graveyard';
      t.zones.graveyard['p1']!.push(star);
    });
    expect(getChars(s, star).power).toBe('2');
  });

  it('7b: sets base power and toughness; 7c effects still apply on top of it whatever the timestamps (CR 613.4b-c)', () => {
    const anthem = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    let s = board([anthem, bear], ['Test Anthem', 'Test Bear']); // the anthem is older than the set effect and the bear
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 0, toughness: 1 }]));
    expect(getChars(s, id).power).toBe('1');
    expect(getChars(s, id).toughness).toBe('2');
  });

  it('7b: two setting effects apply in timestamp order, the later one wins', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 5, toughness: 5 }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 1, toughness: 1 }]));
    expect(getChars(s, id).power).toBe('1');
  });

  it('7c: +1/+1 and -1/-1 counters change power and toughness (CR 122.1a, 613.4c), and stack with other 7c effects (the CR 613.5 Gray Ogre example)', () => {
    let s = board([creature('Test Ogre', '2', '2')], ['Test Ogre']);
    const id = nth(s, 'Test Ogre');
    s = tweak(s, (t) => { t.objects[id]!.counters['+1/+1'] = 1; }); // 3/3
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7c', power: 4, toughness: 4 }])); // 7/7
    s = withEffect(s, continuous(each({ types: ['Creature'] }), [{ layer: '7c', power: 0, toughness: 2 }])); // a resolved effect over a live set: 7/9
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 0, toughness: 1 }])); // becomes 0/1 (7b), then 7c: 0+1+4+0=5, 1+1+4+2=8
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['5', '8']);
  });

  it('7c: -1/-1 counters win against +1/+1 counters one for one (the net count is applied)', () => {
    let s = board([creature('Test Ogre', '2', '2')], ['Test Ogre']);
    const id = nth(s, 'Test Ogre');
    s = tweak(s, (t) => { t.objects[id]!.counters['+1/+1'] = 1; t.objects[id]!.counters['-1/-1'] = 3; });
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['0', '0']);
  });

  it('7d: switches power and toughness after everything else (the CR 613.4d example: 1/3, +0/+1, switch, +5/+0 is 4/6)', () => {
    let s = board([creature('Test Wall', '1', '3')], ['Test Wall']);
    const id = nth(s, 'Test Wall');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7c', power: 0, toughness: 1 }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7d', switchPT: true }]));
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['4', '1']);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7c', power: 5, toughness: 0 }]));
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['4', '6']);
  });

  it('7d: two switches cancel', () => {
    let s = board([creature('Test Wall', '1', '3')], ['Test Wall']);
    const id = nth(s, 'Test Wall');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7d', switchPT: true }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7d', switchPT: true }]));
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['1', '3']);
  });

  it('a "*" that no characteristic-defining ability evaluates stays "*" (the card is manual), and +1/+1 does not turn it into a number', () => {
    let s = board([creature('Test Star', '*', '*')], ['Test Star']);
    const id = nth(s, 'Test Star');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7c', power: 1, toughness: 1 }]));
    expect([getChars(s, id).power, getChars(s, id).toughness]).toEqual(['*', '*']);
  });
});

describe('Auras and Equipment: statics that read what they are attached to (CR 301.5, 303.4, 613.7e)', () => {
  const rancor = enchantment('Test Rancor', '{G}', [staticOf('Enchanted creature gets +2/+0 and has trample.', [continuous({ ref: 'attachedTo' }, [{ layer: '7c', power: 2, toughness: 0 }, { layer: 6, add: [{ kind: 'keyword', text: 'Trample', keyword: 'trample' }] }])])], 'Enchantment — Aura');

  it('gives its bonus to the creature it is attached to, in two layers, and to nothing else', () => {
    let s = board([bear, rancor], ['Test Bear', 'Test Bear', 'Test Rancor']);
    const [b0, b1, r] = [nth(s, 'Test Bear', 0), nth(s, 'Test Bear', 1), nth(s, 'Test Rancor')];
    s = tweak(s, (t) => { t.objects[r]!.attachedTo = b0; });
    expect([getChars(s, b0).power, hasKeyword(getChars(s, b0), 'trample')]).toEqual(['4', true]);
    expect([getChars(s, b1).power, hasKeyword(getChars(s, b1), 'trample')]).toEqual(['2', false]);
  });

  it('an unattached Aura, or one attached to something that left the battlefield, gives nothing', () => {
    let s = board([bear, rancor], ['Test Bear', 'Test Rancor']);
    const [b, r] = [nth(s, 'Test Bear'), nth(s, 'Test Rancor')];
    expect(getChars(s, b).power).toBe('2');
    s = tweak(s, (t) => { t.objects[r]!.attachedTo = b; t.objects[b]!.zone = 'graveyard'; t.zones.battlefield = t.zones.battlefield.filter((x) => x !== b); t.zones.graveyard['p1']!.push(b); });
    expect(getChars(s, r).types).toEqual(['Enchantment']);
    expect(getChars(s, b).power).toBe('2'); // in the graveyard the Aura does not reach it
  });
});

describe('rule-generated abilities are abilities like any other (CR 305.6, 613.1f)', () => {
  it('"loses all abilities" takes the intrinsic mana ability of a basic land type away: a Forest that is a creature under Humility cannot tap for mana', () => {
    const humility = enchantment('Humility', '{2}{W}{W}', [staticOf('All creatures lose all abilities and have base power and toughness 1/1.', [continuous(each({ types: ['Creature'] }), [{ layer: 6, removeAll: true }, { layer: '7b', power: 1, toughness: 1 }])])]);
    let s = board([humility], ['Humility', 'Plains']);
    const plains = nth(s, 'Plains');
    expect(getChars(s, plains).abilities.map((a) => a.key)).toEqual(['r:basic:W']);
    s = withEffect(s, continuous(fixedOn(s, plains), [{ layer: 4, types: { add: ['Creature'] } }])); // an animation effect (layer 4); Humility then hits it in layer 6
    expect(getChars(s, plains).abilities).toEqual([]);
    expect(getChars(s, plains).subtypes).toEqual(['Plains']);
  });
});

describe('applyMods is pure (design 9.2: the dependency check applies it to a scratch copy)', () => {
  it('returns a changed copy and leaves its input and its arrays alone', () => {
    const s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    const all = computeAll(s);
    const c = all.get(id)!;
    const before = JSON.stringify(c);
    const out = applyMods(c, [{ layer: 4, types: { add: ['Artifact'] }, subtypes: { add: ['Construct'] } }, { layer: 5, colors: { add: ['R'] } }, { layer: 6, add: [FLYING] }, { layer: '7c', power: 2, toughness: 2 }], id, s, all);
    expect(JSON.stringify(c)).toBe(before);
    expect(out).not.toBe(c);
    expect(out.types).toEqual(['Creature', 'Artifact']);
    expect(c.types).toEqual(['Creature']);
    expect([out.power, out.toughness]).toEqual(['4', '4']);
    expect(applyMods(c, [], id, s, all)).toBe(c); // nothing to do: the very same record
    expect(applyMods(c, [{ layer: '1a', copyOf: { ref: 'self' } }, { layer: 3, changeWord: { from: 'a', to: 'b', kind: 'color' } }], id, s, all)).toBe(c); // milestone 6 layers change nothing yet
  });
});

describe('statics: zones, conditions, phasing', () => {
  it('a static ability functions only in its zone (battlefield by default, CR 113.6); a card in the graveyard gives no anthem', () => {
    const anthem = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    let s = board([anthem, bear], ['Test Anthem', 'Test Bear']);
    const [a, b] = [nth(s, 'Test Anthem'), nth(s, 'Test Bear')];
    expect(getChars(s, b).power).toBe('3');
    s = tweak(s, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== a);
      t.objects[a]!.zone = 'graveyard';
      t.zones.graveyard['p1']!.push(a);
    });
    expect(getChars(s, b).power).toBe('2');
  });

  it('"as long as" wraps every effect (CR 611.3a): a condition on the controller\'s life', () => {
    const berserk = creature('Test Berserker', '2', '2', [
      staticOf('As long as you have 10 or less life, Test Berserker gets +3/+0.', [continuous(SELF, [{ layer: '7c', power: 3, toughness: 0 }])], {
        condition: { cond: 'compare', left: { q: 'life', of: { ref: 'you' } }, op: '<=', right: 10 },
      }),
    ]);
    let s = board([berserk], ['Test Berserker']);
    const id = nth(s, 'Test Berserker');
    expect(getChars(s, id).power).toBe('2');
    s = tweak(s, (t) => { t.players[0]!.life = 7; });
    expect(getChars(s, id).power).toBe('5');
  });

  it('a phased-out permanent gives no effect and is not affected (CR 702.26b)', () => {
    const anthem = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    let s = board([anthem, bear], ['Test Anthem', 'Test Bear']);
    const [a, b] = [nth(s, 'Test Anthem'), nth(s, 'Test Bear')];
    s = tweak(s, (t) => { t.objects[a]!.phasedOut = true; });
    expect(getChars(s, b).power).toBe('2');
    s = tweak(s, (t) => { t.objects[a]!.phasedOut = false; t.objects[b]!.phasedOut = true; });
    expect(getChars(s, b).power).toBe('2');
  });

  it('a resolved effect locks its affected set in (CR 611.2c) while a static ability keeps re-evaluating (CR 611.3a)', () => {
    let s = board([bear], ['Test Bear', 'Test Bear']);
    const [first, second] = [nth(s, 'Test Bear', 0), nth(s, 'Test Bear', 1)];
    // a resolved effect over "each creature": its set was fixed to the first bear when it resolved
    s = withEffect(s, continuous(fixedOn(s, first), [{ layer: '7c', power: 1, toughness: 1 }]));
    s = tweak(s, (t) => { t.objects[second]!.tapped = true; });
    expect([getChars(s, first).power, getChars(s, second).power]).toEqual(['3', '2']);
  });

  it('a handle whose object changed zone is a new object and is skipped (CR 400.7)', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous({ ref: 'fixed', objects: [{ id, zone: 'graveyard' }] }, [{ layer: '7c', power: 1, toughness: 1 }]));
    expect(getChars(s, id).power).toBe('2');
  });

  it('"for as long as the source is on the battlefield" ends the effect when the source leaves', () => {
    const src = creature('Test Source', '1', '1');
    let s = board([bear, src], ['Test Bear', 'Test Source']);
    const [b, o] = [nth(s, 'Test Bear'), nth(s, 'Test Source')];
    s = withEffect(s, continuous(fixedOn(s, b), [{ layer: '7c', power: 2, toughness: 2 }]), { source: o, duration: { d: 'whileSource', as: 'onBattlefield' } });
    expect(getChars(s, b).power).toBe('4');
    s = tweak(s, (t) => { t.zones.battlefield = t.zones.battlefield.filter((x) => x !== o); t.objects[o]!.zone = 'graveyard'; t.zones.graveyard['p1']!.push(o); });
    expect(getChars(s, b).power).toBe('2');
  });

  it('effect records that are not continuous (a regeneration shield, a player restriction; transition T1 typed them) do not touch characteristics', () => {
    let s = board([bear], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = tweak(s, (t) => {
      t.continuousEffects.push({
        id: 'shield1', source: null, sourceName: 'test', controller: 'p1', timestamp: 99, startedTurn: 1, duration: { d: 'endOfTurn' }, usesLeft: 1,
        effect: { s: 'replace', replaces: { ev: 'action', verb: 'destroy', object: { is: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] } } }, body: { b: 'regeneration' }, shield: { uses: 1 } },
      });
      t.continuousEffects.push({ id: 'restrict1', source: null, sourceName: 'test', controller: 'p1', timestamp: 100, startedTurn: 1, duration: { d: 'endOfTurn' }, effect: { s: 'restrict', subject: { ref: 'fixed', players: ['p1'] }, mode: 'cant', action: 'gainLife' } });
    });
    expect(getChars(s, id).power).toBe('2');
  });

  it('a state is unchanged by asking: computing characteristics never edits the state', () => {
    const s = board([bear], ['Test Bear']);
    const before = JSON.stringify(s);
    for (const id of s.zones.battlefield) getChars(s, id);
    expect(JSON.stringify(s)).toBe(before);
  });
});

export type _Keep = GameState;
