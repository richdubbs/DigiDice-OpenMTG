/**
 * Where card components get images from: the image store (player uploads in IndexedDB), the uploaded-image URLs, the Scryfall URL lookup, the check
 * that a file can be shown, and the images waiting for review. The app uses the browser defaults (one set per page, so they outlive any screen); tests
 * (and a future embedding) pass their own with <CardImagesProvider>.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { browserCanShow } from './files';
import { ReviewQueue } from './review';
import { ScryfallUrls, type UrlLookup } from './scryfall';
import { idbImageStore, type ImageStore } from './store';
import { UploadedImages, browserObjectUrls, type ObjectUrls } from './uploads';

export interface CardImages {
  store: ImageStore;
  uploads: UploadedImages;
  scryfall: ScryfallUrls;
  urls: ObjectUrls;
  /** Whether this browser can show an image file (decoded once before it is stored). */
  canShow: (file: Blob) => Promise<boolean>;
  /** Images waiting for the player to pick their card. */
  review: ReviewQueue;
}

export function createCardImages(
  opts: { store?: ImageStore; urls?: ObjectUrls; lookup?: UrlLookup; canShow?: (file: Blob) => Promise<boolean> } = {},
): CardImages {
  const store = opts.store ?? idbImageStore();
  const urls = opts.urls ?? browserObjectUrls;
  return {
    store,
    urls,
    uploads: new UploadedImages(store, urls),
    scryfall: new ScryfallUrls(opts.lookup),
    canShow: opts.canShow ?? browserCanShow,
    review: new ReviewQueue(),
  };
}

let defaults: CardImages | null = null;
/** The browser's own image sources, created on first use. */
export function defaultCardImages(): CardImages {
  defaults ??= createCardImages();
  return defaults;
}

const Ctx = createContext<CardImages | null>(null);

export function CardImagesProvider({ images, children }: { images: CardImages; children: ReactNode }) {
  return <Ctx.Provider value={images}>{children}</Ctx.Provider>;
}

export function useCardImages(): CardImages {
  const ctx = useContext(Ctx);
  return useMemo(() => ctx ?? defaultCardImages(), [ctx]);
}
