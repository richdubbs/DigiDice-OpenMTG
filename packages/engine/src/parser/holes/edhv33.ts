/**
 * edh-c-33 ADDITION: readings of the `Cond` hole (parser/holes/cond.ts#atoms) for the turn's history of the source and of you (CR 603.4, intervening "if"):
 *  - "~ didn't attack this turn" (CR 508.1: the object was not declared as an attacker this turn);
 *  - "~ attacked or blocked this turn" (CR 508.1, 509.1: declared as an attacker or as a blocker this turn);
 *  - "you didn't play a land this turn" (CR 305.1, 305.2: no land was played by you this turn, from any zone).
 * Each is a value the engine already evaluates (the history's `attacks`, `blocks` and `playLand` entries, rules/history.ts); only the negations and the "or" are new.
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, phraseAt } from './core';

const W_DIDNT_ATTACK_THIS_TURN = [P("didn't attack this turn"), P('did not attack this turn')];
const W_ATTACKED_OR_BLOCKED_THIS_TURN = P('attacked or blocked this turn');
const W_YOU_DIDNT_PLAY_A_LAND_THIS_TURN = [P("you didn't play a land this turn"), P('you did not play a land this turn')];

const W_DEFENDING_PLAYER_IS_MONARCH = [P('defending player is the monarch')];

const attacked: Condition = { cond: 'happened', event: { ev: 'attacks', attacker: { self: true } }, scope: 'turn' };
const blocked: Condition = { cond: 'happened', event: { ev: 'blocks', blocker: { self: true } }, scope: 'turn' };
const playedLand: Condition = { cond: 'happened', event: { ev: 'action', verb: 'playLand', actor: 'you' }, scope: 'turn' };

export function edhv33CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  if (ctx.toks[pos]?.kind === 'SELF') {
    for (const w of W_DIDNT_ATTACK_THIS_TURN) {
      const e = phraseAt(ctx, pos + 1, w);
      if (e >= 0) out.push({ end: e, value: { cond: 'not', of: attacked } });
    }
    const ab = phraseAt(ctx, pos + 1, W_ATTACKED_OR_BLOCKED_THIS_TURN);
    if (ab >= 0) out.push({ end: ab, value: { cond: 'any', of: [attacked, blocked] } });
  }
  for (const w of W_YOU_DIDNT_PLAY_A_LAND_THIS_TURN) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: playedLand } });
  }
  // CR 725.1, 508.1b; Crown-Hunter Hireling: "can't attack unless defending player is the monarch": the player the creature would attack is the monarch (read per defender, as
  // "defending player controls an Island" is)
  for (const w of W_DEFENDING_PLAYER_IS_MONARCH) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'designation', who: { ref: 'defending' }, what: 'monarch' } as Condition });
  }
  return out;
}
