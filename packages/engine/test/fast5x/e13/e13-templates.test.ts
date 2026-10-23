/**
 * FAST5X E13: the template data of parser/templates/zz-fast5x/e13.json and the readings it needed (design 6.8 G6):
 *  - the craft keyword line, "Craft with [materials] [cost]" (CR 702.167a-b): one material ("artifact", "Island"), N materials ("two creatures"), "N or more"
 *    with and without a quality (keywords/data/craft.json; render/kw.ts#craftWords);
 *  - "Return ~ from your graveyard to the battlefield [tapped] with a <kind> counter on it" (CR 113.6m, 614.1c), "return a <card> from your graveyard to the
 *    battlefield with ..." (a choice on resolution, CR 608.2d), "... tapped and attacking with ...", "... under its owner's control with ...", "put ... onto the
 *    battlefield with ...";
 *  - "Exile ~" as an activation cost renders as Oracle prints it (no zone: an ability functions on the battlefield, CR 113.6, 602.2);
 *  - "Activate only if C and only as a sorcery." is the same pair of restrictions as "Activate only as a sorcery and only if C." (CR 602.5d).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON. Examples are synthetic wordings (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e13 from '../../../src/parser/templates/zz-fast5x/e13.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { getCard } from '../../fixtures';
import review from '../../m5/golden/cards/fast5x-e13-review.json';
import r3fxReview from '../../m5/golden/cards/cloud-r3-fx-review.json';
import r4FxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json';

const E13 = e13 as Template[];
const OPTS = defaultParseOptions();

function exampleCard(text: string, type?: string): OracleCard {
  const craft = /^Craft\b/.test(text);
  const permanent = craft || /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  const typeLine = type ?? (craft ? 'Artifact' : permanent ? 'Creature — Human' : 'Instant');
  return {
    name: 'Example Subject', layout: 'normal', type_line: typeLine, oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(/Creature/.test(typeLine) ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string, type?: string) => parseCard(exampleCard(text, type), OPTS).faces[0]!;
const first = (text: string, type?: string): Record<string, unknown> => parsed(text, type).abilities[0] as unknown as Record<string, unknown>;

describe('E13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e13.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e13.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5X)', () => {
    for (const t of E13) {
      expect(t.id, t.id).toMatch(/^(eff|kw)\.e13\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable E13 template has its evidence: three hand-verified golden cards, or every card of the corpus whose parse uses it', () => {
    const golden = review as { card: string; verified: string }[];
    // the only cards of the local index whose parse uses these templates (npm run cards -- try): Scavenger's Talent and Charnel Serenade print "return a
    // creature card from your graveyard to the battlefield with a finality counter on it"; Grim Reaper the "tapped and attacking" form
    const WHOLE_CORPUS: Record<string, string[]> = {
      'eff.e13.return.choose.bf.counter': ["Scavenger's Talent", 'Charnel Serenade'],
      'eff.e13.return.bf.attacking.counter': ['Grim Reaper, Lethal Legionnaire'],
      // std-lci: "Craft with two creatures" and "Craft with six artifacts", the only craft lines with a number of one kind of material (CR 702.167a)
      'kw.e13.craft.n': ['Visage of Dread // Dread Osseosaur', 'Tetzin, Gnome Champion // The Golden-Gear Colossus'],
      // Standard round 3 r3-fx: "put target creature card ... onto the battlefield under your control with a finality counter on it": Coalstoke Gearhulk, the one card of
      // the corpus the sentence makes full (Arbiter of the Ideal and From the Catacombs stay partial for other sentences); review file cloud-r3-fx-review.json.
      // DEVIATION recorded (r3-fx pull request): 3 matches, 1 golden card
      'eff.e13.put.bf.counter': ['Coalstoke Gearhulk'],
      // Standard round 4 r4-fxb: the one card of the corpus whose parse uses it (review file cloud-r4-fxb-review.json)
      'eff.e13.return.self.gy.bf.tapped.counter': ['Relentless X-ATM092'],
      // std-craft-1 (CR 702.167a): "Craft with one or more {cost}" (no noun): Sunbird Standard is the one card of the corpus whose parse uses it
      'kw.e13.craft.orMore.any': ['Sunbird Standard // Sunbird Effigy'],
      // std-craft-1: "Craft with one or more <materials>": four cards print it (Saheeli's Lattice, Standard; Altar of the Wretched and Ore-Rich Stalactite, not
      // Standard, partial for other sentences; Paleontologist's Pick-Axe, held out). DEVIATION recorded (std-craft-1 record): 4 matches, 1 golden card
      'kw.e13.craft.orMore': ["Saheeli's Lattice // Mastercraft Raptor"],
    };
    const evidence = [...golden, ...(r3fxReview as { card: string; verified: string }[]), ...(r4FxbReview as { card: string; verified: string }[])];
    for (const t of E13.filter((x) => x.status === 'stable')) {
      const cards = evidence.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id};`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E13) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('E13 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E13) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const head = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(head.abilities), c).toBe(false);
      }
    });
  }
});

describe('E13 lowering: what the shapes mean', () => {
  it('CR 702.167a-b: "Craft with artifact {2}{W}" is the craft keyword with the material quality and the mana cost; "two creatures" and "one or more" carry the count', () => {
    expect(first('Craft with artifact {2}{W}')).toMatchObject({ kind: 'keyword', keyword: 'craft', filter: { types: ['Artifact'] } });
    expect(first('Craft with two creatures {5}{B}')).toMatchObject({ kind: 'keyword', keyword: 'craft', filter: { types: ['Creature'] }, amount: 2 });
    expect(first('Craft with one or more Dinosaurs {4}{R}')).toMatchObject({ kind: 'keyword', keyword: 'craft', filter: { subtypes: ['Dinosaur'] }, amount: 1, quality: 'or more' });
    expect(first('Craft with one or more {5}')).toMatchObject({ kind: 'keyword', keyword: 'craft', filter: {}, amount: 1, quality: 'or more' });
  });
  it('CR 702.167a: a list of different materials ("a Dinosaur, a Merfolk, a Pirate, and a Vampire") is no reading of an E13 template (std-craft-1 reads it: one exile part per material)', () => {
    const f = parsed('Craft with a Dinosaur, a Merfolk, a Pirate, and a Vampire {4}');
    expect(f.templatesUsed.filter((id) => id.startsWith('kw.e13.'))).toEqual([]);
    expect(f.templatesUsed).toContain('kw.stdcraft1.craft.list4');
  });
  it('CR 118.3, 602.2: "Exile ~" as a cost is the source exiling itself from the battlefield, and renders without a zone', () => {
    const f = parsed('{2}, {T}, Exile ~: Draw two cards.', 'Artifact');
    expect(fullyAutomated(f)).toBe(true);
    expect((f.abilities[0] as unknown as { cost: { other: unknown[] } }).cost.other).toEqual([{ kind: 'exileFrom', zone: 'battlefield', count: 1, self: true }]);
  });
  it('CR 205.2a (delirium): "there are four or more card types among cards in your graveyard" is a condition wherever a condition goes', () => {
    const DELIRIUM = { cond: 'compare', left: { q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } } }, op: '>=', right: 4 };
    const act = first('{2}{B}: Draw a card. Activate only if there are four or more card types among cards in your graveyard.', 'Creature — Human');
    expect(act['onlyIf']).toEqual(DELIRIUM);
    const f = parsed('Target creature gets +1/+0 until end of turn. If there are four or more card types among cards in your graveyard, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain(JSON.stringify(DELIRIUM.left));
    // "exactly four" is no reading (only "N or more")
    expect(fullyAutomated(parsed('If there are exactly four card types among cards in your graveyard, draw a card.'))).toBe(false);
  });
  it('CR 602.5d: "Activate only if C and only as a sorcery." passes the gate like the other order', () => {
    const f = parsed('{3}: Draw a card. Activate only if you control an artifact and only as a sorcery.', 'Creature — Human');
    expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
  });
});

describe('E13 real cards (npm run cards -- try)', () => {
  it('the cards whose only blockers were craft, "Exile ~", finality counters and the graveyard returns compile full', () => {
    for (const name of ['Tithing Blade // Consuming Sepulcher', 'Oteclan Landmark // Oteclan Levitator', 'Waterlogged Hulk // Watertight Gondola', 'Gastal Thrillroller',
      'Phoenix Down', 'The Echoverse Fulcrum', 'Soulcoil Viper', 'Rite of the Moth', 'Resurrected Cultist']) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});
