/**
 * FAST5X E8: the board shows which doors of a Room are unlocked (CR 709.5c) as a status line of the permanent, like a Case's "Solved"; both players see it (a
 * designation of a permanent is public information).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type OracleCard } from '@openmtg/engine';
import { statusLines } from '../../src/cards/objectStatus';
import { find, scenario, tweak } from '../prompts/harness';

const ROOM = compileCard({
  name: 'Test Study // Test Gallery', layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: '{W} // {2}{W}', colors: [],
  card_faces: [
    { name: 'Test Study', type_line: 'Enchantment — Room', mana_cost: '{W}', oracle_text: 'When you unlock this door, you gain 3 life.' },
    { name: 'Test Gallery', type_line: 'Enchantment — Room', mana_cost: '{2}{W}', oracle_text: 'Creatures you control get +1/+0.' },
  ],
} as unknown as OracleCard);

describe('CR 709.5c: the doors of a Room', () => {
  it('lists each door as locked or unlocked, and "Fully unlocked" once both are, for both players', () => {
    const s0 = scenario([], { defs: [ROOM], p1: { battlefield: [ROOM.name] } });
    const id = find(s0, ROOM.name, 'battlefield');
    const line = (s: typeof s0, p: 'p1' | 'p2') => statusLines(viewFor(s, p), viewFor(s, p).objects[id]!).find((l) => l.key === 'room');
    expect(line(s0, 'p1')?.text).toBe('Test Study locked, Test Gallery locked');
    const one = tweak(s0, (t) => { t.objects[id]!.unlocked = [1]; });
    for (const p of ['p1', 'p2'] as const) {
      expect(line(one, p)?.text, p).toBe('Test Study locked, Test Gallery unlocked');
      expect(line(one, p)?.rule, p).toMatch(/CR 709\.5/);
    }
    const both = tweak(s0, (t) => { t.objects[id]!.unlocked = [0, 1]; });
    expect(line(both, 'p2')?.text).toBe('Fully unlocked');
  });
});
