/**
 * edh-zones-4 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-4.json and the round's other changes: the card description "X card or
 * Y card" with qualifiers in a search (parser/holes/r4dig.ts#searchDesc) and in a target (parser/holes/object.ts), the cards put into exile from your library and/or graveyard
 * (parser/holes/event.ts, render/evt.ts), the renderer folds and alternatives (render/fold-edhzones4.ts, fold.ts, np.ts) and the choice of cards with different names
 * (`chooseObjects.distinct: 'name'`, effects/handlers/choose.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in
 * edh-zones-4-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones4 from '../../../src/parser/templates/zz-cloud/edh-zones-4.json';
import review from '../../m5/golden/cards/edh-zones-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ4 = edhZones4 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At the beginning|this creature|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = [
  'eff.edhz4.player.searches.anyCard.top', 'eff.edhz4.mill.thenReturn.one.milledThisWay.hand', 'eff.edhz4.choose.twoTargetPlayers', 'eff.edhz4.eachOfThem.searches.anyCard.top',
  'eff.edhz4.player.putsHandBottom.anyOrder.drawsThatMany', 'eff.edhz4.dig.rest.thatLibraryBottomRandom', 'eff.edhz4.search.opponentLibrary.exileFaceDown',
  'eff.edhz4.search.anyCards.differentNames.reveal', 'eff.edhz4.search.exactCards.reveal', 'eff.edhz4.targetOpponent.chooses.nOfFound', 'eff.edhz4.targetOpponent.chooses.oneFound',
  'eff.edhz4.putChosen.graveyard.restHand', 'eff.edhz4.return.anyNumber.differentNames.graveyard.battlefield',
];

describe('edh-zones-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-4.json, after zz-cloud/edh-zones-2.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-4.json');
    expect(files.indexOf('zz-cloud/edh-zones-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-2.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-4.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ4.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ4) {
      expect(t.id, t.id).toMatch(/^eff\.edhz4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    // narrow wordings (one card of the index prints them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz4.player.searches.anyCard.top')).toEqual(['Varragoth, Bloodsky Sire']);
    expect(goldenUsing('eff.edhz4.mill.thenReturn.one.milledThisWay.hand')).toEqual(['Monster Manual // Zoological Study']);
    expect(goldenUsing('eff.edhz4.choose.twoTargetPlayers')).toEqual(['Scheming Symmetry']);
    expect(goldenUsing('eff.edhz4.eachOfThem.searches.anyCard.top')).toEqual(['Scheming Symmetry']);
    expect(goldenUsing('eff.edhz4.player.putsHandBottom.anyOrder.drawsThatMany')).toEqual(["Teferi's Puzzle Box"]);
    expect(goldenUsing('eff.edhz4.dig.rest.thatLibraryBottomRandom')).toEqual(['Gonti, Lord of Luxury']);
    expect(goldenUsing('eff.edhz4.search.opponentLibrary.exileFaceDown')).toEqual(["Praetor's Grasp"]);
    expect(goldenUsing('eff.edhz4.search.anyCards.differentNames.reveal')).toEqual(['Gifts Ungiven']);
    expect(goldenUsing('eff.edhz4.targetOpponent.chooses.nOfFound')).toEqual(['Gifts Ungiven']);
    expect(goldenUsing('eff.edhz4.putChosen.graveyard.restHand')).toEqual(['Gifts Ungiven']);
    expect(goldenUsing('eff.edhz4.search.exactCards.reveal')).toEqual(['Intuition']);
    expect(goldenUsing('eff.edhz4.targetOpponent.chooses.oneFound')).toEqual(['Intuition']);
    // edh-fix-3: "Put that card into your hand and the rest into your graveyard" is p2-zone-moves-2's eff.p2zm2.putThat.hand.rest.graveyard (same pattern and build; the duplicate was removed)
    expect(goldenUsing('eff.edhz4.return.anyNumber.differentNames.graveyard.battlefield')).toEqual(['Eerie Ultimatum']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ4) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = face(e.text);
        expect(f.templatesUsed, e.text).toContain(t.id);
        expect(understood(f), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)} ${JSON.stringify(f.gate)}`).toBe(true);
        expect(fullyAutomated(f), e.text).toBe(true);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = face(c, typeOf(t.examples[0]!.text));
        expect(understood(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} twice.`];
  const swaps: [RegExp, string][] = [
    [/\bonto the battlefield\b/, 'into their hand'], [/\bon top\b/, 'on the bottom'], [/\binto your hand\b/, 'into your graveyard'], [/\bthe bottom\b/, 'the top'], [/\bface down\b/, 'face up'],
    [/\bany order\b/, 'a random order'], [/\bdifferent names\b/, 'different powers'], [/\bTarget opponent\b/, 'Each opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ4) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ4) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    }, 120_000); // one parse per word of every example: over the default 5 s on the combined copy
  }
});

describe('edh-zones-4 search description "an X card with a qualifier or a Y card" (parser/holes/r4dig.ts#searchDesc; CR 701.23a, 608.2c, 605.1a)', () => {
  const key = 'Search your library for an artifact card with a mana ability or a basic land card, reveal it, put it into your hand, then shuffle.';
  it('each half is a whole card description with its own qualifier: full, the filter has both halves', () => {
    expect(level('Sorcery', key)).toBe('full');
    expect(json('Sorcery', key)).toContain('"anyOf":[{"types":["Artifact"],"hasAbility":"mana"},{"supertypes":["Basic"],"types":["Land"]}]');
    expect(level('Sorcery', 'Search your library for a basic land card or an artifact card with a mana ability, reveal it, put it into your hand, then shuffle.')).toBe('full');
  });
  it('the sentences the whole-sentence templates read (a keyword or a mana value in a half) keep their readings: still full, one reading each', () => {
    const k = 'Search your library for an instant card or a card with flash, reveal it, put it into your hand, then shuffle.';
    expect(level('Sorcery', k)).toBe('full');
    expect(face(k, 'Sorcery').templatesUsed).toContain('eff.t31.search.orCardWithKeyword.reveal.hand');
    const m = 'Search your library for a basic Plains card or a creature card with mana value 1 or less, reveal it, put it into your hand, then shuffle.';
    expect(level('Sorcery', m)).toBe('full');
    expect(face(m, 'Sorcery').templatesUsed).toContain('eff.t31.search.orMvAtMost.reveal.hand');
  });
  it('near misses: "and" for "or", a missing "card", and a zone other than the library are not read', () => {
    expect(level('Sorcery', 'Search your library for an artifact card with a mana ability and a basic land card, reveal it, put it into your hand, then shuffle.')).not.toBe('full');
    expect(level('Sorcery', 'Search your graveyard for an artifact card with a mana ability or a basic land card, reveal it, put it into your hand, then shuffle.')).not.toBe('full');
  });
});

describe('edh-zones-4 target "X card or Y card from your graveyard" (parser/holes/object.ts, render/np.ts; CR 115.1, 400.1, 608.2b)', () => {
  const dragon = 'Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.';
  it('one target, a card of either description in your graveyard: full; the zone and the owner are the filter\'s, each half keeps its own words', () => {
    expect(level('Sorcery', dragon)).toBe('full');
    expect(json('Sorcery', dragon)).toContain('"filter":{"zone":"graveyard","owner":"you","anyOf":[{"types":["Creature"],"subtypes":["Dragon"],"isCard":true},{"types":["Planeswalker"],"subtypes":["Ugin"],"isCard":true}]}');
    expect(level('Sorcery', 'Return target creature card or planeswalker card from your graveyard to your hand.')).toBe('full');
  });
  it('near misses: the battlefield, and different zones for the halves, are not this reading', () => {
    expect(level('Sorcery', 'Return target creature card or planeswalker card from the battlefield to your hand.')).not.toBe('full');
    expect(level('Sorcery', 'Return target Dragon creature card and Ugin planeswalker card from your graveyard to your hand.')).not.toBe('full');
  });
});

describe('edh-zones-4 cards put into exile from your library and/or graveyard (parser/holes/event.ts, render/evt.ts; CR 603.2c, 400.3, 406.3)', () => {
  const w = (zones: string): string => `Whenever one or more cards are put into exile from ${zones}, put a +1/+1 counter on this creature.`;
  it('your library, your graveyard, or both (and/or, or): an automated trigger on the owner\'s cards, one occurrence for a batch', () => {
    for (const z of ['your library', 'your graveyard', 'your library and/or your graveyard', 'your library or your graveyard']) expect(level('Creature — Spirit', w(z)), z).toBe('full');
    expect(json('Creature — Spirit', w('your library and/or your graveyard'))).toContain('"from":["library","graveyard"],"to":"exile"}],"batch":true');
    expect(level('Creature — Spirit', 'Whenever a card is put into exile from your graveyard, put a +1/+1 counter on this creature.')).toBe('full');
  });
  it('near misses: another player\'s zones, a hand, or "a graveyard" are not this reading', () => {
    for (const z of ['an opponent\'s library', 'a graveyard', 'your hand', 'your library and your graveyard']) expect(level('Creature — Spirit', w(z)), z).not.toBe('full');
  });
});

describe('edh-zones-4 chooseObjects.distinct "name" (effects/handlers/choose.ts, render/fold-edhzones4.ts#returnAnyDifferentNames; CR 201.2, 608.2d)', () => {
  it('the step has distinct names and the renderer reads it back; "different powers" is the other statistic', () => {
    expect(json('Sorcery', 'Return any number of creature cards with different names from your graveyard to the battlefield.')).toContain('"distinct":"name"');
    expect(level('Sorcery', 'Return any number of creature cards with different names from your graveyard to the battlefield.')).toBe('full');
    expect(level('Sorcery', 'Return any number of creature cards with different powers from your graveyard to the battlefield.')).not.toBe('full');
    expect(level('Sorcery', 'Return any number of creature cards with different names from an opponent\'s graveyard to the battlefield.')).not.toBe('full');
  });
});

describe('edh-zones-4 renderer alternatives (render/fold.ts, render/np.ts; one new equivalence family, mill-return-milled-this-way)', () => {
  it('the choice of exactly one milled card is also "return a creature card milled this way to your hand" / "put ... from among them"', () => {
    expect(level('Sorcery', 'Mill three cards, then return a creature card milled this way to your hand.')).toBe('full');
    expect(level('Sorcery', 'Mill three cards, then put a creature card from among them into your hand.')).toBe('full');
    expect(level('Sorcery', 'Mill three cards, then return each creature card milled this way to your hand.')).not.toBe('full');
  });
  it('"put the rest on the bottom of that library" names the library looked at; "put the rest on top of that library" is not read', () => {
    const base = "Look at the top three cards of target opponent's library, exile one of them face down, then put the rest on";
    expect(level('Sorcery', `${base} the bottom of that library in a random order.`)).toBe('full');
    expect(level('Sorcery', `${base} top of that library in a random order.`)).not.toBe('full');
  });
  it('the chosen cards and the rest, then "Then shuffle." as a sentence of its own (and joined by a comma) read the same steps', () => {
    const a = 'Search your library for two cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.';
    expect(level('Instant', a)).toBe('full');
    const b = 'Search your library for up to three artifact cards with different names and reveal them. An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped, then shuffle.';
    expect(level('Instant', b)).toBe('full'); // r5-dig's own wording, unchanged
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|Equipment|spell|card|Saga)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = EZ4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
