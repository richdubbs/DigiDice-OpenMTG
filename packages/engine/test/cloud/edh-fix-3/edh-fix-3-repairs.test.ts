/**
 * edh-fix-3 (repair round of the Commander combined copy): the played checks of the repairs made in source code (invented wordings, design 6.10). The tests that
 * were out of date were corrected where they stand.
 *  - render/steps-flow.ts#forEach: a group said short (edh-zones-3's "Each opponent mills half their library") joins after ", then" as before, and is also said the long way;
 *  - parser/lower/anaphora.ts#damageAmountSource: "its power" of ~ only when no creature is another candidate (edh-replace-2 vs the unique-candidate rule, design 6.4).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';

const level = (type: string, text: string): string =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard).automation.level;

describe('edh-fix-3: a group said short joins after ", then" (CR 608.2f, 701.17a)', () => {
  it('"Draw two cards, then each opponent mills half their library, rounded up." is understood and gated', () => {
    expect(level('Instant', 'Draw two cards, then each opponent mills half their library, rounded up.')).toBe('full');
  });
  it('the sentence is not read when its body is not understood', () => {
    expect(level('Instant', 'Draw two cards, then each opponent fnords half their library, rounded up.')).not.toBe('full');
  });
});

describe('edh-fix-3: "its power" of the object itself (CR 120.1, 208.1, 608.2h; design 6.4)', () => {
  it('a noncreature spell cannot be "it": the object itself deals the damage', () => {
    expect(level('Creature — Ogre', 'Whenever an opponent casts a noncreature spell, this creature deals damage equal to its power to that player.')).toBe('full');
  });
  it('an entering creature could be "it" as well: the unique-candidate rule keeps the sentence manual', () => {
    expect(level('Enchantment', 'Whenever a creature enters, this enchantment deals damage equal to its power to any target.')).not.toBe('full');
  });
});
