/**
 * @openmtg/ai: a heuristic AI opponent. Pure and deterministic: no I/O, no Math.random, no Date. It reads only the view the engine gives the bot's player
 * (`viewFor(state, player)`), so it never uses hidden information (CR 400.2), and it answers every decision the engine can pend with a legal action.
 *
 *   const view = viewFor(state, botPlayer);
 *   const action = chooseAction(view, view.pending!, 'bot-seed');
 *   state = applyAction(state, action).state;
 */
import { decidingPlayer, type Action, type Decision, type GameView, type StopSettings } from '@openmtg/engine';
import { answer } from './answers';
import { makeCtx } from './context';
import { choosePriority, rankedPlays } from './priority';

/**
 * The bot's action for `decision`, which must be the view's pending decision for the view's player. The same view, decision and seed always give the same
 * action. Throws if the decision is not the bot's to make.
 */
export function chooseAction(view: GameView, decision: Decision, seed: string): Action {
  // std-control-3 (CR 723.5): a bot that controls another player makes that player's decisions (the action names that player, `decision.player`)
  if (view.viewer !== decidingPlayer(decision)) throw new Error(`chooseAction: the decision belongs to ${decidingPlayer(decision)}, but the view is ${view.viewer ?? 'a spectator'}'s`);
  if (view.result) throw new Error('chooseAction: the game is over.');
  const ctx = makeCtx(view, decision, seed);
  if (decision.kind === 'priority') return choosePriority(ctx);
  const a = answer(ctx, decision);
  if (a === null) return { type: 'cancel', player: decision.player }; // CR 733.1
  return { type: 'answer', player: decision.player, decisionId: decision.id, answer: a };
}

/** For tests and debugging: the bot's ranked priority plays (highest score first), without choosing. */
export function explainPriority(view: GameView, seed: string): { label: string; score: number }[] {
  if (!view.pending || view.pending.kind !== 'priority' || view.viewer !== decidingPlayer(view.pending)) return [];
  return rankedPlays(makeCtx(view, view.pending, seed)).map(({ label, score }) => ({ label, score }));
}

/**
 * Stops the bot wants (CR 117; the engine's Arena-style auto-pass skips any other step where it has nothing to do): its main phases and its combat after
 * blocks on its own turn; the opponent's upkeep, declare attackers and blockers steps and end step for instants.
 */
export const AI_STOPS: StopSettings = {
  ownTurn: ['main1', 'declareBlockers', 'main2'],
  opponentTurn: ['upkeep', 'declareAttackers', 'declareBlockers', 'end'],
  fullControl: false,
};
