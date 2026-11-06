/**
 * edh-zones-20 (CR 401.5): while a spell is cast, a land played, an ability activated or a special action taken, a new top card of a library is not revealed until that
 * is finished, so a static ability that reads the top card ("As long as the top card of your library is a Goblin card, ~ has all activated abilities of that card") reads
 * the library as it was when the action began. The engine runs an action by replaying it on a clone of the state it began from (core/apply.ts#run), and checks inside the run
 * look at copies of that state, so the libraries as the action began are recorded for the duration of the run, not per state (`freezeLibraries` / `thawLibraries`, nested runs
 * stack); a paused state reads them from `GameState.suspended.base`. No dependencies: statics/match.ts, rules/characteristics.ts and core/apply.ts all use it.
 */
import type { GameState } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';

type Libraries = Readonly<Record<PlayerId, readonly ObjectId[]>>;
const RUNNING: Libraries[] = [];
/** The actions during which the top card is frozen (statics/play-permits.ts#LOOK_FROZEN says the same for what a viewer may look at). */
export const FROZEN_ACTIONS: ReadonlySet<string> = new Set(['cast', 'activate', 'playLand', 'special']);

/** A run of such an action begins from `s`: record its libraries as they are now. */
export function freezeLibraries(s: GameState): void {
  RUNNING.push(Object.fromEntries(Object.entries(s.zones.library).map(([p, ids]) => [p, ids.slice()]))); // copies: the live arrays change as the action moves cards
}
/** The run ends (done, stopped for a decision or failed). */
export function thawLibraries(): void {
  RUNNING.pop();
}
/** The library of `p` as it was when the running or paused action began, or undefined when no such action freezes it. */
export function frozenLibrary(s: GameState, p: PlayerId): readonly ObjectId[] | undefined {
  const run = RUNNING[RUNNING.length - 1];
  if (run !== undefined) return run[p] ?? [];
  const susp = s.suspended;
  if (susp !== null && susp !== undefined && FROZEN_ACTIONS.has(susp.action.type)) return susp.base.zones.library[p] ?? [];
  return undefined;
}
/** The top card of every library as the action froze it (null where none), or null when nothing is frozen: part of the characteristics cache key. */
export function frozenTopsKey(s: GameState): readonly (string | null)[] | null {
  if (RUNNING.length === 0 && !(s.suspended !== null && s.suspended !== undefined && FROZEN_ACTIONS.has(s.suspended.action.type))) return null;
  return s.players.map((p) => frozenLibrary(s, p.id)?.[0] ?? null);
}
