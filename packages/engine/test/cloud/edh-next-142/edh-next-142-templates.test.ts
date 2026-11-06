/**
 * Must-finish round edh-next-142 (library, draw and search; code edhn142): the template data of parser/templates/zz-cloud/edh-next-142.json, tested here and in
 * edh-next-142-scenarios.test.ts. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). CR cites checked against MagicCompRules 20260925.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext142 from '../../../src/parser/templates/zz-cloud/edh-next-142.json';
import review from '../../m5/golden/cards/edh-next-142-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const MECH = edhNext142 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one card, with their template tests (G9, G2) and played scenarios (owner's standing rule 2026-10-27). Each wording is printed on the one card named.
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn142.may.reveal.ifCond': ['Omnath, Locus of All'],
  'eff.edhn142.mana.anyCombination.itsColors': ['Omnath, Locus of All'],
  'cm.edhn142.loyaltyAbilities.additional.you': ['Carth the Lion'],
  'eff.edhn142.chooses.skipStepOrPhase': ['Fatespinner'],
  'sta.edhn142.otherCreatures.arePluralSubtype.sameIsTrue.spellsAndCards': ['Roshan, Hidden Magister'],
  'eff.edhn142.eachOpponentMay.search.upTo.oneToYouRestTheirs': ['Rootweaver Druid'],
  'eff.edhn142.wish.put.mandatory': ["Mastermind's Acquisition"],
  'eff.edhn142.choose.eachColorPair.fromAmong': ['Niv-Mizzet Reborn'],
  'eff.edhn142.put.fromHand.bothTopOrBothBottom': ['Dream Cache'],
  'eff.edhn142.may.putUpToOne.bfTapped.andUpToOne.hand.fromAmong': ['Bounty of Skemfar'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a static ability on an enchantment creature, a trigger on an artifact creature. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-142 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-142.json, path order: after edh-next-14.json, before edh-next-15.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-142.json');
    expect(files.indexOf('zz-cloud/edh-next-142.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-142.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn142.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn142\./);
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

describe('edh-next-142 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // combined copy: edh-next-138's eff.edhn138.may.reveal.obj.if is the same wording with the same JSON, and reads these sentences once both are in
        expect(f.templatesUsed.includes(t.id) || (t.id === 'eff.edhn142.may.reveal.ifCond' && f.templatesUsed.includes('eff.edhn138.may.reveal.obj.if')), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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
  const swaps: [RegExp, string][] = [[/graveyard/, 'hand'], [/exiling/, 'discarding'], [/sacrificing/, 'discarding'], [/tapped/, 'untapped'], [/mutate/, 'flashback']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-142 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-142 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});


describe('edh-next-142 engine and reading changes (one test per change)', () => {
  const full = (text: string, type = 'Sorcery', name = 'Example Plan') => fullyAutomated(parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!);
  it('CR 108.3, 608.2c (lower/mentions.ts#ownerSubject): "this artifact\'s owner" is "that player" afterwards; a group\'s owner is not', () => {
    expect(full("{T}: This artifact's owner draws a card, then that player may put a land card from their hand onto the battlefield.", 'Artifact', 'Example Pendant')).toBe(true);
    expect(full("{T}: This artifact's owner draws a card. That player loses 1 life.", 'Artifact', 'Example Pendant')).toBe(true);
  });
  it('CR 107.4 (filter manaSymbols colored): "three or more colored mana symbols" is a count of every colored symbol; "colored" alone is not a color word of that count', () => {
    expect(full('At the beginning of your upkeep, look at the top card of your library. If it has three or more colored mana symbols in its mana cost, you gain 5 life.', 'Enchantment')).toBe(true);
    expect(full('At the beginning of your upkeep, look at the top card of your library. If it has three or more colorless mana symbols in its mana cost, you gain 5 life.', 'Enchantment')).toBe(false);
  });
  it('CR 701.20a (lower/conditions.ts revealThisWay): "If you don\'t reveal it" needs an earlier option to reveal one card', () => {
    expect(full('At the beginning of your upkeep, look at the top card of your library. You may reveal that card if it\'s a creature card. If you do, you gain 3 life. If you don\'t reveal it, put it into your graveyard.', 'Enchantment')).toBe(true);
    expect(full('At the beginning of your upkeep, look at the top card of your library. If you don\'t reveal it, put it into your graveyard.', 'Enchantment')).toBe(false);
  });
  it('CR 702.29e (holes/misc.ts#typecyclingAlts): a "<subtype>cycling {N}" is read in a list a static ability grants; an unknown subtype is not', () => {
    expect(full('Each creature card in your hand has slivercycling {3}.', 'Enchantment')).toBe(true);
    expect(full('Each creature card in your hand has blorftycycling {3}.', 'Enchantment')).toBe(false);
  });
  it('CR 614.10 (core/turn.ts): Fatespinner\'s reading is the exact two sentences joined; another option list stays manual', () => {
    expect(full("At the beginning of each opponent's upkeep, that player chooses draw step, main phase, or combat phase. The player skips each instance of the chosen step or phase this turn.", 'Artifact Creature — Construct', 'Example Spinner')).toBe(true);
    expect(full("At the beginning of each opponent's upkeep, that player chooses draw step or combat phase. The player skips each instance of the chosen step or phase this turn.", 'Artifact Creature — Construct', 'Example Spinner')).toBe(false);
  });
});
