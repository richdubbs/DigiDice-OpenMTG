/**
 * keywords/expand.ts (design 7.2): the placeholder language is tiny, pure, and refuses anything else. Plus the registry's expand: only `implemented`
 * keywords act through their data, so a native keyword (flashback) never acts twice and a planned one acts on nothing.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, KeywordAbilityDef } from '../../../src/index';
import { KeywordExpandError, expandKeyword } from '../../../src/keywords/expand';
import { createKeywordRegistry, KeywordRegistryError, keywordRegistry } from '../../../src/keywords/registry';
import type { ExpandContext, KeywordDefData } from '../../../src/keywords/types';
import { parseManaCost } from '../../../src/types/mana';
import { SAMPLES } from './samples';

const ctx: ExpandContext = { granted: false, faceName: 'Test', types: ['Creature'], keyPrefix: 'k:0:0' };
const cost = (m: string) => ({ mana: parseManaCost(m)! });
const kw = (keyword: string, rest: Partial<KeywordAbilityDef> = {}): KeywordAbilityDef => ({ kind: 'keyword', text: keyword, keyword, ...rest });

const data = (expand: unknown[], params: KeywordDefData['params'] = []): KeywordDefData => ({
  name: 'test', rule: '702.1', params, mechanisms: ['expands'], reminder: '', multiple: 'independent', status: 'implemented', expand,
});

describe('design 7.2: the placeholder language', () => {
  it('a whole string value "$cost", "$amount", "$quality", "$filter" is replaced by that parameter of the instance', () => {
    const d = data([{ kind: 'static', text: 'T', a: '$cost', b: '$amount', c: '$quality', d: '$filter' }], [
      { name: 'cost', type: 'cost' }, { name: 'amount', type: 'number' }, { name: 'quality', type: 'quality' }, { name: 'filter', type: 'filter' },
    ]);
    const [a] = expandKeyword(d, kw('test', { cost: cost('{1}{W}'), amount: 3, quality: 'color:R', filter: { types: ['Artifact'] } }), ctx) as unknown as Record<string, unknown>[];
    expect(a).toMatchObject({ a: cost('{1}{W}'), b: 3, c: 'color:R', d: { types: ['Artifact'] } });
  });

  it('{"$costAdd": {base, other}} appends cost parts to the base cost and keeps the rest of the base (Cycling)', () => {
    const d = data([{ kind: 'activated', text: 'T', cost: { $costAdd: { base: '$cost', other: [{ kind: 'discard', self: true, count: 1 }] } } }], [{ name: 'cost', type: 'cost' }]);
    const base = { mana: parseManaCost('{2}')!, tap: true, other: [{ kind: 'payLife' as const, amount: 1 }] };
    const [a] = expandKeyword(d, kw('test', { cost: base }), ctx) as unknown as { cost: unknown }[];
    expect(a!.cost).toEqual({ mana: parseManaCost('{2}'), tap: true, other: [{ kind: 'payLife', amount: 1 }, { kind: 'discard', self: true, count: 1 }] });
  });

  it('{"$ifParam": name, then, else} picks the branch by whether the instance has the parameter (Equip with and without a restriction)', () => {
    const d = data([{ kind: 'static', text: 'T', f: { $ifParam: 'filter', then: '$filter', else: { controller: 'you' } } }], [{ name: 'filter', type: 'filter', optional: true }]);
    expect((expandKeyword(d, kw('test', { filter: { types: ['Land'] } }), ctx)[0] as unknown as { f: unknown }).f).toEqual({ types: ['Land'] });
    expect((expandKeyword(d, kw('test'), ctx)[0] as unknown as { f: unknown }).f).toEqual({ controller: 'you' });
  });

  it('an $ifParam without an else and without the parameter leaves the key out', () => {
    const d = data([{ kind: 'static', text: 'T', f: { $ifParam: 'amount', then: '$amount' }, g: 1 }], [{ name: 'amount', type: 'number', optional: true }]);
    expect(expandKeyword(d, kw('test'), ctx)[0]).not.toHaveProperty('f');
    expect(expandKeyword(d, kw('test', { amount: 2 }), ctx)[0]).toMatchObject({ f: 2, g: 1 });
  });

  it('refuses everything else that starts with "$": an unknown placeholder, an unknown key, a missing parameter (never a silent wrong ability)', () => {
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', x: '$mana' }]), kw('test'), ctx)).toThrow(KeywordExpandError);
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', $x: 1 }]), kw('test'), ctx)).toThrow(/unknown key/);
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', x: '$cost' }], [{ name: 'cost', type: 'cost' }]), kw('test'), ctx)).toThrow(/no cost parameter/);
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', x: { $ifParam: 'colour' } }]), kw('test'), ctx)).toThrow(/names no parameter/);
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', x: { $costAdd: { base: 3 }, y: 1 } }]), kw('test'), ctx)).toThrow(/only key/);
  });

  it('{"$ordinal": name} is the name for the first instance and name:n for the nth (the two kicker costs of one card); anything else in that object is an error', () => {
    const d = data([{ kind: 'static', text: 'T', name: { $ordinal: 'kicker' } }]);
    const name = (ordinal?: number) => (expandKeyword(d, kw('test'), { ...ctx, ...(ordinal !== undefined ? { ordinal } : {}) })[0] as unknown as { name: string }).name;
    expect([name(), name(1), name(2), name(3)]).toEqual(['kicker', 'kicker', 'kicker:2', 'kicker:3']);
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', name: { $ordinal: 'kicker', x: 1 } }]), kw('test'), ctx)).toThrow(/only key/);
    expect(() => expandKeyword(data([{ kind: 'static', text: 'T', name: { $ordinal: 3 } }]), kw('test'), ctx)).toThrow(/name a string/);
  });

  it('is pure: the data and the instance are not changed, and the result shares nothing with either (a later change to the result cannot reach the data)', () => {
    const d = data([{ kind: 'activated', text: 'T', cost: '$cost', effect: { targets: [], steps: [] } }], [{ name: 'cost', type: 'cost' }]);
    const instance = kw('test', { cost: { mana: parseManaCost('{G}')!, other: [{ kind: 'payLife', amount: 1 }] } });
    const beforeData = JSON.stringify(d);
    const beforeKw = JSON.stringify(instance);
    const [a] = expandKeyword(d, instance, ctx) as unknown as { cost: { other: { amount: number }[] }; effect: { steps: unknown[] } }[];
    a!.cost.other[0]!.amount = 99;
    a!.effect.steps.push('x');
    expect(JSON.stringify(d)).toBe(beforeData);
    expect(JSON.stringify(instance)).toBe(beforeKw);
    expect(expandKeyword(d, instance, ctx)).toEqual(expandKeyword(d, instance, ctx)); // deterministic
  });
});

describe('generated abilities: text, provenance and source lines', () => {
  it('the text fills {cost}, {n} and {quality} from the instance (mana-only costs print as symbols)', () => {
    const [kicker] = keywordRegistry.expand(SAMPLES['kicker {2}{G}']!, ctx);
    expect(kicker!.text).toBe('Kicker {2}{G}');
    const [bushido] = keywordRegistry.expand(SAMPLES['bushido 1']!, ctx);
    expect(bushido!.text).toBe('Whenever ~ blocks or becomes blocked, it gets +1/+1 until end of turn.');
    const [crew] = keywordRegistry.expand(SAMPLES['crew 2']!, ctx);
    expect(crew!.text).toBe('Crew 2');
  });

  it('a cost that is not only mana prints as the keyword line of the card', () => {
    const [cycling] = keywordRegistry.expand(SAMPLES['cycling -- pay 2 life']!, ctx);
    expect(cycling!.text).toBe('Cycling—Pay 2 life'); // the keyword line as printed
  });

  it('every generated ability says where it came from: provenance {by: keyword, id: name}, reviewed (the engine recognizes cycling and crew abilities by it)', () => {
    for (const [label, instance] of Object.entries(SAMPLES)) {
      for (const a of keywordRegistry.expand(instance, ctx)) {
        const def = keywordRegistry.get(instance.keyword)!;
        expect(a.prov, label).toEqual({ by: 'keyword', id: def.family ?? def.name, reviewed: true });
      }
    }
  });

  it('a printed keyword passes its source lines on; a granted keyword (CR 613.1f) has none', () => {
    const printed: KeywordAbilityDef = { ...SAMPLES['ward {2}']!, src: [3] };
    expect(keywordRegistry.expand(printed, ctx)[0]!.src).toEqual([3]);
    expect(keywordRegistry.expand(printed, { ...ctx, granted: true })[0]).not.toHaveProperty('src');
    expect(printed.src).toEqual([3]);
  });
});

describe('the registry decides what a keyword may do (design 7.1)', () => {
  const abilityKinds = (label: string): string[] => keywordRegistry.expand(SAMPLES[label]!, ctx).map((a: AbilityDef) => a.kind);

  it('an implemented keyword with an expansion expands; a flag or hook keyword expands into nothing (it is read through the characteristics)', () => {
    expect(abilityKinds('ward {2}')).toEqual(['triggered']);
    expect(abilityKinds('buyback {3}')).toEqual(['static', 'static']);
    expect(abilityKinds('evoke {R}')).toEqual(['static', 'triggered']);
    expect(keywordRegistry.expand(kw('flying'), ctx)).toEqual([]);
    expect(keywordRegistry.expand(kw('convoke'), ctx)).toEqual([]);
    expect(keywordRegistry.expand(kw('partner'), ctx)).toEqual([]);
  });

  it('a native keyword (flashback) expands into NOTHING: the engine acts on it already, so the data form would make it act twice; the data is the spec', () => {
    expect(keywordRegistry.get('flashback')!.status).toBe('native');
    expect(keywordRegistry.expand(SAMPLES['flashback {1}{R}']!, ctx)).toEqual([]);
    expect(keywordRegistry.get('flashback')!.expand).toHaveLength(2);
  });

  it('a planned keyword expands into nothing (the engine cannot act on it, so it stays a manual node with requiresEngine)', () => {
    expect(keywordRegistry.expand(kw('morph', { cost: cost('{3}{U}') }), ctx)).toEqual([]);
    expect(keywordRegistry.expand(kw('banding'), ctx)).toEqual([]); // CMD3: was echo, implemented since (CR 702.30a)
  });

  it('a wrapper keyword (exhaust) generates no ability of its own and says what it changes in the ability that follows (CR 702.177a)', () => {
    expect(keywordRegistry.expand(kw('exhaust'), ctx)).toEqual([]);
    expect(keywordRegistry.get('exhaust')!.modifies).toEqual({ kind: 'activated', limit: { per: 'game', max: 1 } });
  });

  it('an unknown keyword is an error, not an empty expansion (design 7.1.5: it must stay a manual node)', () => {
    expect(() => keywordRegistry.expand(kw('blorp'), ctx)).toThrow(KeywordRegistryError);
  });

  it('a keyword instance without the parameter its expansion needs is an error, not a half ability', () => {
    expect(() => keywordRegistry.expand(kw('kicker'), ctx)).toThrow(KeywordExpandError);
  });

  it('a registry built from fake data expands by the same rules', () => {
    const fake = createKeywordRegistry([{ ...data([{ kind: 'static', text: 'Zap {cost}', zone: ['stack'], effects: [] }], [{ name: 'cost', type: 'cost' }]), name: 'zap' }]);
    expect(fake.expand(kw('zap', { cost: cost('{2}') }), ctx)[0]).toMatchObject({ kind: 'static', text: 'Zap {2}' });
  });
});
