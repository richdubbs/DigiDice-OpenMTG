/**
 * Protection, hexproof and shroud (CR 702.16, 702.11, 702.18): the rule checks that read the keywords from characteristics.
 * Damage prevention (702.16e), targeting (702.16b), attachment (702.16c-d) and blocking (702.16f) all come through here.
 */
import type { KeywordAbilityDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { hasKeyword, type Chars } from './characteristics';
import { hasQuality } from './quality';

/** The quality of hexproof "from each of its colors" (parser/holes/misc.ts#OWN_COLORS). */
const OWN_COLORS = 'ownColors';

/** std-rx15 (CR 702.16b-f; unverified 702.16k): the quality of "protection from each of your opponents" (rules/quality.ts). */
const FROM_OPPONENTS = 'player:opponents';

/**
 * std-rx15: protection from each of your opponents is protection from everything a player other than the protected permanent's controller controls. A
 * controller that is not known ('' on a definition's record) never matches (fail closed: no protection is assumed).
 */
/**
 * edh-c-49 (CR 702.16a; Crypsis): "protection from creatures your opponents control" (quality `opp:type:Creature`): the source has the type AND its controller is an
 * opponent of the protected permanent's controller. Every other quality is a characteristic of the source alone.
 */
function sourceHasQuality(source: Chars, quality: string, targetController: PlayerId | '', sourceController: PlayerId | ''): boolean {
  // edh-d-11 (CR 702.16j-k; True-Name Nemesis): "protection from the chosen player", the quality `player:<id>`: a source that player controls (the controller of an ability or spell on
  // the stack, of a permanent or an Aura/Equipment attached); a source whose controller is not known never matches (the quality `player:opponents` is read before this)
  if (quality.startsWith('player:')) return sourceController !== '' && sourceController === quality.slice('player:'.length);
  if (quality.startsWith('opp:')) return fromOpponents(targetController, sourceController) && hasQuality(source, quality.slice('opp:'.length));
  return hasQuality(source, quality);
}

function fromOpponents(targetController: PlayerId | '', sourceController: PlayerId | ''): boolean {
  return targetController !== '' && sourceController !== '' && targetController !== sourceController;
}

/**
 * edh-perms-21 (CR 702.16c, 613.1f): a protection granted with "This effect doesn't remove this Aura"  does not keep that attachment off
 * (`exceptAttached` names the granting Aura). Only the attach check passes the attachment; targeting, damage and blocking never do.
 */
function keepsAttachment(k: KeywordAbilityDef, attachment: ObjectId | undefined, kept?: (k: KeywordAbilityDef) => boolean): boolean {
  if (attachment === undefined) return false;
  if (k.exceptAttached?.ref === 'fixed' && k.exceptAttached.objects.some((o) => o.id === attachment)) return true;
  return k.exceptAttachedKinds !== undefined && kept?.(k) === true; // edh-d-24: the attachments of these kinds that are already attached (keywords/hooks/protection.ts decides, it can read the state)
}

/**
 * CR 702.16a: does the target have protection from something the source is? The controllers default to the records' own (CR 613.1b: after layer 2); a
 * caller that knows them better (the controller of a spell being cast) passes them.
 */
export function hasProtectionFrom(target: Chars, source: Chars, controllers: { target?: PlayerId; source?: PlayerId } = {}, attachment?: ObjectId, kept?: (k: KeywordAbilityDef) => boolean): boolean {
  return target.keywords.some((k) => k.keyword === 'protection' && k.quality !== undefined && !keepsAttachment(k, attachment, kept)
    && (k.quality === FROM_OPPONENTS ? fromOpponents(controllers.target ?? target.controller, controllers.source ?? source.controller) : sourceHasQuality(source, k.quality, controllers.target ?? target.controller, controllers.source ?? source.controller)));
}

/**
 * CR 115.1, 702.11b, 702.16b, 702.18a: may a spell or ability controlled by `sourceController`, with the characteristics `source`, target this permanent?
 * `source` is null when it is not known; then only shroud, plain hexproof and protection from each of your opponents (which reads controllers only) can stop it.
 */
export function canBeTargeted(target: Chars, targetController: PlayerId, source: Chars | null, sourceController: PlayerId): boolean {
  if (hasKeyword(target, 'shroud')) return false; // CR 702.18a
  for (const k of target.keywords) {
    if (k.keyword === 'hexproof' && sourceController !== targetController) {
      // CR 702.11b: "can't be the target of spells or abilities your opponents control"; hexproof from X (CR 702.11d) adds the quality.
      // std-rg (CR 702.11d, 105.2): "hexproof from each of its colors" is hexproof from every color the permanent is: a source of any of those colors can't target it
      if (k.quality === OWN_COLORS) { if (source !== null && source.colors.some((c) => target.colors.includes(c))) return false; continue; }
      // std-rx15: "from each of your opponents" is plain hexproof's own condition (the source's controller is an opponent)
      if (k.quality === undefined || k.quality === FROM_OPPONENTS || (source !== null && sourceHasQuality(source, k.quality, targetController, sourceController))) return false;
    }
    if (k.keyword === 'protection' && k.quality === FROM_OPPONENTS && fromOpponents(targetController, sourceController)) return false; // std-rx15 (CR 702.16b)
  }
  if (source !== null && hasProtectionFrom(target, source, { target: targetController, source: sourceController })) return false;
  return true;
}
