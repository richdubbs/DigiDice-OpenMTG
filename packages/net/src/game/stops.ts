/**
 * The guest's `setStops` (audit 2026-10-12, M4). `setStops` is never stale and the engine accepts it even after the game is over, so a guest could
 * repeat it without end, each one a new state for the host. The host applies one only when it changes something while the game is running; the
 * protocol bounds and deduplicates the step lists (messages.ts, checkAction and parseGuestMessage), and the guest's message rate is limited (limits.ts).
 */
import { STEP_ORDER, type Action, type GameState, type Step, type StopSettings } from '@openmtg/engine';

/** A step list without repeats, in turn order (CR 500.1): the form the host stores. */
export function normalizeSteps(steps: readonly string[]): Step[] {
  const set = new Set(steps);
  return STEP_ORDER.filter((s) => set.has(s));
}

export function sameStops(a: StopSettings, b: StopSettings): boolean {
  const same = (x: readonly string[], y: readonly string[]) => {
    const nx = normalizeSteps(x);
    const ny = normalizeSteps(y);
    return nx.length === ny.length && nx.every((s, i) => s === ny[i]);
  };
  // AP1: the hold-priority toggle counts (absent = off), or turning it on would be answered as "unchanged" and never applied.
  return a.fullControl === b.fullControl && (a.holdPriority === true) === (b.holdPriority === true) && same(a.ownTurn, b.ownTurn) && same(a.opponentTurn, b.opponentTurn);
}

/**
 * Whether the host applies this `setStops`: 'over' once the game has a result (CR 104.1: nothing changes after the game ends), 'unchanged' when the
 * player's stops are the same already (nothing to apply: the host answers with the current view), null to apply it. Other actions: null.
 */
export function stopsVerdict(state: GameState, action: Action): 'over' | 'unchanged' | null {
  if (action.type !== 'setStops') return null;
  if (state.result) return 'over';
  const current = state.players.find((p) => p.id === action.player)?.stops;
  return current && sameStops(current, action.stops) ? 'unchanged' : null;
}
