/**
 * Review round on the semantic lint (model/lint-*.ts): names in target specs and modes, event reads and "that much", characteristic-defining abilities,
 * mana abilities, and the rules-relevant mistakes that used to pass (modes, divided damage, links, target kinds, dice, whole numbers).
 */
import { describe, expect, it } from 'vitest';
import { validateAbility, validateCardAbilities, type Issue, type IssueCode } from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const spell = (steps: J[], targets: J[] = [], extra: J = {}): AbilityDef => ab({ kind: 'spell', text: 'x', effect: { targets, steps, ...extra } });
const spec = (id: string, extra: J = {}): J => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', ...extra });
const draw = (extra: J = {}): J => ({ op: 'draw', who: { ref: 'you' }, count: 1, ...extra });
const codes = (issues: Issue[]): IssueCode[] => issues.filter((i) => i.severity === 'error').map((i) => i.code);
const bad = (def: AbilityDef, code: IssueCode, path?: string): void => {
  const issues = validateAbility(def);
  expect(codes(issues), JSON.stringify(issues)).toContain(code);
  if (path !== undefined) expect(issues.find((i) => i.code === code)!.path).toBe(path);
};
const clean = (def: AbilityDef): void => {
  expect(validateAbility(def)).toEqual([]);
};
const trigger = (on: J[], steps: J[], extra: J = {}): AbilityDef => ab({ kind: 'triggered', text: 'x', trigger: { on }, effect: { targets: [], steps }, ...extra });

describe('CR 601.2b-c, 700.2a: targets and modes are chosen before anything resolves, so nothing can be bound there', () => {
  it('a target spec cannot read a name, a step result or a variable', () => {
    bad(spell([draw()], [spec('t0', { filter: { types: ['Creature'], power: { op: '<=', value: { q: 'var', name: 'nope' } } } })]), 'bad-var');
    bad(spell([draw()], [spec('t0', { filter: { sharesWith: { with: { ref: 'bound', name: 'ghost' }, quality: 'color' } } })]), 'unbound-name');
    bad(spell([draw()], [spec('t0', { onlyIf: { cond: 'did', step: 'ghost' } })]), 'unbound-name');
  });
  it('a mode count cannot read a variable either, and neither can the target spec of a mode', () => {
    bad(spell([], [], { modes: { min: { q: 'var', name: 'nope' }, max: 2, options: [{ text: 'a', program: { targets: [], steps: [draw()] } }, { text: 'b', program: { targets: [], steps: [draw()] } }] } }), 'bad-var');
    bad(spell([], [], { modes: { min: 1, max: 1, options: [{ text: 'a', program: { targets: [spec('t0', { onlyIf: { cond: 'did', step: 'ghost' } })], steps: [draw()] } }] } }), 'unbound-name');
  });
  it('a reflexive trigger\'s own target spec still sees the names bound before it (CR 603.12)', () => {
    clean(spell([{ op: 'may', who: { ref: 'you' }, do: [draw()], as: 'did' }, { op: 'reflexive', when: { did: 'did' }, targets: [spec('t0')], do: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] }]));
  });
});

describe('CR 603.7c, 603.10: event reads need an event the ability actually has', () => {
  const ev = { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' };
  const sacrificeIt = { op: 'sacrifice', what: { ref: 'event', role: 'subject' } };
  it('"that much" (eventAmount) needs a trigger, replacement or event delay whose event has an amount', () => {
    bad(spell([{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'eventAmount' } }]), 'bad-event-role');
    bad(trigger([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'eventAmount' } }]), 'bad-event-role');
    clean(trigger([{ ev: 'life', change: 'gain', player: 'you' }], [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'eventAmount' } }]));
    clean(trigger([{ ev: 'damage', source: { self: true } }], [draw({ count: { q: 'eventAmount' } })]));
  });
  it('FAST2 T10: a delayed trigger that waits for a step or the end of combat reads the event of the ability that creates it (fixed then, CR 603.7c)', () => {
    clean(trigger([ev], [{ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [sacrificeIt] }]));
    clean(trigger([ev], [{ op: 'delay', when: { at: 'endOfCombat' }, do: [sacrificeIt] }]));
    // without an enclosing event there is still nothing to read, and a role the enclosing event does not expose is still refused
    bad(spell([{ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [sacrificeIt] }]), 'bad-event-role');
    bad(trigger([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'delay', when: { at: 'endOfCombat' }, do: [sacrificeIt] }]), 'bad-event-role');
  });
  it('an event-based delayed trigger reads its own event, not the one of the enclosing trigger', () => {
    bad(trigger([ev], [{ op: 'delay', when: { at: 'event', event: { ev: 'step', step: 'end' } }, do: [sacrificeIt] }]), 'bad-event-role');
    clean(trigger([{ ev: 'step', step: 'upkeep', whose: 'you' }], [{ op: 'delay', when: { at: 'event', event: ev }, do: [sacrificeIt] }]));
  });
});

describe('CR 604.3: a characteristic-defining ability defines its own object\'s colors, subtypes, power or toughness, unconditionally', () => {
  const cda = (affects: J, mods: J[], extra: J = {}): AbilityDef => ab({ kind: 'static', text: 'x', effects: [{ s: 'continuous', affects, mods, cda: true }], ...extra });
  const self = { ref: 'self' };
  it('a CDA that affects other objects is rejected', () => {
    bad(cda({ ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, [{ layer: '7a', power: 1 }]), 'bad-layer');
    clean(cda(self, [{ layer: '7a', power: { q: 'count', of: { ref: 'each', filter: { types: ['Creature'] } } }, toughness: 1 }]));
  });
  it('a CDA under "as long as" is rejected', () => {
    bad(cda(self, [{ layer: '7a', power: 1 }], { condition: { cond: 'turnOf', whose: 'you' } }), 'bad-layer');
  });
  it('a CDA may set subtypes (changeling) but not add a card type', () => {
    bad(cda(self, [{ layer: 4, types: { add: ['Creature'] } }]), 'bad-layer');
    clean(cda(self, [{ layer: 4, subtypes: { all: true } }]));
  });
});

describe('CR 605.3a-b: a mana ability resolves immediately, so it cannot ask anything', () => {
  const mana = (steps: J[]): AbilityDef => ab({ kind: 'activated', text: 'x', isMana: true, cost: { tap: true }, effect: { targets: [], steps } });
  const add: J = { op: 'addMana', who: { ref: 'you' }, units: [['G']] };
  it('a manual step, a manual quantity or a manual condition in the effect is rejected', () => {
    bad(mana([add, { op: 'manual', text: 't', reason: 'r' }]), 'ask-position');
    bad(mana([{ op: 'addMana', who: { ref: 'you' }, dynamic: { kind: 'chosen', link: 'c', count: { q: 'ask', text: 'n' } } }]), 'ask-position');
    bad(mana([{ ...add, guard: { cond: 'ask', text: 'q' } }]), 'ask-position');
  });
  it('an ordinary ability may', () => {
    expect(codes(validateAbility(ab({ kind: 'activated', text: 'x', cost: { tap: true }, effect: { targets: [], steps: [{ op: 'manual', text: 't', reason: 'r' }] } })))).not.toContain('ask-position');
  });
});

describe('CR 700.2d, 601.2d, 607.2d, 115.1, 706, 107.1: mistakes that used to pass', () => {
  const opt = (t: string): J => ({ text: t, program: { targets: [], steps: [draw()] } });
  it('CR 700.2d: a minimum number of modes above the number of options (no repeats) can never be met', () => {
    bad(spell([], [], { modes: { min: 2, max: 2, options: [opt('a')] } }), 'executable-gap');
    clean(spell([], [], { modes: { min: 2, max: 2, options: [opt('a')], allowRepeat: true } }));
    clean(spell([], [], { modes: { min: 1, max: 2, options: [opt('a'), opt('b')] } }));
  });
  it('CR 601.2d: the divided total is the amount of the damage', () => {
    const t = spec('t0', { kind: 'anyTarget', max: 3, divide: { what: 'damage', total: 3 } });
    const dmg = (amount: number): J => ({ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount, divided: 'announced' });
    bad(spell([dmg(5)], [t]), 'bad-divide');
    clean(spell([dmg(3)], [t]));
  });
  it('CR 607.2d: a chosen color is not read as a creature type', () => {
    const producer = ab({ kind: 'static', text: 'x', zone: ['stack', 'battlefield'], effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', choose: [{ what: 'color', link: 'c' }] } }] });
    const consumer = (quality: string): AbilityDef => ab({ kind: 'static', text: 'y', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { chosen: { link: 'c', quality } } }, mods: [{ layer: '7c', power: 1 }] }] });
    expect(codes(validateCardAbilities([{ abilities: [producer, consumer('creatureType')] }]))).toContain('unlinked');
    expect(codes(validateCardAbilities([{ abilities: [producer, consumer('color')] }]))).not.toContain('unlinked');
  });
  it('CR 607.2d: a chosen creature type is read as a subtype, a chosen color as a color, and a type chosen as a color is rejected', () => {
    const producer = (what: string): AbilityDef => ab({ kind: 'static', text: 'x', zone: ['stack', 'battlefield'], effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', choose: [{ what, link: 'c' }] } }] });
    const typeSet = (slot: string): AbilityDef => ab({ kind: 'static', text: 'y', effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 4, [slot]: { add: [], chosen: 'c' } }] }] });
    expect(codes(validateCardAbilities([{ abilities: [producer('creatureType'), typeSet('subtypes')] }]))).not.toContain('unlinked');
    expect(codes(validateCardAbilities([{ abilities: [producer('color'), typeSet('subtypes')] }]))).toContain('unlinked');
    expect(codes(validateCardAbilities([{ abilities: [producer('cardType'), typeSet('types')] }]))).not.toContain('unlinked');
  });
  it('CR 115.1: a player target is not an object, and an object target is not a player', () => {
    bad(spell([{ op: 'gainLife', who: { ref: 'target', id: 't0' }, amount: 1 }], [spec('t0')]), 'executable-gap');
    bad(spell([{ op: 'destroy', what: { ref: 'target', id: 't0' } }], [spec('t0', { kind: 'player', text: 'target player' })]), 'executable-gap');
    clean(spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 1 }], [spec('t0', { kind: 'player', text: 'target player' })]));
    clean(spell([{ op: 'gainLife', who: { ref: 'target', id: 't0' }, amount: 1 }], [spec('t0', { kind: 'anyTarget', text: 'any target' })]));
  });
  it('CR 706: the rows of a die table are inside 1..sides and do not overlap', () => {
    const roll = (table: J[]): AbilityDef => spell([{ op: 'rollDie', who: { ref: 'you' }, sides: 6, table }]);
    bad(roll([{ min: 1, max: 4, do: [draw()] }, { min: 3, max: 6, do: [draw()] }]), 'executable-gap');
    bad(roll([{ min: 1, max: 3, do: [draw()] }, { min: 4, max: 9, do: [draw()] }]), 'executable-gap');
    clean(roll([{ min: 1, max: 3, do: [draw()] }, { min: 4, max: 6, do: [draw()] }]));
  });
  it('CR 107.1: numbers are whole, and counts are not negative', () => {
    bad(spell([draw({ count: 1.5 })]), 'executable-gap', '/effect/steps/0/count');
    bad(spell([{ op: 'createToken', who: { ref: 'you' }, count: -2, token: { name: 'Goblin', types: ['Creature'] } }]), 'executable-gap', '/effect/steps/0/count');
    clean(spell([{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: '7c', power: -2, toughness: 0 }] }] }]));
  });
  it('CR 603.5: the activation event exposes the activated ability for "copy that ability" (Rings of Brighthearth)', () => {
    clean(trigger([{ ev: 'activate', manaAbility: false }], [{ op: 'copy', what: { ref: 'event', role: 'spell' }, result: 'spell', who: { ref: 'you' } }]));
  });
});

describe('CR 614.8, 615: a regeneration body is a shield, so it needs the shield bookkeeping', () => {
  it('a static regeneration (no shield) is rejected', () => {
    bad(ab({ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' }, body: { b: 'regeneration' } }] }), 'executable-gap');
  });
});

describe('the worked examples stay clean under the stricter rules', () => {
  for (const e of EXAMPLES) {
    it(e.name, () => {
      for (const f of e.faces) for (const a of f.abilities) expect(validateAbility(a)).toEqual([]);
    });
  }
});
