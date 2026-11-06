/**
 * Must-finish round edh-next-135 (choices, votes and opponents): the template data of parser/templates/zz-cloud/edh-next-135.json and the parser, renderer and engine changes of the round
 * (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10). The behavior is in edh-next-135-scenarios.test.ts. CR cites checked against MagicCompRules 20260925.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext135 from '../../../src/parser/templates/zz-cloud/edh-next-135.json';
import review from '../../m5/golden/cards/edh-next-135-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext135 as Template[];
const MECH_COUNT = 14;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn135.exileTop.twoFaceDownPiles': ['Hostile Negotiations'],
  'eff.edhn135.lookEachPile.turnOneFaceUp': ['Hostile Negotiations'],
  'eff.edhn135.searchDifferentNames.exile.opponentShufflesOne.castOthersFree': ['Emergent Ultimatum'],
  'eff.edhn135.youChooseHowEachPlayerVotes': ['Illusion of Choice'],
  'eff.edhn135.reveal.anyNumber.fromYourHand': ['Invasion of Tarkir // Defiant Thundermaw'],
  'eff.edhn135.startingNextOpponent.eachOpponentChoosesUnchosen.fromYourGraveyard': ['Rejoin the Fight'],
  'sta.edhn135.opponentFacesVillainousChoiceAgain': ['The Valeyard'],
  'eff.edhn135.searchDifferentPowers.reveal.opponentChooses.shuffleChosen.restToHand': ['Threats Undetected'],
  'eff.edhn135.playerChoosesFromHand.look.castOneFree': ['Extract Brain'],
  'eff.edhn135.lookTwoBack.chooseKind.opponentGuesses.revealIfRightRemoveElseDrawUnblockable': ['Gollum, Scheming Guide'],
  'eff.edhn135.chooseInHand.playerGuessesManaValue.ifWrongCastFree': ['Master of Predicaments'],
  'eff.edhn135.secretlyChoose.opponent': ['Stalking Leonin'],
  'eff.edhn135.exileTargetAttackingYou.ifChosenPlayerControls': ['Stalking Leonin'],
  'eff.edhn135.exileAllNontoken.auctionTapped': ["Thieves' Auction"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are abilities of a permanent (static, triggered, replacement); the others are spell text (an instant). */
const PERMANENT = new Set<string>(['eff.edhn135.reveal.anyNumber.fromYourHand', 'sta.edhn135.opponentFacesVillainousChoiceAgain', 'eff.edhn135.lookTwoBack.chooseKind.opponentGuesses.revealIfRightRemoveElseDrawUnblockable', 'eff.edhn135.chooseInHand.playerGuessesManaValue.ifWrongCastFree', 'eff.edhn135.secretlyChoose.opponent', 'eff.edhn135.exileTargetAttackingYou.ifChosenPlayerControls']);
/** Spell templates whose examples are sorceries. */
const SORCERY = new Set<string>(['eff.edhn135.exileAllNontoken.auctionTapped', 'eff.edhn135.searchDifferentNames.exile.opponentShufflesOne.castOthersFree', 'eff.edhn135.startingNextOpponent.eachOpponentChoosesUnchosen.fromYourGraveyard', 'eff.edhn135.searchDifferentPowers.reveal.opponentChooses.shuffleChosen.restToHand', 'eff.edhn135.playerChoosesFromHand.look.castOneFree']);
const parsedWith = (t: Template, text: string) =>
  (PERMANENT.has(t.id)
    ? parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)
    : parseCard(card('Example Plan', SORCERY.has(t.id) ? 'Sorcery' : 'Instant', text, { mana_cost: '{2}{B}' }), OPTS)).faces[0]!;

describe('edh-next-135 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-135.json, path order: after edh-next-13, before edh-next-14) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-135.json');
    expect(files.indexOf('zz-cloud/edh-next-135.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-13.json'));
    expect(files.indexOf('zz-cloud/edh-next-135.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-14.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn135.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn135\./);
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

describe('edh-next-135 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-135 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-135 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
          const f = parsedWith(t, mutated);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false); // a cost part the controller confirms (manual) is not automated either
        });
      }
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-135 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-135 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-135 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Instant', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const PARLEY = 'Exile the top two cards of your library in a face-down pile, then exile the top two cards of your library in another face-down pile. Look at the cards in each pile, then turn a pile of your choice face up. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.';
  it('render/fold-edhn135.ts#givenFaceDownPiles (CR 700.3, 406.3): the given piles are said only whole; another destination or chooser is not folded (and the piles step alone has no renderer)', () => {
    expect(fullyAutomated(spell(PARLEY))).toBe(true);
    expect(fullyAutomated(spell(PARLEY.replace('the other into your graveyard', 'the other on the bottom of your library')))).toBe(false);
    expect(fullyAutomated(spell(PARLEY.replace('An opponent chooses', 'Target opponent chooses')))).toBe(false);
    expect(fullyAutomated(spell(PARLEY.replace('Put that pile into your hand and the other into your graveyard.', 'Draw a card.')))).toBe(false);
  });
  it('parser/holes/cond.ts and render/cond.ts (CR 120.2a, 500.1, 603.4): "you haven\'t been dealt combat damage since your last turn" is read (scope sinceYourLastTurn); "damage" or "this turn" alone is not this reading', () => {
    const up = (c: string) => parseCard(card('Example Regent', 'Creature — Human Noble', `At the beginning of your upkeep, if ${c}, you draw a card and you lose 1 life.`, { power: '2', toughness: '2' }), OPTS).faces[0]!;
    const f = up("you haven't been dealt combat damage since your last turn");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"scope":"sinceYourLastTurn"');
    expect(JSON.stringify(up("you haven't been dealt damage since your last turn").abilities)).not.toContain('sinceYourLastTurn');
    expect(JSON.stringify(up("you haven't been dealt combat damage since your last upkeep").abilities)).not.toContain('sinceYourLastTurn');
  });
  it('parser/lower/join-edhn135.ts#joinEdhN135SearchShuffleOneCastOthers (CR 608.2c): the four sentences are joined only all four, in order', () => {
    const t = 'Search your library for up to two monocolored cards with different names and exile them. An opponent chooses one of those cards. Shuffle that card into your library. You may cast the other cards without paying their mana costs.';
    expect(fullyAutomated(spell(t, 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell(t.replace(' Shuffle that card into your library.', ''), 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell(t.replace('Shuffle that card into your library.', 'Put that card into your hand.'), 'Sorcery'))).toBe(false);
  });
  it('model capabilities: the round\'s engine forms are advertised', () => {
    for (const c of ['feature:piles.given', 'feature:history.sinceYourLastTurn', 'rulemod:choosesVotes', 'op:reveal.anyNumber', 'op:chooseObjects.unchosen', 'rulemod:villainousChoiceExtra', 'op:search.differentPowers', 'op:guess', 'op:chooseValue.secret.player', 'cost:revealChosen.player', 'op:auction']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});
