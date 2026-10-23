/**
 * FAST5 T46 (hand disruption: reveal or look at a hand, choose a card from it, that player discards it or you exile it): the template data of
 * parser/templates/zz-fast5/t46.json and the hole grammars `HandCard` / `ChosenCard` (parser/holes/object.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T46 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t46 from '../../../src/parser/templates/zz-fast5/t46.json';
import review from '../../m5/golden/cards/fast5-t46-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T46 = t46 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic spell in which a T46 example is the text. */
const parsedWith = (text: string) => parseCard(card('Example Probe', 'Sorcery', text), OPTS).faces[0]!;

describe('T46 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t46.json, after zz-fast5/t37.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t46.json');
    expect(files.indexOf('zz-fast5/t46.json')).toBeGreaterThan(files.indexOf('zz-fast5/t37.json'));
    expect(files.indexOf('zz-fast5/t46.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T46.length).toBe(3);
    for (const t of T46) {
      expect(t.id, t.id).toMatch(/^eff\.t46\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T46 template has its evidence: three hand-verified golden cards (test/m5/golden/cards/fast5-t46-review.json)', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T46.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T46) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T46 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T46) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
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

/** Near-miss mutations of one example text (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bnonland\b/, 'land'], [/\bfrom it\b/, 'from their graveyard'], [/\bchoose\b/, 'exile'], [/\bYou choose\b/, 'Target opponent chooses'], [/\bThat player discards\b/, 'You discard'],
    [/\bdiscards that card\b/, 'discards a card'], [/\breveals their hand\b/, 'reveals their library'], [/\bLook at target player's hand\b/, "Look at target player's graveyard"],
    [/\bExile that card\b/, 'Return that card to its owner\'s hand'], [/\bYou may choose\b/, 'You must choose'], [/\bartifact or creature\b/, 'artifact and creature'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T46 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T46) {
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

describe('T46 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T46) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || w.includes('\n')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('T46 the pronouns stay tied to the hand and the chosen card (design 6.4; the holes `HandCard` and `ChosenCard`)', () => {
  const spell = (text: string) => parsedWith(text);
  it('"it" in "choose a card from it" names a hand that a step revealed or looked at, and nothing else', () => {
    expect(fullyAutomated(spell('Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.'))).toBe(true);
    expect(fullyAutomated(spell("Look at target player's hand. You choose a nonland card from it. That player discards that card."))).toBe(true);
    // no hand before it, a hand that was only counted, or a target creature in between: the pronoun has no antecedent, or not a unique one
    expect(fullyAutomated(spell('You choose a nonland card from it. That player discards that card.'))).toBe(false);
    expect(fullyAutomated(spell('Target opponent draws a card. You choose a nonland card from it. That player discards that card.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy target creature. You choose a nonland card from it. That player discards that card.'))).toBe(false);
  });
  it('"that card" of "discards that card" is the card a choice picked, never a target, the source or a revealed hand', () => {
    expect(fullyAutomated(spell('Target opponent reveals their hand. That player discards that card.'))).toBe(false);
    expect(fullyAutomated(spell('Exile target creature card from a graveyard. Target opponent discards that card.'))).toBe(false);
    expect(fullyAutomated(spell('Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.'))).toBe(true);
  });
  it('two players named earlier make "that player" ambiguous: manual, never a guess', () => {
    const f = spell('Target player gains 2 life. Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.');
    expect(fullyAutomated(f)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T46 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  const SETUP = new Set(['Target opponent reveals their hand.', 'Target player reveals their hand.', "Look at target player's hand.", 'Exile that card.']);
  it('no T46 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // an example is whole sentences of a spell; a real card prints these as one line of several sentences, so compare the full example text
    const verbatim = T46.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T46 sentences are read by the named templates and pass the exact render gate, never manual on those sentences
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t46.hand.choose': ['Duress', 'Pilfer', 'Intimidation Tactics', 'Gastal Raider', 'Aggressive Negotiations', 'Soul Search', 'Kitesail Freebooter', 'Poison the Waters', 'Auntie\'s Sentence', 'Dai Li Indoctrination', 'Cerebral Confiscation', 'Solve for Disappointment', 'Render Speechless', 'Down, Down to Goblin-town', 'Thoughtseize', 'Coercion'],
    'eff.t46.hand.choose.may': ['Cracked Skull', 'Extract the Truth', 'Severance Priest'],
    'eff.t46.discard.chosen': ['Duress', 'Pilfer', 'Gastal Raider', 'Cracked Skull', 'Cerebral Confiscation', 'Poison the Waters', 'Auntie\'s Sentence', 'Solve for Disappointment', 'Thoughtseize', 'Coercion'],
  };
  const LINE = /choose an? .* from it|discards that card|reveals their hand|look at target (player|opponent)'s hand/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.length} real cards read the sentence with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        if (c === undefined) continue; // Thoughtseize and the like are in the full index only
        const f = parseCard(c, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        expect(f.gate.every((g) => g.ok), name).toBe(true);
        const def = compileCard(c);
        const manual = def.faces[0]!.abilities.filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
  it('the Standard cards of the family are fully automated (the measured gain)', () => {
    const FULL = ['Duress', 'Pilfer', 'Intimidation Tactics', 'Gastal Raider', 'Aggressive Negotiations', 'Soul Search', 'Poison the Waters', "Auntie's Sentence", 'Dai Li Indoctrination', 'Cerebral Confiscation', 'Solve for Disappointment', 'Render Speechless', 'Down, Down to Goblin-town', 'Cracked Skull'];
    for (const name of FULL) {
      const c = (index ?? []).find((x) => x.name === name);
      if (c === undefined) continue;
      expect(compileCard(c).automation?.level, name).toBe('full');
    }
  });
});
