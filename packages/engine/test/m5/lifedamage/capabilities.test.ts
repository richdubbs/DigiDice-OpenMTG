/**
 * WP12 table entries and renderer acceptance (design 5.2, 15.2): each of the eight ops has a handler AND a renderer, so `op:<op>` is an engine
 * capability; the renderer prints each op back to its Oracle wording (the exact render gate, guard G6, accepts it); and the spell abilities of the
 * section 13 cards that use these ops now need nothing the engine lacks.
 */
import { describe, expect, it } from 'vitest';
import { COUNTERS_HANDLERS } from '../../../src/effects/handlers/counters';
import { LIFEDAMAGE_HANDLERS } from '../../../src/effects/handlers/lifedamage';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { ENGINE_CAPABILITIES, missingCapabilities, renderGate } from '../../../src/index';
import type { AbilityDef, EffectStep, TargetSpec } from '../../../src/index';
import { RENDERERS } from '../../../src/render/step';
import { EXAMPLES } from '../model/examples';

const OPS = ['damage', 'gainLife', 'loseLife', 'setLife', 'fight', 'putCounters', 'removeCounters', 'moveCounters'] as const;

describe('WP12 table entries (design 5.2)', () => {
  it('the two family tables hold exactly the eight ops of design 15.2, and the aggregator spreads them', () => {
    expect(Object.keys(LIFEDAMAGE_HANDLERS).sort()).toEqual(['damage', 'fight', 'gainLife', 'loseLife', 'setLife']);
    expect(Object.keys(COUNTERS_HANDLERS).sort()).toEqual(['moveCounters', 'putCounters', 'removeCounters']);
    for (const op of OPS) expect(OP_HANDLERS[op], op).toBeTypeOf('function');
  });

  it.each(OPS)('op:%s is a capability: it has a handler and a renderer', (op) => {
    expect(Object.hasOwn(RENDERERS, op)).toBe(true);
    expect(ENGINE_CAPABILITIES.has(`op:${op}`)).toBe(true);
  });
});

const target = (id: string, text: string, kind: TargetSpec['kind'] = 'object', filter: TargetSpec['filter'] = { types: ['Creature'] }): TargetSpec =>
  ({ id, kind, min: 1, max: 1, text, ...(kind === 'player' ? {} : { filter }) });
const spell = (steps: EffectStep[], targets: TargetSpec[] = []): AbilityDef => ({ kind: 'spell', text: 'x', effect: { targets, steps } });
const CREATURE = target('t0', 'target creature');

/** One sentence per op form, as Oracle text writes it. */
const SENTENCES: [string, AbilityDef][] = [
  ['Test Spell deals 1 damage to each creature.', spell([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'each', filter: { types: ['Creature'] } }, amount: 1 }])],
  ['You gain 3 life.', spell([{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }])],
  ['Each player loses 2 life.', spell([{ op: 'loseLife', who: { ref: 'each', who: 'player' }, amount: 2 }])],
  ["Target player's life total becomes 10.", spell([{ op: 'setLife', who: { ref: 'target', id: 't0' }, value: 10 }], [target('t0', 'target player', 'player')])],
  ["Target creature you control fights target creature you don't control.", spell([{ op: 'fight', a: { ref: 'target', id: 't0' }, b: { ref: 'target', id: 't1' } }],
    [target('t0', 'target creature you control', 'object', { types: ['Creature'], controller: 'you' }), target('t1', "target creature you don't control", 'object', { types: ['Creature'], not: { controller: 'you' } })])],
  ['Put two +1/+1 counters on target creature.', spell([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 2 }], [CREATURE])],
  ['Remove a +1/+1 counter from target creature.', spell([{ op: 'removeCounters', from: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 1 }], [CREATURE])],
  ['Remove all counters from target creature.', spell([{ op: 'removeCounters', from: { ref: 'target', id: 't0' }, kind: 'any', count: 'all' }], [CREATURE])],
  ['Move all +1/+1 counters from target creature onto target creature.', spell([{ op: 'moveCounters', from: { ref: 'target', id: 't0' }, to: { ref: 'target', id: 't1' }, kind: '+1/+1', count: 'all' }], [CREATURE, target('t1', 'target creature')])],
];

describe('renderer acceptance (guard G6): every WP12 op renders back to its Oracle wording', () => {
  it.each(SENTENCES)('%s', (oracle, def) => {
    const r = renderGate(def, [oracle], { selfNames: ['Test Spell'] });
    expect(r.ok, `rendered: ${r.rendered}\nexpected: ${r.expected}`).toBe(true);
  });

  it('a wrong amount is rejected (the gate is exact)', () => {
    expect(renderGate(SENTENCES[1]![1], ['You gain 4 life.'], { selfNames: ['Test Spell'] }).ok).toBe(false);
  });
});

describe('the section 13 abilities that become capability-complete with WP12 (every one is resolved in cards.test.ts and integration.test.ts)', () => {
  it.each([['Blood Artist', 0], ['Flametongue Kavu', 0], ['Mana Vault', 1]] as const)('%s: triggered ability #%i needs nothing the engine lacks (its effect uses only WP12 ops)', (name, index) => {
    const ex = EXAMPLES.find((e) => e.name === name)!;
    const trigger = ex.faces[0]!.abilities.filter((a) => a.kind === 'triggered')[index]!;
    expect(missingCapabilities(trigger, ENGINE_CAPABILITIES)).toEqual([]);
  });
});

describe('the section 13 cards that use these ops need nothing the engine lacks in their spell abilities', () => {
  const cases: [string, number][] = [['Lightning Bolt', 0], ['Fireball', 0], ['Fire // Ice', 0], ['Rabid Bite', 0]];
  it.each(cases)('%s (face %i)', (name, face) => {
    const ex = EXAMPLES.find((e) => e.name === name)!;
    const spellAbility = ex.faces[face]!.abilities.find((a) => a.kind === 'spell')!;
    expect(missingCapabilities(spellAbility, ENGINE_CAPABILITIES)).toEqual([]);
    const self = name.split(' // ')[face]!;
    expect(renderGate(spellAbility, [spellAbility.text!.replace('~', self)], { selfNames: [self, name] }).ok).toBe(true);
  });

  it('Fireball as a whole is automated once WP16 merged: its cost increase is a static cost modifier (CR 601.2f; cast in cards.test.ts)', () => {
    const ex = EXAMPLES.find((e) => e.name === 'Fireball')!;
    const missing = ex.faces[0]!.abilities.flatMap((a) => missingCapabilities(a, ENGINE_CAPABILITIES));
    expect(missing).toEqual([]);
  });
});
