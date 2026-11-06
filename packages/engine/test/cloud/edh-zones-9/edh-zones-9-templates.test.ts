/**
 * edh-zones-9 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-9.json and the round's other changes: the antecedent "both cards"
 * (parser/holes/object.ts, lower/anaphora.ts, render/refs.ts), "a basic land card or Gate card" (parser/holes/r4dig.ts, render/steps-cards.ts), "and/or" in a search of two
 * descriptions, a card name that ends with "!" or "?" and closes its line (parser/front/selfref.ts), the folds of render/fold-edhzones9.ts. Guard G9 and G2 as the earlier rounds
 * run them; examples are synthetic (design 6.10). The behavior is in edh-zones-9-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones9 from '../../../src/parser/templates/zz-cloud/edh-zones-9.json';
import review from '../../m5/golden/cards/edh-zones-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ9 = edhZones9 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|^At the beginning|this creature|^\{/m.test(text) ? 'Creature — Beast' : /^Counter target/.test(text) ? 'Instant' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = [
  'eff.edhz9.eachPlayer.putFromGraveyard.bf', 'eff.edhz9.discard.allCards.you', 'eff.edhz9.put.handCard.top', 'eff.edhz9.discard.unlessTheyCost', 'eff.edhz9.choose.randomInYourGraveyard',
  'eff.edhz9.search.oneOfEach.andOr', 'rid.edhz9.countered.hand', 'eff.edhz9.linked.returnAll.hand', 'eff.edhz9.linked.putAll.bf',
];

describe('edh-zones-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-9.json, after zz-cloud/edh-zones-6.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-9.json');
    expect(files.indexOf('zz-cloud/edh-zones-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-6.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-9.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ9.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ9) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.edhz9\./);
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
    // narrow wordings (one card of the index prints them as a whole line), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz9.eachPlayer.putFromGraveyard.bf')).toEqual(['Exhume']);
    expect(goldenUsing('eff.edhz9.discard.allCards.you')).toEqual(['Forgotten Creation']);
    expect(goldenUsing('eff.edhz9.put.handCard.top')).toEqual(['Enter the Infinite']);
    expect(goldenUsing('eff.edhz9.discard.unlessTheyCost')).toEqual(['Compulsive Research']);
    expect(goldenUsing('eff.edhz9.choose.randomInYourGraveyard')).toEqual(['Deadbridge Chant']);
    expect(goldenUsing('eff.edhz9.search.oneOfEach.andOr')).toEqual(['Axgard Armory']);
    expect(goldenUsing('rid.edhz9.countered.hand')).toEqual(['Remand']);
    expect(goldenUsing('eff.edhz9.linked.returnAll.hand')).toEqual(['Bag of Holding']);
    expect(goldenUsing('eff.edhz9.linked.putAll.bf')).toEqual(['Gisa, Glorious Resurrector']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ9) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-9 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ9) {
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
    [/\bgraveyard\b/, 'library'], [/\bonto the battlefield\b/, 'into their hand'], [/\bto their owner's hand\b/, 'to your hand'], [/\bunless they\b/, 'if they'], [/\bat random\b/, 'at the top'],
    [/\bfrom their graveyard\b/, 'from their hand'], [/\bto your hand\b/, 'to your graveyard'], [/\ball\b/, 'a'], [/\bon top\b/, 'on the bottom'], [/\band\/or\b/, 'or'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ9) {
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

describe('edh-zones-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ9) {
    it(`${t.id}: replacing any one word of the template's sentence by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^\{/.test(w)) return; // a mana symbol is not a word
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any name (CR 122.1)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    }, 120_000); // one parse per word of every example: over the default 5 s on the combined copy
  }
});



describe('edh-zones-9 the antecedent "both cards" (parser/holes/object.ts, lower/anaphora.ts#resolveAnaphor, render/refs.ts; CR 608.2c)', () => {
  const swordLike = (second: string): string => `Exile up to one target creature you own, then search your library for a basic land card. ${second}`;
  const BOTH = 'Put both cards onto the battlefield under your control, then shuffle.';
  it('after an exile of a target and a search, "both cards" is the exiled card and the card found: the whole spell is full and reads back the same', () => {
    expect(level('Sorcery', swordLike(BOTH))).toBe('full');
    const j = json('Sorcery', swordLike(BOTH));
    expect(j).toContain('"ref":"union"');
    expect(j).toContain('"as":"moved"');
    expect(j).toContain('"as":"search"');
  });
  it('near misses: no earlier card, one earlier card, three earlier cards, another destination and the plural "those cards" are not this reading', () => {
    expect(level('Sorcery', BOTH), 'no antecedent').not.toBe('full');
    expect(level('Sorcery', `Search your library for a basic land card. ${BOTH}`), 'one earlier card').not.toBe('full');
    expect(level('Sorcery', `Exile up to one target creature you own, then search your library for a basic land card. Search your library for a Forest card. ${BOTH}`), 'two searches and an exile').not.toBe('full');
    expect(level('Sorcery', swordLike('Put both cards into your hand, then shuffle.')), 'into your hand is another sentence (still two cards: but a move to hand)').toBeDefined();
    expect(level('Sorcery', swordLike('Put all three cards onto the battlefield under your control, then shuffle.'))).not.toBe('full');
  });
  it('the union is the two references of the cards: the target as it was moved (a new object after the exile) and the search result (CR 400.7)', () => {
    const j = JSON.parse(json('Sorcery', swordLike(BOTH))) as { abilities: { effect: { steps: { op: string; what?: { ref: string; of?: { ref: string; name?: string }[] } }[] } }[] }[];
    const steps = j[0]!.abilities[0]!.effect.steps;
    const union = steps.find((s) => s.what?.ref === 'union')!;
    expect(union.what!.of!.map((r) => `${r.ref}:${r.name}`)).toEqual(['bound:moved', 'bound:search']);
  });
});

describe('edh-zones-9 "a basic land card or Gate card" with the article said once (parser/holes/r4dig.ts#searchDesc, render/steps-cards.ts; CR 701.23a)', () => {
  const s = (what: string): string => `Search your library for ${what}, reveal it, put it into your hand, then shuffle.`;
  it('the article before the first description only: a basic land card or a Goblin card, a Forest card or Swamp card', () => {
    for (const w of ['a basic land card or Gate card', 'a Forest card or Swamp card', 'an artifact card or enchantment card']) expect(level('Sorcery', s(w)), w).toBe('full');
    expect(json('Sorcery', s('a basic land card or Gate card'))).toContain('"anyOf":[{"supertypes":["Basic"],"types":["Land"]},{"subtypes":["Gate"]}]');
  });
  it('the reading with the article twice is the same JSON', () => {
    expect(same(json('Sorcery', s('a basic land card or Gate card')), json('Sorcery', s('a basic land card or a Gate card')))).toBe(true);
  });
  it('near misses: a third description, "and" and a trailing "or" are not this reading', () => {
    for (const w of ['a basic land card or Gate card or Cave card', 'a basic land card and Gate card', 'a basic land card or', 'a basic land card or blorfty card']) expect(level('Sorcery', s(w)), w).not.toBe('full');
  });
});

describe('edh-zones-9 "and/or" in a search of two descriptions (render/steps-cards.ts; CR 701.23a-b)', () => {
  const s = (w: string): string => `Search your library for ${w}, reveal them, put them into your hand, then shuffle.`;
  it('"and/or" and "and" read as the same search for one card of each description', () => {
    expect(level('Sorcery', s('a Goblin card and/or an Elf card'))).toBe('full');
    expect(same(json('Sorcery', s('a Goblin card and/or an Elf card')), json('Sorcery', s('a Goblin card and an Elf card')))).toBe(true);
  });
  it('near misses: "or" (one card), three descriptions with "and/or" and a count are not this reading', () => {
    expect(level('Sorcery', s('a Goblin card or an Elf card')), 'or means one card').not.toBe('full');
    expect(level('Sorcery', s('a Goblin card, an Elf card and/or a Wizard card')), 'three descriptions').not.toBe('full');
    expect(level('Sorcery', s('two Goblin cards and/or an Elf card'))).not.toBe('full');
  });
});

describe('edh-zones-9 a card name that ends with "!" or "?" and closes its line (parser/front/selfref.ts#applySelfRefs; CR 201.5)', () => {
  it('"Exile <name>!" at the end of the line is "Exile ~." (the bang ends the sentence): the spell is full', () => {
    expect(level('Sorcery', 'Draw a card. Exile Boom!', 'Boom!')).toBe('full');
    expect(level('Sorcery', 'Draw a card. Exile Boom?', 'Boom?')).toBe('full');
  });
  it('near misses: a name with "!" in the middle of a sentence, or one that does not end the line, is not changed by this reading; an ordinary name with a period is as before', () => {
    expect(level('Sorcery', 'Exile Boom! Draw a card.', 'Boom!')).not.toBe('full'); // the line does not end with the name: the old reading ("Exile ~ Draw a card.") stays what it was
    expect(level('Sorcery', 'Draw a card. Exile Boom.', 'Boom')).toBe('full');
    expect(level('Sorcery', 'Draw a card. Exile Bang!', 'Boom!')).not.toBe('full'); // another name
  });
});

describe('edh-zones-9 the folds of render/fold-edhzones9.ts (Exhume, Deadbridge Chant, Gisa) read back only their own shapes', () => {
  it('Exhume\'s fold needs exactly one card from the chooser\'s own graveyard: "may", a hand and an opponent group are other cards', () => {
    expect(level('Sorcery', 'Each player puts a creature card from their graveyard onto the battlefield.')).toBe('full');
    for (const t of ['Each player may put a creature card from their graveyard onto the battlefield.', 'Each opponent puts a creature card from their graveyard onto the battlefield.', 'Each player puts two creature cards from their graveyard onto the battlefield.', 'Each player puts a creature card from their hand onto the battlefield.']) {
      expect(level('Sorcery', t), t).not.toBe('full');
    }
  });
  it('Deadbridge Chant\'s fold needs the else branch into the hand and a single card type: a graveyard of an opponent or "put it into your graveyard" are not full', () => {
    const t = (ifs: string, other: string): string => `Choose a card at random in your graveyard. ${ifs} ${other}`;
    expect(level('Sorcery', t("If it's a land card, put it onto the battlefield.", 'Otherwise, put it into your hand.'))).toBe('full');
    expect(level('Sorcery', t("If it's a land card, put it onto the battlefield.", 'Otherwise, put it into your library.'))).not.toBe('full');
    // edh-d-1 (changed on purpose): "at random" is now also said before the zone (render/steps-flow.ts, eff.edhd1.choose.cardAtRandom.fromPlayersGraveyard), so the generic if/otherwise
    // reading of the swapped branches renders and plays right (land to the hand, the rest to the battlefield): full, no longer a shape only the fold knew
    expect(level('Sorcery', t("If it's a land card, put it into your hand.", 'Otherwise, put it onto the battlefield.'))).toBe('full');
    expect(level('Sorcery', t("If it's a land card, put it onto the battlefield tapped.", 'Otherwise, put it into your hand.'))).toBe('full'); // edh-d-1 (as above): the tapped entry is read by the generic reading
  });
  it('Gisa\'s fold: "all ... cards exiled with ~" onto the battlefield under your control, not under their owners\' control and not a hand', () => {
    const face2 = 'If a creature an opponent controls would die, exile it instead.\nAt the beginning of your upkeep, put all creature cards exiled with this creature onto the battlefield under your control.';
    expect(level('Creature — Zombie', face2)).toBe('full');
    expect(level('Creature — Zombie', face2.replace('under your control', "under their owners' control"))).not.toBe('full');
    expect(level('Creature — Zombie', face2.replace('onto the battlefield under your control', 'into your hand'))).not.toBe('full');
  });
});

describe('edh-zones-9 formerly automated units that changed (link-only, CR 607.2a)', () => {
  it('Gisa\'s replacement ("If a creature an opponent controls would die, exile it instead") records what it exiled under the link "exiled", and only when a reader of the link is automated', () => {
    const withReader = json('Creature — Zombie', 'If a creature an opponent controls would die, exile it instead.\nAt the beginning of your upkeep, put all creature cards exiled with this creature onto the battlefield under your control.');
    const alone = json('Creature — Zombie', 'If a creature an opponent controls would die, exile it instead.');
    expect(withReader).toContain('"link":"exiled"');
    expect(alone).not.toContain('"link"');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ9.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
