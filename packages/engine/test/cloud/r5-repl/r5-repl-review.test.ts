/**
 * Merge wave 8, r5-repl line: the independent review's scenario tests (synthetic cards compiled by the game's default compiler, design 6.10).
 *
 *   CR 510.2, 614.1a, 120.3e  "instead that damage is dealt, but all other damage already dealt to ~ is healed" heals the damage marked BEFORE the event: the
 *                             combat damage two blockers deal to it at the same time is one event, so both parts stay marked (Wolverine, Fierce Fighter)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { find, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], power: pt[0], toughness: pt[1] } as OracleCard);
}

const HEALER = card('Test Healer', 'Creature — Mutant', 'If damage would be dealt to ~, instead that damage is dealt, but all other damage already dealt to ~ is healed.', ['0', '3']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2']);

describe('wave 8 review: the healFirst body and simultaneous damage (CR 510.2, 614.1a)', () => {
  it('CR 510.2, 614.1a: two blockers\' combat damage is dealt at the same time; neither part heals the other (2 + 2 on a 0/3 is lethal)', () => {
    let s = scenario([], { defs: [HEALER, BEAR, CUB], p1: { battlefield: ['Test Healer'] }, p2: { battlefield: ['Test Bear', 'Test Cub'] } });
    const healer = find(s, 'Test Healer', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[healer]]);
    s = declareBlockers(toDeclareBlockers(s), [[find(s, 'Test Bear', 'battlefield'), healer], [find(s, 'Test Cub', 'battlefield'), healer]]);
    s = toStep(s, 'endCombat');
    expect(s.zones.battlefield).not.toContain(healer); // CR 704.5g: 4 damage marked at once, toughness 3
  });

  it('CR 614.1a, 120.3e: damage marked before the combat damage step is still healed by it', () => {
    let s = scenario([], { defs: [HEALER, BEAR], p1: { battlefield: ['Test Healer'] }, p2: { battlefield: ['Test Bear'] } });
    const healer = find(s, 'Test Healer', 'battlefield');
    s = { ...s, objects: { ...s.objects, [healer]: { ...s.objects[healer]!, damage: 2 } } };
    s = declareAttackers(toDeclareAttackers(s), [[healer]]);
    s = declareBlockers(toDeclareBlockers(s), [[find(s, 'Test Bear', 'battlefield'), healer]]);
    s = toStep(s, 'endCombat');
    expect(s.zones.battlefield).toContain(healer);
    expect(s.objects[healer]!.damage).toBe(2); // the 2 marked before are healed; the bear's 2 are marked
  });
});
