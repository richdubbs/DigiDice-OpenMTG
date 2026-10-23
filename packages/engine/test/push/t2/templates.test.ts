/**
 * PUSH1 T2: the templates of parser/templates/zz-push/t2.json (prevention shields of the next N damage, CR 615.7; "gain N life" inside "you may", CR 119.1).
 * Guard G9 (design 6.8): every example lowers with its template on the game path (the whole committed template set), is automated and passes the exact
 * render gate (G6); every counter-example does not parse to the same JSON; near-miss mutations fail or differ; a nonsense word never leaves an automated
 * ability (G2). Examples are synthetic wordings (design 6.10): a test fails when one is a line of a real card.
 */
import { describe, expect, it } from 'vitest';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { localIndex } from '../../m5/parser/support';
import { automated, fullyAutomated, jsonKey, parsed, T2_TEMPLATES } from './support';

describe('PUSH1 T2: zz-push/t2.json is well formed (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('it is part of the game path, in the zz-push block loaded after every non-push file, and compiles with the whole template set', () => {
    expect(T2_TEMPLATES.length).toBeGreaterThan(0);
    const files = TEMPLATE_FILES.map((f) => f.file);
    const mine = TEMPLATE_FILES.find((f) => f.file === 'zz-push/t2.json');
    expect(mine?.templates.map((t) => t.id)).toEqual(T2_TEMPLATES.map((t) => t.id));
    // other push packages add their own zz-push/<package>.json: only the order of the push block after the rest is pinned, not T2's place in it
    const firstPush = files.findIndex((f) => f.startsWith('zz-push/'));
    expect(files.slice(firstPush).every((f) => f.startsWith('zz-push/'))).toBe(true);
    expect(files.indexOf('zz-push/t2.json')).toBeGreaterThanOrEqual(firstPush);
    expect(validateTemplates(TEMPLATE_SET)).toEqual([]);
  });
  it('every template cites CR rules, has at least two examples and two counter-examples, and lists the critical words it spells out', () => {
    for (const t of T2_TEMPLATES) {
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.id, t.id).toMatch(/^eff\./);
      expect(['experimental', 'stable'], t.id).toContain(t.status);
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'would']) if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
  it.skipIf(localIndex() === null)('design 6.10: no example or counter-example is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of localIndex() ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) lines.add(l.trim().toLowerCase());
      }
    }
    for (const t of T2_TEMPLATES) for (const s of [...t.examples.map((e) => e.text), ...t.counterExamples]) expect(lines.has(s.toLowerCase()), `${t.id}: ${s}`).toBe(false);
  });
});

describe('PUSH1 T2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T2_TEMPLATES) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples never give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      // a counter-example states the number of the first example, so "differs from the first example's JSON" cannot pass on the number alone
      const numbers = (x: string): string[] => x.match(/\d+/g) ?? [];
      for (const c of t.counterExamples) {
        expect(numbers(c).every((n) => numbers(t.examples[0]!.text).includes(n)), `${t.id}: ${c}`).toBe(true);
        const f = parsed(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `Don't ${body.charAt(0).toLowerCase()}${body.slice(1)}.`];
  const swaps: [RegExp, string][] = [[/\btarget\b/, 'each'], [/\bany target\b/, 'each creature'], [/\bthe next\b/, 'all'], [/\bthis turn\b/, 'this combat'], [/\byou\b/, 'each opponent']];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by)}.`);
  return out;
}

describe('PUSH1 T2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T2_TEMPLATES) {
    it(`${t.id}: an appended "unless/instead/at random/twice", a negation or a swapped word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          const f = parsed(m);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('PUSH1 T2 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T2_TEMPLATES) {
    it(`${t.id}: replacing any one word of an example by an invented word makes it manual or changes it`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return;
          const mutated = [...words.slice(0, i), w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : 'blorfty', ...words.slice(i + 1)].join(' ');
          const f = parsed(mutated);
          expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), mutated).toBe(false);
          expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('blorfty'), mutated).toBe(false);
        });
      }
    });
  }
});

/** Template shape check of the any-target shield: one target, both parts of the recipient name it (CR 115.4). */
describe('PUSH1 T2: the JSON of the templates (CR 615.7, 611.2c, 115.4)', () => {
  const effectOf = (text: string): unknown => (parsed(text).abilities[0] as { effect: unknown }).effect;
  it('CR 615.7: "the next N damage ... to target creature this turn" is a shield of N on that target, until end of turn', () => {
    expect(effectOf('Prevent the next 7 damage that would be dealt to target creature this turn.')).toEqual({
      targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }],
      steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'target', id: 't0' } } } }, body: { b: 'prevent', amount: 7 }, shield: { uses: 'all' } }] }],
    });
  });
  it('CR 115.4: "any target" is ONE target spec, and the shield covers it whether it is an object or a player', () => {
    expect(effectOf('Prevent the next 7 damage that would be dealt to any target this turn.')).toEqual({
      targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }],
      steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'replace', replaces: { ev: 'damage', recipient: { object: { is: { ref: 'target', id: 't0' } }, player: { ref: 'target', id: 't0' } } }, body: { b: 'prevent', amount: 7 }, shield: { uses: 'all' } }] }],
    });
  });
  it('CR 119.1, 109.5: "You may gain N life" is a may of the controller gaining N life', () => {
    expect(effectOf('You may gain 7 life.')).toEqual({ targets: [], steps: [{ op: 'may', who: { ref: 'you' }, do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 7 }] }] });
  });
});
