/**
 * Merge wave 8 (r5-cost on wave 7's base): keyword expansion substitutes "its mana cost" only for harmonize and embalm (keywords/expand.ts). The base's mayhem
 * (cloud r3-mech) and flashback (FAST5 T56) whose cost is the card's mana cost keep their own reading in actions/cast-options.ts, so their expansion is the one
 * they had before r5-cost.
 *
 *   CR 702.180a, 702.128a, 118.9   harmonize / embalm "equal to its mana cost": the object's own mana cost is the keyword's cost
 *   CR 118.6                       an object with no mana cost has no such cost: the granted keyword stands for nothing
 *   CR 702.187b                    "The mayhem cost is equal to its mana cost": unchanged by r5-cost (the costless mayhem expansion, read by cast-options)
 */
import { describe, expect, it } from 'vitest';
import type { KeywordAbilityDef } from '../../../src/index';
import { expansionOf } from '../../../src/statics/abilities';
import type { ExpandContext } from '../../../src/keywords/types';
import { parseManaCost } from '../../../src/types/mana';

const ctx: ExpandContext = { granted: true, faceName: 'Test', types: ['Sorcery'], keyPrefix: 'g:e:0' };
const kw = (keyword: string): KeywordAbilityDef => ({ kind: 'keyword', text: keyword, keyword, costIsManaCost: true });

describe('merge wave 8: "cost is equal to its mana cost" in keyword expansion', () => {
  it('CR 702.180a, 118.9: harmonize gets the object\'s mana cost', () => {
    const mana = parseManaCost('{1}{R}')!;
    const out = JSON.stringify(expansionOf(kw('harmonize'), { ...ctx, manaCost: mana }));
    expect(out).toContain('"name":"harmonize"');
    expect(out).toContain(JSON.stringify({ mana }).slice(1, -1));
  });

  it('CR 118.6: harmonize and embalm on an object with no mana cost stand for nothing', () => {
    expect(expansionOf(kw('harmonize'), { ...ctx, manaCost: null })).toEqual([]);
    expect(expansionOf(kw('embalm'), { ...ctx, manaCost: null })).toEqual([]);
  });

  it('CR 702.187b: mayhem whose cost is its mana cost expands as before r5-cost, with or without a mana cost in the context', () => {
    const before = expansionOf(kw('mayhem'), ctx);
    expect(before.length).toBeGreaterThan(0);
    expect(expansionOf(kw('mayhem'), { ...ctx, manaCost: parseManaCost('{2}{B}')! })).toEqual(before);
  });
});
