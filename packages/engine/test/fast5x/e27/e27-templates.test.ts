/**
 * FAST5X E27: the template data of parser/templates/zz-fast5x/e27.json: "you get an emblem with "..."" (CR 114.2), "as ~ transforms into ~, you get an
 * emblem with ..." (CR 712.20), equip with a choice of costs and with "Activate only once each turn." (CR 702.6a, 601.2b, 602.5b) and halflingcycling
 * (CR 702.29e). The ward costs (CR 702.21a) are no templates: the Keyword hole reads them (parser/holes/misc.ts#choiceCosts, parser/holes/cost.ts#getPoison).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate; every counter-example does not parse
 * or parses to different JSON; a nonsense word in place of any word of an example never leaves an automated ability (G2). Examples are synthetic wordings
 * (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import e27 from '../../../src/parser/templates/zz-fast5x/e27.json';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, fullyAutomated, jsonKey } from '../../m5/templates/support';

const E27 = e27 as Template[];
/** `bare` without the display texts (the expectations of the template file carry none, like the other keyword templates). */
const noText = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(noText);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'text').map(([k, x]) => [k, noText(x)]));
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
/** The type line an example reads as (CR 606: a loyalty ability is a planeswalker's; an equip line is an Equipment's). */
const typeOf = (t: Template, text: string): string => {
  if (/^[+-−]?\d+:/.test(text)) return 'Legendary Planeswalker — Testa';
  if (t.kind === 'effect') return 'Sorcery';
  if (/^equip/i.test(text)) return 'Artifact — Equipment';
  return 'Creature — Human';
};
const face = (t: Template, text: string) => {
  const type = typeOf(t, text);
  const pw = type.includes('Planeswalker');
  return parseCard({ name: 'Example Hero', layout: 'normal', type_line: type, oracle_text: text, ...(type.startsWith('Creature') ? { power: '2', toughness: '2' } : {}), ...(pw ? { loyalty: '5' } : {}) } as never, OPTS).faces[0]!;
};

describe('E27 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is in the default compiler (zz-fast5x/e27.json, path order: after e24.json, before e3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-fast5x/e27.json');
    expect(files.indexOf('zz-fast5x/e27.json')).toBeGreaterThan(files.indexOf('zz-fast5x/e24.json'));
    expect(files.indexOf('zz-fast5x/e27.json')).toBeLessThan(files.indexOf('zz-fast5x/e3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites its rules, has at least two examples and two counter-examples, a status, and is of version 8', () => {
    expect(E27.length).toBeGreaterThanOrEqual(6);
    for (const t of E27) {
      expect(t.id, t.id).toMatch(/^(kw|sta|eff)\.(e27|typecycling)\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      // stable once checked on real cards with `npm run cards -- try` (CONTRIBUTING); "Equip--<cost> or pay {M}" has no printed card yet
      expect(t.status, t.id).toBe(t.id === 'kw.e27.equip.or.paySecond' ? 'experimental' : 'stable');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of E27) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'except', 'first', 'rather', 'though', 'additional']) {
        if (words.includes(w)) expect((t.consumes ?? []).some((c) => c.split(' ').includes(w)), `${t.id}: ${w}`).toBe(true);
      }
    }
  });
});

describe('E27 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of E27) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is fully automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t, e.text);
        expect(f.templatesUsed, `${e.text}: ${JSON.stringify(f.diagnostics)}`).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(noText(bare(f.abilities)), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

describe('E27 guard G2 (design 6.8): a nonsense word never leaves an automated ability', () => {
  for (const t of E27) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the ability manual`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^~/.test(w) || /^\{/.test(w) || /^[+-−]?\d+:$/.test(w)) return;
          const bad = w.endsWith('.') ? 'blorfty.' : w.endsWith(',') ? 'blorfty,' : w.endsWith(':') ? 'blorfty:' : w.endsWith('."') ? 'blorfty."' : w.startsWith('"') ? '"blorfty' : 'blorfty';
          const mutated = [...words.slice(0, i), bad, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(face(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('E27 keyword costs read by the Keyword hole (CR 702.21a, 118.12a, 122.1f)', () => {
  const kw = (text: string) => face({ kind: 'ability' } as Template, text);
  it('"Ward--Discard a card or pay {2}." is ward with a choice of two costs; "Ward--Get two poison counters."; "Ward--Pay life equal to ~\'s power."', () => {
    expect(noText(bare(kw('Ward--Discard a card or pay {2}.').abilities))).toEqual([{ kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'oneOf', options: [{ other: [{ kind: 'discard', count: 1 }] }, { mana: [{ kind: 'generic', amount: 2 }] }] }] } }]);
    expect(noText(bare(kw('Ward--Get two poison counters.').abilities))).toEqual([{ kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'getCounters', counter: 'poison', amount: 2 }] } }]);
    expect(noText(bare(kw("Ward--Pay life equal to ~'s power.").abilities))).toEqual([{ kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'payLife', amount: { q: 'stat', stat: 'power', of: { ref: 'self' } } }] } }]);
    for (const text of ['Ward--Discard a card or pay {2}.', 'Ward--Get two poison counters.', "Ward--Pay life equal to ~'s power."]) {
      const f = kw(text);
      expect(fullyAutomated(f), text).toBe(true);
      expect(f.gate.every((g) => g.ok), text).toBe(true);
    }
  });
  it('the choice is read only after a keyword\'s dash: "As an additional cost ..." and "unless they ..." keep their own readings', () => {
    expect(fullyAutomated(kw('Ward--Discard a card or blorfty {2}.'))).toBe(false);
    expect(fullyAutomated(kw('Ward--Get two blorfty counters.'))).toBe(false);
    expect(fullyAutomated(kw('Ward--Discard a card or pay {2} or sacrifice a land.'))).toBe(false);
  });
});
