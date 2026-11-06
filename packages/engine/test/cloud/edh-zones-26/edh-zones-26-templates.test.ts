/**
 * edh-zones-26 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-26.json and the round's other changes: the second target of a "choose" sentence read
 * against the controller of the first (TargetPhrase.ownerOfEarlierController, parser/lower/targets.ts), Goblin Welder's simultaneous sacrifice and return (lower/choose.ts#lowerSacrificeReturnPair,
 * `exchange` of kind sacrificeReturn), a list of three card descriptions in a search (holes/r4dig.ts#searchDesc), the snow mana spent to cast a spell (`{q:'snowSpent'}`), "with a different name than"
 * (holes/filter.ts), "the exiled cards" of an exile-until (holes/object.ts#rest), a number chosen at random (chooseValue `random`), "they may" (render/steps-util.ts#modal) and the order of the
 * exile-until clause (render/steps-cards.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in edh-zones-26-scenarios.test.ts. CR cites
 * checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones26 from '../../../src/parser/templates/zz-cloud/edh-zones-26.json';
import review from '../../m5/golden/cards/edh-zones-26-review.json';
import r3cost from '../../m5/golden/cards/cloud-r3-cost-review.json'; // Dance with Calamity's entry (its earlier pending entry, completed by this round)
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ26 = edhZones26 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const IDS = [
  'eff.edhz26.choose.permanentAndCardOfItsController',
  'eff.edhz26.thatPlayer.sacrificeAndReturnTogether',
  'eff.edhz26.dig.rest.thatLibraryBottom',
  'eff.edhz26.put.fromTheirGraveyard.tapped',
  'eff.edhz26.they.mayCast.obj.free',
  'eff.edhz26.choose.numberAtRandom.oneTwoThree',
  'eff.edhz26.player.mill.thatMany.thenExileUntil',
  'eff.edhz26.manifest.top.player',
  'eff.edhz26.asManyTimes.mayExileTop',
];
/** The type line an example is printed on. */
const typeOf = (text: string): string => (/^\{T\}:/.test(text) ? 'Artifact' : /^(Whenever|When) ~/.test(text) ? 'Creature — Ninja' : /^When this creature/.test(text) ? 'Creature — Bear' : /^At the beginning/.test(text) ? 'Enchantment' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, { ...(typeLine.includes('Creature') ? { power: '2', toughness: '2' } : {}) }), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic', extra: Record<string, unknown> = {}) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

describe('edh-zones-26 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-26.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-26.json');
    expect(files.indexOf('zz-cloud/edh-zones-26.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-24.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-26.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ26.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ26) {
      expect(t.id, t.id).toMatch(/^eff\.edhz26\./);
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
    // narrow wordings (one or two cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    for (const id of ['eff.edhz26.choose.permanentAndCardOfItsController', 'eff.edhz26.thatPlayer.sacrificeAndReturnTogether']) expect(goldenUsing(id)).toEqual(['Goblin Welder']);
    expect(goldenUsing('eff.edhz26.dig.rest.thatLibraryBottom')).toEqual(['Siphon Insight']);
    expect(goldenUsing('eff.edhz26.put.fromTheirGraveyard.tapped')).toEqual(['Realmbreaker, the Invasion Tree']);
    for (const id of ['eff.edhz26.they.mayCast.obj.free', 'eff.edhz26.choose.numberAtRandom.oneTwoThree', 'eff.edhz26.player.mill.thatMany.thenExileUntil']) expect(goldenUsing(id)).toEqual(["Tibalt's Trickery"]);
    expect(goldenUsing('eff.edhz26.manifest.top.player')).toEqual(['Orochi Soul-Reaver']);
    expect(goldenUsing('eff.edhz26.asManyTimes.mayExileTop', r3cost as Golden)).toEqual(['Dance with Calamity']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ26) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-26 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ26) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = face(t.examples[0]!.text, typeOf(t.examples[0]!.text));
      for (const e of t.examples) {
        const f = face(e.text, typeOf(e.text));
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
    [/\bbottom\b/, 'top'], [/\bthe other\b/, 'a card'], [/\bmay\b/, 'must'], [/\bat random\b/, 'of your choice'], [/\btapped\b/, 'untapped'], [/\bgraveyard\b/, 'hand'], [/\bface down\b/, 'face up'],
    [/\bmills\b/, 'draws'], [/\bsacrifices\b/, 'destroys'], [/\bmanifest\b/, 'exile'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-26 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ26) {
    it(`${t.id}: an appended condition, or a swapped key word, never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = face(e.text, typeOf(e.text));
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = face(m, typeOf(e.text));
          expect(understood(f) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('edh-zones-26 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ26) {
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
    }, 600_000); // one parse per word of every example
  }
});

describe('edh-zones-26 a search for one card of any of three descriptions (parser/holes/r4dig.ts#searchDesc; CR 701.23a, 608.2c)', () => {
  const tail = ', reveal it, put it into your hand, then shuffle.';
  it('"a X card, a Y card, or a Z card" is one search whose filter is any of the three', () => {
    const text = `Search your library for a creature card, a Cave card, or a Dragon card${tail}`;
    expect(level('Sorcery', text)).toBe('full');
    const j = json('Sorcery', text);
    expect(j).toContain('"anyOf":[{"types":["Creature"]},{"subtypes":["Cave"]},{"subtypes":["Dragon"]}]');
    expect(j).toContain('"max":1');
  });
  it('a bare supertype is a description with the word card: "a legendary card" in the list', () => {
    expect(level('Sorcery', `Search your library for a Cave card, a legendary card, or a Saga card${tail}`)).toBe('full');
  });
  it('near misses: "and", four descriptions, a missing "or" are not this reading', () => {
    expect(level('Sorcery', `Search your library for a creature card, a Cave card, and a Dragon card${tail}`)).not.toBe('full');
    expect(level('Sorcery', 'Search your library for a creature card, a Cave card, a Dragon card, or a land card, reveal it, put it into your hand, then shuffle.')).not.toBe('full');
  });
});

describe('edh-zones-26 the snow mana spent to cast a spell (ObjRef-free quantity {q:\'snowSpent\'}; CR 107.4h, 601.2h, 707.10)', () => {
  it('"for each {S} spent to cast this spell" and "the amount of {S} spent to cast this spell" are the snow mana spent on the spell itself', () => {
    expect(level('Snow Sorcery', 'You gain 1 life for each {S} spent to cast this spell.')).toBe('full');
    expect(json('Snow Sorcery', 'You gain 1 life for each {S} spent to cast this spell.')).toContain('"q":"snowSpent"');
    expect(level('Snow Sorcery', 'Scry X, where X is the amount of {S} spent to cast this spell, then draw three cards.')).toBe('full');
  });
  it('near misses: the mana spent in general, another spell and a colored symbol are not this quantity', () => {
    expect(json('Snow Sorcery', 'You gain 1 life for each {S} spent to cast this spell.')).not.toContain('"q":"manaSpent"');
    expect(level('Snow Sorcery', 'You gain 1 life for each {S} spent to cast that spell.')).not.toBe('full');
    expect(level('Snow Sorcery', 'You gain 1 life for each {G} spent to cast this spell.')).not.toBe('full');
  });
});

describe('edh-zones-26 "a nonland card with a different name than that spell" (parser/holes/filter.ts, render/np.ts; CR 201.2)', () => {
  const text = 'Counter target spell. Its controller exiles cards from the top of their library until they exile a nonland card with a different name than that spell.';
  it('is a card that shares no name with the countered spell', () => {
    expect(level('Instant', text)).toBe('full');
    expect(json('Instant', text)).toContain('"not":{"sharesWith":{"with":{"ref":"target","id":"t0"},"quality":"name"}}');
  });
  it('near misses: the same name, another word for the spell and a color are not this reading', () => {
    expect(json('Instant', text.replace('a different name than', 'the same name as'))).not.toContain('"not":{"sharesWith"');
    expect(level('Instant', text.replace('that spell', 'that creature'))).not.toBe('full');
    expect(level('Instant', text.replace('a different name', 'a different color'))).not.toBe('full');
  });
});

describe('edh-zones-26 "they" for the controller of a countered spell and "the exiled cards" (parser/lower/mentions.ts#controllerSubject, anaphora.ts, holes/object.ts#rest; CR 608.2c, 406.1)', () => {
  const full = 'Counter target spell. Its controller exiles cards from the top of their library until they exile a nonland card. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.';
  it('"They" and "that card" are the controller of the spell and the card the exile stopped at; "the exiled cards" are the others', () => {
    expect(level('Instant', full)).toBe('full');
    const j = json('Instant', full);
    expect(j).toContain('"op":"cast","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
    expect(j).toContain('"free":true,"optional":true');
  });
  it('near misses: no exile before it and an unnamed card leave the sentences manual', () => {
    expect(level('Instant', 'Counter target spell. They may cast that card without paying its mana cost.')).not.toBe('full');
    expect(level('Instant', full.replace('that card', 'a card'))).not.toBe('full');
  });
});

describe('edh-zones-26 a number chosen at random (chooseValue random, effects/handlers/choose.ts; CR 608.2d)', () => {
  it('"Choose 1, 2, or 3 at random." is a choice of a whole number from 1 to 3 that nobody makes', () => {
    const j = json('Sorcery', 'Choose 1, 2, or 3 at random. Target player mills that many cards, then exiles cards from the top of their library until they exile a land card.');
    expect(j).toContain('"op":"chooseValue","who":{"ref":"you"},"what":"number","min":1,"max":3,"random":true');
  });
  it('"that many" with no number chosen earlier is not this reading: the sentence stays manual (CR 608.2c)', () => {
    expect(level('Sorcery', 'Target player loses 3 life. That player mills that many cards, then exiles cards from the top of their library until they exile a nonland card.')).not.toBe('full');
  });
  it('near misses: other numbers, no "at random" and a range of two are not this reading', () => {
    for (const t of ['Choose 1, 2, or 4 at random.', 'Choose 1, 2, or 3.', 'Choose 1 or 2 at random.']) {
      expect(json('Sorcery', `${t} Target player mills that many cards, then exiles cards from the top of their library until they exile a land card.`)).not.toContain('"random":true');
    }
  });
});

describe('edh-zones-26 "as many times as you choose, you may exile the top card" (optional repeat with gather; CR 608.2c, 406.1)', () => {
  it('gathers the exiled cards for "the cards exiled this way" and "the total mana value of the cards exiled this way"', () => {
    const j = json('Sorcery', 'As many times as you choose, you may exile the top card of your library. You gain life equal to the total mana value of the cards exiled this way.');
    expect(j).toContain('"op":"repeat"');
    expect(j).toContain('"optional":true');
    expect(j).toContain('"gather"');
  });
  it('a mandatory exile, or the graveyard, is not this reading', () => {
    for (const t of ['Exile the top card of your library.', 'As many times as you choose, you may exile the top card of your graveyard.']) {
      expect(json('Sorcery', `${t} You gain life equal to the total mana value of the cards exiled this way.`)).not.toContain('"optional":true');
    }
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-26 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-26 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ26.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
