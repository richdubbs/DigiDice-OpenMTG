/**
 * r3-cost: the cost "Sacrifice three artifact tokens with different names" (Transmutation Font; types CostPart sacrifice.distinctNames, rules/cost-pick.ts),
 * played with synthetic cards (design 6.10).
 *
 *   CR 118.3, 201.2   three tokens with three different names pay it; two with the same name and a third do not; a choice of two with the same name is refused
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState } from '../../../src/index';
import { act, activations, answer, card, full, legal, scenario } from './support';

const FONT = card('Test Token Font', 'Artifact', '{T}, Sacrifice three artifact tokens with different names: Draw a card.', '{1}');
const CLUE = card('Test Clue', 'Artifact — Clue', '', '{0}');
const FOOD = card('Test Food', 'Artifact — Food', '', '{0}');
const BLOOD = card('Test Blood', 'Artifact — Blood', '', '{0}');
const DEFS = [FONT, CLUE, FOOD, BLOOD];

/** Turn the cards into tokens (they stand for Clue, Food and Blood tokens). */
function tokens(s0: GameState): GameState {
  const s = structuredClone(s0);
  for (const id of s.zones.battlefield) if (s.objects[id]!.defId !== 'Test Token Font') s.objects[id]!.kind = 'token';
  return s;
}

describe('r3-cost: "Sacrifice three artifact tokens with different names" (CR 118.3, 201.2)', () => {
  it('is automated', () => {
    expect(full(FONT)).toBe(true);
  });
  it('a Clue, a Food and a Blood pay it; two Clues and a Food do not', () => {
    const ok = tokens(scenario([], { defs: DEFS, p1: { battlefield: ['Test Token Font', 'Test Clue', 'Test Food', 'Test Blood'], library: ['Test Clue'] } }));
    expect(activations(ok, 'Test Token Font')).toHaveLength(1);
    const dup = tokens(scenario([], { defs: DEFS, p1: { battlefield: ['Test Token Font', 'Test Clue', 'Test Clue', 'Test Food'] } }));
    expect(activations(dup, 'Test Token Font')).toEqual([]);
  });
  it('with two Clues among four tokens, a choice of both Clues is refused; three different ones are sacrificed', () => {
    let s = tokens(scenario([], { defs: DEFS, p1: { battlefield: ['Test Token Font', 'Test Clue', 'Test Clue', 'Test Food', 'Test Blood'], library: ['Test Clue'] } }));
    s = act(s, activations(s, 'Test Token Font')[0]!.action);
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseObjects' }>;
    const clues = p.options.filter((id) => s.objects[id]!.defId === 'Test Clue');
    const others = p.options.filter((id) => s.objects[id]!.defId !== 'Test Clue');
    expect(applyAction(s, { type: 'answer', player: 'p1', answer: { kind: 'chooseObjects', ids: [...clues, others[0]!] } } as never).error).toBeDefined();
    s = answer(s, { kind: 'chooseObjects', ids: [clues[0]!, ...others] });
    const left = s.zones.battlefield.map((id) => s.objects[id]!.defId).sort();
    expect(left).toEqual(['Test Clue', 'Test Token Font']);
    expect(legal(s, 'p1').length).toBeGreaterThan(0);
  });
});
