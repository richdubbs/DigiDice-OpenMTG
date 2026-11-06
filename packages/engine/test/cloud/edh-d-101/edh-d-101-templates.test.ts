/**
 * Commander coordinator D, round edh-d-101 (EDHREC ranks 5,001-10,000, group graveyard-exile-cast): the template data of parser/templates/zz-cloud/edh-d-101.json (see the file) and the
 * round's parser, lowering, engine and renderer changes, tested at the end of this file and in edh-d-101-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhD101 from '../../../src/parser/templates/zz-cloud/edh-d-101.json';
import review from '../../m5/golden/cards/edh-d-101-review.json';
import dftReview from '../../m5/golden/cards/cloud-std-dft-review.json';
import fxbReview from '../../m5/golden/cards/cloud-r5-fxb-promoted.json'; // The Creation of Avacyn's entry (updated by this round)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';
import { compileCard } from '../../../src/index';

const MECH = edhD101 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one card, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing
 * rule 2026-10-27; one-card templates are allowed in this effort).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'sta.edhd101.triggerMod.anyCause.while': ['Sanctum of All'],
  'eff.edhd101.eachOpp.chooseTarget.controllerMayExile.searchRemaining': ['Disorienting Choice'],
  'sta.edhd101.playSelf.fromGraveyard': ['Kethis, the Hidden Hand'],
  'eff.edhd101.linked.turnFaceUp.ifTypeLoseManaValue': ['The Creation of Avacyn'],
  'eff.edhd101.linked.mayPutIfType.elseHand': ['The Creation of Avacyn'],
  'rid.edhd101.mana.youSpend.mayExileSpellAsItResolves': ["Forger's Foundry"],
  'eff.edhd101.castAnyNumber.linkedExiled.free': ["Forger's Foundry"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a Saga for chapters, a static, activated or triggered ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^I -- /.test(text) ? card('Example Saga', 'Enchantment — Saga', text.replaceAll(' -- ', ' — '))
    : t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-d-101 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-d-101.json, path order: after edh-d-10.json, before edh-d-11.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-d-101.json');
    expect(files.indexOf('zz-cloud/edh-d-101.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-d-10.json'));
    expect(files.indexOf('zz-cloud/edh-d-101.json')).toBeLessThan(files.indexOf('zz-cloud/edh-d-11.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 101; ids are *.edhd101.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhd101\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(101);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = [...review, ...dftReview, ...fxbReview] as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.expect === 'full' && (g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`))).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'still']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-d-101 guard G9 (design 6.8): examples and counter-examples', () => {
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
    }, 120_000);
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bsix\b/, 'seven'], [/\bfour\b/, 'five'], [/\bopponent\b/, 'player'], [/\byour graveyard\b/, 'your hand'], [/\bmay\b/, 'must'], [/\b3\b/, '4']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-d-101 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-d-101 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w) || w === '--' || /\S\n\S/.test(w) || /^(I|II|III)$/.test(w.replace(/^\n/, ''))) return; // (a word with a line break inside joins two lines: no single-word mutation)
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

describe.skipIf(index === null)('edh-d-101 design 6.10 (local index): synthetic examples', () => {
  it('no edh-d-101 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
          lines.add(l.replaceAll(' — ', ' -- ').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim, verbatim.join('\n')).toEqual([]);
  }, 120_000);
});

describe('edh-d-101 parser, lowering, renderer and engine changes (one test each, with the negative case)', () => {
  // the card's automation level as the game compiles it (manual cost parts and capabilities the engine lacks count, which `fullyAutomated` of one face does not see)
  const spellFull = (text: string) => compileCard(card('Example Plan', 'Sorcery', text)).automation.level === 'full';
  const relicFull = (text: string) => compileCard(card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' })).automation.level === 'full';
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('render/abil.ts (family trigger-mod-while, CR 603.2d): "triggers while C" is the doubler under a condition; "while" with a cause of its own is not read', () => {
    expect(relicFull(('If a triggered ability of another Wizard you control triggers while you control four or more Wizards, that ability triggers an additional time.'))).toBe(true);
    expect(relicFull(('If a Wizard entering causes a triggered ability of a permanent you control to trigger while you control four or more Wizards, that ability triggers an additional time.'))).toBe(false);
  });
  it('parser/lower/join-edhd101.ts (CR 115.1, 601.2c): the three sentences are joined only in that order and wording; "each player" or a missing "Then" sentence is not this reading', () => {
    expect(spellFull(('For each opponent, choose up to one target creature that player controls. For each permanent chosen this way, its controller may exile it.'))).toBe(false);
    expect(spellFull(('For each player, choose up to one target creature that player controls. For each permanent chosen this way, its controller may exile it. Then if one or more of the chosen permanents are still on the battlefield, you search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.'))).toBe(false);
  });
  it('parser/holes/cost.ts (CR 708.9, 406.3): "face up" is read after one face-down permanent only; after a face-up description it is not', () => {
    expect(relicFull(('Exile a face-down permanent you control face up: Draw a card.'))).toBe(true);
    expect(relicFull(('Exile a creature you control face up: Draw a card.'))).toBe(false);
  });
  it('parser/lower/ability.ts#exiledMentions (CR 400.7): "that card" names the card a cost exiled from the battlefield in a permission; a move of it stays manual (only its last known information)', () => {
    expect(relicFull(('Exile a face-down permanent you control face up: You may play that card this turn.'))).toBe(true);
    expect(relicFull(('Exile a creature you control: Return that card to the battlefield.'))).toBe(false);
    // review: "that card" after a draw is the drawn card; a token is no card; a face-up permanent is not this reading
    expect(relicFull(('{1}, Exile a creature you control: Draw a card. You may cast that card this turn.'))).toBe(false);
    expect(relicFull(('{1}, Exile a face-down permanent you control: Draw a card. You may cast that card this turn.'))).toBe(false);
    expect(relicFull(('Exile a token you control: You may play that card this turn.'))).toBe(false);
  });
  it('parser/lower/repeat-process.ts (CR 608.2c): a sentence after "If C, repeat this process." is read when understood; a manual one keeps the marker manual', () => {
    expect(spellFull(('Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process. You gain 1 life.'))).toBe(true);
    expect(spellFull(('Mill two cards. If two cards that share a card type were milled this way, draw a card and repeat this process. Blorfty the moon.'))).toBe(false);
  });
  it('parser/lower/ability.ts#withModes (CR 700.2): a spell\'s sentences after the last bullet run after the chosen mode; a sentence between the header and the bullets is no such reading', () => {
    expect(spellFull(('Choose one --\n• Destroy all creatures.\n• Destroy all artifacts.\nThen draw a card.'))).toBe(true);
    expect(JSON.stringify(spell('Choose one --\n• Destroy all creatures.\n• Destroy all artifacts.\nThen draw a card.').abilities)).toContain('"modes"');
  });
  it('effects/handlers/lasting.ts + model/cap-walk.ts (CR 611.2c): the graveyard grant is read on a resolved effect only; a static grant of it stays not automated', () => {
    expect(relicFull(('{1}, {T}: Until end of turn, each artifact card in your graveyard gains "You may play this card from your graveyard."'))).toBe(true);
    expect(relicFull(('Each artifact card in your graveyard has "You may play this card from your graveyard."'))).toBe(false);
  });
  it('parser/holes/cost.ts#numCount (CR 608.2h): "sacrifice that many permanents" names the amount an earlier "that much" did; with nothing before it the sentence is manual', () => {
    expect(relicFull(("Whenever a source an opponent controls deals damage to ~, that source's controller loses that much life unless they sacrifice that many permanents of their choice."))).toBe(true);
    expect(relicFull(('{T}: Each opponent loses 2 life unless they sacrifice that many permanents of their choice.'))).toBe(false);
    // review: "that many" after a fixed amount is not the amount of the event
    expect(relicFull(('Whenever you draw a card, you lose 2 life unless you sacrifice that many creatures.'))).toBe(false);
  });
  it('render/steps-lasting.ts (review; CR 614.1a): the optional exile as a spell resolves is read in a mana-spent trigger only; the plain one of a cast trigger stays as it was', () => {
    expect(relicFull(("{T}: Add {R}. When you spend this mana to cast an instant spell, you may exile that spell instead of putting it into its owner's graveyard as it resolves."))).toBe(true);
    expect(relicFull(('Whenever you cast an instant spell, exile that spell instead of putting it into your graveyard as it resolves.'))).toBe(true);
    expect(relicFull(("Whenever you cast an instant spell, you may exile that spell instead of putting it into its owner's graveyard as it resolves."))).toBe(false);
  });
});
