/**
 * Card images (docs/design/m8-client.md screen 4; ARCHITECTURE.md "Card images" A): upload files or a folder (optionally with a decklist), match them by
 * file name (`POST /api/images/match`, decklist names preferred), review what was not matched for sure, and manage the stored images (per printed side;
 * replace, delete). Images are stored only in this browser (IndexedDB); only file names are sent to the local server. The Scryfall images switch is
 * here too (the same setting as in Settings), so the player never has to leave the screen, and the review list outlives it (images/review.ts).
 * An upload that stored images ends with ui.success (ui.notify when it stored none, e.g. all to review), a failure with ui.error.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import type { ImageSlotMatch } from '@openmtg/server/api';
import { ScreenHeader } from '../app/ScreenHeader';
import { sfx } from '../audio/sfx';
import { useCardImages } from './context';
import { deckNamesOf, fileDeckNames, partitionShowable, sortFiles } from './files';
import { ImageLibrary } from './ImageLibrary';
import { matchFiles, saveImage, saveImages, type MatchOutcome, type ReviewItem } from './matching';
import { ReviewList } from './ReviewList';
import { ScryfallImagesSetting } from './ScryfallImagesSetting';
import './images.css';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c", "a, b, c and 4 more". */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? '';
  const shown = names.length > max ? [...names.slice(0, max), `${names.length - max} more`] : [...names];
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The decklist names to guide matching: the text box and every decklist file among the chosen files, together. */
async function deckNamesFor(text: string, files: readonly File[]): Promise<{ names: string[]; sources: string[]; notDecklists: string[] }> {
  const names: string[] = [];
  const sources: string[] = [];
  const notDecklists: string[] = [];
  const add = (list: readonly string[]) => {
    for (const n of list) if (!names.includes(n)) names.push(n);
  };
  const typed = await deckNamesOf(text);
  if (typed.length > 0) {
    add(typed);
    sources.push('the text box');
  }
  for (const f of files) {
    const read = await fileDeckNames(f);
    if (read.decklist) {
      add(read.names);
      sources.push(read.file);
    } else notDecklists.push(read.file);
  }
  return { names, sources, notDecklists };
}

export function ImagesScreen({ debounceMs }: { debounceMs?: number } = {}) {
  const { store, review, canShow } = useCardImages();
  const items = useSyncExternalStore(review.subscribe, review.get);
  const [deckText, setDeckText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const folderRef = useRef<HTMLInputElement>(null);
  const uploadHeading = useRef<HTMLHeadingElement>(null);
  const filesId = useId();
  const folderId = useId();
  const deckId = useId();

  useEffect(() => {
    // Folder picking is a non-standard attribute React does not know (supported by every current browser).
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  }, []);

  const upload = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setBusy(true);
    const sorted = sortFiles(files);
    const notes: string[] = [];
    try {
      setMessage('Checking images…');
      const { ok: images, bad } = await partitionShowable(sorted.images, canShow, (done, total) => setMessage(`Checking image ${done} of ${total}…`));
      const deck = await deckNamesFor(deckText, sorted.decklists);
      for (const f of deck.notDecklists) notes.push(`${f} does not look like a decklist, so it was not used.`);
      setMessage('Matching file names…');
      let outcome: MatchOutcome;
      try {
        outcome = await matchFiles(images, deck.names);
      } catch (e) {
        notes.push(`Automatic matching is unavailable (${errorText(e)}): pick the cards below.`);
        outcome = {
          accepted: [],
          review: images.map((file, i) => ({ id: `${i}:${file.name}`, file, reason: 'unmatched', result: { fileName: file.name, match: null, confidence: 0, alternatives: [] } })),
        };
      }
      const saved = await saveImages(store, outcome.accepted, { onProgress: (done, total) => setMessage(`Storing ${done} of ${total}…`) });
      for (const f of saved.failed) notes.push(`Could not store ${f.file.name}: ${errorText(f.error)}`);
      review.add(outcome.review);
      const parts = [`Stored ${plural(saved.stored, 'image')}.`];
      if (outcome.review.length > 0) parts.push(`${plural(outcome.review.length, 'image')} to review.`);
      if (bad.length > 0) {
        const them = bad.length === 1 ? 'it' : 'them';
        parts.push(`${nameList(bad.map((f) => f.name))} cannot be shown by this browser; convert ${them} to JPEG or PNG.`);
      }
      if (sorted.tooLarge.length > 0) parts.push(`Skipped ${plural(sorted.tooLarge.length, 'file')} over 25 MB.`);
      if (sorted.ignored.length > 0) parts.push(`Ignored ${plural(sorted.ignored.length, 'file')} that ${sorted.ignored.length === 1 ? 'is' : 'are'} not an image.`);
      if (deck.names.length > 0) parts.push(`Decklist used: ${plural(deck.names.length, 'card name')} (from ${nameList(deck.sources)}).`);
      setMessage([...parts, ...notes].join(' '));
      sfx(saved.stored > 0 ? 'ui.success' : 'ui.notify');
    } catch (e) {
      setMessage(`Upload failed: ${errorText(e)}`);
      sfx('ui.error');
    } finally {
      setBusy(false);
    }
  };

  const choose = (item: ReviewItem, slot: ImageSlotMatch) => {
    saveImage(store, item.file, slot).then(
      () => {
        review.remove(item.id);
        setMessage(`Stored ${item.file.name} as ${slot.label}.`);
        sfx('ui.success');
      },
      (e: unknown) => {
        setMessage(`Could not store ${item.file.name}: ${errorText(e)}`);
        sfx('ui.error');
      },
    );
  };
  const focusUpload = useCallback(() => uploadHeading.current?.focus(), []);

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const list = input.files;
    void upload(list).finally(() => {
      input.value = '';
    });
  };

  const disabled = busy || !store.available;
  return (
    <div className="screen images-screen">
      <ScreenHeader title="Card images" />
      <p className="muted">Add pictures of your own cards. They are matched to cards by file name and stored only in this browser; they are never uploaded anywhere.</p>
      {!store.available && (
        <p role="alert" className="images-warning">
          This browser cannot store images (IndexedDB is unavailable). Cards show their text frames instead.
        </p>
      )}

      <section className="hud-panel images-panel" aria-labelledby="upload-heading">
        <h2 id="upload-heading" ref={uploadHeading} tabIndex={-1}>
          Upload
        </h2>
        {/* Each input comes right before its label: the label shows the input's keyboard focus (images.css). */}
        <div className="upload-row">
          <input id={filesId} type="file" accept="image/*,.txt,.dec" multiple disabled={disabled} className="visually-hidden" aria-label="Choose image files" onChange={onPicked} />
          <label htmlFor={filesId} className="button button-primary" aria-disabled={disabled}>
            Choose image files
          </label>
          <input id={folderId} ref={folderRef} type="file" multiple disabled={disabled} className="visually-hidden" aria-label="Choose a folder" onChange={onPicked} />
          <label htmlFor={folderId} className="button" aria-disabled={disabled}>
            Choose a folder
          </label>
        </div>
        <label htmlFor={deckId} className="deck-label">
          Decklist (optional): names in it are preferred when a file name is unclear. A .txt decklist among the chosen files is used too, together with this
          list.
        </label>
        <textarea id={deckId} rows={4} value={deckText} onChange={(e) => setDeckText(e.target.value)} placeholder={'4 Card Name\n2 Another Card'} />
        <ScryfallImagesSetting />
        <p role="status" aria-label="Upload status" className="images-status">
          {message}
        </p>
      </section>

      <ReviewList
        items={items}
        onChoose={choose}
        onSkip={(it) => review.remove(it.id)}
        onSkipAll={() => {
          review.clear();
          setMessage('Skipped every image waiting for review.');
        }}
        onEmptied={focusUpload}
        {...(debounceMs !== undefined ? { debounceMs } : {})}
      />
      {store.available && <ImageLibrary {...(debounceMs !== undefined ? { debounceMs } : {})} />}
    </div>
  );
}
