/**
 * WP17: the ten lowering passes of design 6.5, one by one, on drafts shaped like the chart's output (markers included). Every pass is pure: the input is
 * deep-frozen, so a pass that edits it throws.
 */
import { describe, expect, it } from 'vitest';
import type { EventPattern } from '../../../src/types/ability';
import {
  lowerAnaphora, lowerConditions, lowerDurations, lowerNormalize, lowerOptionality, lowerProgram, lowerQuantities, lowerRiders, lowerScope, lowerSequencing, lowerTargets,
} from '../../../src/parser/lower';
import { mergePatch } from '../../../src/parser/lower/riders';
import { substituteX } from '../../../src/parser/lower/quantities';
import type { Draft } from '../../../src/parser/lower/types';
import { A, NUM, T, creature, draft, freeze, unit } from './support';

const player = (text = 'target player'): Record<string, unknown> => ({ kind: 'player', players: { who: 'any' }, min: 1, max: 1, text });
const steps = (d: Draft, i = 0): unknown[] => d.units[i]!.steps;

describe('WP17 pass 1, scope: the trigger seeds the discourse model (design 6.4, 3.5)', () => {
  const zc: EventPattern = { ev: 'zoneChange', subject: { self: true }, from: 'battlefield', to: 'graveyard' };
  it('CR 603.6: a zone change exposes its subject (a card in its new zone), its player and an amount', () => {
    const d = lowerScope(freeze(draft([], { trigger: { on: [zc] }, selfHeads: ['creature', 'elf'] })));
    const subject = d.mentions.find((m) => (m.ref as { role?: string }).role === 'subject')!;
    expect(subject).toMatchObject({ sort: 'object', number: 'singular', origin: 'event' });
    expect(subject.heads).toEqual(expect.arrayContaining(['creature', 'elf', 'card']));
    expect(subject.verbs).toContain('died');
    // LNK1 (CR 603.3a): the player of the object's OWN zone change controls the ability: "you", never "that player" (no player mention)
    expect(d.mentions.some((m) => m.sort === 'player' && (m.ref as { role?: string }).role === 'player')).toBe(false);
    // merge wave 8 (audit D2, CR 603.2c, 608.2c): the object itself moving is one event about one object, whose amount is always 1: no number for "that many"
    expect(d.mentions.some((m) => m.sort === 'number')).toBe(false);
    // another object's zone change exposes its player ("Whenever a creature dies, that player ...": its controller)
    const other = lowerScope(freeze(draft([], { trigger: { on: [{ ...zc, subject: { types: ['Creature'] } }] }, selfHeads: ['creature', 'elf'] })));
    expect(other.mentions.some((m) => m.sort === 'player' && (m.ref as { role?: string }).role === 'player')).toBe(true);
    expect(other.mentions.some((m) => m.sort === 'number')).toBe(true); // ... and an amount (CR 603.6)
  });
  it('CR 603.2: a disjunction of events exposes only the roles every pattern exposes', () => {
    const d = lowerScope(draft([], { trigger: { on: [zc, { ev: 'cast', player: 'you' }] } }));
    expect(d.mentions.map((m) => (m.ref as { role?: string }).role)).toEqual(['player']);
  });
  it('CR 603.2c: a "one or more" trigger makes its subject plural', () => {
    const d = lowerScope(draft([], { trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }], batch: true } }));
    expect(d.mentions.find((m) => m.sort === 'object')!.number).toBe('plural');
  });
  it('no trigger: no event mentions', () => {
    expect(lowerScope(draft([])).mentions).toEqual([]);
  });
});

describe('WP17 pass 2, targets (CR 115.1, 601.2c, 608.2b)', () => {
  it('numbers target phrases in WORD order, whatever the order of the template build', () => {
    const u = unit(0, 'target creature deals damage to target player', [{ op: 'x', to: T(player()), from: T(creature()) }]);
    const d = lowerTargets(freeze(draft([u])));
    expect(d.targets.map((t) => [t.id, t.kind])).toEqual([['t0', 'object'], ['t1', 'player']]);
    expect(steps(d)).toEqual([{ op: 'x', to: { ref: 'target', id: 't1' }, from: { ref: 'target', id: 't0' } }]);
    expect(d.units[0]!.targetIds).toEqual(['t0', 't1']);
  });
  it('CR 608.2b: ids are unique across the WHOLE ability, modal bullets included (Cryptic Command is t0 and t1)', () => {
    const d = lowerTargets(draft([], { modes: { min: 2, max: 2, options: [
      { text: 'a', units: [unit(0, 'counter target spell', [{ op: 'counter', what: T({ kind: 'spell', min: 1, max: 1, text: 'target spell' }) }])] },
      { text: 'b', units: [unit(1, 'destroy target creature', [{ op: 'destroy', what: T(creature()) }])] },
    ] } }));
    expect(d.targets.map((t) => t.id)).toEqual(['t0', 't1']);
    expect(d.modes!.options[1]!.units[0]!.steps).toEqual([{ op: 'destroy', what: { ref: 'target', id: 't1' } }]);
  });
  it('CR 601.2c: "up to two target creatures" is one spec min 0 max 2; the prompt text starts in lower case', () => {
    const d = lowerTargets(draft([unit(0, 'Tap up to two target creatures', [{ op: 'tap', what: T(creature('up to two target creatures', 0, 2)) }])]));
    expect(d.targets).toEqual([{ id: 't0', kind: 'object', min: 0, max: 2, text: 'up to two target creatures', filter: { types: ['Creature'] } }]);
  });
  it('CR 115.3: "another target" differs from the earlier targets; with none it means "other than this object"', () => {
    const two = lowerTargets(draft([unit(0, 'target creature and another target creature', [{ op: 'x', a: T(creature()), b: T({ ...creature('another target creature'), another: true }) }])]));
    expect(two.targets[1]!.distinctFrom).toEqual(['t0']);
    // (an ability of a creature: "other than this object" can exclude something, CR 109.2; WP21 review)
    const one = lowerTargets(draft([unit(0, 'exile another target creature', [{ op: 'move', what: T({ ...creature('another target creature'), another: true }) }])], { selfHeads: ['creature', 'spirit'] }));
    expect(one.targets[0]!.filter).toEqual({ types: ['Creature'], other: true });
    // on an instant the source is never a creature: "another" would exclude nothing, so the sentence is manual and announces no target (WP21 review)
    const spell = lowerTargets(draft([unit(0, 'exile another target creature', [{ op: 'move', what: T({ ...creature('another target creature'), another: true }) }])]));
    expect(spell.targets).toEqual([]);
    expect(spell.units[0]!.manual?.reason).toMatch(/CR 109\.2/);
  });
  it('one phrase used twice by a build is ONE target', () => {
    const ph = creature();
    const d = lowerTargets(draft([unit(0, 'target creature gets +1/+1 and gains flying', [{ op: 'a', what: T(ph) }, { op: 'b', what: T(ph) }])]));
    expect(d.targets).toHaveLength(1);
    expect(steps(d)).toEqual([{ op: 'a', what: { ref: 'target', id: 't0' } }, { op: 'b', what: { ref: 'target', id: 't0' } }]);
  });
  it('CR 601.2c: a target inside "if this spell was kicked" is required only then (onlyIf)', () => {
    const kicked = { cond: 'wasCast', kicked: true };
    const d = lowerTargets(draft([unit(0, 'if ~ was kicked , destroy target creature', [{ op: 'if', cond: kicked, then: [{ op: 'destroy', what: T(creature()) }] }])]));
    expect(d.targets[0]!.onlyIf).toEqual(kicked);
  });
  it('CR 601.2d: a divided damage step marks its spec with the total', () => {
    const d = lowerTargets(draft([unit(0, '~ deals 5 damage divided as you choose among any number of targets', [{ op: 'damage', source: { ref: 'self' }, amount: 5, divided: 'announced', to: T({ kind: 'anyTarget', min: 1, max: 'any', text: 'any number of targets' }) }])]));
    expect(d.targets[0]!.divide).toEqual({ what: 'damage', total: 5 });
  });
  it('a phrase that cannot be placed in the sentence makes it manual, never a guess', () => {
    const d = lowerTargets(draft([unit(0, 'destroy it', [{ op: 'destroy', what: T(creature()) }])]));
    expect(d.units[0]!.manual?.code).toBe('ambiguous');
    expect(d.targets).toEqual([]);
  });
});

describe('WP17 pass 3, anaphora: the unique-candidate rule (design 6.4)', () => {
  it('one compatible candidate: "it" becomes the target', () => {
    const d = lowerAnaphora(lowerTargets(freeze(draft([
      unit(0, 'tap target creature', [{ op: 'tap', what: T(creature()) }]),
      unit(1, 'untap it', [{ op: 'untap', what: A({ sort: 'object', number: 'singular', text: 'it' }) }]),
    ]))));
    expect(steps(d, 1)).toEqual([{ op: 'untap', what: { ref: 'target', id: 't0' } }]);
  });
  it('design 3.1 rule 4 (WP21): "it" acting on a target an earlier step MOVED is the moving step\'s binding (a target handle never re-bases, CR 400.7)', () => {
    const d = lowerAnaphora(lowerTargets(freeze(draft([
      unit(0, 'exile target creature', [{ op: 'move', what: T(creature()), to: { zone: 'exile' } }]),
      unit(1, 'return it', [{ op: 'move', what: A({ sort: 'object', number: 'singular', text: 'it' }), to: { zone: 'hand' } }]),
    ]))));
    expect(steps(d, 0)).toEqual([{ op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'moved' }]);
    expect(steps(d, 1)).toEqual([{ op: 'move', what: { ref: 'bound', name: 'moved' }, to: { zone: 'hand' } }]);
  });
  it('a set produced by a step is named with `as` and referenced as bound', () => {
    const d = lowerAnaphora(draft([
      unit(0, 'exile all creatures', [{ op: 'move', what: { ref: 'each', filter: { types: ['Creature'] } }, to: { zone: 'exile' } }]),
      unit(1, 'return them', [{ op: 'move', what: A({ sort: 'set', number: 'plural', text: 'them' }), to: { zone: 'battlefield', controller: 'owner' } }]),
    ]));
    const name = (steps(d, 0)[0] as { as: string }).as;
    expect(typeof name).toBe('string');
    expect(steps(d, 1)).toEqual([{ op: 'move', what: { ref: 'bound', name }, to: { zone: 'battlefield', controller: 'owner' } }]);
  });
  it('the participle must match: "the exiled card" needs a mention that was exiled', () => {
    const d = lowerAnaphora(lowerTargets(draft([
      unit(0, 'destroy target creature', [{ op: 'destroy', what: T(creature()) }]),
      unit(1, 'return the exiled card', [{ op: 'move', what: A({ sort: 'object', number: 'singular', head: 'card', participle: 'exiled', text: 'the exiled card' }), to: { zone: 'hand' } }]),
    ])));
    expect(d.units[1]!.manual).toMatchObject({ code: 'unbound-reference', unresolved: true });
  });
});

describe('WP17 pass 4, riders (CR 608.2c, 614.15)', () => {
  it('merges into the previous step of the attachTo op', () => {
    const d = lowerRiders(freeze(draft([
      unit(0, 'destroy target creature', [{ op: 'destroy', what: { ref: 'target', id: 't0' } }]),
      unit(1, "it can't be regenerated", [], { rider: { patch: { regeneration: 'cant' }, attachTo: 'destroy', template: 'rid.noregen' } }),
    ])));
    expect(steps(d)).toEqual([{ op: 'destroy', what: { ref: 'target', id: 't0' }, regeneration: 'cant' }]);
    expect(d.units[1]!.steps).toEqual([]);
    expect(d.units[1]!.manual).toBeUndefined();
  });
  it('a rider whose predecessor is another op, or that has none, is manual', () => {
    const wrong = lowerRiders(draft([unit(0, 'draw a card', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]), unit(1, "it can't be regenerated", [], { rider: { patch: { regeneration: 'cant' }, attachTo: 'destroy', template: 'r' } })]));
    expect(wrong.units[1]!.manual?.code).toBe('no-template');
    const none = lowerRiders(draft([unit(0, "it can't be regenerated", [], { rider: { patch: { regeneration: 'cant' }, attachTo: 'destroy', template: 'r' } })]));
    expect(none.units[0]!.manual?.code).toBe('no-template');
  });
  it('merge semantics: objects merge, arrays of objects merge by index, null deletes, other values replace', () => {
    const step = { op: 'effect', effects: [{ s: 'continuous', mods: [{ layer: 4, types: { set: ['Creature'] } }, { layer: '7b', power: 2 }] }] };
    expect(mergePatch(step, { effects: [{ mods: [{ types: { set: null, add: ['Creature'] } }] }] })).toEqual({
      op: 'effect', effects: [{ s: 'continuous', mods: [{ layer: 4, types: { add: ['Creature'] } }, { layer: '7b', power: 2 }] }],
    });
    expect(mergePatch({ to: { zone: 'graveyard' } }, { to: { zone: 'library', position: 'top' } })).toEqual({ to: { zone: 'library', position: 'top' } });
  });
});

describe('WP17 pass 5, quantities (CR 608.2h)', () => {
  it('"where X is ..." substitutes the quantity for every {q:X} of the sentence', () => {
    const count = { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } };
    const d = lowerQuantities(freeze(draft([unit(0, 'draw x cards , where x is the number of elves you control', [{ lower: 'whereX', value: count, steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'X' } }] }])])));
    expect(steps(d)).toEqual([{ op: 'draw', who: { ref: 'you' }, count }]);
    expect(substituteX({ q: 'math', op: '+', args: [{ q: 'X' }, 1] }, 2)).toEqual({ q: 'math', op: '+', args: [2, 1] });
  });
  it('"that much" is the event amount of the trigger (CR 603.4 context)', () => {
    const d = lowerQuantities(lowerScope(draft([unit(0, 'you gain that much life', [{ op: 'gainLife', who: { ref: 'you' }, amount: NUM('that much') }])], { trigger: { on: [{ ev: 'damage', source: { self: true } }] } })));
    expect(steps(d)).toEqual([{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'eventAmount' } }]);
  });
  it('"that many" is the result count of the one earlier countable step', () => {
    const d = lowerQuantities(draft([unit(0, 'discard two cards', [{ op: 'discard', who: { ref: 'you' }, count: 2 }]), unit(1, 'draw that many cards', [{ op: 'draw', who: { ref: 'you' }, count: NUM('that many') }])]));
    const name = (steps(d, 0)[0] as { as: string }).as;
    expect(steps(d, 1)).toEqual([{ op: 'draw', who: { ref: 'you' }, count: { q: 'resultCount', step: name } }]);
  });
  it('two candidate amounts: manual', () => {
    const d = lowerQuantities(lowerScope(draft([unit(0, 'discard two cards', [{ op: 'discard', who: { ref: 'you' }, count: 2 }]), unit(1, 'draw that many cards', [{ op: 'draw', who: { ref: 'you' }, count: NUM('that many') }])], { trigger: { on: [{ ev: 'life', change: 'gain', player: 'you' }] } })));
    expect(d.units[1]!.manual).toMatchObject({ code: 'unbound-reference', unresolved: true });
  });
});

describe('WP17 pass 6, durations (CR 611.2a)', () => {
  const eff = (duration?: unknown): Record<string, unknown> => ({ op: 'effect', effects: [], ...(duration ? { duration } : {}) });
  it('a duration attaches to every continuous effect of its sentence', () => {
    const d = lowerDurations(freeze(draft([unit(0, 'x', [eff(), eff({ d: 'endOfTurn' })])])));
    expect(steps(d)).toEqual([eff({ d: 'endOfTurn' }), eff({ d: 'endOfTurn' })]);
  });
  it('CR 611.2a: no stated duration on a resolved continuous effect means it lasts indefinitely', () => {
    expect(steps(lowerDurations(draft([unit(0, 'x', [eff()])])))).toEqual([eff({ d: 'permanent' })]);
  });
  it('two different durations and a clause without one: ambiguous, manual', () => {
    expect(lowerDurations(draft([unit(0, 'x', [eff(), eff({ d: 'endOfTurn' }), eff({ d: 'endOfCombat' })])])).units[0]!.manual?.code).toBe('ambiguous');
  });
});

describe('WP17 pass 7, conditions (CR 118.12, 608.2d)', () => {
  const did = (not = false): Record<string, unknown> => ({ cond: 'did', step: '', $step: 'previous', ...(not ? { not: true } : {}) });
  it('"if you do" names the previous may step', () => {
    const d = lowerConditions(freeze(draft([
      unit(0, 'you may draw a card', [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }]),
      unit(1, 'if you do , discard a card', [{ op: 'if', cond: did(), then: [{ op: 'discard', who: { ref: 'you' }, count: 1 }] }]),
    ])));
    const name = (steps(d, 0)[0] as { as: string }).as;
    expect(steps(d, 1)).toEqual([{ op: 'if', cond: { cond: 'did', step: name }, then: [{ op: 'discard', who: { ref: 'you' }, count: 1 }] }]);
  });
  it('CR 118.12: "may pay ... If they don\'t, X" folds into the pay step (Smothering Tithe form)', () => {
    const d = lowerConditions(draft([
      unit(0, 'that player may pay {2}', [{ op: 'pay', who: { ref: 'event', role: 'player' }, cost: { mana: [{ kind: 'generic', amount: 2 }] } }]),
      unit(1, "if they don't , you gain 1 life", [{ op: 'if', cond: did(true), then: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] }]),
    ]));
    expect(steps(d, 0)).toEqual([{ op: 'pay', who: { ref: 'event', role: 'player' }, cost: { mana: [{ kind: 'generic', amount: 2 }] }, else: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] }]);
    expect(steps(d, 1)).toEqual([]);
  });
  it('"if you do" with no optional step before it is manual', () => {
    const d = lowerConditions(draft([unit(0, 'if you do , draw a card', [{ op: 'if', cond: did(), then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }])]));
    expect(d.units[0]!.manual?.code).toBe('unbound-reference');
  });
});

describe('WP17 pass 8, optionality (design 1.1.3: no default actor)', () => {
  it('a may without a chooser is manual; with one it is kept', () => {
    expect(lowerOptionality(freeze(draft([unit(0, 'x', [{ op: 'may', do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }])]))).units[0]!.manual?.code).toBe('lint');
    expect(lowerOptionality(draft([unit(0, 'x', [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }])])).units[0]!.manual).toBeUndefined();
  });
});

describe('WP17 passes 9 and 10, sequencing and normalize (CR 608.2c)', () => {
  it('steps in text order, a manual sentence as one manual step in place', () => {
    const p = lowerSequencing(freeze(draft([
      unit(0, 'draw a card', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]),
      unit(1, 'do something odd', [], { manual: { code: 'no-template', reason: 'no template' } }),
      unit(2, 'draw a card', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]),
    ])));
    expect(p.main.steps.map((s) => s.op)).toEqual(['draw', 'manual', 'draw']);
    expect(p.main.steps[1]).toEqual({ op: 'manual', text: 'do something odd', reason: 'no template' });
    expect(p.main.stepUnits).toEqual([0, 1, 2]);
  });
  it('normalize: a surviving marker or an unstated zone makes the sentence manual', () => {
    const p = lowerNormalize(lowerSequencing(draft([
      unit(0, 'x', [{ op: 'destroy', what: A({ sort: 'object', number: 'singular', text: 'it' }) }]),
      unit(1, 'y', [{ op: 'draw', who: { ref: 'you' }, count: 1 }], { flags: ['zone-unstated'] }),
      unit(2, 'z', [{ op: 'draw', who: { ref: 'you' }, count: 1 }]),
    ])));
    expect(p.main.steps.map((s) => s.op)).toEqual(['manual', 'manual', 'draw']);
  });
  it('lowerProgram runs the ten passes in order and is pure', () => {
    const d = freeze(draft([unit(0, 'destroy target creature', [{ op: 'destroy', what: T(creature()) }]), unit(1, "it can't be regenerated", [], { rider: { patch: { regeneration: 'cant' }, attachTo: 'destroy', template: 'r' } })]));
    const { program } = lowerProgram(d);
    expect(program.targets.map((t) => t.id)).toEqual(['t0']);
    expect(program.main.steps).toEqual([{ op: 'destroy', what: { ref: 'target', id: 't0' }, regeneration: 'cant' }]);
  });
});
