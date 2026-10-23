/**
 * Pictures asked for ahead of the board (ui/arena perf): when a game's view brings the definition of a card (it is drawn, revealed, put into a graveyard),
 * the uploaded images of its sides are read from the store and, with the Scryfall setting on, its Scryfall URLs are looked up and the pictures loaded. By the
 * time the card flies from a zone to another and the board draws it again, its picture is known and the first frame already shows it, never the text frame.
 *
 * The priority rule holds here too (useCardImage.ts): a card with an uploaded image never asks for its Scryfall picture, so Scryfall is only asked once the
 * uploads of all its sides have been read and none exists.
 */
import { useEffect } from 'react';
import type { CardDef } from '@openmtg/engine';
import { useCardImages } from '../images/context';
import { holdPicture } from '../images/pictures';
import { pickScryfallUrl } from '../images/scryfall';
import { useShowScryfallImages } from '../images/settings';
import type { UploadedImages } from '../images/uploads';
import { cardModelOf } from './fromView';

/** Definition ids already asked for, per setting (the lookups themselves are memoized per name in `ScryfallUrls`). */
const asked = new Set<string>();

/** Resolves once every slot has been read: true when none of them has an uploaded image. */
function noneUploaded(uploads: UploadedImages, keys: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let off = () => {};
    const check = (): boolean => {
      const states = keys.map((k) => uploads.peek(k));
      if (states.some((s) => s === undefined || s.status === 'loading')) return false;
      off();
      resolve(states.every((s) => s?.status === 'none'));
      return true;
    };
    if (!check()) off = uploads.subscribe(check);
  });
}

export function usePrefetchPictures(defs: Readonly<Record<string, CardDef>>): void {
  const images = useCardImages();
  const [showScryfall] = useShowScryfallImages();
  useEffect(() => {
    for (const def of Object.values(defs)) {
      const key = `${showScryfall ? 's' : 'p'}:${def.id}`;
      if (asked.has(key)) continue;
      asked.add(key);
      const model = cardModelOf(def);
      const keys = model.slots.map((s) => s.key);
      for (const k of keys) images.uploads.load(k);
      if (!showScryfall) continue;
      void noneUploaded(images.uploads, keys).then(async (none) => {
        if (!none) return;
        for (const u of (await images.scryfall.get(model.name)) ?? []) holdPicture(pickScryfallUrl(u, 'normal'), true);
      });
    }
  }, [defs, showScryfall, images]);
}
