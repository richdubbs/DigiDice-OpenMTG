/**
 * The capability walker (design 5.2): the capabilities an ability needs, from the discriminators of its JSON, the value forms of model/forms.ts and the
 * feature constants. The engine's own set is built by WP0's builder from the engine's tables; here a fake set stands in for it.
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, capabilityUses, ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const example = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces.flatMap((f) => f.abilities);
const capsOfExample = (name: string): string[] => [...new Set(example(name).flatMap((a) => capabilitiesOf(a)))].sort();
const spell = (steps: J[], targets: J[] = [], extra: J = {}): AbilityDef => ab({ kind: 'spell', text: 'x', effect: { targets, steps, ...extra } });
const caps = (def: AbilityDef): string[] => capabilitiesOf(def);

describe('capabilitiesOf names what an ability needs', () => {
  it('Lightning Bolt: one op, the references, the target kind', () => {
    expect(capsOfExample('Lightning Bolt')).toEqual(['op:damage', 'ref:self', 'ref:target', 'target:anyTarget']);
  });
  it('Mana Leak: the pay op and the references of "its controller"', () => {
    expect(capsOfExample('Mana Leak')).toEqual(['op:counter', 'op:pay', 'ref:controllerOf', 'ref:target', 'target:spell']);
  });
  it('Serra Angel: a keyword is a capability (the engine has it only if the registry says implemented)', () => {
    expect(capsOfExample('Serra Angel')).toEqual(['keyword:flying', 'keyword:vigilance']);
  });
  it('abilities granted inside a step count (Sneak Attack grants haste)', () => {
    expect(capsOfExample('Sneak Attack')).toEqual(expect.arrayContaining(['keyword:haste', 'layer:6', 'op:delay', 'static:continuous']));
  });
  it('the result is sorted, has no duplicates, and does not depend on the order of the keys of the input', () => {
    const a = example('Cryptic Command')[0]!;
    const shuffled = JSON.parse(JSON.stringify(a, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))) as AbilityDef;
    expect(capabilitiesOf(shuffled)).toEqual(capabilitiesOf(a));
    expect(capabilitiesOf(a)).toEqual([...new Set(capabilitiesOf(a))].sort());
  });
  it('manual nodes need nothing: op manual, cond ask, q ask, a manual cost part, a manual ability', () => {
    const manualBits = ab({
      kind: 'activated', text: 'x', cost: { other: [{ kind: 'manual', text: 'c' }] },
      effect: { targets: [], steps: [{ op: 'manual', text: 't', reason: 'r' }, { op: 'draw', who: { ref: 'you' }, count: { q: 'ask', text: 'n' }, guard: { cond: 'ask', text: 'q' } }] },
    });
    expect(caps(manualBits)).toEqual(['op:draw', 'ref:you']);
    expect(caps(ab({ kind: 'manual', text: 'x', reason: 'r', shape: 'unknown' }))).toEqual([]);
    expect(caps(ab({ kind: 'manual', text: 'x', reason: 'r', shape: 'triggered', effect: { targets: [], steps: [{ op: 'tap', what: { ref: 'self' } }] } }))).toEqual(['op:tap', 'ref:self']);
  });
  it('every ObjectFilter field that is set is a capability, nested filters included; history fields add feature:history (design D2)', () => {
    const f = caps(spell([{ op: 'tap', what: { ref: 'each', filter: { types: ['Creature'], power: { op: '<=', value: 2 }, anyOf: [{ dealtDamageThisTurn: true }, { not: { tapped: true } }] } } }]));
    expect(f).toEqual(expect.arrayContaining(['filter:types', 'filter:power', 'filter:anyOf', 'filter:dealtDamageThisTurn', 'filter:not', 'filter:tapped', 'feature:history']));
    expect(f).not.toContain('filter:cmp.quantity');
  });
});

describe('value forms and unread fields (model/forms.ts)', () => {
  it('filter forms: a list of keywords, a computed comparison, a player reference', () => {
    const f = caps(spell([{ op: 'tap', what: { ref: 'each', filter: { keyword: ['flying', 'reach'], power: { op: '>=', value: { q: 'count', of: { ref: 'each', filter: {} } } }, controller: { ref: 'defending' } } } }]));
    expect(f).toEqual(expect.arrayContaining(['filter:keyword.list', 'filter:cmp.quantity', 'filter:controller.ref']));
  });
  it('cost forms: discard your hand, any number, a computed amount, exile from a zone other than graveyard or hand', () => {
    const c = caps(ab({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'discard', count: 1, hand: true }, { kind: 'sacrifice', filter: {}, count: 'any' }, { kind: 'exileFrom', zone: 'library', count: 1 }, { kind: 'removeCounters', counter: 'charge', count: 1, filter: {} }] }, effect: { targets: [], steps: [] } }));
    expect(c).toEqual(expect.arrayContaining(['cost:discard', 'cost:discard.hand', 'cost:count.any', 'cost:exileFrom.zone', 'cost:removeCounters.filter']));
  });
  it('target forms: distinctFrom, divide (with the decision it needs), groupLimit, onlyIf, chooser, a computed count', () => {
    const t = caps(spell([], [{ id: 't0', kind: 'object', min: { q: 'count', of: { ref: 'self' } }, max: 'any', text: 'x', distinctFrom: ['t1'], divide: { what: 'damage', total: 3 }, groupLimit: { stat: 'power', cmp: { op: '<=', value: 5 } }, onlyIf: { cond: 'wasCast', kicked: true }, chooser: { ref: 'anOpponent' } }, { id: 't1', kind: 'player', min: 1, max: 1, text: 'y' }]));
    expect(t).toEqual(expect.arrayContaining(['target:object', 'target:player', 'feature:target.distinct', 'feature:target.divide', 'feature:target.groupLimit', 'feature:target.onlyIf', 'feature:target.chooser', 'feature:count.quantity', 'decision:chooseDivision', 'cond:wasCast']));
  });
  it('mode forms: an override, a chooser, an additional cost of a mode', () => {
    const m = caps(spell([], [], { modes: { min: 1, max: 1, chooser: { ref: 'anOpponent' }, override: { when: { cond: 'wasCast', kicked: true }, min: 1, max: 3 }, options: [{ text: 'a', program: { targets: [], steps: [] }, cost: { mana: [{ kind: 'generic', amount: 1 }] } }] } }));
    expect(m).toEqual(expect.arrayContaining(['feature:modes.chooser', 'feature:modes.override', 'feature:modes.cost']));
  });
  it('activated forms: a restriction, once per game, once per combat', () => {
    const a = caps(ab({ kind: 'activated', text: 'x', cost: { tap: true }, effect: { targets: [], steps: [] }, onlyIf: { cond: 'ask', text: 'q' }, limit: { per: 'game', max: 1 } }));
    expect(a).toEqual(['feature:activate.onlyIf', 'feature:announce.cond.ask', 'feature:limit.game']);
    expect(caps(ab({ kind: 'activated', text: 'x', cost: { tap: true }, effect: { targets: [], steps: [] }, limit: { per: 'turn', max: 1 } }))).toEqual([]);
  });
});

describe('structural capabilities', () => {
  it('triggers: batch ("one or more") and a limit ("only once each turn"); every event pattern is ev:<ev>', () => {
    const t = caps(ab({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'attacks' }, { ev: 'blocks' }], batch: true }, limit: { per: 'turn', max: 1 }, effect: { targets: [], steps: [] } }));
    expect(t).toEqual(['ev:attacks', 'ev:blocks', 'feature:trigger.batch', 'feature:trigger.limit']);
  });
  it('replacements: self (the object itself) vs foreign (design 8.5), and shields (resolved effects) need neither', () => {
    const rep = (replaces: J, body: J, extra: J = {}): AbilityDef => ab({ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces, body, ...extra }] });
    // M6-0 (m6 design D2): a replacement pattern names the proposal kind it needs (feature:replace.on.<ev>), not ev:<ev>
    expect(caps(rep({ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, { b: 'enters', tapped: true }))).toEqual(['body:enters', 'feature:replace.on.zoneChange', 'feature:replace.self', 'filter:self', 'static:replace']);
    expect(caps(rep({ ev: 'zoneChange', subject: {}, to: 'graveyard' }, { b: 'modify', destination: { zone: 'exile' } }))).toContain('feature:replace.foreign');
    expect(caps(rep({ ev: 'damage' }, { b: 'regeneration' }, { shield: { uses: 1 } }))).not.toContain('feature:replace.foreign');
    expect(caps(rep({ ev: 'damage' }, { b: 'prevent', amount: 'all' }, { shield: { uses: 1 } }))).not.toContain('feature:replace.self');
  });
  it('continuous effects: a layer per modification; dependency (CR 613.8a) in every layer, the P/T sublayers included', () => {
    const c = (layer: unknown, payload: J): AbilityDef => ab({ kind: 'static', text: 'x', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer, ...payload }] }] });
    expect(caps(c('7c', { power: 1 }))).toEqual(['feature:dependency', 'layer:7c', 'ref:self', 'sref:self', 'static:continuous']); // sref: WP22 review INTERFACE CHANGE (a static's continuous effect is read by statics/match.ts)
    expect(caps(c(4, { types: { add: ['Creature'] } }))).toEqual(expect.arrayContaining(['layer:4', 'feature:dependency']));
    expect(caps(c('1a', { copyOf: { ref: 'self' } }))).toContain('feature:dependency');
  });
  it('rules: restriction, permission and rule modification name the hook', () => {
    const d = caps(ab({ kind: 'static', text: 'x', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'attack' }, { s: 'permit', who: { ref: 'you' }, action: 'spendMana' }, { s: 'rule', rule: 'maxHandSize', value: 'none' }] }));
    expect(d).toEqual(expect.arrayContaining(['rule:attack', 'permit:spendMana', 'rulemod:maxHandSize', 'static:restrict', 'static:permit', 'static:rule']));
  });
  it('actions: the keyword action of a step or a cost part; decisions the model needs', () => {
    const s = caps(spell([{ op: 'action', action: 'investigate', who: { ref: 'you' } }, { op: 'chooseValue', who: { ref: 'you' }, what: 'cardName', as: 'n' }]));
    expect(s).toEqual(expect.arrayContaining(['op:action', 'action:investigate', 'decision:chooseName']));
    expect(caps(ab({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'action', action: 'exert' }] }, effect: { targets: [], steps: [] } }))).toEqual(['action:exert', 'cost:action', 'cost:action.exert']);
  });
  it('manual reminders (a shield chip), mana restrictions, and the structural kinds without a table yet', () => {
    expect(caps(spell([{ op: 'manual', text: 't', reason: 'r', reminder: { d: 'endOfTurn' } }]))).toEqual(['feature:manual.reminder']);
    expect(caps(spell([{ op: 'addMana', who: { ref: 'you' }, units: [['G']], restriction: { spells: { types: ['Creature'] } } }]))).toContain('feature:mana.restriction');
    expect(caps(ab({ kind: 'chapter', text: 'x', chapters: [1], effect: { targets: [], steps: [] } }))).toEqual(['ev:counters', 'feature:chapter']);
  });
  it('tokens: the keywords of a token are capabilities', () => {
    expect(caps(spell([{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { name: 'Bird', types: ['Creature'], keywords: ['flying'] } }]))).toContain('keyword:flying');
  });
});

describe('capabilityUses and missingCapabilities', () => {
  it('capabilityUses gives the pointer of the node that needs each capability', () => {
    const uses = capabilityUses(example('Lightning Bolt')[0]);
    expect(uses).toContainEqual({ cap: 'target:anyTarget', path: '/effect/targets/0' });
    expect(uses).toContainEqual({ cap: 'op:damage', path: '/effect/steps/0' });
    expect(uses).toContainEqual({ cap: 'ref:target', path: '/effect/steps/0/to' });
  });
  it('missingCapabilities is what the set lacks', () => {
    const have = new Set(['op:damage', 'ref:self', 'ref:target']);
    expect(missingCapabilities(example('Lightning Bolt')[0]!, have)).toEqual(['target:anyTarget']);
    expect(missingCapabilities(example('Lightning Bolt')[0]!, new Set(capsOfExample('Lightning Bolt')))).toEqual([]);
  });
  it('every worked example is walked without error, and the real engine set lacks every op whose handler package has not merged: nothing is falsely automated', () => {
    for (const ex of EXAMPLES) for (const f of ex.faces) for (const a of f.abilities) expect(Array.isArray(capabilitiesOf(a))).toBe(true);
    // Every op whose handler package has not merged is still missing (WP12 made Lightning Bolt's op:damage real: test/m5/lifedamage/capabilities.test.ts).
    for (const ex of EXAMPLES) for (const f of ex.faces) for (const a of f.abilities) {
      const unhandled = capabilitiesOf(a).filter((c) => c.startsWith('op:') && !Object.hasOwn(OP_HANDLERS, c.slice(3).split('.')[0]!));
      for (const c of unhandled) expect(missingCapabilities(a, ENGINE_CAPABILITIES), `${ex.name}: ${c}`).toContain(c);
    }
  });
});
