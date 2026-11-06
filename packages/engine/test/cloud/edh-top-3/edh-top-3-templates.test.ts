/**
 * Commander lane edh-top, round edh-top-3: the template data of parser/templates/zz-cloud/edh-top-3.json ("Return from your graveyard to the battlefield any number of target
 * creature cards that each have a different mana value X or less", "If X is 6 or more, ~ deals twice X damage divided as you choose among them instead") and the round's
 * engine, parser and renderer changes (TargetSpec.differentManaValues, a conditional divided total, "target creature it's blocking"), tested at the end of this file and in
 * edh-top-3-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-top-3-scenarios.test.ts. CR cites are from the Comprehensive Rules text
 * of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop3 from '../../../src/parser/templates/zz-cloud/edh-top-3.json';
import review from '../../m5/golden/cards/edh-top-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop3 as Template[];
const MECH_COUNT = 2;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on
 * one card (of the EDHREC top 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule
 * 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edht3.return.bf.differentManaValues.xOrLess': ["Agadeem's Awakening // Agadeem, the Undercrypt"],
  'rid.edht3.ifX.orMore.dividedTwiceInstead': ['Shatterskull Smashing // Shatterskull, the Hammer Pass'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a sorcery with {X} in its cost when the text reads X (CR 107.3). */
const parsedWith = (t: Template, text: string) =>
  parseCard(card('Example Plan', 'Sorcery', text, /\bX\b/.test(text) ? ({ mana_cost: '{X}{R}' } as Partial<OracleCard>) : {}), OPTS).faces[0]!;

describe('edh-top-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-3.json, path order: after edh-top-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-3.json');
    expect(files.indexOf('zz-cloud/edh-top-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples (or one with a second sentence) and two counter-examples, a status, and is of version 8; ids are *.edht3.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(1);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the cards that print the wording', () => {
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

describe('edh-top-3 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bdifferent mana value\b/, 'mana value'], [/\bcreature cards\b/, 'artifact cards'], [/\bfrom your graveyard\b/, 'from a graveyard'], [/\bX is 6 or more\b/, 'X is 6 or less'],
    [/\btwice X\b/, 'three times X'], [/\bamong them\b/, 'among those cards'], [/\bto the battlefield\b/, 'to your hand'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-top-3 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-top-3 engine, parser and renderer changes (one test each)', () => {
  it('TargetSpec.differentManaValues is a capability; the parser reads "that each have a different mana value X or less" in a general target phrase too', () => {
    expect(ENGINE_CAPABILITIES.has('feature:target.differentManaValues')).toBe(true);
    const general = parseCard(card('Example Recall', 'Sorcery', 'Return any number of target creature cards that each have a different mana value X or less from your graveyard to your hand.', { mana_cost: '{X}{B}' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(general)).toBe(true);
    expect(JSON.stringify(general.abilities)).toContain('"differentManaValues":true');
    // outside a plural target phrase the words are not read (a single target, or a count of creatures)
    const single = parseCard(card('Example Recall', 'Sorcery', 'Destroy target creature that has a different mana value X or less.', { mana_cost: '{X}{B}' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(single)).toBe(false);
  });
  it('lower/riders.ts#fixDividedTotals (CR 601.2d): the division announced is X below the number and twice X from it, as arithmetic the announcement reads; any other shape is left alone', () => {
    const f = parseCard(card('Example Smash', 'Sorcery', '~ deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 4 or more, ~ deals twice X damage divided as you choose among them instead.', { mana_cost: '{X}{R}' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"floorDiv"');
    const zero = parseCard(card('Example Smash', 'Sorcery', '~ deals X damage divided as you choose among up to two target creatures. If X is 0 or more, ~ deals twice X damage divided as you choose among them instead.', { mana_cost: '{X}{R}' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(zero)).toBe(false); // review: a condition that is not "N or more" with N at least 1 would announce X but deal twice X
    const plainDivided = parseCard(card('Example Smash', 'Sorcery', '~ deals X damage divided as you choose among up to two target creatures and/or planeswalkers.', { mana_cost: '{X}{R}' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(JSON.stringify(plainDivided.abilities)).not.toContain('floorDiv');
  });
  it('parser/holes/filter.ts + lower/anaphora.ts (CR 509.1g-h, 506.4): "target creature it\'s blocking" is read in an ability of a creature that sacrifices itself (the pronoun inside the target phrase is no pronoun before or after it); on a spell there is no creature it can mean', () => {
    const wall = parseCard(card('Example Wall', 'Creature — Wall', '{R}, Sacrifice this creature: It deals 2 damage to target creature it\'s blocking.', { power: '0', toughness: '3' }), OPTS).faces[0]!;
    expect(fullyAutomated(wall)).toBe(true);
    expect(JSON.stringify(wall.abilities)).toContain('"blockedByObject":{"ref":"self"}');
    const spell = parseCard(card('Example Plan', 'Sorcery', 'Destroy target creature it\'s blocking.'), OPTS).faces[0]!;
    expect(fullyAutomated(spell)).toBe(false);
  });
});
