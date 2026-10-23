/**
 * r5-cost: the quantity "the greatest number of creatures you control that have a creature type in common" (`mostSharingCreatureType`, effects/eval.ts) in a mana
 * ability, played with synthetic cards (design 6.10).
 *
 *   CR 205.3m, 702.73a, 106.1   X is the size of the largest group of your creatures sharing one creature type, a changeling (every creature type) in every group;
 *                               the mana is X of one color the player chooses (CR 605.1a: a mana ability)
 */
import { describe, expect, it } from 'vitest';
import { act, activations, card, drive, full, pool, scenario } from './support';

const TILE = card('Test Lotus Tile', 'Artifact', '{T}: Add X mana of any one color, where X is the greatest number of creatures you control that have a creature type in common.', '{0}');
const ELF_WARRIOR = card('Test Elf Warrior', 'Creature — Elf Warrior', '', '{0}', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', '{0}', ['1', '1']);
const GOBLIN_WARRIOR = card('Test Goblin Warrior', 'Creature — Goblin Warrior', '', '{0}', ['1', '1']);
const SHAPER = card('Test Shapeshifter', 'Creature — Shapeshifter', 'Changeling', '{0}', ['1', '1']);
const DEFS = [TILE, ELF_WARRIOR, ELF, GOBLIN_WARRIOR, SHAPER];

describe('r5-cost: the most creatures sharing a creature type', () => {
  it('the card is automated', () => expect(full(TILE)).toBe(true));

  it('CR 205.3m: Elves 2, Warriors 2, Goblin 1, and a changeling in each: X = 3', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Lotus Tile', 'Test Elf Warrior', 'Test Elf', 'Test Goblin Warrior', 'Test Shapeshifter'] } });
    const s = drive(act(s0, activations(s0, 'Test Lotus Tile', true)[0]!.action), { colors: ['G'] });
    expect(pool(s, 'p1')).toBe('GGG');
  });

  it('CR 205.3m: no creatures: X = 0, no mana', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Lotus Tile'] } });
    const s = drive(act(s0, activations(s0, 'Test Lotus Tile', true)[0]!.action), { colors: ['G'] });
    expect(pool(s, 'p1')).toBe('');
  });
});
