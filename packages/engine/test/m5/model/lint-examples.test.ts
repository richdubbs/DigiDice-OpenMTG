import { describe, expect, it } from 'vitest';
import { validateAbility, validateCardAbilities } from '../../../src/model';
import { EXAMPLES } from './examples';

describe('the worked examples of design section 13', () => {
  it('there are 53 of them', () => {
    expect(EXAMPLES).toHaveLength(53);
  });

  for (const ex of EXAMPLES) {
    it(`${ex.name}: every ability passes schema and lint, and the card passes the card-wide checks`, () => {
      const issues = ex.faces.flatMap((f, fi) => f.abilities.flatMap((a, ai) => validateAbility(a).map((i) => ({ ...i, where: `${fi}/${ai}` }))));
      expect(issues, JSON.stringify(issues, null, 1)).toEqual([]);
      const card = validateCardAbilities(ex.faces).filter((i) => i.severity === 'error');
      expect(card, JSON.stringify(card, null, 1)).toEqual([]);
    });
  }
});
