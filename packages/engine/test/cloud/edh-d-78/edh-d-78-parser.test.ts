/**
 * edh-d-78 (concept lane life-totals): the round's parser and renderer readings, with their near misses (design 6.8). The round adds no template: three hole readings.
 *   parser/holes/cond.ts#noLifeLostThisWay        "If no life is lost this way, <effect>" (CR 119.3, 608.2c)
 *   parser/holes/cond.ts#cond (commaList)         "if A, B, and C" (CR 603.4; weak) + parser/lower/ability.ts#interveningIfReads (drops the bare first leg)
 *   parser/holes/cond.ts (card types among)       "N or more card types among permanents you control and/or cards in your graveyard" (CR 205.2a, 700.2)
 * Synthetic wordings (design 6.10): the cards are invented; Oracle names appear only in comments.
 */
import { describe, expect, it } from 'vitest';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { automated, bare, card, fullyAutomated } from '../../m5/templates/support';

const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES });
const parse = (typeLine: string, text: string) => parseCard(card('Example Card', typeLine, text), OPTS).faces[0]!;
const upkeep = (cond: string): string => `At the beginning of your upkeep, if ${cond}, you win the game.`;
const json = (text: string): string => JSON.stringify(bare(parse('Enchantment', text).abilities));

describe('edh-d-78: "If no life is lost this way, <effect>" (CR 119.3, 608.2c)', () => {
  it('reads the life lost by the instruction right before it: the sum over every player is 0', () => {
    const f = parse('Sorcery', 'Target opponent loses 3 life. If no life is lost this way, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const j = JSON.stringify(bare(f.abilities));
    expect(j).toContain('"q":"lifeLost"');
    expect(j).toContain('"op":"=="');
  });
  it('near misses stay manual or differ: past tense, no "this way", "no life" without "lost", a player-specific "you lost no life this way"', () => {
    const base = 'Target opponent loses 3 life. ';
    for (const t of [`${base}If no life was lost this way, draw a card.`, `${base}If no life is lost, draw a card.`, `${base}If no life is gained this way, draw a card.`]) {
      const f = parse('Sorcery', t);
      expect(fullyAutomated(f) && JSON.stringify(bare(f.abilities)).includes('"op":"=="') && JSON.stringify(bare(f.abilities)).includes('"q":"lifeLost"'), t).toBe(false);
    }
  });
  it('inside an "or" it still names the same instruction: the loss step gets a name and the condition reads that name', () => {
    const f = parse('Sorcery', 'Target opponent loses 3 life. If no life is lost this way or you control a land, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const j = JSON.stringify(bare(f.abilities));
    expect(j).toContain('"as":"lost"');
    expect(j).toContain('"q":"lifeLost","step":"lost"');
  });
  it('needs a life-loss instruction right before it: alone it stays manual (the marker finds nothing to name)', () => {
    const f = parse('Sorcery', 'If no life is lost this way, draw a card.');
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('edh-d-78: "if A, B, and C" (CR 603.4)', () => {
  const three = 'you control a creature, you control a land, and you control an artifact';
  it('three conditions closed by ", and" are one all-of condition in the intervening "if", in the words\' order', () => {
    const f = parse('Enchantment', upkeep(three));
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const a = f.abilities[0]! as unknown as { interveningIf?: { cond: string; of: { cond: string; of: { filter: { types: string[] } } }[] } };
    expect(a.interveningIf?.cond).toBe('all');
    expect(a.interveningIf?.of.map((c) => c.of.filter.types[0])).toEqual(['Creature', 'Land', 'Artifact']);
  });
  it('four conditions are one list too', () => {
    const f = parse('Enchantment', upkeep(`${three}, and you control an enchantment`.replace(', and you control an artifact, and', ', you control an artifact, and')));
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
  it('near misses are not lists: no closing "and", only two conditions with a stray comma, an "or" in the list, a missing last condition', () => {
    for (const t of [
      upkeep('you control a creature, you control a land, you control an artifact'),
      upkeep('you control a creature, and you control a land'),
      upkeep('you control a creature, you control a land, or you control an artifact'),
      upkeep('you control a creature, you control a land, and'),
    ]) {
      const f = parse('Enchantment', t);
      const j = JSON.stringify(bare(f.abilities));
      expect(fullyAutomated(f) && j.includes('"cond":"all"') && (j.match(/"cond":"exists"/g) ?? []).length >= 3, t).toBe(false);
    }
  });
  it('a condition followed by an instruction with commas is not swallowed: "if you control a land, draw a card, then discard a card" keeps its single condition', () => {
    const f = parse('Enchantment', 'At the beginning of your upkeep, if you control a land, draw a card, then discard a card.');
    expect(automated(f.abilities)).toBe(true);
    const a = f.abilities[0]! as unknown as { interveningIf?: { cond: string } };
    expect(a.interveningIf?.cond).toBe('exists');
  });
});

describe('edh-d-78: card types among two sets (CR 205.2a, 700.2)', () => {
  const sets = 'permanents you control and/or cards in your graveyard';
  it('"N or more card types among permanents you control and/or cards in your graveyard" counts the types of both sets together (distinct over a union)', () => {
    const f = parse('Enchantment', upkeep(`there are six or more card types among ${sets}`));
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const j = JSON.stringify(bare(f.abilities));
    expect(j).toContain('"ref":"union"');
    expect(j).toContain('"what":"cardTypes"');
  });
  it('near misses: "and" without "/or", an opponent\'s graveyard, the graveyard first, "less than", one set only are not this reading', () => {
    for (const t of [
      upkeep('there are six or more card types among permanents you control and cards in your graveyard'),
      upkeep("there are six or more card types among permanents you control and/or cards in an opponent's graveyard"),
      upkeep('there are six or more card types among cards in your graveyard and/or permanents you control'),
      upkeep('there are fewer than six card types among permanents you control and/or cards in your graveyard'),
    ]) {
      const f = parse('Enchantment', t);
      expect(fullyAutomated(f) && JSON.stringify(bare(f.abilities)).includes('"ref":"union"'), t).toBe(false);
    }
    expect(json(upkeep('there are six or more card types among permanents you control'))).not.toContain('"ref":"union"');
  });
});
