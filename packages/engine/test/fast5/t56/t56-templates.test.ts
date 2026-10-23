/**
 * FAST5 T56 (spell riders: discard-unless, fight follow-ups, counter-exile, flash for more, granted flashback cost, wheel-N, "if you controlled that permanent"):
 * the template data of parser/templates/zz-fast5/t56.json, the hole grammar `DiscardDesc` (parser/holes/cost.ts), the rider checks `@require` and the "unless" wrapper
 * (parser/lower/riders.ts) and the renderer's wordings.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T56 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t56 from '../../../src/parser/templates/zz-fast5/t56.json';
import review from '../../m5/golden/cards/fast5-t56-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T56 = t56 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t56-review.json), or, for a sentence that fewer real
 * cards print, every one of them (the index check below proves there is no other).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t56.discard.unlessDiscard.either': { cards: ['Steamcore Scholar'], line: /unless you discard an? [^.]* or an? [^.]* card/ },
  'eff.t56.ifIs.alsoGets': { cards: ['Goatnap'], line: /If that creature is a Goat, it also gets \+3\/\+0 until end of turn\./ },
};

/** A synthetic spell in which a T56 example is the text. */
const parsedWith = (text: string) => parseCard(card('Example Probe', 'Sorcery', text), OPTS).faces[0]!;

describe('T56 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t56.json, after zz-fast5/t46.json, before zz-fast5x/ and zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t56.json');
    expect(files.indexOf('zz-fast5/t56.json')).toBeGreaterThan(files.indexOf('zz-fast5/t46.json'));
    expect(files.indexOf('zz-fast5/t56.json')).toBeLessThan(files.indexOf('zz-fast5x/e1.json'));
    expect(files.indexOf('zz-fast5/t56.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T56.length).toBe(7); // FAST5 batch 7 merge: eff.t56.discard.unlessCond and eff.t56.controlled.draw removed, E19's 'then ... unless' and E17's 'if you controlled it' read those sentences
    for (const t of T56) {
      expect(t.id, t.id).toMatch(/^(eff|rid|sta)\.t56\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T56 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T56.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T56) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'also', 'equal']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
      if (words.includes('up') && words.includes('to')) expect(t.consumes ?? [], t.id).toContain('up to');
    }
  });
});

describe('T56 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T56) {
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
    [/\bunless you\b/, 'unless an opponent'], [/\bunless\b/, 'if'], [/\bfights\b/, 'gets'], [/\bup to (one|two|\d+)\b/, 'each'], [/\bThen\b/, 'Instead'], [/\bflashback\b/, 'flying'],
    [/\bmana cost\b/, 'power'], [/\bcontrolled\b/, 'control'], [/\bthat many\b/, 'two'], [/\bexile it\b/, 'return it'], [/\bmore\b/, 'less'], [/\bflash\b/, 'haste'],
    [/\bdiscard\b/, 'exile'], [/\bartifact or creature\b/, 'artifact and creature'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T56 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T56) {
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

describe('T56 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T56) {
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

describe('T56 the follow-up sentences stay tied to what they follow (design 6.4, 6.5)', () => {
  const spell = (text: string) => parsedWith(text);
  it('"The flashback cost is equal to its mana cost" completes a granted flashback and nothing else (parser/lower/riders.ts `@require`)', () => {
    const ok = 'Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.';
    expect(fullyAutomated(spell(ok))).toBe(true);
    expect(fullyAutomated(spell('Target instant or sorcery card in your graveyard gains haste until end of turn. The flashback cost is equal to its mana cost.'))).toBe(false);
    expect(fullyAutomated(spell('Target instant or sorcery card in your graveyard gains flashback and haste until end of turn. The flashback cost is equal to its mana cost.'))).toBe(false);
    expect(fullyAutomated(spell('The flashback cost is equal to its mana cost.'))).toBe(false);
    expect(fullyAutomated(spell('Target instant or sorcery card in your graveyard gains flashback {2}{R} until end of turn. The flashback cost is equal to its mana cost.'))).toBe(false);
  });
  it('"If that spell is countered this way, exile it instead" modifies the counter an "unless" payment carries out, and only that (parser/lower/riders.ts)', () => {
    const pay = 'Counter target spell unless its controller pays {3}.';
    const tail = " If that spell is countered this way, exile it instead of putting it into its owner's graveyard.";
    expect(fullyAutomated(spell(pay + tail))).toBe(true);
    expect(fullyAutomated(spell(`Counter target spell.${tail}`))).toBe(true);
    expect(fullyAutomated(spell(`Destroy target artifact unless its controller pays {3}.${tail}`))).toBe(false);
    expect(fullyAutomated(spell(`Counter target spell unless its controller pays {3}. Draw a card.${tail}`))).toBe(false);
  });
  it('a discard "unless you discard" names a card of the hand: a card noun is required ("a creature" is a permanent)', () => {
    expect(fullyAutomated(spell('Draw two cards. Then discard two cards unless you discard a creature card.'))).toBe(true);
    expect(fullyAutomated(spell('Draw two cards. Then discard two cards unless you discard a creature.'))).toBe(false);
    expect(fullyAutomated(spell('Draw two cards. Then discard two cards unless you discard a card.'))).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T56 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it("no T56 line of an example or counter-example is a line of a real card (with the card's own name or \"this <type>\" read as \"~\")", () => {
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
    const verbatim = T56.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the WHOLE_CORPUS cards are every card that prints the sentence', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const printing = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((t) => typeof t === 'string' && w.line.test(t))).map((c) => c.name);
      if (printing.length === 0) continue; // a partial index
      expect(printing.sort(), id).toEqual([...w.cards].sort());
    }
  });

  // the try step on real cards: each card's T56 sentences are read by the named templates and pass the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t56.discard.unlessDiscard': ['Thirst for Identity', 'Thirst for Knowledge', 'Winternight Stories', 'Alpharael, Dreaming Acolyte'],
    'eff.t56.discard.unlessDiscard.either': ['Steamcore Scholar'],
    'eff.t56.fights': ['Primal Might', 'Dragonclaw Strike', 'Troll Negotiations', 'Vigorbloom Charm', 'Chelonian Tackle'],
    'eff.t56.discard.upTo.drawThatMany': ['Greasewrench Goblin', 'Sokka, Bold Boomeranger'],
    'eff.t56.ifIs.alsoGets': ['Goatnap'],
    'rid.t56.flashback.costIsManaCost': ['Stingcaster Mage', 'Slickshot Lockpicker', "Archmage's Newt", 'Snapcaster Mage'],
    'sta.t56.cast.self.flashFor': ['Asinine Antics', 'Harbinger of the Tides', 'Mystical Tether', 'Rout'],
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
    const FULL = [
      'Thirst for Identity', 'Thirst for Knowledge', 'Winternight Stories', 'Alpharael, Dreaming Acolyte', 'Steamcore Scholar', 'Chart a Course', 'Primal Might', 'Dragonclaw Strike',
      'Troll Negotiations', 'Vigorbloom Charm', 'Chelonian Tackle', 'Syncopate', 'No More Lies', 'Asinine Antics', 'Harbinger of the Tides', 'Mystical Tether', 'Stingcaster Mage',
      "Archmage's Newt", 'Slickshot Lockpicker', 'Greasewrench Goblin', 'Sokka, Bold Boomeranger', 'Kellan, Inquisitive Prodigy // Tail the Suspect', 'Boomerang Basics', 'Goatnap',
    ];
    for (const name of FULL) {
      const c = (index ?? []).find((x) => x.name === name);
      if (c === undefined) continue;
      expect(compileCard(c).automation?.level, name).toBe('full');
    }
  });
});
