/**
 * std-library-3 (account B lane std-library: library and graveyard sequences, Portent of Calamity): the template data of parser/templates/zz-cloud/std-library-3.json
 * and the round's other parser, lowering, renderer and engine changes:
 *  - `chooseObjects.eachCardType` (types/ability.ts, effects/handlers/choose.ts#pickEachCardType; CR 205.2a, 608.2d): "for each card type, you may exile a card of that
 *    type from among them", rendered by render/fold.ts#eachCardTypeFromGroup;
 *  - Cond (parser/holes/moved.ts#movedCondAt; CR 608.2c, 608.2h): "you exiled four or more cards this way" (also sacrificed, discarded), a count of what the ONE earlier
 *    instruction of that kind moved (lower/quantities.ts#movedCounts), rendered by render/moved.ts#movedAtLeastPhrase;
 *  - "you may cast a spell from among the exiled cards without paying its mana cost if C" (the choice guarded by C; render/fold.ts#castFromGroupFree);
 *  - Rest (parser/holes/object.ts#rest, lower/mentions.ts#restOf; CR 608.2c, 406.1): "the rest of the exiled cards", what a choice among a group of exiled cards left
 *    in exile, read by r5-fxz's "put {r:Rest} into your hand" (render/refs.ts#restOfExiled, render/fold.ts#restOfExiledToHand).
 * Guard G9 (design 6.8): every example lowers with its template and passes the exact render gate (G6); every counter-example does not parse or parses to different
 * JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings
 * (design 6.10), checked against the local index when it is present. The behavior is in std-library-3-scenarios.test.ts. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdLibrary3 from '../../../src/parser/templates/zz-cloud/std-library-3.json';
import review from '../../m5/golden/cards/cloud-std-library-3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const LIB3 = stdLibrary3 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)
type Golden = { card: string; verified: string; expect?: string }[];
const goldenUsing = (id: string, file: Golden = review as Golden): string[] => file.filter((g) => new RegExp(`[ (]${id.replaceAll('.', '\\.')}[,);]`).test(g.verified)).map((g) => g.card);

/** The type line an example is printed on: a creature for a permanent's line (a trigger, "this creature"), else a sorcery. */
const typeOf = (text: string): string => (/^Whenever|^When|this creature|^\{/m.test(text) ? 'Creature — Beast' : 'Sorcery');
const face = (text: string, typeLine?: string) => {
  const type = typeLine ?? typeOf(text);
  return parseCard(card('Example Relic', type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : undefined), OPTS).faces[0]!;
};
const understood = (f: ReturnType<typeof face>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual' || d.code === 'experimental');
const compiled = (type: string, text: string, name = 'Example Relic') =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string, name?: string): string => compiled(type, text, name).automation.level;
const json = (type: string, text: string, name?: string): string => JSON.stringify(compiled(type, text, name).faces);

const IDS = ['eff.stdlib3.dig.eachCardType.exile', 'eff.stdlib3.cast.free.fromAmong.ifCond'];

describe('std-library-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-library-3.json, after zz-cloud/std-lci.json, before zz-cloud/std-misc.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-library-3.json');
    expect(files.indexOf('zz-cloud/std-library-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-lci.json')); // other std-library-<n> files may sit between
    expect(files.indexOf('zz-cloud/std-library-3.json')).toBeLessThan(files.indexOf('zz-cloud/std-misc.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(LIB3.map((t) => t.id)).toEqual(IDS);
    for (const t of LIB3) {
      expect(t.id, t.id).toMatch(/^eff\.stdlib3\./);
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
    // narrow wordings (one card of the index prints them), stable on one hand-verified golden card plus these tests and the scenarios: a 6.9 deviation named
    // in the round record
    for (const id of IDS) expect(goldenUsing(id), id).toEqual(['Portent of Calamity']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of LIB3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'without']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-library-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of LIB3) {
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
    [/\bFor each card type\b/, 'For each color'], [/\bof that type\b/, 'of any type'], [/\byou may exile a card\b/, 'you may exile two cards'],
    [/\bwithout paying its mana cost if\b/, 'without paying its mana cost unless'], [/\bthree or more cards\b/, 'three or fewer cards'],
    [/\bthe rest of the exiled cards into your hand\b/, 'the rest of the exiled cards into your graveyard'], [/\ba spell from among\b/, 'two spells from among'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-library-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of LIB3) {
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

describe('std-library-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of LIB3) {
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

describe('std-library-3 Cond (parser/holes/moved.ts; CR 608.2c, 608.2h): "you <exiled|sacrificed|discarded> N or more cards this way"', () => {
  it('a count of what the ONE earlier instruction of that kind moved, at least N', () => {
    const text = 'Reveal the top six cards of your library. For each card type, you may exile a card of that type from among them. Put the rest into your graveyard. If you exiled four or more cards this way, draw a card.';
    expect(level('Sorcery', text)).toBe('full');
    expect(json('Sorcery', text)).toContain('"cond":"compare","left":{"q":"resultCount","step":"move","which":{"isCard":true}},"op":">=","right":4');
  });
  it('fails closed: no such instruction, or "or fewer"', () => {
    expect(level('Sorcery', 'Draw two cards. If you exiled four or more cards this way, draw a card.')).not.toBe('full');
    expect(level('Sorcery', 'Exile the top four cards of your library. If you exiled two or fewer cards this way, draw a card.')).not.toBe('full');
  });
});

describe('std-library-3 Rest (lower/mentions.ts#restOf; CR 608.2c, 406.1, 400.7): "the rest of the exiled cards"', () => {
  it('after a choice among a group of exiled cards: the cards of the group the choice did not pick, still in exile', () => {
    const text = 'Exile the top five cards of your library. You may cast a spell from among them without paying its mana cost if you control an artifact. Then put the rest of the exiled cards into your hand.';
    expect(level('Sorcery', text)).toBe('full');
    expect(json('Sorcery', text)).toMatch(/"not":\{"is":\{"ref":"bound","name":"cast"\}\},"zone":"exile"\},?.*"to":\{"zone":"hand"\}/);
  });
  it('with no choice among the exiled cards it names nothing (manual)', () => {
    expect(level('Sorcery', 'Exile the top five cards of your library. Then put the rest of the exiled cards into your hand.')).not.toBe('full');
  });
});

describe('std-library-3 engine and renderer (G6: the render gate is exact)', () => {
  it('render/fold.ts#castFromGroupFree: the condition is said after the instruction (the choice guarded by it)', () => {
    const f = compiled('Sorcery', 'Exile the top five cards of your library. You may cast a spell from among them without paying its mana cost if you control an artifact.');
    expect(f.automation.level).toBe('full');
    expect(JSON.stringify(f.faces)).toContain('"guard":{"cond":"exists"');
  });
  it('op:chooseObjects.eachCardType is a capability of the engine', () => {
    expect(ENGINE_CAPABILITIES.has('op:chooseObjects.eachCardType')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-library-3 design 6.10 (local index): synthetic examples', () => {
  it('no std-library-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = LIB3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
