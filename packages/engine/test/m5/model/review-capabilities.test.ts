/**
 * Review round on model/cap-walk.ts: value forms of nodes whose forms the design splits between M5 and M6 (8.5, 14), shields versus static
 * prevention (8.5, 9.7), restriction modes, dependency in every layer (CR 613.8a), and the structural kinds that had no capability source.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, classifyCard, type FaceLines } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const NO_LINES: FaceLines = { lines: [], sentences: [] };
const spell = (steps: J[], targets: J[] = []): AbilityDef => ab({ kind: 'spell', text: 'x', effect: { targets, steps } });
const stat = (effects: J[]): AbilityDef => ab({ kind: 'static', text: 'x', effects });
const caps = (def: AbilityDef): string[] => capabilitiesOf(def);
const example = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces.flatMap((f) => f.abilities);
const rep = (replaces: J, body: J, extra: J = {}): AbilityDef => stat([{ s: 'replace', replaces, body, ...extra }]);
const self = { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' };

describe('CR 614.12, 616.1c, 707.9: enters bodies the M5 build does not run are capabilities of their own (design 8.5, 14)', () => {
  it('a copy as it enters needs body:enters.copy and layer 1a, so Clone is not full on an M5 set', () => {
    const clone = example('Clone');
    expect(clone.flatMap(caps)).toEqual(expect.arrayContaining(['body:enters.copy', 'body:enters', 'layer:1a']));
    const m5 = new Set(['static:replace', 'ev:zoneChange', 'filter:self', 'filter:types', 'body:enters', 'feature:replace.self']);
    const r = classifyCard({ faces: [{ abilities: clone, lines: NO_LINES }], source: 'pack' }, m5);
    expect(r.level).not.toBe('full');
    expect(r.requiresEngine).toEqual(expect.arrayContaining(['body:enters.copy']));
  });
  it('CR 708.2: enters face down is layer 1b; CR 712: enters transformed; CR 614.12: under another player, attached to an object', () => {
    expect(caps(rep(self, { b: 'enters', faceDown: true }))).toEqual(expect.arrayContaining(['body:enters.faceDown', 'layer:1b']));
    expect(caps(rep(self, { b: 'enters', transformed: true }))).toContain('body:enters.transformed');
    expect(caps(rep(self, { b: 'enters', under: { ref: 'you' } }))).toContain('body:enters.under');
    expect(caps(rep(self, { b: 'enters', attachTo: { ref: 'self' } }))).toContain('body:enters.attachTo');
  });
  it('the forms the M5 build runs add nothing beyond body:enters (tapped, counters, a choice)', () => {
    const c = caps(rep(self, { b: 'enters', tapped: true, counters: [{ kind: 'charge', count: 1 }], choose: [{ what: 'color', link: 'c' }] }));
    expect(c.filter((x) => x.startsWith('body:'))).toEqual(['body:enters']);
  });
  it('CR 614.1: a modify body names the parameter it changes (amount, count, destination, recipient)', () => {
    const m = (body: J): string[] => caps(rep({ ev: 'counters', change: 'put' }, { b: 'modify', ...body }));
    expect(m({ amount: { mul: 2 } })).toEqual(expect.arrayContaining(['body:modify', 'body:modify.amount']));
    expect(m({ count: { mul: 2 } })).toContain('body:modify.count');
    expect(m({ destination: { zone: 'exile' } })).toContain('body:modify.destination');
    expect(m({ to: { ref: 'you' } })).toContain('body:modify.to');
  });
});

describe('design 14: steps whose forms are M6 (face-down, convert, flip, copy exceptions, day and night)', () => {
  const step = (s: J): string[] => caps(spell([s]));
  const what = { ref: 'self' };
  it('CR 701.27: transform stays plain op:changeFace; CR 708 / 701.28 / 710 forms are separate capabilities', () => {
    expect(step({ op: 'changeFace', what, to: 'transform' })).toEqual(['op:changeFace', 'ref:self']);
    expect(step({ op: 'changeFace', what, to: 'faceDown' })).toContain('op:changeFace.faceDown');
    expect(step({ op: 'changeFace', what, to: 'faceUp' })).toContain('op:changeFace.faceUp');
    expect(step({ op: 'changeFace', what, to: 'convert' })).toContain('op:changeFace.convert');
    expect(step({ op: 'changeFace', what, to: 'flip' })).toContain('op:changeFace.flip');
    expect(step({ op: 'changeFace', what, to: 'faceDown', manifest: true })).toEqual(expect.arrayContaining(['op:changeFace.faceDown', 'op:changeFace.manifest']));
  });
  it('CR 707.9: a copy with exceptions is not the plain copy M5 runs', () => {
    const copy = { op: 'copy', what, result: 'token', who: { ref: 'you' } };
    expect(step(copy)).not.toContain('op:copy.except');
    expect(step({ ...copy, except: [{ layer: 4, types: { add: ['Artifact'] } }] })).toEqual(expect.arrayContaining(['op:copy.except', 'layer:4']));
  });
  it('CR 731: day and night designations are M6; the monarch is not (the initiative: op:designate.initiative, MX4)', () => {
    expect(step({ op: 'designate', who: { ref: 'you' }, what: 'day' })).toContain('op:designate.day');
    expect(step({ op: 'designate', who: { ref: 'you' }, what: 'night' })).toContain('op:designate.night');
    expect(step({ op: 'designate', who: { ref: 'you' }, what: 'monarch' })).toEqual(['op:designate', 'ref:you']);
  });
});

describe('CR 614.8, 615.3, 615.7: only a resolved shield is exempt from feature:replace.*; a static prevention is a foreign replacement (design 8.5, 14)', () => {
  const dmg = { ev: 'damage', recipient: { player: { ref: 'you' } } };
  it('a static prevent (no shield) about another object needs feature:replace.foreign', () => {
    expect(caps(rep(dmg, { b: 'prevent', amount: 'all' }))).toContain('feature:replace.foreign');
  });
  it('a static prevent about the object itself needs feature:replace.self', () => {
    expect(caps(rep({ ev: 'damage', recipient: { object: { self: true } } }, { b: 'prevent', amount: 'all' }))).toContain('feature:replace.self');
  });
  it('a shield (a resolved effect) needs neither, for prevent and regeneration', () => {
    expect(caps(rep(dmg, { b: 'prevent', amount: 'all' }, { shield: { uses: 1 } }))).not.toEqual(expect.arrayContaining(['feature:replace.foreign']));
    expect(caps(rep({ ev: 'destroy' }, { b: 'regeneration' }, { shield: { uses: 1 } })).filter((c) => c.startsWith('feature:'))).toEqual([]);
  });
});

describe('CR 508.1c, 508.1d, 509.1b: a restriction names its mode and its extra fields, so a hook declares exactly what it enforces', () => {
  const restrict = (extra: J): string[] => caps(stat([{ s: 'restrict', subject: { ref: 'self' }, action: 'attack', ...extra }]));
  it('restrict:<mode> for cant, mustIfAble and onlyIf', () => {
    expect(restrict({ mode: 'cant' })).toEqual(expect.arrayContaining(['rule:attack', 'restrict:cant']));
    expect(restrict({ mode: 'mustIfAble' })).toEqual(expect.arrayContaining(['rule:attack', 'restrict:mustIfAble']));
    expect(restrict({ mode: 'onlyIf', when: { cond: 'turnOf', whose: { ref: 'you' } } })).toEqual(expect.arrayContaining(['restrict:onlyIf']));
    expect(restrict({ mode: 'cant' })).not.toContain('restrict:mustIfAble');
  });
  it('a limit (max), a counterpart filter (other) and a condition (when) are features of the restriction', () => {
    // r5-static: a limit on attacks is a whole-declaration limit with a form of its own (statics/hooks.ts#declarationLimits, CR 508.1c); a limit with a filter is not
    expect(restrict({ mode: 'cant', max: 1 })).toContain('feature:restrict.max.attack');
    expect(restrict({ mode: 'mustIfAble', max: 1 })).toContain('feature:restrict.max');
    // WP31 review: `other` is a feature per action (statics/hooks.ts#OTHER_ACTIONS: only where the call-site names the other object)
    expect(restrict({ mode: 'cant', other: { power: { op: '<=', value: 2 } } })).toContain('feature:restrict.other.attack');
    expect(restrict({ mode: 'cant', other: { power: { op: '<=', value: 2 } } })).not.toContain('feature:restrict.other');
    expect(restrict({ mode: 'cant', when: { cond: 'turnOf', whose: { ref: 'you' } } })).toContain('feature:restrict.when');
    expect(restrict({ mode: 'cant' }).filter((c) => c.startsWith('feature:'))).toEqual([]);
  });
});

describe('CR 613.8a: dependency applies within every layer and sublayer, 7a to 7d included (design 9.3)', () => {
  const c = (layer: unknown, payload: J): AbilityDef => stat([{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer, ...payload }] }]);
  it('a power/toughness modification needs feature:dependency like any other layer', () => {
    expect(caps(c('7c', { power: 1 }))).toContain('feature:dependency');
    expect(caps(c('7b', { power: 1, toughness: 1 }))).toContain('feature:dependency');
    expect(caps(c('7d', { switchPT: true }))).toContain('feature:dependency');
  });
});

describe('structural kinds with no table (design 5.2): the walker names a feature a table can register', () => {
  it('a Saga chapter needs the counters event it expands to and feature:chapter; no `ability:` name is emitted', () => {
    const c = caps(ab({ kind: 'chapter', text: 'x', chapters: [1], effect: { targets: [], steps: [] } }));
    expect(c).toEqual(['ev:counters', 'feature:chapter']);
  });
  it('a Class level and a Leveler bracket are features, with the abilities they hold counted as nested', () => {
    expect(caps(ab({ kind: 'classLevel', text: 'x', level: 2, cost: { mana: [{ kind: 'generic', amount: 1 }] }, abilities: [] }))).toContain('feature:class.level');
    expect(caps(ab({ kind: 'levelBracket', text: 'x', min: 1, max: 4, abilities: [] }))).toContain('feature:leveler.bracket');
  });
  it('every name any example needs is in a known prefix family (no `ability:`)', () => {
    const all = new Set(EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.flatMap(caps))));
    expect([...all].filter((n) => n.startsWith('ability:'))).toEqual([]);
  });
});
