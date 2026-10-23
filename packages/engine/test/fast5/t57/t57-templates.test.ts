/**
 * FAST5 T57 (static and land riders): the template data of parser/templates/zz-fast5/t57.json (a land that enters tapped and chooses a color, "can't be blocked
 * except by N or more creatures", "can't be blocked by <filter> this turn", "damage can't be prevented this turn", lockdown Auras that lose all abilities and
 * don't untap, identity Auras that set a subtype and base power and toughness) and the noun-phrase postmodifier "that's <color> or <color>"
 * (parser/holes/filter.ts: "exile target creature or planeswalker that's green or blue").
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked there too
 * (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T57 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t57 from '../../../src/parser/templates/zz-fast5/t57.json';
import review from '../../m5/golden/cards/fast5-t57-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T57 = t57 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T57 example is the text: an Aura for "enchanted", a spell or an activated creature for an effect, else an artifact. */
function parsedWith(t: Template | null, text: string) {
  const attached = /enchanted/i.test(text);
  const type = t?.kind === 'effect' ? (text.includes(':') ? 'Artifact Creature — Golem' : 'Instant') : attached ? 'Enchantment — Aura' : t === null ? 'Instant' : 'Enchantment';
  return parseCard(card('Example Probe', type, text), OPTS).faces[0]!;
}

describe('T57 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t57.json, after zz-fast5/t46.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t57.json');
    expect(files.indexOf('zz-fast5/t57.json')).toBeGreaterThan(files.indexOf('zz-fast5/t46.json'));
    expect(files.indexOf('zz-fast5/t57.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T57.length).toBe(8);
    for (const t of T57) {
      expect(t.id, t.id).toMatch(/^(rep|rst|eff|sta)\.t57\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T57 template has its evidence: hand-verified golden cards (test/m5/golden/cards/fast5-t57-review.json), three where the corpus has three that are fully understood', () => {
    const golden = review as { card: string; verified: string }[];
    // the cards that are fully understood and carry each template's sentence: Standard has fewer than three for the identity Auras (one card each) and for the lockdown
    // Aura (two cards whose enters trigger says "it" with two possible antecedents are partial for another reason)
    const AVAILABLE: Readonly<Record<string, number>> = { 'sta.t57.enchanted.loseall.nountap': 2, 'sta.t57.enchanted.subtype.base.keyword.loseother': 1, 'sta.t57.enchanted.subtype.base.cantattack.loseall': 1 };
    for (const t of T57.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(Math.min(3, AVAILABLE[t.id] ?? 3));
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T57) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T57 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T57) {
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

/** Near-miss mutations of one example text (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bor more\b/, 'or fewer'], [/\bexcept by\b/, 'by'], [/\bcan't\b/, 'can'], [/\bdoesn't untap\b/, 'untaps'], [/\bloses all other\b/, 'loses all'], [/\bloses all\b/, 'loses'],
    [/\benters tapped\b/, 'enters untapped'], [/\bchoose a color\b/, 'choose two colors'], [/\bits controller's\b/, 'your'], [/\bthis turn\b/, 'next turn'], [/\bbase power\b/, 'power'],
    [/\bFrog\b/, 'Wizard Frog'], [/\bIt has\b/, 'It gets'], [/\bpower 3 or less\b/, 'power 3 or greater'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T57 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T57) {
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

describe('T57 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T57) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T57 "that\'s <color> or <color>" after a noun phrase (CR 105.2; parser/holes/filter.ts#postModAt, render/np.ts)', () => {
  const spell = (text: string) => parsedWith(null, text);
  it('"Exile target creature or planeswalker that\'s green or blue." reads the colors as the filter\'s colors and passes the render gate', () => {
    const f = spell("Exile target creature or planeswalker that's green or blue.");
    expect(fullyAutomated(f)).toBe(true);
    const step = JSON.stringify(f.abilities);
    expect(step).toContain('"colors":["G","U"]');
    expect(step).toContain('"types":["Creature","Planeswalker"]');
  });
  it('one color, two colors and the colors before the nouns are one reading each', () => {
    expect(fullyAutomated(spell("Exile target creature that's black."))).toBe(true);
    expect(jsonKey(spell("Exile target creature that's black or red.").abilities)).toBe(jsonKey(spell('Exile target black or red creature.').abilities));
  });
  it('a word that is not a color after "that\'s" is not read as one (G2)', () => {
    expect(fullyAutomated(spell("Exile target creature that's blorfty or blue."))).toBe(false);
    expect(fullyAutomated(spell("Exile target creature that's green or."))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T57 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T57 example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T57.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T57 sentence is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'rep.t57.enters.tapped.choose.color': ['Room of Refuge', 'Night Market', "Valgavoth's Lair", 'Crossroads Village', 'Uncharted Haven', 'Mirage Mesa'],
    'rst.t57.cantbeblocked.except.min': ['Relentless X-ATM092', 'Rampaging Ceratops'],
    'eff.t57.cantbeblockedby.dur': ['Verdant Outrider', 'Cavern Stomper'],
    'eff.t57.damage.unpreventable': ['Pyrewood Gearhulk', 'Impractical Joke'],
    'sta.t57.enchanted.loseall.nountap': ['Stop Cold', 'Flood the Engine', 'Infinite Coursework', "Enchanted River's Grasp"],
    'sta.t57.enchanted.subtype.base.keyword.loseother': ['Spider-Man No More'],
    'sta.t57.enchanted.subtype.base.cantattack.loseall': ['Retro-Mutation'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.length} real cards read the sentence with it and pass the render gate`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        if (c === undefined) continue;
        const f = parseCard(c, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        expect(f.gate.every((g) => g.ok), name).toBe(true);
      }
    });
  }
  it('the Standard cards of the family are fully automated (the measured gain)', () => {
    const FULL = ['Room of Refuge', 'Night Market', "Valgavoth's Lair", 'Crossroads Village', 'Uncharted Haven', 'Mirage Mesa', 'Rampaging Ceratops',
      'Verdant Outrider', 'Cavern Stomper', 'Pyrewood Gearhulk', 'Impractical Joke', 'Stop Cold', 'Flood the Engine', 'Spider-Man No More', 'Retro-Mutation', 'Refute Destiny', 'Devout Decree'];
    for (const name of FULL) {
      const c = (index ?? []).find((x) => x.name === name);
      if (c === undefined) continue;
      expect(compileCard(c).automation?.level, name).toBe('full');
    }
  });
});
