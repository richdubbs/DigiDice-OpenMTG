/**
 * Where in the turn the bot holds priority (CR 117, 500-514), as the moments its heuristics care about.
 */
import { controller, isMyTurn, stackTop, step, type Ctx } from './context';

export type Window =
  | 'myMain1' // own precombat main phase, empty stack: lands, removal on blockers, Auras on attackers (CR 505)
  | 'myMain2' // own postcombat main phase: creatures and the rest (CR 505)
  | 'myCombat' // own combat after blockers are declared: tricks (CR 509.2)
  | 'oppAttack' // opponent's declare attackers step: removal on attackers, ambush tokens (CR 508.8)
  | 'oppBlock' // opponent's declare blockers step: tricks on the bot's blockers
  | 'oppEnd' // opponent's end step: instants that were held up (CR 513)
  | 'response' // an opponent's spell or ability is on top of the stack (CR 117.3c)
  | 'other';

export function windowOf(ctx: Ctx): Window {
  const top = stackTop(ctx);
  if (top !== null) return controller(ctx, top) === ctx.me ? 'other' : 'response';
  const s = step(ctx);
  if (isMyTurn(ctx)) {
    if (s === 'main1') return 'myMain1';
    if (s === 'main2') return 'myMain2';
    if (s === 'declareBlockers' && (ctx.view.combat?.attackers.length ?? 0) > 0) return 'myCombat';
    return 'other';
  }
  if (s === 'declareAttackers' && (ctx.view.combat?.attackers.length ?? 0) > 0) return 'oppAttack';
  if (s === 'declareBlockers' && (ctx.view.combat?.blockers.length ?? 0) > 0) return 'oppBlock';
  if (s === 'end') return 'oppEnd';
  return 'other';
}

export const isMain = (w: Window): boolean => w === 'myMain1' || w === 'myMain2';
export const isCombatTrick = (w: Window): boolean => w === 'myCombat' || w === 'oppBlock' || w === 'response';
