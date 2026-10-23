/**
 * WP23 over the local Oracle index (skipped when `.cache/` is absent; design 6.10): contract C1 (never a parser error) and guard G10 (design 6.8: adding
 * templates may change only formerly-manual units). Every 3rd card of the index is parsed with the bootstrap templates alone and with the bootstrap plus
 * the WP23 templates: every ability that was automated (no manual node, render gate passed) before must have exactly the same JSON after.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { BOOTSTRAP_TEMPLATES, defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { canonicalJson } from '../../../src/parser/holes';
import { SLOW, slowTitle } from '../../slow';
import { automated, localIndex, WP23_TEMPLATES } from './support';

// QT: about 30 s; a slow suite (npm run test:all). The index is read only when the suite runs.
const index = SLOW ? localIndex() : null;

describe.skipIf(!SLOW || index === null)(slowTitle('WP23 corpus (local Oracle index)'), () => {
  it('C1 and G10: no parser error; no ability automated by the bootstrap templates changes when the WP23 templates are added', { timeout: 300_000 }, () => {
    const before = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES] }); // W3b: the default is the whole template set
    const after = defaultParseOptions({ templates: [...BOOTSTRAP_TEMPLATES, ...WP23_TEMPLATES] });
    let changed = 0;
    let gained = 0;
    const examples: string[] = [];
    index!.forEach((card, n) => {
      if (n % 3 !== 0) return;
      const a = parseCard(card, before);
      const b = parseCard(card, after);
      for (const f of b.faces) expect(f.diagnostics.filter((d) => d.code === 'parser-error'), card.name).toEqual([]);
      a.faces.forEach((fa, k) => {
        const fb = b.faces[k]!;
        const auto = (f: typeof fa, i: number, x: AbilityDef): boolean => automated([x]) && f.gate[i]?.ok === true;
        fa.abilities.forEach((x, i) => {
          const y = fb.abilities[i];
          if (auto(fa, i, x) && (y === undefined || canonicalJson(x) !== canonicalJson(y))) {
            changed++;
            if (examples.length < 5) examples.push(`${card.name}: ${x.text}`);
          }
          if (y !== undefined && auto(fb, i, y) && !auto(fa, i, x)) gained++;
        });
      });
    });
    expect(changed, examples.join('\n')).toBe(0);
    // the templates do automate something. W3 integration: the token creation they counted is WP21's eff.token.you now (the identical eff.create.you was dropped)
    expect(gained).toBeGreaterThan(100);
  });
});
