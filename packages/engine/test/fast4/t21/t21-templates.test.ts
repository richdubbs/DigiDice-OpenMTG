/**
 * FAST4 T21 (template family T-C: cost modification and casting-timing restrictions): the template data of parser/templates/zz-fast4/t21.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T21 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t21 from '../../../src/parser/templates/zz-fast4/t21.json';
import review from '../../m5/golden/cards/fast4-t21-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T21 = t21 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast4-t21-review.json), or, for a sentence that only
 * two real cards print, both of them (every corpus match reviewed; the index check below proves there is no third).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'cm.t21.self.less.colorsAmong': { cards: ['Rime Chill', 'Wildvine Pummeler'], line: /costs \{\d+\} less to cast for each color among permanents you control/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T21 example is an ability of the right kind (a spell for a spell's own cost or timing, else a creature). */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.id.startsWith('cm.t21.self.more') || t.id.startsWith('cm.t21.self.less.ifTargets')) return card('Example Volley', 'Sorcery', text);
  if (t.id.startsWith('rst.')) return card('Example Rally', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T21 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast4/t21.json, path order: after zz-fast3/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t21.json');
    expect(files.indexOf('zz-fast4/t21.json')).toBeGreaterThan(files.indexOf('zz-fast3/t18.json'));
    expect(files.indexOf('zz-fast4/t21.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7', () => {
    expect(T21.length).toBe(6);
    for (const t of T21) {
      expect(t.id, t.id).toMatch(/^(cm|rst)\.t21\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('design 6.9: a stable T21 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T21.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T21) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it('design 6.3 rule 3: "{1} more ... for each target beyond the first" keeps its stable FAST3 template (priority), any other mana gets this one', () => {
    const one = parseCard(card('Example Volley', 'Sorcery', '~ costs {1} more to cast for each target beyond the first.\nUntap any number of target lands.'), OPTS).faces[0]!;
    expect(one.templatesUsed).toContain('cm.t11.self.more.beyondFirst');
    expect(one.templatesUsed).not.toContain('cm.t21.self.more.beyondFirst.mana');
    const two = parseCard(card('Example Volley', 'Sorcery', '~ costs {1}{R} more to cast for each target beyond the first.\nUntap any number of target lands.'), OPTS).faces[0]!;
    expect(two.templatesUsed).toContain('cm.t21.self.more.beyondFirst.mana');
  });
});

describe('T21 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T21) {
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
  const lines = text.split('\n');
  // the T21 sentence is the first line of every example; the lines after it only make the card complete
  const body = lines[0]!.replace(/\.$/, '');
  const tail = lines.slice(1).map((l) => `\n${l}`).join('');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bless\b/, 'more'], [/\bmore\b/, 'less'], [/\byour opponents cast\b/, 'you cast'], [/\bfor each\b/, 'for every'], [/\bbeyond the first\b/, 'beyond the second'],
    [/\btapped\b/, 'untapped'], [/\bit targets\b/, 'you control'], [/\btarget ~\b/, 'target a creature'], [/\bpermanents you control\b/, 'permanents an opponent controls'],
    [/\bcolor among\b/, 'creature type among'], [/\bbefore blockers\b/, 'after blockers'], [/\bduring combat\b/, 'during your turn'], [/\bwhere x\b/i, 'where Y'],
    [/\btotal (power|toughness)\b/, 'greatest power'], [/\bto cast\b/, 'to activate'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => `${m}${tail}`);
}

describe('T21 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T21) {
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

describe('T21 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T21) {
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

describe.skipIf(index === null)('T21 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // the one sentence with no word to vary: "Cast ~ only during combat before blockers are declared." is a rules phrase fixed by its pattern (CR 601.3)
  const FIXED_WORDING = new Set(['rst.t21.cast.self.combatBeforeBlockers']);
  // the lines that only complete an example card ("Flying", "Trample", the effect a strive cost counts targets of) are not the T21 sentence
  const SETUP = new Set(['Flying', 'Trample']);
  it('no T21 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T21.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').slice(0, 1).some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T21 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'cm.t21.self.more.beyondFirst.mana': ['Officious Interrogation', 'Call the Coppercoats', 'Twinflame', 'Kiora\'s Dismissal', 'Desperate Stand'],
    'cm.t21.self.less.ifTargets': ['Luminous Rebuke', 'Fate of the Sun-Cryst', 'Ride\'s End', 'Fantastic Bounce', 'Magnificent End'],
    'cm.t21.spells.more.opp.targetSelf': ['Sphinx of New Prahv', 'Pursued Whale', 'Charix, the Raging Isle', 'Boreal Elemental'],
    'cm.t21.self.less.colorsAmong': ['Wildvine Pummeler', 'Rime Chill'],
    'cm.t21.self.less.whereX': ['Ghalta, Primal Hunger', 'The Lord of the Eagles', 'Volcanic Salvo'],
    'rst.t21.cast.self.combatBeforeBlockers': ['Gorilla War Cry', 'Blaze of Glory', 'Panic', 'Disharmony', 'Winter\'s Chill'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /costs? \{[^}]+\}.* (more|less) to cast|cast (this spell|~) only during combat before blockers/i;
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability for it`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = parseCard(c!, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        const def = compileCard(c!);
        const manual = def.faces[0]!.abilities.filter((a) => a.kind === 'manual' && LINE.test(a.text));
        expect(manual.map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
