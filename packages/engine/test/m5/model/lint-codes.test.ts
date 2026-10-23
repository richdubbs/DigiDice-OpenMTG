/**
 * One test per IssueCode of model/api.ts (WP1): each takes a valid ability, breaks exactly one thing, and expects that code at that path; and a
 * positive test where the design says the same shape is allowed. Breaking a binding of a worked example fails with `unbound-name`.
 */
import { describe, expect, it } from 'vitest';
import { validateAbility, validateCardAbilities, type Issue, type IssueCode } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const spell = (steps: J[], targets: J[] = [], extra: J = {}): AbilityDef =>
  ab({ kind: 'spell', text: 'x', effect: { targets, steps, ...extra } });
const spec = (id: string, extra: J = {}): J => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', ...extra });
const draw = (extra: J = {}): J => ({ op: 'draw', who: { ref: 'you' }, count: 1, ...extra });
const codes = (issues: Issue[], severity: 'error' | 'warning' = 'error'): IssueCode[] => issues.filter((i) => i.severity === severity).map((i) => i.code);
const only = (def: AbilityDef, code: IssueCode, path?: string, ctx?: Parameters<typeof validateAbility>[1]): void => {
  const issues = validateAbility(def, ctx);
  expect(codes(issues), JSON.stringify(issues)).toContain(code);
  if (path !== undefined) expect(issues.find((i) => i.code === code)!.path).toBe(path);
};
const clean = (def: AbilityDef, ctx?: Parameters<typeof validateAbility>[1]): void => {
  const issues = validateAbility(def, ctx);
  expect(issues, JSON.stringify(issues)).toEqual([]);
};
const trigger = (on: J[], steps: J[], extra: J = {}): AbilityDef => ab({ kind: 'triggered', text: 'x', trigger: { on }, effect: { targets: [], steps }, ...extra });
const cont = (mods: J[], extra: J = {}): J => ({ s: 'continuous', affects: { ref: 'self' }, mods, ...extra });
const stat = (effects: J[], extra: J = {}): AbilityDef => ab({ kind: 'static', text: 'x', effects, ...extra });

describe('IssueCode unbound-name (design 3.1.6, CR 608.2c)', () => {
  it('a reference to a name no earlier step binds', () => {
    only(spell([draw({ who: { ref: 'bound', name: 'ghost' } })]), 'unbound-name', '/effect/steps/0/who');
  });
  it('did and resultCount name a step that must be earlier', () => {
    only(spell([draw({ guard: { cond: 'did', step: 'later' } }), { op: 'shuffle', who: { ref: 'you' }, as: 'later' }]), 'unbound-name', '/effect/steps/0/guard');
    only(spell([draw({ count: { q: 'resultCount', step: 'none' } })]), 'unbound-name');
  });
  it('a step cannot read the name it binds itself', () => {
    only(spell([{ op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'bound', name: 'c' }, min: 0, max: 1, as: 'c' }]), 'unbound-name');
  });
  it('a name bound in only one branch is not bound afterwards, one bound in both is', () => {
    const choose = (as: string): J => ({ op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', owner: 'you' } }, min: 0, max: 1, as });
    const use = { op: 'discard', who: { ref: 'you' }, count: 1, filter: { is: { ref: 'bound', name: 'c' } } };
    const cond = { cond: 'turnOf', whose: 'you' };
    only(spell([{ op: 'if', cond, then: [choose('c')] }, use]), 'unbound-name', '/effect/steps/1/filter/is');
    only(spell([{ op: 'if', cond, then: [choose('c')], else: [draw()] }, use]), 'unbound-name');
    clean(spell([{ op: 'if', cond, then: [choose('c')], else: [choose('c')] }, use]));
  });
  it('a name bound in a loop body does not escape it, and the loop variable is visible inside', () => {
    const body = { op: 'tap', what: { ref: 'bound', name: 'p' } };
    clean(spell([{ op: 'forEach', over: { ref: 'each', filter: { types: ['Creature'] } }, as: 'p', do: [body] }]));
    only(spell([{ op: 'forEach', over: { ref: 'each', filter: { types: ['Creature'] } }, as: 'p', do: [] }, body]), 'unbound-name');
  });
  it('a delayed trigger sees only the names it captures (CR 603.7c); the reflexive trigger waits for a bound name', () => {
    const pick = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 0, max: 1, as: 'c' };
    const delay = (capture?: string[]): J => ({ op: 'delay', when: { at: 'step', step: 'end', next: true }, ...(capture ? { capture } : {}), do: [{ op: 'sacrifice', what: { ref: 'bound', name: 'c' } }] });
    clean(spell([pick, delay(['c'])]));
    only(spell([pick, delay()]), 'unbound-name', '/effect/steps/1/do/0/what');
    only(spell([{ op: 'reflexive', when: { did: 'nothing' }, targets: [], do: [draw()] }]), 'unbound-name', '/effect/steps/0/when/did');
  });
  it('the modes do not see each other, and the ability steps do not see a mode', () => {
    const pick = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { types: ['Creature'] } }, min: 0, max: 1, as: 'c' };
    const tap = { op: 'tap', what: { ref: 'bound', name: 'c' } };
    const mode = (steps: J[]): J => ({ text: 'm', program: { targets: [], steps } });
    const modes = { min: 1, max: 1, options: [mode([pick]), mode([tap])] };
    only(spell([], [], { modes }), 'unbound-name', '/effect/modes/options/1/program/steps/0/what');
    only(spell([tap], [], { modes: { min: 1, max: 1, options: [mode([pick])] } }), 'unbound-name');
  });
  it('the Sneak Attack example with its binding broken fails; the intact one passes', () => {
    const sneak = EXAMPLES.find((e) => e.name === 'Sneak Attack')!.faces[0]!.abilities[0]!;
    clean(sneak);
    const broken = JSON.parse(JSON.stringify(sneak).replace('"as":"c"', '"as":"d"')) as AbilityDef;
    const issues = validateAbility(broken);
    expect(codes(issues)).toContain('unbound-name');
    expect(issues.filter((i) => i.code === 'unbound-name').length).toBeGreaterThanOrEqual(3);
  });
  it('{ref:iterating} outside a forEach', () => {
    only(spell([draw({ who: { ref: 'iterating' } })]), 'unbound-name', '/effect/steps/0/who');
  });
  it('a name used outside any program (a cost, a trigger event) is unbound', () => {
    only(ab({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'sacrifice', filter: { is: { ref: 'bound', name: 'z' } }, count: 1 }] }, effect: { targets: [], steps: [] } }), 'unbound-name');
  });
});

describe('IssueCode duplicate-name', () => {
  it('a name already bound on this path cannot be bound again', () => {
    const pick = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: {} }, min: 0, max: 1, as: 'c' };
    only(spell([pick, { ...pick }]), 'duplicate-name', '/effect/steps/1/as');
  });
  it('a loop variable cannot shadow a bound name', () => {
    const pick = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: {} }, min: 0, max: 1, as: 'c' };
    only(spell([pick, { op: 'forEach', over: { ref: 'each', filter: {} }, as: 'c', do: [] }]), 'duplicate-name', '/effect/steps/1/as');
  });
  it('the same keyword ability twice with the same parameters is a warning (card-wide)', () => {
    const kw = { kind: 'keyword', text: 'Flying', keyword: 'flying' };
    const issues = validateCardAbilities([{ abilities: [ab(kw), ab({ ...kw, text: 'Flying' })] }]);
    expect(issues).toEqual([expect.objectContaining({ code: 'duplicate-name', severity: 'warning', path: '/faces/0/abilities/1' })]);
    expect(validateCardAbilities([{ abilities: [ab({ ...kw, keyword: 'ward', amount: 1 }), ab({ ...kw, keyword: 'ward', amount: 2 })] }])).toEqual([]);
  });
});

describe('IssueCode unknown-target, duplicate-target, modal-ids, bad-distinct, bad-target-count', () => {
  it('unknown-target: a step names a target id the ability does not declare (CR 115.1)', () => {
    only(spell([{ op: 'tap', what: { ref: 'target', id: 't9' } }], [spec('t0')]), 'unknown-target', '/effect/steps/0/what');
    only(spell([draw({ count: { q: 'targetCount', id: 't9' } })]), 'unknown-target');
  });
  it('unknown-target: a cost modifier naming the target id of another ability (the mistake the prototype lint found, design 13)', () => {
    only(stat([{ s: 'costMod', applies: { self: true, caster: 'you' }, change: { kind: 'increase', generic: { q: 'count', of: { ref: 'target', id: 't0' } } } }]), 'unknown-target');
  });
  it('a reflexive trigger declares its own targets, visible only inside it', () => {
    const pick = { op: 'may', who: { ref: 'you' }, do: [], as: 'p' };
    const refl = { op: 'reflexive', when: { did: 'p' }, targets: [spec('r0')], do: [{ op: 'tap', what: { ref: 'target', id: 'r0' } }] };
    clean(spell([pick, refl]));
    only(spell([pick, refl, { op: 'tap', what: { ref: 'target', id: 'r0' } }]), 'unknown-target', '/effect/steps/2/what');
  });
  it('duplicate-target: two specs with one id', () => {
    only(spell([], [spec('t0'), spec('t0')]), 'duplicate-target', '/effect/targets/1');
  });
  it('modal-ids: target ids must be unique across the modes (CR 608.2b is decided once over all chosen modes)', () => {
    const mode = (id: string): J => ({ text: 'm', program: { targets: [spec(id)], steps: [{ op: 'tap', what: { ref: 'target', id } }] } });
    clean(spell([], [], { modes: { min: 1, max: 1, options: [mode('t0'), mode('t1')] } }));
    only(spell([], [], { modes: { min: 1, max: 1, options: [mode('t0'), mode('t0')] } }), 'modal-ids');
  });
  it('bad-distinct: another target must differ from a spec of the same ability', () => {
    only(spell([], [spec('t0', { distinctFrom: ['t0'] })]), 'bad-distinct');
    only(spell([], [spec('t0', { distinctFrom: ['zz'] })]), 'bad-distinct');
    clean(spell([], [spec('t0'), spec('t1', { distinctFrom: ['t0'] })]));
  });
  it('bad-target-count: min above max, "any" as a minimum, zero or fractional counts', () => {
    only(spell([], [spec('t0', { min: 3, max: 1 })]), 'bad-target-count');
    only(spell([], [spec('t0', { min: 'any', max: 'any' })]), 'bad-target-count', '/effect/targets/0/min');
    only(spell([], [spec('t0', { max: 0, min: 0 })]), 'bad-target-count');
    only(spell([], [spec('t0', { min: 1.5, max: 2 })]), 'bad-target-count');
    clean(spell([], [spec('t0', { min: 0, max: 'any' })]));
    only(spell([], [], { modes: { min: 2, max: 1, options: [{ text: 'm', program: { targets: [], steps: [] } }] } }), 'bad-target-count');
  });
});

describe('IssueCode bad-var', () => {
  it('{q:var} needs an earlier let on every path', () => {
    only(spell([draw({ count: { q: 'var', name: 'n' } })]), 'bad-var', '/effect/steps/0/count');
    clean(spell([{ op: 'let', name: 'n', value: 2 }, draw({ count: { q: 'var', name: 'n' } })]));
    only(spell([{ op: 'if', cond: { cond: 'turnOf', whose: 'you' }, then: [{ op: 'let', name: 'n', value: 2 }] }, draw({ count: { q: 'var', name: 'n' } })]), 'bad-var');
  });
  it('{q:X} in an ability of a card known to have no X in its cost; unknown or true is accepted (the card-wide caller knows)', () => {
    const x = spell([draw({ count: { q: 'X' } })]);
    only(x, 'bad-var', '/effect/steps/0/count', { cardHasX: false });
    clean(x);
    clean(x, { cardHasX: true });
  });
  it('X defined by the ability\'s own cost is fine even when the card says no', () => {
    clean(ab({ kind: 'activated', text: 'x', cost: { mana: [{ kind: 'variable', name: 'X' }] }, effect: { targets: [], steps: [draw({ count: { q: 'X' } })] } }), { cardHasX: false });
  });
});

describe('IssueCode bad-event-role (design 3.5)', () => {
  const role = (r: string): J => ({ op: 'tap', what: { ref: 'event', role: r } });
  it('an event reference outside a trigger or replacement', () => {
    only(spell([role('subject')]), 'bad-event-role', '/effect/steps/0/what');
  });
  it('a role the trigger event does not expose, and the same role exposed by one of two patterns only', () => {
    const dies = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
    clean(trigger([dies], [role('subject')]));
    only(trigger([dies], [role('attacker')]), 'bad-event-role');
    // (std-rx16: an attack exposes `subject` too, the attacking creature, so the pattern without it is a draw)
    only(trigger([dies, { ev: 'draw', player: 'you' }], [role('subject')]), 'bad-event-role');
    clean(trigger([dies, { ev: 'draw', player: 'you' }], [{ op: 'draw', who: { ref: 'event', role: 'player' }, count: 1 }]));
  });
  it('a replacement exposes the roles of the event it replaces; an event-based delayed trigger those of its event', () => {
    clean(stat([{ s: 'replace', replaces: { ev: 'damage' }, body: { b: 'instead', do: [{ op: 'gainLife', who: { ref: 'event', role: 'recipient' }, amount: 1 }] } }]));
    clean(spell([{ op: 'delay', when: { at: 'event', event: { ev: 'attacks' } }, do: [{ op: 'tap', what: { ref: 'event', role: 'attacker' } }] }]));
  });
  it('a state trigger has no event to read', () => {
    only(trigger([{ ev: 'state', cond: { cond: 'turnOf', whose: 'you' } }], [role('subject')]), 'bad-event-role');
  });
});

describe('IssueCode bad-subject, bad-layer, bad-divide, bad-capture', () => {
  it('bad-subject: {ref:subject} only inside a continuous effect or an each-scoped step', () => {
    only(spell([draw({ count: { q: 'stat', stat: 'power', of: { ref: 'subject' } } })]), 'bad-subject');
    clean(stat([cont([{ layer: '7c', power: { q: 'stat', stat: 'manaValue', of: { ref: 'subject' } } }])]));
  });
  it('bad-layer: layer 7a is for characteristic-defining abilities only (CR 613.4a)', () => {
    only(stat([cont([{ layer: '7a', power: 3 }])]), 'bad-layer', '/effects/0/mods/0');
    clean(stat([cont([{ layer: '7a', power: 3 }], { cda: true })]));
  });
  it('bad-layer: a CDA does not change abilities or control; a modification must change something', () => {
    only(stat([cont([{ layer: 6, removeAll: true }], { cda: true })]), 'bad-layer');
    only(stat([cont([{ layer: '7c' }])]), 'bad-layer');
    only(stat([cont([{ layer: 4 }])]), 'bad-layer');
  });
  it('bad-divide: divided "announced" needs a target spec with a division of damage (CR 601.2d)', () => {
    const dmg = (extra: J = {}): J => ({ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3, divided: 'announced', ...extra });
    only(spell([dmg()], [spec('t0')]), 'bad-divide', '/effect/steps/0');
    clean(spell([dmg()], [spec('t0', { divide: { what: 'damage', total: 3 } })]));
    clean(spell([dmg({ divided: 'evenlyRoundDown' })], [spec('t0')]));
  });
  it('bad-capture: a delayed trigger captures a name no earlier step binds', () => {
    only(spell([{ op: 'delay', when: { at: 'endOfCombat' }, capture: ['nope'], do: [] }]), 'bad-capture', '/effect/steps/0/capture/0');
  });
});

describe('IssueCode unlinked (card-wide, CR 607.1)', () => {
  const producer = ab({ kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] }, effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 't' }], steps: [{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, link: 'x' }] } });
  const consumer = ab({ kind: 'triggered', text: 'y', trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, from: 'battlefield' }] }, effect: { targets: [], steps: [{ op: 'move', what: { ref: 'linked', link: 'x' }, to: { zone: 'hand' } }] } });
  it('a consumer without a producer on the card is an error; a producer nobody reads a warning', () => {
    expect(validateCardAbilities([{ abilities: [producer, consumer] }])).toEqual([]);
    const lonely = validateCardAbilities([{ abilities: [consumer] }]);
    expect(lonely).toEqual([expect.objectContaining({ code: 'unlinked', severity: 'error', path: '/faces/0/abilities/0/effect/steps/0/what' })]);
    const unread = validateCardAbilities([{ abilities: [producer] }]);
    expect(unread).toEqual([expect.objectContaining({ code: 'unlinked', severity: 'warning' })]);
  });
  it('a chosen-quality consumer (filter, condition, color) needs a producer too', () => {
    const chosenFilter = spell([{ op: 'tap', what: { ref: 'each', filter: { chosen: { link: 'c', quality: 'color' } } } }]);
    expect(validateCardAbilities([{ abilities: [chosenFilter] }]).map((i) => i.code)).toEqual(['unlinked']);
    const choose = ab({ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', choose: [{ what: 'color', link: 'c' }] } }] });
    expect(validateCardAbilities([{ abilities: [choose, chosenFilter] }])).toEqual([]);
  });
  it('face structure: a card has a face, and one spell ability per face (design D25)', () => {
    expect(codes(validateCardAbilities([]))).toEqual(['executable-gap']);
    const s = spell([draw()]);
    expect(validateCardAbilities([{ abilities: [s, s] }])).toEqual([expect.objectContaining({ code: 'executable-gap', path: '/faces/0/abilities/1' })]);
  });
});

describe('IssueCode ask-position (design 10.1)', () => {
  const ask = { cond: 'ask', text: 'Is it so?' };
  it('allowed: a step guard, an `if` condition, an activation restriction, and inside all/any/not of those', () => {
    clean(spell([draw({ guard: ask })]));
    clean(spell([{ op: 'if', cond: { cond: 'all', of: [ask, { cond: 'turnOf', whose: 'you' }] }, then: [draw()] }]));
    clean(ab({ kind: 'activated', text: 'x', cost: { tap: true }, effect: { targets: [], steps: [draw()] }, onlyIf: ask }));
  });
  it('a manual condition is not allowed in an intervening if, a static condition, a trigger event or a target spec', () => {
    only(trigger([{ ev: 'zoneChange', subject: { self: true } }], [draw()], { interveningIf: ask }), 'ask-position', '/interveningIf');
    only(stat([cont([{ layer: 4, types: { add: ['Creature'] } }])], { condition: ask }), 'ask-position', '/condition');
    only(trigger([{ ev: 'state', cond: ask }], [draw()]), 'ask-position');
    only(spell([], [spec('t0', { onlyIf: ask })]), 'ask-position', '/effect/targets/0/onlyIf');
  });
  it('a manual quantity is allowed in a step and not in a cost, a target spec or a trigger', () => {
    clean(spell([draw({ count: { q: 'ask', text: 'How many?' } })]));
    only(ab({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'payLife', amount: { q: 'ask', text: 'n' } }] }, effect: { targets: [], steps: [] } }), 'ask-position');
    only(spell([], [spec('t0', { min: { q: 'ask', text: 'n' }, max: 'any' })]), 'ask-position');
    only(trigger([{ ev: 'life', change: 'gain', amount: { op: '>=', value: { q: 'ask', text: 'n' } } }], [draw()]), 'ask-position');
  });
  it('the whole table of design 10.1, row by row: a manual node where the design says none, an error; where it says one, none', () => {
    const q: J = { q: 'ask', text: 'n' };
    const rows: [string, AbilityDef, boolean][] = [
      ['step guard: ask condition', spell([draw({ guard: ask })]), true],
      ['if.cond: ask condition', spell([{ op: 'if', cond: ask, then: [] }]), true],
      ['a quantity inside a step: ask quantity', spell([draw({ count: q })]), true],
      ['a quantity in the modification of a resolved effect', spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [cont([{ layer: '7c', power: q }])] }]), true],
      ['a step: op manual', spell([{ op: 'manual', text: 't', reason: 'r' }]), true],
      ['cost part: manual', ab({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'manual', text: 'c' }] }, effect: { targets: [], steps: [] } }), true],
      ['activation restriction: ask condition', ab({ kind: 'activated', text: 'x', cost: {}, effect: { targets: [], steps: [] }, onlyIf: ask }), true],
      ['TargetSpec min: ask quantity', spell([], [spec('t0', { min: q, max: 'any' })]), false],
      ['TargetSpec onlyIf: ask condition', spell([], [spec('t0', { onlyIf: ask })]), false],
      ['TargetSpec groupLimit: ask quantity', spell([], [spec('t0', { groupLimit: { stat: 'power', cmp: { op: '<=', value: q } } })]), false],
      ['TargetSpec filter: ask quantity', spell([], [spec('t0', { filter: { power: { op: '<=', value: q } } })]), false],
      ['trigger event: ask quantity', trigger([{ ev: 'damage', amount: { op: '>=', value: q } }], [draw()]), false],
      ['trigger event: ask condition (state)', trigger([{ ev: 'state', cond: ask }], [draw()]), false],
      ['intervening if: ask condition', trigger([{ ev: 'draw' }], [draw()], { interveningIf: ask }), false],
      ['static condition: ask condition', stat([cont([{ layer: 4, types: { add: ['Creature'] } }])], { condition: ask }), false],
      ['static effect: ask quantity', stat([cont([{ layer: '7c', power: q }])]), false],
      ['cost modifier: ask quantity', stat([{ s: 'costMod', applies: { caster: 'you' }, change: { kind: 'reduce', generic: q } }]), false],
      ['mode count: ask quantity', spell([], [], { modes: { min: q, max: 2, options: [{ text: 'm', program: { targets: [], steps: [] } }] } }), false],
      ['mode override: ask condition', spell([], [], { modes: { min: 1, max: 1, override: { when: ask, min: 1, max: 2 }, options: [{ text: 'm', program: { targets: [], steps: [] } }] } }), false],
      ['duration: ask condition', spell([{ op: 'effect', duration: { d: 'asLongAs', cond: ask }, effects: [cont([{ layer: '7c', power: 1 }])] }]), false],
      ['mana restriction: ask quantity', spell([{ op: 'addMana', who: { ref: 'you' }, units: [['G']], restriction: { spells: { manaValue: { op: '<=', value: q } } } }]), false],
      ['destination: ask quantity', spell([{ op: 'move', what: { ref: 'self' }, to: { zone: 'library', position: { nth: q } } }]), false],
      ['cost of a pay step: ask quantity', spell([{ op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'payLife', amount: q }] } }]), false],
    ];
    for (const [row, def, allowed] of rows) {
      const bad = validateAbility(def).filter((i) => i.code === 'ask-position');
      expect(bad.length === 0, `${row}: ${JSON.stringify(bad)}`).toBe(allowed);
    }
  });
  it('a manual cost part is fine in an activated ability, not in a mana ability', () => {
    const mana = (isMana: boolean): AbilityDef => ab({ kind: 'activated', text: 'x', cost: { other: [{ kind: 'manual', text: 'Do the thing' }] }, ...(isMana ? { isMana } : {}), effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['G']] }] } });
    clean(mana(false));
    only(mana(true), 'ask-position');
  });
});

describe('IssueCode live-position, fixed-in-card-data, spell-target-count', () => {
  it('live-position: {q:live} only inside a continuous-effect modification', () => {
    only(spell([draw({ count: { q: 'live', value: 2 } })]), 'live-position');
    clean(stat([cont([{ layer: '7c', power: { q: 'live', value: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'] } } } } }])]));
  });
  it('fixed-in-card-data: {ref:fixed} is written only by the effect handler', () => {
    only(spell([{ op: 'tap', what: { ref: 'fixed', objects: [{ id: 'o1', zone: 'battlefield' }] } }]), 'fixed-in-card-data', '/effect/steps/0/what');
  });
  it('spell-target-count: only in the cost modifier of the spell itself', () => {
    const mod = (self: boolean): AbilityDef => stat([{ s: 'costMod', applies: { self, caster: 'you' }, change: { kind: 'increase', generic: { q: 'spellTargetCount' } } }]);
    clean(mod(true));
    only(mod(false), 'spell-target-count');
    only(spell([draw({ count: { q: 'spellTargetCount' } })]), 'spell-target-count');
  });
});

describe('IssueCode executable-gap', () => {
  it('addMana needs exactly one of units and dynamic', () => {
    only(spell([{ op: 'addMana', who: { ref: 'you' } }]), 'executable-gap');
    only(spell([{ op: 'addMana', who: { ref: 'you' }, units: [['G']], dynamic: { kind: 'anyColor', count: 1 } }]), 'executable-gap');
    clean(spell([{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'anyColor', count: 1 } }]));
  });
  it('a mana ability has no target; a loyalty ability needs its loyalty cost (CR 605.1a, 606.4)', () => {
    const mana = ab({ kind: 'activated', text: 'x', isMana: true, cost: { tap: true }, effect: { targets: [spec('t0')], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['G']] }] } });
    only(mana, 'executable-gap');
    only(ab({ kind: 'activated', text: 'x', isLoyalty: true, cost: {}, effect: { targets: [], steps: [draw()] } }), 'executable-gap', '/cost');
  });
  it('a modal ability with no mode, an empty effect, a token with nothing, a chapter list out of order', () => {
    only(spell([], [], { modes: { min: 1, max: 1, options: [] } }), 'executable-gap');
    only(spell([{ op: 'effect', effects: [], duration: { d: 'endOfTurn' } }]), 'executable-gap');
    only(spell([{ op: 'createToken', who: { ref: 'you' }, token: {}, count: 1 }]), 'executable-gap');
    only(ab({ kind: 'chapter', text: 'x', chapters: [2, 1], effect: { targets: [], steps: [draw()] } }), 'executable-gap');
    only(stat([]), 'executable-gap');
  });
});

describe('IssueCode schema', () => {
  it('JSON that does not match the generated schema is reported as `schema` (and nothing else)', () => {
    const issues = validateAbility(ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'frobnicate' }] } }));
    expect(issues).toEqual([expect.objectContaining({ code: 'schema', path: '/effect/steps/0' })]);
  });
});

describe('abilities nested in a node are their own scope', () => {
  it('a granted ability does not see the names of the step that grants it, and its own problems are reported at their nested path', () => {
    const granted = { kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'step', step: 'upkeep' }] }, effect: { targets: [], steps: [{ op: 'tap', what: { ref: 'bound', name: 'c' } }] } };
    const pick = { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: {} }, min: 0, max: 1, as: 'c' };
    const grant = { op: 'effect', duration: { d: 'permanent' }, effects: [cont([{ layer: 6, add: [granted] }], { affects: { ref: 'bound', name: 'c' } })] };
    const issues = validateAbility(spell([pick, grant]));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['unbound-name', '/effect/steps/1/effects/0/mods/0/add/0/effect/steps/0/what']]);
  });
});
