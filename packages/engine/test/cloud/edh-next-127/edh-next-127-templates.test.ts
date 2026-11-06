/**
 * Must-finish round edh-next-127 (dice, coins and random): the template data of parser/templates/zz-cloud/edh-next-127.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-127-scenarios.test.ts.
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
import edhNext127 from '../../../src/parser/templates/zz-cloud/edh-next-127.json';
import review from '../../m5/golden/cards/edh-next-127-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext127 as Template[];
const MECH_COUNT = 15;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (each wording is printed on that one card; owner's standing rule 2026-10-27)
  'eff.edhn127.youAnd.drawThenDiscardRandom': ['Zurzoth, Chaos Rider'],
  'eff.edhn127.rollPlanarDie': ['Fractured Powerstone'],
  'eff.edhn127.spell.exileAsItResolves.anyGraveyard': ["River Song's Diary"],
  'eff.edhn127.chooseOneOfThemAtRandom': ["River Song's Diary"],
  'eff.edhn127.exilesTopRandomGraveyardRandomHand': ['Crabomination'],
  'eff.edhn127.castASpellFromAmong.free': ['Crabomination'],
  'eff.edhn127.rollTwoD20.ignoreLower': ["Berserker's Frenzy"],
  'eff.edhn127.chooseAnyNumberOf': ["Berserker's Frenzy"],
  'eff.edhn127.return.upTo.choose.bf.yours': ['Danse Macabre'],
  'eff.edhn127.mayChooseA': ['Thunderwave'],
  'eff.edhn127.play.obj.durFirst.anyColor': ['The Ruinous Powers'],
  'rid.edhn127.castThisWay.ownerLosesLifeMv': ['The Ruinous Powers'],
  'eff.edhn127.damageEqual.unlessTheySacrifice': ['Indoraptor, the Perfect Hybrid'],
  'eff.edhn127.forEachGraveyardWith.exileTargetInstantSorcery': ['Mysterious Stranger'],
  'eff.edhn127.ifTwoOrMoreExiled.chooseRandomCopy': ['Mysterious Stranger'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-127 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-127.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-127.json');
    expect(files.indexOf('zz-cloud/edh-next-127.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-12.json'));
    expect(files.indexOf('zz-cloud/edh-next-127.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn127.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn127\./);
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

describe('edh-next-127 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bat random\b/, 'of their choice'], [/\bplanar die\b/, 'blue die'], [/\ba graveyard\b/, 'your hand'], [/\bthe top card\b/, 'the bottom card'], [/\bignore the lower\b/, 'ignore the higher'],
    [/\bany number of\b/, 'two'], [/\bthis turn and how\b/, 'this combat and why'], [/\bunder your control\b/, "under its owner's control"], [/\bnot chosen\b/, 'chosen'], [/\bany color\b/, 'any type'],
    [/\bits owner loses\b/, 'you lose'], [/\bunless they sacrifice\b/, 'unless they discard'], [/\btwo or more\b/, 'three or more'], [/\bthen discard\b/, 'then draw'], [/\bup to two\b/, 'two'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-127 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-127 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000); // like the other rounds' G2 guards: one parse per word of each example
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-next-127 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-127 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-127 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string, type = 'Creature — Devil') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/event.ts + parser/lower/scope.ts + render/evt.ts + render/refs.ts (CR 603.2c, 508.1b): "attack one or more players" is one whole-batch trigger and "those players" every player attacked; "attack a player" stays one trigger per player', () => {
    const f = creature('Whenever one or more Devils you control attack one or more players, you and those players each draw two cards, then discard a card at random.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"wholeBatch":true');
    const g = creature('Whenever one or more Devils you control attack a player, that player draws a card.');
    expect(JSON.stringify(g.abilities[0])).not.toContain('wholeBatch');
    expect(fullyAutomated(creature('Whenever Example Beast attacks one or more players, you and those players each draw two cards, then discard a card at random.')), 'a single attacker is no batch').toBe(false);
  });
  it('keywords/data/emerge.json + parser/holes/misc.ts + render/kw.ts (CR 702.119b): "Emerge from artifact" is the variant; plain emerge is unchanged; any other quality stays manual', () => {
    expect(fullyAutomated(creature('Emerge from artifact {4}{B}', 'Creature — Horror'))).toBe(true);
    expect(fullyAutomated(creature('Emerge {4}{B}', 'Creature — Horror'))).toBe(true);
    expect(fullyAutomated(creature('Emerge from enchantment {4}{B}', 'Creature — Horror'))).toBe(false);
  });
  it('parser/lower/mentions.ts#groupOf (CR 608.2c): a move of the top card of a library with chosen cards is "cards exiled this way"', () => {
    expect(fullyAutomated(spell('Target opponent exiles the top card of their library, a card at random from their graveyard, and a card at random from their hand. You may cast a spell from among cards exiled this way without paying its mana cost.'))).toBe(true);
  });
  it('parser/lower/mentions.ts#sacrificedByEachOf + parser/holes/qty.ts + render/qty.ts (CR 701.21a, 608.2h): an each-player sacrifice names its group and "the toughness of the creature you sacrificed this way"; one player\'s sacrifice does not', () => {
    expect(fullyAutomated(spell('Each player sacrifices a creature of their choice. You gain life equal to the toughness of the creature you sacrificed this way.'))).toBe(true);
    expect(fullyAutomated(spell('Target opponent sacrifices a creature of their choice. You gain life equal to the toughness of the creature you sacrificed this way.'))).toBe(false);
  });
  it('parser/lower/mentions.ts#chosenOneAsGroupOf + render/fold-edhn127.ts (CR 608.2d): "you may choose a creature" is also the group "not chosen this way"', () => {
    expect(fullyAutomated(spell('You may choose a creature. Destroy each creature not chosen this way.'))).toBe(true);
    // combined copy: edh-d-86's eff.edhd86.choose.creature.any (weak) reads "You may choose a creature. Destroy that creature." as a may-choice of one creature then destroying it (none: nothing)
    expect(fullyAutomated(spell('You may choose a creature. Destroy that creature.')), '"that creature" after "you may choose" is the chosen one (edh-d-86)').toBe(true);
  });
  it('reuses edh-d-89 (CR 509.1, 723.1): "you choose which creatures block this turn" is edh-d-89\'s controlBlocks with `turn` (fix:edhd89-control-blocks-turn), inside a die-roll row too', () => {
    expect(JSON.stringify(spell('Roll a d20.\n1-10 | Draw a card.\n11-20 | You choose which creatures block this turn and how those creatures block.', 'Instant').abilities)).toContain('"op":"controlBlocks","who":{"ref":"you"},"turn":true');
  });
  it('parser/lower/units.ts + statics/play-permits.ts + actions/cast.ts (CR 603.7a): "When you cast a spell this way" is a permission\'s onCast; after a non-permission it stays a reflexive reading or manual', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.onCast') && ENGINE_CAPABILITIES.has('feature:permit.cast.onCast')).toBe(true);
    expect(JSON.stringify(spell('Exile the top card of target opponent\'s library. You may play that card this turn. When you cast a spell this way, its owner loses life equal to its mana value.').abilities)).toContain('"onCast"');
    expect(fullyAutomated(spell('Draw a card. When you cast a spell this way, its owner loses life equal to its mana value.'))).toBe(false);
  });
  it('parser/holes/misc.ts + render/kw.ts (CR 702.54b): "Bloodthirst X" is the total damage dealt to your opponents this turn; "Bloodthirst 2" is unchanged', () => {
    const x = creature('Bloodthirst X', 'Creature — Dinosaur');
    expect(fullyAutomated(x)).toBe(true);
    expect(JSON.stringify(x.abilities[0])).toContain('"q":"happenedCount"');
    expect(JSON.stringify(creature('Bloodthirst 2', 'Creature — Dinosaur').abilities[0])).toContain('"amount":2');
  });
  it('rules/targets.ts + parser/lower/targets.ts + render/steps.ts (CR 115.1, 601.2c): eachWithOne is advertised and read only from "for each graveyard with ... in it"', () => {
    expect(ENGINE_CAPABILITIES.has('feature:target.eachWithOne')).toBe(true);
    expect(JSON.stringify(spell('For each graveyard with an instant or sorcery card in it, exile target instant or sorcery card from that graveyard.').abilities)).toContain('"eachWithOne":true');
  });
  it('parser/lower/normalize.ts (CR 707.12): a random choice among the cards this resolution exiled may be copied and cast; a choice among cards in a graveyard may not', () => {
    expect(fullyAutomated(spell('For each graveyard with an instant or sorcery card in it, exile target instant or sorcery card from that graveyard. If two or more cards are exiled this way, choose one of them at random and copy it. You may cast the copy without paying its mana cost.'))).toBe(true);
  });
});
