/**
 * Lane trek, round trek-19 (the rest of the new Star Trek cards): the template data of parser/templates/zz-cloud/trek-19.json and what finishes the cards around it:
 *  - sta.trek19.attached.pump.cantBlock.isType ("Enchanted creature gets -4/-0, can't block, and is a Salamander", render/stat.ts#sharedSubject);
 *  - the quote the object grants to itself with "he becomes ..." (CR 201.5a): the card's own (short) name inside it is "~" (parser/front/selfref.ts, selfQuotes);
 *  - trg.trek19.opponent.casts.orActivates.chosenName (render/evt.ts: the pair of one activation beside another event; "a source with the chosen name");
 *  - the mana restriction "cast your commander" (parser/holes/spend.ts, render/steps-cards.ts), the restriction after "Choose a color. Add one mana of that color
 *    for each ..." (render/steps-cards.ts), "unless ~ has three or more quest counters on it" (render/steps-flow.ts), the list of creature types as plurals
 *    (render/np.ts) and fl.trek19.forEach.opponent.youCreate (the token form of "for each opponent", stable; the open fl.forEach.opponent stays experimental).
 * Guard G9 (design 6.8): every example lowers with its template, is fully automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). The behavior is in trek-19-scenarios.test.ts. CR cites checked against the Comprehensive Rules of 2026-09-25.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-19.json';
import review from '../../m5/golden/cards/trek-19-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
const NAME = 'Example Ooze';

/** The type line an example of a template is an ability of (the same choice as the mutation gates make, packages/cards/src/coverage/mutation.ts#exampleTypeLines). */
const typeOf = (t: Template, text: string): string => (t.kind === 'effect' ? 'Sorcery' : t.kind === 'static' ? (/^(enchant|enchanted)/i.test(text) ? 'Enchantment — Aura' : 'Artifact — Equipment') : 'Creature — Ooze');
/** An example as a card (the card's own name where the example says "~", as the mutation gates write it). */
const parse = (text: string, t: Template) => parseCard(card(NAME, typeOf(t, text), text.replace(/~/g, NAME), /Creature/.test(typeOf(t, text)) ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-19 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-19.json, in path order) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-19.json');
    expect([...files].sort()).toEqual(files);
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta/eff/trg.trek19.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff|trg|fl)\.trek19\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record, accepted by the owner on 2026-10-24 for single-printing Star Trek wordings): each wording is printed on one card, so the template is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('sta.trek19.attached.pump.cantBlock.isType')).toEqual(['De-evolve']);
    expect(evidence('trg.trek19.opponent.casts.orActivates.chosenName')).toEqual(['Kai Winn, Faithless Leader']);
    expect(evidence('fl.trek19.forEach.opponent.youCreate').sort()).toEqual(['Eccentric Pestfinder // Turn Stones', 'Endless Ranks of HYDRA', 'Sins of the Father']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('the open template fl.forEach.opponent stays experimental (a target inside "for each opponent" is one per opponent, which it cannot say)', () => {
    expect(TEMPLATE_SET.find((t) => t.id === 'fl.forEach.opponent')?.status).toBe('experimental');
    const f = parseCard(card('Test Sorcery', 'Sorcery', 'For each opponent, destroy target artifact.'), OPTS).faces[0]!;
    expect(f.templatesUsed.includes('fl.trek19.forEach.opponent.youCreate')).toBe(false);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-19 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text, t);
      for (const e of t.examples) {
        const f = parse(e.text, t);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c, t);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
        expect(f.templatesUsed.includes(t.id) && fullyAutomated(f), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/gets -3\/-0/, 'gets -3/-0 and gets +1/+1 until end of turn'], [/can't block/, "can't attack"], [/can't block/, "can't be blocked"], [/ and is an? /, ' and has flying and is a '],
    [/an opponent/, 'you'], [/an opponent/, 'each opponent'], [/casts a spell/, 'casts a creature spell'], [/activates an ability/, 'activates a loyalty ability'], [/with the chosen name or/, 'with the chosen name and'],
    [/base power and toughness 3\/4/, 'base power and toughness 3\/5'], [/becomes an? /, 'becomes another '],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-19 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text, t);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m, t);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-19 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          const f = parse(mutated, t);
          expect(fullyAutomated(f) && !JSON.stringify(f.abilities).includes('"kind":"manual"'), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-19 guard G2 on the whole card: a nonsense word in any place of the cards\' own text never leaves them full', () => {
  const CARDS: { name: string; type: string; cost: string; text: string; pt?: [string, string] }[] = [
    { name: 'Kirk, Man of Action', type: 'Legendary Creature — Human Officer', cost: '{2}{G}{W}{U}', pt: ['3', '3'], text: 'Other Officers, Artificers, Doctors, Pilots, Scientists, and Spacecraft creatures you control get +2/+2.' },
    { name: 'De-evolve', type: 'Enchantment — Aura', cost: '{1}{B}', text: "Enchant creature\nEnchanted creature gets -4/-0, can't block, and is a Salamander.\nAt the beginning of each upkeep, if there are seven or more cards in your graveyard, exile enchanted creature." },
    { name: 'Nog, Ambitious Cadet', type: 'Legendary Creature — Ferengi Rogue', cost: '{B}{G}', pt: ['2', '2'], text: 'Menace\n{1}: If Nog is a Rogue, he becomes a Ferengi Scout with base power and toughness 3/4 and gains "Whenever Nog becomes tapped, surveil 2."' },
    { name: 'Kai Winn, Faithless Leader', type: 'Legendary Creature — Bajoran Cleric', cost: '{1}{B}', pt: ['3', '1'], text: 'As Kai Winn enters, choose a nonland card name.\nWhenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name, that player loses 3 life.' },
    { name: 'Anthropological Mission', type: 'Enchantment', cost: '{2}{U}', text: 'Whenever you cast a noncreature spell, put a quest counter on this enchantment. Draw a card. Then discard a card unless this enchantment has three or more quest counters on it.' },
    { name: "Queen's Diamond", type: 'Legendary Artifact — Spacecraft', cost: '{4}', pt: ['5', '5'], text: "{T}: Choose a color. Add one mana of that color for each charge counter on Queen's Diamond. Spend this mana only to cast your commander." },
  ];
  const level = (c: (typeof CARDS)[number], text: string): { level: string; manualPart: boolean } => {
    const def = compileCard({ name: c.name, layout: 'normal', mana_cost: c.cost, type_line: c.type, oracle_text: text, colors: [], ...(c.pt ? { power: c.pt[0], toughness: c.pt[1] } : {}) } as OracleCard);
    return { level: def.automation.level, manualPart: JSON.stringify(def.faces).includes('"kind":"manual"') || JSON.stringify(def.faces).includes('"op":"manual"') };
  };
  for (const c of CARDS) {
    it(`${c.name}: as printed it is full with no manual part, and replacing any one word by an invented word is never full`, () => {
      expect(level(c, c.text)).toEqual({ level: 'full', manualPart: false });
      const words = c.text.split(' ');
      words.forEach((w, i) => {
        if (/^counters?\b/.test(words[i + 1] ?? '')) return; // the kind of a counter is an open class (design 6.11)
        const lead = w.match(/^["\n]+/)?.[0] ?? '';
        const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
        const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
        const r = level(c, mutated);
        expect(r.level === 'full' && !r.manualPart, mutated).toBe(false);
      });
    });
  }
  it('leaving out a half of a card gives another card: the JSON of the Kai Winn trigger with only the cast differs from the one with both halves', () => {
    const both = compileCard({ name: 'Kai Winn, Faithless Leader', layout: 'normal', mana_cost: '{1}{B}', type_line: CARDS[3]!.type, oracle_text: CARDS[3]!.text, colors: [], power: '3', toughness: '1' } as OracleCard);
    const cast = compileCard({ name: 'Kai Winn, Faithless Leader', layout: 'normal', mana_cost: '{1}{B}', type_line: CARDS[3]!.type, oracle_text: CARDS[3]!.text.replace(' or activates an ability of a source with the chosen name', ''), colors: [], power: '3', toughness: '1' } as OracleCard);
    expect(JSON.stringify(both.faces[0]!.abilities[1])).not.toBe(JSON.stringify(cast.faces[0]!.abilities[1]));
    expect(JSON.stringify(both.faces[0]!.abilities[1])).toContain('"ev":"activate"');
    expect(JSON.stringify(cast.faces[0]!.abilities[1])).not.toContain('"ev":"activate"');
  });
});

describe('trek-19 renderer and parser readings', () => {
  it('CR 205.3m: the creature types of an anthem said as plurals joined by "and", or as the singular nouns of an earlier round, give the same JSON', () => {
    const one = parseCard(card('Test Captain', 'Legendary Creature — Human Officer', 'Other Elves, Goblins, and Wizards creatures you control get +1/+1.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    const two = parseCard(card('Test Captain', 'Legendary Creature — Human Officer', 'Other Elf, Goblin, and Wizard creatures you control get +1/+1.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(one) && fullyAutomated(two)).toBe(true);
    expect(jsonKey(one.abilities)).toBe(jsonKey(two.abilities));
  });
  it('CR 106.6, 903.3d: "cast your commander" is a restriction to the commander spell its owner casts; "a commander spell" is the other wording of the earlier round (other JSON)', () => {
    const mine = parseCard(card('Test Rock', 'Artifact', '{T}: Add {C}. Spend this mana only to cast your commander.'), OPTS).faces[0]!;
    const any = parseCard(card('Test Rock', 'Artifact', '{T}: Add {C}. Spend this mana only to cast a commander spell.'), OPTS).faces[0]!;
    expect(fullyAutomated(mine) && fullyAutomated(any)).toBe(true);
    expect(JSON.stringify(mine.abilities)).toContain('"restriction":{"spells":{"commander":true,"owner":"you"}}');
    expect(JSON.stringify(any.abilities)).toContain('"restriction":{"spells":{"commander":true}}');
    expect(jsonKey(mine.abilities)).not.toBe(jsonKey(any.abilities));
    // never other words after the noun, never the plural, never another player's
    for (const t of ['Spend this mana only to cast your commanders.', "Spend this mana only to cast your commander's spells.", 'Spend this mana only to cast an opponent\'s commander.', 'Spend this mana only to cast your commander this turn.']) {
      expect(fullyAutomated(parseCard(card('Test Rock', 'Artifact', `{T}: Add {C}. ${t}`), OPTS).faces[0]!), t).toBe(false);
    }
  });
  it('CR 201.5a: the short name inside a quote the object grants to itself is the object, with "he becomes" as with "it becomes"; for another receiver the quote stays manual', () => {
    for (const pronoun of ['he', 'it']) {
      const own = parseCard(card('Test Cadet, Ambitious', 'Legendary Creature — Ferengi Rogue', `{1}: If Test Cadet is a Rogue, ${pronoun} becomes a Ferengi Scout with base power and toughness 3/4 and gains "Whenever Test Cadet becomes tapped, surveil 2."`, { power: '1', toughness: '1' }), OPTS).faces[0]!;
      expect(fullyAutomated(own), JSON.stringify(own.diagnostics)).toBe(true);
      expect(JSON.stringify(own.abilities)).toContain('"trigger":{"on":[{"ev":"becomes","what":"tapped","object":{"self":true}}]}');
    }
    const other = parseCard(card('Test Cadet, Ambitious', 'Legendary Creature — Ferengi Rogue', '{1}: Target creature becomes a Ferengi Scout with base power and toughness 3/4 and gains "Whenever Test Cadet becomes tapped, surveil 2."', { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(other)).toBe(false);
  });
  it('CR 608.2c, 122.1: "Then discard a card unless ~ has three or more quest counters on it" is the negation of a count of counters on the object', () => {
    for (const text of [
      'Whenever you cast a noncreature spell, draw a card. Then discard a card unless this enchantment has two or more quest counters on it.',
      'Whenever you cast a noncreature spell, put a quest counter on this enchantment. Draw a card. Then discard a card unless this enchantment has three or more quest counters on it.',
    ]) expect(fullyAutomated(parseCard(card('Test Mission', 'Enchantment', text), OPTS).faces[0]!), text).toBe(true);
    const three = parseCard(card('Test Mission', 'Enchantment', 'Whenever you cast a noncreature spell, draw a card. Then discard a card unless this enchantment has three or more quest counters on it.'), OPTS).faces[0]!;
    const two = parseCard(card('Test Mission', 'Enchantment', 'Whenever you cast a noncreature spell, draw a card. Then discard a card unless this enchantment has two or more quest counters on it.'), OPTS).faces[0]!;
    expect(jsonKey(three.abilities)).not.toBe(jsonKey(two.abilities));
  });
});

describe('6.10: the examples are synthetic', () => {
  const index = localIndex();
  it.skipIf(index === undefined)('no example, counter-example or reading is an Oracle line of the index', () => {
    const lines = new Set<string>();
    for (const c of index!) for (const l of (c.oracle_text ?? '').split('\n')) lines.add(l.replace(new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~').toLowerCase());
    for (const t of MECH) for (const text of [...t.examples.map((e) => e.text), ...t.counterExamples]) for (const l of text.split('\n')) if (!/^enchant /i.test(l) && !/^as .* enters, choose a nonland card name\.$/i.test(l)) expect(lines.has(l.toLowerCase()), l).toBe(false);
  });
});
