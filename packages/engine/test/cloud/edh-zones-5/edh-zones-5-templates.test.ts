/**
 * edh-zones-5 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-5.json and the round's other changes: "You may repeat this process any
 * number of times" (the `repeat` step's `optional`, parser/lower/repeat-process.ts, effects/handlers/control.ts), "shares a color with a <description>" (parser/holes/filter.ts,
 * render/np.ts), "that card from a graveyard" (parser/holes/edhz5.ts, render/steps-zones.ts), a granted escape whose cost is the card's mana cost plus the rest of a cost
 * (keywords/expand.ts, render/mods.ts), "third from the top" after a search (render/fold.ts). Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The
 * behavior is in edh-zones-5-scenarios.test.ts. CR cites checked against MagicCompRules 20260925 (media.wizards.com, read in the session).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones5 from '../../../src/parser/templates/zz-cloud/edh-zones-5.json';
import review from '../../m5/golden/cards/edh-zones-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ5 = edhZones5 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery or an artifact. */
const typeOf = (text: string): string => (/^Whenever|^When|this creature/m.test(text) ? 'Creature — Beast' : /^\{/m.test(text) || /^Each [a-z ]+ card in your graveyard has escape/m.test(text) ? 'Enchantment' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['eff.edhz5.repeatProcess.anyNumber', 'eff.edhz5.search.desc.revealThatCard', 'eff.edhz5.discard.upTo', 'sta.edhz5.each.has.escape.manaCostPlus', 'eff.edhz5.search.then.shuffle.thirdFromTop'];

describe('edh-zones-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-5.json, after zz-cloud/edh-zones-1.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-5.json');
    expect(files.indexOf('zz-cloud/edh-zones-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-1.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-5.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ5.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ5) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhz5\./);
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
    // narrow wordings (printed on one or two cards of the top 5,000), stable on one hand-verified golden card plus these tests and the scenarios: 6.9 deviations named in the
    // round record
    expect(goldenUsing('eff.edhz5.repeatProcess.anyNumber')).toEqual(['Ad Nauseam']);
    expect(goldenUsing('eff.edhz5.search.desc.revealThatCard')).toEqual(['Captain Sisay']);
    expect(goldenUsing('eff.edhz5.discard.upTo')).toEqual(['Fable of the Mirror-Breaker // Reflection of Kiki-Jiki']);
    expect(goldenUsing('sta.edhz5.each.has.escape.manaCostPlus')).toEqual(['Underworld Breach']);
    expect(goldenUsing('eff.edhz5.search.then.shuffle.thirdFromTop')).toEqual(['Long-Term Plans']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ5) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-5 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ5) {
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
    [/\bthird\b/, 'second'], [/\bany number of times\b/, 'once'], [/\bgraveyard\b/, 'hand'], [/\bup to\b/, 'exactly'], [/\breveal that card\b/, 'reveal those cards'], [/\bescape\b/, 'flashback'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ5) {
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

describe('edh-zones-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ5) {
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
    });
  }
});


describe('edh-zones-5 "You may repeat this process any number of times" (parser/lower/repeat-process.ts; CR 608.2c, 608.2d)', () => {
  const REPEAT = 'You may repeat this process any number of times.';
  it('the sentence copies every instruction before it, as "repeat this process once" does, and is full when they are', () => {
    expect(level('Sorcery', `Draw a card. You lose 1 life. ${REPEAT}`)).toBe('full');
    const j = json('Sorcery', `Draw a card. You lose 1 life. ${REPEAT}`);
    expect(j).toContain('"process":true,"optional":true');
    expect(j.match(/"op":"loseLife"/g)?.length).toBe(2); // the process is the two instructions before the sentence
  });
  it('near misses: nothing before it, or an instruction that is not understood before it, keeps the ability manual (no guessing at what "this process" covers)', () => {
    expect(level('Sorcery', REPEAT)).not.toBe('full');
    expect(level('Sorcery', `Fnord the foo. ${REPEAT}`)).not.toBe('full');
    expect(level('Sorcery', 'Draw a card. You may repeat this process.')).not.toBe('full');
    expect(level('Sorcery', 'Draw a card. An opponent may repeat this process any number of times.')).not.toBe('full');
  });
});

describe('edh-zones-5 "shares a color with a <description>" (parser/holes/filter.ts, render/np.ts; CR 105.2c, 205.2)', () => {
  const SEARCH = (what: string) => `Search your library for a card that shares ${what}, put it into your hand, then shuffle.`;
  it('a color or a card type with some one object of a described set: full in a search and in a target phrase, the set as written (battlefield by default)', () => {
    expect(level('Sorcery', SEARCH('a color with a legendary creature you control'))).toBe('full');
    expect(level('Sorcery', SEARCH('a card type with a creature an opponent controls'))).toBe('full');
    expect(level('Sorcery', 'Destroy target creature that shares a color with a creature card in your graveyard.')).toBe('full');
    expect(json('Sorcery', SEARCH('a color with a legendary creature you control'))).toContain('"sharesWith":{"with":{"ref":"each","filter":{"supertypes":["Legendary"],"types":["Creature"],"controller":"you"}},"quality":"color"}');
  });
  it('near misses: a plural set, a name quality, a quality that is not a quality, and "with each"/"with two" are not this reading', () => {
    expect(level('Sorcery', SEARCH('a color with legendary creatures you control'))).not.toBe('full');
    expect(level('Sorcery', SEARCH('a blorfty with a legendary creature you control'))).not.toBe('full');
    expect(level('Sorcery', SEARCH('a color with each legendary creature you control'))).not.toBe('full');
    expect(jsonKey(face(SEARCH('a color with a legendary creature you control'), 'Sorcery').abilities)).not.toBe(jsonKey(face(SEARCH('a color with a nonlegendary creature you control'), 'Sorcery').abilities));
  });
});

describe('edh-zones-5 "put that card from a graveyard onto the battlefield" (parser/holes/edhz5.ts; CR 400.7, 603.6)', () => {
  const TRIG = (what: string) => `Whenever an opponent discards a permanent card, you may put that card${what} onto the battlefield under your control.`;
  it('the same card, only while it is in a graveyard: the set of that card in a graveyard, said as printed', () => {
    expect(level('Creature — Specter', TRIG(' from a graveyard'))).toBe('full');
    const j = json('Creature — Specter', TRIG(' from a graveyard'));
    expect(j).toContain('"filter":{"is":{"ref":"event","role":"subject"},"zone":"graveyard","isCard":true}');
    expect(json('Creature — Specter', TRIG(''))).not.toContain('"zone":"graveyard"'); // the unqualified sentence is the old reading, unchanged
  });
  it('near misses: another zone, a plural, a pronoun, an own-graveyard phrase are not this reading', () => {
    expect(level('Creature — Specter', TRIG(' from a hand'))).not.toBe('full');
    expect(level('Creature — Specter', 'Whenever an opponent discards a permanent card, you may put those cards from a graveyard onto the battlefield under your control.')).not.toBe('full');
    expect(jsonKey(face(TRIG(' from your graveyard'), 'Creature — Specter').abilities)).not.toBe(jsonKey(face(TRIG(' from a graveyard'), 'Creature — Specter').abilities));
  });
});

describe('edh-zones-5 a granted escape whose cost is the mana cost plus the rest (keywords/expand.ts, render/mods.ts; CR 702.138a, 118.9)', () => {
  const ESC = (cost: string) => `Each creature card in your graveyard has escape. The escape cost is equal to its mana cost plus ${cost}.`;
  it('exile N other cards from your graveyard: full, the rest of the cost kept in the keyword', () => {
    expect(level('Enchantment', ESC('exile two other cards from your graveyard'))).toBe('full');
    const j = json('Enchantment', ESC('exile two other cards from your graveyard'));
    expect(j).toContain('"keyword":"escape"');
    expect(j).toContain('"costIsManaCost":true');
    expect(j).toContain('"kind":"exileFrom","zone":"graveyard","count":2');
  });
  it('near misses: the mana cost alone is the old mayhem-style reading (no cost beside it), another cost kind or another keyword is not this reading', () => {
    expect(level('Enchantment', 'Each creature card in your graveyard has escape. The escape cost is equal to its mana cost.')).not.toBe('full');
    expect(level('Enchantment', ESC('blorfty two other cards from your graveyard'))).not.toBe('full');
    expect(level('Enchantment', 'Each creature card in your graveyard has flashback. The flashback cost is equal to its mana cost plus exile two other cards from your graveyard.')).not.toBe('full');
  });
});

describe('edh-zones-5 "third from the top" after a search (render/fold.ts; CR 401.4)', () => {
  it('the third place from the top, as the top is said; any other place is not read', () => {
    expect(level('Instant', 'Search your library for a card, then shuffle and put that card third from the top.')).toBe('full');
    expect(level('Instant', 'Search your library for a card, then shuffle and put that card second from the top.')).not.toBe('full'); // no template for it: only the third place is read
  });
});

describe('edh-zones-5 a quoted trigger that cannot trigger from the battlefield stays manual (parser/lower/quoted.ts; CR 113.6k, 113.1c, 400.7)', () => {
  const GRANT = (event: string) => `Creatures you control have "When this creature ${event}, draw a card."`;
  it('"is put into a graveyard from anywhere", "cycle this card" and "cast this spell" granted to a permanent would have no zone and never fire: they are not automated', () => {
    expect(level('Enchantment', GRANT('is put into a graveyard from anywhere'))).not.toBe('full');
    expect(level('Enchantment', 'Creatures you control have "When you cycle this card, draw a card."')).not.toBe('full');
  });
  it('near misses: the quoted triggers that do work from the battlefield stay automated ("dies", "enters", "is put into a graveyard from the battlefield", "attacks")', () => {
    for (const event of ['dies', 'enters', 'is put into a graveyard from the battlefield', 'attacks']) expect(level('Enchantment', GRANT(event)), event).toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
