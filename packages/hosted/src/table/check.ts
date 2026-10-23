/**
 * The table's checks of an action before the engine sees it (design 6.1). Pure functions over the full state (the actor's own), the moved logic of
 * milestone 9's `checkClientAction` (packages/server/src/online/messages.ts). The engine then decides (CR 733); these checks only refuse early and give
 * the browser a precise error code.
 */
import { legalActions, STEP_ORDER, type Action, type Decision, type GameState, type LegalAction, type PlayerId, type StopSettings } from '@openmtg/engine';
import { checkAction } from '@openmtg/net/server-kit';
import { actionTextProblem, type HostedError } from '../api';

/**
 * Step 1 of 6.1 again, inside the table (the gateway checks it first; a table never trusts a message): net's `checkAction` (type, player, fields,
 * depth 12, 8,192 values, 64 KB) and the hosted string check (`actionTextProblem`: NUL, unpaired surrogates, control and bidi characters; 500 and 200
 * character limits). Null: the shape passes.
 */
export function actionShapeProblem(action: unknown): HostedError | null {
  let problem: string | null;
  try {
    problem = checkAction(action);
  } catch {
    problem = 'action malformed';
  }
  if (problem) return { code: 'badMessage', message: `Action rejected: ${problem}.` };
  const text = actionTextProblem(action);
  if (text) return { code: 'badMessage', message: `Action rejected: ${text.message}` };
  return null;
}

/** Actions that need priority (CR 117.1): they must be one of the player's legal actions (the by-hand tools are checked by the engine). */
const PRIORITY: ReadonlySet<Action['type']> = new Set<Action['type']>(['pass', 'playLand', 'cast', 'activate', 'special']);
const PRIORITY_TOOLS: ReadonlySet<Action['type']> = new Set<Action['type']>(['manualTrigger', 'manualStatic']);

function sameLegal(a: Action, l: LegalAction): boolean {
  const b = l.action;
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'pass':
      return true;
    case 'playLand':
    case 'cast':
      return a.card === (b as typeof a).card;
    case 'activate':
      return a.source === (b as typeof a).source && a.ability === (b as typeof a).ability;
    case 'special': {
      const s = b as typeof a;
      return a.kind === s.kind && a.object === s.object && (a.via === undefined || a.via === s.via) && (a.door === undefined || a.door === s.door) && (a.option === undefined || a.option === s.option); // door: FAST5X E8; option: std-freecast-5
    }
    default:
      return false;
  }
}

/**
 * Steps 3 and 5 of 6.1 on the full state: a priority action must be one of `legalActions(state, player)` (CR 117.1; matched by card, or source and
 * ability, as the seat's `legal` list offered it: the aliases of the seat's own view are its real ids); an answer must name the pending decision of
 * this player; `cancel` only when that decision is cancellable (CR 733.1). Concede (CR 104.3a: at any time) and stops always fit. Null: it fits.
 */
export function actionLegalityProblem(state: GameState, player: PlayerId, action: Action): HostedError | null {
  if (action.type === 'startGame' || !('player' in action) || action.player !== player) return { code: 'notYourPlayer', message: `You play ${player}; this action is for another player.` };
  if (action.type === 'concede' || action.type === 'setStops') return null;
  if (state.result) return { code: 'illegalAction', message: 'The game is over.', rules: ['CR 104.1'] };
  const d = state.pending;
  if (!d || d.player !== player) return { code: 'stale', message: 'It is not your decision now; wait for your turn to act.' };
  if (PRIORITY.has(action.type) || PRIORITY_TOOLS.has(action.type)) {
    if (d.kind !== 'priority') return { code: 'stale', message: 'You do not have priority now: answer the pending decision first.', rules: ['CR 117.1'] };
    if (PRIORITY_TOOLS.has(action.type)) return null; // the engine checks the by-hand tools (MRE)
    if (!legalActions(state, player).some((l) => sameLegal(action, l))) return { code: 'illegalAction', message: 'That is not one of your legal actions now.', rules: ['CR 117.1'] };
    return null;
  }
  if (action.type === 'answer') {
    if (d.kind === 'priority') return { code: 'stale', message: 'There is no decision to answer now.', rules: ['CR 117.1'] };
    if (action.decisionId !== d.id) return { code: 'stale', message: 'That answers an earlier decision; answer the current one.' };
    return null;
  }
  if (action.type === 'cancel') {
    if (d.kind === 'priority' || !d.cancellable || !state.suspended) return { code: 'illegalAction', message: 'There is nothing to cancel.', rules: ['CR 733.1'] };
    return null;
  }
  return { code: 'badMessage', message: 'Unknown action.' };
}

/**
 * The stranded-player exception to the cancel cap (orchestrator decision on the M13-3 review): the pending cancellable decision offers its player no
 * answer the engine could accept, judged from the decision itself: fewer choices than it needs (objects, options, targets), nothing to divide among, or
 * a cost that neither automatic payment nor any listed mana source can pay. Such a player can only cancel, so the table lets them even past the 3
 * cancels of the period (those cancels do not count toward the per-game action cap either; the seat's bank keeps running, so it bounds them).
 */
export function offersNoAnswer(d: Decision): boolean {
  switch (d.kind) {
    case 'chooseObjects':
      return d.options.length < d.min;
    case 'chooseOption': {
      const enabled = d.options.filter((o) => !o.disabled).length;
      return d.min > 0 && (enabled === 0 || (!d.allowRepeat && enabled < d.min));
    }
    case 'chooseTargets':
      return d.objects.length + d.players.length < Math.max(1, d.min);
    case 'chooseDivision':
      return d.targets.length === 0;
    case 'payCost':
      return !d.autoPayable && d.manaSources.length === 0;
    default:
      return false;
  }
}

/** A `setStops` as the table stores it: each step list without repeats, in turn order (CR 500.1; net's `normalizeSteps`). */
export function normalizeStops(stops: StopSettings): StopSettings {
  const norm = (steps: readonly string[]) => {
    const set = new Set(steps);
    return STEP_ORDER.filter((s) => set.has(s));
  };
  return { ...stops, ownTurn: norm(stops.ownTurn), opponentTurn: norm(stops.opponentTurn) };
}

/** A command's `seq`: a whole number from 0 up (anything else is a malformed message). */
export function isSeq(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}
