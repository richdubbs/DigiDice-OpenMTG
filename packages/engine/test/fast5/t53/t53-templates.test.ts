/**
 * FAST5 T53 (redone on top of E17/E21/E22, which read the turn histories, the second main phase and "it had counters"): the template data of
 * parser/templates/zz-fast5/t53.json ("investigate once for each opponent who has more cards in hand than you") and the readings the redo added to the Cond hole
 * (parser/holes/cond.ts: "a creature died under an opponent's control this turn", "eight or more cards are in your graveyard", "an opponent has more cards in hand
 * than you"), with their renderings (render/cond.ts, render/qty.ts, render/steps-util.ts).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse
 * or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability
 * (G2). Examples are synthetic wordings (design 6.10); the real cards each template reads are checked against the local index when it is present.
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T53 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import t53 from '../../../src/parser/templates/zz-fast5/t53.json';
import review from '../../m5/golden/cards/fast5-t53-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T53 = t53 as Template[];

/** Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence only one real card prints, that card. */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.t53.investigate.opponentsMoreCards': { cards: ['Wojek Investigator'], line: /investigate once for each opponent who has more cards in hand than you/i },
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which a T53 example is an ability of the right kind (a trigger is a creature's, an effect on its own a spell's). */
function exampleCard(text: string): OracleCard {
  if (/^(when|whenever|at) /i.test(text)) return card('Example Brute', 'Creature — Elf Warrior', text);
  return card('Example Volley', 'Sorcery', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('T53 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-fast5/t53.json, path order: after zz-fast4/, before zz-m6/ and zz-push/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t53.json');
    expect(files.indexOf('zz-fast5/t53.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t53.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T53.length).toBe(1);
    for (const t of T53) {
      expect(t.id, t.id).toMatch(/^(eff|ch)\.t53\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable T53 template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string }[];
    for (const t of T53.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T53) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('T53 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T53) {
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
    [/more cards/, 'fewer cards'], [/in hand/, 'in graveyard'], [/\bpay\b/, 'lose'], [/ life/, ' cards'], [/its counters/, 'its power'], [/up to one target/, 'each'],
    [/you control/, 'an opponent controls'], [/opponent who/, 'player who'], [/once/, 'twice'], [/dies/, 'attacks'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ')}.`);
  return out;
}

describe('T53 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T53) {
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

describe('T53 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T53) {
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

/** The hole readings of the redo, as full cards: each parses fully automated through the render gate to the stated condition (CR 603.4). */
describe('T53 holes: the intervening "if" clauses (CR 603.4)', () => {
  type Ab = { kind: string; interveningIf?: unknown; effect?: { steps: unknown[] } };
  function trig(text: string): Ab {
    const f = parseCard(card('Example Brute', 'Creature — Elf Warrior', text), OPTS).faces[0]!;
    expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics.filter((d) => d.level === 'manual'))} ${JSON.stringify(f.gate.filter((g) => !g.ok))}`).toBe(true);
    const t = (bare(f.abilities) as Ab[]).filter((a) => a.kind === 'triggered');
    expect(t.length, text).toBe(1);
    return t[0]!;
  }
  const notAutomated = (text: string): boolean => !fullyAutomated(parseCard(card('Example Brute', 'Creature — Elf Warrior', text), OPTS).faces[0]!);
  const at = (cond: string, effect = 'draw a card'): Ab => trig(`At the beginning of your end step, if ${cond}, ${effect}.`);

  it("\"a creature died under an opponent's control this turn\": its controller as it last existed (CR 603.10a)", () => {
    expect(at("a creature died under an opponent's control this turn").interveningIf)
      .toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'opponent' }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' });
    expect(at('a creature died under your control this turn').interveningIf)
      .toEqual({ cond: 'happened', event: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' });
    expect(notAutomated("At the beginning of your end step, if a creature died under an opponent's control, draw a card.")).toBe(true);
    expect(notAutomated("At the beginning of your end step, if a creature died under an opponent's control last turn, draw a card.")).toBe(true);
  });
  it('"eight or more cards are in your graveyard" is the size of your graveyard (CR 404.1); "or fewer" and another player graveyard are not read', () => {
    expect(at('eight or more cards are in your graveyard').interveningIf).toEqual({ cond: 'compare', left: { q: 'zoneSize', zone: 'graveyard', of: { ref: 'you' } }, op: '>=', right: 8 });
    expect(notAutomated('At the beginning of your end step, if eight or fewer cards are in your graveyard, draw a card.')).toBe(true);
    expect(notAutomated("At the beginning of your end step, if eight or more cards are in an opponent's graveyard, draw a card.")).toBe(true);
  });
  it('"an opponent has more cards in hand than you": at least one opponent does (CR 402.1, 102.3), however many opponents there are', () => {
    expect(at('an opponent has more cards in hand than you').interveningIf).toEqual({ cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, sizeVs: { zone: 'hand', op: '>', than: { ref: 'you' } } }, op: '>=', right: 1 });
    expect(notAutomated('At the beginning of your end step, if an opponent has more cards in hand than target player, draw a card.')).toBe(true);
    expect(notAutomated('At the beginning of your end step, if an opponent has fewer cards in hand than you, draw a card.')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('T53 design 6.9, 6.10 (local index): synthetic examples; the real cards each template reads', () => {
  it('no T53 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = T53.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card's T53 line is read by the named template and passes the exact render gate
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.t53.investigate.opponentsMoreCards': ['Wojek Investigator'],
  };
  const LINE = /put (its|those) counters on|may pay \d+ life|investigate once for each opponent/i;
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
