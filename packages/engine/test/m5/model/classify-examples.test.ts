import { describe, expect, it } from 'vitest';
import { capabilitiesOf, classifyCard, degradeAbility } from '../../../src/model';
import { EXAMPLES } from './examples';

/** Every capability any example uses: the engine of "once every node the example uses is implemented" (design 13). */
const ALL = new Set(EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.flatMap((a) => capabilitiesOf(a)))));

describe('classification of the worked examples with an engine that has every capability they use (design 10.3, 13)', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.name}: ${ex.classification ?? 'no stated classification'}`, () => {
      const card = classifyCard({ faces: ex.faces.map((f) => ({ abilities: f.abilities, lines: { lines: [], sentences: [] } })), source: 'none' }, ALL);
      if (ex.classification !== undefined) expect(card.level).toBe(ex.classification);
      for (const f of ex.faces) for (const a of f.abilities) expect(degradeAbility(a, ALL, { lines: [], sentences: [] }).def).toBe(a);
    });
  }
});
