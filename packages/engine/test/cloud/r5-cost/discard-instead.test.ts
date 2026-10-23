/**
 * r5-cost: a cast during a resolution "by discarding a card rather than paying its mana cost" (zz-cloud/r5-cost.json eff.r5cost.cast.obj.discardInstead; the cast
 * op's alternative cost, M6-12), played with synthetic cards (design 6.10).
 *
 *   CR 118.9, 601.2b, 608.2g   the card exiled from the top of the library is cast for the alternative cost: one card discarded, no mana; with no card in hand
 *                              the cost can't be paid, so it isn't cast (CR 601.2h)
 */
import { describe, expect, it } from 'vitest';
import { attackWith, card, find, full, lifeOf, scenario } from './support';

const RAIDER = card('Test Claw Raider', 'Creature — Weasel Mercenary', 'Whenever this creature deals combat damage to a player, exile cards from the top of your library until you exile a nonland card. You may cast that card by discarding a card rather than paying its mana cost.', '{0}', ['2', '2']);
const BLAST = card('Test Big Blast', 'Instant', 'Test Big Blast deals 5 damage to any target.', '{5}{R}');
const DEFS = [RAIDER, BLAST];

describe('r5-cost: cast by discarding a card rather than paying its mana cost', () => {
  it('the card is automated', () => expect(full(RAIDER)).toBe(true));

  it('CR 118.9, 601.2b: the {5}{R} Blast is cast by discarding a Plains, with no mana', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Claw Raider'], hand: ['Plains'], library: ['Plains', 'Test Big Blast'] } });
    const raider = find(s0, 'Test Claw Raider', 'battlefield', 'p1');
    const plains = find(s0, 'Plains', 'hand', 'p1');
    const s = attackWith(s0, [raider], 'p2', { yes: [true], objects: [[plains]], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(lifeOf(s, 'p2')).toBe(20 - 2 - 5);
    expect(s.zones.hand.p1).toHaveLength(0);
  });

  it('CR 601.2h: with an empty hand the discard can\'t be paid: the card stays exiled', () => {
    const s0 = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Claw Raider'], library: ['Test Big Blast'] } });
    const raider = find(s0, 'Test Claw Raider', 'battlefield', 'p1');
    const s = attackWith(s0, [raider], 'p2', { yes: [true], targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Big Blast');
  });
});
