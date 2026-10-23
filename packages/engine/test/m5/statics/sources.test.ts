/**
 * Which states need the layer system (`layerSourcesPresent`), statics that work outside the battlefield (CR 113.6, 604.3), and a stress board:
 * the answer must be right whether or not the shortcut for "nothing can change anything" is taken.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { computeAll } from '../../../src/statics/layers';
import { layerSourcesPresent } from '../../../src/statics/live';
import { scenario } from '../helpers';
import { board, continuous, creature, each, enchantment, nth, SELF, staticOf } from './fixtures';

const ANTHEM = enchantment('Test Anthem', '{2}{W}', [staticOf('Creatures you control get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 1 }])])]);
const count = { q: 'count', of: each({ types: ['Creature'], controller: 'you' }) } as const;
const STAR = creature('Test Star', '*', '*', [staticOf('Test Star\'s power and toughness are each equal to the number of creatures you control.', [continuous(SELF, [{ layer: '7a', power: count, toughness: count }], true)])]);
const BEAR = creature('Test Bear', '2', '2');

describe('layerSourcesPresent: only objects that are where their static abilities work count', () => {
  it('an anthem in the library or the hand is no source; on the battlefield it is', () => {
    const inLibrary = scenario([], { defs: [ANTHEM, BEAR], p1: { battlefield: ['Test Bear'], hand: ['Test Anthem'] } });
    expect(layerSourcesPresent(inLibrary)).toBe(false);
    expect(getChars(inLibrary, nth(inLibrary, 'Test Bear')).power).toBe('2');
    const onBattlefield = board([ANTHEM, BEAR], ['Test Bear', 'Test Anthem']);
    expect(layerSourcesPresent(onBattlefield)).toBe(true);
  });

  it('a characteristic-defining ability works in every zone: a "*" creature in the hand is a source and is evaluated there (CR 604.3)', () => {
    const s = scenario([], { defs: [STAR, BEAR], p1: { battlefield: ['Test Bear', 'Test Bear'], hand: ['Test Star'] } });
    expect(layerSourcesPresent(s)).toBe(true);
    const id = s.zones.hand['p1']!.find((x) => s.objects[x]!.defId === 'Test Star')!;
    expect(getChars(s, id).power).toBe('2'); // the two bears p1 controls (the card in hand is not one of them)
    expect(JSON.stringify(getChars(s, id))).toBe(JSON.stringify(computeAll(s).get(id)));
  });

  it('a static ability that works from the graveyard (zone: graveyard) is a source there and nowhere else', () => {
    const gy = creature('Test Graveyard Lord', '1', '1', [staticOf('As long as this is in your graveyard, creatures you control get +1/+0.', [continuous(each({ types: ['Creature'], controller: 'you' }), [{ layer: '7c', power: 1, toughness: 0 }])], { zone: ['graveyard'] })]);
    const inYard = scenario([], { defs: [gy, BEAR], p1: { battlefield: ['Test Bear'], graveyard: ['Test Graveyard Lord'] } });
    expect(layerSourcesPresent(inYard)).toBe(true);
    expect(getChars(inYard, nth(inYard, 'Test Bear')).power).toBe('3');
    const onField = board([gy, BEAR], ['Test Bear', 'Test Graveyard Lord']);
    expect(getChars(onField, nth(onField, 'Test Bear')).power).toBe('2');
  });

  it('the answer is the same with the shortcut as without: a layer-free board equals its own full computation, object by object', () => {
    const s: GameState = scenario(['Grizzly Bears', 'Serra Angel', 'Hill Giant', 'Forest'], { p1: { battlefield: ['Grizzly Bears', 'Serra Angel', 'Forest'], hand: ['Hill Giant'] }, p2: { battlefield: ['Hill Giant'] } });
    expect(layerSourcesPresent(s)).toBe(false);
    for (const id of Object.keys(s.objects)) expect(JSON.stringify(getChars(s, id)), id).toBe(JSON.stringify(computeAll(s).get(id)));
  });
});

describe('stress: many effects in one layer', () => {
  it('thirty creatures and twelve effects whose sets depend on one another: it finishes (the quadratic dependency loop is bounded) and is deterministic', () => {
    const rises = Array.from({ length: 12 }, (_, i) => enchantment(`Test Rise ${i}`, '{1}', [staticOf('Creatures with power N or more get +1/+0.', [continuous(each({ types: ['Creature'], power: { op: '>=', value: i } }), [{ layer: '7c', power: 1, toughness: 0 }])])]));
    const bears = Array.from({ length: 30 }, (_, i) => creature(`Test Body ${i}`, String(i % 6), '3'));
    const s = board([...rises, ...bears], [...rises.map((r) => r.name), ...bears.map((b) => b.name)]);
    const t0 = Date.now();
    const all = computeAll(s);
    expect(Date.now() - t0).toBeLessThan(5000);
    // Every creature ends with a number, the result does not depend on iteration order (two computations agree), and getChars is the same as computeAll.
    for (const b of bears) expect(/^[0-9]+$/.test(all.get(nth(s, b.name))!.power ?? '')).toBe(true);
    expect(JSON.stringify([...computeAll(s)])).toBe(JSON.stringify([...all]));
    expect(JSON.stringify(getChars(s, nth(s, 'Test Body 5')))).toBe(JSON.stringify(all.get(nth(s, 'Test Body 5'))));
  });
});

