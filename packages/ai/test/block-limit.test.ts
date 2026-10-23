/**
 * MX5 review: "~ can't be blocked by more than one creature" (CR 509.1b) is a limit on the set of blockers of one attacker. The declare blockers decision
 * says it (`maxBlockers`), and the AI never answers with more blockers than that: a double block is rejected by the engine, and the declaration is not
 * cancellable, so an AI that tried one would be stuck (client/src/game/computer.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, blockCandidates, compileCard, viewFor, type CardDef, type DeclareBlockersDecision, type GameState, type OracleCard } from '@openmtg/engine';
import { find, scenario } from '../../engine/test/m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../engine/test/m4/helpers';
import { chooseAction } from '../src/index';

function card(name: string, type: string, text: string, pt: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], power: pt[0], toughness: pt[1] } as OracleCard);
}
const RHINO = card('Test Rhino', 'Creature — Rhino', "This creature can't be blocked by more than one creature.", ['5', '5']);
const BRUTE = card('Test Brute', 'Creature — Ogre', "Menace\nThis creature can't be blocked by more than one creature.", ['5', '5']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);

function toBlocks(attacker: string, def: CardDef): { s: GameState; attacker: string } {
  const s0 = scenario([], { p1: { battlefield: [attacker] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] }, defs: [def, OGRE] });
  const a = find(s0, attacker, 'battlefield', 'p1');
  const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[a]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
  return { s, attacker: a };
}
const aiAnswer = (s: GameState) => { const v = viewFor(s, 'p2'); return chooseAction(v, v.pending!, 'block-limit'); };

describe('CR 509.1b: the AI and a block-limited attacker', () => {
  it('the decision says the limit (maxBlockers: 1)', () => {
    const { s, attacker } = toBlocks('Test Rhino', RHINO);
    const d = s.pending as DeclareBlockersDecision;
    expect(d.maxBlockers).toEqual([{ attacker, max: 1 }]);
  });
  it('a 5/5 that can\'t be blocked by more than one creature into two 3/3s: the AI does not double block, and the engine accepts its answer', () => {
    const { s, attacker } = toBlocks('Test Rhino', RHINO);
    const a = aiAnswer(s);
    expect(a.type).toBe('answer');
    if (a.type !== 'answer' || a.answer.kind !== 'declareBlockers') throw new Error('not a declaration');
    expect(a.answer.blocks.filter((b) => b.attacker === attacker).length).toBeLessThanOrEqual(1);
    expect(applyAction(s, a).error).toBeUndefined();
  });
  it('menace and the limit (CR 702.111b, 509.1b): no legal block exists, so the attacker is not offered and no blocker decision is asked', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Brute'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre'] }, defs: [BRUTE, OGRE] });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p1');
    const attacked = declareAttackers(toDeclareAttackers(s0), [[brute]]);
    const offered = blockCandidates(attacked, 'p2');
    expect(offered.candidates.some((c) => c.attackers.includes(brute))).toBe(false);
    expect(offered.needsMultiple).toEqual([]);
    const after = passUntil(attacked, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'blockers or damage');
    expect(after.pending?.kind).not.toBe('declareBlockers');
  });
});
