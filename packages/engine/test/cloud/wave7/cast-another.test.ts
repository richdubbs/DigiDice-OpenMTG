/**
 * Wave 7 merge (r4-fxz + r4-static): one reading of "you've cast another <kind> spell this turn" (lower/anaphora.ts#anaphoricOther, lower/targets.ts, the cast
 * event's spell with `other: true`, compared by rules/history.ts with the ability's source). It means "other than this spell" only where the source IS that
 * spell: an instant's or sorcery's spell ability, or a cast trigger that functions only on the stack (CR 601.2i, 109.2, 113.6k). A permanent is a new object, not
 * the spell it was (CR 400.7), so its own spell would count as "another" (a Dream Thief-like creature drew a card when it was the only blue spell): r4-fxz's
 * lint (lower/verify.ts) refuses it there, and the card stays partial (fails closed).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: ['U'], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const manualSomewhere = (d: CardDef): boolean => JSON.stringify(d.faces).includes('"op":"manual"') || d.faces.some((f) => f.abilities.some((a) => a.kind === 'manual'));

describe('CR 601.2i, 109.2, 400.7 (wave 7 merge): "another spell" only where the source is that spell', () => {
  it('an instant: automated', () => {
    const CHARGE = card('Test Charge', 'Instant', "Target creature you control gets +2/+0 until end of turn if you've cast another instant or sorcery spell this turn.");
    expect(CHARGE.automation.level).toBe('full');
  });
  it('a cast trigger that functions on the stack ("When you cast this spell, if you\'ve cast another spell this turn, copy this spell."): automated', () => {
    const SAGE = card('Test Sage', 'Sorcery', "When you cast this spell, if you've cast another spell this turn, copy this spell.\nYou gain 2 life.");
    expect(SAGE.automation.level).toBe('full');
  });
  it('a creature\'s enters trigger ("draw a card if you\'ve cast another blue spell this turn"): not automated (its own spell would count)', () => {
    const THIEF = card('Test Thief', 'Creature — Faerie Rogue', "Flying\nWhen this creature enters, draw a card if you've cast another blue spell this turn.", ['2', '1']);
    expect(THIEF.automation.level).not.toBe('full');
    expect(manualSomewhere(THIEF)).toBe(true);
  });
});
