/**
 * Protection (CR 702.16), the DEBT rules: a permanent with protection from a quality can't be Damaged (prevented inside rules/damage.ts#dealDamage, CR 702.16e),
 * Enchanted or Equipped (CR 702.16c-d), Blocked (CR 702.16f: a creature with protection can't be blocked by creatures with the quality) or Targeted (CR 702.16b)
 * by anything with that quality. The four hooks below answer all but the damage rule.
 */
import { deny } from '../../rules/denial';
import type { GameLike } from '../../rules/hookpoints';
import { hasProtectionFrom } from '../../rules/protection';
import type { ObjectId } from '../../types/ids';
import type { KeywordHooks } from '../types';
import { charsOfId, nm } from './common';
import { targetingDenial } from './targeting';

/** A host with protection from a quality of the attachment can't have it attached: an Aura (CR 702.16c) or an Equipment / Fortification (CR 702.16d). */
function attachDenial(g: GameLike, attachment: ObjectId, host: ObjectId) {
  const a = charsOfId(g, attachment);
  const h = charsOfId(g, host);
  if (a === null || h === null) return null;
  if (hasProtectionFrom(h, a)) return deny(`${nm(h)} has protection from a quality of ${nm(a)}, so it can't be attached to it.`, 'CR 702.16c', 'CR 702.16d');
  return null;
}

export const protectionHooks: Pick<KeywordHooks, 'canBeBlocked' | 'canBeTargetedBy' | 'canBeEnchantedBy' | 'canBeEquippedBy'> = {
  canBeBlocked(g, attacker, blocker) {
    const ac = charsOfId(g, attacker);
    const bc = charsOfId(g, blocker);
    if (ac === null || bc === null) return null;
    if (hasProtectionFrom(ac, bc)) return deny(`${nm(ac)} has protection from a quality of ${nm(bc)}, so it can't block it.`, 'CR 702.16f');
    return null;
  },
  canBeTargetedBy: (g, target, source, controller) => targetingDenial(g, target, source, controller, 'protection', 'it has protection from a quality of the source', 'CR 702.16b'),
  canBeEnchantedBy: (g, aura, host) => attachDenial(g, aura, host),
  canBeEquippedBy: (g, equipment, host) => attachDenial(g, equipment, host),
};
