/**
 * p2-zone-moves-1 (Phase 2 lane p2-zone-moves: wheels): the template data of parser/templates/zz-cloud/p2-zone-moves-1.json and the round's other changes:
 *  - engine: a group's draw reads its count for each drawing player (`op:draw.perPlayerCount`, effects/handlers/cards-draw.ts#drawHandler); `resultCount.maxPerOwner`
 *    (effects/eval.ts; capability `feature:resultCount.maxPerOwner`): the greatest number of the moved objects one player owned;
 *  - lowering: a group's "then draws that many cards" after the same group's discard counts the cards THAT player discarded (parser/lower/quantities.ts#
 *    groupDrawsOwnDiscards; CR 701.9a, 121.2, 608.2e; a correction of formerly automated units, decided by default); "that many" right after a discard of the whole
 *    hand in the same sentence is that discard's count even when the trigger has an amount of its own (resolveNumbers, "wheel");
 *  - eff.t6.discardHand.thenDraw also reads "discards all the cards in their hand" (the renderer already says both, family discard-hand).
 * Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The behavior is in p2-zone-moves-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import p2ZoneMoves1 from '../../../src/parser/templates/zz-cloud/p2-zone-moves-1.json';
import review from '../../m5/golden/cards/cloud-p2-zone-moves-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const ZM1 = p2ZoneMoves1 as Template[];
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

const IDS = ['eff.p2zm1.discardHand.drawThatManyMinus', 'eff.p2zm1.discardHand.drawGreatestDiscarded'];

describe('p2-zone-moves-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/p2-zone-moves-1.json, after zz-cloud/look3.json, before zz-cloud/r3-choose.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/p2-zone-moves-1.json');
    expect(files.indexOf('zz-cloud/p2-zone-moves-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/look3.json'));
    expect(files.indexOf('zz-cloud/p2-zone-moves-1.json')).toBeLessThan(files.indexOf('zz-cloud/r3-choose.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(ZM1.map((t) => t.id)).toEqual(IDS);
    for (const t of ZM1) {
      expect(t.id, t.id).toMatch(/^eff\.p2zm1\./);
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
    expect(goldenUsing('eff.p2zm1.discardHand.drawThatManyMinus')).toEqual(['Dark Deal']);
    expect(goldenUsing('eff.p2zm1.discardHand.drawGreatestDiscarded')).toEqual(['Windfall']);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of ZM1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('p2-zone-moves-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of ZM1) {
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
    [/\bminus\b/, 'plus'], [/\bthat many cards minus\b/, 'two cards minus'], [/\btheir hand\b/, 'their graveyard'], [/\bgreatest number\b/, 'smallest number'],
    [/\ba player discarded\b/, 'a player drew'], [/\bthen draws\b/, 'then you draw'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('p2-zone-moves-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of ZM1) {
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

describe('p2-zone-moves-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of ZM1) {
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

describe('p2-zone-moves-1 lowering (CR 701.9a, 121.2, 608.2e): a group draws what each player discarded', () => {
  it('"Each player discards their hand, then draws that many cards": the count is the cards the drawing player owned among those discarded', () => {
    const j = json('Sorcery', 'Each player discards their hand, then draws that many cards.');
    expect(j).toContain('"count":{"q":"resultCount","step":"discard","which":{"owner":{"ref":"iterating"}}}');
    expect(level('Sorcery', 'Each player discards their hand, then draws that many cards.')).toBe('full');
  });
  it('a single player keeps the plain count; a fixed number is untouched; another group\'s draw is not rewritten', () => {
    expect(json('Sorcery', 'Target player discards their hand, then draws that many cards.')).toContain('"count":{"q":"resultCount","step":"discard"}');
    expect(json('Sorcery', 'Each player discards their hand, then draws seven cards.')).toContain('"count":7');
  });
  it('eff.t6.discardHand.thenDraw also reads "discards all the cards in their hand" (family discard-hand)', () => {
    const f = face('Each opponent discards all the cards in their hand, then draws three cards.');
    expect(f.templatesUsed).toContain('eff.t6.discardHand.thenDraw');
    expect(understood(f)).toBe(true);
  });
});

describe('p2-zone-moves-1 "that many" after a discard of the whole hand (parser/lower/quantities.ts#resolveNumbers; CR 608.2c)', () => {
  it('after a damage trigger: the cards discarded, not the damage', () => {
    const text = 'Whenever this creature deals damage to a player, that player discards all the cards in their hand, then draws that many cards.';
    expect(level('Creature — Human', text)).toBe('full');
    expect(json('Creature — Human', text)).toContain('"count":{"q":"resultCount","step":"discard"}');
  });
  it('fails closed when the instruction before is not a discard of the whole hand ("discards two cards, then draws that many cards" after damage stays ambiguous)', () => {
    expect(level('Creature — Human', 'Whenever this creature deals damage to a player, that player discards two cards, then draws that many cards.')).not.toBe('full');
  });
});

describe('p2-zone-moves-1 engine', () => {
  it('the new capability forms are the engine\'s', () => {
    expect(ENGINE_CAPABILITIES.has('op:draw.perPlayerCount')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:resultCount.maxPerOwner')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('p2-zone-moves-1 design 6.10 (local index): synthetic examples', () => {
  it('no p2-zone-moves-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = ZM1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
