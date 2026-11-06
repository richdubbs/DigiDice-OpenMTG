/**
 * Must-finish round edh-d-102 (EDHREC band 5,001-10,000, graveyard-exile-cast): the template data of parser/templates/zz-cloud/edh-d-102.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-102-scenarios.test.ts.
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
import edhD102 from '../../../src/parser/templates/zz-cloud/edh-d-102.json';
import review from '../../m5/golden/cards/edh-d-102-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD102 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC band 5,001-10,000 that prints the wording and is full (each wording is printed on that one card)
  'sta.edhd102.each.has.miracle.manaCostLess': ['Aminatou, Veil Piercer'],
  'eff.edhd102.exileUntil.x': ['Auspicious Starrix'],
  'eff.edhd102.put.typedThose.bf': ['Auspicious Starrix'],
  'sta.edhd102.craft.sharesKeywords': ['Altar of the Wretched // Wretched Bonemass'],
  'eff.edhd102.choose.anyNumberTargetCreaturesPlaneswalkersPlayers': ['Soulfire Eruption'],
  'eff.edhd102.forEachOfThem.exileTop.damageManaValue': ['Soulfire Eruption'],
  'rep.edhd102.draw.playerExilesThatCardInstead': ['Uba Mask'],
  'sta.edhd102.eachPlayer.playFromAmongTheyExiled.thisTurn': ['Uba Mask'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-102 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-102.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-102.json');
    expect(files.indexOf('zz-cloud/edh-d-102.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-10.json'));
    expect(files.indexOf('zz-cloud/edh-d-102.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-11.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd102.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhd102\./);
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

describe('edh-d-102 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmiracle\b/g, 'flashback'], [/\{4\}/, '{3}'], [/\bpermanent cards\b/g, 'nonland cards'], [/\bonto the battlefield\b/, 'into your hand'], [/\bflying\b/g, 'reach'],
    [/\bplaneswalkers\b/, 'battles'], [/\bmana value\b/, 'power'], [/\bface up\b/, 'face down'], [/\bthey exiled\b/, 'you exiled'], [/\bthis turn\./, 'this game.'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-102 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-102 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        let reminder = false; // CR 207.2: reminder text (in parentheses) has no rules meaning; its words are not tested
        words.forEach((w, i) => {
          const inReminder = reminder || w.startsWith('(') || w.startsWith('\n(');
          if (w.includes(')')) reminder = false;
          else if (w.startsWith('(') || w.includes('\n(')) reminder = true;
          if (inReminder) return;
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-102 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-102 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-d-102 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Elf', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/lower/scope.ts (CR 102.1): "that player" of "Whenever you cast your first spell during each opponent\'s turn" is the active player; of "during your turn" it has no antecedent', () => {
    const f = creature("Whenever you cast your first spell during each opponent's turn, look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled.");
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"player":{"ref":"active"}');
    expect(fullyAutomated(creature("Whenever you cast your first spell during your turn, look at the top card of that player's library, then exile it face down."))).toBe(false);
  });
  it('parser/lower/ability.ts#resolveCondAnaphors (CR 702.33f, 603.4): "When you cast this spell, if it was kicked with its {G} kicker" names this face\'s second kicker; a spell another cast trigger names does not', () => {
    const f = creature('Kicker {1}{U} and/or {G}\nWhen you cast this spell, if it was kicked with its {G} kicker, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"interveningIf":{"cond":"wasCast","kicked":"kicker:2"}');
    expect(fullyAutomated(creature('Kicker {G}\nWhenever you cast a spell, if it was kicked with its {G} kicker, draw a card.'))).toBe(false);
  });
  it('parser/holes/object.ts#typedThose (CR 110.4): "those permanent cards" names the permanent cards a counted exile until found; with no such step it stays unread', () => {
    expect(fullyAutomated(creature('When Example Beast enters, exile cards from the top of your library until you exile X permanent cards, where X is the number of Elves you control. Put those permanent cards onto the battlefield.'))).toBe(true);
    expect(fullyAutomated(creature('When Example Beast enters, exile the top card of your library. Put those permanent cards onto the battlefield.'))).toBe(false);
  });
  it('parser/holes/filter.ts (CR 701.9a, 702.29a): "that you cycled or discarded this turn" and "that you discarded this turn" are the discard filter; "that you cycled this turn" is not read', () => {
    expect(JSON.stringify(spell('Return to your hand all cards in your graveyard that you cycled or discarded this turn.', 'Instant').abilities)).toContain('"putThereFrom":"discard"');
    expect(fullyAutomated(spell('Return to your hand all cards in your graveyard that you discarded this turn.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('Return to your hand all cards in your graveyard that you cycled this turn.', 'Instant'))).toBe(false);
  });
  it('parser/holes/filter.ts#areList (CR 205.2a, 715.1): the list with the verb said again before a later kind; "are" before "have" is not read', () => {
    expect(fullyAutomated(spell('You gain X life, where X is the number of cards in your graveyard that are instant cards, are sorcery cards, and/or have an Adventure.'))).toBe(true);
    expect(fullyAutomated(spell('You gain X life, where X is the number of cards in your graveyard that are instant cards, are sorcery cards, and/or are have an Adventure.'))).toBe(false);
  });
  it('parser/lower/mentions.ts (CR 608.2f, 608.2c): the cards a "for each" loop exiled from the top of a library are "the exiled cards" after it, the participle only', () => {
    const body = "Choose any number of target creatures, planeswalkers, and/or players. For each of them, exile the top card of your library, then Example Plan deals damage equal to that card's mana value to that permanent or player.";
    expect(fullyAutomated(spell(`${body} You may play the exiled cards until the end of your next turn.`))).toBe(true);
    expect(fullyAutomated(spell(`${body} You may play them until the end of your next turn.`))).toBe(false);
  });
  it('render/mods.ts (CR 702.94a): a granted miracle\'s cost sentence; any other keyword with costIsManaCostLess but foretell stays unrendered', () => {
    expect(fullyAutomated(creature('Each instant card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}.'))).toBe(true);
    expect(fullyAutomated(creature('Each instant card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {2}.'))).toBe(false);
  });
});
