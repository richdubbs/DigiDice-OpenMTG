/**
 * Lane trek, round trek-4 (Star Trek: clone with counters, phasing): the template data of parser/templates/zz-cloud/trek-4.json, the restriction action
 * `phaseIn` (types/ability.ts#RuleAction; statics/hooks.ts#phaseInDenied; rules/phasing.ts) and the enters-as-a-copy field `copiedCounters`
 * (effects/enters-parts/copy.ts; model/cap-walk.ts; render/stat.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the
 * exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any
 * word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present.
 * The behavior is in trek-4-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { UNWIRED_RULE_ACTIONS } from '../../../src/statics/hooks';
import round from '../../../src/parser/templates/zz-cloud/trek-4.json';
import review from '../../m5/golden/cards/trek-4-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 2;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A static ability of a creature card. */
const parse = (text: string) => parseCard(card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-4.json, after std-woe, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-4.json');
    expect(files.indexOf('zz-cloud/trek-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-woe.json'));
    expect(files.indexOf('zz-cloud/trek-4.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (rep|sta).trek4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rep|sta)\.trek4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): both wordings are printed on one tuning-half card each, so each is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(['rep.trek4.enters.copy.copiedCounters', 'sta.trek4.cantPhaseIn']);
    expect(evidence('rep.trek4.enters.copy.copiedCounters')).toEqual(['Dominion Saboteur']);
    expect(evidence('sta.trek4.cantPhaseIn')).toEqual(['The City on the Edge of Forever']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bIf you do\b/, "If you don't"], [/\badditional counters\b/, 'counters'], [/\bsame number and kinds\b/, 'same number'], [/\bthe copied permanent\b/, 'this permanent'],
    [/\bYou may have\b/, 'You have'], [/\bcan't phase in\b/, "can't phase out"], [/\bcan't phase in\b/, 'can phase in'], [/\bCreatures\b/, 'Target creature'],
    [/\bisn't legendary\b/, 'is legendary'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-4 lowering (parser/lower/ability.ts, WP22): the two sentences are one static ability, read as one unit', () => {
  it('"... except it isn\'t legendary. If you do, it enters with additional counters ..." is one replacement whose copy has `copiedCounters`', () => {
    const f = parse("You may have ~ enter as a copy of any artifact or creature on the battlefield, except it isn't legendary. If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it.");
    expect(f.abilities.length).toBe(1);
    expect(JSON.stringify(f.abilities[0])).toContain('"copy":{"of":{"types":["Artifact","Creature"],"zone":"battlefield"},"optional":true,"except":[{"layer":4,"supertypes":{"remove":["Legendary"]}}],"copiedCounters":true}');
  });
  it('the first sentence alone is still p2-copy-perm-1\'s (no counters)', () => {
    const f = parse("You may have ~ enter as a copy of any artifact or creature on the battlefield, except it isn't legendary.");
    expect(f.templatesUsed).toContain('rep.p2copyperm1.enters.copy.except');
    expect(JSON.stringify(f.abilities)).not.toContain('copiedCounters');
  });
  it('"Permanents can\'t phase in." is one restriction of every permanent (CR 702.26c); in a token\'s quoted ability too', () => {
    const f = parse("Permanents can't phase in.");
    expect(f.abilities[0]).toMatchObject({ kind: 'static', effects: [{ s: 'restrict', subject: { ref: 'each', filter: {} }, mode: 'cant', action: 'phaseIn' }] });
    const t = parseCard(card('Example Rite', 'Sorcery', 'Create a 0/1 white Human creature token with "Permanents can\'t phase in."'), OPTS).faces[0]!;
    expect(fullyAutomated(t), JSON.stringify(t.diagnostics)).toBe(true);
  });
});

describe('trek-4 renderer (render/stat.ts): the copied counters and "can\'t phase in"', () => {
  it('CR 614.1c: the counters sentence follows the copy sentence after "if you do"; the gate passes on both wordings (with and without exceptions)', () => {
    for (const text of [
      'You may have ~ enter as a copy of any creature on the battlefield. If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it.',
      "You may have ~ enter as a copy of an artifact you control, except it isn't legendary. If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied permanent has on it.",
    ]) {
      const f = parse(text);
      expect(f.gate.every((g) => g.ok), JSON.stringify(f.gate)).toBe(true);
    }
  });
  it('CR 702.26c: "<filter> can\'t phase in" says the filter as the plural subject', () => {
    const f = parse("Lands you control can't phase in.");
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
  });
});

describe('trek-4 engine capabilities (statics/hooks.ts, effects/enters-parts/copy.ts): registered by the code that honors them', () => {
  it('`rule:phaseIn` (rules/phasing.ts via phaseInDenied) and `body:enters.copy.copiedCounters` are engine capabilities; phaseIn is not listed as unwired', () => {
    expect(ENGINE_CAPABILITIES.has('rule:phaseIn')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('body:enters.copy.copiedCounters')).toBe(true);
    expect(Object.keys(UNWIRED_RULE_ACTIONS)).not.toContain('phaseIn');
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-4 design 6.10 (local index): synthetic examples', () => {
  it('no trek-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
