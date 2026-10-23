/**
 * FAST4 T28: the template data of parser/templates/zz-fast4/t28.json (+1/+1 and keyword counters: put on several objects or for each, double, distribute, enters
 * with (additional) counters) and the hole-grammar, lowering and renderer readings the package's shapes needed (design 6.8 G6: parser/holes/misc.ts two-word
 * keyword counters, parser/holes/qty.ts "its +1/+1 counters", parser/holes/filter.ts "Vehicles and/or creatures", parser/lower/targets.ts the division of
 * counters, render/steps-life.ts, render/stat.ts, render/fold.ts, render/refs.ts, render/np.ts). Guard G9 (design 6.8): every example lowers with its
 * template, is fully automated and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail
 * or differ; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T28 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t28 from '../../../src/parser/templates/zz-fast4/t28.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T28 = t28 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;
const steps = (f: ReturnType<typeof face>, i = 0): unknown => (f.abilities[i] as unknown as { effect: { steps: unknown[] } }).effect.steps;

describe('T28 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t28.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t28.json');
    expect(files.indexOf('zz-fast4/t28.json')).toBeGreaterThan(files.indexOf('zz-fast4/t26.json'));
    expect(files.indexOf('zz-fast4/t28.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T28.length).toBe(13);
    for (const t of T28) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(rep|eff)\.t28\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T28) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double', 'additional', 'distribute']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('T28 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T28) {
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

describe('T28 lowering: what the counter shapes mean', () => {
  it('CR 701.10e: "double the number of +1/+1 counters on each Elf you control" is the doubling action on the set, kind +1/+1', () => {
    const f = face('Artifact', '{2}: Double the number of +1/+1 counters on each Elf you control.');
    expect(steps(f)).toEqual([{ op: 'action', action: 'doubleCounters', subject: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } }, who: { ref: 'you' }, arg: '+1/+1' }]);
  });
  it('CR 601.2d: "distribute" marks the target spec with the total and leaves one putCounters step (no intermediate node survives)', () => {
    const f = face('Sorcery', 'Distribute three +1/+1 counters among one or two target creatures.');
    const a = f.abilities[0] as unknown as { effect: { targets: { divide?: unknown; min: number; max: number }[]; steps: unknown[] } };
    expect(a.effect.targets[0]).toMatchObject({ min: 1, max: 2, divide: { what: 'counters', total: 3 } });
    expect(a.effect.steps).toEqual([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: 3 }]);
  });
  it('CR 601.2d: counters to distribute among something that is not a target are not read (the sentence stays manual)', () => {
    const f = face('Sorcery', 'Distribute three +1/+1 counters among creatures you control.');
    expect(automated(f.abilities)).toBe(false);
  });
  it('CR 122.1b: "a first strike counter" and "a double strike counter" are one kind of two words (parser/holes/misc.ts)', () => {
    const f = face('Instant', 'Put a first strike counter on target creature.');
    expect(steps(f)).toEqual([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: 'first strike', count: 1 }]);
    const g = face('Creature — Human', '{3}: Put a double strike counter on ~.');
    expect(steps(g)).toEqual([{ op: 'putCounters', on: { ref: 'self' }, kind: 'double strike', count: 1 }]);
  });
  it('CR 122.8: "put its +1/+1 counters on target creature you control" counts the counters of that kind on the object "its" names (parser/holes/qty.ts)', () => {
    const f = face('Creature — Human', 'When ~ dies, put its +1/+1 counters on target creature you control.');
    expect(steps(f)).toEqual([{ op: 'putCounters', on: { ref: 'target', id: 't0' }, kind: '+1/+1', count: { q: 'counters', on: { ref: 'event', role: 'subject' }, kind: '+1/+1' } }]);
  });
  it('CR 122.8: "put its counters" (every kind) has no reading: one count cannot say every kind', () => {
    const f = face('Creature — Human', 'When ~ dies, put its counters on target creature you control.');
    expect(automated(f.abilities)).toBe(false);
  });
  it('CR 614.1c, 611.2a: "This turn, each creature you control enters with an additional +1/+1 counter on it" is a replacement effect until end of turn', () => {
    const f = face('Creature — Human Wizard', '{1}{G}: This turn, each creature you control enters with an additional +1/+1 counter on it.');
    expect(steps(f)).toEqual([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 1 }] } }],
    }]);
  });
  it('CR 205.2a, 205.3: "Vehicles and/or creatures" is a Vehicle or a creature (parser/holes/filter.ts)', () => {
    const f = face('Artifact — Vehicle', 'When ~ enters, distribute two +1/+1 counters among one or two other target Vehicles and/or creatures you control.');
    const a = f.abilities[0] as unknown as { effect: { targets: { filter: unknown }[] } };
    expect(a.effect.targets[0]!.filter).toEqual({ anyOf: [{ subtypes: ['Vehicle'] }, { types: ['Creature'] }], controller: 'you', other: true });
  });
  it('FAST5X E15: "where X is the greatest power among other creatures you control" is the maximum of the set (the model has it now: `agg`, CR 208.1)', () => {
    const text = '~ enters with X +1/+1 counters on it, where X is the greatest power among other creatures you control.';
    const f = face('Creature — Human', text);
    expect(automated(f.abilities), text).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/\{"q":"stat","stat":"power","of":\{"ref":"each","filter":\{[^}]*"other":true[^}]*\}\},"agg":"max"\}/);
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\byou control\b/, 'an opponent controls'], [/\bDouble\b/, 'Triple'], [/\bdouble the number\b/, 'triple the number'], [/\bwhere X\b/, 'where Y'],
    [/\bput X\b/, 'put two'], [/\badditional\b/, 'extra'], [/\bThis turn\b/, 'Next turn'], [/\bdied\b/, 'entered'], [/\bthis turn\b/, 'last turn'],
    [/\bDistribute\b/, 'Put'], [/\bdistribute\b/, 'put'], [/\bone or two\b/, 'each of two'], [/\bequal to\b/, 'less than'], [/\bif you\b/, 'unless you'],
    [/\band a\b/, 'or a'], [/\bThen put\b/, 'Then remove'], [/\bfor each\b/, 'for every'],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T28 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T28) {
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

describe('T28 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T28) {
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

describe.skipIf(index === null)('T28 design 6.10: examples are synthetic', () => {
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
    const verbatim = T28.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
