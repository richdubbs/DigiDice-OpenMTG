/**
 * Round pc-players-2 (precon lane pc-players): the template data of parser/templates/zz-cloud/pc-players-2.json ("draw N cards if <condition>", "<player> returns a card from
 * their graveyard to their hand"), the Cond reading "that player has more cards in hand than you / more life than you" (parser/holes/cond.ts#playerMoreThanYou, render/cond.ts),
 * "the difference" of two hands (parser/lower/quantities.ts#differenceOf, render/qty.ts), the renderer families pcp2-*, and the promotion of eff.stdwoe.choose.opponent
 * (evidence: four golden cards in cloud-std-woe-review.json). Guard G9 (design 6.8), G2, design 6.10 as in the earlier rounds. Behavior: pc-players-2-scenarios.test.ts.
 * CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-players-2.json';
import review from '../../m5/golden/cards/pc-players-2-review.json';
import woeReview from '../../m5/golden/cards/cloud-std-woe-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (text: string) => parseCard(card('Example Spell', 'Sorcery', text), OPTS).faces[0]!;
const golden = [...(review as { card: string; verified: string; expect?: string }[]), ...(woeReview as { card: string; verified: string; expect?: string }[])];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): each template is stable on its hand-verified golden cards (fewer than three: the cards
 * that may be used print each wording once or twice), with these template tests (G9, G2) and played scenarios. Listed in the round's record.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.pcp2.draw.many.ifCond': 'Thickest in the Thicket',
  'eff.pcp2.player.returnsFromGraveyard.toHand': 'Skullwinder',
};

describe('pc-players-2 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (after p2-zone-moves-1, before r3-choose), ids unique, the set valid', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/pc-players-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-players-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: rules cited, two or more examples (one for the two-sentence wording) and counter-examples, version 8; a stable template has its evidence (the recorded narrow deviation)', () => {
    expect(MECH.length).toBe(Object.keys(NARROW).length);
    for (const t of MECH) {
      expect(t.id).toMatch(/^eff\.pcp2\./);
      for (const cr of t.cr) expect(cr).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length).toBeGreaterThanOrEqual(t.id === 'eff.pcp2.youChoose.keepFourTypes' ? 1 : 2);
      expect(t.counterExamples.length).toBeGreaterThanOrEqual(2);
      expect(t.since).toBe(8);
      if (t.status === 'stable') expect(golden.filter((g) => g.verified.includes(`(${t.id}`)).map((g) => g.card)).toContain(NARROW[t.id]);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
});

describe('pc-players-2 guard G9 (design 6.8)', () => {
  for (const t of MECH) {
    it(`${t.id}: examples parse with it, are automated and pass the gate; counter-examples and near misses do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      }
      for (const c of t.counterExamples) expect(fullyAutomated(parse(c)) && jsonKey(parse(c).abilities) === jsonKey(first.abilities), c).toBe(false);
      for (const e of t.examples) {
        const orig = parse(e.text);
        const body = e.text.replace(/\.$/, '');
        for (const m of [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, e.text.replace('they control', 'an opponent controls'), e.text.replace('Each player', 'Each opponent')]) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
    it(`${t.id} guard G2: an invented word in place of any word never leaves an automated card`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((_, i) => {
          const end = words[i]!.match(/[.,]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('pc-players-2 Cond reading "that player has more cards in hand than you" (CR 402.1, 119.1)', () => {
  it('"Choose an opponent. If that player has more cards in hand than you, draw cards equal to the difference." and the life form are fully automated', () => {
    expect(fullyAutomated(parse('Choose an opponent. If that player has more cards in hand than you, draw cards equal to the difference.'))).toBe(true);
    expect(fullyAutomated(parse('Choose an opponent. If that player has more life than you, draw a card.'))).toBe(true);
  });
  it('fail closed: fewer, or you as the player, is no reading', () => {
    expect(fullyAutomated(parse('Choose an opponent. If that player has fewer cards in hand than you, draw cards equal to the difference.'))).toBe(false);
    expect(fullyAutomated(parse('If you have more cards in hand than you, draw cards equal to the difference.'))).toBe(false);
  });
});

describe('pc-players-2 renderer: the greatest power among creatures on the battlefield', () => {
  it('both wordings of the condition and the plain Qty are fully automated', () => {
    expect(fullyAutomated(parse('Draw a card if you control a creature with the greatest power among creatures on the battlefield.'))).toBe(true);
    expect(fullyAutomated(parse('Draw two cards if you control the creature with the greatest power or tied for the greatest power.'))).toBe(true);
    expect(fullyAutomated(parse('You gain life equal to the greatest power among creatures on the battlefield.'))).toBe(true);
  });
});

const index = localIndex();
describe.skipIf(index === null)('pc-players-2 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) if (typeof text === 'string') for (const l of text.split('\n')) lines.add(l.trim());
    expect(MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]).filter((x) => lines.has(x))).toEqual([]);
  }, 120_000);
});
