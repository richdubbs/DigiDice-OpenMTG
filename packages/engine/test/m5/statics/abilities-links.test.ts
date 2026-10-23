/**
 * The abilities of an object with stable keys (p:, k:, g:, r:), keyword expansion through the registry (a fake one until WP3), and the link store of
 * CR 607 (`setLink`, `readLink`, `grantNamespace`) with the layers that read it ("the chosen creature type", "the chosen color").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activatedAbilities, cloneState, findAbility, getChars, hasKeyword, keywordRegistry, legalActions, type AbilityDef, type KeywordDef } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { moveObject } from '../../../src/core/zones';
import { grantNamespace, readLink, setLink, clearLink } from '../../../src/statics/links';
import { activated, scenario, spellAbility } from '../helpers';
import { board, continuous, creature, each, enchantment, find, fixedOn, nth, SELF, staticOf, tweak, withEffect } from './fixtures';

const FLYING: AbilityDef = { kind: 'keyword', text: 'Flying', keyword: 'flying' };
const WARD: AbilityDef = { kind: 'keyword', text: 'Ward {2}', keyword: 'ward' };
const WARD_TRIGGER: AbilityDef = { kind: 'triggered', text: 'Whenever this becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.', trigger: { on: [] } as never, effect: { targets: [], steps: [] } };

/** A registry that knows the keywords in `table`: each expands into the listed abilities. */
function fakeRegistry(table: Record<string, AbilityDef[]>): void {
  vi.spyOn(keywordRegistry, 'get').mockImplementation((name) => (name in table ? ({ name } as unknown as KeywordDef) : undefined));
  vi.spyOn(keywordRegistry, 'expand').mockImplementation((kw) => table[kw.keyword] ?? []);
}

afterEach(() => vi.restoreAllMocks());

describe('ability keys (design 9.2)', () => {
  it('printed abilities are p:<face>:<index>, in printed order', () => {
    const s = board([creature('Test Flyer', '2', '2', [FLYING, activated('{T}: Test.', { tap: true })])], ['Test Flyer']);
    expect(getChars(s, nth(s, 'Test Flyer')).abilities.map((a) => [a.key, a.origin, a.face, a.index])).toEqual([['p:0:0', 'printed', 0, 0], ['p:0:1', 'printed', 0, 1]]);
  });

  it('split cards combine both faces outside the stack: each ability keeps its own face number in the key (CR 709.4)', () => {
    const s = scenario(['Fire // Ice'], { p1: { hand: ['Fire // Ice'] } });
    const keys = getChars(s, find(s, 'Fire // Ice', 'hand')).abilities.map((a) => a.key);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.some((k) => k.startsWith('p:0:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('p:1:'))).toBe(true);
  });

  it('what the keyword library generates is k:<face>:<index>:<n>, listed after the printed abilities; the keyword itself stays p:', () => {
    fakeRegistry({ ward: [WARD_TRIGGER] });
    const s = board([creature('Test Warded', '2', '2', [WARD, FLYING])], ['Test Warded']);
    const c = getChars(s, nth(s, 'Test Warded'));
    expect(c.abilities.map((a) => [a.key, a.origin])).toEqual([['p:0:0', 'printed'], ['p:0:1', 'printed'], ['k:0:0:0', 'keyword']]);
    expect(c.keywords.map((k) => k.keyword)).toEqual(['ward', 'flying']); // the generated trigger is not a keyword ability
    expect(findAbility(s, nth(s, 'Test Warded'), 'k:0:0:0')?.def.kind).toBe('triggered');
  });

  it('the expansion is asked with the keyword instance and its context (face name, types, key prefix)', () => {
    fakeRegistry({ ward: [WARD_TRIGGER] });
    const s = board([creature('Test Warded', '2', '2', [WARD])], ['Test Warded']);
    getChars(s, nth(s, 'Test Warded'));
    const call = vi.mocked(keywordRegistry.expand).mock.calls.find(([, ctx]) => ctx.faceName !== '')!; // (the first call is the probe that decides whether the board needs the layers at all)
    expect(call[0]).toMatchObject({ keyword: 'ward' });
    expect(call[1]).toEqual({ granted: false, faceName: 'Test Warded', types: ['Creature'], keyPrefix: 'k:0:0' });
  });

  it('removing a keyword removes what it generated (the expansion points at its parent)', () => {
    fakeRegistry({ ward: [WARD_TRIGGER] });
    let s = board([creature('Test Warded', '2', '2', [WARD])], ['Test Warded']);
    const id = nth(s, 'Test Warded');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, remove: ['ward'] }]));
    expect(getChars(s, id).abilities).toEqual([]);
  });

  it('a granted keyword is expanded on the fly: g:<effect id>:<n> and g:<effect id>:<n>:<j> (CR 613.1f)', () => {
    fakeRegistry({ ward: [WARD_TRIGGER] });
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [WARD] }]));
    const eff = s.continuousEffects[0]!.id;
    const c = getChars(s, id);
    expect(c.abilities.map((a) => a.key)).toEqual([`g:${eff}:0`, `g:${eff}:0:0`]);
    expect(vi.mocked(keywordRegistry.expand).mock.calls.some(([, ctx]) => ctx.granted && ctx.keyPrefix === `g:${eff}:0`)).toBe(true);
    expect(hasKeyword(c, 'ward')).toBe(true);
  });

  it('a keyword that expands into a static ability makes its object a source of effects (the changeling pattern): the board is layered because of it', () => {
    fakeRegistry({ changeling: [staticOf('This creature is every creature type.', [continuous(SELF, [{ layer: 4, subtypes: { all: true } }], true)])] });
    const s = board([creature('Test Shifter', '1', '1', [{ kind: 'keyword', text: 'Changeling', keyword: 'changeling' }], { type: 'Creature — Shapeshifter' })], ['Test Shifter']);
    expect(getChars(s, nth(s, 'Test Shifter')).subtypes).toContain('Goblin');
  });

  it('the intrinsic mana ability of a basic land type is r:basic:<C>; two basic types give two (CR 305.6)', () => {
    const s = board([], [], []);
    const plains = find(s, 'Plains', 'library');
    expect(getChars(s, plains).abilities.map((a) => [a.key, a.origin])).toEqual([['r:basic:W', 'rule']]);
    const t = tweak(s, (x) => { x.objects[plains]!.zone = 'battlefield'; x.zones.library['p1'] = x.zones.library['p1']!.filter((i) => i !== plains); x.zones.battlefield.push(plains); });
    const t2 = withEffect(t, continuous(fixedOn(t, plains), [{ layer: 4, subtypes: { add: ['Island'] } }]));
    expect(getChars(t2, plains).abilities.map((a) => a.key)).toEqual(['r:basic:W', 'r:basic:U']);
  });

  it('keys do not depend on the other abilities: removing one leaves the others\' keys alone', () => {
    let s = board([creature('Test Flyer', '2', '2', [FLYING, { kind: 'keyword', text: 'Haste', keyword: 'haste' }, { kind: 'keyword', text: 'Reach', keyword: 'reach' }])], ['Test Flyer']);
    const id = nth(s, 'Test Flyer');
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, remove: ['haste'] }]));
    expect(getChars(s, id).abilities.map((a) => a.key)).toEqual(['p:0:0', 'p:0:2']);
  });

  it('a granted activated ability can be found by its key and appears among the legal actions (the rest of the engine sees the layers)', () => {
    let s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    const mana = activated('{T}: Add {G}.', { tap: true }) as AbilityDef;
    expect(activatedAbilities(s, s.objects[id]!)).toEqual([]);
    s = withEffect(s, continuous(fixedOn(s, id), [{ layer: 6, add: [mana] }]));
    const key = `g:${s.continuousEffects[0]!.id}:0`;
    expect(activatedAbilities(s, s.objects[id]!).map((a) => a.key)).toEqual([key]);
    expect(findAbility(s, id, key)?.origin).toBe('granted');
    expect(legalActions(s, 'p1').some((a) => a.action.type === 'activate' && a.action.source === id && a.action.ability === key)).toBe(true);
  });

  it('a spell on the stack keeps its printed spell ability key; an Aura-like keyword line does not disturb the numbering', () => {
    const s = board([creature('Test Spelly', '2', '2', [spellAbility('Test.'), FLYING])], ['Test Spelly']);
    expect(getChars(s, nth(s, 'Test Spelly')).abilities.map((a) => a.key)).toEqual(['p:0:0', 'p:0:1']);
  });
});

describe('links (CR 607): setLink, readLink, grantNamespace', () => {
  it('a link is stored on the object instance and read back; reading a missing link is undefined and creates nothing', () => {
    const s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const o = tweak(s, () => undefined).objects[nth(s, 'Test Bear')]!;
    expect(readLink(o, 'exiled')).toBeUndefined();
    expect(o.links).toBeUndefined();
    setLink(o, 'exiled', { objects: [{ id: 'o9', zone: 'exile' }], values: ['red'] });
    expect(readLink(o, 'exiled')).toEqual({ objects: [{ id: 'o9', zone: 'exile' }], values: ['red'] });
    expect(readLink(o, 'other')).toBeUndefined();
  });

  it('setLink replaces the earlier value under that id and copies its argument (no aliasing, design 4.3)', () => {
    const s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const o = tweak(s, () => undefined).objects[nth(s, 'Test Bear')]!;
    const handles = [{ id: 'o9', zone: 'exile' as const }];
    setLink(o, 'exiled', { objects: handles });
    handles.push({ id: 'o10', zone: 'exile' });
    expect(readLink(o, 'exiled')!.objects).toEqual([{ id: 'o9', zone: 'exile' }]);
    setLink(o, 'exiled', { players: ['p2'] });
    expect(readLink(o, 'exiled')).toEqual({ players: ['p2'] });
    clearLink(o, 'exiled');
    expect(readLink(o, 'exiled')).toBeUndefined();
  });

  it('link ids are plain names: "constructor" and "__proto__" are ordinary links', () => {
    const s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const o = tweak(s, () => undefined).objects[nth(s, 'Test Bear')]!;
    expect(readLink(o, 'constructor')).toBeUndefined();
    expect(readLink(o, '__proto__')).toBeUndefined();
    setLink(o, '__proto__', { values: ['x'] });
    setLink(o, 'constructor', { values: ['y'] });
    expect(readLink(o, '__proto__')).toEqual({ values: ['x'] });
    expect(readLink(o, 'constructor')).toEqual({ values: ['y'] });
    expect(Object.getPrototypeOf(o.links)).toBe(Object.prototype);
  });

  it('a link store survives cloneState without aliasing and is fresh after a zone change (CR 400.7), while last known information keeps it', () => {
    const s = board([creature('Test Bear', '2', '2')], ['Test Bear']);
    const id = nth(s, 'Test Bear');
    const t = tweak(s, (x) => { setLink(x.objects[id]!, 'chosen', { values: ['Elf'] }); });
    const c = cloneState(t);
    expect(readLink(c.objects[id], 'chosen')).toEqual({ values: ['Elf'] });
    expect(c.objects[id]!.links).not.toBe(t.objects[id]!.links);
    const g = new Game(c);
    const newId = moveObject(g, id, 'graveyard', { cause: 'test' })!;
    expect(g.s.objects[newId]!.links).toBeUndefined();
    expect(readLink(g.s.lki[id]!.object, 'chosen')).toEqual({ values: ['Elf'] });
  });

  it('grantNamespace: one namespace per granting effect and link, so two grants of a linked pair do not read each other (CR 607.2h, 613.6)', () => {
    expect(grantNamespace('e1', 'exiled')).toBe(grantNamespace('e1', 'exiled'));
    expect(grantNamespace('e1', 'exiled')).not.toBe(grantNamespace('e2', 'exiled'));
    expect(grantNamespace('e1', 'exiled')).not.toBe(grantNamespace('e1', 'chosen'));
    expect(grantNamespace('e1', 'exiled')).not.toBe('exiled');
  });

  it('"the chosen creature type": a filter and a type change read the link of the source (CR 607.2d)', () => {
    const lordDef = creature('Test Tribal Lord', '1', '1', [
      staticOf('Creatures you control of the chosen type get +1/+1.', [continuous(each({ types: ['Creature'], controller: 'you', chosen: { link: 'type', quality: 'creatureType' } }), [{ layer: '7c', power: 1, toughness: 1 }])]),
    ]);
    let s = board([lordDef, creature('Test Elf', '1', '1', [], { type: 'Creature — Elf' }), creature('Test Goblin', '1', '1', [], { type: 'Creature — Goblin' })], ['Test Tribal Lord', 'Test Elf', 'Test Goblin']);
    const [lord, elf, goblin] = [nth(s, 'Test Tribal Lord'), nth(s, 'Test Elf'), nth(s, 'Test Goblin')];
    expect([getChars(s, elf).power, getChars(s, goblin).power]).toEqual(['1', '1']); // nothing chosen yet
    s = tweak(s, (t) => { setLink(t.objects[lord]!, 'type', { values: ['Elf'] }); });
    expect([getChars(s, elf).power, getChars(s, goblin).power]).toEqual(['2', '1']);
    // a type change that adds the chosen type to the lord itself
    const adder = creature('Test Adaptive', '1', '1', [staticOf('Test Adaptive is the chosen type in addition.', [continuous(SELF, [{ layer: 4, subtypes: { chosen: 'type' } }])])]);
    let t = board([adder], ['Test Adaptive']);
    const a = nth(t, 'Test Adaptive');
    t = tweak(t, (x) => { setLink(x.objects[a]!, 'type', { values: ['Merfolk'] }); });
    expect(getChars(t, a).subtypes).toEqual(['Bear', 'Merfolk']);
  });

  it('"the color of your choice": a chosen color accepts the symbol or the word', () => {
    for (const word of ['R', 'red', 'Red']) {
      let s = board([creature('Test Chooser', '1', '1'), creature('Test Bear', '2', '2')], ['Test Chooser', 'Test Bear']);
      const [ch, b] = [nth(s, 'Test Chooser'), nth(s, 'Test Bear')];
      s = tweak(s, (t) => { setLink(t.objects[ch]!, 'color', { values: [word] }); });
      s = withEffect(s, continuous(fixedOn(s, b), [{ layer: 5, colors: { chosen: 'color' } }]), { source: ch });
      expect(getChars(s, b).colors, word).toEqual(['R']);
    }
  });

  it('enchantments with a layer 4 effect built from the source\'s own link, in one more shape: a condition on a chosen value', () => {
    const e = enchantment('Test Chooser Ench', '{1}', [staticOf('As long as red was chosen, creatures get +1/+0.', [continuous(each({ types: ['Creature'] }), [{ layer: '7c', power: 1, toughness: 0 }])], { condition: { cond: 'chosen', link: 'color', equals: 'red' } })]);
    let s = board([e, creature('Test Bear', '2', '2')], ['Test Chooser Ench', 'Test Bear']);
    const [en, b] = [nth(s, 'Test Chooser Ench'), nth(s, 'Test Bear')];
    expect(getChars(s, b).power).toBe('2');
    s = tweak(s, (t) => { setLink(t.objects[en]!, 'color', { values: ['red'] }); });
    expect(getChars(s, b).power).toBe('3');
  });
});
