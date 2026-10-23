/**
 * r5-cost: "the discarded card" of a discard earlier in the same ability (parser/lower/mentions.ts, render/steps-cards.ts; r4-cost's eff.cost.cast.target.free), played
 * with synthetic cards (design 6.10).
 *
 *   CR 701.9a, 608.2c, 400.7   "draw a card, then discard a card. You may cast the discarded card without paying its mana cost.": the card the player chose to
 *   CR 608.2g, 118.9           discard, now in the graveyard, is cast from there for nothing during the resolution; declining leaves it there
 */
import { describe, expect, it } from 'vitest';
import { attackWith, card, find, full, lifeOf, scenario } from './support';

const LOOTER = card('Test Chorus Rogue', 'Creature — Human Rogue', 'Whenever this creature deals combat damage to a player, draw a card, then discard a card. You may cast the discarded card without paying its mana cost.', '{0}', ['2', '2']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.', '{2}{R}');
const DEFS = [LOOTER, BOLT];

describe('r5-cost: the discarded card', () => {
  it('the card is automated', () => expect(full(LOOTER)).toBe(true));

  it('CR 701.9a, 608.2g, 118.9: the discarded Bolt is cast from the graveyard for nothing', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Chorus Rogue'], hand: ['Test Bolt'], library: ['Plains'] } });
    const rogue = find(s0, 'Test Chorus Rogue', 'battlefield', 'p1');
    const bolt = find(s0, 'Test Bolt', 'hand', 'p1');
    const s = attackWith(s0, [rogue], 'p2', { objects: [[bolt]], yes: [true], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(lifeOf(s, 'p2')).toBe(20 - 2 - 3);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Bolt'); // cast, resolved, back in the graveyard
  });

  it('CR 608.2d: declining leaves the discarded card in the graveyard', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Chorus Rogue'], hand: ['Test Bolt'], library: ['Plains'] } });
    const rogue = find(s0, 'Test Chorus Rogue', 'battlefield', 'p1');
    const bolt = find(s0, 'Test Bolt', 'hand', 'p1');
    const s = attackWith(s0, [rogue], 'p2', { objects: [[bolt]], yes: [false] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toContain('Test Bolt');
  });
});
