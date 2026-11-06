/**
 * Must-finish round edh-next-121 (dice, coins and random): the template data of parser/templates/zz-cloud/edh-next-121.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-121-scenarios.test.ts.
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
import edhNext121 from '../../../src/parser/templates/zz-cloud/edh-next-121.json';
import review from '../../m5/golden/cards/edh-next-121-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext121 as Template[];
const MECH_COUNT = 10;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the card of the EDHREC top 5,000 that prints the wording and is full (each wording is printed on that one card)
  'eff.edhn121.mayRollAgain': ['Delina, Wild Mage'],
  'eff.edhn121.eachExileUntil.shuffleRest': ['Wand of Wonder'],
  'eff.edhn121.cast.upTo.instantSorcery.free.fromAmong': ['Wand of Wonder'],
  'eff.edhn121.dieRow.xIs': ['Wand of Wonder'],
  'eff.edhn121.return.self.transformed.selfOwner': ['Ral, Monsoon Mage // Ral, Leyline Prodigy'],
  'rep.edhn121.enters.additionalLoyalty.forEach': ['Ral, Monsoon Mage // Ral, Leyline Prodigy'],
  'eff.edhn121.dur.spells.youCast.less': ['Ral, Monsoon Mage // Ral, Leyline Prodigy'],
  'eff.edhn121.permit.castInstantSorcery.fromAmong.thisTurn.free': ['Ral, Monsoon Mage // Ral, Leyline Prodigy'],
  'eff.edhn121.exile.randomFromEachOpponentGraveyard': ['Kefka, Dancing Mad'],
  'eff.edhn121.eachOwnerOfCastSpell.losesLife.manaValue': ['Kefka, Dancing Mad'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  /^[+\u2212-]\d+:/.test(text) || /loyalty counter/.test(text) ? card('Example Sage', 'Legendary Planeswalker — Example', text, { loyalty: '4' }) :
  /enchanted (creature|land|artifact|permanent|enchantment)/.test(text) ? card(
    'Example Boon', 'Enchantment — Aura', text) :
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-121 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-121.json, path order: after edh-next-12, before edh-next-13) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-121.json');
    expect(files.indexOf('zz-cloud/edh-next-121.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-12.json'));
    expect(files.indexOf('zz-cloud/edh-next-121.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-13.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn121.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|ch|rid|cm|dl)\.edhn121\./);
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

describe('edh-next-121 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\broll again\b/, 'roll a die'], [/\bX is one\b/, 'X is any'], [/\bshuffles\b/, 'puts'], [/\binstant and\/or sorcery\b/, 'creature'], [/\btransformed\b/, 'tapped'],
    [/\badditional loyalty\b/, 'additional +1/+1'], [/\bless\b/, 'more'], [/\bthis turn\b/, 'this game'], [/\bat random\b/, 'of their choice'], [/\bowns\b/, 'controls'], [/\bloses life\b/, 'gains life'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-121 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-121 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-121 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-121 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-next-121 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Sorcery') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Elf', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/lower/die-roll.ts (CR 706.3a): "You may roll again." only as the last instruction of a row; "Create one of those tokens." also names an earlier row\'s token copy', () => {
    expect(fullyAutomated(spell('Roll a d20.\n1-14 | Create a Treasure token.\n15-20 | Create two of those tokens. You may roll again.'))).toBe(true);
    expect(fullyAutomated(spell('Roll a d20.\n1-14 | Create a Treasure token.\n15-20 | You may roll again. Create two of those tokens.'))).toBe(false);
    expect(fullyAutomated(spell('Roll a d20.\n1-14 | You may roll again.\n15-20 | Draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever Example Beast attacks, choose target creature you control, then roll a d20.\n1-14 | Create a tapped and attacking token that\'s a copy of that creature.\n15-20 | Create two of those tokens.'))).toBe(true);
  });
  it('parser/lower/die-roll.ts#defineXRows (CR 706.3a, 107.3): rows that only say what X is, for instructions that read X; any other table with "X is" stays manual', () => {
    const wand = (rows: string) => parseCard(card('Example Rod', 'Artifact', `{3}, {T}: Roll a d20. Each opponent exiles cards from the top of their library until they exile an instant or sorcery card, then shuffles the rest into their library. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.\n${rows}`), OPTS).faces[0]!;
    expect(fullyAutomated(wand('1-10 | X is one.\n11-20 | X is two.'))).toBe(true);
    expect(fullyAutomated(wand('1-10 | X is one.\n12-20 | X is two.')), 'a gap in the rows').toBe(false);
    expect(fullyAutomated(wand('1-10 | X is one.\n11-20 | Draw a card.')), 'a row that does something else').toBe(false);
    expect(fullyAutomated(parseCard(card('Example Rod', 'Artifact', '{X}, {T}: Roll a d6. You may cast up to X instant and/or sorcery spells from among cards exiled this way without paying their mana costs.\n1-3 | X is one.\n4-6 | X is two.'), OPTS).faces[0]!), 'a face with {X} of its own').toBe(false);
  });
  it('parser/holes/filter.ts + render/refs.ts (CR 115.9a): "target spell or ability with one or more targets"; "with two targets" is not read that way', () => {
    expect(fullyAutomated(spell('Choose target spell or ability with one or more targets. You may choose new targets for that spell or ability.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('Counter target spell with one or more targets.', 'Instant'))).toBe(true);
    expect(fullyAutomated(spell('Counter target spell with two or more targets.', 'Instant'))).toBe(false);
  });
  it('parser/lower/self-moved.ts (CR 400.7j): a later move of ~ after ~ was exiled moves the exiled card (named), never an ability the effect creates', () => {
    const f = parseCard(card('Example Shifter', 'Creature — Shapeshifter', '{2}: You may exile Example Shifter. If you do, return Example Shifter to the battlefield transformed under Example Shifter\'s owner\'s control.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(JSON.stringify(f.abilities)).toContain('"what":{"ref":"bound","name":"selfMoved"}');
    // review fix: alternatives never pass the name to each other (a row that exiles ~ and another that returns it stay as they were)
    const g = parseCard(card('Example Shifter', 'Artifact Creature — Golem', '{1}: Roll a d6.\n1-3 | Exile Example Shifter.\n4-6 | Return Example Shifter to its owner\'s hand.', { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(g)).toBe(true);
    expect(JSON.stringify(g.abilities)).not.toContain('selfMoved');
  });
  it('parser/lower/self-moved.ts#bindCastThisWay (CR 400.7h): "a spell you cast this way" after one free cast; with no cast before it, it stays unread', () => {
    const t = 'Then each player who owns a spell you cast this way loses life equal to its mana value.';
    expect(fullyAutomated(spell(`Exile the top card of each player's library. You may cast any number of spells from among them without paying their mana costs. ${t}`))).toBe(true);
    expect(fullyAutomated(spell(`Exile the top card of each player's library. ${t}`))).toBe(false);
  });
});
