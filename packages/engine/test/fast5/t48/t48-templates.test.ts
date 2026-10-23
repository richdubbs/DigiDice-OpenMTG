/**
 * FAST5 T48 (T-MANA2: mana-spend restrictions, four mana in any combination of colors, "Add X {G} or X {W}", "for each color among permanents you control,
 * add one mana of that color", "one mana of any of the exiled cards' colors", the Heartwood token): the template data of parser/templates/zz-fast5/t48.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T48 templates compose with every other file.
 *
 * FAST5X E23 reconciliation: T48's nine mana-spend restriction riders (rid.t48.mana.*) were folded into E23's general reader rid.e23.mana.spendOnly
 * (parser/holes/spend.ts, CR 106.6), which reads each of their sentences to the same JSON; their examples, reviewed counter-examples, near misses and
 * real cards are checked there now (test/fast5x/e23/e23-templates.test.ts, FOLDED).
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { namedTokenOf } from '../../../src/model/named-tokens';
import t48 from '../../../src/parser/templates/zz-fast5/t48.json';
import review from '../../m5/golden/cards/fast5-t48-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T48 = t48 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t48-review.json), or, for a sentence that fewer real
 * cards print (at most five), every card of the index that the template reads, each read by hand against its Oracle text (this table; the index check below
 * proves there is no other). A card of that corpus may stay partial for a reason outside the template (it has no golden entry then).
 */
const READERS: Readonly<Record<string, readonly string[]>> = {
  // FAST5X E23: Desolation of Smaug ("Add four mana in any combination of colors. Spend this mana only to cast Dragon spells.") is full since E23 reads its
  // restriction, by hand: four mana, each of any color, spent only on Dragon spells (CR 106.4, 106.6)
  'eff.t48.mana.any4': ['Baxter Building', 'Cosmic Crucible', 'Desolation of Smaug', 'Realm-Scorcher Hellkite'],
  // std-craft-1: Sunbird Effigy's "{T}: For each color among the exiled cards used to craft this creature, add one mana of that color.", by hand: one mana of each
  // color some card the craft cost exiled (still in exile) has (CR 105.1, 106.4, 702.167c)
  'eff.t48.mana.eachColorAmong': ['Bloom Tender', 'Faeburrow Elder', 'Tarnation Vista', 'Sunbird Standard // Sunbird Effigy'],
  'eff.t48.mana.anyOneOfTwo.whereX': ["Brigid, Clachan's Heart // Brigid, Doun's Mind"],
  'eff.t48.mana.exiledColors': ['Pit of Offerings'],
  'eff.t48.token.heartwood': ['Aerid Konstrari', 'Heartwood Crafter // Soul Tether', 'Hungering Puppetbeast', 'Konstrari Improviser // Soul Tether', 'Woodwork Prodigy // Soul Tether'],
  'eff.t48.token.heartwood.tapped': ['Tenured Tethermage'],
};
/** A cheap filter on the Oracle text of a card before it is parsed: every card the template could read has the words. */
const PREFILTER: Readonly<Record<string, RegExp>> = {
  'eff.t48.mana.any4': /four mana in any combination of colors/i,
  'eff.t48.mana.eachColorAmong': /for each color among/i,
  'eff.t48.mana.anyOneOfTwo.whereX': /add X \{\w\} or X \{\w\}/i,
  'eff.t48.mana.exiledColors': /exiled cards' colors/i,
  'eff.t48.token.heartwood': /Heartwood token/i,
  'eff.t48.token.heartwood.tapped': /tapped Heartwood tokens/i,
};
/** The lines of a card that are T48 shapes (a manual ability with one of them is the template's failure). */
const LINE = /heartwood|spend this mana only|four mana in any combination|for each color among [^,]*, add|add x \{\w\} or x|exiled cards' colors/i;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T48 example is an ability of the right kind: a sorcery for a one-shot instruction, a creature for a mana ability. */
const exampleCard = (_t: Template, text: string) => card('Example Volley', /^(You may |Create )/.test(text) ? 'Sorcery' : 'Creature — Elf Druid', text);
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T48 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t48.json, after zz-fast5/t39.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t48.json');
    expect(files.indexOf('zz-fast5/t48.json')).toBeGreaterThan(files.indexOf('zz-fast5/t39.json'));
    expect(files.indexOf('zz-fast5/t48.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T48.length).toBe(6); // FAST5X E23: the nine rid.t48.mana.* riders are folded into rid.e23.mana.spendOnly
    for (const t of T48) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.t48\./);
      expect(t.kind, t.id).toBe(t.id.startsWith('rid.') ? 'rider' : 'effect');
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T48 template has its evidence: three hand-verified golden cards, or the (at most five) cards of the corpus that it reads, all read by hand', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T48.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => (/\(([^)]*)\)/.exec(g.verified)?.[1] ?? '').split(', ').includes(t.id)).map((g) => g.card);
      const readers = READERS[t.id];
      expect(readers, t.id).toBeDefined();
      for (const c of cards) expect(readers, `${t.id}: ${c}`).toContain(c);
      if (cards.length < 3) {
        expect(readers!.length, t.id).toBeLessThanOrEqual(5);
        expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T48) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
  it('the Heartwood templates build the predefined Heartwood token (CR 111.10x since the 2026-09-25 edition), not an inline definition from the reminder text', () => {
    for (const id of ['eff.t48.token.heartwood', 'eff.t48.token.heartwood.tapped']) {
      const t = T48.find((x) => x.id === id)!;
      expect(t.cr, id).toContain('CR 111.10x');
      expect((t.build as { token: unknown }).token, id).toEqual({ predefined: 'Heartwood' });
    }
    expect(namedTokenOf({ name: 'Heartwood', colors: ['R', 'G'], types: ['Artifact'] })).toBeUndefined();
    expect(JSON.stringify(TEMPLATE_SET)).not.toContain('"name":"Heartwood"');
  });
});

describe('T48 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T48) {
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
    [/\bor\b/, 'and'], [/\band\b/, 'or'], [/\bany combination\b/, 'any one'], [/\bonly\b/, 'also'], [/\bcast\b/, 'play'], [/\bactivate\b/, 'sacrifice'], [/\bartifact\b/, 'creature'],
    [/\bcreate\b/, 'destroy'], [/\btapped\b/, 'untapped'], [/\bfor each\b/, 'for'], [/\bmana\b/, 'life'], [/\bthe exiled\b/, 'the sacrificed'], [/\bsource\b/, 'spell'], [/\bspells?\b/, 'permanents'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map(wrap);
}

describe('T48 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T48) {
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

describe('T48 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T48) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^"?\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T48 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T48 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          const noReminder = l.replace(/\s*\([^)]*\)\s*$/, '').trim(); // the reminder text is no part of the rule
          for (const x of [l, noReminder]) {
            lines.add(x.trim());
            lines.add(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
          }
        }
      }
    }
    const verbatim = T48.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => LINE.test(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the cards named as the corpus of a template are every card of the index that the template reads', () => {
    for (const [id, names] of Object.entries(READERS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && PREFILTER[id]!.test(x)))
        .filter((c) => parseCard(c, OPTS).faces.some((f) => f.templatesUsed.includes(id))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...names].sort());
    }
  }, 300_000);

  // the try step on real cards: each card's T48 line is read by the named template and passes the exact render gate, never manual on that line
  // Alchemy / playtest cards are resolved by hand whatever their lines say (CR 100.7: unsanctioned cards)
  const DIGITAL_ONLY = new Set(['Daxiver, Izzet Electromancer', 'Paradigm Shifter']);
  for (const [id, names] of Object.entries(READERS)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const used = parseCard(c!, OPTS).faces.flatMap((f) => f.templatesUsed);
        expect(used, name).toContain(id);
        const def = compileCard(c!);
        const manual = DIGITAL_ONLY.has(name) ? [] : def.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
