/**
 * Commander lane edh-top, round edh-top-8: the template data of parser/templates/zz-cloud/edh-top-8.json ("play lands and cast spells from among a group", "an opponent chooses a nonland card exiled this way", "cast up to two spells from among the other cards exiled this way", "as long as ..., you may play cards exiled with ~", "separate ... into two piles") and the round's parser and renderer changes, tested at the end of this file and in edh-top-8-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-top-8-scenarios.test.ts. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhTop8 from '../../../src/parser/templates/zz-cloud/edh-top-8.json';
import review8 from '../../m5/golden/cards/edh-top-8-review.json';
import w3b from '../../m5/golden/cards/w3b-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhTop8 as Template[];
/** The round's golden entries, and the entry of Liliana of the Veil that edh-top-8 updated in the file of the round that first pinned that card (w3b-review.json). */
const review = [...(review8 as { card: string; verified: string; expect?: string }[]), ...(w3b as { card: string; verified: string; expect?: string }[]).filter((g) => g.card === 'Liliana of the Veil')];
const MECH_COUNT = 9;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on one card (of the EDHREC top
 * 5,000) only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (standing rule 2026-10-27, recommendation: accept).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edht8.play.landsSpells.group.dur': ['Elder Brain'],
  'eff.edht8.play.landsSpells.group.free': ['Gix, Yawgmoth Praetor'],
  'sta.edht8.yourTurn.asLongAs.play.linked': ['Evendo Brushrazer'],
  'eff.edht8.opponent.chooses.nonland.exiledThisWay': ['Plargg and Nassari'],
  'eff.edht8.cast.upTo.free.fromOthers': ['Plargg and Nassari'],
  'eff.edht8.piles.separatePermanents': ['Liliana of the Veil'],
  'eff.edht8.piles.thatPlayerSacrificesChosen': ['Liliana of the Veil'],
  'eff.edht8.cast.spellsFromGroup.dur.anyType': ['Mnemonic Betrayal'],
  'eff.edht8.return.group.toOwnersGraveyards': ['Mnemonic Betrayal'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a triggered or activated line on an artifact or a creature, else a sorcery. */
const parsedWith = (_t: Template, text: string) =>
  parseCard(/^\{/.test(text) ? card('Example Plan', 'Artifact', text) : /^(When|At the|Whenever)/.test(text) ? card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-top-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-top-8.json, path order: after edh-top-7) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-top-8.json');
    expect(files.indexOf('zz-cloud/edh-top-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-top-7.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are *.edht8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rid)\.edht8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
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

describe('edh-top-8 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bplay lands and cast spells\b/, 'play lands'], [/\bfrom among\b/, 'from'], [/\bwithout paying their mana costs\b/, 'paying their mana costs'], [/\bup to two\b/, 'any number of'],
    [/\bthe other cards\b/, 'the cards'], [/\ban opponent chooses\b/, 'each opponent chooses'], [/\ba nonland card\b/, 'a land card'], [/\bas long as\b/, 'unless'], [/\byou may play cards\b/, 'you may cast spells'],
    [/\bseparate all permanents\b/, 'separate all creatures'], [/\bsacrifices all permanents\b/, 'sacrifices a permanent'], [/\ban opponent\b/, 'a player'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-top-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-top-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-top-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-top-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const creature = (text: string) => parseCard(card('Example Plan', 'Creature — Pirate', text, { power: '3', toughness: '3' } as Partial<OracleCard>), OPTS).faces[0]!;
const artifact = (text: string) => parseCard(card('Example Plan', 'Artifact', text), OPTS).faces[0]!;


describe('edh-top-8 parser and renderer changes (one test each)', () => {
  it('render/stat.ts: "play lands and cast spells from among" is an alt of the play permission for a group an earlier instruction named, in the sentence and next to the other readings; "play lands from among" and a permission without a group are not', () => {
    const a = sorcery('Exile the top two cards of your library. You may play lands and cast spells from among those cards this turn.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"action":"play"');
    expect(fullyAutomated(sorcery('Exile the top two cards of your library. You may play those cards this turn.'))).toBe(true);
    // combined copy: edh-d-87 (Cosima, God of the Voyage; eff.edhd87.permit.playLands.fromAmong.dur) reads "play lands from among" as a play permission for the land cards only
    expect(fullyAutomated(sorcery('Exile the top two cards of your library. You may play lands from among those cards this turn.'))).toBe(true);
    expect(JSON.stringify(sorcery('Exile the top two cards of your library. You may play lands from among those cards this turn.').abilities)).toContain('"action":"play","of":{"is":{"ref":"bound","name":"them"}},"onlyTypes":["Land"]');
    // the exiled cards of an exile of cards from a hand are "the exiled cards" too
    expect(fullyAutomated(creature("Whenever this creature attacks a player, exile all cards from that player's hand, then they draw that many cards. You may play lands and cast spells from among the exiled cards for as long as they remain exiled."))).toBe(true);
  });
  it('render/steps-zones.ts: the free play of the cards of a group is "play lands and cast spells from among ... without paying their mana costs" (a cast step with play, free and optional); not for cards that are not in exile, a number of them, or a cost', () => {
    const ok = sorcery("Exile the top three cards of target opponent's library. You may play lands and cast spells from among those cards without paying their mana costs.");
    expect(fullyAutomated(ok)).toBe(true);
    for (const k of ['"free":true', '"op":"cast"', '"optional":true', '"play":true']) expect(JSON.stringify(ok.abilities)).toContain(k);
    expect(fullyAutomated(sorcery("Exile the top three cards of target opponent's library. You may play lands and cast spells from among those cards without paying their mana cost."))).toBe(false);
    expect(fullyAutomated(sorcery("Exile the top three cards of target opponent's library. You may cast up to two spells from among those cards without paying their mana costs."))).toBe(true); // (the older reading, unchanged)
  });
  it('parser/lower/mentions.ts and anaphora.ts (Mention.optionActor): after "its controller may pay 1 life", the subject "they" of "If they do, they draw a card" is that controller, not the player the event names; a lone "they" with two players stays ambiguous', () => {
    const ok = creature('Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card.');
    expect(fullyAutomated(ok)).toBe(true);
    // the payment and the draw are both by the controller of the creature that dealt the damage, never by the player it was dealt to
    expect((JSON.stringify(ok.abilities).match(/"ref":"controllerOf"/g) ?? []).length).toBe(2);
    expect(JSON.stringify(ok.abilities)).not.toContain('"role":"recipient"');
    // fail closed: another reading of "they" (a draw by the damaged player) is not given; "that player" there is the damaged one and is not an option actor
    expect(fullyAutomated(creature('Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, that player draws a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever a creature deals combat damage to one of your opponents, they may pay 1 life. If they do, they draw a card.'))).toBe(false);
  });
  it('parser/holes/object.ts#rest and render/fold.ts#otherExiledThisWay: "the other cards exiled this way" are the cards of the group a choice among it did not pick; with no choice before it, or after one in a library, the sentence stays manual', () => {
    const ok = sorcery('Each player exiles cards from the top of their library until they exile a nonland card. An opponent chooses a nonland card exiled this way. You may cast up to two spells from among the other cards exiled this way without paying their mana costs.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toMatch(/"not":\{"is":\{/);
    expect(fullyAutomated(sorcery('Each player exiles cards from the top of their library until they exile a nonland card. You may cast up to two spells from among the other cards exiled this way without paying their mana costs.'))).toBe(false);
  });
  it('render/steps-flow.ts: "An opponent chooses a nonland card exiled this way" is the choice of one nonland card of the group by a player; a land card, or another chooser, is not that wording', () => {
    expect(fullyAutomated(sorcery('Each player exiles cards from the top of their library until they exile a nonland card. An opponent chooses a nonland card exiled this way.'))).toBe(true);
    expect(fullyAutomated(sorcery('Each player exiles cards from the top of their library until they exile a nonland card. An opponent chooses a land card exiled this way.'))).toBe(false);
  });
  it('render/fold-edht8.ts: "Separate all permanents <player> controls into two piles. That player sacrifices all permanents in the pile of their choice." is one piles step and a sacrifice by the player who chooses the pile; you sacrificing, or other permanents, are not', () => {
    const ok = sorcery('Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"piles"');
    expect(JSON.stringify(ok.abilities)).toContain('"op":"sacrificeChoice"');
    expect(fullyAutomated(sorcery('Separate all permanents you control into two piles. You sacrifice all permanents in the pile of your choice.'))).toBe(false);
    expect(fullyAutomated(sorcery('Separate all creatures target player controls into two piles. That player sacrifices all creatures in the pile of their choice.'))).toBe(false);
  });
  it('parser/templates sta.edht8.yourTurn.asLongAs.play.linked: "During your turn, as long as C, you may play cards exiled with ~" is the permission under your turn and C; "each opponent\'s turn" is not', () => {
    const ok = creature("Whenever you sacrifice a nontoken permanent, exile the top card of your library.\nDuring your turn, as long as you've sacrificed a nontoken permanent this turn, you may play cards exiled with this creature.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(creature("Whenever you sacrifice a nontoken permanent, exile the top card of your library.\nDuring each opponent's turn, as long as you've sacrificed a nontoken permanent this turn, you may play cards exiled with this creature."))).toBe(false);
  });
  it('parser/lower/choose.ts#thenRoll, render/program.ts and render/steps-zones.ts#chooseNewTargets: "Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell." keeps the target of the announcement for the flip\'s results; a flip with no result sentence leaves the target unused and the card manual', () => {
    const ok = parseCard(card('Example Plan', 'Instant', 'Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"op":"flipCoin"');
    expect(JSON.stringify(ok.abilities)).toContain('"op":"chooseNewTargets"');
    expect(fullyAutomated(parseCard(card('Example Plan', 'Instant', 'Choose target spell, then flip a coin.'), OPTS).faces[0]!)).toBe(false);
    expect(fullyAutomated(parseCard(card('Example Plan', 'Instant', 'Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it.'), OPTS).faces[0]!)).toBe(true);
  });
});
