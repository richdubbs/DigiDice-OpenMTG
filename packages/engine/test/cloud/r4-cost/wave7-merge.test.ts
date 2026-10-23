/**
 * Wave 7 merge line r4-cost: cards that only the merged line makes full (r4-cost's free cast of an object, with an earlier wave's antecedent), played with a
 * synthetic card in the shape of Malcolm, Alluring Scoundrel (design 6.10).
 *
 *   CR 608.2g, 118.9, 701.9a   "Draw a card, then discard a card. If ..., you may cast the discarded card without paying its mana cost": the card discarded by
 *                              the resolution (r3-moved's binding, wave 6) is cast from the graveyard for nothing (r4-cost's eff.cost.cast.target.free)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { attackWith, card, find, full, scenario } from './support';

const SIREN = card('Test Chorus Siren', 'Creature — Siren Pirate', 'Whenever this creature deals combat damage to a player, put a chorus counter on it. Draw a card, then discard a card. If there are one or more chorus counters on this creature, you may cast the discarded card without paying its mana cost.', '{1}', ['2', '1']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', '{2}{R}');
const DEFS = [SIREN, BOLT];
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

describe('wave 7 line r4-cost: the discarded card cast for nothing (Malcolm, Alluring Scoundrel)', () => {
  it('the card is automated', () => {
    expect(full(SIREN)).toBe(true);
  });

  it('CR 608.2g, 118.9, 701.9a: the card discarded by the resolution is cast from the graveyard without paying its mana cost; declining leaves it there', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Chorus Siren'], hand: ['Test Bolt'], library: ['Plains', 'Plains'] } });
    const siren = find(s0, 'Test Chorus Siren', 'battlefield', 'p1');
    const bolt = find(s0, 'Test Bolt', 'hand', 'p1');
    const yes = attackWith(s0, [siren], 'p2', { objects: [[bolt]], yes: [true], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(life(yes, 'p2')).toBe(15); // 2 combat damage, then the Bolt's 3 with no land to pay {2}{R}
    expect(yes.objects[siren]?.counters?.['chorus']).toBe(1);
    const no = attackWith(s0, [siren], 'p2', { objects: [[bolt]], yes: [false] });
    expect(life(no, 'p2')).toBe(18);
    expect(no.zones.graveyard.p1!.map((id) => no.objects[id]!.defId)).toContain('Test Bolt');
  });
});
