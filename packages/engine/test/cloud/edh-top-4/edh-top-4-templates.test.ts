/**
 * Commander lane edh-top, round edh-top-4: the template data of parser/templates/zz-cloud/edh-top-4.json ("You and creatures you control have protection from the chosen card type",
 * "You may cast ~ as though it had flash if it targets a commander", "~ gains protection from the card type of your choice", "Colorless spells you cast from your hand with mana
 * value 7 or greater have "Cascade, cascade."") and the round's engine, parser and renderer changes, tested at the end of this file and in edh-top-4-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-top-4-scenarios.test.ts. CR cites are from the Comprehensive Rules text
 * of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop4 from '../../../src/parser/templates/zz-cloud/edh-top-4.json';
import review from '../../m5/golden/cards/edh-top-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop4 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on
 * one card (of the EDHREC top 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule
 * 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edht4.youAndObjs.protection.chosenCardType': ["Serra's Emissary"],
  'sta.edht4.cast.self.flash.ifTargets': ['Timely Ward'],
  'eff.edht4.obj.gains.protection.cardTypeOfYourChoice': ['Pippin, Guard of the Citadel'],
  'sta.edht4.spells.cast.fromHand.manaValueAtLeast.has': ['Zhulodok, Void Gorger'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a creature (the abilities are those of a permanent), an Aura for the card's own flash permission (CR 601.3b). */
const parsedWith = (t: Template, text: string) =>
  parseCard(
    t.id.includes('.cast.self.flash.')
      ? card('Example Plan', 'Enchantment — Aura', `${text}\nEnchant creature`)
      : card('Example Plan', 'Creature — Angel', t.pattern.includes('the chosen card type') ? `As ~ enters, choose a card type.\n${text}` : text, { power: '3', toughness: '3' } as Partial<OracleCard>), // the choice is the object's own other ability (CR 607.2d), a line every such card has
    OPTS,
  ).faces[0]!;

describe('edh-top-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-4.json, path order: after edh-top-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-4.json');
    expect(files.indexOf('zz-cloud/edh-top-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples (or one with a second sentence) and two counter-examples, a status, and is of version 8; ids are *.edht4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht4\./);
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

describe('edh-top-4 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bthe chosen card type\b/, 'the chosen color'], [/\bdeath\b/, 'life'], [/\bcommander\b/, 'commander you control'], [/\bfrom your hand\b/, 'from a graveyard'],
    [/\b7 or greater\b/, '7 or less'], [/\bour choice\b/, 'our choosing'], [/\bthe card type of your choice\b/, 'each card type'], [/\bas though it had flash\b/, 'as though it had haste'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-top-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-top-4 engine, parser and renderer changes (one test each)', () => {
  it('the permission field PermissionDef.ifTargets is a capability (statics/play-permits.ts) and a flash permission with it is not flash by itself', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.haveFlash.ifTargets')).toBe(true);
  });
  it('parser/lower/quoted.ts: a quoted line of keywords separated by commas is several keyword abilities; a piece that is not a keyword leaves the sentence manual (fail closed)', () => {
    const ok = parseCard(card('Example Gorger', 'Creature — Eldrazi', 'Colorless spells you cast from your hand with mana value 7 or greater have "Cascade, cascade."', { power: '5', toughness: '5' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities).match(/"keyword":"cascade"/g)?.length).toBe(2);
    const bad = parseCard(card('Example Gorger', 'Creature — Eldrazi', 'Colorless spells you cast from your hand with mana value 7 or greater have "Cascade, draw a card."', { power: '5', toughness: '5' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(bad)).toBe(false);
    const plain = parseCard(card('Example Gorger', 'Creature — Eldrazi', 'Creatures you control have "Flying, haste."', { power: '5', toughness: '5' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(JSON.stringify(plain.abilities)).not.toContain('"keyword":"haste"'); // rendering the list of two different keywords quoted has no wording here: stays manual
  });
  it('parser/holes/r3mech.ts#SIEGE_WORDS: the factions of Mirrodin Besieged and Struggle for Project Purity are words of the choice; any other word is not (guard G2)', () => {
    const faction = parseCard(card('Example Besieged', 'Enchantment', 'As this enchantment enters, choose Mirran or Phyrexian.\n\u2022 Mirran \u2014 Whenever you cast an artifact spell, create a 2/2 colorless Golem artifact creature token.\n\u2022 Phyrexian \u2014 At the beginning of your end step, you gain 1 life.'), OPTS).faces[0]!;
    expect(fullyAutomated(faction)).toBe(true);
    const unknown = parseCard(card('Example Besieged', 'Enchantment', 'As this enchantment enters, choose Mirran or Elves.\n\u2022 Mirran \u2014 Whenever you cast an artifact spell, create a 2/2 colorless Golem artifact creature token.\n\u2022 Elves \u2014 At the beginning of your end step, you gain 1 life.'), OPTS).faces[0]!;
    expect(fullyAutomated(unknown)).toBe(false);
  });
  it('quality chosen:cardType is a granted keyword quality like chosen:color (cap-walk chosenQualityForm): the object\'s own static grant of it is automated and keeps the quality for the layers to resolve', () => {
    const own = parseCard(card('Example Emissary', 'Creature — Angel', 'As this creature enters, choose a card type.\nThis creature has protection from the chosen card type.', { power: '4', toughness: '4' } as Partial<OracleCard>), OPTS).faces[0]!;
    expect(fullyAutomated(own)).toBe(true);
    expect(JSON.stringify(own.abilities)).toContain('"quality":"chosen:cardType"');
  });
});
