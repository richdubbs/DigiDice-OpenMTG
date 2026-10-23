/**
 * The switch "Show card images from Scryfall" (ARCHITECTURE.md "Card images" B; off by default), shown on the Images screen. It reads and writes the
 * one setting (images/settings.ts), so it always agrees with the Settings screen's own checkbox.
 */
import { useId } from 'react';
import { useShowScryfallImages } from './settings';
import './images.css';

export function ScryfallImagesSetting() {
  const [on, setOn] = useShowScryfallImages();
  const hint = useId();
  return (
    <div className="setting">
      <label className="setting-toggle">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-describedby={hint} />
        Show card images from Scryfall
      </label>
      <p id={hint} className="muted setting-hint">
        Off by default. When on, your browser loads card pictures directly from Scryfall (scryfall.io) for cards you have no image of your own. OpenMTG never
        downloads, stores or shares those pictures. Images you upload always come first.
      </p>
    </div>
  );
}
