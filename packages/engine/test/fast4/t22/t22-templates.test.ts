/**
 * FAST4 T22: the template data of parser/templates/zz-fast4/t22.json (power/toughness, counters and keyword-grant shapes: doubling, "for each Aura attached
 * to it", "put X counters ..., where X is ...") and the renderer readings the package's shapes needed (design 6.8 G6: render/double.ts, render/np.ts,
 * render/steps-flow.ts, render/steps-lasting.ts, render/steps-life.ts). Guard G9 (design 6.8): every example lowers with its template, is fully automated
 * and passes the exact render gate; every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings (design 6.10).
 *
 * Parsed with the default template set (parser/template-set.ts: what the game compiles with), so the T22 templates compose with every other file.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import t22 from '../../../src/parser/templates/zz-fast4/t22.json';
import { automated, bare, exampleCard, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const T22 = t22 as Template[];
const OPTS = defaultParseOptions();
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard({ name: 'Example Charm', layout: 'normal', type_line: type, oracle_text: text } as never, OPTS).faces[0]!;

describe('T22 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast4/t22.json, path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast4/t22.json');
    expect(files.indexOf('zz-fast4/t22.json')).toBeGreaterThan(files.indexOf('zz-fast3/t18.json'));
    expect(files.indexOf('zz-fast4/t22.json')).toBeLessThan(files.indexOf('zz-m6/copy.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 7 (FAST4)', () => {
    expect(T22.length).toBe(6);
    for (const t of T22) {
      expect(['static', 'effect'], t.id).toContain(t.kind);
      expect(t.id, t.id).toMatch(/^(sta|eff)\.t22\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(7);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of T22) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'chosen', "can't", 'double']) if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
    }
  });
});

describe('T22 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of T22) {
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

describe('T22 lowering (CR 701.10b-c, 608.2f, 608.2h, 611.2c): what the doubling and counting shapes mean', () => {
  it('CR 701.10b, 611.2d: "double the power and toughness of each Elf you control" is +X/+Y with X and Y the power and toughness of each Elf it modifies', () => {
    // the effect handler stores one effect per Elf with its own values, all read as the effect begins (effects/handlers/lasting.ts#effectsToStore)
    const f = face('Sorcery', 'Double the power and toughness of each Elf you control until end of turn.');
    expect(f.templatesUsed).toContain('eff.t22.double.pt');
    const subject = { ref: 'subject' };
    expect((f.abilities[0] as unknown as { effect: { steps: unknown[] } }).effect.steps).toEqual([{
      op: 'effect', duration: { d: 'endOfTurn' },
      effects: [{ s: 'continuous', affects: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } }, mods: [{ layer: '7c', power: { q: 'stat', stat: 'power', of: subject }, toughness: { q: 'stat', stat: 'toughness', of: subject } }] }],
    }]);
  });
  it('CR 701.10b: "double target creature\'s power" is +X/+0 with X that creature\'s power', () => {
    const f = face('Instant', "Double target creature's power until end of turn.");
    expect(f.templatesUsed).toContain('eff.t22.double.power');
    expect(JSON.stringify(f.abilities[0])).toContain('"power":{"q":"stat","stat":"power","of":{"ref":"target","id":"t0"}},"toughness":0');
  });
  it('CR 107.3, 608.2h: "put X +1/+1 counters on each creature you control, where X is the number of Elves you control" counts the Elves as it resolves', () => {
    const f = face('Sorcery', 'Put X +1/+1 counters on each creature you control, where X is the number of Elves you control.');
    expect(f.templatesUsed).toContain('eff.t22.counters.put.whereX');
    expect((f.abilities[0] as unknown as { effect: { steps: unknown[] } }).effect.steps).toEqual([
      { op: 'putCounters', on: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, kind: '+1/+1', count: { q: 'count', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } } },
    ]);
  });
  it('CR 301.5, 303.4: "for each Aura attached to it" counts the Auras attached to the object itself (attachedToObject), never every attached Aura', () => {
    const f = face('Creature — Spirit', '~ gets +1/+1 for each Aura attached to it.');
    expect(JSON.stringify(f.abilities[0])).toContain('"filter":{"subtypes":["Aura"],"attachedToObject":{"ref":"self"}}');
    const g = face('Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each Aura and Equipment attached to it.');
    expect(JSON.stringify(g.abilities[1])).toContain('"filter":{"subtypes":["Aura","Equipment"],"attachedToObject":{"ref":"attachedTo"}}');
  });
  it('fails closed: a doubling without a duration, of toughness alone, or of a player\'s life is not read by these templates', () => {
    for (const text of ["Double target creature's toughness until end of turn.", 'Double the power and toughness of each creature you control.', 'Double your life total.']) {
      const f = face('Sorcery', text);
      expect(f.templatesUsed.filter((id) => id.startsWith('eff.t22.')), text).toEqual([]);
    }
  });
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bgets\b/, 'gains'], [/\bpower and toughness\b/, 'power'], [/\bpower\b/, 'toughness'], [/\byou control\b/, 'an opponent controls'], [/\battached to it\b/, 'you control'],
    [/\bAura\b/, 'Curse'], [/\bEquipment\b/, 'Fortification'], [/\bwhere X\b/, 'where Y'], [/\bput X\b/, 'put two'], [/\bDouble\b/, 'Triple'], [/\bdouble\b/, 'triple'],
    [/\buntil end of turn\b/, ''],
  ];
  for (const [re, by] of swaps) if (re.test(body)) out.push(`${body.replace(re, by).replace(/\s+/g, ' ').trim()}.`);
  return out;
}

describe('T22 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of T22) {
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

describe('T22 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of T22) {
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

/** Lines of other templates an example needs as they are: an Aura's enchant line. */
const SHARED_LINES = new Set(['Enchant creature']);

describe.skipIf(index === null)('T22 design 6.10: examples are synthetic', () => {
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
    const verbatim = T22.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]
      .filter((x) => x.split('\n').some((l) => !SHARED_LINES.has(l.trim()) && lines.has(l.trim())))
      .map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
