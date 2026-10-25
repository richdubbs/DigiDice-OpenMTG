/** The pictures a sleeve is drawn with in the look in use: Reality Fracture's cracked mirror (profiles/fractureSleeve.ts), else the DigiDice sleeve. */
import { sleeveTracersUrl, sleeveUrl } from '../branding/sleeves';
import { fractureLightsUrl, fractureSleeveUrl } from './fractureSleeve';
import { useActiveProfile } from './useProfiles';

export interface SleevePictures {
  /** The still card back. */
  back: string;
  /** Its moving lights, drawn over it. */
  lights: string;
}

export function sleevePictures(id: string | null | undefined, fracture: boolean): SleevePictures {
  return fracture ? { back: fractureSleeveUrl(id), lights: fractureLightsUrl(id) } : { back: sleeveUrl(id), lights: sleeveTracersUrl(id) };
}

/** A sleeve's pictures, following the profile in use (a card back redraws when the player switches looks). */
export function useSleevePictures(id: string | null | undefined): SleevePictures {
  return sleevePictures(id, useActiveProfile().look.template === 'fracture');
}
