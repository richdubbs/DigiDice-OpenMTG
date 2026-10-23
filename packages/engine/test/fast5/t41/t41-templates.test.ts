/**
 * FAST5 T41 (until-end-of-turn grants of quoted abilities and compound pump / grant / type changes): the template data of
 * parser/templates/zz-fast5/t41.json. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present; the real
 * cards each template reads are checked there too (the try step of CONTRIBUTING "Adding a template").
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T41 templates compose with every other file. The
 * other shapes of the package (a quoted ability granted until end of turn, "he", "that much" after "that many", "counters on them") need no template of
 * their own: they are covered by the renderer and the hole grammars, in t41-scenarios.test.ts and the golden cards.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t41 from '../../../src/parser/templates/zz-fast5/t41.json';
import review from '../../m5/golden/cards/fast5-t41-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T41 = t41 as Template[];

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards (test/m5/golden/cards/fast5-t41-review.json), or, for a sentence that fewer
 * real cards print, every one of them (the index check below proves there is no other). `partialCards`: a card of that corpus whose other lines stay manual
 * for a reason outside the template, so it is not pinned `expect: "full"`.
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp; partialCards?: readonly string[] }>> = {
  'eff.t41.each.pump.grant': { cards: ['Rabid Attack'], line: /^Until end of turn, any number of target creatures you control each get \+1\/\+0 and gain "/m },
  'eff.t41.pump.grant.becomes.enchantmentCreature': { cards: ['Jump Scare'], line: /^Until end of turn, target creature gets \+2\/\+2, gains flying, and becomes a Horror enchantment creature in addition to its other types\./m },
  'eff.t41.becomes.addtype.gains': { cards: ['Enter the Avatar State'], line: /^Until end of turn, target creature you control becomes an Avatar in addition to its other types and gains /m },
  'eff.t41.pump.becomes.addtype': { cards: ['Stegron the Dinosaur Man'], line: /^Dinosaur Formula .*Until end of turn, target creature you control gets \+3\/\+1 and becomes a Dinosaur in addition to its other types\./m },
  'eff.t41.pump.pair.duration': { cards: ['Rookie Mistake', 'Skulduggery'], line: /^Until end of turn, target creature( you control)? gets [+-]\d\/[+-]\d and (another )?target creature( an opponent controls)? gets [+-]\d\/[+-]\d\./m },
  'eff.t41.double.thePowerOf': { cards: ['Mightform Harmonizer', 'Unleash Fury'], line: /[Dd]ouble the power of target creature( you control)? until end of turn\./ },
  'eff.t41.pump.loses.creatureTypes': { cards: ['Nameless Inversion'], line: /^Target creature gets \+3\/-3 and loses all creature types until end of turn\./m },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T41 example is an ability of the right kind: a spell on an instant, a triggered or activated ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T41 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t41.json, after zz-fast4/t34.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t41.json');
    expect(files.indexOf('zz-fast5/t41.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t41.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T41.length).toBe(8);
    for (const t of T41) {
      expect(t.id, t.id).toMatch(/^eff\.t41\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T41 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T41.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole && cards.length < 3) expect(cards.slice().sort(), t.id).toEqual(whole.cards.filter((c) => !whole.partialCards?.includes(c)).sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T41) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T41 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T41) {
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
  const mine = Math.max(0, lines.findIndex((l) => !/^(Flying|Trample)$/.test(l)));
  const body = lines[mine]!.replace(/\.$/, '');
  const rest = (b: string): string => lines.map((l, i) => (i === mine ? b : l)).join('\n');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\beach get\b/, 'each gets'], [/\band gain\b/, 'and lose'], [/\band gains\b/, 'and loses'], [/\bUntil end of turn,/, 'Until your next turn,'], [/\buntil end of turn\b/, 'until your next turn'],
    [/\bin addition to its other types\b/, 'in addition to its other colors'], [/\band target\b/, 'or target'], [/\bcreature types\b/, 'land types'], [/\byour choice of\b/, 'the choice of'],
    [/\bor (flying|first strike|vigilance|reach)\b/, 'and $1'], [/\bdouble the power\b/, 'double the toughness'], [/\bbecomes an? ([A-Za-z]+) enchantment creature\b/, 'becomes a $1 artifact creature'],
    [/\ban opponent controls\b/, 'you control'], [/\bany number of\b/, 'up to one'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out.map((m) => rest(m.replace(/\.$/, '') + '.'));
}

describe('T41 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T41) {
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

describe('T41 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T41) {
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

describe.skipIf(index === null)('T41 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  // sentences with no word to vary: none (every T41 pattern has holes)
  const FIXED_WORDING = new Set<string>();
  const SETUP = new Set(['Flying', 'Trample']);
  it('no T41 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T41.filter((t) => !FIXED_WORDING.has(t.id)).flatMap((t) =>
      [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => !SETUP.has(l.trim()) && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  // the try step on real cards: each card's T41 line is read by the named template and passes the exact render gate, never manual on that line
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t41.each.pump.grant': ['Rabid Attack'],
    'eff.t41.pump.grant.becomes.enchantmentCreature': ['Jump Scare'],
    'eff.t41.becomes.addtype.gains': ['Enter the Avatar State'],
    'eff.t41.pump.becomes.addtype': ['Stegron the Dinosaur Man'],
    'eff.t41.pump.pair.duration': ['Skulduggery', 'Rookie Mistake'],
    'eff.t41.pump.loses.creatureTypes': ['Nameless Inversion'],
    'eff.t41.gains.choice2': ['Manifold Mouse', "Hunter's Axe", 'Orcish Medicine', 'Silverquill Pledgemage'],
    'eff.t41.double.thePowerOf': ['Mightform Harmonizer', 'Unleash Fury'],
  };
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);
  const LINE = /each get|in addition to its other types|loses all creature types|your choice of|double the power|gets \+1\/\+1 and target/i;
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
