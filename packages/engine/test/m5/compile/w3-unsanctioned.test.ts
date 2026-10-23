/**
 * W3 integration (WP18 + WP24): a card the rules do not cover (CR 100.7), flagged `unsanctioned` by the card index, is manual-only apart from its keywords
 * (design 12.3) on every compile path: the default `compileCard`, `compileCardV2` and an explicit face-by-face compiler.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, compileCardV2, defaultCompileSources, noAbilityCompiler, UNSANCTIONED_REASON, type OracleCard } from '../../../src/index';

const silver: OracleCard = {
  name: 'Test Silver Bolt', layout: 'normal', type_line: 'Creature — Goblin', mana_cost: '{R}', power: '1', toughness: '1', colors: ['R'], keywords: ['Haste'],
  oracle_text: 'Haste\nWhen this creature enters, it deals 3 damage to any target.', unsanctioned: true,
} as OracleCard;
const plain: OracleCard = { ...silver, name: 'Test Plain Bolt' };
delete (plain as { unsanctioned?: true }).unsanctioned;

describe('CR 100.7, design 12.3 (W3 integration): unsanctioned cards are manual on every compile path', () => {
  it('compileCard (the pipeline) and compileCardV2: manual, flagged, the keyword kept, the trigger manual', () => {
    for (const def of [compileCard(silver), compileCardV2(silver, defaultCompileSources())]) {
      expect(def.automation.level).toBe('manual');
      expect(def.unsanctioned).toBe(true);
      const kinds = def.faces[0]!.abilities.map((a) => a.kind);
      expect(kinds).toEqual(['keyword', 'manual']);
      expect(def.faces[0]!.abilities[1]).toMatchObject({ reason: UNSANCTIONED_REASON });
    }
  });

  it('an explicit compiler path flags it too; the same text without the flag is not manual-only', () => {
    expect(compileCard(silver, noAbilityCompiler).unsanctioned).toBe(true);
    const def = compileCard(plain);
    expect(def.unsanctioned).toBeUndefined();
    expect(def.automation.level).not.toBe('manual');
  });
});
