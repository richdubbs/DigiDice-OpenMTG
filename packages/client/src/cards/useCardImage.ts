/**
 * Which picture a card shows (ARCHITECTURE.md "Card images"): **player-uploaded image > Scryfall image (only if the setting is on) > text placeholder.**
 * While the player's own image is still being read from IndexedDB nothing from Scryfall is chosen or looked up, so a card with an upload never asks
 * scryfall.io for its picture.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useCardImages } from '../images/context';
import { holdPicture } from '../images/pictures';
import { pickScryfallUrl, type FaceUris } from '../images/scryfall';
import { useShowScryfallImages } from '../images/settings';
import { imageUrisOfFace, isTwoSided, shownFace, slotOfFace, type CardModel } from './model';

export type CardImageChoice = { kind: 'upload'; src: string } | { kind: 'scryfall'; src: string } | { kind: 'placeholder' };

/** The priority rule, pure. */
export function chooseCardImage(upload: string | null, scryfall: string | null, showScryfall: boolean): CardImageChoice {
  if (upload) return { kind: 'upload', src: upload };
  if (showScryfall && scryfall) return { kind: 'scryfall', src: scryfall };
  return { kind: 'placeholder' };
}

/** The uploaded image URL of a slot, or null; loads it from the store on first use. */
export function useUploadedImage(key: string | undefined): { url: string | null; loading: boolean } {
  const { uploads } = useCardImages();
  const state = useSyncExternalStore(uploads.subscribe, () => (key ? uploads.peek(key) : undefined));
  useEffect(() => {
    if (key) uploads.load(key);
  }, [key, uploads, state]);
  if (!key) return { url: null, loading: false };
  return { url: state?.status === 'ready' ? state.url : null, loading: state === undefined || state.status === 'loading' };
}

/**
 * Scryfall URLs for a card that came without them (a CardDef in a game): asked from the server once per name, only while the setting is on. A name that was
 * looked up before is known in the first render (the lookup cache is read, not awaited), so a card drawn anew after it changed zones keeps its picture.
 */
function useLookedUpUris(card: CardModel | null, enabled: boolean): { uris: FaceUris | null; pending: boolean } {
  const { scryfall } = useCardImages();
  const has = card ? card.faces.some((f) => f.imageUris) : true;
  const name = card && !has && enabled ? card.name : null;
  const found = useSyncExternalStore(scryfall.subscribe, () => (name ? scryfall.peek(name) : null));
  useEffect(() => {
    if (name) void scryfall.get(name);
  }, [name, scryfall]);
  return { uris: found ?? null, pending: name !== null && found === undefined };
}

/** Which picture a card face shows, and the artist of a Scryfall picture; nothing is held or fetched beyond the URL look-up (useCardImage holds). */
function useImageChoice(card: CardModel | null, face: number, size: 'normal' | 'large'): CardImageChoice & { loading: boolean; artist?: string } {
  const [showScryfall] = useShowScryfallImages();
  const slot = card ? slotOfFace(card, face) : undefined;
  const upload = useUploadedImage(slot?.key);
  const scryfallAllowed = showScryfall && !upload.url && !upload.loading;
  const { uris: looked, pending } = useLookedUpUris(card, scryfallAllowed);
  let scryfall: string | null = null;
  let artist: string | undefined;
  if (card && scryfallAllowed) {
    const own = imageUrisOfFace(card, face);
    const idx = shownFace(card, face);
    const fromLookup = looked ? (looked[idx] ?? (isTwoSided(card) ? undefined : looked.find((u) => u))) : undefined;
    const uris = own ?? fromLookup;
    scryfall = pickScryfallUrl(uris, size);
    artist = uris?.artist;
  }
  const choice = chooseCardImage(upload.url, scryfall, showScryfall);
  // `loading`: the picture is still on its way (the upload being read, the Scryfall URL being looked up); the placeholder shown meanwhile is not the card's art.
  return { ...choice, loading: upload.loading || pending, ...(choice.kind === 'scryfall' && artist ? { artist } : {}) };
}

/**
 * The picture a card face shows. A Scryfall picture comes with its artist when the card data has one (`artist`), for the credit shown with it
 * (`useImageCredit`).
 */
export function useCardImage(card: CardModel | null, face: number, size: 'normal' | 'large' = 'normal'): CardImageChoice & { loading: boolean; artist?: string } {
  const choice = useImageChoice(card, face, size);
  const src = choice.kind === 'placeholder' ? null : choice.src;
  // Kept loaded and decoded: the card's next component (after a zone change) shows this picture in its first frame.
  useEffect(() => holdPicture(src, choice.kind === 'scryfall'), [src, choice.kind]);
  return choice;
}

/**
 * The artist to credit for a card face's picture: the Scryfall image's artist while that image is the one shown (the setting on, no upload for that side),
 * else null (uploads and our frames need no credit). `face` as for useCardImage: a double-faced card's side, so each side credits its own artist. Loads
 * nothing the card's picture does not load already.
 */
export function useImageCredit(card: CardModel | null, face = 0): string | null {
  const choice = useImageChoice(card, face, 'normal');
  return choice.kind === 'scryfall' ? (choice.artist ?? null) : null;
}
