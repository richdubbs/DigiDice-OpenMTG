/**
 * edh-mana-keywords-12 (CR 708.2a, 613.2b; types/ability.ts#FaceDownSet): the set characteristics a face-down profile `set:<card types>|<subtypes>|<power>/<toughness>` carries.
 * Pure data, in types/ so that statics/ (the characteristics) and render/ (the sentence "It's a Forest land.") both read it.
 */
import type { FaceDownProfile } from './ability';

/** The set characteristics of a profile, or null for the plain 2/2 profiles. Types and subtypes are comma-separated; no power and toughness is an empty last part. */
export function setOfProfile(profile: FaceDownProfile): { types: string[]; subtypes: string[]; pt: [string, string] | null } | null {
  if (!profile.startsWith('set:')) return null;
  const [types = '', subtypes = '', pt = ''] = profile.slice(4).split('|');
  const [p, t] = pt.split('/');
  return { types: types === '' ? [] : types.split(','), subtypes: subtypes === '' ? [] : subtypes.split(','), pt: p === undefined || t === undefined || p === '' ? null : [p, t] };
}
