/**
 * Commander lane edh-next, round edh-next-72: the template data of parser/templates/zz-cloud/edh-next-72.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-72-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext72 from '../../../src/parser/templates/zz-cloud/edh-next-72.json';
import review from '../../m5/golden/cards/edh-next-72-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext72 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhn72.forEach.thisWay.controllerCloaks.top': ['Unexplained Absence'],
  'eff.edhn72.forEachOpponent.exile.thatPlayerGainsLifePower': ['Luminate Primordial'],
  'eff.edhn72.eachPlayer.may.put.fromHand.bf.thenOpponentsWhoDidntDraw': ['Kynaios and Tiro of Meletis'],
  'eff.edhn72.eachOpponent.mayInvestigate.otherwiseLoseLife': ["Wernog, Rider's Chaplain"],
  'eff.edhn72.youInvestigatePlusOpponentsWhoInvestigated': ["Wernog, Rider's Chaplain"],
  'eff.edhn72.eachPlayerExactlyLife.losesGame.thenGainLife': ['Triskaidekaphobia'],
  'eff.edhn72.eachPlayerExactlyLife.losesGame.thenLoseLife': ['Triskaidekaphobia'],
  'eff.edhn72.eachPlayerMayDrawUpToTwo.gainLifePerCardLess': ['Truce', 'Temporary Truce'],
  'eff.edhn72.eachPlayerMayDiscardUpToThree.damageThreeMinus': ['Mind Bomb'],
  'eff.edhn72.eachOpponent.sacrifices.permanent.sharesCardType': ["Martyr's Bond"],
  'eff.edhn72.eachOpponent.chooses.sharesCardType.andSacrificesIt': ['Fatal Grudge'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-72 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-72.json, path order: after edh-next-7, before edh-next-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-72.json');
    expect(files.indexOf('zz-cloud/edh-next-72.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-7.json'));
    expect(files.indexOf('zz-cloud/edh-next-72.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhn72.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm)\.edhn72\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
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

describe('edh-next-72 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bloses\b/, 'gains'], [/\bpoison\b/, 'x'], [/\bthird\b/, 'fourth'], [/\bland\b/, 'x'], [/\bgain control\b/, 'x'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-72 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-72 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-72 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-72 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



describe('edh-next-72 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Elf', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/lower/ability.ts#joinEdhN72 (CR 101.4, 608.2c; Truce, Mind Bomb): the two sentences are read as one only for the exact pairs; other second sentences stay their own', () => {
    expect(fullyAutomated(spell('Each player may draw up to two cards. For each card less than two a player draws this way, that player gains 2 life.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('Each player may draw up to two cards. For each card less than three a player draws this way, that player gains 2 life.', 'Instant'))).toBe(false);
    expect(fullyAutomated(spell('Each player may discard up to three cards. ~ deals damage to each player equal to 3 minus the number of cards they discarded this way.'))).toBe(true);
    expect(fullyAutomated(spell('Each player may discard up to four cards. ~ deals damage to each player equal to 3 minus the number of cards they discarded this way.'))).toBe(false);
  });
  it('render/fold-edhn72.ts (CR 102.3, 608.2h, 119.1; Luminate Primordial): "and that player gains life equal to its power" after a per-opponent exile; another amount, "you gain" and a per-player target stay unread', () => {
    expect(fullyAutomated(creature('When this creature enters, for each opponent, exile up to one target creature that player controls and that player gains life equal to its power.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, for each opponent, exile up to one target creature that player controls and that player gains life equal to its toughness.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, for each player, exile up to one target creature that player controls and that player gains life equal to its power.'))).toBe(false);
  });
  it('render/fold-edhn72.ts (CR 101.4, 608.2c; Kynaios and Tiro): "then each opponent who didn\'t draws a card" follows the each-player put only; "each player who didn\'t" and a different draw stay unread', () => {
    expect(fullyAutomated(creature("At the beginning of your end step, each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card."))).toBe(true);
    expect(fullyAutomated(creature("At the beginning of your end step, each player may put a land card from their hand onto the battlefield, then each player who didn't draws a card."))).toBe(false);
    expect(fullyAutomated(creature("At the beginning of your end step, each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws two cards."))).toBe(false);
  });
  it('render/fold-edhn72.ts (CR 104.3b, 119.1; Triskaidekaphobia): "each player with exactly N life loses the game, then each player gains/loses N life"; "at least", "each opponent" and "you gain" stay unread', () => {
    expect(fullyAutomated(spell('Each player with exactly 13 life loses the game, then each player gains 1 life.'))).toBe(true);
    expect(fullyAutomated(spell('Each player with exactly 13 life loses the game, then each player loses 1 life.'))).toBe(true);
    expect(fullyAutomated(spell('Each player with 13 or more life loses the game, then each player gains 1 life.'))).toBe(false);
    expect(fullyAutomated(spell('Each player with exactly 13 life loses the game, then you gain 1 life.'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 701.21a, 205.2a; Martyr\'s Bond, Fatal Grudge): "of their choice that shares a card type with it" and "chooses a permanent they control that shares a card type with it and sacrifices it" are each opponent\'s sacrifice; "each player" and a creature type stay unread', () => {
    expect(fullyAutomated(creature('Whenever another creature you control dies, each opponent sacrifices a permanent of their choice that shares a card type with it.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever another creature you control dies, each opponent chooses a permanent they control that shares a card type with it and sacrifices it.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever another creature you control dies, each player sacrifices a permanent of their choice that shares a card type with it.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever another creature you control dies, each opponent sacrifices a permanent of their choice that shares a creature type with it.'))).toBe(false);
  });
});
