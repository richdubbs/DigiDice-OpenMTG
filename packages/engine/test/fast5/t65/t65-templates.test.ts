/**
 * FAST5 T65 (T7-C: counter placement and card-draw steps): the template data of parser/templates/zz-fast5/t65.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated
 * ability (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are
 * checked there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T65 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t65 from '../../../src/parser/templates/zz-fast5/t65.json';
import review from '../../m5/golden/cards/fast5-t65-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T65 = t65 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t65-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other). A card of that corpus may stay partial for a reason outside the template
 * (its golden entry is then not pinned `expect: "full"`).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'rep.t65.enters.counters.keyword.ifControl': { cards: ['Dust Animus'], line: /If you control [^,.]+, [^.]*enters with [^.]*counters and an? [a-z]+ counter on it/ },
  'eff.t65.counters.put.self.cantBeBlocked': { cards: ['Sahagin'], line: /put an? [^.]*counter on [^.]* and it can't be blocked this turn/ },
  'eff.t65.counters.distribute.thenDouble': { cards: ['Biogenic Upgrade'], line: /[Dd]istribute [^.]*counters among [^.]*, then double the number of/ },
  'rep.t65.each.enters.additionalCounter.forEach': { cards: ['Bioengineered Future'], line: /enters with an additional [^.]*counter on it for each [^.]*entered the battlefield under your control this turn/ },
  'eff.t65.draw.loseLife.putCounter': { cards: ['Robot Domination'], line: /you draw (?:a|[a-z]+) cards?, lose [a-z0-9]+ life, and put/ },
  'eff.t65.counters.put.thenTokensAttacking.whereX': { cards: ['Anim Pakal, Thousandth Moon'], line: /put an? [^.]*counter on [^.]*, then create X [^.]*tapped and attacking, where X is/ },
  'eff.t65.explores.xTimes': { cards: ['Jadelight Spelunker'], line: /explores X times/ },
  'eff.t65.sacrifice.anyNumber.thenDraw': { cards: ['Malevolent Witchkite'], line: /sacrifice any number of [^.,]+, [^.,]+, and\/or tokens, then draw that many cards/ },
  'eff.t65.draw.twoToTheX': { cards: ['Mathemagics'], line: /draws? 2\u02e3 cards/ },
  'eff.t65.eachMay.shuffleHandGraveyard.thenDraw': { cards: ['Turtles in Time'], line: /[Ee]ach player may shuffle their hand and graveyard into their library, then each player who does draws/ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T65 example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
const exampleCard = (t: Template, text: string) => card('Example Volley', t.kind === 'static' ? 'Creature — Wizard' : /^(?:when|whenever|at|if)\b/i.test(text) || text.includes(':') ? 'Creature — Wizard' : 'Sorcery', text);
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
/**
 * FAST5 batch 8 integration: FAST5 T58 (merged first) reads "draw a card for each color among <objects>" with a template of the same build
 * (eff.t58.draw.foreach.color.among): the chart keeps one reading of the line, so a line this T65 template reads may be credited to that one. Same JSON either way.
 */
const SAME_BUILD: Readonly<Record<string, string>> = { 'eff.t65.draw.forEachColorAmong': 'eff.t58.draw.foreach.color.among' };
const readsWith = (used: readonly string[], id: string): boolean => used.includes(id) || (SAME_BUILD[id] !== undefined && used.includes(SAME_BUILD[id]!));

describe('T65 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t65.json, after zz-fast5/t50.json, before zz-fast5x/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t65.json');
    expect(files.indexOf('zz-fast5/t65.json')).toBeGreaterThan(files.indexOf('zz-fast5/t50.json'));
    expect(files.indexOf('zz-fast5/t65.json')).toBeLessThan(files.indexOf('zz-fast5x/e1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T65.length).toBe(12);
    for (const t of T65) {
      expect(t.id, t.id).toMatch(/^(?:eff|rep)\.t65\./);
      expect(['effect', 'static'], t.id).toContain(t.kind);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T65 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T65.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T65) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z\u02e3/']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'distribute', 'double', 'then', 'times', 'and/or']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T65 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T65) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(readsWith(f.templatesUsed, t.id), `${e.text}: ${f.templatesUsed.join()}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const sentences = text.split(/(?<=\.)\s+/);
  const last = sentences.length - 1;
  const body = sentences[last]!.replace(/\.$/, '');
  const before = sentences.slice(0, last).join(' ');
  const wrap = (m: string): string => `${before === '' ? '' : `${before} `}${m.replace(/\.$/, '')}.`;
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\btarget\b/, 'each'], [/\bcreate a\b/, 'create two'], [/\bfor each\b/, 'for'], [/\battached to\b/, 'on'], [/\bgain\b/, 'lose'],
    [/\bthose creatures\b/, 'creatures you control'], [/\byou control\b/, 'an opponent controls'], [/\bthat\b/, 'another'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map(wrap);
}

describe('T65 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T65) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T65 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T65) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T65 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T65 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          const bareLine = l.replace(/\s*\([^)]*\)\s*$/, '').trim(); // the reminder text is no part of the rule
          for (const x of [l, bareLine]) {
            lines.add(x.trim());
            lines.add(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
          }
        }
      }
    }
    const verbatim = T65.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T65 line is read by the named template and passes the render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t65.counters.put.nAndKeyword': ['Kheru Goldkeeper', 'Sagu Pummeler', 'Guide of Souls', 'Donald Blake, Guise of Thor', 'Experimental Lab // Staff Room'],
    'rep.t65.enters.counters.keyword.ifControl': ['Dust Animus'],
    'eff.t65.counters.put.self.cantBeBlocked': ['Sahagin'],
    'eff.t65.counters.distribute.thenDouble': ['Biogenic Upgrade'],
    'rep.t65.each.enters.additionalCounter.forEach': ['Bioengineered Future'],
    'eff.t65.draw.loseLife.putCounter': ['Robot Domination'],
    'eff.t65.counters.put.thenTokensAttacking.whereX': ['Anim Pakal, Thousandth Moon'],
    'eff.t65.draw.forEachColorAmong': ['Karn, Gilded Guardian', 'Soul of Ravnica', 'Chromatic Orrery', 'Mondo Gecko'],
    'eff.t65.explores.xTimes': ['Jadelight Spelunker'],
    'eff.t65.sacrifice.anyNumber.thenDraw': ['Malevolent Witchkite'],
    'eff.t65.draw.twoToTheX': ['Mathemagics'],
    'eff.t65.eachMay.shuffleHandGraveyard.thenDraw': ['Turtles in Time'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /counters and an? [a-z]+ counter|enters with [^.]*counters and|can't be blocked this turn|distribute|additional [^.]*counter|draw (?:a|[a-z]+) cards?, lose|then create X|for each color among|explores X times|sacrifice any number of [^.,]+, [^.,]+, and\/or|2\u02e3|shuffle their hand and graveyard/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const used = parseCard(c!, OPTS).faces.flatMap((f) => f.templatesUsed);
        expect(readsWith(used, id), `${name}: ${used.join()}`).toBe(true);
        const def = compileCard(c!);
        const manual = def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
