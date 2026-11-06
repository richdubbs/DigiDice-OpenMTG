/**
 * Must-finish round edh-next-143 (library, draw and search; code edhn143): the template data of parser/templates/zz-cloud/edh-next-143.json, tested here and in
 * edh-next-143-scenarios.test.ts. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not
 * parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). CR cites checked against MagicCompRules 20260925.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext143 from '../../../src/parser/templates/zz-cloud/edh-next-143.json';
import review from '../../m5/golden/cards/edh-next-143-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';

const MECH = edhNext143 as Template[];
const MECH_COUNT = 12;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only
 * one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn143.player.revealsTopN.theirLibrary': ['Lonis, Cryptozoologist'],
  'eff.edhn143.dig.mayPut.mvAtMost.bf.underYourControl': ['Lonis, Cryptozoologist'],
  'sta.edhn143.eachSpellYouCast.hasKeyword.ifManaFromArtifact': ['Shadow the Hedgehog'],
  'eff.edhn143.forEachPlayer.chooseFriendOrFoe': ["Pir's Whim", "Khorvath's Fury"],
  'eff.edhn143.player.discardsHand.thenDrawsThatManyPlus': ["Khorvath's Fury"],
  'eff.edhn143.eot.playerCantCast.youLookPlayTheirTop.anyColor': ['Xanathar, Guild Kingpin'],
  'eff.edhn143.thisTurn.playerCantCastOrActivate.handRevealed': ['Sen Triplets'],
  'eff.edhn143.mayPlayLandsCastSpells.fromPlayersHand.thisTurn': ['Sen Triplets'],
  'eff.edhn143.eachPlayer.shufflePermanents.revealThatMany.putTypesThenEnchantments': ['Warp World'],
  'sta.edhn143.playersCantSearch.anyPlayerMayPayToIgnore': ['Leonin Arbiter'],
  'cm.edhn143.alternative.free.ifFirstSpellThisGame': ['Once Upon a Time'],
  'eff.edhn143.you.revealYourHand': ['Atemsis, All-Seeing'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });

/** A synthetic card with the example as its ability: a trigger on an artifact creature, an activated ability on an artifact, a static on an enchantment, a spell's own alternative cost on an instant. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^(Whenever|When|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })
    : /^\{/.test(text) ? card('Example Engine', 'Artifact', text)
      : t.id.startsWith('cm.') ? card('Example Trick', 'Instant', text)
        : t.kind === 'static' ? card('Example Shrine', 'Enchantment', text) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-143 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-143.json, path order: after edh-next-14.json, before edh-next-15.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-143.json');
    expect(files.indexOf('zz-cloud/edh-next-143.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-14.json'));
    expect(files.indexOf('zz-cloud/edh-next-143.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-15.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn143.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|kw)\.edhn143\./);
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

describe('edh-next-143 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/library/, 'graveyard'], [/opponent/, 'creature'], [/artifact/, 'land'], [/friend/, 'ally'], [/hand/, 'graveyard'], [/first/, 'second']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-143 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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
    }, 120_000);
  }
});

describe('edh-next-143 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || /\n/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000);
  }
});

describe('edh-next-143 parser, lowering and renderer changes (one test per change, with the negative case)', () => {
  const full = (name: string, type: string, text: string, pt?: { power: string; toughness: string }) => fullyAutomated(parseCard(card(name, type, text, pt), OPTS).faces[0]!);
  it('CR 608.2d (parser/holes/player.ts, lower/links.ts#checkChoseWords): "each friend" / "each foe" read only after "For each player, choose friend or foe." of the same ability', () => {
    expect(full('Example Pact', 'Sorcery', 'For each player, choose friend or foe. Each friend draws a card. Each foe loses 2 life.')).toBe(true);
    expect(full('Example Pact', 'Sorcery', 'Each friend draws a card. Each foe loses 2 life.')).toBe(false);
    // only in instructions whose handlers act for each player of a group with their own cards: a choice of objects by the group stays manual (review of edh-next-143: each friend
    // would choose among every friend's graveyard)
    expect(full('Example Pact', 'Sorcery', 'For each player, choose friend or foe. Each friend returns a creature card from their graveyard to their hand. Each foe loses 2 life.')).toBe(false);
  });
  it('CR 401.4 (render/steps-zones.ts#revealedTopRestOfOther): "That player puts the rest ..." only after another player\'s reveal of their own top cards', () => {
    expect(full('Example Lens', 'Sorcery', 'Target opponent reveals the top four cards of their library. You may put a creature card with mana value 3 or less from among them onto the battlefield under your control. That player puts the rest on the bottom of their library in a random order.')).toBe(true);
    expect(full('Example Lens', 'Sorcery', 'Reveal the top four cards of your library. You may put a creature card with mana value 3 or less from among them onto the battlefield under your control. That player puts the rest on the bottom of their library in a random order.')).toBe(false);
  });
  it('CR 106.3 (render/mods.ts#spellsManaFromHaveSentence, filter manaSpentFrom): only "mana from an artifact" and only "each spell you cast"', () => {
    expect(full('Example Engine', 'Enchantment', 'Each spell you cast has split second if mana from an artifact was spent to cast it.')).toBe(true);
    expect(full('Example Engine', 'Enchantment', 'Each spell you cast has split second if mana from a Treasure was spent to cast it.')).toBe(false);
  });
  it('CR 608.2c (parser/lower/join-edhn143.ts): the Warp World paragraph is joined only in its exact shape', () => {
    expect(full('Example Warp', 'Sorcery', 'Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren\'t put onto the battlefield on the bottom of their library.')).toBe(true);
    expect(full('Example Warp', 'Sorcery', 'Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact and creature cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren\'t put onto the battlefield on the bottom of their library.')).toBe(false);
  });
  it('CR 116.2d (parser/lower/ability.ts#staticAbilityBase): two static sentences are one effect only for a restriction a player may pay to ignore', () => {
    expect(full('Example Warden', 'Creature — Cat', "Players can't search libraries. Any player may pay {3} for that player to ignore this effect until end of turn.", { power: '2', toughness: '2' })).toBe(true);
    expect(full('Example Warden', 'Creature — Cat', "Players can't search libraries. Any player may pay 3 life for that player to ignore this effect until end of turn.", { power: '2', toughness: '2' })).toBe(false);
  });
  it('CR 118.9 (parser/front/spellforms.ts): "If ~ is the first spell you\'ve cast this game, you may cast it without paying its mana cost." is a static of the spell; another wording stays a spell line', () => {
    expect(full('Example Trick', 'Instant', "If this spell is the first spell you've cast this game, you may cast it without paying its mana cost.\nDraw two cards.")).toBe(true);
    expect(full('Example Trick', 'Instant', "If this spell is the first spell you've cast this turn, you may cast it without paying its mana cost.\nDraw two cards.")).toBe(false);
  });
  it('CR 115.9a (parser/lower/scope.ts, q:targetsOf): "that many" is the targets only of "a spell with one or more targets"', () => {
    expect(full('Example Owl', 'Creature — Bird', 'Whenever you cast a spell with one or more targets, draw that many cards.', { power: '1', toughness: '1' })).toBe(true);
    expect(full('Example Owl', 'Creature — Bird', 'Whenever you cast a spell with a single target, draw that many cards.', { power: '1', toughness: '1' })).toBe(false);
    expect(full('Example Owl', 'Creature — Bird', 'Whenever you cast a spell, draw that many cards.', { power: '1', toughness: '1' })).toBe(false);
  });
  it('CR 701.20a, 202.3 (parser/holes/cond.ts#revealedDistinctManaValuesCond): "cards with at least N different mana values are revealed this way" only after a reveal of a hand', () => {
    expect(full('Example Sage', 'Creature — Sphinx', 'Whenever Example Sage deals combat damage to a player, you may reveal your hand. If cards with at least five different mana values are revealed this way, draw a card.', { power: '2', toughness: '2' })).toBe(true);
    expect(full('Example Sage', 'Creature — Sphinx', 'Whenever Example Sage deals combat damage to a player, reveal the top five cards of your library. If cards with at least five different mana values are revealed this way, draw a card.', { power: '2', toughness: '2' })).toBe(false);
  });
});
