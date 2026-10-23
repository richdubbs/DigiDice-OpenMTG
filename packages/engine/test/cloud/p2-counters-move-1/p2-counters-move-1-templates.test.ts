/**
 * p2-counters-move-1 (lane p2-counters-move): the template data of parser/templates/zz-cloud/p2-counters-move-1.json ("move a counter / N counters from <obj>
 * onto [a second] <obj>" with no kind named, "move all counters from ...", "move any number of counters from ...", "proliferate N times", "proliferate, then
 * proliferate again") and the round's renderer changes (render/steps-life.ts#moveCounters: a second target, move all counters; render/steps-lasting.ts:
 * proliferate again). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example
 * does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated
 * card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * p2-counters-move-1-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 * Status (design 6.9): every template is `stable` on one or two hand-verified golden cards (tuning half) plus these tests and the scenarios: each wording is
 * printed on one or two cards of the tuning half, so three golden cards are out of reach (guide section 5, "Narrow wordings"; named in the round's record).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2cm1 from '../../../src/parser/templates/zz-cloud/p2-counters-move-1.json';
import review from '../../m5/golden/cards/p2-counters-move-1-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = p2cm1 as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Codex', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const typeOf = (text: string): [string, [string, string] | undefined] => (/^(When|Whenever|At)\b|^\{/.test(text) ? ['Creature — Beast', ['2', '2']] : ['Sorcery', undefined]);
const parsed = (text: string) => { const [type, pt] = typeOf(text); return face(type, text, pt); };
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');
const abilitiesJson = (f: ReturnType<typeof face>): string => JSON.stringify(f.abilities);

describe('p2-counters-move-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-counters-move-1.json, after zz-cloud/look3.json, before zz-cloud/p2-counters-state-1.json) and its ids are unique', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-counters-move-1.json');
    expect(files.indexOf('zz-cloud/p2-counters-move-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-counters-move-1.json')).toBeLessThan(files.indexOf('zz-cloud/p2-counters-state-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.p2cm1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.p2cm1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wordings, guide section 5): a stable template has at least one hand-verified golden card (tuning half) naming it', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`) || g.verified.includes(`(${t.id};`) || g.verified.includes(`(${t.id},`) || g.verified.includes(` ${t.id},`)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'second', 'again', 'then', 'additional', 'except']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-counters-move-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} if able.`, `${body} for each Elf you control.`];
  const swaps: [RegExp, string][] = [[/a counter/, 'a +1/+1 counter'], [/two counters/, 'three counters'], [/all counters/, 'all +1/+1 counters'], [/any number of counters/, 'up to one counter'],
    [/a second target/, 'a third target'], [/proliferate X times/, 'proliferate X cards'], [/proliferate three times/, 'proliferate four times'], [/proliferate again/, 'investigate again'], [/^Move/, 'Remove']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-counters-move-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/if able/for each" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsed(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsed(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('p2-counters-move-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('p2-counters-move-1 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|permanent)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => lines.has(x.trim())).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the readings and the renderer ---------------------------------------------------------------------------------------------------------------------

describe('p2-counters-move-1 (CR 122.5, 608.2d): moves of counters of any kind', () => {
  it('"move a counter from ... onto a second target ..." is a move of one counter of any kind between two targets, each its own choice (CR 115.3)', () => {
    const f = face('Artifact', '{1}, {T}: Move a counter from target artifact you control onto a second target artifact.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"op":"moveCounters","from":{"ref":"target","id":"t0"},"to":{"ref":"target","id":"t1"},"kind":"any","count":1');
    expect(abilitiesJson(f)).not.toContain('distinctFrom');
  });
  it('"onto another target ..." keeps the targets distinct; "move all counters" is the same JSON as "put its counters on" (kind any, count all)', () => {
    const f = face('Sorcery', 'Move all counters from target creature onto another target creature.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"distinctFrom":["t0"]');
    expect(abilitiesJson(f)).toContain('"kind":"any","count":"all"');
  });
  it('"move any number of counters" is `upTo` with every counter there (the controller chooses how many of each kind)', () => {
    const f = face('Enchantment', '{2}{W}: Move any number of counters from target creature you control onto a second target creature you control.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(abilitiesJson(f)).toContain('"kind":"any","count":"all","upTo":true');
  });
  it('fail closed: counters moved onto a group ("onto other creatures") or from a group stay manual (one object to one object only, CR 122.5)', () => {
    expect(fullFace(face('Creature — Beast', 'At the beginning of your upkeep, you may move any number of +1/+1 counters from ~ onto other creatures.', ['2', '2']))).toBe(false);
    expect(fullFace(face('Creature — Beast', 'Move any number of counters from other creatures you control onto ~.', ['2', '2']))).toBe(false);
  });
});

describe('p2-counters-move-1 (CR 701.34a): proliferate N times, proliferate again', () => {
  it('"Proliferate X times." reads the spell\'s X; "proliferate, then proliferate again" is proliferate twice (n 2)', () => {
    const x = parseCard(card('Example Codex', 'Sorcery', 'Proliferate X times.', { mana_cost: '{X}{U}{U}' }), OPTS).faces[0]!;
    expect(fullFace(x), JSON.stringify(x.diagnostics)).toBe(true);
    expect(abilitiesJson(x)).toContain('"action":"proliferate","who":{"ref":"you"},"n":{"q":"X"}');
    const again = face('Creature — Beast', 'When ~ dies, proliferate, then proliferate again.', ['2', '2']);
    const twice = face('Creature — Beast', 'When ~ dies, proliferate twice.', ['2', '2']);
    expect(fullFace(again), JSON.stringify(again.diagnostics)).toBe(true);
    expect(jsonKey(again.abilities)).toBe(jsonKey(twice.abilities));
  });
});
