/**
 * edh-zones-11 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-11.json and the round's other changes: the quantity "the total amount of
 * life your opponents lost this turn" (parser/holes/qty.ts, render/qty.ts), the events "two or more creatures you control attack a player" and "enters from a graveyard"
 * (parser/holes/event.ts, render/evt.ts), the permission field `onlyTypes` (types/ability.ts, statics/play-permits.ts, actions/cast.ts, model/cap-walk.ts), the folds of render/fold-edhzones11.ts,
 * render/fold.ts ("their graveyard", "exile one face down", "them" after a trigger of several creatures) and render/stat.ts. Guard G9 and G2 as the earlier rounds run them; examples
 * are synthetic (design 6.10). The behavior is in edh-zones-11-scenarios.test.ts. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones11 from '../../../src/parser/templates/zz-cloud/edh-zones-11.json';
import review from '../../m5/golden/cards/edh-zones-11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ11 = edhZones11 as Template[];
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
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

const IDS = [
  'eff.edhz11.dig.rest.theirGraveyard', 'eff.edhz11.dig.exileNOfThem', 'eff.edhz11.dig.mayReveal.anyNumber.hand', 'eff.edhz11.dig.exileNFaceDown.noOf',
  'eff.edhz11.permit.cast.obj.durFirst.ifCreature', 'eff.edhz11.exileTop.thenPutOneFromAmong.control',
];

describe('edh-zones-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-11.json, after zz-cloud/edh-zones-1.json, before zz-cloud/edh-zones-2.json: path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-11.json');
    expect(files.indexOf('zz-cloud/edh-zones-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-11.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ11.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ11) {
      expect(t.id, t.id).toMatch(/^eff\.edhz11\./);
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
    expect(goldenUsing('eff.edhz11.dig.rest.theirGraveyard')).toEqual(['Thief of Sanity']);
    expect(goldenUsing('eff.edhz11.dig.exileNOfThem')).toEqual(['Florian, Voldaren Scion']);
    expect(goldenUsing('eff.edhz11.dig.mayReveal.anyNumber.hand')).toEqual(['Karumonix, the Rat King']);
    expect(goldenUsing('eff.edhz11.dig.exileNFaceDown.noOf')).toEqual(['Vivien, Champion of the Wilds']);
    expect(goldenUsing('eff.edhz11.permit.cast.obj.durFirst.ifCreature')).toEqual(['Vivien, Champion of the Wilds']);
    expect(goldenUsing('eff.edhz11.exileTop.thenPutOneFromAmong.control')).toEqual(['Lord of the Void']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ11) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all', 'any number', 'up']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-11 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ11) {
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
    [/\bgraveyard\b/, 'hand'], [/\bface down\b/, 'face up'], [/\bany number\b/, 'up to two'], [/\bon the bottom\b/, 'on top'], [/\bonto the battlefield\b/, 'into your hand'],
    [/\bunder your control\b/, 'under their control'], [/\bcreature spell\b/, 'land spell'], [/\bone of\b/, 'two of'], [/\brevealed cards\b/, 'revealed card'], [/\bexile\b/, 'destroy'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ11) {
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

describe('edh-zones-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ11) {
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

describe('edh-zones-11 the quantity "the total amount of life your opponents lost this turn" (parser/holes/qty.ts, render/qty.ts; CR 119.3)', () => {
  const t = (q: string): string => `At the beginning of your end step, look at the top X cards of your library, where X is ${q}.`;
  it('is the quantity of "the amount of life your opponents lost this turn" (the same JSON)', () => {
    expect(level('Creature — Beast', t('the total amount of life your opponents lost this turn'))).toBe('full');
    expect(same(json('Creature — Beast', t('the total amount of life your opponents lost this turn')), json('Creature — Beast', t('the amount of life your opponents lost this turn')))).toBe(true);
  });
  it('near misses: your own life, one opponent and "the total amount of life" alone are not this reading', () => {
    for (const q of ['the total amount of life you lost this turn', 'the total amount of life target opponent lost this turn', 'the total amount of life your opponents lost', 'the total amount of life']) {
      expect(level('Creature — Beast', t(q)), q).not.toBe('full');
    }
  });
});

describe('edh-zones-11 the event "two or more creatures you control attack a player" (parser/holes/event.ts#creaturesAttackAPlayer, render/evt.ts; CR 508.1b, 506.3, 603.2c)', () => {
  const t = (subject: string): string => `Whenever ${subject}, you gain 1 life.`;
  it('reads as a batch of at least N attackers of yours at one player', () => {
    expect(level('Artifact', t('two or more creatures you control attack a player'))).toBe('full');
    expect(level('Artifact', t('three or more Goblins you control attack a player'))).toBe('full');
    const j = json('Artifact', t('two or more creatures you control attack a player'));
    expect(j).toContain('"count":{"op":">=","value":2}');
    expect(j).toContain('"defender":"any"');
    expect(j).toContain('"batch":true');
  });
  it('near misses: one or more (another reading), no controller, an opponent, "attack you", "attack" alone and "a planeswalker" are not this reading', () => {
    for (const s of ['two or more creatures attack a player', 'two or more creatures an opponent controls attack a player', 'two or more creatures you control attack you', 'two or more creatures you control attack', 'two or more creatures you control attack a planeswalker', 'two or fewer creatures you control attack a player']) {
      expect(level('Artifact', t(s)), s).not.toBe('full');
    }
    expect(json('Artifact', t('one or more creatures you control attack a player'))).not.toContain('"value":2');
  });
});

describe('edh-zones-11 the event "enters from a graveyard" (parser/holes/event.ts, render/evt.ts; CR 400.3, 603.6a)', () => {
  const t = (subject: string): string => `Whenever ${subject} enters from a graveyard, you gain 1 life.`;
  it('a permanent or ~ put onto the battlefield from any player\'s graveyard', () => {
    expect(level('Creature — Beast', t('this creature or another permanent'))).toBe('full');
    expect(level('Creature — Beast', t('a creature'))).toBe('full');
    expect(json('Creature — Beast', t('a creature'))).toContain('"from":"graveyard"');
  });
  it('near misses: from exile, from a hand, from your graveyard (the owner reading stays its own), from the library and a batch are not this reading', () => {
    for (const s of ['enters from exile', 'enters from a hand', 'enters from a library', 'enters']) {
      expect(json('Creature — Beast', `Whenever a creature ${s}, you gain 1 life.`)).not.toContain('"from":"graveyard"');
    }
    expect(json('Creature — Beast', 'Whenever a creature enters from your graveyard, you gain 1 life.')).toContain('"owner":"you"');
    expect(level('Creature — Beast', 'Whenever one or more creatures enter from a graveyard, you gain 1 life.')).not.toBe('full');
  });
});

describe('edh-zones-11 the folds and renderer alternatives (render/fold.ts, render/fold-edhzones11.ts, render/stat.ts)', () => {
  it('"into their graveyard" is the rest of another player\'s library, and still only after a look at a library other than yours and one card exiled', () => {
    const t = (rest: string): string => `When ~ enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest ${rest}.`;
    expect(level('Creature — Beast', t('into their graveyard'))).toBe('full');
    expect(level('Creature — Beast', t('into their hand'))).not.toBe('full');
    expect(level('Creature — Beast', t('into target player\'s graveyard'))).not.toBe('full');
  });
  it('"exile one face down" is the same choice as "exile one of them face down"', () => {
    const t = (exile: string): string => `{T}: Look at the top four cards of your library. ${exile} and put the rest on the bottom of your library in any order.`;
    expect(same(json('Creature — Beast', t('Exile one face down')), json('Creature — Beast', t('Exile one of them face down')))).toBe(true);
    expect(level('Creature — Beast', t('Exile one'))).not.toBe('full');
    expect(level('Creature — Beast', t('Exile up to one face down'))).not.toBe('full');
  });
  it('the permission "you may cast it if it\'s a creature spell" gets the field onlyTypes; "land", "or" and a second condition do not', () => {
    const t = (cond: string): string => `{T}: Exile the top card of your library face down. For as long as it remains exiled, you may cast it${cond}.`;
    expect(level('Creature — Beast', t(" if it's a creature spell"))).toBe('full');
    expect(json('Creature — Beast', t(" if it's a creature spell"))).toContain('"onlyTypes":["Creature"]');
    expect(json('Creature — Beast', t(''))).not.toContain('onlyTypes');
    for (const c of [" if it's a land spell", " if it's a creature or artifact spell", " if it's a creature spell and you control a Goblin"]) expect(level('Creature — Beast', t(c)), c).not.toBe('full');
  });
  it('"them" after a trigger of several creatures names the cards looked at (Horn of the Mark); the fold still needs one card, the library of the one who looked', () => {
    const t = (reveal: string): string => `Whenever two or more creatures you control attack a player, look at the top five cards of your library. You may ${reveal} from among them and put it into your hand. Put the rest on the bottom of your library in a random order.`;
    expect(level('Artifact', t('reveal a creature card'))).toBe('full');
    expect(level('Artifact', t('reveal two creature cards'))).not.toBe('full');
  });
  it('the exile of the top cards and the card put under your control: only "under your control", exactly one card, from the cards just exiled', () => {
    const t = (put: string): string => `Whenever ~ deals combat damage to a player, exile the top six cards of that player's library, then put ${put}.`;
    expect(level('Creature — Beast', t('a land card from among them onto the battlefield under your control'))).toBe('full');
    for (const p of ['a land card from among them onto the battlefield', 'a land card from among them into your hand', 'two land cards from among them onto the battlefield under your control', 'up to one land card from among them onto the battlefield under your control']) {
      expect(level('Creature — Beast', t(p)), p).not.toBe('full');
    }
  });
});

describe('edh-zones-11 the permission field onlyTypes needs its capability (model/cap-walk.ts)', () => {
  it('a card whose permission carries onlyTypes is automated only because the engine registers feature:permit.cast.onlyTypes', () => {
    expect(ENGINE_CAPABILITIES.has('feature:permit.cast.onlyTypes')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-11 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ11.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
