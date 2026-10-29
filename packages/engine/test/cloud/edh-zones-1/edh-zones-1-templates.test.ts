/**
 * edh-zones-1 (Commander effort, lane edh-zones): the template data of parser/templates/zz-cloud/edh-zones-1.json and the round's other changes: the Filter feature "with a
 * basic land type" (parser/holes/filter.ts#featureAt, render/np.ts), the player-subject templates of Chaos Warp, "and you untap" (Clause.andYou), the "they" / "that
 * player" of a sentence whose one object is the revealed card (parser/lower/anaphora.ts#playerPutsIt, mentions.ts#ownerSubject), and the port of p2-exile-play-2's
 * "until that player has exiled cards with total mana value N or greater". Guard G9 and G2 as the earlier rounds run them; examples are synthetic (design 6.10). The
 * behavior is in edh-zones-1-scenarios.test.ts. CR cites from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhZones1 from '../../../src/parser/templates/zz-cloud/edh-zones-1.json';
import review from '../../m5/golden/cards/edh-zones-1-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EZ1 = edhZones1 as Template[];
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

const IDS = ['eff.edhz1.player.may.search.desc.bf', 'eff.edhz1.player.put.bf', 'eff.edhz1.player.shuffleInto.thenRevealTop', 'eff.edhz1.you.untap', 'eff.edhz1.exileUntil.total.thatPlayer'];

describe('edh-zones-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-zones-1.json, after zz-cloud/cmd5.json, before zz-cloud/look3.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-zones-1.json');
    expect(files.indexOf('zz-cloud/edh-zones-1.json')).toBeGreaterThan(files.indexOf('zz-cloud/cmd5.json')); // path order
    expect(files.indexOf('zz-cloud/edh-zones-1.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status with its evidence, and is of version 8', () => {
    expect(EZ1.map((t) => t.id)).toEqual(IDS);
    for (const t of EZ1) {
      expect(t.id, t.id).toMatch(/^eff\.edhz1\./);
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
    expect(goldenUsing('eff.edhz1.player.may.search.desc.bf')).toEqual(['Boseiju, Who Endures']);
    expect(goldenUsing('eff.edhz1.player.put.bf')).toEqual(['Chaos Warp']);
    expect(goldenUsing('eff.edhz1.player.shuffleInto.thenRevealTop')).toEqual(['Chaos Warp']);
    expect(goldenUsing('eff.edhz1.you.untap')).toEqual(['Sword of Feast and Famine']);
    expect(goldenUsing('eff.edhz1.exileUntil.total.thatPlayer')).toEqual(["Tasha's Hideous Laughter"]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EZ1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'except', "can't", 'would', 'then', 'when', 'also', 'whenever', 'and', 'all']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-zones-1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EZ1) {
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

describe('edh-zones-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EZ1) {
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

describe('edh-zones-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EZ1) {
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

describe('edh-zones-1 Filter feature "with a basic land type" (parser/holes/filter.ts#featureAt, render/np.ts; CR 205.3i)', () => {
  it('a land card with a basic land type is a land with any of the five basic land types: one JSON, the same wording back', () => {
    const j = json('Sorcery', 'Search your library for a land card with a basic land type, put it onto the battlefield, then shuffle.');
    expect(j).toContain('"types":["Land"],"subtypes":["Plains","Island","Swamp","Mountain","Forest"]');
    expect(level('Sorcery', 'Search your library for a land card with a basic land type, put it onto the battlefield, then shuffle.')).toBe('full');
  });
  it('near misses: "without a basic land type", and "a creature card with a basic land type" are not read', () => {
    expect(level('Sorcery', 'Search your library for a land card without a basic land type, put it onto the battlefield, then shuffle.')).not.toBe('full');
    expect(level('Sorcery', 'Search your library for a creature card with a basic land type, put it onto the battlefield, then shuffle.')).not.toBe('full');
  });
  it('the explicit list of the five land types keeps its own wording (no types: not a "land card with a basic land type")', () => {
    expect(json('Sorcery', 'Search your library for a Plains, Island, Swamp, Mountain, or Forest card and put that card onto the battlefield, then shuffle.')).not.toContain('"types":["Land"],"subtypes"');
  });
});

describe('edh-zones-1 "they" / "that player" as the subject of "put" (parser/lower/anaphora.ts#playerPutsIt; CR 608.2c, 110.2a)', () => {
  const warp = (tail: string): string => `The owner of target land shuffles it into their library, then reveals the top card of their library. ${tail}`;
  it('the revealed card is "it": the one object; "they" and "that player" are the owner', () => {
    expect(level('Instant', warp("If it's a land card, they put it onto the battlefield."))).toBe('full');
    expect(level('Instant', warp("If it's a land card, that player puts it onto the battlefield."))).toBe('full');
  });
  it('near misses: "them", a second "they", another verb or a different destination stay manual or different', () => {
    expect(level('Instant', warp("If it's a land card, they put it onto the battlefield tapped."))).not.toBe('full');
    expect(level('Instant', warp("If it's a land card, they put them onto the battlefield."))).not.toBe('full');
    expect(level('Instant', warp("If it's a land card, they put it into their hand."))).not.toBe('full');
    expect(json('Instant', warp("If it's a land card, they put it onto the battlefield."))).not.toBe(json('Instant', warp("If it's a land card, put it onto the battlefield.")));
  });
});

describe('edh-zones-1 renderer (render/steps-zones.ts move, render/steps.ts joiner; CR 110.2a, 608.2c)', () => {
  it('another player puts the card onto the battlefield: "they put it" or "that player puts it"; yours stays "put it"', () => {
    expect(json('Instant', "Reveal the top card of your library. If it's a land card, put it onto the battlefield.")).not.toContain('"controller":{"ref":"ownerOf"');
  });
  it('"... and you untap ...": after another player\'s clause; a plain "and untap" after your own clause is not changed', () => {
    expect(level('Sorcery', 'Target opponent discards a card and you untap all lands you control.')).toBe('full');
    expect(level('Sorcery', 'Target opponent discards a card and that player untaps all lands you control.')).not.toBe('full');
    expect(level('Sorcery', 'Draw a card and untap all lands you control.')).toBe('full');
  });
});

const index = localIndex();

describe.skipIf(index === null)('edh-zones-1 design 6.10 (local index): synthetic examples', () => {
  it('no edh-zones-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EZ1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
