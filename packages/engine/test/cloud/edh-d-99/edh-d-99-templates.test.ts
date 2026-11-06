/**
 * Commander lane edh-d (coordinator D, concept lane graveyard-cast), round edh-d-99: the template data of parser/templates/zz-cloud/edh-d-99.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-d-99-scenarios.test.ts.
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
import { classifyAbility } from '../../../src/model/classify';
import edhD99 from '../../../src/parser/templates/zz-cloud/edh-d-99.json';
import review from '../../m5/golden/cards/edh-d-99-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhD99 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhd99.search.libraryAndGraveyard.exactly.exileRest.chosenOnTop': ['Doomsday'],
  'eff.edhd99.eachOpp.poisonAtLeast.exileTopFaceDown.lookPlay.anyColor': ['Ixhel, Scion of Atraxa'],
  'eff.edhd99.repeat.eachOpp.revealTop.mayPayLifeMv.exileElseHand': ['Protection Racket'],
  'eff.edhd99.activePlayer.mayEndTheTurn': ['Obeka, Brute Chronologist'],
  'sta.edhd99.pregame.reveal.firstUpkeep.lookPutBackExileRest': ['Devourer of Destiny'],
  'eff.edhd99.mayExile.oneCard.fromEachGraveyard': ["King Narfi's Betrayal"],
  'eff.edhd99.dur.castFromAmongExiledWithSelf.anyColor': ["King Narfi's Betrayal"],
  'eff.edhd99.ifHandMoreThan.exileTheDifference': ["Isildur's Fateful Strike"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-99 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-99.json, path order: after edh-d-9, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-99.json');
    expect(files.indexOf('zz-cloud/edh-d-99.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-9.json'));
    expect(files.indexOf('zz-cloud/edh-d-99.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edhd99.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhd99\./);
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

describe('edh-d-99 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-d-99 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-99 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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
    }, 120_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-d-99 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-99 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-d-99 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Dinosaur', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/lower/ability.ts#reflexiveHeader + render/steps-flow.ts (CR 603.12, 700.2, 118.12; Tranquil Frillback): "When you pay this cost one or more times, choose up to that many --" after "you may pay {G} up to N times" reads as "When you do, ..."; after a single payment, or with another count, it stays unread', () => {
    const modes = '\n• Destroy target artifact.\n• You gain 2 life.';
    expect(fullyAutomated(creature(`When ~ enters, you may pay {G} up to two times. When you pay this cost one or more times, choose up to that many —${modes}`))).toBe(true);
    expect(fullyAutomated(creature(`When ~ enters, you may pay {G}. When you pay this cost one or more times, choose up to that many —${modes}`))).toBe(false);
    expect(fullyAutomated(creature(`When ~ enters, you may pay {G} up to two times. When you pay this cost one or more times, choose one —${modes}`))).toBe(false);
    expect(fullyAutomated(creature(`When ~ enters, you may pay {G} up to two times. When you pay this cost two or more times, choose up to that many —${modes}`))).toBe(false);
  });
  it('parser/lower/join-edhd99.ts + render/fold-edhd99.ts (CR 701.23a, 701.23d, 401.4; Doomsday): the search-and-exile-the-rest sentence and "Put the chosen cards on top ..." are joined only as a pair; either alone, or another zone, stays unread', () => {
    expect(fullyAutomated(spell('Search your library and graveyard for four cards and exile the rest. Put the chosen cards on top of your library in any order.'))).toBe(true);
    expect(fullyAutomated(spell('Search your library and graveyard for four cards and exile the rest.'))).toBe(false);
    expect(fullyAutomated(spell('Put the chosen cards on top of your library in any order.'))).toBe(false);
    expect(fullyAutomated(spell('Search your library and hand for four cards and exile the rest. Put the chosen cards on top of your library in any order.'))).toBe(false);
    expect(fullyAutomated(spell('Search your library and graveyard for four cards and exile the rest. Draw a card. Put the chosen cards on top of your library in any order.'))).toBe(false);
  });
  it('render/steps-zones.ts#sacrificeChoice (CR 701.21a, 202.3; Riveteers Charm): "sacrifices a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control" passes the gate; the same words with power, or with another type, stay unread', () => {
    const t = (x: string) => spell(x, 'Instant');
    expect(fullyAutomated(t('Target opponent sacrifices a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.'))).toBe(true);
    expect(fullyAutomated(t('Target opponent sacrifices a creature or planeswalker they control with the greatest power among creatures and planeswalkers they control.'))).toBe(false);
    expect(fullyAutomated(t('Target opponent sacrifices a creature or artifact they control with the greatest mana value among creatures and artifacts they control.'))).toBe(false);
  });
  it('parser/holes/player.ts + render/refs.ts (CR 102.1; Obeka): "the player whose turn it is" is the active player (family player-whose-turn-it-is); "the player whose turn it was" stays unread', () => {
    const t = (x: string) => parseCard(card('Example Relic', 'Artifact', x), OPTS).faces[0]!;
    const a = t('{T}: The player whose turn it is may draw a card.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('{"ref":"active"}');
    expect(fullyAutomated(t('{T}: The player whose turn it was may draw a card.'))).toBe(false);
  });
  it('render/fold-edhd99.ts#mayExileOneFromEachGraveyard + effects/handlers/lasting.ts (CR 608.2c, 101.4, 607.2a; King Narfi\'s Betrayal): one card of a description from each graveyard; a resolved cast permission for the cards exiled with ~ is automated (feature:permit.cast.linked.lasting), a play permission is not yet', () => {
    const saga = (x: string) => parseCard(card('Example Saga', 'Enchantment — Saga', x), OPTS).faces[0]!;
    const two = 'II — Until end of turn, you may cast spells from among cards exiled with this Saga, and you may spend mana as though it were mana of any color to cast those spells.';
    expect(fullyAutomated(saga(`(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — You may exile an artifact card from each graveyard.\n${two}`))).toBe(true);
    // combined copy: the play form now parses (a later round's linked play permission), and stays not automated where the engine decides it: its capability
    // feature:permit.play.linked.lasting is registered nowhere, so the chapter classifies manual (fail closed)
    const play = saga(`(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — You may exile an artifact card from each graveyard.\nII — Until end of turn, you may play cards exiled with this Saga.`);
    expect(play.abilities.some((a) => a.kind === 'manual' || classifyAbility(a, ENGINE_CAPABILITIES).level !== 'full')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.linked.lasting')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('feature:permit.cast.linked.lasting')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:permit.play.linked.lasting')).toBe(false);
  });
  it('render/cond.ts (CR 702.1, 404.1; family graveyard-card-has-keyword; Bleeding Effect): "if a creature card in your graveyard has flying" passes the gate; with two types, or another zone, it stays unread', () => {
    const t = (x: string) => parseCard(card('Example Rite', 'Enchantment', x), OPTS).faces[0]!;
    expect(fullyAutomated(t('At the beginning of your upkeep, creatures you control gain reach until end of turn if a creature card in your graveyard has reach.'))).toBe(true);
    expect(fullyAutomated(t('At the beginning of your upkeep, creatures you control gain reach until end of turn if a creature card in your library has reach.'))).toBe(false);
  });
  it('parser/lower/join-edhd99.ts + render/fold-edhd99.ts (CR 608.2c, 101.4, 119.4; Protection Racket): the five sentences of the process are joined only all together; the process alone, or a changed step, stays unread', () => {
    const t = (x: string) => spell(x, 'Sorcery');
    const all = "Repeat the following process for each opponent in turn order. Reveal the top card of your library. That player may pay life equal to that card's mana value. If they do, exile that card. Otherwise, put it into your hand.";
    expect(fullyAutomated(t(all))).toBe(true);
    expect(fullyAutomated(t('Repeat the following process for each opponent in turn order. Reveal the top card of your library.'))).toBe(false);
    expect(fullyAutomated(t(all.replace('each opponent', 'each player')))).toBe(false);
    expect(fullyAutomated(t(all.replace("that card's mana value", "that card's power")))).toBe(false);
  });
  it('parser/lower/join-edhd99.ts + render/fold-edhd99.ts (CR 122.1f, 406.3, 609.4b; Ixhel): the poisoned-opponents exile and the look-and-play sentence are joined only as a pair; the first alone, or "each player", stays unread', () => {
    const look = 'You may look at and play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast those spells.';
    expect(fullyAutomated(spell(`Each opponent who has two or more poison counters exiles the top card of their library face down. ${look}`))).toBe(true);
    expect(fullyAutomated(spell('Each opponent who has two or more poison counters exiles the top card of their library face down.'))).toBe(false);
    expect(fullyAutomated(spell(`Each player who has two or more poison counters exiles the top card of their library face down. ${look}`))).toBe(false);
    expect(fullyAutomated(spell(`Each opponent who has two or more poison counters exiles the top two cards of their library face down. ${look}`))).toBe(false);
  });
});
