/**
 * Pictures kept loaded and decoded (ui/arena perf): a card that changes zones is drawn by a new component, and its new `<img>` must show at once, not blank
 * for the frames a fresh decode takes (that gap is what looked like the card losing its art mid-flight). The browser's own image cache may drop a picture
 * nobody on the page shows at the moment, so the most recent ones are held here by URL. Only the already chosen URLs (an uploaded image's object URL, or a
 * Scryfall URL the player opted into) are ever held; nothing is fetched that the board would not fetch anyway.
 */

const MAX_HELD = 300;
const held = new Map<string, HTMLImageElement>();

/** Keep `url` loaded and decoded until 300 newer pictures have been held. Safe to call again and again; does nothing without a browser image. */
export function holdPicture(url: string | null | undefined, scryfall = false): void {
  if (!url || typeof Image !== 'function') return;
  const have = held.get(url);
  if (have) {
    // Most recently used last.
    held.delete(url);
    held.set(url, have);
    return;
  }
  const img = new Image();
  if (scryfall) img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.src = url;
  held.set(url, img);
  void img.decode?.().catch(() => undefined);
  if (held.size > MAX_HELD) {
    const oldest = held.keys().next().value;
    if (oldest !== undefined) held.delete(oldest);
  }
}

/** Whether the picture is held loaded (tests). */
export function isPictureHeld(url: string): boolean {
  return held.has(url);
}
