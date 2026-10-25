/**
 * WP30 review (W1 follow-up c, one creature-type list): render/np.ts keeps its own table of the subtype classes (render may not import statics, see
 * import-rules.test.ts). It must agree with the one list (statics/subtypes.ts) for every class, apostrophes included: Oracle type lines write "Urza's" with a
 * straight apostrophe ("Land — Urza's Tower"), CR 205.3i.
 */
import { describe, expect, it } from 'vitest';
import type { CardType } from '../../../src/types/card';
import { renderFilter } from '../../../src/render/filter';
import { ARTIFACT_TYPES, BATTLE_TYPES, ENCHANTMENT_TYPES, LAND_TYPES, SPELL_TYPES } from '../../../src/statics/subtypes';

const ctx = () => ({ selfNames: ['Test Card'], selfTypes: ['Creature'] });
const renders = (types: CardType[], subtype: string): boolean => {
  try {
    renderFilter({ types, subtypes: [subtype] }, ctx());
    return true;
  } catch {
    return false;
  }
};

describe('CR 205.3g-k: render knows the same subtype classes as statics/subtypes.ts', () => {
  it("CR 205.3i: \"land — Urza's\" (straight apostrophe, as in Oracle) is a land type", () => {
    expect(renderFilter({ types: ['Land'], subtypes: ["Urza's"] }, ctx())).toContain("Urza's");
    expect(renders(['Creature'], "Urza's")).toBe(false);
  });

  it('every subtype of each non-creature class goes with its card type and not with Creature', () => {
    const classes: [CardType, readonly string[]][] = [['Land', LAND_TYPES], ['Artifact', ARTIFACT_TYPES], ['Enchantment', ENCHANTMENT_TYPES], ['Instant', SPELL_TYPES], ['Battle', BATTLE_TYPES]];
    for (const [type, names] of classes) {
      for (const n of names) {
        expect(renders([type], n), `${type} ${n}`).toBe(true);
        // std-r9b (CR 301.7): a crewed Vehicle is an artifact creature, so "Vehicle creatures" is said; every other non-creature subtype stays refused with Creature
        // trek-3 (CR 205.3g, 721.2b): so is a stationed Spacecraft ("Spacecraft creatures you control get +3/+3")
        expect(renders(['Creature'], n), `Creature ${n}`).toBe(n === 'Vehicle' || n === 'Spacecraft');
      }
    }
  });
});
