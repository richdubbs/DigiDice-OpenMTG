/**
 * edh-next-124 (CR 602.2, 601.2f, 605.1a; Tezzeret, Betrayer of Flesh, rulings 2022-02-18): the counts rules/typed-activations.ts keeps of the activations of abilities of permanents of
 * each card type, read by statics/costmods.ts#abilityCostModsFor for "the first activated ability of an artifact you activate each turn". Keys of `GameState.turnActivations`.
 */
import type { PlayerId } from '../types/ids';
import type { GameState } from '../types/state';

export const actKey = (player: PlayerId, type: string): string => `typeAct:${player}:${type}`;
export const firstKey = (player: PlayerId, type: string, source: string): string => `typeFirst:${player}:${type}:${source}`;

/**
 * Is an activation of an ability of `source` by `player` now the first one this turn of an ability of a permanent of that type: none begun yet (a cost shown before the
 * activation), or this very one being activated.
 */
export function isFirstTypedActivation(s: GameState, player: PlayerId, type: string, sourceId: string): boolean {
  return (s.turnActivations[actKey(player, type)] ?? 0) === 0 || s.turnActivations[firstKey(player, type, sourceId)] === 1;
}
