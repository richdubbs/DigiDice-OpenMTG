/**
 * The images stored in this browser, by card, with one row per image slot (per printed side: a double-faced card has a front and a back slot): replace,
 * delete, or add the missing side. Everything stays in IndexedDB. The result of an action shows in a message that stays in view (a toast), and focus
 * moves somewhere that still exists when the control the player used goes away. Each message has its sound: ui.success for an image stored, ui.delete
 * for images deleted (the Delete buttons themselves stay silent), ui.error for a file refused or a failure.
 */
import { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ImageSlotMatch } from '@openmtg/server/api';
import { apiGet } from '../api/http';
import type { SoundId } from '../audio/catalog';
import { sfx } from '../audio/sfx';
import { slotsOfSummary } from '../cards/model';
import { CardPicker } from './CardPicker';
import { useCardImages } from './context';
import { isImageFile, MAX_IMAGE_BYTES } from './files';
import { saveImage } from './matching';
import type { StoredImage } from './store';
import { Thumbnail } from './Thumbnail';

/**
 * A file picker that looks like a button: the input is visually hidden and comes right before its label, so the label can draw the focus ring when
 * the input has keyboard focus (images.css, WCAG 2.4.7).
 */
export const FileButton = forwardRef<HTMLInputElement, { label: string; onFile: (file: File) => void }>(function FileButton({ label, onFile }, ref) {
  const id = useId();
  return (
    <span className="file-button">
      <input
        ref={ref}
        id={id}
        type="file"
        accept="image/*"
        className="visually-hidden"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <label htmlFor={id} className="button">
        {label}
      </label>
    </span>
  );
});

/** How long a library message stays. */
const TOAST_MS = 8000;

function SlotRow({ slot, image, onStore, onDelete }: { slot: ImageSlotMatch; image: StoredImage | undefined; onStore: (slot: ImageSlotMatch, f: File) => void; onDelete: (key: string) => void }) {
  return (
    <li className="slot-row" aria-label={slot.label}>
      {image ? <Thumbnail blob={image.blob} version={`${image.key}@${image.addedAt}@${image.fileName}`} alt={slot.label} /> : <span className="image-thumb image-thumb-empty">No image</span>}
      <div className="slot-body">
        <span className="slot-label">{slot.label}</span>
        {image && <span className="muted slot-file">{image.fileName}</span>}
      </div>
      <div className="slot-actions">
        <FileButton label={image ? `Replace ${slot.label}` : `Add ${slot.label}`} onFile={(f) => onStore(slot, f)} />
        {image && (
          <button type="button" data-sfx="none" onClick={() => onDelete(slot.key)} aria-label={`Delete ${slot.label}`}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Every slot of a card, from the server, or null if the card is not known there. Only a card whose name has two parts ("Front // Back") can have more
 * than one picture to show (a meld card's melded back is not known from a search result either), so other cards need no request.
 */
function useCardSlots(card: string): ImageSlotMatch[] | null {
  const [slots, setSlots] = useState<ImageSlotMatch[] | null>(null);
  const multi = card.includes(' // ');
  useEffect(() => {
    if (!multi) return;
    const ctl = new AbortController();
    apiGet('GET /api/cards/:name', { params: { name: card }, signal: ctl.signal })
      .then((r) => setSlots(slotsOfSummary(r.card).map((s) => ({ key: s.key, label: s.label, card }))))
      .catch(() => {
        if (!ctl.signal.aborted) setSlots(null);
      });
    return () => ctl.abort();
  }, [card, multi]);
  return slots;
}

function CardGroup({ card, images, onStore, onDelete }: { card: string; images: StoredImage[]; onStore: (slot: ImageSlotMatch, f: File) => void; onDelete: (key: string) => void }) {
  const known = useCardSlots(card);
  const stored = images.map((i) => ({ key: i.key, label: i.label, card: i.card }));
  const slots = [...(known ?? []), ...stored.filter((s) => !(known ?? []).some((k) => k.key === s.key))];
  return (
    <li className="image-card" aria-label={`Images of ${card}`}>
      <h3>{card}</h3>
      <ul className="slot-list">
        {slots.map((s) => (
          <SlotRow key={s.key} slot={s} image={images.find((i) => i.key === s.key)} onStore={onStore} onDelete={onDelete} />
        ))}
      </ul>
    </li>
  );
}

function AddForCard({ onStore, debounceMs }: { onStore: (slot: ImageSlotMatch, f: File) => void; debounceMs?: number }) {
  const [slot, setSlot] = useState<ImageSlotMatch | null>(null);
  const [returning, setReturning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The picker that had focus is gone: the file input of the chosen side takes it.
    if (slot) fileInput.current?.focus();
  }, [slot]);
  if (slot)
    return (
      <div className="add-for-card">
        <p>
          Image for <strong>{slot.label}</strong>
        </p>
        <FileButton
          ref={fileInput}
          label={`Choose image for ${slot.label}`}
          onFile={(f) => {
            onStore(slot, f);
            setReturning(true);
            setSlot(null);
          }}
        />
        <button
          type="button"
          className="button-link"
          onClick={() => {
            setReturning(true);
            setSlot(null);
          }}
        >
          Cancel
        </button>
      </div>
    );
  return <CardPicker onPick={setSlot} label="Add an image for a specific card" autoFocus={returning} {...(debounceMs !== undefined ? { debounceMs } : {})} />;
}

export function ImageLibrary({ debounceMs }: { debounceMs?: number }) {
  const { store, canShow } = useCardImages();
  const [images, setImages] = useState<StoredImage[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      store
        .list()
        .then((l) => live && setImages(l))
        .catch(() => live && setImages([]));
    void load();
    const off = store.subscribe(() => void load());
    return () => {
      live = false;
      off();
    };
  }, [store]);

  useEffect(() => {
    // After a delete the row (and its button) is gone: focus the library heading instead of the page body.
    if (focusHeading.current) {
      focusHeading.current = false;
      heading.current?.focus();
    }
  }, [images]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), TOAST_MS);
    return () => clearTimeout(t);
  }, [message]);

  const say = useCallback((text: string, sound: SoundId = 'ui.notify') => {
    setMessage(text);
    sfx(sound);
  }, []);
  const onStore = (slot: ImageSlotMatch, f: File) => {
    if (!isImageFile(f)) return say(`${f.name} is not an image file.`, 'ui.error');
    if (f.size > MAX_IMAGE_BYTES) return say(`${f.name} is too large (over 25 MB).`, 'ui.error');
    void canShow(f).then(async (ok) => {
      if (!ok) return say(`${f.name} cannot be shown by this browser; convert it to JPEG or PNG.`, 'ui.error');
      try {
        await saveImage(store, f, slot);
        say(`Stored ${f.name} as ${slot.label}.`, 'ui.success');
      } catch (e) {
        say(`Could not store ${f.name}: ${e instanceof Error ? e.message : String(e)}`, 'ui.error');
      }
    });
  };
  const onDelete = (key: string) => {
    focusHeading.current = true;
    store.delete(key).then(
      () => say('Image deleted.', 'ui.delete'),
      (e: unknown) => say(`Could not delete the image: ${e instanceof Error ? e.message : String(e)}`, 'ui.error'),
    );
  };

  const groups = new Map<string, StoredImage[]>();
  for (const i of images ?? []) groups.set(i.card, [...(groups.get(i.card) ?? []), i]);

  return (
    <section className="hud-panel images-panel" aria-labelledby="library-heading">
      <h2 id="library-heading" ref={heading} tabIndex={-1}>
        Your images{images ? ` (${images.length})` : ''}
      </h2>
      <AddForCard onStore={onStore} {...(debounceMs !== undefined ? { debounceMs } : {})} />
      {images === null && <p className="muted">Loading…</p>}
      {images !== null && images.length === 0 && <p className="muted">No images stored yet.</p>}
      {groups.size > 0 && (
        <ul className="image-cards">
          {[...groups].map(([card, imgs]) => (
            <CardGroup key={card} card={card} images={imgs} onStore={onStore} onDelete={onDelete} />
          ))}
        </ul>
      )}
      {images !== null && images.length > 0 && (
        <div className="images-clear">
          {confirmClear ? (
            <>
              <span>Delete all {images.length} images from this browser?</span>
              <button
                type="button"
                data-sfx="none"
                onClick={() => {
                  setConfirmClear(false);
                  focusHeading.current = true;
                  store.clear().then(
                    () => say('All images deleted.', 'ui.delete'),
                    (e: unknown) => say(`Could not delete the images: ${e instanceof Error ? e.message : String(e)}`, 'ui.error'),
                  );
                }}
              >
                Yes, delete all
              </button>
              <button type="button" data-sfx="ui.cancel" onClick={() => setConfirmClear(false)}>
                Keep them
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)}>
              Delete all images
            </button>
          )}
        </div>
      )}
      {/* Stays in view wherever the player scrolled to (images.css .images-toast). */}
      <p className="images-toast" role="status" aria-label="Image library status">
        {message}
      </p>
    </section>
  );
}
