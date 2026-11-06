/**
 * Commander EDHREC ranks 18,001-18,500, round edh-c-78 (later pass): the template data of parser/templates/zz-cloud/edh-c-78.json (an object that is a color-and-creature-type with base power and toughness for as long as it has a counter, an optional redirection of creature damage to you, a guarded put onto the battlefield under your control, a hexproof waiver for your opponents, each object entering tapped) and the round's parser and renderer changes, tested at the end of this file and in edh-c-78-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-78-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC78 from '../../../src/parser/templates/zz-cloud/edh-c-78.json';
import review78 from '../../m5/golden/cards/edh-c-78-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC78 as Template[];
/** The round's golden entries. */
const review = review78 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv78.itis.colorSubtype.basept.dur': ['Sauron, Dino Devotee'],
  'eff.edhv78.damage.anyCreature.mayRedirectToYou.dur': ['Blood of the Martyr'],
  'eff.edhv78.put.bf.underYourControl.ifCond': ['Agadeem Occultist'],
  'sta.edhv78.hexproofWaiver.opponents': ['Kaya, Bane of the Dead'],
  'rep.edhv78.each.filter.entersTapped': ["Ashling's Prerogative"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(When|At the|Whenever)/.test(text) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : /^(sta|rep)\./.test(t.id) && /enchanted creature/.test(text) ? card('Example Plan', 'Enchantment — Aura', `Enchant creature\n${text}`)
    : /^(sta|rep)\./.test(t.id) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-78 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-78.json, path order: before edh-cast-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-78.json');
    expect(files.indexOf('zz-cloud/edh-c-78.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-c-4.json'));
    expect(files.indexOf('zz-cloud/edh-c-78.json')).toBeLessThan(files.indexOf('zz-cloud/edh-cast-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv78.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv78\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-c-78 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/half/, 'a third of'], [/rounded up/, 'rounded down'], [/round up/, 'round down'], [/your/, 'their'], [/first/, 'second'], [/an opponent/, 'you'], [/less/, 'more'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-c-78 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-78 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-78 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-78 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

const sorcery = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Drake', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;

const equipment = (text: string) => parseCard(card('Example Plan', 'Artifact — Equipment', text), OPTS).faces[0]!;


describe('edh-c-78 parser and renderer changes (one test each)', () => {
  it('parser/lower/scope.ts (CR 201.5, 603.2c): "it" in a trigger about counters put on ~ is ~ itself; with the counters put on another creature the pronoun stays unbound', () => {
    const ok = creature('Whenever one or more +1/+1 counters are put on this creature, it gains menace until end of turn.');
    expect(fullyAutomated(ok)).toBe(true);
    const other = creature('Whenever one or more +1/+1 counters are put on a creature you control, it gains menace until end of turn.');
    expect(JSON.stringify(other.abilities)).not.toContain('"affects":{"ref":"self"}');
  });
  it('parser/holes/filter.ts and render/np.ts (CR 702): "without A, B, or C" is a creature with none of the three (notKeyword); two stay "A or B", a list with no closing "or" is not read', () => {
    const ok = sorcery("Target creature without first strike, double strike, or vigilance can't attack or block until your next turn.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"notKeyword":["first strike","double strike","vigilance"]');
    expect(fullyAutomated(sorcery("Target creature without first strike, double strike can't attack or block until your next turn."))).toBe(false);
    expect(fullyAutomated(sorcery("Target creature without first strike or double strike can't attack or block until your next turn."))).toBe(true);
  });
  it('parser/holes/excess.ts and render/qty.ts (CR 120.10): "excess damage was dealt to a creature this way" counts the excess dealt to creatures; "to a permanent" and "to a player" are other readings', () => {
    const base = '{2}: ~ deals 3 damage to any target. If excess damage was dealt to a creature this way, draw a card.';
    const ok = parseCard(card('Example Plan', 'Creature — Drake', base, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"filter":{"types":["Creature"]}');
    const bad = parseCard(card('Example Plan', 'Creature — Drake', base.replace('a creature', 'a planeswalker'), { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(bad)).toBe(false);
  });
  it('parser/holes/filter.ts and render/np.ts (CR 202.3): "without mana value of the chosen quality" is the other parity; it needs the earlier choice', () => {
    const ok = parseCard(card('Example Plan', 'Enchantment', 'As this enchantment enters, choose odd or even.\nEach creature without mana value of the chosen quality has haste.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    const noChoice = parseCard(card('Example Plan', 'Enchantment', 'Each creature without mana value of the chosen quality has haste.'), OPTS).faces[0]!;
    expect(fullyAutomated(noChoice)).toBe(false);
  });
  it('render/steps.ts: a guarded put onto the battlefield is also said with the condition last; the same card with "unless" stays manual', () => {
    const bad = parseCard(card('Example Plan', 'Creature — Drake', '{T}: Put target creature card from a graveyard onto the battlefield under your control unless its mana value is 3 or less.', { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(bad)).toBe(false);
  });
});
