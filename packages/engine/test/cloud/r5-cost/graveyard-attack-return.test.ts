/**
 * r5-cost: a triggered ability that functions in the graveyard with an intervening "if" (parser/lower/ability.ts; triggers/collect.ts collects it from graveyards),
 * returning the card tapped and attacking (zz-cloud/r5-cost.json), played with synthetic cards (design 6.10).
 *
 *   CR 113.6m, 603.4    the ability triggers from the graveyard only if the condition holds, and checks it again as it resolves
 *   CR 118.12, 508.4    paying puts the card onto the battlefield tapped and attacking (it was never declared as an attacker); it deals combat damage
 */
import { describe, expect, it } from 'vitest';
import { attackWith, card, find, full, lifeOf, scenario } from './support';

const STALKER = card('Test Bog Stalker', 'Creature — Zombie Rat', 'Whenever you attack with one or more Rats, if there are three or more cards in your graveyard, you may pay {B}. If you do, return this card from your graveyard to the battlefield tapped and attacking.', '{2}{B}', ['3', '1']);
const RAT = card('Test Sewer Rat', 'Creature — Rat', '', '{0}', ['1', '1']);
const DEFS = [STALKER, RAT];

describe('r5-cost: return from the graveyard tapped and attacking, behind an intervening "if"', () => {
  it('the card is automated', () => expect(full(STALKER)).toBe(true));

  it('CR 113.6m, 603.4, 508.4: with three cards in the graveyard, paying {B} returns it attacking; it deals 3 combat damage', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, p1: { battlefield: ['Test Sewer Rat', 'Swamp'], graveyard: ['Test Bog Stalker', 'Swamp', 'Swamp'] } });
    const rat = find(s0, 'Test Sewer Rat', 'battlefield', 'p1');
    const s = attackWith(s0, [rat], 'p2', { yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(20 - 1 - 3);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bog Stalker')).toBe(true);
  });

  it('CR 603.4: with two cards in the graveyard it doesn\'t trigger', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, p1: { battlefield: ['Test Sewer Rat', 'Swamp'], graveyard: ['Test Bog Stalker', 'Swamp'] } });
    const rat = find(s0, 'Test Sewer Rat', 'battlefield', 'p1');
    const s = attackWith(s0, [rat], 'p2', { yes: [true] });
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Bog Stalker')).toBe(true);
  });
});
