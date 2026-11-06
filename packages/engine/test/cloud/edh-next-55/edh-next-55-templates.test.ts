/**
 * Commander lane dice, round edh-next-55 (lane `dice` over the EDHREC top 20,000): the template data of parser/templates/zz-cloud/edh-next-55.json (see the file) and the round's parser, lowering,
 * engine and renderer changes, tested at the end of this file and in edh-next-55-scenarios.test.ts.
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
import edhNext55 from '../../../src/parser/templates/zz-cloud/edh-next-55.json';
import review from '../../m5/golden/cards/edh-next-55-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext55 as Template[];
const MECH_COUNT = 11;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27, more cards 2026-10-30)
  'eff.edhn55.createN.ofThoseTokens': ['Swarming Goblins'],
  'eff.edhn55.filter.enterTapped.dur': ['Cone of Cold'],
  'eff.edhn55.rollDie.twoD10.chooseOne': ['Grave Endeavor'],
  'eff.edhn55.rollDie.twoD4.chooseOne': ['Wild Endeavor'],
  'eff.edhn55.rollDie.twoSixSided': ["Pair o' Dice Lost"],
  'eff.edhn55.rollDie.threeSixSided': ['Circuits Act'],
  'eff.edhn55.return.anyNumber.totalMv.fromGraveyard.hand': ["Pair o' Dice Lost"],
  'eff.edhn55.return.choose.bf.counters.equalTo': ['Grave Endeavor'],
  'eff.edhn55.search.numberEqualTo.bf.tapped': ['Wild Endeavor'],
  'eff.edhn55.has.baseToughness.dur': ['Six-Sided Die'],
  'eff.edhn55.rollDie.d12': ['Sword of Hours'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card with the example as its ability: a static or an activated ability on an artifact creature, a spell otherwise. */
const parsedWith = (t: Template, text: string) => parseCard(
  t.kind === 'static' || text.includes(':') || /^(When|Whenever|At the beginning)/.test(text) || (text.startsWith('~') && !text.includes('as you cast ~')) ? card('Example Relic', 'Artifact Creature — Construct', text, { power: '2', toughness: '2' }) : card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;

describe('edh-next-55 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-55.json, path order: after edh-next-5.json, before edh-next-6.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-55.json');
    expect(files.indexOf('zz-cloud/edh-next-55.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-5.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are *.edhn55.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|trg|rst|ch|rid|cm)\.edhn55\./);
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

describe('edh-next-55 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-next-55 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-55 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-next-55 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-55 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


describe('edh-next-55 renderer, lowering, parser and engine changes (one test each)', () => {
  const creature = (text: string, type = 'Creature — Wizard') => parseCard(card('Example Beast', type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  const spell = (text: string) => parseCard(card('Example Plan', 'Sorcery', text), OPTS).faces[0]!;
  it('lower/die-roll.ts, render/edhn55.ts (CR 706.3a, 111.1): "Create N of those tokens." in a result row copies the token step of an earlier row (any later row, any number); with no earlier row that makes tokens, or another noun, the card is not automated', () => {
    expect(fullyAutomated(spell('Roll a d12.\n1-3 | Create a 3/1 green Gnome creature token.\n4-9 | Create two of those tokens.\n10-12 | Create three of those tokens.'))).toBe(true);
    expect(fullyAutomated(spell('Roll a d12.\n1-6 | Create a 3/1 green Gnome creature token.\n7-12 | Create two of those tokens tapped.'))).toBe(false);
    expect(fullyAutomated(spell('Roll a d12.\n1-6 | Gain 2 life.\n7-12 | Create two of those tokens.'))).toBe(false);
    expect(fullyAutomated(spell('Roll a d12.\n1-6 | Create two of those tokens.\n7-12 | Create a 3/1 green Gnome creature token.'))).toBe(false); // a row names the tokens of a row BEFORE it only
  });
  it('front/shapes.ts#dicePrefix (CR 706.2; Six-Sided Die): a result row of one result may start with a dash for the bar after a roll; the same line after anything else is not a row', () => {
    expect(fullyAutomated(spell('Roll a six-sided die.\n1 — Gain 2 life.\n2 — Draw a card.\n3 — Gain 4 life.\n4 — Gain 6 life.\n5 — Gain 8 life.\n6 — Draw two cards.'))).toBe(true);
    // edh-next-137 (CR 706.3a; Comet, Stellar Pup): two consecutive results in one dash row are read now; two results that are not consecutive are not
    expect(fullyAutomated(spell('Roll a six-sided die.\n1 or 3 — Gain 2 life.\n2 — Draw a card.\n4 — Gain 4 life.\n5 — Gain 6 life.\n6 — Draw two cards.'))).toBe(false);
    expect(fullyAutomated(spell('Draw a card.\n1 — Gain 2 life.\n2 — Draw a card.'))).toBe(false); // no roll above
  });
  it('model/lint-nodes.ts (CR 706.2): a last row "20+" of a d20 with no modifier is the 20; "21+" (a result no die shows) and an open row that is not last are refused', () => {
    expect(fullyAutomated(spell('Roll a d20.\n1-9 | Gain 2 life.\n10-19 | Gain 4 life.\n20+ | Gain 6 life.'))).toBe(true);
    expect(fullyAutomated(spell('Roll a d20.\n1-9 | Gain 2 life.\n10-20 | Gain 4 life.\n21+ | Gain 6 life.'))).toBe(false);
    expect(fullyAutomated(spell('Roll a d20.\n1-9 | Gain 2 life.\n10+ | Gain 4 life.\n20 | Gain 6 life.'))).toBe(false);
  });
  it('render/edhn55.ts (CR 706.3a): the first row is also "9 or less"; another row cannot be said "or less"', () => {
    expect(fullyAutomated(spell('Roll a d20.\n9 or less | Gain 2 life.\n10-20 | Gain 4 life.'))).toBe(true);
    expect(fullyAutomated(spell('Roll a d20.\n1-9 | Gain 2 life.\n19 or less | Gain 4 life.'))).toBe(false);
  });
  it('parser/holes/edhn55.ts, holes/event.ts, render/evt.ts, render/cond.ts (CR 706.2, 603.2c, 608.2h): "Whenever you roll a 3 or higher" and "If the roll was 4 or higher" / "If you rolled 6 or higher"; an opponent\'s roll, a 0 and "or lower" are other readings', () => {
    expect(fullyAutomated(creature('Whenever you roll a 3 or higher, draw a card. If the roll was 5 or higher, gain 2 life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you roll a 4 or higher, draw a card. If you rolled 6 or higher, gain 2 life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you roll a 2 or lower, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever an opponent rolls a 3 or higher, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you roll a 0 or higher, draw a card.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever you roll a 3 or higher, draw a card. If the roll was 5 or lower, gain 2 life.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever you roll a 3 or higher, draw a card. If the roll was 5 or better, gain 2 life.'))).toBe(false);
  });
  it('parser/holes/qty.ts, render/qty.ts, effects/eval.ts (CR 706.2, 608.2h): "for each different result", "the total of those results" and "the damage dealt" are read only where a roll or a damage event gives them a number', () => {
    expect(fullyAutomated(spell('Roll four six-sided dice. For each different result, create a 1/1 white Clown Robot artifact creature token.'))).toBe(false); // four dice: no template (fail closed)
    expect(fullyAutomated(spell('Roll three six-sided dice. For each different result, create a 1/1 white Clown Robot artifact creature token.'))).toBe(true);
    expect(fullyAutomated(spell('Roll three six-sided dice. For each different land, create a 1/1 white Clown Robot artifact creature token.'))).toBe(false);
    expect(fullyAutomated(spell('Roll two six-sided dice. Return any number of cards with total mana value X or less from your graveyard to your hand, where X is the total of those results.'))).toBe(true);
    expect(fullyAutomated(spell('Roll two six-sided dice. Return any number of cards with total mana value X or less from your graveyard to your hand, where X is the total of those cards.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever this creature deals combat damage, roll a d12. If the result is greater than the damage dealt, draw a card.'))).toBe(true);
    expect(fullyAutomated(creature('Whenever this creature attacks, roll a d12. If the result is greater than the damage dealt, draw a card.'))).toBe(false); // an attack deals no damage
  });
  it('parser/holes/core.ts (CR 608.2h): "equal to or less than" and "equal to or greater than" compare as "less than or equal to" and "greater than or equal to"', () => {
    expect(fullyAutomated(spell('Roll a six-sided die. If the result is equal to or less than the number of lands you control, draw a card.'))).toBe(true);
    expect(fullyAutomated(spell('Roll a six-sided die. If the result is equal to or greater than the number of lands you control, draw a card.'))).toBe(true);
    expect(fullyAutomated(spell('Roll a six-sided die. If the result is equal to or more than the number of lands you control, draw a card.'))).toBe(false);
  });
  it('triggers/match.ts, triggers/history.ts, rules/history.ts, render/evt.ts (CR 706.2, 603.2c): "a die\'s highest natural result" is a roll whose natural result is the most the die shows; no other wording of it is read', () => {
    expect(fullyAutomated(creature("Whenever you roll a die's highest natural result, draw a card."))).toBe(true);
    expect(fullyAutomated(creature("Whenever an opponent rolls a die's highest natural result, draw a card."))).toBe(true);
    expect(fullyAutomated(creature("Whenever you roll a die's lowest natural result, draw a card."))).toBe(false);
    expect(fullyAutomated(creature("Whenever you roll a die's highest result, draw a card."))).toBe(false);
  });
  it('render/fold.ts, render/steps-util.ts, render/steps-cards.ts, render/stat.ts (CR 202.3, 122.6, 701.23b, 614.1c): the die-result limit with "where X is", counters "a number of ... equal to that result", a search "a number of ... equal to the other result" and "until your next turn ... enter tapped"', () => {
    expect(fullyAutomated(spell('Roll two d10 and choose one result. Return a creature card from your graveyard to the battlefield with a number of +1/+1 counters on it equal to that result.'))).toBe(true);
    expect(fullyAutomated(spell('Roll two d10 and choose one result. Return a creature card from your graveyard to your hand with a number of +1/+1 counters on it equal to that result.'))).toBe(false);
    expect(fullyAutomated(spell('Roll two d4 and choose one result. Search your library for a number of basic land cards equal to the other result, put them onto the battlefield tapped, then shuffle.'))).toBe(true);
    expect(fullyAutomated(spell('Roll two d4 and choose one result. Search your library for a number of basic land cards equal to the other result, put them into your hand, then shuffle.'))).toBe(false);
    expect(fullyAutomated(spell('Until your next turn, creatures your opponents control enter tapped.'))).toBe(true);
    expect(fullyAutomated(spell('Until your next turn, creatures your opponents control enter tapped and attacking.'))).toBe(false);
  });
});
