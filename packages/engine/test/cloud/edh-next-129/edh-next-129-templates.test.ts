/**
 * Must-finish round edh-next-129 (dice, coins and random, EDHREC 5,001-10,000): the template data of parser/templates/zz-cloud/edh-next-129.json (see the file) and the round's
 * parser, lowering, engine and renderer changes, tested at the end of this file and in edh-next-129-scenarios.test.ts.
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
import edhNext129 from '../../../src/parser/templates/zz-cloud/edh-next-129.json';
import review from '../../m5/golden/cards/edh-next-129-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext129 as Template[];
const MECH_COUNT = 15;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (each wording is printed on that one card)
  'eff.edhn129.copy.thenReselectRandom': ["Chef's Kiss"],
  'rid.edhn129.newTargets.notYours': ["Chef's Kiss"],
  'rid.edhn129.instead.thatTokenAnd': ['Mr. House, President and CEO'],
  'eff.edhn129.rollDie.plusOneForEachTreasureMana': ['Mr. House, President and CEO'],
  'eff.edhn129.flipUntilLoseOrStop': ['Fiery Gambit'],
  'rid.edhn129.lostFlip.noEffect': ['Fiery Gambit'],
  'eff.edhn129.ifWonFlips.orMore': ['Fiery Gambit'],
  'eff.edhn129.chooseOpponentRandom.notAttackedLastCombat': ['Territorial Hellkite'],
  'eff.edhn129.ifCantChooseOpponent': ['Territorial Hellkite'],
  'eff.edhn129.ifFlip.win.decideAgain': ['Game of Chaos'],
  'eff.edhn129.ifFlip.lose.playerDecidesAgain': ['Game of Chaos'],
  'rid.edhn129.doubleLifeStakes': ['Game of Chaos'],
  'eff.edhn129.may.have.becomeXX.artifactCreature.whereX': ['Ebony Fly'],
  'eff.edhn129.choose2Random.selfGain.thatAbility': ['Blitzwing, Cruel Tormentor // Blitzwing, Adaptive Assailant'],
  'rid.edhn129.mayCastCopy.byPaying': ["Wizard's Spellbook"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-129 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-129.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-129.json');
    expect(files.indexOf('zz-cloud/edh-next-129.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-126.json'));
    expect(files.indexOf('zz-cloud/edh-next-129.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn129.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn129\./);
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

describe('edh-next-129 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        // the weak rider of the same wording as edh-next-131's rid.edhn131.mayCastCopy.payingInstead (same JSON): once combined, that one reads it
        expect(f.templatesUsed.includes(t.id) || (t.id === 'rid.edhn129.mayCastCopy.byPaying' && f.templatesUsed.includes('rid.edhn131.mayCastCopy.payingInstead')), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
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
    [/at random/, 'of your choice'], [/you or a permanent you control/, 'a creature'], [/Treasure token/, 'Clue token'], [/Treasures/, 'Clues'], [/choose to stop/, 'decide to stop'],
    [/one or more flips/, 'one or more games'], [/didn't attack/, 'attacked'], [/this way/, 'that way'], [/decide whether/, 'choose whether'], [/Double/, 'Triple'],
    [/artifact creature/, 'creature'], [/gains that ability/, 'gains flying'], [/rather than/, 'and'], [/the copy/, 'it'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-129 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-129 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-129 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-129 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-129 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const artifact = (text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
  it('parser/lower/anaphora.ts (CR 707.10, 115.7): "the spell" beside "the copy" is the spell copied; the reselection needs "the spell and the copy"', () => {
    expect(fullyAutomated(spell("Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the spell and the copy. The new targets can't be you or a permanent you control.", 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the spell and the copy.', 'Instant')), 'no "can\'t be you" rider: the fold says both sentences').toBe(false);
  });
  it('render/steps-flow.ts#thatTokenAnd (CR 614.15): "instead create that token and a Treasure token" only after one creation of tokens by you', () => {
    expect(fullyAutomated(artifact('Whenever you roll a 4 or higher, create a 3/3 colorless Robot artifact creature token. If you rolled 6 or higher, instead create that token and a Treasure token.'))).toBe(true);
    expect(fullyAutomated(artifact('Whenever you roll a 4 or higher, draw a card. If you rolled 6 or higher, instead create that token and a Treasure token.'))).toBe(false);
  });
  it('parser/lower/coin-flip.ts (CR 705.2): the stakes of a flip need both branches and their deciders; one branch alone stays unread', () => {
    expect(fullyAutomated(spell('Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that player decides whether to flip again. Double the life stakes with each flip.'))).toBe(true);
    expect(fullyAutomated(spell('Flip a coin. If you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again.'))).toBe(false);
  });
  it('parser/lower/ability.ts#tokenCharacteristicModes (CR 700.2): token characteristics as random modes; a bullet that is an instruction stays unread', () => {
    const t = (bullets: string) => parseCard(card('Example Revel', 'Enchantment', `At the beginning of your upkeep, choose one at random. Create a red and white creature token with those characteristics.\n${bullets}`), OPTS).faces[0]!;
    expect(fullyAutomated(t('• 3/1 Human Warrior with trample and haste.\n• 2/1 Human Cleric with lifelink and haste.'))).toBe(true);
    expect(fullyAutomated(t('• 3/1 Human Warrior with trample and haste.\n• Draw a card.'))).toBe(false);
  });
  it('parser/parse.ts (FaceInfo.animates, CR 109.2, 115.3): "you may have ~ become an X/X ... creature" lets "another target attacking creature" exclude this artifact', () => {
    expect(fullyAutomated(artifact('{4}: Roll a d6. Until end of turn, you may have this artifact become an X/X Insect artifact creature with flying, where X is the result.\nWhenever this artifact attacks, another target attacking creature gains flying until end of turn.'))).toBe(true);
    expect(fullyAutomated(artifact('Whenever this artifact attacks, another target attacking creature gains flying until end of turn.')), 'an artifact that never becomes a creature').toBe(false);
  });
  it('render/fold.ts#choiceGrant (CR 608.2d): a keyword picked at random is never "your choice"; render/steps-zones.ts: one copy cast for {1}, never a group', () => {
    expect(fullyAutomated(parseCard(card('Example Robot', 'Artifact Creature — Robot', 'At the beginning of combat on your turn, choose flying or indestructible at random. Example Robot gains that ability until end of turn.', { power: '2', toughness: '2' }), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Robot', 'Artifact Creature — Robot', 'At the beginning of combat on your turn, Example Robot gains your choice of flying or indestructible at random until end of turn.', { power: '2', toughness: '2' }), OPTS).faces[0]!)).toBe(false);
    expect(fullyAutomated(artifact('{T}: Exile target instant card from a graveyard. Copy that card. You may cast the copy by paying {1} rather than paying its mana cost.'))).toBe(true);
  });
});
