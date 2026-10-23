/**
 * WP15's table entries (design 5.2, 15.1 rule 5): the thirteen ops are capabilities because they have a handler here AND a renderer (WP2), every duration form but asLongAs (not judged live, design 3.7) is
 * one because core/durations.ts ends it; the value forms this build does not run stay missing (day, night, the initiative). Renderer acceptance: one ability
 * per op passes the exact render gate (design 6.8) for its Oracle wording, so the parser may produce them.
 */
import { describe, expect, it } from 'vitest';
import { DUR_EVALUATORS } from '../../../src/effects/eval';
import { GAME_HANDLERS } from '../../../src/effects/handlers/game';
import { LASTING_HANDLERS, storableKind } from '../../../src/effects/handlers/lasting';
import { ACTION_MACROS } from '../../../src/keywords/actions';
import { capabilitiesOf, classifyAbility, ENGINE_CAPABILITIES, missingCapabilities } from '../../../src/model';
import { renderGate } from '../../../src/render/gate';
import { RENDERERS } from '../../../src/render/step';
import type { AbilityDef, EffectStep } from '../../../src/types/ability';
import { example } from './support';

const OPS = ['effect', 'delay', 'reflexive', 'extraTurn', 'extraPhase', 'endTurn', 'winGame', 'loseGame', 'createEmblem', 'rollDie', 'flipCoin', 'designate', 'action', 'controlPlayer' /* std-control-3 (CR 723.1) */];

describe('design 5.2: WP15 capabilities', () => {
  it('the fourteen ops have handlers and renderers, so ENGINE_CAPABILITIES has op:<op> for each', () => {
    expect([...Object.keys(LASTING_HANDLERS), ...Object.keys(GAME_HANDLERS)].sort()).toEqual([...OPS].sort());
    for (const op of OPS) {
      expect(Object.hasOwn(RENDERERS, op), op).toBe(true);
      expect(ENGINE_CAPABILITIES.has(`op:${op}`), op).toBe(true);
    }
  });

  it('every Duration form but asLongAs is ended by the engine (dur:<d>), so none of them makes a card manual any more', () => {
    for (const d of ['endOfTurn', 'endOfCombat', 'permanent', 'whileSource', 'until', 'untilNextTurn', 'untilNextStep']) {
      expect(Object.hasOwn(DUR_EVALUATORS, d), d).toBe(true);
      expect(ENGINE_CAPABILITIES.has(`dur:${d}`), d).toBe(true);
    }
  });

  it('design 3.7: asLongAs must be judged live (every time the effect is read); the build judges it only at priority checks, so dur:asLongAs is not advertised', () => {
    expect(Object.hasOwn(DUR_EVALUATORS, 'asLongAs')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('dur:asLongAs')).toBe(false);
  });

  // M6-4 (m6 design 3.6, 7): day and night act on the daybound and nightbound permanents (core/day-night.ts#OP_FORMS); MX4: the initiative ventures into
  // Undercity (core/designations.ts#INITIATIVE_OP_FORMS)
  it('the value forms of day, night (M6-4, CR 702.145) and the initiative (MX4, CR 726.2) are registered', () => {
    const step = (what: 'day' | 'night' | 'initiative' | 'monarch'): AbilityDef => ({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'designate', who: { ref: 'you' }, what }] } });
    expect(missingCapabilities(step('monarch'), ENGINE_CAPABILITIES)).toEqual([]);
    for (const what of ['day', 'night'] as const) {
      expect(capabilitiesOf(step(what))).toContain(`op:designate.${what}`);
      expect(missingCapabilities(step(what), ENGINE_CAPABILITIES)).toEqual([]);
    }
    for (const what of ['initiative'] as const) {
      expect(capabilitiesOf(step(what))).toContain(`op:designate.${what}`);
      expect(missingCapabilities(step(what), ENGINE_CAPABILITIES)).toEqual([]);
    }
  });

  it('CR 706.3a: a results table for several dice or several players needs op:rollDie.multiTable, which is not registered (the handler resolves it by hand)', () => {
    const table = [{ min: 1, max: 6, do: [] }];
    const roll = (extra: Partial<Extract<EffectStep, { op: 'rollDie' }>>): AbilityDef =>
      ({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'rollDie', who: { ref: 'you' }, sides: 6, ...extra }] } });
    expect(missingCapabilities(roll({ count: 2, table }), ENGINE_CAPABILITIES)).toEqual(['op:rollDie.multiTable']);
    expect(missingCapabilities(roll({ who: { ref: 'each', who: 'player' }, table }), ENGINE_CAPABILITIES)).toEqual(['op:rollDie.multiTable']);
    expect(missingCapabilities(roll({ table }), ENGINE_CAPABILITIES)).toEqual([]);
    expect(missingCapabilities(roll({ count: 2 }), ENGINE_CAPABILITIES)).toEqual([]); // no table: the total is the result (Clown Car)
  });

  it('the section 13 abilities made only of WP15 ops and earlier packages\' nodes need nothing more (Giant Growth, Aspect of Hydra, Mutavault, History of Benalia III, Oko +1)', () => {
    const abilities: [string, AbilityDef][] = [
      ['Giant Growth', example('Giant Growth')[0]!],
      ['Aspect of Hydra', example('Aspect of Hydra')[0]!],
      ['Mutavault', example('Mutavault')[1]!],
      ['Oko +1', example('Oko, Thief of Crowns')[1]!],
    ];
    for (const [name, a] of abilities) expect(missingCapabilities(a, ENGINE_CAPABILITIES), name).toEqual([]);
    // a Saga chapter is a structure of its own (CR 714), registered by the package that runs chapters (M6-6: statics/levels.ts), not by the ops in it
    expect(capabilitiesOf(example('History of Benalia')[1]!)).toContain('feature:chapter');
    expect(missingCapabilities(example('History of Benalia')[1]!, ENGINE_CAPABILITIES)).toEqual([]);
  });

  it('the cards that also need other W2 packages miss only those packages\' ops (Sneak Attack: chooseObjects, move, sacrifice; Pact of Negation: counter, pay)', () => {
    const missing = (a: AbilityDef): string[] => missingCapabilities(a, ENGINE_CAPABILITIES).filter((c) => c.startsWith('op:'));
    for (const op of missing(example('Sneak Attack')[0]!)) expect(['op:chooseObjects', 'op:move', 'op:sacrifice']).toContain(op);
    for (const op of missing(example('Pact of Negation')[0]!)) expect(['op:counter', 'op:pay']).toContain(op);
  });
});

describe('design 5.2: a keyword action (op:action) is advertised only when its macro\'s expansion can run', () => {
  const spellOf = (steps: EffectStep[]): AbilityDef => ({ kind: 'spell', text: '', effect: { targets: [], steps } });
  const representative = (action: string): Extract<EffectStep, { op: 'action' }> =>
    ({ op: 'action', action: action as never, who: { ref: 'you' }, subject: { ref: 'target', id: 't0' }, n: 1, arg: '+1/+1' });

  it('action:<name> is in ENGINE_CAPABILITIES exactly when every capability its expansion needs is (CR 701)', () => {
    for (const [name, macro] of Object.entries(ACTION_MACROS)) {
      if (macro!.expand === undefined) { // a native action (WP32): advertised exactly when its handler registers feature:action.native.<name>
        expect(ENGINE_CAPABILITIES.has(`action:${name}`), name).toBe(ENGINE_CAPABILITIES.has(`feature:action.native.${macro!.native}`));
        continue;
      }
      const expansion = spellOf(macro!.expand!(representative(name)));
      expect(ENGINE_CAPABILITIES.has(`action:${name}`), name).toBe(missingCapabilities(expansion, ENGINE_CAPABILITIES).length === 0);
    }
  });

  it.skipIf(storableKind('restrict'))('CR 701.35: "Detain target creature." stays partial while static:restrict is unavailable to the effect handler', () => {
    const detain: AbilityDef = { kind: 'spell', text: 'Detain target creature.', effect: {
      targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }],
      steps: [{ op: 'action', action: 'detain', who: { ref: 'you' }, subject: { ref: 'target', id: 't0' } }],
    } };
    expect(missingCapabilities(detain, ENGINE_CAPABILITIES)).toContain('action:detain');
    expect(classifyAbility(detain, ENGINE_CAPABILITIES).level).not.toBe('full');
  });

  it.skipIf(ENGINE_CAPABILITIES.has('op:createToken'))('CR 701.16a: "Investigate." is not automated while createToken has no handler', () => {
    const investigate = spellOf([{ op: 'action', action: 'investigate', who: { ref: 'you' } }]);
    expect(missingCapabilities(investigate, ENGINE_CAPABILITIES)).toContain('action:investigate');
  });
});

describe('renderer acceptance (design 6.8, the exact gate): one ability per op', () => {
  const CTX = { selfNames: ['Test Card'] };
  const spell = (steps: EffectStep[], targets: AbilityDef extends never ? never : Extract<AbilityDef, { kind: 'spell' }>['effect']['targets'] = []): AbilityDef => ({ kind: 'spell', text: '', effect: { targets, steps } });
  const CASES: [string, AbilityDef][] = [
    ['Take an extra turn after this one.', spell([{ op: 'extraTurn', who: { ref: 'you' }, count: 1 }])],
    ['After this main phase, there is an additional combat phase.', spell([{ op: 'extraPhase', phase: 'combat', after: 'main1' }])],
    ['End the turn.', spell([{ op: 'endTurn' }])],
    ['You win the game.', spell([{ op: 'winGame', who: { ref: 'you' } }])],
    ['You lose the game.', spell([{ op: 'loseGame', who: { ref: 'you' } }])],
    ['Roll a d20.', spell([{ op: 'rollDie', who: { ref: 'you' }, sides: 20 }])],
    ['Flip a coin.', spell([{ op: 'flipCoin', who: { ref: 'you' } }])],
    ['You become the monarch.', spell([{ op: 'designate', who: { ref: 'you' }, what: 'monarch' }])],
    ['Investigate.', spell([{ op: 'action', action: 'investigate', who: { ref: 'you' } }])],
    ['You get an emblem with "Creatures you control get +1/+1."', spell([{ op: 'createEmblem', who: { ref: 'you' }, abilities: [{
      kind: 'static', text: 'Creatures you control get +1/+1.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }],
    }] }])],
    ['Target creature gets +3/+3 until end of turn.', example('Giant Growth')[0]!],
    ['Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don\'t, you lose the game.', example('Pact of Negation')[0]!],
  ];
  it.each(CASES)('%s', (text, def) => {
    const r = renderGate(def, [text], CTX);
    expect(r.ok, `${r.rendered} vs ${r.expected}`).toBe(true);
  });
});
