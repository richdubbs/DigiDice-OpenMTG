/**
 * FAST4 T30: the template data of parser/templates/zz-fast4/t30.json (one-shot damage, life loss, drawing, milling, bounce, tutors and removal: two damage
 * recipients, "where X is ...", "half their life, rounded up", "you may have target player ...", "for each ... that died this turn", "from among them") and
 * the parser and renderer readings the package's shapes needed (design 6.8 G6: render/refs.ts, render/steps-life.ts, render/steps-util.ts,
 * render/steps-cards.ts, render/steps-flow.ts, render/fold.ts; the words "plus" and "minus" of the Qty hole, parser/holes/qty.ts). Guard G9 (design 6.8):
 * every example lowers with its template, is fully automated (experimental templates cap the card, not the ability) and passes the exact render gate; every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T30 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t30 from '../../../src/parser/templates/zz-fast4/t30.json';
import { automated, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T30 = t30 as Template[];
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

describe('T30 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t30.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t30.json');
    expect(files.indexOf('zz-fast4/t30.json')).toBeGreaterThan(files.indexOf('zz-fast3/t18.json'));
    expect(files.indexOf('zz-fast4/t30.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T30.length).toBe(25);
    for (const t of T30) {
      expect(t.kind, t.id).toBe('effect');
      expect(t.id, t.id).toMatch(/^eff\.t30\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T30) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

/**
 * T20 merge: T20's "you and {p} each draw {n} card[s]" builds the same JSON as T30's "a card" form; among derivations of equal JSON the chart picks one by
 * template id (parser/chart.ts#better), so T20's general template is the one listed. Either proves the shape.
 */
const SUBSUMED_BY: Readonly<Record<string, string>> = { 'eff.t30.draw.youAndPlayerEach': 'eff.t20.draw.youAndTarget' };

describe('T30 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T30) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed.some((id) => id === t.id || id === SUBSUMED_BY[t.id]), e.text).toBe(true);
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

describe('T30 lowering: what the shapes mean', () => {
  it('CR 115.3: "any other target" is a second target that must differ from the first; both amounts are one damage event (`also`)', () => {
    const f = parsed('~ deals 4 damage to any target and 3 damage to any other target.');
    const a = f.abilities[0] as unknown as { effect: { targets: { id: string; distinctFrom?: string[] }[]; steps: unknown[] } };
    expect(a.effect.targets.map((x) => x.distinctFrom ?? [])).toEqual([[], ['t0']]);
    expect(a.effect.steps).toEqual([{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 4, also: [{ to: { ref: 'target', id: 't1' }, amount: 3 }] }]);
  });
  it('CR 120.3: "and 2 damage to itself" is dealt to the source', () => {
    expect(steps('{3}, {T}: ~ deals 4 damage to any target and 2 damage to itself.')).toEqual([
      { op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 4, also: [{ to: { ref: 'self' }, amount: 2 }] },
    ]);
  });
  it('CR 107.3, 107.1b: "where X is 5 minus the number of cards in their hand" is the hand size of that player subtracted from 5', () => {
    expect(steps("At the beginning of each opponent's upkeep, ~ deals X damage to that player, where X is 5 minus the number of cards in their hand.")).toEqual([
      { op: 'damage', source: { ref: 'self' }, to: { ref: 'event', role: 'player' }, amount: { q: 'math', op: '-', args: [5, { q: 'zoneSize', zone: 'hand', of: { ref: 'event', role: 'player' } }] } },
    ]);
  });
  it('CR 107.1a: "half their life, rounded up" and "half their library, rounded up" are ceilings of half of the own total of that player', () => {
    const p = { ref: 'event', role: 'player' };
    expect(steps("At the beginning of each opponent's upkeep, that player loses half their life, rounded up.")).toEqual([{ op: 'loseLife', who: p, amount: { q: 'math', op: 'ceilDiv', args: [{ q: 'life', of: p }, 2] } }]);
    expect(steps('When ~ enters, target opponent mills half their library, rounded up.')).toEqual([
      { op: 'mill', who: { ref: 'target', id: 't0' }, count: { q: 'math', op: 'ceilDiv', args: [{ q: 'zoneSize', zone: 'library', of: { ref: 'target', id: 't0' } }, 2] } },
    ]);
  });
  it('CR 608.2d: "you may have target player mill four cards" is your choice, the mill by that player', () => {
    expect(steps('Whenever ~ attacks, you may have target player mill four cards.')).toEqual([{ op: 'may', who: { ref: 'you' }, do: [{ op: 'mill', who: { ref: 'target', id: 't0' }, count: 4 }] }]);
  });
  it('CR 700.4: "for each creature that died this turn" counts creatures put into a graveyard from the battlefield this turn', () => {
    expect(steps('When ~ enters, draw a card for each creature that died this turn.')).toEqual([
      { op: 'draw', who: { ref: 'you' }, count: { q: 'happenedCount', event: { ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }, scope: 'turn' } },
    ]);
  });
  it('CR 608.2d: "target player exiles a creature they control" is the choice of that player among their own creatures, then the exile', () => {
    const p = { ref: 'target', id: 't0' };
    expect(steps('Whenever ~ attacks, target player exiles a creature they control.')).toEqual([
      { op: 'chooseObjects', who: p, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], controller: p } }, min: 1, max: 1, as: 'exiled' },
      { op: 'move', what: { ref: 'bound', name: 'exiled' }, to: { zone: 'exile' } },
    ]);
  });
  it('CR 701.17c: "from among them" chooses among the milled cards only, in the public zone they went to', () => {
    expect(steps('Mill five cards, then put up to two creature cards from among them into your hand.')).toEqual([
      { op: 'mill', who: { ref: 'you' }, count: 5, as: 'milled' },
      { op: 'chooseObjects', who: { ref: 'you' }, from: { ref: 'each', filter: { anyOf: [{ types: ['Creature'] }], is: { ref: 'bound', name: 'milled' }, zone: 'any' } }, min: 0, max: 2, as: 'chosen' },
      { op: 'move', what: { ref: 'bound', name: 'chosen' }, to: { zone: 'hand' } },
    ]);
  });
  it('the stable search template gives exactly the JSON of the stable composition it shares a sentence with (se.library.upTo + eff.put.bf.tapped + eff.shuffle)', () => {
    expect(steps('Search your library for up to three basic land cards, put them onto the battlefield tapped, then shuffle.')).toEqual([
      { op: 'search', who: { ref: 'you' }, zone: 'library', filter: { supertypes: ['Basic'], types: ['Land'] }, min: 0, max: 3, as: 'search' },
      { op: 'move', what: { ref: 'bound', name: 'search' }, to: { zone: 'battlefield', controller: { ref: 'you' }, tapped: true } },
      { op: 'shuffle', who: { ref: 'you' } },
    ]);
  });
});

describe('T30 renderer readings (design 6.8 G6): Oracle wordings of shapes other templates already parse', () => {
  it('CR 603.2: "Whenever ~ or another creature you control is turned face up, that creature deals damage equal to its power to each opponent"', () => {
    expect(fullyAutomated(parsed('Whenever ~ or another creature you control is turned face up, that creature deals damage equal to its power to each opponent.'))).toBe(true);
    // the object of a trigger of ~ alone is still "it" / "~"
    expect(fullyAutomated(parsed('Whenever ~ becomes tapped, it deals damage equal to its power to each opponent.'))).toBe(true);
  });
  it('CR 120.3: "deals damage equal to its power to each of two other target creatures" (family damage-each-of)', () => {
    expect(fullyAutomated(parsed('Target creature you control deals damage equal to its power to each of two other target creatures.'))).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bdraw\b/, 'mill'], [/\bDraw\b/, 'Mill'], [/\bdiscard\b/, 'exile'], [/\bof them\b/, 'of those'], [/\beach opponent\b/, 'target opponent'],
    // ("was" -> "is" is left out: "if its mana value is 3 or less" means the same, and cond.if reads it to the same JSON)
    [/\byou gain\b/, 'you lose'], [/\bwhere X\b/, 'where Y'], [/\bor less\b/, 'or greater'], [/\bif\b/, 'unless'], [/\btapped\b/, 'untapped'],
    [/\bplus\b/, 'minus'], [/\bother\b/, 'blocking'], [/\buntil end of turn\b/, ''], [/\bdifferently named\b/, 'named'], [/\bnamed Cadet\b/, ''],
    [/\btheir library\b/, 'your library'], [/\bthis way\b/, 'this turn'], [/\bany number of\b/, 'two'],
  ];
  // FAST5 T65: the last of three or more steps is also joined with the serial comma ("search ..., put it ..., and shuffle" is the same three steps as ", then shuffle"), so "then" -> "and" is a near miss of two-step sentences only
  if (body.split(',').length < 3) swaps.push([/\bthen\b/, 'and']);
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T30 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T30) {
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

describe('T30 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T30) {
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

describe.skipIf(index === null)('T30 design 6.10: examples are synthetic', () => {
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
    const verbatim = T30.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
