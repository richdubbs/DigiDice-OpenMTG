/**
 * M5Z review: the hand-built "equivalent" cards of the CR example suite (helpers.ts#equivalent) must be abilities the engine accepts as data: schema and
 * lint (`validateAbility`, design 12.1) with no issue. They are NOT what the compiler produces for the example's wording: the render gate (G6) rejects all
 * but Grounded's, which is why each test says "hand-built JSON of the same behavior".
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/index';
import { equivalent } from './helpers';

describe('equivalent cards are validated (design 12.1: schema and lint)', () => {
  it('an equivalent ability with a schema error is refused, never run as a full card', () => {
    const bad = [{ kind: 'static', text: 'Broken.', effects: [{ s: 'continuous', affects: { ref: 'nonsense' }, mods: [] }] }] as unknown as AbilityDef[];
    expect(() => equivalent({ name: 'Broken Card', type_line: 'Enchantment' }, bad)).toThrow(/validateAbility/);
  });

  it('a valid equivalent ability is accepted and the card is full', () => {
    const ok = [{ kind: 'static', text: 'Cards in graveyards lose all abilities.', effects: [{ s: 'continuous', affects: { ref: 'each', filter: { zone: 'graveyard', isCard: true } }, mods: [{ layer: 6, removeAll: true }] }] }] as AbilityDef[];
    expect(equivalent({ name: 'Yixlid Jailer', type_line: 'Creature — Zombie Wizard' }, ok).automation.level).toBe('full');
  });
});
