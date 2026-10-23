/**
 * CLOUD C4 (edict and mass-destroy riders): the template data of parser/templates/zz-cloud/c4.json ("If X is 5 or more, destroy all other artifacts and creatures."
 * after "Destroy up to one target artifact or creature with mana value X.", and the X condition "If X is 6 or more, <effects>"), the parser pieces they needed
 * (parser/chart.ts `$anaphor`, parser/lower/anaphora.ts: the template's "other" is read only in a spell, with one earlier object to leave out, and is never
 * contagious) and the renderer reading (render/np.ts, family other-than-target).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10).
 *
 * Both templates are stable (design 6.9) on hand-verified golden cards (test/m5/golden/cards/cloud-c4-review.json): the whole corpus of "If X is N or more,
 * destroy all other ..." (Martial Coup, White Sun's Twilight: "other" is the tokens just created) and five cards of the X condition. The local-index block
 * below checks those cards and that no example is a real card's line.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the C4 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import c4 from '../../../src/parser/templates/zz-cloud/c4.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import review from '../../m5/golden/cards/cloud-c4-review.json';

const C4 = c4 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a C4 example is an ability of the right kind: a sorcery with X in its mana cost (CR 107.3), or a creature for a trigger. */
function exampleCard(text: string, cost = '{X}{B}{B}'): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text, { mana_cost: cost } as Partial<OracleCard>);
  // an activated ability with X in its cost (CR 107.3, 602.1) on a creature, as the coverage tools try it (cards/src/coverage/try.ts#guessTypeLine)
  if (/^\{/.test(text)) return card('Example Totem', 'Creature — Human', text, { mana_cost: '{1}', power: '2', toughness: '2' } as Partial<OracleCard>);
  return card('Example Volley', 'Sorcery', text, { mana_cost: cost } as Partial<OracleCard>);
}
const parsedWith = (text: string, cost?: string) => parseCard(exampleCard(text, cost), OPTS).faces[0]!;
const ALL_OTHER = 'eff.c4.destroy.ifx.allother';
const IF_X = 'eff.c4.ifx.ormore';
/** Design 6.9 evidence for a sentence few real cards print: every card of the corpus that prints it, each a hand-verified golden card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  [ALL_OTHER]: { cards: ['Martial Coup', "White Sun's Twilight"], line: /If X is \d+ or (more|greater), destroy all other / },
};

describe('C4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/c4.json, path order: after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/c4.json');
    expect(files.indexOf('zz-cloud/c4.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/c4.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, is stable and of version 8', () => {
    expect(C4.map((t) => t.id)).toEqual([ALL_OTHER, IF_X]);
    for (const t of C4) {
      expect(t.id, t.id).toMatch(/^eff\.c4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe('stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable C4 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of C4) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of C4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it('the "all other" reading outranks the X condition with a bare "other" (design 6.3 rule 3: one reading, never a G5 tie)', () => {
    expect(C4.find((t) => t.id === ALL_OTHER)?.priority).toBe(1);
    expect(C4.find((t) => t.id === IF_X)?.priority).toBeUndefined();
  });
});

describe('C4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of C4) {
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
});

describe('C4: what the templates build (CR 107.3, 608.2c, 701.8a)', () => {
  it('"all other" after tokens are created leaves out those tokens (the plural antecedent, CR 608.2c, 109.2); after several targets, all of them', () => {
    const tokens = parsedWith('Create X 2/2 green Wolf creature tokens. If X is 6 or more, destroy all other creatures.');
    expect(fullyAutomated(tokens)).toBe(true);
    const steps = (tokens.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps[0]!['as']).toBe('token');
    expect(steps[1]).toEqual({ op: 'if', cond: { cond: 'compare', left: { q: 'X' }, op: '>=', right: 6 }, then: [
      { op: 'destroy', what: { ref: 'each', filter: { types: ['Creature'], not: { is: { ref: 'bound', name: 'token' } } } } },
    ] });
    const two = parsedWith('Destroy up to two target creatures. If X is 4 or more, destroy all other creatures.');
    expect(fullyAutomated(two)).toBe(true);
    expect(JSON.stringify(two.abilities)).toContain('"not":{"is":{"ref":"target","id":"t0"}}');
  });
  it('"or greater" is the same comparison as "or more" (CR 107.1)', () => {
    const more = parsedWith('Destroy target creature. If X is 4 or more, destroy all other creatures.');
    const greater = parsedWith('Destroy target creature. If X is 4 or greater, destroy all other creatures.');
    expect(fullyAutomated(greater)).toBe(true);
    expect(jsonKey(greater.abilities)).toBe(jsonKey(more.abilities));
  });
  it('"all other" leaves out the target of the earlier sentence, and only that (not: {is: target}); the type list keeps its "and"', () => {
    const f = parsedWith('Destroy up to one target artifact or creature with mana value X. If X is 5 or more, destroy all other artifacts and creatures.');
    expect(f.templatesUsed).toEqual(expect.arrayContaining(['eff.destroy', ALL_OTHER]));
    const steps = (f.abilities[0] as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps).toEqual([
      { op: 'destroy', what: { ref: 'target', id: 't0' } },
      { op: 'if', cond: { cond: 'compare', left: { q: 'X' }, op: '>=', right: 5 }, then: [
        { op: 'destroy', what: { ref: 'each', filter: { types: ['Artifact', 'Creature'], not: { is: { ref: 'target', id: 't0' } } } } },
      ] },
    ]);
  });
  it('the X condition wraps the whole instruction that follows it', () => {
    const f = parsedWith('Target player mills X cards. If X is 6 or more, you gain 3 life.');
    const steps = (f.abilities[0] as { effect: { steps: unknown[] } }).effect.steps;
    expect(steps[1]).toEqual({ op: 'if', cond: { cond: 'compare', left: { q: 'X' }, op: '>=', right: 6 }, then: [{ op: 'gainLife', who: { ref: 'you' }, amount: 3 }] });
  });
  it('shape 3 of the family ("destroy up to N target A or B with mana value X") is read by the bootstrap destroy template already, beside the rider', () => {
    for (const text of ['Destroy up to one target artifact or creature with mana value X.', 'Destroy up to two target artifacts or enchantments with mana value X.', '{X}, {T}: Destroy up to one target artifact or creature with mana value X.']) {
      const f = parseCard(text.startsWith('{') ? card('Example Rod', 'Artifact', text) : exampleCard(text), OPTS).faces[0]!;
      expect(fullyAutomated(f), text).toBe(true);
    }
  });
});

describe('C4 design 6.4 (unique-candidate rule): "other" with no single earlier object, or on a permanent, stays manual and is never contagious', () => {
  const cases: [string, string, string][] = [
    ['two candidates (two targets)', 'Destroy target creature and target artifact. If X is 4 or more, destroy all other creatures.', 'Sorcery'],
    ['no earlier object', 'Draw a card. If X is 4 or more, destroy all other creatures.', 'Sorcery'],
    ['a creature\'s trigger ("other creatures" may be other than ~)', 'When ~ enters, destroy up to one target creature. If X is 5 or more, destroy all other creatures.', 'Creature'],
  ];
  for (const [why, text] of cases) {
    it(`${why}: "${text}"`, () => {
      const f = parsedWith(text);
      expect(fullyAutomated(f), text).toBe(false);
      const a = f.abilities[0] as { kind: string; effect?: { steps: { op: string }[] } };
      // the earlier sentence stays automated: only the rider is a manual step (no contagion, design 6.7 T2)
      expect(a.kind, text).not.toBe('manual');
      expect(a.effect!.steps.map((s) => s.op), text).toEqual([text.startsWith('Draw') ? 'draw' : 'destroy', 'manual']);
    });
  }
  it('a creature\'s activated ability: "all other creatures" may be other than ~ too, manual; "all other artifacts" can only leave out the target, read', () => {
    const creatures = parsedWith('{X}, {T}: Destroy target creature. If X is 4 or more, destroy all other creatures.');
    expect(fullyAutomated(creatures)).toBe(false);
    expect((creatures.abilities[0] as { effect: { steps: { op: string }[] } }).effect.steps.map((s) => s.op)).toEqual(['destroy', 'manual']);
    const artifacts = parsedWith('{X}, {T}: Destroy target artifact. If X is 4 or more, destroy all other artifacts.');
    expect(fullyAutomated(artifacts)).toBe(true);
    expect(artifacts.templatesUsed).toContain(ALL_OTHER);
  });
  it('a card without X in its cost keeps the X sentence manual (lint bad-var, CR 107.3)', () => {
    const f = parsedWith('Destroy target creature. If X is 4 or more, destroy all other creatures.', '{2}{B}{B}');
    expect(fullyAutomated(f)).toBe(false);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/ or more/, ' or less'], [/all other/, 'all'], [/If X is/, 'If Y is'], [/destroy all/, 'exile all'], [/you gain/, 'you lose'], [/ X cards/, ' two cards'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('C4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of C4) {
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

describe('C4 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of C4) {
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

describe.skipIf(index === null)('C4 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  const texts = (c: OracleCard): string[] => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].filter((x): x is string => typeof x === 'string');
  it('no C4 line of an example or counter-example is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of texts(c)) for (const l of text.split('\n')) lines.add(l.trim());
    const verbatim = C4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => texts(c).some((x) => w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  it('the golden cards read their C4 sentence with the template, pass the render gate and are fully automated', () => {
    for (const g of review as { card: string; verified: string }[]) {
      const oracle = (index ?? []).find((c) => c.name === g.card);
      expect(oracle, g.card).toBeDefined();
      const parsed = parseCard(oracle!, OPTS);
      const id = /\((eff\.c4\.[a-z.]+)\)/.exec(g.verified)![1]!;
      expect(parsed.faces.flatMap((f) => f.templatesUsed), g.card).toContain(id);
      expect(parsed.faces.every((f) => fullyAutomated(f)), g.card).toBe(true);
    }
  }, 60_000);
});
