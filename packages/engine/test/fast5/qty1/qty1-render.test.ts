/**
 * QTY1: render/qty.ts#countParts had three `case 'distinct':` clauses (FAST5 T65, T68, T58), so only T65's ran. They are one case now, each reading tried in
 * turn. The exact render gate (design 6.8, G6) for what that changes and what it must not:
 *
 *   colors among           CR 105.1: "draw a card for each color among artifacts you control" (T65's reading, unchanged)
 *   card types among       CR 205.2a: "draw a card for each card type among cards in your graveyard" (T58's reading, dead before QTY1)
 *   creature types among   CR 205.3m: "draw a card for each creature type among creatures you control" (T58's reading, dead before QTY1)
 *   no "for each" wording  names, basic land types, mana values (DISTINCT_SINGULAR lists none of them)
 */
import { describe, it } from 'vitest';
import type { EffectStep } from '../../../src/types/ability';
import { accepts, rejects, spell, you } from '../../m5/render/build';

const drawFor = (what: string, filter: Record<string, unknown>): EffectStep => ({ op: 'draw', who: you, count: { q: 'distinct', what, among: { ref: 'each', filter } } }) as EffectStep;
const GRAVEYARD = { zone: 'graveyard', owner: 'you', isCard: true };

describe('CR 105.1: "for each color among ..." keeps its readings', () => {
  it('accepts "for each" and "equal to the number of"', () => {
    accepts(spell([drawFor('colors', { controller: 'you', types: ['Artifact'] })]), 'Draw a card for each color among artifacts you control.');
    accepts(spell([drawFor('colors', { controller: 'you', types: ['Artifact'] })]), 'Draw cards equal to the number of colors among artifacts you control.');
    accepts(spell([drawFor('colors', { controller: 'you' })]), 'Draw a card for each color among permanents you control.');
  });
  it('rejects another kind', () => {
    rejects(spell([drawFor('colors', { controller: 'you' })]), 'Draw a card for each card type among permanents you control.');
  });
});

describe('CR 205.2a, 205.3m: "for each card type / creature type among ..." (T58, reachable since QTY1)', () => {
  it('accepts "for each" and "equal to the number of"', () => {
    accepts(spell([drawFor('cardTypes', GRAVEYARD)]), 'Draw a card for each card type among cards in your graveyard.');
    accepts(spell([drawFor('cardTypes', GRAVEYARD)]), 'Draw cards equal to the number of card types among cards in your graveyard.');
    accepts(spell([drawFor('creatureTypes', { controller: 'you', types: ['Creature'] })]), 'Draw a card for each creature type among creatures you control.');
  });
  it('rejects another kind, another set and another rate', () => {
    rejects(spell([drawFor('cardTypes', GRAVEYARD)]), 'Draw a card for each color among cards in your graveyard.');
    rejects(spell([drawFor('cardTypes', GRAVEYARD)]), 'Draw a card for each card type among cards in your hand.');
    rejects(spell([drawFor('cardTypes', GRAVEYARD)]), 'Draw two cards for each card type among cards in your graveyard.');
    rejects(spell([drawFor('creatureTypes', { controller: 'you', types: ['Creature'] })]), 'Draw a card for each card type among creatures you control.');
  });
});

describe('a kind with no singular has no "for each" wording', () => {
  it('rejects "for each mana value among ..." and keeps "equal to the number of"', () => {
    rejects(spell([drawFor('manaValues', { controller: 'you' })]), 'Draw a card for each mana value among permanents you control.');
    accepts(spell([drawFor('manaValues', { controller: 'you' })]), 'Draw cards equal to the number of mana values among permanents you control.');
  });
});
