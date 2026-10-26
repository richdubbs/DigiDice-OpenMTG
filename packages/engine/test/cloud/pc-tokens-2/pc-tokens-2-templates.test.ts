/**
 * Lane pc-tokens, round pc-tokens-2 (Commander precon decks: copies and token replacements): the template data of parser/templates/zz-cloud/pc-tokens-2.json, the
 * copy body field `duration` (types/ability.ts, effects/enters-parts/copy.ts, render/stat.ts), the token filter of a token-creation replacement (effects/replacements.ts
 * #tokenDefMatches: subtypes and anyOf), the step field `exceptReplaced` (effects/handlers/tokens-create.ts) and the self-reference rule for a token's given name
 * (parser/front/selfref.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2).
 * Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in pc-tokens-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/pc-tokens-2.json';
import review from '../../m5/golden/cards/pc-tokens-2-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 2;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A spell: the sentences of a sorcery. */
const parse = (text: string, type = 'Enchantment', pt?: { power: string; toughness: string }) => parseCard(card('Example Ooze', type, text, pt ?? {}), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('pc-tokens-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-tokens-2.json, after p2-zone-moves-1, before r3-choose) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-tokens-2.json');
    expect(files.indexOf('zz-cloud/pc-tokens-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/p2-zone-moves-1.json'));
    expect(files.indexOf('zz-cloud/pc-tokens-2.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are rep.pctokens2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^rep\.pctokens2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one precon card, so each template is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(['rep.pctokens2.asEnters.becomeCopy.until.exceptHas', 'rep.pctokens2.tokens.clueFoodTreasure.oneOfEach']);
    expect(evidence('rep.pctokens2.asEnters.becomeCopy.until.exceptHas')).toEqual(['Cursed Mirror']);
    expect(evidence('rep.pctokens2.tokens.clueFoodTreasure.oneOfEach')).toEqual(['Academy Manufactor']);
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

describe('pc-tokens-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\buntil end of turn\b/, 'until your next turn'], [/\bYou may\b/, 'You'], [/\bit has\b/, 'it loses'], [/\bClue, Food, or Treasure\b/, 'Clue, Food, or Blood'], [/\bif you would\b/, 'if an opponent would'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-tokens-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('pc-tokens-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe('pc-tokens-2 lowering, holes and renderer: the readings that are no template of their own', () => {
  it('CR 201.2, 111.4: the card\'s name inside a token\'s given name ("named Kobolds of <card>") is no self reference; elsewhere the name is still "~"', () => {
    const f = parseCard(card('Example Keep', 'Land', '{1}{R}, {T}: Create a 0/1 red Kobold creature token named Kobolds of Example Keep.', {}), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"name":"Kobolds of Example Keep"');
    const g = parseCard(card('Example Keep', 'Land', '{1}{R}, {T}: Example Keep deals 1 damage to target creature.', {}), OPTS).faces[0]!;
    expect(fullyAutomated(g), JSON.stringify(g.diagnostics)).toBe(true);
  });
  it('CR 614.12, 611.2: an enters-as-a-copy with a duration is a layer 1a copy effect of that duration; without the words it is the permanent copy of the existing templates', () => {
    const f = parse('As ~ enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.', 'Artifact');
    expect(fullyAutomated(f), JSON.stringify(f.gate)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"duration":{"d":"endOfTurn"}');
    const perm = parse('You may have ~ enter as a copy of any creature on the battlefield, except it has haste.', 'Artifact');
    expect(JSON.stringify(perm.abilities)).not.toContain('"duration"');
  });
});

describe('pc-tokens-2 engine capabilities: registered by the code that honors them', () => {
  it('`body:enters.copy.duration` and `feature:createToken.exceptReplaced` are engine capabilities', () => {
    expect(ENGINE_CAPABILITIES.has('body:enters.copy.duration')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:createToken.exceptReplaced')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('pc-tokens-2 design 6.10 (local index): synthetic examples', () => {
  it('no pc-tokens-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
