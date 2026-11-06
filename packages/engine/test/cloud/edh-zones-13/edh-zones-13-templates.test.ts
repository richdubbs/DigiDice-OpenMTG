/**
 * edh-zones-13 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-13.json and the round's other changes: the lowering of the sentences
 * after an "If you do" of a payment or a `may` (parser/lower/conditions.ts#absorbFollowers, #absorbIntoDid), the filter readings "not named <name>", "with an even mana value" and
 * "<relative clause> and has <feature>" (parser/holes/filter.ts), the Seen hole's "the revealed cards" and the Rest hole's "the rest of the cards" (parser/holes/object.ts), and the
 * renderer's alternatives and folds (render/np.ts, render/fold.ts, render/fold-edhzones13.ts, render/steps-cards.ts, render/steps-util.ts, render/refs.ts). Guard G9 and G2 as the
 * earlier rounds run them; examples are synthetic (design 6.10). The behavior is in edh-zones-13-scenarios.test.ts. CR cites from memory (unverified).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones13 from '../../../src/parser/templates/zz-cloud/edh-zones-13.json';
import review from '../../m5/golden/cards/edh-zones-13-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ13 = edhZones13 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an Aura for an "Enchant" line, a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Enchant /m.test(text) ? 'Enchantment — Aura' : /^Whenever|^When|^At the beginning|this creature|^\{/mi.test(text) ? 'Creature — Beast' : 'Sorcery');
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

const IDS = EZ13.map((t) => t.id);

describe('edh-zones-13 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-13.json, after zz-cloud/edh-zones-1.json, before zz-cloud/edh-zones-2.json: path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-13.json');
    expect(files.indexOf('zz-cloud/edh-zones-13.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-13.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(IDS.length).toBe(13);
    for (const t of EZ13) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhz13\./);
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
    // narrow wordings (one or two cards of the index print them as a whole line), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.edhz13.search.upTo.cardsDesc.eachDifferentNames.reveal')).toEqual(['Tiamat']);
    expect(goldenUsing('eff.edhz13.dig.eachCardType.hand')).toEqual(['Atraxa, Grand Unifier']);
    expect(goldenUsing('eff.edhz13.dig.mayPut.bf.tappedAttacking')).toEqual(['Winota, Joiner of Forces']);
    expect(goldenUsing('eff.edhz13.dig.anyNumber.hand.rest.graveyard')).toEqual(['Dihada, Binder of Wills']);
    expect(goldenUsing('eff.edhz13.search.exactly.cardsDesc.differentNames')).toEqual(['Burning-Rune Demon']);
    expect(goldenUsing('eff.edhz13.reveal.found')).toEqual(['Burning-Rune Demon']);
    expect(goldenUsing('eff.edhz13.putChosenCard.hand.restGraveyard.shuffle')).toEqual(['Burning-Rune Demon']);
    expect(goldenUsing('eff.edhz13.search.andOr.reveal.oneTapped.otherHand')).toEqual(['Navigation Orb']);
    expect(goldenUsing('sta.edhz13.selfAndEnchanted.pump.whereX')).toEqual(['Nighthowler']);
    expect(goldenUsing('eff.edhz13.dig.put.descCard.milled.bf.control')).toEqual(['Gyruda, Doom of Depths']);
    expect(goldenUsing('eff.edhz13.shuffle.thenRevealUntil')).toEqual(['Creative Technique']);
    expect(goldenUsing('eff.edhz13.may.putThat.bottom.thatPlayersLibrary')).toEqual(['Jace, the Mind Sculptor']);
    expect(goldenUsing('eff.edhz13.exileLibrary.thenShuffleHand')).toEqual(['Jace, the Mind Sculptor']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ13) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'any number']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
      if (words.includes('up') && words[words.indexOf('up') + 1] === 'to') expect(t.consumes ?? [], `${t.id}: up to`).toContain('up to');
    }
  });
});

describe('edh-zones-13 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ13) {
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
    [/\bgraveyard\b/, 'exile'], [/\bany number\b/, 'up to two'], [/\bon the bottom\b/, 'on top'], [/\bonto the battlefield\b/, 'into your hand'], [/\bhand\b/, 'graveyard'],
    [/\bunder your control\b/, 'under their control'], [/\bone of\b/, 'two of'], [/\brevealed cards\b/, 'revealed card'], [/\bexile\b/, 'destroy'], [/\bexactly\b/, 'up to'],
    [/\bdifferent names\b/, 'the same name'], [/\bnonland\b/, 'land'], [/\bcard type\b/, 'color'], [/\btapped and attacking\b/, 'tapped'], [/\bshuffles\b/, 'draws'], [/\bthe bottom\b/, 'the top'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-13 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ13) {
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

describe('edh-zones-13 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ13) {
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
    });
  }
});


describe('edh-zones-13 the sentences after an "If you do" of a payment or a `may` that read what the branch bound join its then (parser/lower/conditions.ts; CR 608.2c, 118.12, 608.2d)', () => {
  const trail = (after: string): string => `You may pay {1}. If you do, look at the top two cards of your library. You may reveal a permanent card from among them and put it into your hand. ${after}`;
  const steps = (type: string, text: string): { op: string; then?: { op: string }[]; do?: { op: string }[] }[] => (JSON.parse(json(type, text)) as { abilities: { effect: { steps: { op: string; then?: { op: string }[] }[] } }[] }[])[0]!.abilities[0]!.effect.steps;
  it('"Put the rest on the bottom of your library in any order." reads the cards looked at less the one chosen and is the payment\'s: one top-level step, the pay', () => {
    expect(level('Sorcery', trail('Put the rest on the bottom of your library in any order.'))).toBe('full');
    const s = steps('Sorcery', trail('Put the rest on the bottom of your library in any order.'));
    expect(s.map((x) => x.op)).toEqual(['pay']);
    expect(s[0]!.then!.map((x) => x.op)).toEqual(['look', 'chooseObjects', 'reveal', 'move', 'move']);
  });
  it('near misses: a sentence that reads nothing the branch bound stays outside it, and the rest of an unrelated group is not read', () => {
    const s = steps('Sorcery', trail('Draw a card.'));
    expect(s.map((x) => x.op)).toEqual(['pay', 'draw']);
    expect(level('Sorcery', 'You may pay {1}. If you do, draw a card. Put the rest on the bottom of your library in any order.')).not.toBe('full');
  });
  it('a `may` the "If you do" asks about: the sentences that read the cards it searched for (and the shuffle after them) are inside the branch; a sentence that reads none is not', () => {
    const rune = (after: string): string => `You may search your library for exactly two cards not named Forest that have different names. If you do, reveal those cards. An opponent chooses one of them. Put the chosen card into your hand and the other into your graveyard, then shuffle.${after}`;
    expect(level('Sorcery', rune(''))).toBe('full');
    const s = steps('Sorcery', rune(''));
    expect(s.map((x) => x.op)).toEqual(['may', 'if']);
    expect(s[1]!.then!.map((x) => x.op)).toEqual(['reveal', 'chooseObjects', 'move', 'move', 'shuffle']);
    expect(steps('Sorcery', rune(' Draw a card.')).map((x) => x.op)).toEqual(['may', 'if', 'draw']);
  });
});

describe('edh-zones-13 the filter readings "not named <name>", "with an even mana value" and "<relative clause> and has <feature>" (parser/holes/filter.ts; CR 201.2, 202.3, 205.3m)', () => {
  const search = (desc: string): string => `Search your library for ${desc}, put it onto the battlefield, then shuffle.`;
  it('"not named <a card name>" is the filter field notName', () => {
    expect(level('Sorcery', search('a Dragon card not named Forest'))).toBe('full');
    expect(json('Sorcery', search('a Dragon card not named Forest'))).toContain('"notName":"Forest"');
    expect(json('Sorcery', search('a Dragon card named Forest'))).not.toContain('notName');
  });
  it('near misses: two names ("not named Forest or Island") and a lower-case word are not this reading', () => {
    expect(level('Sorcery', search('a Dragon card not named Forest or Island'))).not.toBe('full');
  });
  it('"with an even mana value" (and "an odd") is the parity of the mana value, also for one card', () => {
    const t = (w: string): string => `Search your library for a creature card ${w}, put it onto the battlefield, then shuffle.`;
    expect(json('Sorcery', t('with an even mana value'))).toContain('"manaValueParity":"even"');
    expect(json('Sorcery', t('with an odd mana value'))).toContain('"manaValueParity":"odd"');
    expect(same(json('Sorcery', t('with an even mana value')), json('Sorcery', t('with even mana value')))).toBe(true);
    expect(level('Sorcery', t('with an even mana'))).not.toBe('full');
  });
  it('"shares a creature type with the sacrificed creature and has mana value equal to 1 plus that creature\'s mana value": the filter has both, and "that creature" is the sacrificed creature', () => {
    const t = (rest: string): string => `As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card that shares a creature type with the sacrificed creature and has ${rest}. Put that card onto the battlefield, then shuffle.`;
    expect(level('Sorcery', t("mana value equal to 1 plus that creature's mana value"))).toBe('full');
    const j = json('Sorcery', t("mana value equal to 1 plus that creature's mana value"));
    expect(j).toContain('"sharesWith":{"with":{"ref":"costSacrificed"},"quality":"creatureType"}');
    expect(j).toContain('"stat":"manaValue","of":{"ref":"costSacrificed"}');
    expect(same(j, json('Sorcery', t("mana value equal to 1 plus the sacrificed creature's mana value")))).toBe(true);
    // (only the computed value has its wording here: "and has mana value 3" stays manual, fail closed)
    expect(level('Sorcery', t('mana value 3'))).not.toBe('full');
  });
  it('near misses: "that artifact\'s mana value" is no creature just named, and "has" without a clause before it is no continuation', () => {
    const t = (rest: string): string => `As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card that shares a creature type with the sacrificed creature and has ${rest}. Put that card onto the battlefield, then shuffle.`;
    expect(level('Sorcery', t("mana value equal to 1 plus that artifact's mana value"))).not.toBe('full');
    expect(level('Sorcery', 'As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card and has flying. Put that card onto the battlefield, then shuffle.')).not.toBe('full');
  });
});

describe('edh-zones-13 the group wordings: "the revealed cards" (Seen), "the rest of the cards" (Rest) and the renderer alternatives (parser/holes/object.ts; render/np.ts, render/fold.ts, render/refs.ts, render/steps-cards.ts, render/steps-util.ts)', () => {
  it('"from among the revealed cards" names the cards a reveal of the top cards revealed; after a look at the top cards it is not an antecedent', () => {
    const t = (first: string): string => `${first} the top six cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand. Put the rest on the bottom of your library in a random order.`;
    expect(level('Sorcery', t('Reveal'))).toBe('full');
    expect(same(json('Sorcery', t('Reveal')), json('Sorcery', t('Reveal').replace('the revealed cards', 'them')))).toBe(true);
    expect(level('Sorcery', t('Exile'))).not.toBe('full');
  });
  it('"the rest of the cards" is "the rest"', () => {
    const t = (rest: string): string => `Look at the top four cards of your library. You may put a Goblin creature card from among them onto the battlefield tapped and attacking. Put ${rest} on the bottom of your library in a random order.`;
    expect(same(json('Creature — Goblin', 'Whenever ~ attacks, look at the top four cards of your library. You may put a Goblin creature card from among them onto the battlefield tapped and attacking. Put the rest of the cards on the bottom of your library in a random order.'),
      json('Creature — Goblin', 'Whenever ~ attacks, look at the top four cards of your library. You may put a Goblin creature card from among them onto the battlefield tapped and attacking. Put the rest on the bottom of your library in a random order.'))).toBe(true);
    expect(level('Sorcery', t('the rest of the cards'))).toBe('full');
    expect(level('Sorcery', t('the rest of the lands'))).not.toBe('full');
  });
  it('"that player\'s library" is the owner\'s library of the card looked at; "the exiled card" is the card exiled in front of "the rest"; "exactly N" is a stated number', () => {
    expect(level('Sorcery', "Look at the top card of target player's library. You may put that card on the bottom of that player's library.")).toBe('full');
    expect(level('Sorcery', 'Shuffle your library, then reveal cards from the top of it until you reveal a nonland card. Exile that card and put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost.')).toBe('full');
    expect(level('Sorcery', 'Shuffle your library, then reveal cards from the top of it until you reveal a nonland card. Exile that card and put the rest on the bottom of your library in a random order. You may cast the exiled cards without paying their mana costs.')).not.toBe('full');
    expect(level('Sorcery', 'Search your library for exactly one artifact cards that have different names.')).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-13 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-13 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ13.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
