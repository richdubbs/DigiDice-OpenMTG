/**
 * Matching uploaded images to image slots (ARCHITECTURE.md "Card images" A): the server resolves each FILE NAME (`POST /api/images/match`, decklist names
 * preferred); confident matches are stored at once, the rest goes to the review screen where the player picks the card.
 */
import type { ImageFileMatch, ImageSlotMatch } from '@openmtg/server/api';
import { apiPost } from '../api/http';
import type { ImageStore, StoredImage } from './store';

/** At or above this confidence a match is stored without asking. */
export const AUTO_ACCEPT = 0.9;

export type ReviewReason = 'unmatched' | 'unsure' | 'duplicate';

export interface ReviewItem {
  id: string;
  file: File;
  reason: ReviewReason;
  /** The server's answer: the best guess and the alternatives offered as quick choices. */
  result: ImageFileMatch;
}

export interface MatchOutcome {
  accepted: { file: File; slot: ImageSlotMatch }[];
  review: ReviewItem[];
}

const emptyMatch = (fileName: string): ImageFileMatch => ({ fileName, match: null, confidence: 0, alternatives: [] });

/**
 * Ask the server about the files' names and split the answers: confident and unique -> accepted; no match or low confidence -> review. When several
 * confident files match the same slot, the most confident one gets it (the first in upload order on a tie) and the others go to review.
 */
export async function matchFiles(files: readonly File[], deckNames: readonly string[] = []): Promise<MatchOutcome> {
  if (files.length === 0) return { accepted: [], review: [] };
  const res = await apiPost('POST /api/images/match', { fileNames: files.map((f) => f.name), ...(deckNames.length > 0 ? { deckNames: [...deckNames] } : {}) });
  // The answers come in request order; fall back to the file name if a server ever reorders them.
  const byName = new Map<string, ImageFileMatch[]>();
  for (const m of res.matches) byName.set(m.fileName, [...(byName.get(m.fileName) ?? []), m]);
  const answerFor = (f: File, i: number): ImageFileMatch => {
    const at = res.matches[i];
    if (at && at.fileName === f.name) return at;
    const list = byName.get(f.name);
    return list?.shift() ?? emptyMatch(f.name);
  };

  const results = files.map((file, i) => answerFor(file, i));
  // The winner of each slot: highest confidence, then upload order.
  const winner = new Map<string, number>();
  results.forEach((r, i) => {
    if (!r.match || r.confidence < AUTO_ACCEPT) return;
    const best = winner.get(r.match.key);
    if (best === undefined || r.confidence > results[best]!.confidence) winner.set(r.match.key, i);
  });
  const out: MatchOutcome = { accepted: [], review: [] };
  files.forEach((file, i) => {
    const result = results[i]!;
    const id = `${i}:${file.name}`;
    if (!result.match) out.review.push({ id, file, reason: 'unmatched', result });
    else if (result.confidence < AUTO_ACCEPT) out.review.push({ id, file, reason: 'unsure', result });
    else if (winner.get(result.match.key) !== i) out.review.push({ id, file, reason: 'duplicate', result });
    else out.accepted.push({ file, slot: result.match });
  });
  return out;
}

const imageOf = (file: File, slot: ImageSlotMatch, now: number): StoredImage => ({
  key: slot.key,
  card: slot.card,
  label: slot.label,
  fileName: file.name,
  type: file.type,
  size: file.size,
  blob: file,
  addedAt: now,
});

/** Store a file as the image of a slot (replacing any image the slot had). */
export async function saveImage(store: ImageStore, file: File, slot: ImageSlotMatch, now: number = Date.now()): Promise<StoredImage> {
  const image = imageOf(file, slot, now);
  await store.put(image);
  return image;
}

/** Images per transaction when storing an upload: one notification (one library reload) per batch, not per file. */
export const SAVE_BATCH = 25;

/**
 * Store many files (an upload), a batch per transaction, reporting progress after each batch. A batch that fails is retried file by file, so one bad
 * file does not lose the others; the files that still fail are returned with the reason.
 */
export async function saveImages(
  store: ImageStore,
  items: readonly { file: File; slot: ImageSlotMatch }[],
  opts: { batchSize?: number; now?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ stored: number; failed: { file: File; error: unknown }[] }> {
  const size = Math.max(1, opts.batchSize ?? SAVE_BATCH);
  const now = opts.now ?? Date.now();
  let stored = 0;
  const failed: { file: File; error: unknown }[] = [];
  for (let at = 0; at < items.length; at += size) {
    const batch = items.slice(at, at + size);
    try {
      await store.putMany(batch.map((b) => imageOf(b.file, b.slot, now)));
      stored += batch.length;
    } catch {
      for (const b of batch) {
        try {
          await store.put(imageOf(b.file, b.slot, now));
          stored++;
        } catch (error) {
          failed.push({ file: b.file, error });
        }
      }
    }
    opts.onProgress?.(Math.min(at + size, items.length), items.length);
  }
  return { stored, failed };
}

/** The quick choices of a review item: the best guess first, then the alternatives, without repeats. */
export function choicesOf(result: ImageFileMatch): ImageSlotMatch[] {
  const out: ImageSlotMatch[] = [];
  for (const s of [result.match, ...result.alternatives]) if (s && !out.some((o) => o.key === s.key)) out.push(s);
  return out;
}
