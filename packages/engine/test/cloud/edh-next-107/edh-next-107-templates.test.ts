/**
 * edh-next-107: the real cards of the round compile to full automation (Oracle text of 2026-11-03).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';

const compile = (name: string, type: string, text: string, pt?: [string, string]) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);

describe('edh-next-107 cards', () => {
  it('Simian Sling is full', () => {
    const d = compile('Simian Sling', 'Artifact Creature — Equipment Monkey', 'Equipped creature gets +1/+1.\nWhenever this creature or equipped creature becomes blocked, it deals 1 damage to defending player.\nReconfigure {2} ({2}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn\'t a creature.)', ['1', '1']);
    expect(d.automation.level).toBe('full');
  });
  it("Nature's Chosen is full", () => {
    const d = compile("Nature's Chosen", 'Enchantment — Aura', 'Enchant creature you control\n{0}: Untap enchanted creature. Activate only during your turn and only once each turn.\nTap enchanted creature: Untap target artifact, creature, or land. Activate only if enchanted creature is white and untapped and only once each turn.');
    expect(d.automation.level).toBe('full');
  });
  it('near misses stay partial: "is white or untapped" is not the conjunction; "and" with a clash', () => {
    const d = compile('Test Near', 'Enchantment — Aura', 'Enchant creature\n{T}: Draw a card. Activate only if enchanted creature is white or untapped.');
    expect(d.automation.level).not.toBe('full');
  });
  const withParts = (text: string, parts: { component: string; name: string }[]) =>
    compileCard({ name: 'Test Forging', layout: 'normal', mana_cost: '{0}', type_line: 'Sorcery', oracle_text: text, colors: [], keywords: [], all_parts: parts } as unknown as OracleCard);
  it('a card named by either face of a related double-faced card is read (CR 201.2, 711.4)', () => {
    const parts = [{ component: 'combo_piece', name: 'Test Forging' }, { component: 'combo_piece', name: 'Test Front, the Hero // Test Back Blade' }];
    expect(withParts('Search your library for a card named Test Front, the Hero or an Equipment card, reveal it, put it into your hand, then shuffle.', parts).automation.level).toBe('full');
    expect(withParts('Search your library for a card named Test Back Blade or an Equipment card, reveal it, put it into your hand, then shuffle.', parts).automation.level).toBe('full');
  });
});
