/**
 * FAST5 PROMO2, design 6.9: a template of zz-fast3 / zz-fast4 is stable only with its recorded review (evidence.ts), and the templates left experimental
 * each have their reason. The golden cards of every promotion are in test/m5/golden/cards/fast5-promo2-review.json, which the golden corpus test checks
 * (G10) whenever the local index is present.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { TEMPLATE_FILES } from '../../../src/parser/template-set';
import { PROMO2_HELD, PROMO2_PROMOTED } from './evidence';

const MINE = TEMPLATE_FILES.filter((f) => /^zz-fast[34]\//.test(f.file)).flatMap((f) => f.templates as Template[]);
const GOLDEN = JSON.parse(readFileSync(new URL('../../m5/golden/cards/fast5-promo2-review.json', import.meta.url), 'utf8')) as { card: string; expect?: string; verified: string }[];

describe('design 6.9: the PROMO2 review of the experimental templates of zz-fast3 and zz-fast4', () => {
  it('every promoted template is stable; every held one is experimental with a reason; no experimental template is left unaccounted for', () => {
    const byId = new Map(MINE.map((t) => [t.id, t]));
    for (const id of Object.keys(PROMO2_PROMOTED)) expect(byId.get(id)?.status, id).toBe('stable');
    for (const [id, why] of Object.entries(PROMO2_HELD)) {
      expect(byId.get(id)?.status, id).toBe('experimental');
      expect(why.length, id).toBeGreaterThan(10);
    }
    expect(MINE.filter((t) => t.status === 'experimental').map((t) => t.id).sort()).toEqual(Object.keys(PROMO2_HELD).sort());
  });

  it('each promotion names its golden cards: the three most played cards it makes full, or all of them when fewer (DEVIATION: see evidence.ts)', () => {
    const golden = new Map(GOLDEN.map((e) => [e.card, e]));
    for (const [id, ev] of Object.entries(PROMO2_PROMOTED)) {
      expect(ev.golden.length, id).toBeGreaterThan(0);
      expect(ev.full, id).toBeLessThanOrEqual(ev.matches);
      expect(ev.golden.filter((c) => golden.get(c)?.expect === 'full').length, id).toBe(Math.min(3, ev.full));
      for (const c of ev.golden) {
        expect(golden.has(c), `${id}: ${c}`).toBe(true);
        expect(golden.get(c)!.verified, `${id}: ${c}`).toContain(id);
        expect(golden.get(c)!.verified, `${id}: ${c}`).toMatch(/CR \d{3}/);
      }
    }
  });
});
