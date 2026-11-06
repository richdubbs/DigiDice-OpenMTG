/**
 * Commander lane copy, fourth pass, edh-d-60: the template data of parser/templates/zz-cloud/edh-d-60.json (a group that each become a copy "except those creatures aren't legendary", Echoing Equation;
 * "each creature you control other than the chosen creature becomes a copy of that creature", Loki, Lord of Misrule; "The copy targets that token.", Frontline Heroism) and the parser, renderer and
 * engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does
 * not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). The behavior is in edh-d-60-scenarios.test.ts. CR cites from memory unless the record names them (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD60 from '../../../src/parser/templates/zz-cloud/edh-d-60.json';
import review from '../../m5/golden/cards/edh-d-60-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD60 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhd60.eachOther.becomeCopy.thoseNotLegendary': ['Augmenter Pugilist // Echoing Equation'],
  'eff.edhd60.eachOtherThanChosen.becomeCopy': ['Loki, Lord of Misrule'],
  'rid.edhd60.copyTargets.object': ['Frontline Heroism'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>(['eff.edhd60.eachOther.becomeCopy.thoseNotLegendary', 'eff.edhd60.eachOtherThanChosen.becomeCopy']);
const ENCHANTMENT = new Set<string>(['rid.edhd60.copyTargets.object']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : ENCHANTMENT.has(t.id)
    ? parseCard(card('Example Idea', 'Enchantment', text), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-d-60 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-60.json, path order: after edh-d-6, before edh-d-7) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-60.json');
    expect(files.indexOf('zz-cloud/edh-d-60.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-6.json'));
    expect(files.indexOf('zz-cloud/edh-d-60.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-7.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhd60.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhd60\./);
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

describe('edh-d-60 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-60 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-60 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-d-60 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-60 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-60 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/filter.ts, render/np.ts (CR 205.4, 205.3m; Nashi): "legendary or Rat card" is a supertype or a subtype with the word card, singular, and nothing else', () => {
    const t = 'Whenever this creature attacks, exile up to one target legendary or Rat card from your graveyard and copy it. You may cast the copy.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"anyOf":[{"supertypes":["Legendary"]},{"subtypes":["Rat"]}]');
    expect(fullyAutomated(creature(t.replace('Rat card', 'Rat cards')))).toBe(false);
    expect(fullyAutomated(creature(t.replace('legendary or Rat', 'legendary and Rat')))).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 707.10, 601.2a; Errant): "a spell that wasn\'t cast" is a spell put on the stack, never cast', () => {
    const t = "{1}{U}, {T}: Copy target spell you control that wasn't cast. You may choose new targets for the copy.";
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"uncast":true');
    expect(fullyAutomated(creature(t.replace("wasn't cast", 'was cast')))).toBe(false);
  });
  it('templates/zz-cloud/std-copy-1.json (@into; CR 608.2c, 707.10f; Mizzix): the rider "If the copy is a permanent spell, it gains haste" reaches the copy inside "If you do"', () => {
    const t = 'Whenever you cast a spell, you may pay {1}. If you do, copy that spell. If the copy is a permanent spell, it gains haste.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"ifPermanent":true');
    expect(fullyAutomated(creature(t.replace('permanent spell', 'creature spell')))).toBe(false);
  });
  it('effects/handlers/tokens-copy.ts, render/steps-zones.ts (CR 707.10c; Frontline Heroism): the copy targets one given object; capability op:copy.targetsObject', () => {
    const t = 'Whenever you cast a spell that targets only a single creature you control, create a 1/1 red Soldier creature token with haste, then copy that spell. The copy targets that token.';
    expect(fullyAutomated(face(t, 'Enchantment', 'Example Idea'))).toBe(true);
    expect(JSON.stringify(face(t, 'Enchantment', 'Example Idea').abilities)).toContain('"targetsObject"');
    expect(fullyAutomated(face(t.replace('that token', 'you'), 'Enchantment', 'Example Idea'))).toBe(false);
  });
});
