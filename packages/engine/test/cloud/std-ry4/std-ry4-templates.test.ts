/**
 * std-ry4 (wave 2 top-down, Commander lane ry4): the template data of parser/templates/zz-cloud/std-ry4.json and the round's other parser and renderer changes:
 *  - parser/parse.ts#namedComboPieces: "a card named Eivor, Battle-Ready" reads the card's Scryfall combo-piece names after "named" (CR 201.2), as the meld cards do;
 *  - parser/parse.ts#cardHasXCost: the X of "As an additional cost to cast this spell, discard X cards / sacrifice X lands / exile X cards from your graveyard /
 *    return X Swamps you control to their owner's hand / sacrifice an artifact with mana value X" (CR 107.3a, 601.2b);
 *  - render/mods.ts#continuousHave: "you may have <objects> gain <abilities>" (a set); render/abil.ts#atStepAndWhenever: "At the beginning of your upkeep and
 *    whenever ..." (family at-step-and-whenever).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-ry4-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not
 * in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRy4 from '../../../src/parser/templates/zz-cloud/std-ry4.json';
import review from '../../m5/golden/cards/cloud-std-ry4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const RY4 = stdRy4 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: an artifact for a trigger or an activated ability, else a sorcery. */
const typeOf = (text: string): string => (/^At |^\{T\}/m.test(text) ? 'Artifact' : 'Sorcery');
const face = (text: string, typeLine?: string) => parseCard(card('Example Relic', typeLine ?? typeOf(text), text), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, extra: Partial<OracleCard> = {}) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const level = (type: string, text: string, extra: Partial<OracleCard> = {}): string => compiled(type, text, extra).automation.level;

const IDS = ['eff.stdry4.may.have.obj.gain', 'eff.stdry4.may.have.objs.gain', 'trg.stdry4.at.andWhenever', 'eff.stdry4.cant.attack.dur', 'eff.stdry4.each.cant.attack.dur'];

describe('std-ry4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-ry4.json, after zz-cloud/std-rx9.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-ry4.json');
    expect(files.indexOf('zz-cloud/std-ry4.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx9.json'));
    expect(files.indexOf('zz-cloud/std-ry4.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(RY4.map((t) => t.id)).toEqual(IDS);
    for (const t of RY4) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.stdry4\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.since, t.id).toBe(8);
      expect(t.status, t.id).toBe('stable');
    }
    for (const g of review as Golden) expect(g.expect, g.card).toBe('full');
    // three or more golden cards (6.9 met)
    expect(goldenUsing('eff.stdry4.cant.attack.dur')).toEqual(['Change of Heart', 'Martyred Rusalka', 'Netter en-Dal']);
    // narrow wordings, stable on one or two hand-verified golden cards (tuning half) plus these tests and the scenarios: a 6.9 deviation named in the round record
    expect(goldenUsing('eff.stdry4.may.have.obj.gain')).toEqual(['Academic Dispute', 'Kinsbaile Balloonist']);
    expect(goldenUsing('eff.stdry4.may.have.objs.gain')).toEqual(['Highland Berserker', 'Joraga Bard']);
    expect(goldenUsing('trg.stdry4.at.andWhenever')).toEqual(['Shrine of Piercing Vision']);
    expect(goldenUsing('eff.stdry4.each.cant.attack.dur')).toEqual(['Intimidation Bolt']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of RY4) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-ry4 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of RY4) {
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
    [/\bgain\b/, 'lose'], [/\bmay have\b/, 'must have'], [/\band whenever\b/, 'or whenever'], [/\bcan't attack\b/, "can't block"], [/\bthis turn\b/, 'next turn'],
    [/\buntil end of turn\b/, 'until your next turn ends'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-ry4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of RY4) {
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

describe('std-ry4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of RY4) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not understood`, () => {
      for (const e of t.examples) {
        const lines = e.text.split('\n');
        const last = lines.length - 1;
        const sentences = lines[last]!.split(/(?<=\.) /);
        const lastSentence = sentences.length - 1;
        const words = sentences[lastSentence]!.split(' ');
        words.forEach((w, i) => {
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return; // the word in front of "counter(s)" is an open class by design (6.11, the CounterKind hole)
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const line = [...sentences.slice(0, lastSentence), [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ')].join(' ');
          const mutated = [...lines.slice(0, last), line].join('\n');
          expect(understood(face(mutated, typeOf(e.text))), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-ry4 parser/parse.ts#namedComboPieces (CR 201.2): a card named by one of the card\'s combo pieces', () => {
  const SEEK = 'When this creature enters, you may search your library and/or graveyard for a card named Vexa, Keeper of Vows, reveal it, and put it into your hand. If you search your library this way, shuffle.';
  const parts = (...names: string[]): Partial<OracleCard> => ({ all_parts: names.map((name) => ({ component: 'combo_piece', name, type_line: 'Legendary Creature — Elf' })) } as Partial<OracleCard>);
  it('with the name as a combo piece, the search names exactly that card (filter name), and the card is full', () => {
    const d = compiled('Creature — Elf', SEEK, parts('Vexa, Keeper of Vows', 'Example Relic'));
    expect(d.automation.level).toBe('full');
    expect(JSON.stringify(d.faces)).toContain('"filter":{"name":"Vexa, Keeper of Vows"}');
  });
  it('fails closed: without the combo piece the comma name is not read; a combo piece the text does not name after "named" changes nothing', () => {
    expect(level('Creature — Elf', SEEK)).not.toBe('full');
    expect(level('Creature — Elf', SEEK, parts('Vexa, Keeper of Oaths'))).not.toBe('full');
  });
  it('a card that also names a card that is no combo piece keeps the old reading (the index would hide that name): unchanged from no combo pieces', () => {
    const text = `${SEEK}\n{T}: Search your library for a card named Glimmer Moth, reveal it, put it into your hand, then shuffle.`;
    expect(JSON.stringify(compiled('Creature — Elf', text, parts('Vexa, Keeper of Vows')).faces)).toBe(JSON.stringify(compiled('Creature — Elf', text).faces));
  });
});

describe('std-ry4 parser/parse.ts#cardHasXCost (CR 107.3a, 601.2b): X defined by an additional cost', () => {
  for (const cost of ['discard X cards', 'discard X cards at random', 'discard X creature cards', 'sacrifice X lands', 'sacrifice X creatures', 'exile X cards from your graveyard',
    'exile X creature cards from your graveyard', 'return X Forests you control to their owner\'s hand', 'sacrifice an artifact or creature with mana value X']) {
    it(`"As an additional cost to cast this spell, ${cost}." gives the spell an X: "You gain X life." is full`, () => {
      expect(level('Sorcery', `As an additional cost to cast this spell, ${cost}.\nYou gain X life.`)).toBe('full');
    });
  }
  it('fails closed: a fixed number, a cost the list does not name, and an X only in the effect stay not full', () => {
    expect(level('Sorcery', 'As an additional cost to cast this spell, discard two cards.\nYou gain X life.')).not.toBe('full');
    expect(level('Sorcery', 'As an additional cost to cast this spell, tap X untapped creatures you control.\nYou gain X life.')).not.toBe('full');
    expect(level('Sorcery', 'You gain X life.')).not.toBe('full');
  });
});

describe('std-ry4 renderer support (G6: the render gate is exact)', () => {
  it('render/mods.ts#continuousHave: "you may have <set> gain <abilities> <duration>" in a trigger; a set given a P/T change keeps refusing the have form', () => {
    expect(level('Creature — Elf Ally', 'Whenever this creature or another Ally you control enters, you may have Ally creatures you control gain lifelink until end of turn.')).toBe('full');
    expect(level('Sorcery', 'You may have creatures you control get +1/+1 until end of turn.')).not.toBe('full');
  });
  it('render/abil.ts#atStepAndWhenever: a step first, then another kind of event; two steps keep the plain reading', () => {
    expect(level('Artifact', 'At the beginning of your upkeep and whenever you cast a red spell, put a charge counter on this artifact.')).toBe('full');
    expect(level('Artifact', 'At the beginning of your upkeep and whenever you cast a red spell, put a charge counter on target artifact.')).toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-ry4 design 6.10 (local index): synthetic examples', () => {
  it('no std-ry4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = RY4.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
