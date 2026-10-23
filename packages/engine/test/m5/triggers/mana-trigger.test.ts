/**
 * WP8 review fix, completed by WP32: a triggered mana ability (CR 605.1b, 605.4a) never uses the stack. Since WP32 it resolves at once, right after the mana
 * ability that triggered it (triggers/mana-now.ts, effects/mana-now.ts), so `feature:trigger.mana` is advertised; the other triggers below are no mana
 * abilities and keep going on the stack. More scenarios (payment, delayed, event player): wp32-mana-trigger.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { EffectStep, TriggeredAbilityDef } from '../../../src/index';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { triggerForms } from '../../../src/triggers/forms';
import { trig, vanilla } from './cards';
import { act, find, gameOf, move, scenario, settle, stackAbilities, synth } from './helpers';

const addG: EffectStep = { op: 'addMana', who: { ref: 'you' }, units: [['G']] };
const manaFlare = synth({
  name: 'Test Mana Flare', cost: '{2}{R}', type: 'Artifact',
  abilities: [trig('Whenever a player taps a land for mana, that player adds an additional {G}.', [{ ev: 'activate', source: { types: ['Land'] }, manaAbility: true }], { steps: [addG] })],
});
/** Not a mana ability: it does not add mana. */
const manabarbs = synth({
  name: 'Test Manabarbs', cost: '{2}{R}', type: 'Enchantment',
  abilities: [trig('Whenever a player taps a land for mana, ~ deals 1 damage to that player.', [{ ev: 'activate', source: { types: ['Land'] }, manaAbility: true }], { steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] })],
});
/** Has a target: not a mana ability (CR 605.1b), it goes on the stack. */
const targeted = synth({
  name: 'Test Targeted Mana', cost: '{2}', type: 'Artifact',
  abilities: [trig('Whenever you tap a land for mana, target player adds {G}.', [{ ev: 'activate', source: { types: ['Land'] }, manaAbility: true }], {
    targets: [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }], steps: [{ op: 'addMana', who: { ref: 'target', id: 't0' }, units: [['G']] }],
  })],
});
/** Triggers from something that is not a mana ability: an ordinary trigger, although it adds mana. */
const landfall = synth({
  name: 'Test Landfall Mana', cost: '{2}', type: 'Enchantment',
  abilities: [trig('Whenever a creature enters, you add {G}.', [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }], { steps: [addG] })],
});
const defs = [manaFlare, manabarbs, targeted, landfall, vanilla()];
const def = (c: ReturnType<typeof synth>): TriggeredAbilityDef => c.faces[0]!.abilities[0] as TriggeredAbilityDef;

describe('CR 605.1b, 605.4a: a triggered mana ability does not go on the stack', () => {
  const tapForest = (card: string) => {
    const s0 = scenario(['Forest'], { defs, p1: { battlefield: ['Forest', card] } });
    return act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Forest', 'battlefield'), ability: 'r:basic:G' });
  };

  it('Mana Flare: tapping a land for mana triggers it, it is not stacked, and it resolves at once: the extra {G} is in the pool (CR 605.4a)', () => {
    const s = tapForest('Test Mana Flare');
    expect(stackAbilities(s)).toEqual([]);
    expect(s.pendingTriggers).toEqual([]);
    expect(s.players[0]!.manaPool.map((u) => u.type)).toEqual(['G', 'G']);
    expect(s.log.filter((x) => x.level === 'manual')).toEqual([]);
    const l = s.log.filter((x) => x.rules?.includes('CR 605.4a'));
    expect(l).toHaveLength(1);
    expect(l[0]!.text).toContain('Test Mana Flare');
  });

  it('control: a trigger from a mana ability that adds no mana is an ordinary triggered ability and goes on the stack', () => {
    expect(stackAbilities(tapForest('Test Manabarbs')).map((a) => a.source)).toEqual(['Test Manabarbs']);
  });

  it('control: a trigger with a target is not a mana ability (CR 605.1b) and is announced as usual', () => {
    const s0 = scenario(['Forest'], { defs, p1: { battlefield: ['Forest', 'Test Targeted Mana'] } });
    const g = gameOf(s0, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }]);
    g.emit({ type: 'manaAdded', player: 'p1', mana: ['G'], sourceId: find(s0, 'Forest', 'battlefield'), viaActivation: true });
    expect(stackAbilities(settle(g))).toMatchObject([{ source: 'Test Targeted Mana', targets: ['p1'] }]);
  });

  it('control: an ability that adds mana but triggers from an ordinary event is not a mana ability (CR 605.1a-b)', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Landfall Mana'], hand: ['Test Vanilla'] } });
    const g = gameOf(s0);
    move(g, find(s0, 'Test Vanilla', 'hand', 'p1'), 'battlefield', { cause: 'resolve' });
    expect(stackAbilities(settle(g)).map((a) => a.source)).toEqual(['Test Landfall Mana']);
  });
});

describe('design 5.2: a triggered mana ability needs feature:trigger.mana, advertised since WP32 resolves it without the stack', () => {
  it('triggerForms names it from the definition', () => {
    expect(triggerForms(def(manaFlare))).toEqual(['feature:trigger.mana']);
    expect(triggerForms(def(manabarbs))).toEqual([]);
    expect(triggerForms(def(targeted))).toEqual([]);
    expect(triggerForms(def(landfall))).toEqual([]);
    expect(ENGINE_CAPABILITIES.has('feature:trigger.mana')).toBe(true);
  });
});
