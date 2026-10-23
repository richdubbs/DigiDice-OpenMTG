/**
 * CR 613.3, 613.6, 613.7, 613.8: the order inside the layers. Characteristic-defining abilities first, timestamps, the started set (an effect keeps
 * applying to the same objects in later layers after its source loses the ability), dependency by trial application (including "B changes whether A
 * exists"), dependency loops, and the worked card interactions of design 9.2/9.3 (Humility and Opalescence in both timestamp orders, Blood Moon and a
 * land-type granter). No card-specific code: every card here is an ability list.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { computeAll } from '../../../src/statics/layers';
import { activated } from '../helpers';
import { board, continuous, creature, each, enchantment, fixedOn, land, nth, SELF, staticOf, tweak, withEffect } from './fixtures';

const HUMILITY = enchantment('Humility', '{2}{W}{W}', [
  staticOf('All creatures lose all abilities and have base power and toughness 1/1.', [continuous(each({ types: ['Creature'] }), [{ layer: 6, removeAll: true }, { layer: '7b', power: 1, toughness: 1 }])]),
]);

const mvOfSubject = { q: 'stat', stat: 'manaValue', of: { ref: 'subject' } } as const;
const OPALESCENCE = enchantment('Opalescence', '{2}{W}{W}', [
  staticOf('Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.', [
    continuous(each({ types: ['Enchantment'], notSubtypes: ['Aura'], other: true }), [
      { layer: 4, types: { add: ['Creature'] } },
      { layer: '7b', power: mvOfSubject, toughness: mvOfSubject },
    ]),
  ]),
]);

const pt = (s: GameState, id: string): string => `${getChars(s, id).power}/${getChars(s, id).toughness}`;

describe('CR 613.6: an effect that started in one layer keeps applying to the same objects in the later layers', () => {
  it('Humility alone: creatures lose their abilities (layer 6) and are 1/1 (layer 7b)', () => {
    const lord = creature('Test Lord', '3', '3', [{ kind: 'keyword', text: 'Flying', keyword: 'flying' }]);
    const s = board([HUMILITY, lord], ['Humility', 'Test Lord']);
    const id = nth(s, 'Test Lord');
    expect(getChars(s, id).abilities).toEqual([]);
    expect(pt(s, id)).toBe('1/1');
  });

  it('Humility made a creature by Opalescence loses its own ability in layer 6, yet its layer 7b part still applies to the set it started with', () => {
    const s = board([HUMILITY, OPALESCENCE, creature('Test Bear', '2', '2')], ['Test Bear', 'Humility', 'Opalescence']); // Opalescence is the newest
    const h = nth(s, 'Humility');
    const c = getChars(s, h);
    expect(c.types).toEqual(['Enchantment', 'Creature']); // layer 4, before layer 6
    expect(c.abilities).toEqual([]); // layer 6: it lost the ability that generated its own effect
    expect(pt(s, nth(s, 'Test Bear'))).toBe('1/1'); // 613.6: still applying in 7b
  });

  it('an effect granted in layer 6 produces its layer 7 part: "Creatures you control get +1/+1" granted to a creature', () => {
    const anthemDef = staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])]);
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear', 'Test Bear']);
    const [a, b] = [nth(s, 'Test Bear', 0), nth(s, 'Test Bear', 1)];
    expect([pt(s, a), pt(s, b)]).toEqual(['2/2', '2/2']);
    s = withEffect(s, continuous(fixedOn(s, a), [{ layer: 6, add: [anthemDef] }]));
    expect([pt(s, a), pt(s, b)]).toEqual(['3/3', '3/3']);
  });

  it('an ability removed in layer 6 generates no layer 7 effect at all (it never started)', () => {
    const anthemBear = creature('Test Anthem Bear', '2', '2', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
    let s = board([anthemBear], ['Test Anthem Bear']);
    const id = nth(s, 'Test Anthem Bear');
    expect(pt(s, id)).toBe('3/3');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, removeAll: true }]));
    expect(pt(s, id)).toBe('2/2');
  });
});

describe('design 9.3: Humility and Opalescence in both timestamp orders (layer 7b is decided by timestamp, no CR 613.8 dependency between them)', () => {
  const bear = creature('Test Bear', '2', '2');
  const shrine = enchantment('Test Shrine', '{1}{W}', []);
  const cases: [string, string[]][] = [['Humility is older', ['Test Bear', 'Humility', 'Opalescence', 'Test Shrine']], ['Opalescence is older', ['Test Bear', 'Opalescence', 'Humility', 'Test Shrine']]];

  it.each(cases)('%s: both become creatures and lose abilities exactly as the layers say', (_name, order) => {
    const s = board([HUMILITY, OPALESCENCE, bear, shrine], order);
    const [h, o, sh, b] = [nth(s, 'Humility'), nth(s, 'Opalescence'), nth(s, 'Test Shrine'), nth(s, 'Test Bear')];
    // layer 4: every OTHER non-Aura enchantment is a creature; Opalescence itself is not
    expect(getChars(s, h).types).toContain('Creature');
    expect(getChars(s, sh).types).toContain('Creature');
    expect(getChars(s, o).types).toEqual(['Enchantment']);
    // layer 6: Humility makes all creatures (the bear, the shrine, itself) lose their abilities; Opalescence is no creature, so it keeps its own
    expect(getChars(s, h).abilities).toEqual([]);
    expect(getChars(s, sh).abilities).toEqual([]);
    expect(getChars(s, o).abilities.length).toBe(1);
    // layer 7b: the later of the two setting effects wins on each enchantment creature
    const opalescenceWins = order.indexOf('Opalescence') > order.indexOf('Humility');
    expect(pt(s, b)).toBe('1/1'); // only Humility sets the bear
    expect(pt(s, h)).toBe(opalescenceWins ? '4/4' : '1/1'); // Humility's mana value is 4
    expect(pt(s, sh)).toBe(opalescenceWins ? '2/2' : '1/1');
  });
});

describe('CR 613.3 and 613.4a: characteristic-defining abilities come first in their layer, whatever the timestamps', () => {
  const dye = enchantment('Test Dye', '{1}{U}', [staticOf('Each creature is blue.', [continuous(each({ types: ['Creature'] }), [{ layer: 5, colors: { set: ['U'] } }])])]);
  const devoid = creature('Test Devoid', '2', '2', [staticOf('Devoid', [continuous(SELF, [{ layer: 5, colors: { set: [] } }], true)])], { cost: '{1}{R}' });

  it.each([['the CDA is newer', ['Test Dye', 'Test Devoid']], ['the CDA is older', ['Test Devoid', 'Test Dye']]])('%s: devoid\'s "colorless" is applied first, the ordinary "blue" effect then wins', (_n, order) => {
    const s = board([dye, devoid], order);
    expect(getChars(s, nth(s, 'Test Devoid')).colors).toEqual(['U']);
  });

  it('with no other effect the CDA does its job', () => {
    const s = board([devoid], ['Test Devoid']);
    expect(getChars(s, nth(s, 'Test Devoid')).colors).toEqual([]);
  });
});

describe('CR 613.7: timestamps', () => {
  it('within a sublayer a later timestamp applies later: of two static 7b effects, the newer object wins', () => {
    const set = (n: string, v: string) => creature(n, '9', '9', [staticOf(`Test: ${n}`, [continuous(each({ types: ['Creature'], other: true }), [{ layer: '7b', power: Number(v), toughness: Number(v) }])])]);
    const [a, b, target] = [set('Test Setter A', '4'), set('Test Setter B', '6'), creature('Test Target', '1', '1')];
    const s1 = board([a, b, target], ['Test Setter A', 'Test Setter B', 'Test Target']);
    expect(pt(s1, nth(s1, 'Test Target'))).toBe('6/6');
    const s2 = board([a, b, target], ['Test Setter B', 'Test Setter A', 'Test Target']);
    expect(pt(s2, nth(s2, 'Test Target'))).toBe('4/4');
  });

  it('CR 613.7a: an ability granted to an object takes the later of the object\'s timestamp and the granting effect\'s', () => {
    // The grantee is the OLDEST object; a resolved effect (timestamp T1) makes everything 1/1 in 7b; a later effect (T2 > T1) grants the grantee
    // "~ has base power and toughness 3/3". If the granted ability took the object's own (old) timestamp it would apply BEFORE T1 and lose.
    let s = board([creature('Test Grantee', '2', '2'), creature('Test Other', '2', '2')], ['Test Grantee', 'Test Other']);
    const g = nth(s, 'Test Grantee');
    s = withEffect(s, continuous(each({ types: ['Creature'] }), [{ layer: '7b', power: 1, toughness: 1 }]));
    s = withEffect(s, continuous(fixedOn(s, g), [{ layer: 6, add: [staticOf('Test Grantee has base power and toughness 3/3.', [continuous(SELF, [{ layer: '7b', power: 3, toughness: 3 }])])] }]));
    expect(pt(s, g)).toBe('3/3');
    expect(pt(s, nth(s, 'Test Other'))).toBe('1/1');
  });

  it('two resolved effects with the same timestamp are ordered by effect id (deterministic)', () => {
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 5, toughness: 5 }]));
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: '7b', power: 7, toughness: 7 }]));
    s = tweak(s, (t) => { for (const e of t.continuousEffects) e.timestamp = 100; });
    const a = pt(s, id);
    expect(pt(s, id)).toBe(a);
    expect(a).toBe('7/7'); // e1 sorts after e0
  });
});

describe('CR 613.8: dependency overrides timestamp order', () => {
  it('A depends on B when B changes what A applies to: "creatures with power 3 or more get +0/+1" waits for "creatures get +1/+0", although it is older', () => {
    const older = enchantment('Test Bulwark', '{2}', [staticOf('Creatures with power 3 or greater get +0/+1.', [continuous(each({ types: ['Creature'], power: { op: '>=', value: 3 } }), [{ layer: '7c', power: 0, toughness: 1 }])])]);
    const newer = enchantment('Test Sharpen', '{2}', [staticOf('Creatures get +1/+0.', [continuous(each({ types: ['Creature'] }), [{ layer: '7c', power: 1, toughness: 0 }])])]);
    const bear = creature('Test Bear', '2', '2');
    for (const order of [['Test Bulwark', 'Test Sharpen', 'Test Bear'], ['Test Sharpen', 'Test Bulwark', 'Test Bear']]) {
      const s = board([older, newer, bear], order);
      expect(pt(s, nth(s, 'Test Bear')), order.join(',')).toBe('3/3'); // the bear is a 3-power creature when the first effect looks, in both orders
    }
  });

  it('a dependency loop is ignored and timestamp order is used (CR 613.8b)', () => {
    // A: creatures with power <= 2 get +1/+0.  B: creatures with power >= 3 get -1/+0.  Each can pull a creature into the other's set: a loop.
    const A = enchantment('Test Rise', '{1}', [staticOf('Creatures with power 2 or less get +1/+0.', [continuous(each({ types: ['Creature'], power: { op: '<=', value: 2 } }), [{ layer: '7c', power: 1, toughness: 0 }])])]);
    const B = enchantment('Test Fall', '{1}', [staticOf('Creatures with power 3 or more get -1/+0.', [continuous(each({ types: ['Creature'], power: { op: '>=', value: 3 } }), [{ layer: '7c', power: -1, toughness: 0 }])])]);
    const [x, y] = [creature('Test Two', '2', '2'), creature('Test Three', '3', '3')];
    const aFirst = board([A, B, x, y], ['Test Rise', 'Test Fall', 'Test Two', 'Test Three']);
    expect([pt(aFirst, nth(aFirst, 'Test Two')), pt(aFirst, nth(aFirst, 'Test Three'))]).toEqual(['2/2', '2/3']);
    const bFirst = board([A, B, x, y], ['Test Fall', 'Test Rise', 'Test Two', 'Test Three']);
    expect([pt(bFirst, nth(bFirst, 'Test Two')), pt(bFirst, nth(bFirst, 'Test Three'))]).toEqual(['3/2', '3/3']);
  });

  describe('existence: Blood Moon against a static ability that grants a land type (CR 613.8a, 305.7)', () => {
    const URBORG = land('Test Urborg', [staticOf('Each land is a Swamp in addition to its other land types.', [continuous(each({ types: ['Land'] }), [{ layer: 4, subtypes: { add: ['Swamp'] } }])])], 'Legendary Land');
    const BLOOD_MOON = enchantment('Test Blood Moon', '{2}{R}', [staticOf('Nonbasic lands are Mountains.', [continuous(each({ types: ['Land'], notSupertypes: ['Basic'] }), [{ layer: 4, subtypes: { set: ['Mountain'] } }])])]);
    const TOWER = land('Test Tower', [activated('{T}: Add {G}.', { tap: true })], 'Land — Tower');

    it('without Blood Moon the land-type granter makes every land a Swamp', () => {
      const s = board([URBORG, TOWER], ['Test Urborg', 'Test Tower', 'Plains']);
      expect(getChars(s, nth(s, 'Plains')).subtypes.sort()).toEqual(['Plains', 'Swamp']);
      expect(getChars(s, nth(s, 'Test Tower')).subtypes.sort()).toEqual(['Swamp', 'Tower']);
    });

    it.each([['Urborg is older', ['Test Urborg', 'Test Blood Moon']], ['Blood Moon is older', ['Test Blood Moon', 'Test Urborg']]])('%s: Blood Moon is applied first, takes the ability away, and the Swamp is never granted', (_n, order) => {
      const s = board([URBORG, BLOOD_MOON, TOWER], [...order, 'Test Tower', 'Plains']);
      const urborg = getChars(s, nth(s, 'Test Urborg'));
      expect(urborg.subtypes).toEqual(['Mountain']);
      expect(urborg.abilities.map((a) => a.key)).toEqual(['r:basic:R']); // its printed static ability is gone, the Mountain\'s mana ability came instead
      expect(getChars(s, nth(s, 'Test Tower')).subtypes).toEqual(['Mountain']);
      expect(getChars(s, nth(s, 'Plains')).subtypes).toEqual(['Plains']); // basic: not a Mountain, and no Swamp, since Urborg's effect never applied
    });
  });

  it('the dependency check works on a scratch copy: computing never edits the state or the cards\' definitions', () => {
    const URB = land('Test Urborg', [staticOf('Each land is a Swamp.', [continuous(each({ types: ['Land'] }), [{ layer: 4, subtypes: { add: ['Swamp'] } }])])], 'Legendary Land');
    const BM = enchantment('Test Blood Moon', '{2}{R}', [staticOf('Nonbasic lands are Mountains.', [continuous(each({ types: ['Land'], notSupertypes: ['Basic'] }), [{ layer: 4, subtypes: { set: ['Mountain'] } }])])]);
    const s = board([URB, BM], ['Test Urborg', 'Test Blood Moon', 'Plains']);
    const before = JSON.stringify(s);
    computeAll(s);
    computeAll(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});
