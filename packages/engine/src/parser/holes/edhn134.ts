/**
 * edh-next-134 (MUST-FINISH round, group control; template code edhn134): readings of the `Cond` hole (parser/holes/cond.ts#atoms).
 *  - "two or more players have lost the game" (CR 104.3, 800.4a; Hot Pursuit): the number of players of the game who have lost it (`{q:'playersLost'}`, edh-next-95; players who
 *    left still count) compared with N: `{cond:'compare', left:{q:'playersLost'}, op:'>=', right:N}`. Only "N or more" with N of two or more ("a player has lost the game" is
 *    another wording, not read here).
 */
import type { Condition } from '../../types/ability';
import type { Alt, HoleCtx } from './core';
import { P, numberAt, phraseAt } from './core';

const W_OR_MORE_PLAYERS_LOST = P('or more players have lost the game');

export function edhn134CondAt(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const n = numberAt(ctx, pos);
  if (n !== undefined && n >= 2) {
    const e = phraseAt(ctx, pos + 1, W_OR_MORE_PLAYERS_LOST);
    if (e >= 0) out.push({ end: e, value: { cond: 'compare', left: { q: 'playersLost' }, op: '>=', right: n } as Condition });
  }
  return out;
}
