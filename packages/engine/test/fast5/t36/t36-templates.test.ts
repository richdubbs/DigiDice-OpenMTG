/**
 * FAST5 T36 (prevention with a chosen source, a casting restriction on being attacked, a loss of the game at the end step of the extra turn, a discard
 * replaced by the battlefield): the template data of parser/templates/zz-fast5/t36.json.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked
 * there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T36 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t36 from '../../../src/parser/templates/zz-fast5/t36.json';
import review from '../../m5/golden/cards/fast5-t36-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T36 = t36 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t36-review.json), or, for a sentence that fewer
 * real cards print, every one of them (the index check below proves there is no other). `partialCards`: a card of that corpus whose other lines stay manual
 * for a reason outside the template, so it is not pinned `expect: "full"`.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; partialCards?: readonly string[] }>> = {
  'rst.t36.cast.self.declareAttackersAttacked': {
    cards: ["Assassin's Blade", "Champion's Victory", 'Command of Unsummoning', 'Deep Wood', 'Defiant Stand', 'Eightfold Maze', 'Harsh Justice', 'Heavy Fog', 'Just Fate', 'Rally the Troops', 'Remove', 'Scorching Winds', 'Treetop Defense', "Warrior's Stand"],
    line: /^Cast this spell only during the declare attackers step and only if you've been attacked this step\./m,
  },
  'dl.t36.thatTurnEnd.loseGame': { cards: ["Alchemist's Gambit", 'Chance for Glory', 'Final Fortune', 'Last Chance', "Warrior's Oath"], partialCards: ["Alchemist's Gambit", 'Chance for Glory'], line: /At the beginning of that turn's end step, you lose the game\./ },
  'rep.t36.self.discardedByOpponent.battlefield': { cards: ['Loxodon Smiter', 'Nullhide Ferox', 'Obstinate Baloth', 'Wilt-Leaf Liege'], partialCards: ['Nullhide Ferox'], line: /put it onto the battlefield instead of putting it into your graveyard\./ },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T36 example is an ability of the right kind: a spell's own timing on an instant, a static on a creature, an ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'static' && t.id.startsWith('rst.')) return card('Example Volley', 'Instant', text);
  if (t.kind === 'effect' && !text.includes(':')) return card('Example Volley', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T36 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t36.json, after zz-fast4/t34.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t36.json');
    expect(files.indexOf('zz-fast5/t36.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t36.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T36.length).toBe(4);
    for (const t of T36) {
      expect(t.id, t.id).toMatch(/^(rst|eff|dl|rep)\.t36\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T36 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T36.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.partialCards?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T36) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T36 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T36) {
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
  const mine = lines.findIndex((l) => !/^(Flying|Trample)$/.test(l));
  const body = lines[mine]!.replace(/\.$/, '');
  const rest = (b: string): string => lines.map((l, i) => (i === mine ? b : l)).join('\n');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bthe next time\b/, 'each time'], [/\bto you\b/, 'to target player'], [/\bsource of your choice\b/, 'source'], [/\bprevent that damage\b/, 'prevent half that damage'],
    [/\bthis turn\b/, 'this combat'], [/\bonly if you've been attacked\b/, 'only if you attacked'], [/\bdeclare attackers\b/, 'declare blockers'],
    [/\bthat turn's end step\b/, 'the next end step'], [/\byou lose the game\b/, 'you win the game'], [/\ban opponent controls\b/, 'you control'], [/\bonto the battlefield\b/, 'into your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => rest(m.replace(/\.$/, '') + '.'));
}

describe('T36 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T36) {
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

describe('T36 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T36) {
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

describe.skipIf(index === null)('T36 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // sentences with no word to vary: rules phrases fixed by their pattern (CR 601.3, 506.3; CR 500.7; CR 701.9a)
  const FIXED_WORDING = new Set(['rst.t36.cast.self.declareAttackersAttacked', 'dl.t36.thatTurnEnd.loseGame', 'rep.t36.self.discardedByOpponent.battlefield']);
  const SETUP = new Set(['Flying', 'Trample', 'Draw a card.', 'Take an extra turn after this one.']);
  it('no T36 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T36.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T36 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'rst.t36.cast.self.declareAttackersAttacked': ['Defiant Stand', "Warrior's Stand", 'Just Fate', 'Rally the Troops', 'Remove'],
    'eff.t36.prevent.nextSourceOfChoice.you': ['Circle of Protection: Red', 'Circle of Protection: White', 'Rune of Protection: Blue', 'Rune of Protection: Black'],
    'dl.t36.thatTurnEnd.loseGame': ['Final Fortune', 'Last Chance', "Warrior's Oath", 'Chance for Glory'],
    'rep.t36.self.discardedByOpponent.battlefield': ['Wilt-Leaf Liege', 'Loxodon Smiter', 'Obstinate Baloth', 'Nullhide Ferox'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /cast (this spell|~) only|source of your choice|extra turn|causes you to discard/i;
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
