/**
 * FAST5X E10: the template data of parser/templates/zz-fast5x/e10.json and the renderer readings waterbend and airbend needed (design 6.8 G6):
 *  - "waterbend {N}" is written with its mana symbol and before {T} ("Waterbend {3}, {T}: ...", render/costs.ts), as a cost of an activated ability, an
 *    additional cost (CR 601.2b) and a ward cost (CR 702.21a); "Then <instruction> unless you waterbend {N}." (CR 118.12a: "then" only orders, CR 608.2c);
 *  - "airbend <objects>" for targets or every permanent of a description on the battlefield only (a spell or a card elsewhere stays manual, CR 701.65a);
 *  - "<permanent> becomes an artifact creature." with no duration (CR 611.2a: it lasts; the exhaust Vehicles, CR 702.177a);
 *  - "whenever you waterbend" / "whenever you airbend" (CR 701.67c, 701.65b), experimental: no printed card says either alone.
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e10 from '../../../src/parser/templates/zz-fast5x/e10.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import { goldenOptions } from '../../m5/golden/harness';
import review from '../../m5/golden/cards/fast5x-e10-review.json';

const E10 = e10 as Template[];
const OPTS = goldenOptions(); // the engine's capabilities: eff.e10.airbend needs action:airbend

function exampleCard(text: string, type?: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (/becomes an artifact creature/.test(text) ? 'Artifact — Vehicle' : permanent ? 'Creature — Human' : 'Instant');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature|Vehicle/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;

describe('E10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e10.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e10.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E10) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.e10\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E10 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    // Waterbending Lesson is the only card of the local index that prints "Then ... unless you waterbend {N}."
    const WHOLE_CORPUS: Record<string, string[]> = { 'eff.e10.then.unless.waterbend': ['Waterbending Lesson'] };
    for (const t of E10.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    // the triggers stay experimental: no printed card says "whenever you waterbend" or "whenever you airbend" alone
    expect(E10.filter((t) => t.status === 'experimental').map((t) => t.id).sort()).toEqual(['trg.e10.airbend', 'trg.e10.waterbend']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E10) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E10 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E10) {
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

describe('E10 render and lowering: what the shapes mean', () => {
  it('CR 701.67a: "Waterbend {3}, {T}: ..." is a cost with the waterbend part and {T} (rendered in the Oracle order, the mana symbol kept)', () => {
    const f = parsed('Waterbend {3}, {T}: Draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect((f.abilities[0] as { cost?: unknown }).cost).toEqual({ tap: true, other: [{ kind: 'action', action: 'waterbend', arg: 3 }] });
    // "Waterbend 3" (no braces) is not the Oracle wording: no reading
    expect(fullyAutomated(parsed('Waterbend 3, {T}: Draw a card.'))).toBe(false);
  });
  it('CR 702.21a: "Ward—Waterbend {4}" is a ward whose cost is the waterbend cost', () => {
    const f = parseCard(exampleCard('Ward—Waterbend {4}.', 'Creature — Serpent'), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cost":{"other":[{"kind":"action","action":"waterbend","arg":4}]}');
  });
  // r5-cost: waterbend {X} is read now, X announced with the spell (CR 107.3a, 601.2b; parser/parse.ts#cardHasXCost, played in test/cloud/r5-cost/waterbend-x.test.ts)
  it('CR 701.67b: a waterbend X (an additional cost that defines X) is read (r5-cost)', () => {
    expect(fullyAutomated(parsed('As an additional cost to cast this spell, waterbend {X}.\nDraw X cards.', 'Sorcery'))).toBe(true);
  });
  it('CR 701.65a: airbending a card in a graveyard is not automated (the gate refuses it); a spell is (std-rw6: effects/handlers/airbend.ts exiles it from the stack)', () => {
    expect(fullyAutomated(parsed('Airbend target creature card in a graveyard.'))).toBe(false);
    expect(fullyAutomated(parsed('Airbend target creature or spell.'))).toBe(true);
  });
});

describe('E10 real cards (npm run cards -- try)', () => {
  it('the cards whose only blockers were waterbend, airbend and the exhaust Vehicle shape compile full', () => {
    for (const name of ['Waterbending Lesson', 'North Pole Patrol', 'Giant Koi', 'Benevolent River Spirit', 'The Unagi of Kyoshi Island', "Aang's Iceberg", 'Flexible Waterbender',
      'Foggy Swamp Vinebender', 'Geyser Leaper', 'Aang, the Last Airbender', 'Airbending Lesson', 'Glider Staff', "Airbender's Reversal", 'Appa, Loyal Sky Bison', 'Invasion Submersible',
      'Rocketeer Boostbuggy']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});
