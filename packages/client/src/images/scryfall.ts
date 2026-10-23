/**
 * Scryfall image URLs (ARCHITECTURE.md "Card images" B), used only when the player turned the setting on. The URLs come from the local index through our
 * own server (`GET /api/cards/:name?images=1`), never built by hand; the player's browser hot-links them. Nothing is downloaded, stored or cached by
 * OpenMTG apart from these URL strings in memory.
 */
import type { ImageUris } from '@openmtg/server/api';
import { apiGet } from '../api/http';

/** Only https links to Scryfall's image host are shown (the CSP's `img-src` allows `*.scryfall.io` only). */
export function safeScryfallUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'scryfall.io' || u.hostname.endsWith('.scryfall.io')) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The URL to show for a size: `large` for zoom when there is one, `normal` otherwise. */
export function pickScryfallUrl(uris: ImageUris | undefined, size: 'normal' | 'large'): string | null {
  if (!uris) return null;
  return size === 'large' ? (safeScryfallUrl(uris.large) ?? safeScryfallUrl(uris.normal)) : (safeScryfallUrl(uris.normal) ?? safeScryfallUrl(uris.large));
}

export type FaceUris = (ImageUris | undefined)[];
export type UrlLookup = (name: string) => Promise<FaceUris | null>;

/** Per-face image URLs of a card by Oracle name, from the server. */
export const fetchScryfallUris: UrlLookup = async (name) => {
  const res = await apiGet('GET /api/cards/:name', { params: { name }, query: { images: 1 } });
  return res.card.faces.map((f) => f.imageUris);
};

/**
 * Memoizes lookups by name (URL strings only) for the session, so a board of cards asks once per card name. A finished lookup can be read at once (`peek`):
 * a card that moves to another zone is drawn by a new component, and that must show the picture the card had in its first frame, not the text frame for the
 * moment a promise takes to resolve (that flash was "the card switches to the default art" while it flew).
 */
export class ScryfallUrls {
  private readonly cache = new Map<string, Promise<FaceUris | null>>();
  private readonly done = new Map<string, FaceUris | null>();
  private readonly listeners = new Set<() => void>();
  constructor(private readonly lookup: UrlLookup = fetchScryfallUris) {}

  get(name: string): Promise<FaceUris | null> {
    let p = this.cache.get(name);
    if (!p) {
      p = this.lookup(name).catch(() => null);
      this.cache.set(name, p);
      void p.then((uris) => {
        this.done.set(name, uris);
        for (const l of [...this.listeners]) l();
      });
    }
    return p;
  }

  /** The URLs of a finished lookup (null: the card has none), or `undefined` while it is still running or was never asked for. */
  peek(name: string): FaceUris | null | undefined {
    return this.done.get(name);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
