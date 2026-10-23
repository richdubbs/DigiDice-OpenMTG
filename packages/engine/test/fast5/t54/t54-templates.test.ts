/**
 * FAST5 T54 (Station rows with full abilities): the template data of parser/templates/zz-fast5/t54.json and the Station row lowering (CR 721.2). Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are
 * synthetic wordings (design 6.10), checked against the local index when it is present; the real cards each template reads are checked there too (the try
 * step of CONTRIBUTING "Adding a template").
 *
 * The other rows of a Station card (keywords, "Other creatures you control get +1/+1.", "Whenever you attack, ~ deals N damage to up to one target ...", the
 * mana abilities with a cost, the lines printed under the symbol) need no template of their own: the row's text is lowered like any ability of its kind
 * (parser/lower/ability.ts#stationAbilities, parser/segment.ts#stationSeg) and granted as the ability the permanent has (CR 721.2a); they are covered here
 * by the row tests and in t54-scenarios.test.ts and the golden cards (fast5-t54-review.json).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t54 from '../../../src/parser/templates/zz-fast5/t54.json';
import review from '../../m5/golden/cards/fast5-t54-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T54 = t54 as Template[];

/** Design 6.9 evidence for a stable template: every card of the corpus that prints the sentence, each with a hand-verified golden card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t54.becomes.artifactcreature.basept.gains': { cards: ['Synthesizer Labship'], line: /becomes an artifact creature with base power and toughness \d+\/\d+ and gains [a-z ]+ until end of turn\./ },
  'eff.t54.copy.token.legendary': { cards: ['Adagia, Windswept Bastion'], line: /^(?:\d+\+ \| )?(?:\{[^}]+\}(?:, )?)+: Create a token that's a copy of [^.,]+, except it's legendary\./m },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T54 example is an ability of the right kind: a spell on an instant, a triggered or activated ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text);
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('T54 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t54.json, after zz-fast5/t41.json, before zz-m6/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t54.json');
    expect(files.indexOf('zz-fast5/t54.json')).toBeGreaterThan(files.indexOf('zz-fast5/t41.json'));
    expect(files.indexOf('zz-fast5/t54.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(T54.length).toBe(2);
    for (const t of T54) {
      expect(t.id, t.id).toMatch(/^eff\.t54\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T54 template has its evidence: its golden cards are every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T54.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      expect(whole, t.id).toBeDefined();
      expect(cards.slice().sort(), t.id).toEqual([...whole!.cards].sort());
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T54) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('T54 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T54) {
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
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\buntil end of turn\b/, 'until your next turn'], [/\band gains\b/, 'and loses'], [/\bbase power and toughness\b/, 'power and toughness'], [/\bartifact creature\b/, 'creature'],
    [/\bit's legendary\b/, "it isn't legendary"], [/\bor enchantment\b/, 'and enchantment'], [/\bcopy of\b/, 'copy of each'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T54 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T54) {
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

describe('T54 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T54) {
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

describe('T54 Station rows (CR 721.2): the abilities of a row are lowered like any ability, the creature row is the one the reminder text names', () => {
  const REMINDER = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)";
  const ship = (rows: string, pt: [string, string] | null = ['4', '4'], reminder = REMINDER) => parseCard(card('Example Subject', 'Artifact — Spacecraft', `${reminder}\n${rows}`, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
  const rowsOf = (f: ReturnType<typeof ship>) => f.abilities.filter((a) => (a as { station?: boolean }).station === true) as unknown as { src: number[]; text: string; effects: { mods: { layer: unknown; add?: { kind: string }[] }[] }[] }[];

  it('a row that is not the creature row is understood without the box, whatever its abilities', () => {
    const f = ship('2+ | Other creatures you control get +1/+1.\n8+ | Flying');
    expect(fullyAutomated(f)).toBe(true);
    expect(rowsOf(f)).toHaveLength(2);
    expect(rowsOf(f)[0]!.effects[0]!.mods).toMatchObject([{ layer: 6, add: [{ kind: 'static' }] }]); // no creature change: the box belongs to 8+
    expect(rowsOf(f)[1]!.effects[0]!.mods.map((m) => m.layer)).toEqual([4, '7b', 6]);
  });
  it('the lines under the symbol belong to its row, each a granted ability, and the row keeps the lines of its striation (CR 721.2)', () => {
    const f = ship('8+ | Flying\n{1}{R}: ~ gets +2/+0 until end of turn.\nWhenever ~ attacks, you gain 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    const [row] = rowsOf(f);
    expect(row!.src).toHaveLength(3);
    expect(row!.effects[0]!.mods[2]!.add!.map((a) => a.kind)).toEqual(['keyword', 'activated', 'triggered']);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('a row is manual (and only that row) when an ability of its striation is not understood; the other rows and the Station keyword stay', () => {
    const f = ship('2+ | Other creatures you control get +1/+1.\n8+ | Flying\nBlorfty the zoof.');
    expect(f.abilities.map((a) => a.kind)).toEqual(['keyword', 'static', 'manual']);
    expect(fullyAutomated(f)).toBe(false);
  });
  it('when the reminder text names no creature threshold of the card, a card with a box keeps every row manual (CR 721.2b)', () => {
    expect(fullyAutomated(ship('2+ | Other creatures you control get +1/+1.\n8+ | Flying', ['4', '4'], REMINDER.replace(" It's an artifact creature at 8+.", '')))).toBe(false);
    expect(fullyAutomated(ship('2+ | Other creatures you control get +1/+1.\n7+ | Flying'))).toBe(false); // the named threshold 8+ is not a row
  });
  it('a card without a box (a Planet, an Elevator) never gets the creature change', () => {
    const planet = parseCard(card('Example World', 'Land — Planet', "This land enters tapped.\n{T}: Add {G}.\nStation (Tap another creature you control: Put charge counters equal to its power on this Planet. Station only as a sorcery.)\n12+ | {G}, {T}: Add {G} for each creature you control."), OPTS).faces[0]!;
    expect(fullyAutomated(planet)).toBe(true);
    expect(rowsOf(planet).map((r) => r.effects[0]!.mods.map((m) => m.layer))).toEqual([[6]]);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T54 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T54 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T54.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t54.becomes.artifactcreature.basept.gains': ['Synthesizer Labship'],
    'eff.t54.copy.token.legendary': ['Adagia, Windswept Bastion'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and leave no manual ability`, () => {
      for (const name of names) {
        const c = (index ?? []).find((x) => x.name === name);
        expect(c, name).toBeDefined();
        const f = parseCard(c!, OPTS).faces[0]!;
        expect(f.templatesUsed, name).toContain(id);
        expect(f.gate.every((g) => g.ok), name).toBe(true);
        const def = compileCard(c!);
        expect(def.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text), name).toEqual([]);
      }
    });
  }
});
