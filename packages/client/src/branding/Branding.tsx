/** Small branding pieces shared by the title screen, footer, About and (later) the game-over screen and in-game menu. */
import { APP_TITLE, BRAND, FAN_CONTENT_DISCLAIMER, brandAsset, donationUrl, type Brand } from './brand';

/** The DigiDice logo (transparent version, for dark surfaces). `size` in CSS pixels. */
export function Logo({ size = 64, className }: { size?: number; className?: string }) {
  return <img className={className} src={brandAsset('logoSquareTransparent')} width={size} height={size} alt="DigiDice logo" />;
}

/** "OpenMTG by DigiDice". */
export function AppTitle({ as: Tag = 'span', className }: { as?: 'h1' | 'span' | 'strong'; className?: string }) {
  return <Tag className={className}>{APP_TITLE}</Tag>;
}

/** The Fan Content disclaimer, word for word. */
export function Disclaimer({ className }: { className?: string }) {
  return <p className={className ?? 'disclaimer'}>{FAN_CONTENT_DISCLAIMER}</p>;
}

/**
 * A Donate link, rendered only when brand.json has a donation URL. Never a pop-up; it opens the page in a new tab. `quiet` is the small variant for the
 * footer and the game-over screen (branding.md slots 6 and 7).
 */
export function DonateLink({ quiet = false, brand = BRAND }: { quiet?: boolean; brand?: Brand }) {
  const url = donationUrl(brand);
  if (!url) return null;
  return (
    <a className={quiet ? 'donate donate-quiet' : 'donate button'} href={url} target="_blank" rel="noopener noreferrer">
      Donate
    </a>
  );
}
