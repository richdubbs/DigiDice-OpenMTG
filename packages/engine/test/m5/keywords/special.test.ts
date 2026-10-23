/**
 * keywords/special (CR 116.2): the special actions keywords grant are PLANNED stubs. A stub defines the action completely but its check always denies, so no
 * legal-action list can offer it and a player can never half-perform it.
 */
import { describe, expect, it } from 'vitest';
import { SPECIAL_ACTIONS, SPECIAL_BY_KEYWORD } from '../../../src/keywords/special';
import { keywordRegistry } from '../../../src/keywords/registry';
import { find, scenario } from '../helpers';
import { gameOf } from '../../../src/rules/hookpoints';

describe('special actions of keywords (CR 116.2): planned stubs', () => {
  it('foretell (116.2h), suspend (116.2f), plot (116.2k) and turning a face-down permanent face up (116.2b) are defined', () => {
    expect(SPECIAL_ACTIONS.map((a) => [a.key, a.rule, a.timing, a.zones])).toEqual([
      ['foretell', 'CR 116.2h', 'priority', ['hand']],
      ['suspend', 'CR 116.2f', 'priority', ['hand']],
      ['plot', 'CR 116.2k', 'sorceryTiming', ['hand']],
      ['turnFaceUp', 'CR 116.2b', 'priority', ['battlefield']],
    ]);
    expect(new Set(SPECIAL_ACTIONS.map((a) => a.key)).size).toBe(SPECIAL_ACTIONS.length);
  });

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-3.test.ts (the special-action stubs deny)

  // M6-0 (m6 design 4.3): moved to test/m6/skeleton/absent-m6-3.test.ts (the keywords that grant them are planned)
});
