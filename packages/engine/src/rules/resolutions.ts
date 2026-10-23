/**
 * FAST5X E17: how many times an ability has resolved this turn ("if this is the second time this ability has resolved this turn", "where X is the number of
 * times this ability has resolved this turn"; CR 608.2, 113.7a, 400.7). Owner: FAST5X E17.
 *
 * The count is per ability of a source OBJECT: the key holds the source's object id, so a source that changed zones (a new object, CR 400.7) starts again at
 * zero, and two objects with the same printed ability count apart. It lives in `GameState.turnActivations` (cleared as each turn begins, core/turn.ts), under
 * `<sourceId>|resolved:<ability key>`. An ability counts as it begins to resolve (effects/run.ts#resolveStackObject calls countResolution, after its intervening "if" and its
 * targets were checked: an ability removed from the stack that way does not resolve, CR 603.4, 608.2b), so the steps of that resolution read their own
 * resolution in the count ("the first time" is a count of 1).
 *
 * Also the key of an "as you cast this spell" condition (CR 601.2i) in `StackInfo.castChecks` (actions/cast-checks.ts records them, effects/eval.ts reads them).
 */
import type { Game } from '../core/game';
import type { Condition } from '../types/ability';
import type { StackInfo } from '../types/state';

/** The key of an `asCast` condition's `held` part in `StackInfo.castChecks` (CR 601.2i). */
export const castCheckKey = (held: Condition): string => JSON.stringify(held);

/** The key of the stack object's ability, or null when it is no ability of a source object (a spell; an ability with no recorded source). */
export function resolutionKey(info: Pick<StackInfo, 'kind' | 'sourceId' | 'abilityRef'>): string | null {
  if (info.kind === 'spell' || info.sourceId === undefined || info.abilityRef === undefined) return null;
  const r = info.abilityRef;
  return `${info.sourceId}|resolved:${r.key ?? `${r.source}:${r.face}:${r.index}`}`;
}

/** CR 608.2: the ability on the stack begins to resolve: count it for its source object this turn. */
export function countResolution(g: Game, info: StackInfo): void {
  const key = resolutionKey(info);
  if (key !== null) g.s.turnActivations[key] = (g.s.turnActivations[key] ?? 0) + 1;
}
