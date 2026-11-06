/**
 * Must-finish round edh-next-139 (group tokens): the template data of parser/templates/zz-cloud/edh-next-139.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-139-scenarios.test.ts.
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
import edhNext139 from '../../../src/parser/templates/zz-cloud/edh-next-139.json';
import review from '../../m5/golden/cards/edh-next-139-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext139 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 10,000 that prints the wording and is full (each wording is printed on that one card)
  'eff.edhn139.startingWithYou.eachPlayer.mayPayAnyLife': ['Plague of Vermin'],
  'eff.edhn139.repeatProcess.untilNoOnePaysLife': ['Plague of Vermin'],
  'eff.edhn139.eachPlayer.createsToken.forEachLifeTheyPaid': ['Plague of Vermin'],
  'eff.edhn139.tapAllUntappedWolves.thisWay': ['Master of the Wild Hunt'],
  'eff.edhn139.eachWolfTapped.dealsPower.targetDividesBack': ['Master of the Wild Hunt'],
  'trg.edhn139.creaturePutOntoWithSelf.leaves': ['Havengul Laboratory // Havengul Mystery'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-139 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-139.json, path order: after edh-next-13, before edh-next-14) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-139.json');
    expect(files.indexOf('zz-cloud/edh-next-139.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-13.json'));
    expect(files.indexOf('zz-cloud/edh-next-139.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-14.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn139.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn139\./);
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

describe('edh-next-139 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bEquipment in addition\b/, 'Auras in addition'], [/\bequip Warrior\b/, 'equip Wizard creature'], [/\bany amount of life\b/, 'any amount of mana'], [/\bno one pays life\b/, 'no one pays mana'],
    [/\blife they paid\b/, 'life you paid'], [/\buntapped Wolf\b/, 'tapped Wolf'], [/\bits controller chooses\b/, 'you choose'], [/\bthose Wolves\b/, 'those creatures'], [/\bleaves the battlefield\b/, 'dies'],
    [/\bStarting with you\b/, 'Starting with an opponent'], [/\btapped this way\b/, 'untapped this way'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-139 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-139 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-139 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-139 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-next-139 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery', cost = '{1}') => parseCard({ ...card('Example Plan', type, text), mana_cost: cost } as OracleCard, OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Elf', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const artifact = (text: string) => parseCard(card('Example Relic', 'Artifact', text), OPTS).faces[0]!;
  it('parser/holes/misc.ts (CR 702.6a, 702.6c): "equip Pirate {1}" in a list of abilities is equip with a quality; a quote glued to the next item by its comma is a list item', () => {
    expect(fullyAutomated(artifact('Clues you control have equip Knight {2}.'))).toBe(true);
    expect(fullyAutomated(artifact('Clues you control have "Equipped creature gets +1/+0," equip Knight {2}, and equip {4}.'))).toBe(true);
    expect(fullyAutomated(artifact('Clues you control have "Equipped creature gets +1/+0," and equip {4}.')), 'a comma inside the quote of a list of two').toBe(false);
  });
  it('parser/holes/token.ts + render/quote.ts + render/equivalence.ts (CR 201.5a, 113.1a): the name of a named token inside a nested quote is the grantor; the nested quote may lack its period', () => {
    expect(fullyAutomated(creature("When this creature enters, create a colorless Equipment artifact token named Stick with \"Equipped creature has '{T}, Sacrifice Stick: Draw a card'\" and equip {2}."))).toBe(true);
    expect(fullyAutomated(creature("When this creature enters, create a colorless Equipment artifact token named Stick with \"Equipped creature has '{T}, Sacrifice Stone: Draw a card'\" and equip {2}.")), 'another name').toBe(false);
  });
  it('render/cond.ts (CR 105.2c): "if that spell was all colors" of the cast event\'s spell', () => {
    expect(fullyAutomated(creature('Whenever you cast a multicolored spell, you gain 1 life. If that spell was all colors, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you cast a spell, draw a card. If that spell was all colors, you gain 3 life.'))).toBe(true);
  });
  it('parser/lower/trigger-zone.ts (CR 702.29c, 107.3): a cycle trigger may ask to pay {X} (only that one payment)', () => {
    expect(fullyAutomated(spell('Draw a card.\nCycling {2}\nWhen you cycle this card, you may pay {X}. If you do, you gain X life.'))).toBe(true);
    expect(fullyAutomated(spell('Draw a card.\nCycling {2}\nWhen you cycle this card, you may pay {X}. If you do, you gain X life. Then you may pay {1}.')), 'a second payment').toBe(false);
  });
  it('parser/holes/cond.ts + render/cond.ts + effects/eval.ts (CR 602.2b, 106.3): "mana from a Treasure was spent to activate this ability"', () => {
    expect(fullyAutomated(creature('{2}: Draw a card. If mana from a Treasure was spent to activate this ability, you gain 2 life.'))).toBe(true);
    expect(fullyAutomated(creature('{2}: Draw a card. If mana from a Treasure was spent to activate that ability, you gain 2 life.'))).toBe(false);
  });
  it('parser/lower/ability.ts + actions/announce.ts + render/program.ts (CR 601.2b, 601.4): "Choose X." with repeats on a spell with {X} in its cost', () => {
    expect(fullyAutomated(spell('Choose X. You may choose the same mode more than once.\n• Draw a card.\n• You gain 2 life.', 'Sorcery', '{X}{B}'))).toBe(true);
    expect(fullyAutomated(spell('Choose X. You may choose the same mode more than once.\n• Draw a card.\n• You gain 2 life.', 'Sorcery', '{2}{B}')), 'no X in the cost').toBe(false);
    expect(fullyAutomated(spell('Choose X.\n• Draw a card.\n• You gain 2 life.', 'Sorcery', '{X}{B}')), 'without the repeat permission').toBe(false);
  });
  it('parser/parse.ts#linkPutOntoWith (CR 607.2c): "the creature put onto the battlefield with ~" needs exactly one move to the battlefield on the face', () => {
    expect(fullyAutomated(creature('When this creature enters, return target creature card from your graveyard to the battlefield.\nWhen the creature put onto the battlefield with this creature leaves the battlefield, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters, draw a card.\nWhen the creature put onto the battlefield with this creature leaves the battlefield, draw a card.')), 'nothing put there').toBe(false);
  });
  it('parser/holes/filter.ts + rules/filter.ts (CR 701.14a, 202.3): "a creature that fought this turn"; "with the same mana value" of the entering creature only in "it fights ..."', () => {
    expect(fullyAutomated(artifact('{T}: Draw a card. Activate only if you control a creature that fought this turn.'))).toBe(true);
    expect(fullyAutomated(artifact('Whenever a creature you control enters, it fights up to one target creature you don\'t control with the same mana value.'))).toBe(true);
    expect(fullyAutomated(artifact('Whenever a creature you control enters, destroy up to one target creature you don\'t control with the same mana value.')), 'not "it fights"').toBe(false);
    // review fix: only the ability's first sentence ("it" is the triggering object there), never a later "It fights ..." whose "it" is another object
    expect(fullyAutomated(artifact('Whenever a creature you control attacks, put a +1/+1 counter on target creature you control. It fights up to one target creature you don\'t control with the same mana value.'))).toBe(false);
  });
});
