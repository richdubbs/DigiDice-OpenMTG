/**
 * std-rr (CR 303.4, 702.5a): "enchanted player", the player an Aura on the battlefield is attached to (an Aura with "Enchant player" or "Enchant opponent", a Curse;
 * GameObject.attachedTo holds a player id then, rules/attachment.ts). Read by every resolver of `PlayerRef` `enchantedPlayer` (effects/refs.ts, statics/match.ts,
 * triggers/filters.ts). Pure: reads only the state given.
 */
import type { PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';

/**
 * The player `aura` is attached to, or nobody: attached to an object or to nothing, or not on the battlefield (a new object elsewhere, CR 400.7). A resolving
 * ability whose Aura has left passes its last known information, as `attachedTo` reads it for "enchanted creature" (effects/refs.ts, CR 608.2h).
 */
export function attachedPlayer(s: GameState, aura: GameObject | undefined): PlayerId[] {
  if (aura === undefined || aura.zone !== 'battlefield' || aura.attachedTo === undefined) return [];
  const p = s.players.find((x) => x.id === aura.attachedTo);
  return p !== undefined && !p.hasLost ? [p.id] : [];
}
