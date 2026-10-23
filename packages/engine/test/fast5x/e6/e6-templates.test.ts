/**
 * FAST5X E6: the template data of parser/templates/zz-fast5x/e6.json ("When this card becomes plotted", CR 702.170a, 603.2) and the parser reading that makes
 * such an ability function in exile (CR 113.6k; parser/lower/trigger-zone.ts#homeZone). The keyword lines "Plot {M}", "Mayhem {M}" and "Harmonize {M}" are
 * read by the existing keyword-line template (kw.line); this file checks they compile with their costs. Guard G9 (design 6.8): every example lowers with its
 * template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON. Examples are synthetic
 * wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e6 from '../../../src/parser/templates/zz-fast5x/e6.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e6-review.json';

const E6 = e6 as Template[];
const OPTS = defaultParseOptions({ capabilities: ENGINE_CAPABILITIES }); // the engine's capabilities: a trigger template's event form is one (feature:ev.becomes.plotted)

function exampleCard(text: string): OracleCard {
  return { name: 'Example Subject', layout: 'normal', type_line: 'Creature — Human', oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}', colors: [], keywords: [], power: '2', toughness: '2' } as OracleCard;
}
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('E6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e6.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e6.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E6) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.e6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E6 template has its evidence: every card of the corpus that prints the sentence, verified by hand', () => {
    // Aloe Alchemist and Longhorn Sharpshooter are the only cards of the local index that print "When this card becomes plotted"
    const WHOLE_CORPUS: Record<string, string[]> = { 'trg.e6.becomesPlotted': ['Aloe Alchemist', 'Longhorn Sharpshooter'] };
    const golden = review as { card: string; verified: string }[];
    for (const t of E6.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.slice().sort(), t.id).toEqual([...WHOLE_CORPUS[t.id]!].sort());
    }
  });
});

describe('E6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E6) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E6 lowering: what the shapes mean', () => {
  it('CR 113.6k, 702.170a: "When ~ becomes plotted" functions in exile (a plotted card is in exile); other "becomes" triggers stay on the battlefield', () => {
    const plotted = parsed('When ~ becomes plotted, draw a card.').abilities[0] as unknown as { zone?: string[]; trigger: unknown };
    expect(plotted.zone).toEqual(['exile']);
    expect(plotted.trigger).toEqual({ on: [{ ev: 'becomes', what: 'plotted', object: { self: true } }] });
    const tapped = parsed('Whenever ~ becomes tapped, draw a card.').abilities[0] as unknown as { zone?: string[] };
    expect(tapped.zone).toBeUndefined();
  });

  it('the keyword lines keep their costs: Plot {1}{R}, Mayhem {1}{R}, Harmonize {4}{R} (CR 702.170a, 702.187b, 702.180a)', () => {
    const kw = (name: string, k: string): unknown => compileCard(getCard(name)).faces[0]!.abilities.find((a) => a.kind === 'keyword' && a.keyword === k);
    const r = (n: number) => ({ mana: [{ kind: 'generic', amount: n }, { kind: 'colored', color: 'R' }] });
    expect(kw('Slickshot Show-Off', 'plot')).toMatchObject({ cost: r(1) });
    expect(kw("Electro's Bolt", 'mayhem')).toMatchObject({ cost: r(1) });
    expect(kw('Wild Ride', 'harmonize')).toMatchObject({ cost: r(4) });
  });
});
