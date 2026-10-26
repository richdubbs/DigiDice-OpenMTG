/**
 * Round pc-players-1 (precon lane pc-players): the template data of parser/templates/zz-cloud/pc-players-1.json (imp "gain life equal to ...", "draw N cards for each ...",
 * "loses life equal to ... unless they <cost>", "each player chooses an artifact, a creature, an enchantment, and a planeswalker ...", Tragic Arrogance's two sentences and
 * "Each player chooses a creature they control. Destroy the rest."), the Cond reading "you have more life than an opponent" (parser/holes/cond.ts, render/cond.ts), the
 * sacrificeChoice fields keepTypes / keepFilter / chooser (effects/handlers/zones-remove.ts, capabilities op:sacrificeChoice.keepTypes / .keepFilter / .chooser), the fold
 * render/fold-pcp1.ts and the renderer families pcp1-move-where-x-group and pcp1-draw-n-for-each.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word never leaves an automated card (G2). Examples are synthetic (design 6.10), checked against the local
 * index when it is present. Behavior: pc-players-1-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-players-1.json';
import review from '../../m5/golden/cards/pc-players-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (text: string) => parseCard(card('Example Spell', 'Sorcery', text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): each template is stable on its hand-verified golden cards (fewer than three: the cards
 * that may be used print each wording once or twice), with these template tests (G9, G2) and played scenarios. Listed in the round's record.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.pcp1.gainlife.imp.equal': 'Wall of Reverence',
  'eff.pcp1.draw.manyForEach': 'Birth of the Imperium',
  'eff.pcp1.loseLife.equal.unlessCost': 'Tomb Blade',
  'eff.pcp1.eachPlayer.keepFourTypes': 'Cataclysmic Gearhulk',
  'eff.pcp1.youChoose.keepFourTypes': 'Tragic Arrogance',
  'eff.pcp1.eachPlayer.chooses.destroyRest': 'Divine Reckoning',
};

describe('pc-players-1 template file (design 6.3, 6.9)', () => {
  it('is loaded by the default compiler (after p2-zone-moves-1, before r3-choose), ids unique, the set valid', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/pc-players-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-players-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: rules cited, two or more examples (one for the two-sentence wording) and counter-examples, version 8; a stable template has its evidence (the recorded narrow deviation)', () => {
    expect(MECH.length).toBe(Object.keys(NARROW).length);
    for (const t of MECH) {
      expect(t.id).toMatch(/^eff\.pcp1\./);
      for (const cr of t.cr) expect(cr).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length).toBeGreaterThanOrEqual(t.id === 'eff.pcp1.youChoose.keepFourTypes' ? 1 : 2);
      expect(t.counterExamples.length).toBeGreaterThanOrEqual(2);
      expect(t.since).toBe(8);
      if (t.status === 'stable') expect(golden.filter((g) => g.verified.includes(`(${t.id}`)).map((g) => g.card)).toContain(NARROW[t.id]);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
});

describe('pc-players-1 guard G9 (design 6.8)', () => {
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

describe('pc-players-1 Cond reading "you have more life than an opponent" (parser/holes/cond.ts#youMoreLifeThanOpponent; CR 119.1, 102.3)', () => {
  it('"if you have more life than an opponent, draw a card" is fully automated and renders back', () => {
    expect(fullyAutomated(parse('If you have more life than an opponent, draw a card.'))).toBe(true);
    expect(fullyAutomated(parse('You gain 2 life. Then if you have more life than an opponent, draw a card.'))).toBe(true);
  });
  it('fail closed: another comparison or another player is no reading', () => {
    expect(fullyAutomated(parse('If you have more life than target player, draw a card.'))).toBe(false);
    expect(fullyAutomated(parse('If you have less life than an opponent, draw a card.'))).toBe(false);
    expect(fullyAutomated(parse('If you have more life than each opponent, draw a card.'))).toBe(false);
  });
});

describe('pc-players-1 renderer families (CR 107.3, 121.1, 608.2h)', () => {
  it('pcp1-move-where-x-group: a group\'s stat said with X renders for toughness, power and mana value alike, and only with <= / >= and a computed value', () => {
    expect(fullyAutomated(parse("Return each creature your opponents control with toughness X or less to its owner's hand, where X is the number of Islands you control."))).toBe(true);
    expect(fullyAutomated(parse("Return each creature your opponents control with power X or less to its owner's hand, where X is the number of Islands you control."))).toBe(true);
    expect(fullyAutomated(parse("Return each creature your opponents control with toughness X or less to its owner's hand, where X is 3."))).toBe(false);
  });
  it('pcp1-draw-n-for-each: two or more cards for each counted opponent; one card keeps its own template', () => {
    expect(fullyAutomated(parse('Draw three cards for each opponent who controls fewer lands than you.'))).toBe(true);
    expect(parse('Draw a card for each opponent who controls fewer lands than you.').templatesUsed).not.toContain('eff.pcp1.draw.manyForEach');
  });
});

const index = localIndex();
describe.skipIf(index === null)('pc-players-1 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) if (typeof text === 'string') for (const l of text.split('\n')) lines.add(l.trim());
    expect(MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]).filter((x) => lines.has(x))).toEqual([]);
  }, 120_000);
});
