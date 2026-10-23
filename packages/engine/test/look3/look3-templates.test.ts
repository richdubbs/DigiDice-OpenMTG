/**
 * LOOK3 (a LOOK1 follow-up): the template data of parser/templates/zz-cloud/look3.json, "If you don't put the card onto the battlefield / into your hand, <effects>." Guard G9
 * (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The readings are in look3-lowering.test.ts, the behavior in look3-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../src/index';
import type { Template } from '../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../src/parser/parse';
import { validateTemplates } from '../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../src/model/capabilities';
import look3 from '../../src/parser/templates/zz-cloud/look3.json';
import review from '../m5/golden/cards/look3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../m5/templates/support';
import { localIndex } from '../m5/parser/support';

const LOOK3 = look3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered or activated ability on a creature. */
function exampleCard(text: string): OracleCard {
  if (!text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Glimpse', 'Sorcery', text);
  return card('Example Seer', 'Creature — Elf Scout', text, { power: '2', toughness: '2' });
}
const parsed = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;

describe('LOOK3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/look3.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/look3.json');
    expect(files.indexOf('zz-cloud/look3.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/look3.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.look3.*', () => {
    expect(LOOK3.map((t) => t.id)).toEqual(['eff.look3.ifNotPut.battlefield', 'eff.look3.ifNotPut.hand']);
    for (const t of LOOK3) {
      expect(t.id, t.id).toMatch(/^eff\.look3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence, three hand-verified golden cards that use it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of LOOK3.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('the zone the build says is the zone the pattern says (the renderer writes the words back from it, render/cond.ts#notPutPhrase)', () => {
    for (const t of LOOK3) {
      const to = ((t.build as Record<string, unknown>)['cond'] as Record<string, unknown>)['to'];
      expect(t.pattern, t.id).toContain(to === 'battlefield' ? 'onto the battlefield' : 'into your hand');
      expect(t.id.endsWith(String(to)), t.id).toBe(true);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of LOOK3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'not', 'never']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('LOOK3 INTERFACE CHANGE (parser/chart.ts#buildRefs): a build may hold the Cond hole\'s own "did" marker, and nothing looser', () => {
  const tpl = (cond: unknown): Template => ({ ...LOOK3[0]!, id: 'eff.look3.probe', build: { op: 'if', cond, then: '$e' } });
  it('the marker of "you do" / "you don\'t", with `not` and the zone `to`, compiles', () => {
    expect(validateTemplates([tpl({ cond: 'did', step: '', $step: 'previous', not: true, to: 'hand' })])).toEqual([]);
    expect(validateTemplates([tpl({ cond: 'did', step: '', $step: 'previous' })])).toEqual([]);
  });
  it('anything else with a "$step" is refused: another condition, a named step, another value, another key, another zone', () => {
    for (const bad of [
      { cond: 'matches', step: '', $step: 'previous' },
      { cond: 'did', step: 'paid', $step: 'previous' },
      { cond: 'did', step: '', $step: 'next' },
      { cond: 'did', step: '', $step: 'previous', which: { types: ['Land'] } },
      { cond: 'did', step: '', $step: 'previous', not: 'yes' },
      { cond: 'did', step: '', $step: 'previous', not: true, to: 'exile' },
    ]) expect(validateTemplates([tpl(bad)]).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });
});

describe('LOOK3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of LOOK3) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsed(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsed(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/If you don't put/, 'If you put'], [/If you don't put/, "If an opponent doesn't put"], [/If you don't put/, "If you don't reveal"],
    [/don't put (the card|it) onto the battlefield/, "don't put $1 into your hand"], [/don't put (the card|it) into your hand/, "don't put $1 onto the battlefield"],
    [/don't put the card/, "don't put the cards"], [/don't put it /, "don't put them "], [/you may put it/, 'target opponent may put it'],
    [/If you don't put (the card|it) (onto the battlefield|into your hand),/, 'Otherwise,'], [/If you don't put (the card|it) (onto the battlefield|into your hand),/, "If you don't,"],
    [/look at the top card/i, 'look at the top two cards'], [/your library/, "an opponent's library"],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('LOOK3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of LOOK3) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('LOOK3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of LOOK3) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsed(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('LOOK3 design 6.10 (local index): synthetic examples', () => {
  it('no line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = LOOK3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
