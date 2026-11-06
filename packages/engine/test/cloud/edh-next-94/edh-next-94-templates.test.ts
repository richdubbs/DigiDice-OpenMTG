/**
 * Commander top-rank second pass 2, edh-next-94: the template data of parser/templates/zz-cloud/edh-next-94.json ("you may tap any number of untapped <filter> you control", "as long as <condition>,
 * <filter> enter tapped / untapped", "you may have the base power and toughness of <objects> become equal to ~'s power and toughness") and the parser, renderer and engine changes of the round (one test
 * each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10). The behavior is in
 * edh-next-94-scenarios.test.ts. CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext94 from '../../../src/parser/templates/zz-cloud/edh-next-94.json';
import review from '../../m5/golden/cards/edh-next-94-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext94 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn94.tap.anyNumber.draw': ['Guild Summit'],
  'sta.edhn94.asLongAs.enterTapped': ['Archelos, Lagoon Mystic'],
  'sta.edhn94.asLongAs.enterUntapped': ['Archelos, Lagoon Mystic'],
  'eff.edhn94.mayHave.basePT.ofObjs.equalTo.stat': ['Tanazir Quandrix'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>([]);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-94 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-94.json, path order: after edh-next-9, before edh-perms-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-94.json');
    expect(files.indexOf('zz-cloud/edh-next-94.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-9.json'));
    expect(files.indexOf('zz-cloud/edh-next-94.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn94.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn94\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-next-94 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-94 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-next-94 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-94 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-94 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-94 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/edhn94.ts, parser/lower/quantities.ts, render/steps-zones.ts (CR 701.26a, 608.2c; Angel\'s Trumpet): "the number of creatures tapped this way" counts what the tap step before it tapped, and only a noun that fits it', () => {
    const t = "At the beginning of each player's end step, tap all untapped creatures that player controls that didn't attack this turn. ~ deals damage to the player equal to the number of NOUN tapped this way.";
    expect(fullyAutomated(creature(t.replace('NOUN', 'creatures')))).toBe(true);
    expect(JSON.stringify(creature(t.replace('NOUN', 'creatures')).abilities)).toContain('"q":"resultCount","step":"tap"');
    // a noun the tap step does not name (it taps creatures, not Wizards or artifacts): no candidate amount
    expect(fullyAutomated(creature(t.replace('NOUN', 'artifacts')))).toBe(false);
    expect(fullyAutomated(creature(t.replace('NOUN', 'Wizards')))).toBe(false);
    // no tap step before it
    expect(fullyAutomated(creature('~ deals damage to the player equal to the number of creatures tapped this way.'))).toBe(false);
  });
  it('parser/lower/quantities.ts (CR 701.26a, 608.2c): a tap step is never an antecedent of "that many"', () => {
    expect(fullyAutomated(creature('Whenever ~ attacks, tap target creature. Draw that many cards.'))).toBe(false);
  });
  it('render/steps-cards.ts (CR 701.26a, 608.2c; Guild Summit): "draw a card for each Gate tapped this way" after the any-number tap of Gates; the noun must fit', () => {
    const t = 'When ~ enters, you may tap any number of untapped Gates you control. Draw a card for each Gate tapped this way.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(fullyAutomated(creature(t.replace('for each Gate tapped', 'for each Wizard tapped')))).toBe(false);
    expect(fullyAutomated(creature(t.replace('you may tap', 'tap').replace('Gates you', 'Gates you')))).toBe(true);
  });
  it('parser/holes/edhn94.ts, render/cond.ts (CR 110.2, 608.2c; Modify Memory): "if you control neither creature" after an exchange of control', () => {
    const t = 'Exchange control of two target creatures controlled by different players. If you control neither creature, draw three cards.';
    const sp = (x: string) => parseCard(card('Example Plan', 'Sorcery', x, { mana_cost: '{4}{U}' }), OPTS).faces[0]!;
    expect(fullyAutomated(sp(t))).toBe(true);
    expect(JSON.stringify(sp(t).abilities)).toContain('"controller":"you"');
    expect(fullyAutomated(sp(t.replace('neither creature', 'either creature')))).toBe(false);
    expect(fullyAutomated(sp('If you control neither creature, draw three cards.'))).toBe(false);
  });
  it('render/mods.ts (CR 613.4b; Tanazir Quandrix): the base power and toughness of a set become equal to the power and toughness of one object', () => {
    const t = "Whenever ~ attacks, you may have the base power and toughness of other creatures you control become equal to ~'s power and toughness until end of turn.";
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(fullyAutomated(creature(t.replace("~'s power and toughness", "~'s power")))).toBe(false);
  });
});
