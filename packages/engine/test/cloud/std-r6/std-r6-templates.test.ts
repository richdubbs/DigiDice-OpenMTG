/**
 * Standard round 6 (single-sentence gaps of Standard cards): the template data of parser/templates/zz-cloud/std-r6.json and the parser, lowering and renderer
 * support of the round (the condition "an opponent has more life than you", domain as a quantity, the object named through "enchanted creature's owner" as an
 * antecedent, the plural "players can't ... or ..."). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render
 * gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an
 * example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior
 * is in std-r6-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdR6 from '../../../src/parser/templates/zz-cloud/std-r6.json';
import r4dig from '../../../src/parser/templates/zz-cloud/r4-dig.json';
import r4fxb from '../../../src/parser/templates/zz-cloud/r4-fxb.json';
import review from '../../m5/golden/cards/cloud-std-r6-review.json';
import fxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R6 = stdR6 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const golden = review as Golden;
const goldenUsing = (id: string, file: Golden = golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** A synthetic card in which an example is an ability of the right kind (the round's templates are static abilities). */
const exampleCard = (text: string): OracleCard => card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' });
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('std-r6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-r6.json, after zz-cloud/std-otj.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-r6.json');
    expect(files.indexOf('zz-cloud/std-r6.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-otj.json'));
    expect(files.indexOf('zz-cloud/std-r6.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable with a hand-verified golden card, and is of version 8', () => {
    expect(R6.map((t) => t.id)).toEqual(['rst.stdr6.players.cant.draw.gainlife']);
    for (const t of R6) {
      expect(t.id, t.id).toMatch(/^rst\.stdr6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
      expect(goldenUsing(t.id).length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('design 6.9: the template the round promoted carries its evidence in its own review file (Beza, its only card, Standard-legal); the search template r4-dig held back is stable since std-finish-1 (its Standard golden card Fblthp, Knows the Way; owner approval 2026-10-21)', () => {
    const status = (file: Template[], id: string): string | undefined => file.find((t) => t.id === id)?.status;
    expect(status(r4fxb as Template[], 'eff.fxb.tokens.ifCond')).toBe('stable');
    expect(goldenUsing('eff.fxb.tokens.ifCond', fxbReview as Golden)).toEqual(['Beza, the Bounding Spring']);
    // design 6.12: its other corpus cards are not Standard-legal and were withdrawn as evidence by r4-dig's review; std-finish-1 promoted it on Fblthp
    expect(status(r4dig as Template[], 'eff.r4dig.search.differentNames.reveal')).toBe('stable');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R6) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-r6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R6) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = text.includes('\n') ? [] : [`${body} unless it is blue.`, `${body} this turn.`, `${body} during your turn.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [[/\bdraw cards\b/, 'draw more than one card'], [/\bgain life\b/, 'lose life'], [/\bEach player\b/, 'Each opponent'], [/\bcan't\b/, 'can']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-r6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R6) {
    it(`${t.id}: an appended condition or duration, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-r6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R6) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-r6 parser, lowering and renderer support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
  it('CR 119.1, 102.3: "if an opponent has more life than you" is one or more opponents with a greater life total; "more cards in hand" keeps its own reading', () => {
    const f = face('Creature — Elk', 'When this creature enters, draw a card if an opponent has more life than you.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"guard":{"cond":"compare","left":{"q":"countPlayers","of":{"ref":"each","who":"opponent"},"lifeVs":{"op":">","than":{"ref":"you"}}},"op":">=","right":1}');
    expect(JSON.stringify(face('Creature — Elk', 'When this creature enters, draw a card if an opponent has more cards in hand than you.').abilities)).toContain('"sizeVs"');
    expect(fullyAutomated(face('Creature — Elk', 'When this creature enters, draw a card if an opponent has more life than each other player.'))).toBe(false);
  });
  it('CR 305.6: "the number of basic land types among lands you control" is a quantity (FAST3 T12\'s sum); among other permanents it is not read', () => {
    const f = face('Creature — Elemental', "This creature's power is equal to the number of basic land types among lands you control.");
    expect(fullyAutomated(f)).toBe(true);
    const json = JSON.stringify(f.abilities);
    for (const t of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) expect(json).toContain(`"subtypes":["${t}"]`);
    expect(fullyAutomated(face('Sorcery', 'Draw cards equal to the number of basic land types among lands you control.'))).toBe(true);
    expect(fullyAutomated(face('Creature — Elemental', "This creature's power is equal to the number of basic land types among creatures you control."))).toBe(false);
  });
  it('design 6.4: the object a step\'s player is named through is a candidate for "it" ("enchanted creature\'s owner shuffles it"); a second candidate keeps the sentence manual', () => {
    const aura = (text: string) => parseCard(card('Example Shackle', 'Enchantment — Aura', `Enchant creature\n${text}`), OPTS).faces[0]!;
    const ok = aura("{3}: Enchanted creature's owner shuffles it into their library.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"move","what":{"ref":"attachedTo"}');
    // std-typechange-1 (DECIDED BY DEFAULT, owner instruction 2026-10-21; CR 608.2c): the creature tapped by the instruction joined by a bare "and" is the focus, so "it" is that creature, never the Aura; with "then" the unique-candidate rule still applies
    expect(fullyAutomated(aura("When this Aura enters, tap enchanted creature, then remove all counters from it."))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-r6 design 6.10 (local index): synthetic examples', () => {
  it('no std-r6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R6.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => l.trim() !== 'Flying' && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
