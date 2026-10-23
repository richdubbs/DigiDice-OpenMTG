/**
 * FAST4 T26: the template data of parser/templates/zz-fast4/t26.json (one-shot effects on cards, life and tokens with back-references and counted
 * quantities: "draw two cards, then discard one of them", "that many", "this way", "where X is ...", "if its mana value was N or less") and the parser and
 * renderer readings the package's shapes needed (design 6.8 G6: render/cond.ts, render/fold.ts, render/qty.ts, render/steps-cards.ts, render/steps-life.ts,
 * render/steps-zones.ts, render/steps.ts; holes: parser/holes/cond.ts, parser/holes/qty.ts; "that many" of an attack batch: model/lint-roles.ts). Guard G9
 * (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples
 * are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T26 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t26 from '../../../src/parser/templates/zz-fast4/t26.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T26 = t26 as Template[];
const OPTS = defaultParseOptions();

/** A trigger or an activated ability is a creature's; anything else is a sorcery (the coverage harness tries the same type lines, cards/coverage/mutation.ts). */
function exampleCard(text: string): OracleCard {
  const permanent = /^(When|Whenever|At)\b/.test(text) || /^[^"]*:/.test(text);
  return {
    name: 'Example Subject', layout: 'normal', type_line: permanent ? 'Creature — Human' : 'Sorcery', oracle_text: text.replace(/~/g, 'Example Subject'), mana_cost: '{1}',
    colors: [], keywords: [], ...(permanent ? { power: '2', toughness: '2' } : {}),
  } as OracleCard;
}
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
const steps = (text: string): unknown => {
  const a = parsed(text).abilities.find((x) => x.kind !== 'keyword') as unknown as { effect?: { steps: unknown[] } };
  return a.effect?.steps;
};

describe('T26 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t26.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t26.json');
    expect(files.indexOf('zz-fast4/t26.json')).toBeGreaterThan(files.indexOf('zz-fast3/t18.json'));
    expect(files.indexOf('zz-fast4/t26.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T26.length).toBe(13);
    for (const t of T26) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t26\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T26) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T26 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T26) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('T26 lowering: what the shapes mean', () => {
  it('CR 121.2, 608.2c: "draw two cards, then discard one of them" discards one of the cards the draw bound, nothing else', () => {
    expect(steps('{T}: Draw two cards, then discard one of them.')).toEqual([
      { op: 'draw', who: { ref: 'you' }, count: 2, as: 'drawn' },
      { op: 'discard', who: { ref: 'you' }, count: 1, filter: { is: { ref: 'bound', name: 'drawn' } } },
    ]);
  });
  it('CR 701.9b: "discard any number of cards, then draw that many cards plus one" is a choice in your hand, the discard of exactly those, and a draw of one more', () => {
    expect(steps('When ~ leaves the battlefield, discard any number of cards, then draw that many cards plus one.')).toEqual([
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { zone: 'hand', owner: 'you' } }, min: 0, max: 'any', as: 'toDiscard' },
      { op: 'discard', who: { ref: 'you' }, count: { q: 'count', of: { ref: 'bound', name: 'toDiscard' } }, filter: { is: { ref: 'bound', name: 'toDiscard' } }, as: 'discarded' },
      { op: 'draw', who: { ref: 'you' }, count: { q: 'math', op: '+', args: [{ q: 'resultCount', step: 'discarded' }, 1] } },
    ]);
  });
  it('CR 107.3, 608.2h: "each opponent loses X life and you gain X life, where X is ..." substitutes the quantity in both steps', () => {
    const x = { q: 'count', of: { ref: 'each', filter: { subtypes: ['Vampire'], controller: 'you' } } };
    expect(steps('At the beginning of your upkeep, each opponent loses X life and you gain X life, where X is the number of Vampires you control.')).toEqual([
      { op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: x },
      { op: 'gainLife', who: { ref: 'you' }, amount: x },
    ]);
  });
  it('CR 608.2h: "if its mana value was 3 or less" compares the target\'s mana value (last known information, effects/eval.ts#statOf)', () => {
    expect(steps('Destroy target creature. If its mana value was 3 or less, create a Treasure token.')).toEqual([
      { op: 'destroy', what: { ref: 'target', id: 't0' } },
      { op: 'if', cond: { cond: 'compare', left: { q: 'stat', stat: 'manaValue', of: { ref: 'target', id: 't0' } }, op: '<=', right: 3 }, then: [{ op: 'createToken', who: { ref: 'you' }, count: 1, token: { predefined: 'Treasure' } }] },
    ]);
  });
  it('CR 119.3: the Cond hole reads "you\'ve gained N or more life this turn" and "you gained N or more life this turn"; the Qty hole "the amount of life you gained this turn"', () => {
    const cond = { cond: 'compare', left: { q: 'lifeGainedThisTurn' }, op: '>=', right: 3 };
    expect(steps("{1}: Draw a card if you've gained 3 or more life this turn.")).toEqual([{ op: 'draw', who: { ref: 'you' }, count: 1, guard: cond }]);
    expect(steps('If you gained 3 or more life this turn, draw a card.')).toEqual([{ op: 'if', cond, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }]);
    expect(steps('At the beginning of each end step, each opponent mills X cards, where X is the amount of life you gained this turn.')).toEqual([{ op: 'mill', who: { ref: 'each', who: 'opponent' }, count: { q: 'lifeGainedThisTurn' } }]);
    // "exactly" or "fewer" is no reading of this condition
    expect(fullyAutomated(parsed('If you gained 3 or fewer life this turn, draw a card.'))).toBe(false);
  });
  it('CR 508.1, 603.2c: "that many" of a "one or more ... attack" batch is the number of attackers; a single attack has no number', () => {
    expect(steps('Whenever one or more Dinosaurs you control attack, create that many Treasure tokens.')).toEqual([{ op: 'createToken', who: { ref: 'you' }, count: { q: 'eventAmount' }, token: { predefined: 'Treasure' } }]);
    expect(fullyAutomated(parsed('Whenever ~ attacks, create that many Treasure tokens.'))).toBe(false);
  });
  it('CR 406.1: "each opponent ... exiles the top three cards of their library" exiles the top cards of each opponent\'s own library', () => {
    expect(steps('When ~ enters, each opponent discards a card, loses 2 life, and exiles the top three cards of their library.')).toEqual([
      { op: 'discard', who: { ref: 'each', who: 'opponent' }, count: 1 },
      { op: 'loseLife', who: { ref: 'each', who: 'opponent' }, amount: 2 },
      { op: 'move', what: { ref: 'topCards', player: { ref: 'each', who: 'opponent' }, count: 3 }, to: { zone: 'exile' } },
    ]);
  });
  it('CR 201.2, 111.4: differently named lands count names; the Cadet tokens carry their name', () => {
    expect(steps('Draw X cards, where X is the number of differently named lands you control.')).toEqual([
      { op: 'draw', who: { ref: 'you' }, count: { q: 'distinct', what: 'names', among: { ref: 'each', filter: { types: ['Land'], controller: 'you' } } } },
    ]);
    expect(JSON.stringify(steps('Create X 1/1 colorless Wizard Soldier creature tokens named Cadet, where X is the amount of life you gained this turn.'))).toContain('"token":{"name":"Cadet","colors":[],"types":["Creature"],"subtypes":["Wizard","Soldier"],"power":1,"toughness":1}');
  });
});

describe('T26 renderer readings (design 6.8 G6): Oracle wordings of shapes other templates already parse', () => {
  it('"create that many tapped ... tokens" (a computed number with "tapped" before the token words, FAST1 T6 / FAST3 T17 readings)', () => {
    expect(fullyAutomated(parsed('Whenever you discard one or more cards, create that many tapped 2/2 black Zombie creature tokens.'))).toBe(true);
  });
  it('"create a ... token and put X +1/+1 counters on it, where X is the number of cards you\'ve drawn this turn"', () => {
    expect(fullyAutomated(parsed("Create a 0/0 green and blue Fractal creature token and put X +1/+1 counters on it, where X is the number of cards you've drawn this turn."))).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bdraw\b/, 'mill'], [/\bDraw\b/, 'Mill'], [/\bdiscard\b/, 'exile'], [/\bof them\b/, 'of those'], [/\bthen\b/, 'and'], [/\beach opponent\b/, 'target opponent'],
    // ("was" -> "is" is left out: "if its mana value is 3 or less" means the same, and cond.if reads it to the same JSON)
    [/\byou gain\b/, 'you lose'], [/\bwhere X\b/, 'where Y'], [/\bor less\b/, 'or greater'], [/\bif\b/, 'unless'], [/\btapped\b/, 'untapped'],
    [/\bplus\b/, 'minus'], [/\bother\b/, 'blocking'], [/\buntil end of turn\b/, ''], [/\bdifferently named\b/, 'named'], [/\bnamed Cadet\b/, ''],
    [/\btheir library\b/, 'your library'], [/\bthis way\b/, 'this turn'], [/\bany number of\b/, 'two'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T26 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T26) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T26 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T26) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T26 design 6.10: examples are synthetic', () => {
  it('no example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|Equipment|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = T26.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
