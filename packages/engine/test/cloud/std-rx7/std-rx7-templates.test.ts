/**
 * std-rx7 (card wave 2, slice s20): the template data of parser/templates/zz-cloud/std-rx7.json and the round's parser and renderer support: the keyword
 * casualty (keywords/data/casualty.json, an optional additional cost and a copy trigger like conspire), "that many" after a leaves-the-battlefield trigger
 * that describes its object by its counters (parser/lower/scope.ts, render/qty.ts#countersNamedByTrigger), and the singular "each instant and sorcery spell you
 * cast" (render/refs.ts, family type-list). Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rx7-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx7 from '../../../src/parser/templates/zz-cloud/std-rx7.json';
import review from '../../m5/golden/cards/cloud-std-rx7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RX7 = stdRx7 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line each template's examples are printed on. */
const TYPE: Readonly<Record<string, string>> = {
  'sta.stdrx7.spells.cast.each.casualty': 'Creature — Dragon',
};
const face = (id: string, text: string, typeLine?: string) => {
  const type = typeLine ?? TYPE[id] ?? 'Creature — Ouphe';
  return parseCard(card('Example Relic', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');

describe('std-rx7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx7.json, after zz-cloud/std-rw6.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx7.json');
    expect(files.indexOf('zz-cloud/std-rx7.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rw6.json'));
    expect(files.indexOf('zz-cloud/std-rx7.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RX7.map((t) => t.id)).toEqual(Object.keys(TYPE));
    for (const t of RX7) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rst)\.stdrx7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // a narrow wording (one Standard card in the index): stable on one hand-verified golden card plus these tests and a played scenario, a 6.9 deviation named
    // in the round record and the PR
    expect(goldenUsing('sta.stdrx7.spells.cast.each.casualty')).toEqual(['Silverquill, the Disputant']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RX7) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'next', 'then', 'when', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx7 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RX7) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.id, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(t.id, e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(t.id, c);
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [[/\bcasualty\b/, 'conspire'], [/\byou cast\b/, 'you control'], [/\bhas\b/, 'gains'], [/\bEach\b/, 'Target']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RX7) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(t.id, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(t.id, m);
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rx7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RX7) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(t.id, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-rx7 keyword casualty (CR 702.153a)', () => {
  it('"Casualty N" on a spell is automated: an optional additional cost (sacrifice a creature with power N or greater) and a cast trigger that copies the spell', () => {
    const d = compileCard(card('Example Relic', 'Instant', 'Casualty 3\nYou gain 2 life.'));
    expect(d.automation.level).toBe('full');
  });
  it('"Casualty X" with its own rider stays manual (fails closed: the copy\'s exceptions are not read)', () => {
    const d = compileCard(card('Example Relic', 'Legendary Planeswalker — Bolas', 'Casualty X. The copy isn\'t legendary and has starting loyalty X.\n+1: You gain 1 life.', { loyalty: '3' } as never));
    expect(d.automation.level).not.toBe('full');
  });
});

describe('std-rx7 parser support: "that many" counters on the object that left (CR 603.10a, 608.2h)', () => {
  const T = 'Whenever a creature you control with one or more counters on it dies, ';
  it('"exile that many cards from the top of your library" counts the counters of any kind on the creature that died', () => {
    const f = face('x', `${T}exile that many cards from the top of your library.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"count":{"q":"counters","on":{"ref":"event","role":"subject"},"kind":"any"}');
  });
  it('a +1/+1 counter description counts +1/+1 counters only', () => {
    const f = face('x', 'Whenever a creature you control with one or more +1/+1 counters on it dies, exile that many cards from the top of your library.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"q":"counters","on":{"ref":"event","role":"subject"},"kind":"+1/+1"}');
  });
  it('a batch ("one or more creatures ... die") or a count other than "one or more" names no number: "that many" stays manual (design 6.4)', () => {
    expect(fullyAutomated(face('x', 'Whenever one or more creatures you control with counters on them die, draw that many cards.'))).toBe(false);
    expect(fullyAutomated(face('x', 'Whenever a creature you control with three or more counters on it dies, draw that many cards.'))).toBe(false);
  });
  it('a trigger that does not leave the battlefield is not read so ("enters with one or more counters on it")', () => {
    expect(fullyAutomated(face('x', 'Whenever a creature you control with one or more counters on it enters, draw that many cards.'))).toBe(false);
  });
});

describe('std-rx7 renderer support', () => {
  it('CR 205.2a (family type-list): "Each instant and sorcery spell you cast has ..." is the set "instant or sorcery spells you cast"', () => {
    const a = face('sta.stdrx7.spells.cast.each.casualty', 'Each instant and sorcery spell you cast has casualty 1.');
    const b = face('x', 'Instant and sorcery spells you cast have convoke.', 'Creature — Dragon');
    expect(fullyAutomated(a)).toBe(true);
    expect(fullyAutomated(b)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"types":["Instant","Sorcery"]');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-rx7 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = RX7.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
