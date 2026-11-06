/**
 * Commander lane random, round edh-d-28 (second pass): the template data of parser/templates/zz-cloud/edh-d-28.json (see the file) and the round's parser, lowering, engine and
 * renderer changes, tested at the end of this file and in edh-d-28-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON;
 * near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked
 * against the local index when it is present. CR cites to be checked against the Comprehensive Rules of 2026-09-25 (see the record).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD28 from '../../../src/parser/templates/zz-cloud/edh-d-28.json';
import review0 from '../../m5/golden/cards/edh-d-28-review.json';
import reviewC6 from '../../m5/golden/cards/cloud-c6-review.json'; // (Chaos Defiler's entry lives in its first round's file, updated by edh-d-28)

const review = [...(review0 as unknown[]), ...(reviewC6 as { card: string }[]).filter((g) => g.card === 'Chaos Defiler')];
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD28 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhd28.ifBothCoins.heads': ['Two-Headed Giant'],
  'eff.edhd28.ifBothCoins.tails': ['Two-Headed Giant'],
  'rid.edhd28.cast.thisWay.yourGraveyard.exileInstead': ['Radiant Scrollwielder'],
  'eff.edhd28.destroy.oneOfThem.atRandom': ['Chaos Defiler'],
  'eff.edhd28.choose.aFilter.atRandom': ['The Nipton Lottery'],
  'eff.edhd28.return.twoOfThem.atRandom.otherBottom': ['Sinister Waltz'],
  'eff.edhd28.player.chooses.permanentTheyControl.atRandom.sacrifices': ['Tyrant of Discord'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-28 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-28.json, path order: after edh-d-25.json, before edh-d-3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-28.json');
    expect(files.indexOf('zz-cloud/edh-d-28.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-25.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhd28.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd28\./);
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

describe('edh-d-28 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [[/\btwo\b/, 'three'], [/\bhaste\b/, 'flying'], [/\bWalls\b/, 'Wall'], [/\bone\b/, 'two']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-28 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-28 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // a counter kind is any word (CR 122.1b: a counter with a name no rule defines is allowed)
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

describe.skipIf(index === null)('edh-d-28 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-28 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-d-28 parser, renderer and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('parser/lower/conditions.ts (CR 701.9a, 608.2d): "If the player can\'t" after a random discard of ONE card by the player of the event; a group, several cards or your own discard is not that', () => {
    expect(fullyAutomated(creature("Whenever this creature deals combat damage to a player, that player discards a card at random. If the player can't, you draw a card."))).toBe(true);
    expect(fullyAutomated(creature("Whenever this creature deals combat damage to a player, that player discards two cards at random. If the player can't, you draw a card."))).toBe(false);
    expect(fullyAutomated(creature("Whenever this creature deals combat damage to a player, each opponent discards a card at random. If the player can't, you draw a card."))).toBe(false);
  });
  it('parser/lower/coin-flip.ts (CR 705.1, 608.2c): "If both coins come up heads / tails" reads the flip of exactly two coins by you right before it (or before the other "both coins" sentence); one or three coins, another sentence before it, or a called flip is not that', () => {
    expect(fullyAutomated(creature('Whenever this creature attacks, flip two coins. If both coins come up heads, draw a card. If both coins come up tails, you lose 1 life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, flip three coins. If both coins come up heads, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever this creature attacks, flip two coins. Draw a card. If both coins come up heads, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever this creature attacks, flip a coin. If you win the flip, flip two coins. If both coins come up heads, draw a card.'))).toBe(false);
  });
  it('parser/lower/targets.ts (CR 608.2d, 109.2): "all other creatures" after a creature chosen at random is the group without that creature; two random choices, or a choice of another description, leave it manual', () => {
    expect(fullyAutomated(spell('Choose a creature at random. Tap it. Then destroy all other creatures.'))).toBe(true);
    expect(fullyAutomated(spell('Choose a creature at random. Tap it. Then destroy all other artifacts.'))).toBe(false);
    expect(fullyAutomated(spell('Choose a creature at random. Choose a creature at random. Then destroy all other creatures.'))).toBe(false);
  });
  it('parser/lower/mentions.ts (CR 608.2c, 400.7): "the other" of two chosen at random among three targets in your graveyard is the target left in the graveyard; the same words for targets on the battlefield stay manual', () => {
    expect(fullyAutomated(spell('Choose three target creature cards in your graveyard. Return two of them at random to the battlefield and put the other on the bottom of your library.'))).toBe(true);
    expect(fullyAutomated(spell('Choose three target creatures. Return two of them at random to the battlefield and put the other on the bottom of your library.'))).toBe(false);
  });
  it('effects/handlers/zones-remove.ts + render/steps-zones.ts (CR 608.2d, 701.21a): "chooses a permanent they control at random and sacrifices it" is one permanent of a single player other than you; "you" or several permanents is not that', () => {
    expect(fullyAutomated(creature('When this creature enters, target opponent chooses a permanent they control at random and sacrifices it.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, you choose a permanent you control at random and sacrifice it.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters, target opponent chooses two permanents they control at random and sacrifices them.'))).toBe(false);
  });
  it('render/stat.ts (family cast-this-way-spell, CR 614.1a): "a spell cast this way" after a permission for a card an earlier instruction chose; a permission for a card of another player\'s graveyard keeps "that spell" only', () => {
    expect(fullyAutomated(creature('At the beginning of your upkeep, exile an instant or sorcery card at random from your graveyard. You may cast it this turn. If a spell cast this way would be put into your graveyard, exile it instead.'))).toBe(true);
    expect(fullyAutomated(creature('At the beginning of your upkeep, exile an instant or sorcery card at random from your graveyard. You may cast it this turn. If a spell cast this way would be put into a graveyard, exile it instead.'))).toBe(false);
  });
});
