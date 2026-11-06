/**
 * Soulbond pairs (CR 702.95): `GameObject.pairedWith` names the creature an object is paired with; both creatures name each other. A pair holds only while both
 * are on the battlefield (a new object after any zone change has no partner, CR 400.7) and each names the other; the rest of CR 702.95e (both still creatures,
 * both still under the control of the player who paired them) is checked by the state-based check of core/sba-objects.ts, which clears the pair. Pure reads here.
 */
import type { GameObject, GameState } from '../types/state';

/** The creature `o` is paired with, or undefined: unpaired, the partner left, or the partner names another object (CR 702.95b, 702.95d, 702.95e). */
export function partnerOf(s: GameState, o: GameObject | undefined): GameObject | undefined {
  if (o === undefined || o.zone !== 'battlefield' || o.pairedWith === undefined) return undefined;
  const p = s.objects[o.pairedWith];
  return p !== undefined && p.zone === 'battlefield' && p.pairedWith === o.id ? p : undefined;
}

/** Is `o` a paired creature (CR 702.95b)? An object that left the battlefield is not (it is a new object, CR 400.7). */
export const isPaired = (s: GameState, o: GameObject | undefined): boolean => partnerOf(s, o) !== undefined;
