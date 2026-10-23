/**
 * CMDF (Commander follow-ups, item 1): where the cast options that change what the spell is (face down, prototyped, mutating, converted) are offered from.
 *
 * Morph, disguise and more than meets the eye function "in any zone from which you could play" or cast the card (CR 702.37a, 702.37c, 702.168a-b, 702.162a);
 * mutate and prototype are ways of casting a spell, so they apply wherever the spell is cast from (CR 702.140a, 601.2b, 702.160a, 718.3). Without an effect
 * that lets a player cast cards from elsewhere, a player casts cards from their hand (CR 601.3) and, in a Commander game, a commander they own from the
 * command zone (CR 903.8). Such a cast from the command zone is an ordinary commander cast: the tax is an additional cost (CR 903.8, 118.8, 118.9d) and the
 * cast is counted (actions/cast.ts). Other zones an effect opens (statics/play-permits.ts) do not offer these methods yet.
 */
import type { PlayerId } from '../../types/ids';
import type { GameObject } from '../../types/state';
import type { Game } from '../../core/game';
import { isCommander } from '../../statics/commander';

/** May `player` cast this face-up card of theirs from where it is with a cast option (CR 601.3: the hand; CR 903.8: a commander in the command zone)? */
export function castableFromHandOrCommand(g: Game, o: GameObject, player: PlayerId): boolean {
  if (o.owner !== player || o.kind !== 'card' || o.faceDown) return false;
  return o.zone === 'hand' || (o.zone === 'command' && isCommander(g.s, o));
}
