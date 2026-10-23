/**
 * FAST5 T47 (T-ANIMATE: "becomes a creature" animation, "it's still a land" riders, Enduring's return as an enchantment): the template data of
 * parser/templates/zz-fast5/t47.json. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards
 * each template reads are checked there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T47 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t47 from '../../../src/parser/templates/zz-fast5/t47.json';
import review from '../../m5/golden/cards/fast5-t47-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T47 = t47 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t47-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other). A card of that corpus may stay partial for a reason outside the template
 * (its golden entry is then not pinned `expect: "full"`). `line` is tested on the text of each card with its name and "this <type>" read as "~".
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t47.becomes.creature.with.allcreaturetypes.permanent': { cards: ['Soulstone Sanctuary'], line: /(^|[:.]\s+)~ becomes an? \d+\/\d+ creature with [^.]*and all creature types\./m },
  'eff.t47.becomes.artifactcreature.gains.lead': { cards: ['Chandra, Spark Hunter', 'Katsumasa, the Animator', 'Voyager Glidecar'], line: /Until end of turn, (it|~|target [A-Za-z ]+?) becomes an artifact creature and gains [a-z, ]+\./ },
  'eff.t47.becomes.artifactcreature.basept.lead': { cards: ['Behind the Mask', 'Mind Transfer Protocol', 'Suit Up'], line: /Until end of turn, (it|~|target [A-Za-z ]+?) becomes an artifact creature with base power and toughness \d+\/\d+\./ },
  'eff.t47.becomes.subtype.basept.gains.permanent': { cards: ['Tenth District Hero'], line: /(^|: )~ becomes an? [A-Z]\w+ [A-Z]\w+ with base power and toughness \d+\/\d+ and gains [a-z, ]+\.$/m },
  'eff.t47.becomes.subtype.creature.with.inaddition': { cards: ['Case of the Filched Falcon', 'Emergent Haunting'], line: /(^|\. |: |, )(?<!Until end of turn, )([Ii]t|~|That [a-z]+) becomes an? \d+\/\d+ [A-Z]\w+( [A-Z]\w+)* creature with [a-z ,]+ in addition to its other types\./m },
  'eff.t47.then.may.become.subtype.creature': { cards: ['Crawling Barrens'], line: /Then you may have (it|~|that [a-z]+) become an? \d+\/\d+ [A-Z]\w+( [A-Z]\w+)* creature until end of turn\./ },
  'rid.t47.stillSubtypeLand': { cards: ['Cavernous Maw'], line: /It's still an? [A-Z]\w+ land\./ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T47 example is an ability of the right kind: a spell on a sorcery. */
const exampleCard = (_t: Template, text: string) => card('Example Volley', 'Sorcery', text);
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T47 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t47.json, after zz-fast5/t39.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t47.json');
    expect(files.indexOf('zz-fast5/t47.json')).toBeGreaterThan(files.indexOf('zz-fast5/t39.json'));
    expect(files.indexOf('zz-fast5/t47.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T47.length).toBe(14); // FAST5 batch 5 merge: 'becomes an artifact creature' is FAST5X E10's eff.e10.becomes.artifactcreature.noDuration (the same pattern and JSON)
    for (const t of T47) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.t47\./);
      expect(t.kind, t.id).toBe(t.id.startsWith('rid.') ? 'rider' : 'effect');
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T47 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T47.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T47) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T47 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T47) {
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
    [/\btarget\b/, 'each'], [/\bgains\b/, 'loses'], [/\bwith\b/, 'without'], [/\bin addition to its other types\b/, 'instead of its other types'], [/\ban? (\d+\/\d+)/, 'a +$1'],
    [/\byou control\b/, 'an opponent controls'], [/\bit's an enchantment\b/i, "it's an artifact"], [/\bcreature\b/, 'planeswalker'], [/\bmay\b/, 'must'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map(wrap);
}

describe('T47 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T47) {
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

describe('T47 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T47) {
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

describe.skipIf(index === null)('T47 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T47 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          const bare = l.replace(/\s*\([^)]*\)\s*$/, '').trim(); // the reminder text is no part of the rule
          for (const x of [l, bare]) {
            lines.add(x.trim());
            lines.add(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
          }
        }
      }
    }
    const verbatim = T47.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split(/(?<=\.)\s+/).some((l) => /become|still a|an enchantment/.test(l) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T47 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t47.becomes.colors.subtype.creature.with.lead': ['Restless Vents', 'Restless Spire', 'Restless Reef', 'Restless Vinestalk', 'Restless Anchorage'],
    'eff.t47.becomes.colors.subtype.creature.trail': ['Restless Bivouac', 'Restless Cottage', 'Restless Fortress', 'Restless Prairie', 'Restless Ridgeline'],
    'eff.t47.becomes.subtype.creature.trail': ['Cavernous Maw', 'Hostile Desert', 'Skarrg Guildmage'],
    'eff.t47.becomes.subtype.creature.with.lead': ['Disturbed Slumber', 'Kamahl, Heart of Krosa', 'Nissa, Vital Force'],
    'eff.t47.becomes.creature.with.allcreaturetypes.permanent': ['Soulstone Sanctuary'],
    'eff.t47.becomes.artifactcreature.basept.lead': ['Mind Transfer Protocol', 'Suit Up'],
    'eff.e10.becomes.artifactcreature.noDuration': ['Rocketeer Boostbuggy', "Marshals' Pathcruiser", 'Tune Up', 'Tezzeret, Betrayer of Flesh'],
    'eff.t47.becomes.artifactcreature.gains.lead': ['Voyager Glidecar', 'Chandra, Spark Hunter', 'Katsumasa, the Animator'],
    'eff.t47.becomes.subtype.basept.gains.lead': ['Reptil, Dinomorpher', 'Nogi, Draco-Zealot', "Mordenkainen's Polymorph"],
    'eff.t47.becomes.subtype.basept.gains.permanent': ['Tenth District Hero'],
    'eff.t47.becomes.subtype.creature.inaddition': ['Ride the Shoopuf', 'Haunted Screen', 'Pizza Face, Gastromancer', 'Does Machines'],
    'eff.t47.becomes.subtype.creature.with.inaddition': ['Case of the Filched Falcon', 'Emergent Haunting'],
    'eff.t47.then.may.become.subtype.creature': ['Crawling Barrens'],
    'eff.t47.itis.enchantment': ['Enduring Courage', 'Enduring Innocence', 'Enduring Tenacity', 'Enduring Curiosity', 'Enduring Vitality'],
    'rid.t47.stillSubtypeLand': ['Cavernous Maw'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string'
        && w.line.test(x.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|permanent|vehicle)\b/gi, '~').replace(/\([^)]*\)/g, '')))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /become|still an? |an enchantment/i;
  for (const [id, names] of Object.entries(REAL)) {
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
