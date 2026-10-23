/**
 * p2-counters-state-2 (lane p2-counters-state): the template data of parser/templates/zz-cloud/p2-counters-state-2.json (the weak generic "<instructions>, where X
 * is <quantity>") and the round's chart changes (parser/chart.ts#decide): a reading that leaves X undefined beside its own "where X is" clause loses to one that
 * does not (xFreeBesideWhereX), and readings are grouped by their meaning with the clause applied (meaningOf), so the clause read over two instructions or over the
 * last one only is one reading when the first does not use X.
 * Guard G9 (design 6.8): every example lowers with the template, is automated and passes the exact render gate (G6); counter-examples and near misses do not give
 * the same JSON; a nonsense word never leaves an automated card (G2), except the counter kind, which is data (CR 122.1). Examples are synthetic (design 6.10). The
 * behavior is in p2-counters-state-2-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { parseUnit, validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2cs2 from '../../../src/parser/templates/zz-cloud/p2-counters-state-2.json';
import review from '../../m5/golden/cards/p2-counters-state-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cs2 as Template[];
const ID = 'eff.p2cs2.effects.whereX';
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const face = (type: string, text: string) => parseCard(card('Example Codex', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const parsed = (text: string) => face('Artifact', text);
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('p2-counters-state-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-counters-state-2.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json); ids unique; the set validates', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files.indexOf('zz-cloud/p2-counters-state-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-counters-state-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9 / 6.3 rule 2: one template, weak (a specific template keeps its sentence), cites rules, two or more examples and counter-examples, version 8', () => {
    expect(MECH.map((t) => t.id)).toEqual([ID]);
    const t = MECH[0]!;
    expect(t.weak).toBe(1);
    expect(t.priority).toBeUndefined();
    for (const cr of t.cr) expect(cr).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
    expect(t.examples.length).toBeGreaterThanOrEqual(2);
    expect(t.counterExamples.length).toBeGreaterThanOrEqual(2);
    expect(t.since).toBe(8);
  });
  it('design 6.9: stable on three or more hand-verified tuning-half golden cards', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    expect(golden.filter((g) => g.verified.includes(`(${ID}`)).length).toBeGreaterThanOrEqual(3);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
});

describe('p2-counters-state-2 guard G9 (design 6.8)', () => {
  const t = MECH[0]!;
  it(`${ID}: every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
    for (const e of t.examples) {
      const f = parsed(e.text);
      expect(f.templatesUsed, e.text).toContain(ID);
      expect(fullFace(f), `${e.text}: ${JSON.stringify(f.gate)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
    }
    const first = parsed(t.examples[0]!.text);
    for (const c of t.counterExamples) {
      const f = parsed(c);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
    }
  });
  it(`${ID}: near misses (appended words, X swapped for Y, a different count) fail or differ`, () => {
    for (const e of t.examples) {
      const orig = parsed(e.text);
      const body = e.text.replace(/\.$/, '');
      const near = [`${body} unless it is blue.`, `${body} instead.`, `${body} twice.`, e.text.replace('where X is', 'where Y is'), e.text.replace('gloom counters', 'charge counters'), e.text.replace('Elves', 'Goblins')];
      for (const m of near) {
        if (m === e.text) continue;
        const f = parsed(m);
        expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
      }
    }
  });
  it(`${ID} guard G2: a nonsense word in place of any word (not the counter kind) never leaves an automated card`, () => {
    for (const e of t.examples) {
      const words = e.text.split(' ');
      words.forEach((w, i) => {
        if (w === '~' || w === '~.' || /^\{/.test(w) || /^counters?\b/.test(words[i + 1] ?? '')) return;
        const end = w.match(/[.,:]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
        expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
      });
    }
  });
});

const index = localIndex();
describe.skipIf(index === null)('p2-counters-state-2 design 6.10 (local index): synthetic examples', () => {
  it('no example or counter-example line is a line of a real card', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
      if (typeof text !== 'string') continue;
      for (const l of text.split('\n')) { lines.add(l.trim()); lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim()); }
    }
    expect(MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]).filter((x) => lines.has(x.trim()))).toEqual([]);
  }, 120_000);
});

describe('p2-counters-state-2 chart (CR 107.3, 608.2h): readings of a "where X is" clause', () => {
  it('"Draw X cards and gain X life, where X is ..." is one reading: the clause over both instructions (the one with the first X undefined loses)', () => {
    const f = parsed('{T}: Draw X cards and gain X life, where X is the number of gloom counters on ~.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    const json = JSON.stringify(f.abilities);
    expect(json).toContain('"op":"draw","who":{"ref":"you"},"count":{"q":"counters","on":{"ref":"self"},"kind":"gloom"}');
    expect(json).toContain('"op":"gainLife","who":{"ref":"you"},"amount":{"q":"counters","on":{"ref":"self"},"kind":"gloom"}');
    expect(json).not.toContain('{"q":"X"}');
  });
  it('the clause over an instruction that does not use X and the next one, or over the next one only, is one meaning (no G5)', () => {
    const f = parsed('{T}: Put a gloom counter on ~, then create an X/X black Zombie creature token, where X is the number of gloom counters on ~.');
    expect(f.diagnostics.filter((d) => d.code === 'ambiguous')).toEqual([]);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('a reading with X undefined is still kept when it is the only one (the tie-break never invents a reading): an X with no clause stays manual', () => {
    expect(fullFace(parsed('{T}: Draw X cards and gain X life.'))).toBe(false);
  });
  it('the chart result of a unit without "where X is" is unchanged by the grouping (two readings with different JSON stay ambiguous elsewhere: covered by G10)', () => {
    const toks = [{ kind: 'WORD', text: 'draw', norm: 'draw', start: 0, end: 4 }, { kind: 'WORD', text: 'a', norm: 'a', start: 5, end: 6 }, { kind: 'WORD', text: 'card', norm: 'card', start: 7, end: 11 }, { kind: 'PUNCT', text: '.', norm: '.', start: 11, end: 12 }];
    const r = parseUnit({ tokens: toks as never, goal: 'effects', templates: OPTS.templates, capabilities: OPTS.capabilities, env: { lexicon: OPTS.lexicon, keywords: OPTS.keywords } });
    expect(r.status).toBe('ok');
  });
});
