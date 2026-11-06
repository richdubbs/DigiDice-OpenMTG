/**
 * edh-zones-8 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-8.json and the round's other changes: the zones a group `may` searched
 * (effects/run.ts, effects/handlers/control.ts, `StepResult.searched`), "each player who searched a library this way shuffles" (`shuffle.ifSearched` for a group, render/steps-cards.ts),
 * "For each opponent who searches a library this way" (render/steps-flow.ts#repeat), the pair of moves "all F cards from among them onto the battlefield (tapped) and the rest on the bottom"
 * (render/fold.ts#putAllFromGroupAndRest) and the fold render/fold-edhzones8.ts. Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in
 * edh-zones-8-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones8 from '../../../src/parser/templates/zz-cloud/edh-zones-8.json';
import review from '../../m5/golden/cards/edh-zones-8-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ8 = edhZones8 as Template[];
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
  'eff.edhz8.eachOpponentMay.search.bf', 'eff.edhz8.forEachOpponentWhoSearches.searchBf', 'eff.edhz8.eachPlayerWhoSearched.shuffles', 'eff.edhz8.dig.putAll.bf.tapped.rest.bottomRandom',
  'eff.edhz8.ifCond.untap.thoseLandsPut', 'eff.edhz8.put.bf.thenShuffleRestIntoLibrary', 'eff.edhz8.dig.putAll.mvAtMost.bf.rest.bottomRandom', 'eff.edhz8.shuffle.graveyardAndHandInto.you',
  'eff.edhz8.dig.anyNumber.bf.rest.hand',
];

describe('edh-zones-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-8.json, after zz-cloud/edh-zones-2.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-8.json');
    expect(files.indexOf('zz-cloud/edh-zones-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-2.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-8.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ8.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ8) {
      expect(t.id, t.id).toMatch(/^eff\.edhz8\./);
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
    // narrow wordings (a handful of cards of the index print them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz8.eachOpponentMay.search.bf')).toEqual(['Tempt with Discovery']);
    expect(goldenUsing('eff.edhz8.forEachOpponentWhoSearches.searchBf')).toEqual(['Tempt with Discovery']);
    expect(goldenUsing('eff.edhz8.eachPlayerWhoSearched.shuffles')).toEqual(['Tempt with Discovery']);
    expect(goldenUsing('eff.edhz8.dig.putAll.bf.tapped.rest.bottomRandom')).toEqual(["Animist's Awakening"]);
    expect(goldenUsing('eff.edhz8.ifCond.untap.thoseLandsPut')).toEqual(["Animist's Awakening"]);
    expect(goldenUsing('eff.edhz8.put.bf.thenShuffleRestIntoLibrary')).toEqual(['Kindred Summons']);
    expect(goldenUsing('eff.edhz8.dig.putAll.mvAtMost.bf.rest.bottomRandom')).toEqual(['Muxus, Goblin Grandee']);
    expect(goldenUsing('eff.edhz8.shuffle.graveyardAndHandInto.you')).toEqual(['Trenzalore Clocktower']);
    expect(goldenUsing('eff.edhz8.dig.anyNumber.bf.rest.hand')).toEqual(['Genesis Ultimatum']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ8) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ8) {
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
    [/\bonto the battlefield\b/, 'into their hand'], [/\bthe bottom\b/, 'the top'], [/\binto your hand\b/, 'into your graveyard'], [/\bEach opponent\b/, 'Each player'],
    [/\brandom order\b/, 'any order'], [/\bshuffles\b/, 'draws a card'], [/\bgraveyard and hand\b/, 'graveyard and library'], [/\buntap\b/, 'tap'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ8) {
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

describe('edh-zones-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ8) {
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


describe('edh-zones-8 searches of a group (effects/run.ts#runSteps, effects/handlers/control.ts#mayHandler; render/steps-cards.ts#shuffle, render/steps-flow.ts#repeat; CR 701.23a, 701.24a, 608.2d)', () => {
  const offer = 'Search your library for a land card and put it onto the battlefield. Each opponent may search their library for a land card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.';
  it('the whole offer is full; the shuffle is one step with `ifSearched` for each player, the repeat counts the opponents who did', () => {
    expect(level('Sorcery', offer)).toBe('full');
    const j = json('Sorcery', offer);
    expect(j).toContain('"op":"shuffle","who":{"ref":"each","who":"player"},"ifSearched":true');
    expect(j).toContain('"op":"repeat","times":{"q":"resultCount","step":"did"}');
  });
  it('near misses: "who searches a library" without "this way", a group other than the opponents, and a different follow-up are not read', () => {
    expect(level('Sorcery', offer.replace('who searches a library this way', 'who searches a library'))).not.toBe('full');
    expect(level('Sorcery', offer.replace('For each opponent who searches', 'For each player who searches'))).not.toBe('full');
    expect(level('Sorcery', offer.replace('shuffles', 'draws a card'))).not.toBe('full');
    expect(level('Sorcery', offer.replace('each player who searched', 'each opponent who searched'))).not.toBe('full');
  });
});

describe('edh-zones-8 "put all F cards from among them ... and the rest ..." (render/fold.ts#putAllFromGroupAndRest; CR 701.20e, 401.4, 608.2c)', () => {
  const tapped = 'Reveal the top six cards of your library. Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.';
  it('tapped, untapped with a mana value, and into your hand (the old reading) are all read back; each destination keeps its own words', () => {
    expect(level('Sorcery', tapped)).toBe('full');
    expect(level('Sorcery', 'Reveal the top six cards of your library. Put all artifact cards with mana value 2 or less from among them onto the battlefield and the rest on the bottom of your library in a random order.')).toBe('full');
    expect(level('Sorcery', 'Reveal the top six cards of your library. Put all land cards from among them into your hand and the rest on the bottom of your library in a random order.')).toBe('full');
  });
  it('"untap those lands" is read only after the lands were put, and only those: after another group of cards it is not this reading', () => {
    expect(level('Sorcery', `${tapped} If you control a creature, untap those lands.`)).toBe('full');
    expect(json('Sorcery', `${tapped} If you control a creature, untap those lands.`)).toContain('"op":"untap","what":{"ref":"bound","name":"putOntoBattlefield"}');
    expect(level('Sorcery', 'Search your library for a land card, put it onto the battlefield tapped, then shuffle. If you control a creature, untap those lands.')).not.toBe('full');
  });
  it('near misses: a mana value "or greater", "any order" for the rest, and one card instead of all are not this reading', () => {
    expect(level('Sorcery', 'Reveal the top six cards of your library. Put all artifact cards with mana value 2 or greater from among them onto the battlefield and the rest on the bottom of your library in a random order.')).not.toBe('full');
    expect(level('Sorcery', tapped.replace('a random order', 'any order')).length > 0).toBe(true); // "any order" is the other REST wording of the fold: a different JSON (order: chosen), never this template's
    expect(level('Sorcery', tapped.replace('all land cards', 'a land card'))).not.toBe('full');
  });
});

describe('edh-zones-8 "shuffle the rest of the revealed cards into your library" (render/fold-edhzones8.ts; CR 701.24a, 701.20a, 608.2c)', () => {
  const k = 'Reveal cards from the top of your library until you reveal two creature cards. Put those cards onto the battlefield, then shuffle the rest of the revealed cards into your library.';
  it('full; the rest is the revealed cards that are not the cards put', () => {
    expect(level('Sorcery', k)).toBe('full');
    expect(json('Sorcery', k)).toContain('"filter":{"is":{"ref":"bound","name":"revealed"},"not":{"is":{"ref":"bound","name":"hit"}},"zone":"library"}');
  });
  it('near misses: other destinations of the cards put, other places for the rest, and "the rest" of cards that were not revealed are not read', () => {
    expect(level('Sorcery', k.replace('onto the battlefield', 'into your hand'))).not.toBe('full');
    expect(level('Sorcery', k.replace('into your library', 'into your graveyard'))).not.toBe('full');
    expect(level('Sorcery', k.replace('the revealed cards', 'the looked-at cards'))).not.toBe('full');
  });
});

describe('edh-zones-8 "shuffle your graveyard and hand into your library" (render/steps-cards.ts#zoneSetPhrase; CR 701.24a, 402.1, 404.1)', () => {
  it('full; the zones are said in the order the filter lists them, hand and graveyard (r4-fxz) or graveyard and hand', () => {
    expect(level('Sorcery', 'Shuffle your graveyard and hand into your library, then draw seven cards.')).toBe('full');
    expect(level('Sorcery', 'Shuffle your hand and graveyard into your library, then draw seven cards.')).toBe('full');
    expect(level('Sorcery', 'Shuffle your graveyard and library into your library, then draw seven cards.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-8 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ8.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
