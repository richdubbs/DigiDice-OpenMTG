/**
 * std-library-5 (account B lane std-library; Say Its Name, approved by the owner through coordinator A, docs/coordination/NOTES-A.md 2026-10-21 15:00 UTC): the
 * round's parser and renderer changes, no template of its own:
 *  - Cost (parser/holes/cost.ts#exile; CR 118.3, 113.6k, 201.2): "Exile ~ and two other cards named ... from your graveyard": the source's own part and the other cards'
 *    part of the same graveyard, so the ability functions in the graveyard; rendered by render/costs.ts#costParts (one verb, the zone said once);
 *  - Name (parser/holes/misc.ts#name; CR 201.2): an epithet after the comma ("Altanak, the Thrice-Called") in the middle of a sentence.
 * The G10 change of Say Its Name's formerly manual unit 0:1:0 (its kept zone, ["battlefield"], becomes ["graveyard"]) is intended and recorded. The behavior is in
 * std-library-5-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import review from '../../m5/golden/cards/cloud-std-library-5-review.json';

const compiled = (type: string, text: string) =>
  compileCard({ name: 'Example Relic', layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(type.includes('Creature') ? { power: '2', toughness: '2' } : {}) } as OracleCard);
const level = (type: string, text: string): string => compiled(type, text).automation.level;
const json = (type: string, text: string): string => JSON.stringify(compiled(type, text).faces);

describe('std-library-5 golden (design 6.9; guide section 6)', () => {
  it('every entry is pinned full and cites rules', () => {
    for (const g of review as { card: string; expect?: string; verified: string }[]) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
    expect((review as { card: string }[]).map((g) => g.card)).toEqual(['Say Its Name']);
  });
});

describe('std-library-5 Cost (parser/holes/cost.ts#exile; CR 118.3, 113.6k, 201.2)', () => {
  it('"Exile ~ and two other cards named ~ from your graveyard": the source\'s part and the others\', the ability activated from the graveyard', () => {
    const text = 'Draw a card.\nExile this card and two other cards named Example Relic from your graveyard: Draw a card. Activate only as a sorcery.';
    expect(level('Sorcery', text)).toBe('full');
    const j = json('Sorcery', text);
    expect(j).toContain('"other":[{"kind":"exileFrom","zone":"graveyard","count":1,"self":true},{"kind":"exileFrom","zone":"graveyard","count":2,"filter":{"other":true,"name":"Example Relic"}}]');
    expect(j).toContain('"zone":["graveyard"]');
  });
  it('another description of the other cards: "two other creature cards"', () => {
    expect(level('Creature — Elf', 'Exile this card and two other creature cards from your graveyard: Draw a card. Activate only as a sorcery.')).toBe('full');
  });
  it('fails closed: one other card ("and another card"), cards that are not "other", and another player\'s graveyard are not read so', () => {
    expect(level('Sorcery', 'Draw a card.\nExile this card and another card named Example Relic from your graveyard: Draw a card.')).not.toBe('full');
    expect(level('Sorcery', 'Draw a card.\nExile this card and two cards named Example Relic from your graveyard: Draw a card.')).not.toBe('full');
    expect(level('Sorcery', "Draw a card.\nExile this card and two other cards from an opponent's graveyard: Draw a card.")).not.toBe('full');
  });
});

describe('std-library-5 Name (parser/holes/misc.ts#name; CR 201.2): an epithet after the comma', () => {
  it('"a card named Varrok, the Twice-Bound and put it ...": the whole name, in the middle of the sentence', () => {
    const text = 'Search your graveyard, hand, and/or library for a card named Varrok, the Twice-Bound and put it onto the battlefield. If you search your library this way, shuffle.';
    expect(level('Sorcery', text)).toBe('full');
    expect(json('Sorcery', text)).toContain('"filter":{"name":"Varrok, the Twice-Bound"}');
  });
  it('a comma not followed by "the" and a capitalized word is not read as part of the name', () => {
    expect(level('Sorcery', 'Search your library for a card named Varrok, the twice-bound and put it onto the battlefield. Then shuffle.')).not.toBe('full');
  });
});
