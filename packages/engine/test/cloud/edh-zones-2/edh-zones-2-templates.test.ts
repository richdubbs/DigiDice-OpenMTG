/**
 * edh-zones-2 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-2.json and the round's other changes: a devotion "where X is" kept
 * for the library sentences after it and "If X is greater than or equal to <quantity>" (parser/lower/quantities.ts, parser/holes/cond.ts#compareForm), the renderer folds and
 * alternatives (render/fold.ts, refs.ts, cond.ts, steps-cards.ts), and the promotion of eff.stdrx3.permit.free.play.obj.durFirst. Guard G9 and G2 as the earlier rounds run
 * them; examples are synthetic (design 6.10). The
 * behavior is in edh-zones-2-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones2 from '../../../src/parser/templates/zz-cloud/edh-zones-2.json';
import review from '../../m5/golden/cards/edh-zones-2-review.json';
import rx3Review from '../../m5/golden/cards/cloud-std-rx3-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ2 = edhZones2 as Template[];
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

const IDS = ['eff.edhz2.dig.upTo.top.restBottom', 'eff.edhz2.shuffle.thenExileTop', 'eff.edhz2.milled.put.anyCard.hand', 'eff.edhz2.dig.three.handBottomExile'];

describe('edh-zones-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-2.json, after zz-cloud/cmd5.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-2.json');
    expect(files.indexOf('zz-cloud/edh-zones-2.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-2.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ2.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ2) {
      expect(t.id, t.id).toMatch(/^eff\.edhz2\./);
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
    expect(goldenUsing('eff.edhz2.dig.upTo.top.restBottom')).toEqual(["Thassa's Oracle"]);
    expect(goldenUsing('eff.edhz2.shuffle.thenExileTop')).toEqual(['Urza, Lord High Artificer']);
    expect(goldenUsing('eff.edhz2.milled.put.anyCard.hand')).toEqual(['Ripples of Undeath']);
    expect(goldenUsing('eff.edhz2.dig.three.handBottomExile')).toEqual(['Expressive Iteration']);
    // eff.stdrx3.permit.free.play.obj.durFirst, promoted this round on two golden cards (a 6.9 deviation named in the round record)
    expect([...goldenUsing('eff.stdrx3.permit.free.play.obj.durFirst'), ...goldenUsing('eff.stdrx3.permit.free.play.obj.durFirst', rx3Review as Golden)].sort()).toEqual(["Mind's Desire", 'Urza, Lord High Artificer']); // Mind's Desire is pinned in std-rx3's own review file, which that round's test reads
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ2) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-2 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ2) {
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
    [/\bonto the battlefield\b/, 'into their hand'], [/\bthe top card\b/, 'the top two cards'], [/\byou untap\b/, 'they untap'], [/\bor greater\b/, 'or less'],
    [/\bcard with\b/, 'card without'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-zones-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ2) {
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

describe('edh-zones-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ2) {
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

const LOOK_X = 'look at the top X cards of your library, where X is your devotion to blue.';
const OTHER_X = 'look at the top X cards of your library, where X is the number of lands you control.';
const PUT = 'Put up to one of them on top of your library and the rest on the bottom of your library in a random order.';
const WIN = 'If X is greater than or equal to the number of cards in your library, you win the game.';
const oracle = (...sentences: string[]): string => `When this creature enters, ${sentences.join(' ')}`;

describe('edh-zones-2 "where X is" kept for the sentences after (parser/lower/quantities.ts) and "If X is greater than or equal to <quantity>" (parser/holes/cond.ts#compareForm; CR 107.3, 608.2h)', () => {
  it('a devotion defined in the look sentence is the X of the comparison two sentences later (only library moves between): one card, full, the comparison reads the devotion', () => {
    const text = oracle(LOOK_X, PUT, WIN);
    expect(level('Creature — Merfolk Wizard', text)).toBe('full');
    expect(json('Creature — Merfolk Wizard', text)).toContain('"cond":"compare","left":{"q":"devotion"');
    expect(json('Creature — Merfolk Wizard', text)).not.toContain('"q":"X"');
  });
  it('near misses: no sentence defines X, a bare number, or another sentence between that is not a library move: not read', () => {
    expect(level('Sorcery', `Look at the top three cards of your library. ${WIN}`)).not.toBe('full');
    expect(level('Sorcery', 'If X is 5 or more, you win the game.')).not.toBe('full');
    expect(level('Creature — Merfolk Wizard', oracle(LOOK_X, 'Draw a card.', WIN))).not.toBe('full');
  });
  it('a count (not a devotion) is kept for the next sentence only, as before: two sentences later its X is not read', () => {
    expect(level('Creature — Merfolk Wizard', oracle(OTHER_X, PUT, WIN))).not.toBe('full');
    expect(level('Sorcery', 'Draw X cards, where X is the number of creatures you control. Discard a card. You gain X life.')).not.toBe('full');
    expect(level('Sorcery', 'Draw X cards, where X is the number of creatures you control. You gain X life.')).toBe('full');
  });
  it('a sentence that defines its own X ends the carried one', () => {
    expect(json('Creature — Merfolk Wizard', oracle(LOOK_X, PUT, 'You gain X life, where X is the number of lands you control.'))).toContain('"q":"count"');
  });
});

describe('edh-zones-2 renderer (render/refs.ts topCards, render/cond.ts compare, render/fold.ts, render/steps-cards.ts search; CR 107.3, 608.2h)', () => {
  it('"mana value X or less, where X is ..." after a search is read back; a bare computed bound and the plain wording both stay full', () => {
    expect(level('Sorcery', 'Search your library for a creature card with mana value X or less, where X is the number of lands you control. Put that card onto the battlefield, then shuffle.')).toBe('full');
    expect(level('Sorcery', 'Search your library for a creature card with mana value 3 or less. Put that card onto the battlefield, then shuffle.')).toBe('full');
  });
  it('near misses: "X or more", and X without its "where" clause, are not read as the computed bound', () => {
    expect(level('Sorcery', 'Search your library for a creature card with mana value X or less. Put that card onto the battlefield, then shuffle.')).not.toBe('full');
  });
  it('"Shuffle your library, then exile the top card." keeps the two-sentence wording of the same steps ("Shuffle your library. Then exile the top card of your library.")', () => {
    const a = 'Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.';
    const b = 'Shuffle your library. Then exile the top card of your library. Until end of turn, you may play that card without paying its mana cost.';
    expect(level('Sorcery', a)).toBe('full');
    expect(level('Sorcery', b)).toBe('full');
    expect(jsonKey(face(a, 'Sorcery').abilities)).toBe(jsonKey(face(b, 'Sorcery').abilities)); // the same steps
    expect(level('Sorcery', 'Shuffle your library, then exile the top two cards. Until end of turn, you may play those cards.')).not.toBe('full');
  });
  it('"Put a card from among those cards into your hand." names the cards a mill put into a graveyard, and (edh-zones-7) the cards of a look', () => {
    expect(level('Sorcery', 'Mill three cards. Then you may pay {1}. If you do, put a card from among those cards into your hand.')).toBe('full');
    // edh-zones-7 (eff.edhz7.dig.put.oneCard.hand, CR 701.20a, 608.2h) reads "from among those cards" after a look as the looked-at cards still in the library; edh-zones-2 read only
    // the mill. Both readings are right for their own verb, so the look sentence is now automated (the cards not taken stay where they were: nothing else is said about them).
    expect(level('Sorcery', 'Look at the top three cards of your library. Put a card from among those cards into your hand.')).toBe('full');
    expect(level('Sorcery', 'Exile the top three cards of your library. Put a card from among those cards into your hand.')).not.toBe('full');
  });
});

describe('edh-zones-2 promotion of eff.stdrx3.permit.free.play.obj.durFirst (CR 118.9, 601.2b, 611.2a, 305.1)', () => {
  it('is stable now: a card with only this reading is full; the permission to cast "without paying" stays one JSON for a land and a spell', () => {
    const t = TEMPLATE_SET.find((x) => x.id === 'eff.stdrx3.permit.free.play.obj.durFirst')!;
    expect(t.status).toBe('stable');
    expect(level('Sorcery', 'Exile the top card of your library. Until end of turn, you may play that card without paying its mana cost.')).toBe('full');
    expect(level('Sorcery', 'Exile the top card of your library. Until end of turn, you may play that card.')).toBe('full'); // the plain permission (another template), unchanged
  });
});


const index = localIndex();

describe.skipIf(index === null)('edh-zones-2 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ2.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
