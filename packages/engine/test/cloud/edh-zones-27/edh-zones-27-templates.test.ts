/**
 * edh-zones-27 (Commander lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-27.json and the round's other changes: the join of two sentences that name one
 * replaced object (parser/lower/ability.ts#joinEdhZones27), the folds of render/fold-edhzones27.ts, `Discourse.exiledTop` (parser/holes/core.ts, object.ts), the permission "from any
 * graveyard" (`anyGraveyard`, statics/play-permits.ts) with its rider (rid.rx27.forEachCast.exileInstead), and the names an `instead` body gives to its own steps (effects/handlers/lasting-fix.ts).
 * Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in edh-zones-27-scenarios.test.ts. CR cites checked against the 2026-09-25 text.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones27 from '../../../src/parser/templates/zz-cloud/edh-zones-27.json';
import review from '../../m5/golden/cards/edh-zones-27-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ27 = edhZones27 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

const IDS = [
  'eff.edhz27.putIntoGy.exile.thenReturnNextEnd',
  'eff.edhz27.exile.withOneCounter',
  'eff.edhz27.removeCounter.fromOneWithKind',
  'eff.edhz27.put.fromExiledTop.battlefield',
  'eff.edhz27.permit.cast.eachNonlandType.free.durFirst',
  'eff.edhz27.permit.cast.anyGraveyard.eot',
  'eff.edhz27.nextDraw.they.exileTop.mayPlay',
];
/** The type line an example is printed on. */
const typeOf = (text: string): string => (/^(Whenever|At the beginning)/.test(text) ? 'Creature — Human' : 'Sorcery');
const face = (text: string, typeLine: string) =>
  parseCard(card('Example Relic', typeLine, text, { ...(typeLine.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...(/\bX\b/.test(text) ? { mana_cost: '{X}' } : {}) }), OPTS).faces[0]!;
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic', extra: Record<string, unknown> = {}) =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}), ...extra } as OracleCard);
const withX = (text: string): Record<string, unknown> => (/\bX\b/.test(text) ? { mana_cost: '{X}' } : {});
const level = (type: string, text: string, name?: string): string => compiled(type, text, name, withX(text)).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name, withX(text)).faces);
const strip = (a: string): string => a.replace(/"oracleText":"[^"]*"/g, '').replace(/"text":"[^"]*"/g, '').replace(/"src":\[[^\]]*\]/g, '');
const same = (a: string, b: string): boolean => strip(a) === strip(b);

describe('edh-zones-27 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-27.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-27.json');
    expect(files.indexOf('zz-cloud/edh-zones-27.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-zones-25.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-27.json')).toBeLessThan(files.indexOf('zz-cloud/edh-zones-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ27.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ27) {
      expect(t.id, t.id).toMatch(/^(eff|rep|sta|trg|rid)\.edhz27\./);
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
    expect(goldenUsing('eff.edhz27.putIntoGy.exile.thenReturnNextEnd')).toEqual(['Cosmic Intervention']);
    expect(goldenUsing('eff.edhz27.exile.withOneCounter')).toEqual(['Mari, the Killing Quill']);
    expect(goldenUsing('eff.edhz27.removeCounter.fromOneWithKind')).toEqual(['Mari, the Killing Quill']);
    expect(goldenUsing('eff.edhz27.put.fromExiledTop.battlefield')).toEqual(["Aminatou's Augury"]);
    expect(goldenUsing('eff.edhz27.permit.cast.eachNonlandType.free.durFirst')).toEqual(["Aminatou's Augury"]);
    expect(goldenUsing('eff.edhz27.permit.cast.anyGraveyard.eot')).toEqual(['Urabrask // The Great Work']);
    expect(goldenUsing('eff.edhz27.nextDraw.they.exileTop.mayPlay')).toEqual(['Urabrask, Heretic Praetor']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ27) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'random', 'any', 'next', 'without']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-27 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ27) {
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
    [/\bor less\b/, 'or greater'], [/\bmana value\b/, 'power'], [/\bgraveyard\b/, 'hand'], [/\bbottom\b/, 'top'], [/\bthe rest\b/, 'a card'], [/\bone of them\b/, 'two of them'], [/\bat random\b/, 'of your choice'], [/\bplaneswalker\b/, 'creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-27 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ27) {
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

describe('edh-zones-27 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ27) {
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
    }, 600_000); // one parse per word of every example
  }
});


describe('edh-zones-27 sentences that name one replaced object are joined only for the exact next sentence (parser/lower/ability.ts#joinEdhZones27)', () => {
  const first = 'If a permanent you control would be put into a graveyard from the battlefield this turn, exile it instead.';
  const second = "Return it to the battlefield under its owner's control at the beginning of the next end step.";
  it('the pair is one replacement with its return; either sentence alone, another return and another condition are not the reading', () => {
    expect(level('Instant', `${first} ${second}`)).toBe('full');
    expect(level('Instant', first)).not.toBe('full');
    expect(level('Instant', `${first} Return it to the battlefield under your control at the beginning of the next end step.`)).not.toBe('full');
    expect(level('Instant', `${first} ${second.replace('the next end step', 'your next end step')}`)).not.toBe('full');
    expect(level('Instant', first.replace('would be put into a graveyard from the battlefield', 'would die') + ' ' + second)).not.toBe('full');
    expect(level('Instant', `Draw a card. ${second}`)).not.toBe('full');
  });
  it('an unrelated sentence in between keeps them apart', () => {
    expect(level('Instant', `${first} Draw a card. ${second}`)).not.toBe('full');
  });
});

describe('edh-zones-27 Discourse.exiledTop: "them" after an exile of the top cards is the exiled group, never a looked-at group (parser/holes/object.ts#seen, #exiledTop)', () => {
  it('a land from among them after an exile of the top cards is read; after a mill, a reveal or a look the older readings stay', () => {
    expect(level('Sorcery', 'Exile the top five cards of your library. You may put a land card from among them onto the battlefield.')).toBe('full');
    expect(level('Sorcery', 'Look at the top five cards of your library. You may put a land card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.')).toBe('full');
    expect(level('Sorcery', 'Reveal the top five cards of your library. You may put a land card from among them onto the battlefield. Put the rest into your graveyard.')).toBe('full');
  });
  it('near misses: tapped, another zone and two cards are not the reading', () => {
    expect(level('Sorcery', 'Exile the top five cards of your library. You may put a land card from among them onto the battlefield tapped.')).not.toBe('full');
    expect(level('Sorcery', 'Exile the top five cards of your library. You may put a land card from among them into your hand.')).not.toBe('full');
    expect(level('Sorcery', 'Exile the top five cards of your library. You may put two land cards from among them onto the battlefield.')).not.toBe('full');
  });
});

describe('edh-zones-27 "from any graveyard" and the rider after it (rid.rx27.forEachCast.exileInstead gains the permission as a shape it modifies)', () => {
  const grant = 'Until end of turn, you may cast creature spells from any graveyard.';
  const rider = 'If a spell cast this way would be put into a graveyard, exile it instead.';
  it('the permission alone and with its rider are read; your graveyard, another player\'s and "without paying" are other wordings', () => {
    expect(level('Sorcery', grant)).toBe('full');
    expect(level('Sorcery', `${grant} ${rider}`)).toBe('full');
    expect(level('Sorcery', `${grant} ${rider}`.replace('any graveyard', 'your graveyard'))).not.toBe('full'); // (a permission of a resolved effect from your graveyard only has no rider here)
    expect(json('Sorcery', `${grant} ${rider}`)).toContain('"anyGraveyard":true');
    expect(level('Sorcery', grant.replace('any graveyard', 'any graveyard without paying their mana costs'))).not.toBe('full');
    expect(level('Sorcery', `${grant} ${rider.replace('exile it instead', 'exile it')}`)).not.toBe('full');
  });
  it('the rider after a permission for a card in hand or after a draw is still refused', () => {
    expect(level('Sorcery', `Draw a card. ${rider}`)).not.toBe('full');
  });
});

describe('edh-zones-27 the names an `instead` body gives to its own steps stay names (effects/handlers/lasting-fix.ts)', () => {
  it('"instead they exile the top card of their library. They may play it this turn." is one replacement with the exile and the permission', () => {
    const t = "At the beginning of each opponent's upkeep, the next time they would draw a card this turn, instead they exile the top card of their library. They may play it this turn.";
    expect(level('Creature — Human', t)).toBe('full');
    const j = json('Creature — Human', t);
    expect(j).toContain('"b":"instead"');
    expect(j).toContain('"uses":1');
    expect(level('Creature — Human', t.replace('the next time', 'each time'))).not.toBe('full');
    expect(level('Creature — Human', t.replace('They may play it this turn.', 'They may play it.'))).not.toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-27 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-27 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ27.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
