/**
 * Standard round 3, r3-moved: the template data of parser/templates/zz-cloud/r3-moved.json. Guard G9 (design 6.8): every example lowers with its template, is
 * automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a
 * nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in r3-moved-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r3moved from '../../../src/parser/templates/zz-cloud/r3-moved.json';
import review from '../../m5/golden/cards/cloud-r3-moved-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R3 = r3moved as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence few real cards print, every one of them in the tuning half
 * (the line is how the local index finds them; the test at the end checks the list against the index).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.moved.draw.foreach.cardType.among': { cards: ['Kefka, Court Mage // Kefka, Ruler of Ruin'], line: /draws? a card for each card type among cards discarded this way\./ },
  'eff.moved.put.upToOne.battlefieldTapped.yours': { cards: ['Mind Roots'], line: /Put up to one [a-z ]+ discarded this way onto the battlefield tapped under your control\./ },
};

const parsedWith = (text: string) => parseCard(card('Example Volley', 'Sorcery', text), OPTS).faces[0]!;

describe('r3-moved template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r3-moved.json, path order: after r3-fx, before std-) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r3-moved.json');
    expect(files.indexOf('zz-cloud/r3-moved.json')).toBeGreaterThan(files.indexOf('zz-cloud/r3-fx.json'));
    expect(files.indexOf('zz-cloud/r3-moved.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.moved.*', () => {
    for (const t of R3) {
      expect(t.id, t.id).toMatch(/^eff\.moved\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every tuning card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R3.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => (g.verified.match(/eff\.moved\.[A-Za-z0-9.]*[A-Za-z0-9]/g) ?? ([] as string[])).includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of R3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('r3-moved guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bdiscarded this way\b/, 'discarded this turn'], [/\bcard type\b/, 'color'], [/\bup to one\b/, 'up to two'], [/\btapped\b/, 'untapped'], [/\byour control\b/, "its owner's control"],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r3-moved guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R3) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('r3-moved guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w)) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('r3-moved design 6.10 (local index): synthetic examples, the whole corpus of each sentence, real cards', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = R3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('each card named as the whole tuning corpus of a sentence prints it (the list was taken from the tuning half, design 6.12)', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      for (const name of w.cards) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        expect([c!.oracle_text, ...(c!.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x)), `${id}: ${name}`).toBe(true);
      }
    }
  });

  // the engine readings of this slice on real tuning cards (no template of its own): each card is fully automated and passes the render gate
  const REAL: readonly string[] = ['Boneyard Desecrator', 'Glacial Dragonhunt', 'Ill-Timed Explosion', 'Spellbound Dragon', 'Painbringer', 'Evie Frye', 'Mind Roots', 'Kefka, Court Mage // Kefka, Ruler of Ruin'];
  it(`${REAL.join(', ')} are fully automated and pass the render gate`, () => {
    for (const name of REAL) {
      const oracle = (index ?? []).find((c) => c.name === name) as OracleCard | undefined;
      expect(oracle, name).toBeDefined();
      expect(compileCard(oracle!).automation.level, name).toBe('full');
      expect(parseCard(oracle!, OPTS).faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
    }
  }, 60_000);
});
