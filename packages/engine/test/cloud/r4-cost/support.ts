/**
 * r4-cost (Standard round 4: costs, mana and choices): shared helpers of the engine scenarios, on r3-cost's (synthetic cards compiled by the game's default
 * compiler from invented wordings, design 6.10; payment is automatic).
 */
import type { GameState, ObjectId, PlayerId } from '../../../src/index';
import { answer, pass } from '../../m3/scenario';
import { resolveAll, type Script } from '../r3-cost/support';

export * from '../r3-cost/support';

/** Pass until p1 declares attackers this turn, declare `attackers` against p2, then let combat end with no blockers and the stack empty. */
export function attackWith(s0: GameState, attackers: ObjectId[], defender: PlayerId = 'p2', script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  if (s.pending?.kind !== 'declareAttackers') throw new Error('no declare attackers decision');
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender })) });
  for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.zones.stack.length > 0) s = resolveAll(s, script);
    else s = pass(s);
  }
  return s;
}
