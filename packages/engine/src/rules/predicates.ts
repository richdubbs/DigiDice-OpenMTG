/**
 * Small predicates shared by the filter evaluator (rules/filter.ts), the history reader (rules/history.ts) and the condition evaluator (effects/eval.ts).
 * Owner: WP4 (a leaf module: it imports types only, so those three can use it without an import cycle).
 */
import type { Cmp, PlayerPred, PlayerRef } from '../types/ability';
import type { PlayerId } from '../types/ids';

/** `a <op> b` for the six comparison operators of the model. */
export function compareNumbers(op: Cmp, a: number, b: number): boolean {
  switch (op) {
    case '<=': return a <= b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
  }
}

/** Resolves a player reference to the players it stands for; `undefined` = it cannot be determined here. */
export type PlayerResolver = (ref: PlayerRef) => PlayerId[] | undefined;

/**
 * Does `player` satisfy `pred`, relative to `you` (the controller of the spell or ability, CR 109.5)? A missing predicate matches everyone.
 * "opponent" is every player but `you` (team games are milestone 12). A reference is looked up through `resolve`; with no resolver or no answer
 * the caller decides what that means (it receives `undefined`).
 */
export function playerPredMatches(pred: PlayerPred | undefined, player: PlayerId, you: PlayerId, resolve?: PlayerResolver): boolean | undefined {
  if (pred === undefined || pred === 'any') return true;
  if (pred === 'you') return player === you;
  if (pred === 'opponent') return player !== you;
  const players = resolve?.(pred);
  return players === undefined ? undefined : players.includes(player);
}
