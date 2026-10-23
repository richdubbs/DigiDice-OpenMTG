/**
 * The files a player picks on the Images screen: which are images, which is a decklist, and the card names of that decklist (to guide matching,
 * ARCHITECTURE.md "Card images" A: "prioritizing names in the uploaded decklist"). Only file NAMES go to the local server; image data never leaves the
 * browser.
 */
import { apiPost } from '../api/http';

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'] as const;
export const DECKLIST_EXTENSIONS = ['txt', 'dec'] as const;
/** Larger files are skipped (a card scan is a few MB at most). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const extOf = (name: string): string => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

export function isImageFile(f: { name: string; type?: string }): boolean {
  if (f.type && f.type.startsWith('image/') && f.type !== 'image/svg+xml') return true;
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extOf(f.name));
}

export function isDecklistFile(f: { name: string; type?: string }): boolean {
  return (DECKLIST_EXTENSIONS as readonly string[]).includes(extOf(f.name));
}

export interface SortedFiles {
  images: File[];
  decklists: File[];
  tooLarge: File[];
  ignored: File[];
}

export function sortFiles(files: Iterable<File>): SortedFiles {
  const out: SortedFiles = { images: [], decklists: [], tooLarge: [], ignored: [] };
  for (const f of files) {
    if (isImageFile(f)) (f.size > MAX_IMAGE_BYTES ? out.tooLarge : out.images).push(f);
    else if (isDecklistFile(f)) out.decklists.push(f);
    else out.ignored.push(f);
  }
  return out;
}

const SECTION = /^(deck|main|maindeck|mainboard|sideboard|commander|companion|maybeboard|about|name\s.*)$/i;
const ENTRY = /^(?:SB:\s*)?\d+x?\s+\S/i;
const SET_CODE = /\s\([A-Za-z0-9]{2,6}\)(?:\s+\S+)?$/;

/** A line written like a decklist entry: a count ("4 Name", "4x Name"), a sideboard mark ("SB: 2 Name"), or an Arena set code ("Name (SET) 123"). */
export const looksLikeDecklistLine = (line: string): boolean => ENTRY.test(line.trim()) || SET_CODE.test(line.trim());

/**
 * Card names of a decklist read locally (Arena "4 Name (SET) 123", MTGO "4 Name", "SB: 2 Name", "4x Name"): the fallback when the server cannot resolve
 * the list. Duplicates removed, order kept. `strict` (a file that may be any .txt): only lines written like decklist entries count, so prose is never
 * taken for card names.
 */
export function localDeckNames(text: string, opts: { strict?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#') || SECTION.test(line)) continue;
    if (opts.strict && !looksLikeDecklistLine(line)) continue;
    const m = /^(?:SB:\s*)?(\d+)x?\s+(.+?)$/i.exec(line);
    const name = (m ? m[2]! : line)
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(?:\s+\S+)?$/, '') // Arena set code and collector number
      .replace(/\s+\*[A-Z]+\*$/, '') // MTGO foil marks
      .trim();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The Oracle names of a decklist: resolved by the server (exact names, face aliases), or read locally if the server resolves none. */
export async function deckNamesOf(text: string, opts: { strict?: boolean } = {}): Promise<string[]> {
  if (text.trim() === '') return [];
  try {
    const res = await apiPost('POST /api/decks/resolve', { text });
    const names = [...new Set(res.cards.map((c) => c.name))];
    if (names.length > 0) return names;
  } catch {
    // fall through to the local reading
  }
  return localDeckNames(text, opts);
}

/** The card names of a .txt/.dec file among the chosen files; `decklist` is false when nothing in it reads as a decklist (a README, notes). */
export async function fileDeckNames(file: File): Promise<{ file: string; names: string[]; decklist: boolean }> {
  let names: string[] = [];
  try {
    names = await deckNamesOf(await readText(file), { strict: true });
  } catch {
    names = [];
  }
  return { file: file.name, names, decklist: names.length > 0 };
}

/**
 * Whether this browser can show an image file (HEIC photos and corrupt files cannot): it is decoded once, here, before it is stored. Where the browser
 * offers no way to decode (no createImageBitmap and no Image.decode), the file is accepted.
 */
export async function browserCanShow(file: Blob): Promise<boolean> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      return true;
    } catch {
      return false;
    }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof Image.prototype.decode !== 'function') return true;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth > 0;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Run `check` over the files, a few at a time, and split them into those that pass and those that do not (order kept). */
export async function partitionShowable(
  files: readonly File[],
  check: (file: Blob) => Promise<boolean>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: File[]; bad: File[] }> {
  const verdicts: boolean[] = new Array<boolean>(files.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      try {
        verdicts[i] = await check(files[i]!);
      } catch {
        verdicts[i] = false;
      }
      onProgress?.(++done, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return { ok: files.filter((_, i) => verdicts[i]), bad: files.filter((_, i) => !verdicts[i]) };
}

/** The text of a file (decklists). */
export async function readText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsText(file);
  });
}
