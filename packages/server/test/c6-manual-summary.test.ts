/**
 * C6 (STATUS.md wave M8-W1 gap 7): a card capped at partial without a manual part of its own (Fiend Hunter) was summarized as "you play it by hand",
 * which is what a manual card means. Its summary now says the engine runs it in part.
 */
import { compileCard, type CardDef } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { MANUAL_SUMMARY, PARTIAL_CAP_SUMMARY, manualParts } from '../src/search';

function capped(level: 'partial' | 'manual'): CardDef {
  const def = compileCard({ name: 'Test Bear', layout: 'normal', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' });
  const { faces: _faces, ...automation } = def.automation;
  return { ...def, automation: { ...automation, level } };
}

describe('manual parts of a capped card (design 10)', () => {
  it('a card capped at partial says the engine runs it only in part', () => {
    const parts = manualParts(capped('partial'));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.category).toBe('capped');
    expect(parts[0]!.summary).toBe(PARTIAL_CAP_SUMMARY);
  });

  it('a card capped at manual keeps "you play it by hand"', () => {
    const parts = manualParts(capped('manual'));
    expect(parts[0]!.summary).toBe(MANUAL_SUMMARY.capped);
  });
});
