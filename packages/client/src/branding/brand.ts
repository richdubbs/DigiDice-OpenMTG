/**
 * DigiDice branding (docs/design/branding.md). The brand data comes from assets/brand/brand.json; the files are published under /brand/ by the build
 * plugin (build/brand-assets.ts). The assets are not MIT licensed (assets/brand/README.md).
 */
import brandJson from '../../../../assets/brand/brand.json';

export interface Brand {
  name: string;
  owner: string;
  colors: { blue: string; blueDeep: string; magenta: string; white: string; black: string; navy: string };
  assets: { logoSquare: string; logoSquareTransparent: string; wordmark: string; cardBack: string; cardBackPng: string };
  /** Donate buttons are hidden while this is null (branding.md: "Donate buttons are hidden until it is set in brand.json"). */
  donationUrl: string | null;
}

export const BRAND: Brand = brandJson as Brand;

/** Title used on the title screen and the browser tab (branding slot 1 and "Browser tab"). */
export const APP_TITLE = 'OpenMTG by DigiDice';
export const CREATOR_CREDIT = 'Created by DigiDice LLC';

/**
 * The exact Fan Content disclaimer (README.md; Wizards' Fan Content Policy). Never reword it: a test checks it against README.md.
 */
export const FAN_CONTENT_DISCLAIMER =
  'OpenMTG is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.';
export const FAN_CONTENT_POLICY_URL = 'https://company.wizards.com/en/legal/fancontentpolicy';

/** URL of a published brand asset by its brand.json key. */
export function brandAsset(key: keyof Brand['assets'], brand: Brand = BRAND): string {
  return `/brand/${brand.assets[key]}`;
}

/** The donation URL if one is configured and it is an https link; anything else hides Donate. */
export function donationUrl(brand: Brand = BRAND): string | null {
  const url = brand.donationUrl;
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
