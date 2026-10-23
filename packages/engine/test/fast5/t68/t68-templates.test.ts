/**
 * FAST5 T68 (static grants, conditional statics and characteristic-defining power and toughness): the template data of parser/templates/zz-fast5/t68.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T68 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t68 from '../../../src/parser/templates/zz-fast5/t68.json';
import review from '../../m5/golden/cards/fast5-t68-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T68 = t68 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t68-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other). A card of that corpus may stay partial for a reason outside the template
 * (its golden entry is then not pinned `expect: "full"`).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'sta.t68.aslong.counters.artifactcreature': { cards: ['War Balloon'], line: /^As long as this Vehicle has [a-z]+ or more [a-z]+ counters on it, it's an artifact creature\./m },
  'sta.t68.aslong.counter.nonbasic.mountains': { cards: ['Zhao, the Moon Slayer'], line: /counter on (him|her|it), nonbasic lands are Mountains\./ },
  'sta.t68.group.basept.grant': { cards: ['Archon of the Wild Rose'], line: /^Other creatures you control that are enchanted by Auras you control have base power and toughness \d+\/\d+ and have /m },
  'sta.t68.duringturn.selfAnd.grant': { cards: ['Dion, Bahamut\'s Dominant // Bahamut, Warden of Light', 'Yuna, Hope of Spira'], line: /During your turn, (Yuna|Dion) and / },
  'sta.t68.duringend.grant.each': { cards: ['Zurgo, Thunder\'s Decree'], line: /^During your end step, [A-Za-z ]+ tokens you control have "/m },
  'sta.t68.self.cantbesacrificed': { cards: ['Hithlain Rope', 'Jon Irenicus, Shattered One', 'Zurgo, Thunder\'s Decree'], line: /(^|")This (artifact|token|creature|land|enchantment) can't be sacrificed\./m },
  'sta.t68.each.cantattack.you': { cards: ['Eriette of the Charmed Apple'], line: /^Each creature that's enchanted by an Aura you control can't attack you or planeswalkers you control\./m },
  'sta.t68.grant.aslong.ownsAdventure': { cards: ['Howling Galefang'], line: /as long as you own a card in exile that has an Adventure\./ },
  'sta.t68.self.grant.aslong.notDealtCombatDamageYet': { cards: ['Ruric Thar, Magecrusher'], line: /as long as they haven't dealt combat damage yet\./ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T68 example is an ability: a static ability of a creature. */
const exampleCard = (_t: Template, text: string) => card('Example Volley', 'Creature — Example', text);
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T68 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t68.json, after zz-fast5/t54.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t68.json');
    expect(files.indexOf('zz-fast5/t68.json')).toBeGreaterThan(files.indexOf('zz-fast5/t54.json'));
    expect(files.indexOf('zz-fast5/t68.json')).toBeLessThan(files.indexOf('zz-fast5x/e1.json'));
    expect(files.indexOf('zz-fast5/t68.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T68.length).toBe(10);
    for (const t of T68) {
      expect(t.id, t.id).toMatch(/^sta\.t68\./);
      expect(t.kind, t.id).toBe('static');
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T68 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T68.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T68) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T68 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T68) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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
    [/\bduring your\b/i, 'during an opponent\'s'], [/\byou control\b/, 'an opponent controls'], [/\bhave\b/, 'lose'], [/\bgets\b/, 'loses'], [/\bor more\b/, 'or fewer'],
    [/\bown\b/, 'control'], [/\bnonbasic\b/, 'basic'], [/\bcan't\b/, 'can'], [/\bother\b/, 'each other'], [/\beach\b/, 'target'], [/\bas long as\b/, 'if'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map(wrap);
}

describe('T68 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T68) {
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

/** The counter kind is any word before "counters" (the CounterKind hole takes unlisted words, as every counter template of the set does). */
const COUNTER_WORD = /\b(wind|spark|siege|flame)\b/;

describe('T68 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T68) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n') || COUNTER_WORD.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T68 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T68 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          const bareLine = l.replace(/\s*\([^)]*\)\s*$/, '').trim(); // the reminder text is no part of the rule
          for (const x of [l, bareLine]) {
            lines.add(x.trim());
            lines.add(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|token|Vehicle)\b/gi, '~').trim());
          }
        }
      }
    }
    // keyword lines are no copied text; "~ can't be sacrificed." is the whole four-word sentence of its template (a real card prints it as "This artifact can't be
    // sacrificed."), so no other wording of that example exists; a static example is parsed as an Enchantment (mutation harness), whose only self noun is "~"
    const SHAPE_IS_THE_SENTENCE = new Set(["~ can't be sacrificed."]);
    const verbatim = T68.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].flatMap((x) => x.split('\n')).filter((l) => l.split(' ').length >= 4 && !SHAPE_IS_THE_SENTENCE.has(l.trim()) && lines.has(l.trim())).map((l) => `${t.id}: ${l}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T68 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, { names: readonly string[]; line: RegExp }>> = {
    'sta.t68.aslong.counters.artifactcreature': { names: ['War Balloon'], line: /fire counters on it/ },
    'sta.t68.aslong.counter.nonbasic.mountains': { names: ['Zhao, the Moon Slayer'], line: /nonbasic lands are Mountains/ },
    'sta.t68.pump.foreach.colorsAmong': { names: ['Earthen Ally', 'Faeburrow Elder', "Conqueror's Flail"], line: /for each color among/ },
    'sta.t68.group.basept.grant': { names: ['Archon of the Wild Rose'], line: /have base power and toughness/ },
    'sta.t68.duringturn.selfAnd.grant': { names: ['Yuna, Hope of Spira', "Dion, Bahamut's Dominant // Bahamut, Warden of Light"], line: /^During your turn/ },
    'sta.t68.duringend.grant.each': { names: ["Zurgo, Thunder's Decree"], line: /^During your end step/ },
    'sta.t68.self.cantbesacrificed': { names: ["Zurgo, Thunder's Decree", 'Hithlain Rope'], line: /can't be sacrificed/ },
    'sta.t68.each.cantattack.you': { names: ['Eriette of the Charmed Apple'], line: /can't attack you or planeswalkers/ },
    'sta.t68.grant.aslong.ownsAdventure': { names: ['Howling Galefang'], line: /own a card in exile/ },
    'sta.t68.self.grant.aslong.notDealtCombatDamageYet': { names: ['Ruric Thar, Magecrusher'], line: /dealt combat damage yet/ },
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  for (const [id, { names, line: LINE }] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const used = parseCard(c!, OPTS).faces.flatMap((f) => f.templatesUsed);
        expect(used, name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
