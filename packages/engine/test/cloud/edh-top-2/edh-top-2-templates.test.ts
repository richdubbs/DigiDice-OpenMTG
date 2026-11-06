/**
 * Commander lane edh-top, round edh-top-2: the template data of parser/templates/zz-cloud/edh-top-2.json (soulbond's "as long as ~ is paired with another creature, each of
 * those creatures has ...", "becomes a Treasure artifact ... and loses all other card types and abilities", "if target player has fewer than nine poison counters, they get
 * a number of poison counters equal to the difference") and the round's engine, keyword and renderer changes (soulbond, compleated, cipher, a mana ability that reads what
 * its cost exiled), tested at the end of this file and in edh-top-2-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-top-2-scenarios.test.ts. CR cites are from the Comprehensive Rules text
 * of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { keywordRegistry } from '../../../src/keywords/registry';
import edhTop2 from '../../../src/parser/templates/zz-cloud/edh-top-2.json';
import review from '../../m5/golden/cards/edh-top-2-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop2 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on
 * one or two cards (of the EDHREC top 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule
 * 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edht2.paired.each.has': ['Deadeye Navigator', 'Tandem Lookout'], // the two soulbond cards of the top 5,000 that print "each of those creatures has"
  'eff.edht2.becomes.artifact.losesOthers': ["Vraska, Betrayal's Sting"],
  'eff.edht2.poison.toNine': ["Vraska, Betrayal's Sting"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a creature for a static ability, a sorcery for an effect. */
const parsedWith = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-top-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-2.json, path order: after edh-top-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-2.json');
    expect(files.indexOf('zz-cloud/edh-top-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edht2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg)\.edht2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
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

describe('edh-top-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bpaired with another creature\b/, 'paired with another artifact'], [/\beach of those creatures has\b/, 'each other creature has'], [/\bTarget creature\b/, 'Target land'],
    [/\bloses all other card types and abilities\b/, 'loses all other abilities'], [/\bfewer than\b/, 'more than'], [/\bthey get\b/, 'you get'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-top-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-top-2 keyword, engine and renderer changes (one test each)', () => {
  const kw = (name: string) => keywordRegistry.get(name);
  it('keywords/data/soulbond.json (CR 702.95a): implemented, expands into the two triggered abilities; "paired" filter, ref pair and op pair are capabilities', () => {
    expect(kw('soulbond')?.status).toBe('implemented');
    expect(kw('soulbond')?.expand?.length).toBe(2);
    for (const c of ['keyword:soulbond', 'op:pair', 'ref:pair', 'sref:pair', 'filter:paired', 'sfilter:paired']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
  it('keywords/data/cipher.json (CR 702.99a): implemented, a static ability that functions in exile (the encoding itself is native: core/resolve.ts#leaveStack)', () => {
    expect(kw('cipher')?.status).toBe('implemented');
    const expand = (kw('cipher')?.expand ?? []) as { kind: string; zone?: string[] }[];
    expect(expand.map((e) => e.zone?.[0])).toEqual(['exile']);
    expect(ENGINE_CAPABILITIES.has('keyword:cipher')).toBe(true);
  });
  it('keywords/data/compleated.json (CR 702.150a): native (core/zones.ts#enterWithPrintedCounters acts on it)', () => {
    expect(kw('compleated')?.status).toBe('native');
    expect(ENGINE_CAPABILITIES.has('keyword:compleated')).toBe(true);
  });
  it('rules/mana.ts#manaCostShape + model/cap-walk.ts (CR 118.3, 605.3b, 608.2h): a mana ability that reads what its cost exiled is offered (feature:mana.cost no longer named); reading what the source itself exiled stays out', () => {
    const food = parseCard(card('Example Chain', 'Enchantment', 'Exile a creature you control: Add X mana of any one color, where X is 1 plus the exiled creature\'s mana value. Spend this mana only to cast creature spells.'), OPTS).faces[0]!;
    expect(fullyAutomated(food)).toBe(true);
    const selfExile = parseCard(card('Example Idol', 'Artifact', 'Exile this artifact: Add X mana of any one color, where X is the exiled card\'s mana value.'), OPTS).faces[0]!;
    expect(fullyAutomated(selfExile)).toBe(false);
  });
  it('render/cond.ts (CR 122.1f): "target player has fewer than nine poison counters" is the strict comparison of the poison count; "nine or more" is the old wording', () => {
    expect(fullyAutomated(parsedWith(MECH[2]!, 'If target player has fewer than six poison counters, they get a number of poison counters equal to the difference.'))).toBe(true);
  });
});
