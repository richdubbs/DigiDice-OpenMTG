/**
 * FAST5 T77 (type-adding effects): the template data of parser/templates/zz-fast5/t77.json ("It's / That creature is a Demon in addition to its other types" after a return,
 * "It becomes a Bear in addition to its other types", "They are 5/5 Elemental creatures in addition to their other types", "It becomes a Spirit artifact creature in addition
 * to its other types until end of turn", "Enchanted permanent is a Construct creature with base power and toughness 5/5 in addition to its other types", "~ becomes a Bear
 * creature in addition to its other types and gains "...", "Each nonland permanent you control is all colors", "Lands you control are every basic land type in addition
 * to their other types", "Until your next turn, ~ becomes a land and gains "{T}: Add {G}"", and the two Equipment lines that add a subtype beside a quoted ability) and the
 * renderer readings they needed (render/mods.ts, render/steps-zones.ts, design 6.8 G6).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T77 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t77 from '../../../src/parser/templates/zz-fast5/t77.json';
import review from '../../m5/golden/cards/fast5-t77-review.json';
import r4FxbReview from '../../m5/golden/cards/cloud-r4-fxb-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T77 = t77 as Template[];

/** Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one real card prints, that card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  // Standard round 4 r4-fxb: the one card of the corpus whose parse uses it (golden in test/m5/golden/cards/cloud-r4-fxb-review.json); Summoner's Grimoire prints
  // the lead too, with a quoted ability no template reads, so its whole line stays manual (nothing of it is automated)
  'sta.t77.attached.addtype.quoted.lead': { cards: ["Astrologian's Planisphere"], line: /(Enchanted|Equipped) creature is an? [A-Z][a-z]+ in addition to its other types and has "Whenever you cast/ },
  'sta.t77.enchanted.subtype.creature.basept.inaddition': { cards: ['Puppet Crafting', 'Zoetic Glyph'], line: /Enchanted (permanent|artifact|land|enchantment) is an? [A-Z][a-z]+( [A-Z][a-z]+)* creature with base power and toughness \d+\/\d+ in addition to its other types/ },
  'sta.t77.each.allcolors': { cards: ['Leyline of the Guildpact'], line: /Each [a-z ]+ you control is all colors/i },
  'eff.t77.becomes.subtype.artifactcreature.inaddition.trail': { cards: ['Phantom Train'], line: /It becomes an? [A-Z][a-z]+( [A-Z][a-z]+)* artifact creature in addition to its other types until end of turn/ },
  'eff.t77.becomes.land.gains.lead': { cards: ['Hydro-Man, Fluid Felon'], line: /becomes a land and gains "/i },
  'eff.t77.becomes.subtype.creature.inaddition.gains': { cards: ["Beorn's Hospitality"], line: /\}: (?!until )[^.:]*? becomes an? [A-Z][a-z]+( [A-Z][a-z]+)* creature in addition to its other types and gains/i },
  'eff.t77.they.are.basept.subtype.types.inaddition': { cards: ['Relive the Past'], line: /They are \d+\/\d+ [A-Z][a-z]+( [A-Z][a-z]+)* creatures in addition to their other types/ },
  // std-finish-1 (owner approval 2026-10-21 of T77's Equipment templates, owner review 2026-10-17 G7): the one card whose parse uses it (golden in
  // test/m5/golden/cards/fast5-t77-review.json); Blue Mage's Cane prints the lead too, with a quoted ability no template reads, so its whole line stays manual
  'sta.t77.attached.pump.addtype.quoted': { cards: ["Ninja's Blades"], line: /(Enchanted|Equipped) creature gets [+-]\d+\/[+-]\d+, is an? [A-Z][a-z]+ in addition to its other types, and has "Whenever this creature deals combat damage to a player/ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T77 example is an ability of the right kind (a trigger is a creature's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  const aura = /^enchanted (\w+)/i.exec(text);
  if (aura) return card('Example Charm', 'Enchantment — Aura', `Enchant ${aura[1]!.toLowerCase()}
${text}`);
  if (/^equipped /i.test(text)) return card('Example Blade', 'Artifact — Equipment', text);
  if (/^(each|lands|forests|nonbasic) /i.test(text)) return card('Example Prism', 'Enchantment', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('T77 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t77.json, path order: after zz-fast4/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t77.json');
    expect(files.indexOf('zz-fast5/t77.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t77.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T77.length).toBe(11);
    for (const t of T77) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.t77\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T77 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = [...review, ...r4FxbReview] as { card: string; verified: string }[];
    for (const t of T77.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T77) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T77 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T77) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/Until your next turn/, 'Until end of turn'], [/in addition to (its|their) other types/, 'in addition to its other colors'], [/gains/, 'loses'], [/becomes/, 'gets'], [/is an? /, 'is not a '],
    [/base power and toughness/, 'power and toughness'], [/ all colors/, ' colorless'], [/every basic land type/, 'every creature type'], [/ Equipped /, ' Enchanted '],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T77 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T77) {
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

describe('T77 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T77) {
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

describe.skipIf(index === null)('T77 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T77 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T77.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's T77 line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t77.is.subtype.inaddition': ['Infernal Vessel', 'Portal to Phyrexia', 'Call a Surprise Witness', 'Thunderbolts Conspiracy'],
    'eff.t77.becomes.subtype.inaddition': ['Vault 87: Forced Evolution', 'Tyrite Sanctum', 'Captivating Vampire', 'Sealock Monster'],
    'eff.t77.they.are.basept.subtype.types.inaddition': ['Relive the Past'],
    'eff.t77.becomes.subtype.artifactcreature.inaddition.trail': ['Phantom Train'],
    'sta.t77.enchanted.subtype.creature.basept.inaddition': ['Puppet Crafting', 'Zoetic Glyph'],
    'eff.t77.becomes.subtype.creature.inaddition.gains': ["Beorn's Hospitality"],
    'sta.t77.each.allcolors': ['Leyline of the Guildpact'],
    'sta.t77.are.everybasiclandtype.inaddition': ['Leyline of the Guildpact', 'Dryad of the Ilysian Grove', 'Prismatic Omen'],
    'eff.t77.becomes.land.gains.lead': ['Hydro-Man, Fluid Felon'],
  };
  const LINE = /in addition to (its|their) other types|is all colors|becomes a land/i;
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
