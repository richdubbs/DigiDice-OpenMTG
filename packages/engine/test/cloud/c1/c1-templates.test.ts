/**
 * Cloud C1 (stack riders): the template data of parser/templates/zz-cloud/c1.json ("Target spell can't be countered", "Spells you control can't be countered
 * this turn": resolved restrictions, CR 101.2, 701.6a, 611.2a, 611.2c).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the C1 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c1 from '../../../src/parser/templates/zz-cloud/c1.json';
import review from '../../m5/golden/cards/cloud-c1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const C1 = c1 as Template[];

/** Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one real card prints, that card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.c1.target.cantbecountered': { cards: ['Vexing Shusher'], line: /(^|\n|: |\. )Target spell can't be countered\./ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a C1 example is an ability of the right kind (an activated ability is a creature's, an effect on its own an instant's). */
function exampleCard(text: string): OracleCard {
  if (/^(\{[^}]*\})+(, \{T\})?: /.test(text)) return card('Example Warden', 'Creature — Goblin Shaman', text);
  return card('Example Veil', 'Instant', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('C1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c1.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c1.json');
    expect(files.indexOf('zz-cloud/c1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c1.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(C1.length).toBe(2);
    for (const t of C1) {
      expect(t.id, t.id).toMatch(/^eff\.c1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable C1 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of C1.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', "can't"]) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('C1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C1) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(fullyAutomated(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
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
  it('the static "~ can\'t be countered" and "<spells> can\'t be countered" keep their own readings (abl.cantcounter, sta.t24.spells.cantcounter)', () => {
    const self = parseCard(card('Example Bolt', 'Instant', "This spell can't be countered.\nExample Bolt deals 3 damage to any target."), OPTS).faces[0]!;
    expect(self.templatesUsed).toContain('abl.cantcounter');
    expect(self.templatesUsed.filter((id) => id.startsWith('eff.c1.'))).toEqual([]);
    const lord = parseCard(card('Example Sphinx', 'Creature — Sphinx', "Red spells you control can't be countered."), OPTS).faces[0]!;
    expect(lord.templatesUsed).toContain('sta.t24.spells.cantcounter');
    expect(lord.templatesUsed.filter((id) => id.startsWith('eff.c1.'))).toEqual([]);
  });
  // std-rx26: "has convoke / improvise / affinity for <filter>" is a nextSpell rider `keyword` now (CR 601.2a, 601.2f); any other keyword still has no rider
  it('the effect shapes that need a new engine mechanic stay manual: riders on the next spell you cast other than "can\'t be countered" and a cost keyword (no such rider; cascade and storm are riders since pc-exile-play-3)', () => {
    expect(fullyAutomated(parsedWith('The next spell you cast this turn has flash.'))).toBe(false);
  });
  it('"the next spell you cast this turn has convoke" is automated now (std-rx26 nextSpell rider `keyword`, CR 601.2a, 702.51a)', () => {
    expect(fullyAutomated(parsedWith('The next spell you cast this turn has convoke.'))).toBe(true);
  });
  it('"the next spell you cast this turn can\'t be countered" is automated now (std-r10 nextSpell, CR 601.2i, 101.2)', () => {
    expect(fullyAutomated(parsedWith("The next spell you cast this turn can't be countered."))).toBe(true);
  });
  it('changing the target of a spell with a single target is automated now (r4-fxb changeTarget, CR 115.7a)', () => {
    expect(fullyAutomated(parsedWith('Change the target of target spell or ability with a single target.'))).toBe(true);
  });
  it('choosing new targets for a spell or ability is automated now (E3XP chooseNewTargets, CR 115.7d)', () => {
    expect(fullyAutomated(parsedWith('You may choose new targets for target spell or ability.'))).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} by blue spells.`];
  const swaps: [RegExp, string][] = [
    [/can't be countered/, 'can be countered'], [/can't be countered/, "can't be copied"], [/this turn/, 'this combat'], [/Target spell/, 'Target creature'], [/you control/, 'your opponents control'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('C1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C1) {
    it(`${t.id}: an appended "unless/instead/at random/twice/by blue spells" or a swapped key word never gives the example's JSON`, () => {
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

describe('C1 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of C1) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~,' || /^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('C1 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no C1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = C1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's C1 line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.c1.target.cantbecountered': ['Vexing Shusher'],
  };
  const LINE = /can't be countered/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const c = compileCard(oracle!);
        const lineOk = c.faces.every((f) => f.abilities.every((a) => !(a.kind === 'manual' && LINE.test(a.text))));
        expect(lineOk, name).toBe(true);
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
