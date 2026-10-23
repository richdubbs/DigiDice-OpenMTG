/**
 * The priority decision (CR 117): the best-scoring action among `legalActions`, or pass. Every listed action is accepted by the engine (ARCHITECTURE.md,
 * "legal actions"), so the bot never tries an illegal play. If the bot cancelled its last attempts (a target or payment turned out worse than estimated,
 * CR 733.1), the state is back where it was and the bot moves on to its next preference instead of trying the same thing again.
 */
import { decidingPlayer, isByHandKind, legalActions, type Action } from '@openmtg/engine';
import { controller, stackTop, tieKey, type Ctx } from './context';
import { scoreAction } from './plays';
import { windowOf } from './windows';

export interface Scored { action: Action; label: string; score: number }

export function rankedPlays(ctx: Ctx): Scored[] {
  const w = windowOf(ctx);
  // The bot's own spell or ability is on top: let it resolve (CR 117.4).
  const top = stackTop(ctx);
  if (top !== null && controller(ctx, top) === ctx.me) return [];
  const out: (Scored & { tie: number })[] = [];
  // std-control-3 (CR 723.5): a bot that controls the player with priority is asked for that player's actions (they name `ctx.me`, the player who acts)
  for (const la of legalActions(ctx.state, decidingPlayer(ctx.decision))) {
    // MRE: the by-hand tools for manual triggered and static abilities are never used: the computer resolves nothing by hand (C6 gap 8), and an action it
    // could take at every priority would keep the game from moving on.
    if (la.kind === 'pass' || la.isMana || isByHandKind(la.kind)) continue;
    const score = scoreAction(ctx, la, w);
    if (score > 0) out.push({ action: la.action, label: la.label, score, tie: tieKey(ctx, JSON.stringify(la.action)) });
  }
  // Equally good plays (two copies of a card) are ordered by the seed; the order survives a cancel, so the planner skips the same plays.
  return out.sort((a, b) => b.score - a.score || a.tie - b.tie).map(({ action, label, score }) => ({ action, label, score }));
}

export function choosePriority(ctx: Ctx): Action {
  const ranked = rankedPlays(ctx);
  return ranked[ctx.cancels]?.action ?? { type: 'pass', player: ctx.me };
}
