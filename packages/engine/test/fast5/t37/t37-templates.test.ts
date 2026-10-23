/**
 * FAST5 T37: the template data of parser/templates/zz-fast5/t37.json (monstrosity, "assign its combat damage as though it weren't blocked", colors-spent and
 * adamant enters-with counters, "can't attack or block alone") and the lowering, hole-grammar and renderer readings the package's shapes needed (design 6.8 G6:
 * parser/holes/cond.ts "X is the most common color among all permanents or is tied for most common", parser/lower/scope.ts the creature a heroic trigger names,
 * parser/lower/trigger-zone.ts "When you cycle ~", render/qty.ts, render/cond.ts, render/stat.ts). Guard G9 (design 6.8): every example lowers with its
 * template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or
 * differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T37 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t37 from '../../../src/parser/templates/zz-fast5/t37.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T37 = t37 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2)
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const abilities = (f: ReturnType<typeof face>) => f.abilities as unknown as Record<string, unknown>[];

describe('T37 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5/t37.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5/t37.json');
    expect(files.indexOf('zz-fast5/t37.json')).toBeGreaterThan(files.indexOf('zz-fast4/t34.json'));
    expect(files.indexOf('zz-fast5/t37.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8 (FAST5)', () => {
    expect(T37.length).toBe(5);
    for (const t of T37) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(rep|eff|sta)\.t37\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T37) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'alone']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('T37 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T37) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
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

describe('T37 lowering: what the shapes mean', () => {
  it('CR 701.37a: "Monstrosity X" is the action with the announced X; the trigger "becomes monstrous" is the event of the action', () => {
    const f = face('Creature — Hydra', '{X}{X}{G}: Monstrosity X.\nWhen ~ becomes monstrous, you gain 2 life.');
    const [act, trg] = abilities(f);
    expect((act!['effect'] as { steps: unknown[] }).steps).toEqual([{ op: 'action', action: 'monstrosity', who: { ref: 'you' }, n: { q: 'X' } }]);
    expect((trg!['trigger'] as { on: unknown[] }).on).toEqual([{ ev: 'becomes', what: 'monstrous', object: { self: true } }]);
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 701.37c: a trigger that reads the X of "monstrosity X" stays manual (a trigger has no X of its own)', () => {
    const f = face('Creature — Hydra', '{X}{X}{G}: Monstrosity X.\nWhen ~ becomes monstrous, you gain X life.');
    expect(automated(f.abilities)).toBe(false);
  });
  it('CR 601.2h, 614.1c: converge is an enters replacement counting the colors of mana spent (`colorsSpent`) on the spell that became the permanent', () => {
    const f = face('Creature — Avatar', '~ enters with a +1/+1 counter on it for each color of mana spent to cast it.');
    expect(abilities(f)[0]).toMatchObject({
      kind: 'static', zone: ['stack', 'battlefield'],
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: { q: 'colorsSpent' } }] } }],
    });
  });
  it('CR 601.2h: adamant is the cast-history condition `spent` (at least N of one color) on the enters replacement', () => {
    const f = face('Creature — Human Knight', 'If at least three red mana was spent to cast ~, ~ enters with a +1/+1 counter on it.');
    expect(abilities(f)[0]).toMatchObject({
      kind: 'static', condition: { cond: 'wasCast', spent: { color: 'R', atLeast: 3 } },
      effects: [{ s: 'replace', body: { b: 'enters', counters: [{ kind: '+1/+1', count: 1 }] } }],
    });
  });
  it('CR 510.1b-c: "You may have ~ assign its combat damage as though it weren\'t blocked" is the permission `assignAsUnblocked` of its source', () => {
    const f = face('Creature — Elemental', "You may have ~ assign its combat damage as though it weren't blocked.");
    expect(abilities(f)[0]).toMatchObject({ kind: 'static', effects: [{ s: 'permit', who: { ref: 'you' }, action: 'assignAsUnblocked' }] });
  });
  it('CR 506.5: "can\'t attack or block alone" is two `alone` bans, not a ban on attacking and blocking', () => {
    const f = face('Creature — Goblin', "~ can't attack or block alone.");
    expect(abilities(f)[0]).toMatchObject({
      kind: 'static',
      effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'attack', alone: true }, { s: 'restrict', subject: { ref: 'self' }, mode: 'cant', action: 'block', alone: true }],
    });
  });
  it('CR 105.1: "white is the most common color among all permanents or is tied for most common" compares the white permanents with each other color', () => {
    const f = face('Creature — Djinn', '~ gets -2/-2 as long as white is the most common color among all permanents or is tied for most common.');
    const cond = (abilities(f)[0] as unknown as { condition: { cond: string; of: { cond: string; op: string; left: unknown; right: { q: string; of: { filter: { colors: string[] } } } }[] } }).condition;
    expect(cond.cond).toBe('all');
    expect(cond.of.map((c) => c.right.of.filter.colors[0]).sort()).toEqual(['B', 'G', 'R', 'U']);
    expect(cond.of.every((c) => c.op === '>=')).toBe(true);
    expect(f.gate.every((g) => g.ok)).toBe(true);
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 105.1: "tied for most common" is not "the only most common color": a sentence that drops it does not parse', () => {
    const f = face('Creature — Djinn', '~ gets -2/-2 as long as white is the most common color among all permanents.');
    expect(automated(f.abilities)).toBe(false);
  });
  it('CR 702.29d: "When you cycle ~, put a flying counter on target creature you control" functions in the graveyard and is automated', () => {
    const f = face('Creature — Bird', 'Cycling {2}{U}\nWhen you cycle ~, put a flying counter on target creature you control.');
    expect(abilities(f)[1]).toMatchObject({ kind: 'triggered', zone: ['graveyard'], trigger: { on: [{ ev: 'action', verb: 'cycle', actor: 'you', object: { self: true } }] } });
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 113.6k: a cycling trigger whose effect names the card itself stays manual (the card is not where it was)', () => {
    const f = face('Creature — Bird', 'Cycling {2}{U}\nWhen you cycle ~, return it to the battlefield.');
    expect(automated(f.abilities)).toBe(false);
  });
  it('CR 122.1, 603.2: heroic - "put a +1/+1 counter on it" after "a spell that targets ~" is ~ itself, not the spell', () => {
    const f = face('Creature — Centaur', 'Whenever you cast a spell that targets ~, put a +1/+1 counter on it.');
    expect((abilities(f)[0]!['effect'] as { steps: unknown[] }).steps).toEqual([{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count: 1 }]);
    expect(automated(f.abilities)).toBe(true);
  });
  it('CR 122.1, 603.2: valiant - "put a +1/+1 counter on it" after "~ becomes the target of a spell or ability you control" is ~ (the creature that became the target), not the spell', () => {
    const f = face('Creature — Mouse', 'Whenever ~ becomes the target of a spell or ability you control for the first time each turn, put a +1/+1 counter on it.');
    expect((abilities(f)[0]!['effect'] as { steps: unknown[] }).steps).toEqual([{ op: 'putCounters', on: { ref: 'event', role: 'subject' }, kind: '+1/+1', count: 1 }]);
    expect(automated(f.abilities)).toBe(true);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bat least\b/, 'at most'], [/\bwas spent\b/, 'was paid'], [/\bweren't\b/, 'were'], [/\bcan't\b/, 'can'], [/\balone\b/, 'together'],
    [/\bfor each\b/, 'for every'], [/\bMonstrosity\b/, 'Adapt'], [/\bassign\b/, 'deal'], [/\bcast\b/, 'play'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T37 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T37) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('T37 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T37) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.pop()!;
        const words = last.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w) || /^~'s$/.test(w)) return;
          // CR 122.1: any word can name a kind of counter (parser/holes/misc.ts#counterKind), so the word before "counter" is not a nonsense position
          if (/^counters?$/.test(words[i + 1] ?? '')) return;
          const mutated = [...lines, [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ')].join('\n');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('T37 design 6.10: examples are synthetic', () => {
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
    const verbatim = T37.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
