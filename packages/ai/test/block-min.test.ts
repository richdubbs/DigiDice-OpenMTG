/**
 * FAST5 T57: "~ can't be blocked except by three or more creatures" (CR 509.1b; menace is the same with two, CR 702.111b) is a minimum on the set of blockers of
 * one attacker. The declare blockers decision says it (`minBlockers`), and the AI never answers with fewer blockers than that: a single or double block is
 * rejected by the engine, and the declaration is not cancellable, so an AI that tried one would be stuck (client/src/game/computer.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, viewFor, type CardDef, type DeclareBlockersDecision, type GameState, type OracleCard } from '@openmtg/engine';
import { find, scenario } from '../../engine/test/m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../engine/test/m4/helpers';
import { chooseAction } from '../src/index';

function card(name: string, type: string, text: string, pt: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], power: pt[0], toughness: pt[1] } as OracleCard);
}
const TROLL = card('Test Troll', 'Creature — Troll', "This creature can't be blocked except by three or more creatures.", ['6', '6']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);

function toBlocks(blockers: number): { s: GameState; attacker: string } {
  const s0 = scenario([], { p1: { battlefield: ['Test Troll'] }, p2: { battlefield: Array(blockers).fill('Test Ogre') as string[] }, defs: [TROLL, OGRE] });
  const a = find(s0, 'Test Troll', 'battlefield', 'p1');
  const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[a]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
  return { s, attacker: a };
}
const aiAnswer = (s: GameState) => { const v = viewFor(s, 'p2'); return chooseAction(v, v.pending!, 'block-min'); };

describe('CR 509.1b: the AI and an attacker that needs three blockers', () => {
  it('the decision says the minimum (minBlockers: 3)', () => {
    const { s, attacker } = toBlocks(3);
    expect((s.pending as DeclareBlockersDecision).minBlockers).toEqual([{ attacker, min: 3 }]);
  });
  it('whatever the AI answers, the engine accepts it: no block, or three blockers on the attacker, never one or two', () => {
    for (const n of [3, 4]) {
      const { s, attacker } = toBlocks(n);
      const a = aiAnswer(s);
      expect(a.type).toBe('answer');
      if (a.type !== 'answer' || a.answer.kind !== 'declareBlockers') throw new Error('not a declaration');
      const onTroll = a.answer.blocks.filter((b) => b.attacker === attacker).length;
      expect([0, 3, 4].includes(onTroll), `${onTroll} blockers`).toBe(true);
      expect(applyAction(s, a).error).toBeUndefined();
    }
  });
  it('a lethal attacker with three able blockers: the AI chump blocks with three (not two), as the engine requires', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Troll'] }, p2: { battlefield: ['Test Ogre', 'Test Ogre', 'Test Ogre'] }, defs: [TROLL, OGRE], life: 5 });
    const a = find(s0, 'Test Troll', 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[a]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    const ans = aiAnswer(s);
    if (ans.type !== 'answer' || ans.answer.kind !== 'declareBlockers') throw new Error('not a declaration');
    expect(ans.answer.blocks.filter((b) => b.attacker === a).length).toBe(3);
    expect(applyAction(s, ans).error).toBeUndefined();
  });
});
