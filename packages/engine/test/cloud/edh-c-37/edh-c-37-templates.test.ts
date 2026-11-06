/**
 * Commander EDHREC ranks 26,501-27,000, round edh-c-37: the template data of parser/templates/zz-cloud/edh-c-37.json ("you may reveal it" after a look at the top card (kinship), "you may exile N <type> cards from your graveyard", "All <subtype> are Plains", "gets -N/-0 until end of turn and attacks this turn if able") and the round's parser, engine and renderer changes, tested at the end of this file and in edh-c-37-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-c-37-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhC37 from '../../../src/parser/templates/zz-cloud/edh-c-37.json';
import review37 from '../../m5/golden/cards/edh-c-37-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhC37 as Template[];
/** The round's golden entries. */
const review = review37 as { card: string; verified: string; expect?: string }[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one or two cards (Skywarp Skaab; Conversion and Glaciers; Chemister's Trick, of the EDHREC top 30,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhv37.may.exile.nTypedFromGraveyard': ['Skywarp Skaab'],
  'sta.edhv37.allSubtype.arePlains': ['Conversion'],
  'eff.edhv37.pump.attacksThisTurn': ["Chemister's Trick"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static line on an Aura, an Equipment or a creature, a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    /^\{/.test(text) ? card('Example Plan', 'Artifact', text)
    : /^(All|Nonbasic)/.test(text) ? card('Example Plan', 'Enchantment', text)
    : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>)
    : card('Example Plan', 'Sorcery', text),
    OPTS,
  ).faces[0]!;

describe('edh-c-37 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-c-37.json, path order: before edh-c-4) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-c-37.json');
    expect(files.indexOf('zz-cloud/edh-c-37.json')).toBeLessThan(files.indexOf('zz-cloud/edh-c-4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhv37.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid|cm)\.edhv37\./);
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

describe('edh-c-37 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-c-37 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-c-37 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-c-37 design 6.10 (local index): synthetic examples', () => {
  it('no edh-c-37 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Merfolk Wizard', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;

const KINSHIP = (last: string): string => `At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with this creature, you may reveal it. If you do, ${last}`;

describe('edh-c-37 parser, engine and renderer changes (one test each)', () => {
  it('parser/holes/cond.ts, model/focus.ts#keptFocus, parser/lower/anaphora.ts, render/cond.ts (CR 701.20e, 205.3m, 608.2c): kinship reads and renders; other qualities, a missing look and a missing "may reveal" are other readings', () => {
    expect(fullyAutomated(creature(KINSHIP('you gain 5 life.')))).toBe(true);
    expect(fullyAutomated(creature(KINSHIP('each opponent loses 3 life.')))).toBe(true);
    for (const bad of [
      'At the beginning of your upkeep, you may look at the top card of your library. If it shares a color with this creature, you may reveal it. If you do, you gain 5 life.',
      'At the beginning of your upkeep, look at the top card of your library. If it shares a creature type with this creature, you may reveal it. If you do, you gain 5 life.',
      'At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with this creature, reveal it. If you do, you gain 5 life.',
      'At the beginning of your upkeep, you may look at the top two cards of your library. If it shares a creature type with this creature, you may reveal it. If you do, you gain 5 life.',
    ]) {
      const f = creature(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"sharesWith":{"quality":"creatureType"') && JSON.stringify(f.abilities).includes('"op":"look"'), bad).toBe(false);
    }
  });
  it('keywords/data/tribute.json, effects/bodies/m5.ts, parser/holes/cond.ts (CR 702.104a-b): tribute N with "if tribute wasn\'t paid" is automated; the condition without the keyword is not', () => {
    expect(fullyAutomated(creature('Tribute 2\nWhen this creature enters, if tribute wasn\'t paid, you gain 5 life.'))).toBe(true);
    expect(fullyAutomated(creature('Tribute 2\nWhen this creature enters, if tribute was paid, you gain 5 life.'))).toBe(false);
  });
  it('parser/holes/qty.ts, effects/eval.ts, statics/match.ts (CR 107.4, 202.1): "the number of <color> mana symbols in the mana costs of <objects>"; a card text, another property and no color are other readings', () => {
    const ok = sorcery('Target creature gets +X/+0 until end of turn, where X is the number of red mana symbols in the mana costs of cards in your graveyard.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"symbolsAmong"');
    for (const bad of [
      'Target creature gets +X/+0 until end of turn, where X is the number of red mana symbols in the rules text of cards in your graveyard.',
      'Target creature gets +X/+0 until end of turn, where X is the number of mana symbols in the mana costs of cards in your graveyard.',
      'Target creature gets +X/+0 until end of turn, where X is the number of red cards in your graveyard.',
    ]) {
      const f = sorcery(bad);
      expect(fullyAutomated(f) && JSON.stringify(f.abilities).includes('"q":"symbolsAmong"'), bad).toBe(false);
    }
  });
});
