/**
 * The player's own card pictures in the server's data folder (`<data>/library/images/`): one file per image slot (the engine's
 * `imageSlots` key: one per printed side), named by a hash of the key, and `index.json` listing them. Same record as the desktop
 * client's browser store (client/src/images/store.ts StoredImage), with the stored file's local path instead of the bytes: the
 * Godot app and the server run on the same machine, so the app reads the file itself.
 *
 * A picture is added from a local file (`path`, what the Godot app's file dialog picked) or from its bytes (`data`, base64: the
 * desktop client copying its browser store over). Either way the server checks the size (MAX_IMAGE_BYTES) and that the bytes are
 * an image (PNG, JPEG, GIF, WebP, BMP, AVIF or HEIC, by their first bytes), so a path that is not an image is never copied.
 *
 * GET /api/library/images, POST /api/library/images/add, POST /api/library/images/delete, POST /api/library/images/clear.
 */
import { createHash } from 'node:crypto';
import { open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryImage } from '../api';
import { badRequest, type Handler, type ServerContext } from '../context';
import { libraryDir } from './decks';
import { readJsonFile, serialized, writeAtomic } from './files';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT = 300;

interface IndexEntry {
  key: string;
  card: string;
  label: string;
  fileName: string;
  type: string;
  size: number;
  addedAt: number;
  /** The stored file's name in the images folder. */
  file: string;
}

export function imagesDir(ctx: ServerContext): string {
  return path.join(libraryDir(ctx), 'images');
}

const indexFile = (ctx: ServerContext) => path.join(imagesDir(ctx), 'index.json');

const text = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;

function isEntry(v: unknown): v is IndexEntry {
  const e = v as Record<string, unknown> | null;
  return !!e && typeof e === 'object' && text(e['key']) && e['key'] !== '' && text(e['card']) && text(e['label']) && text(e['fileName']) &&
    text(e['type'], 100) && typeof e['size'] === 'number' && typeof e['addedAt'] === 'number' && typeof e['file'] === 'string' && /^[0-9a-f]{40}\.[a-z]{3,4}$/.test(e['file']);
}

async function readIndex(ctx: ServerContext): Promise<IndexEntry[]> {
  const v = await readJsonFile(indexFile(ctx));
  const list = (v as { images?: unknown } | undefined)?.images;
  return Array.isArray(list) ? list.filter(isEntry) : [];
}

const writeIndex = (ctx: ServerContext, entries: IndexEntry[]) => writeAtomic(indexFile(ctx), `${JSON.stringify({ images: entries }, null, 1)}\n`);

/** Card, then label, then key (the desktop client's order). */
function sorted(entries: IndexEntry[]): IndexEntry[] {
  return [...entries].sort((a, b) => a.card.localeCompare(b.card) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

function shown(ctx: ServerContext, e: IndexEntry): LibraryImage {
  return { key: e.key, card: e.card, label: e.label, fileName: e.fileName, type: e.type, size: e.size, addedAt: e.addedAt, path: path.join(imagesDir(ctx), e.file) };
}

/** The picture type of these first bytes, with its file extension; null when they are not a picture this store keeps. */
export function sniffImage(head: Uint8Array): { type: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.length >= 8 && head[0] === 0x89 && ascii(1, 4) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a) return { type: 'image/png', ext: 'png' };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (head.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { type: 'image/gif', ext: 'gif' };
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (head.length >= 2 && ascii(0, 2) === 'BM') return { type: 'image/bmp', ext: 'bmp' };
  if (head.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return { type: 'image/avif', ext: 'avif' };
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return { type: 'image/heic', ext: 'heic' };
  }
  return null;
}

async function bytesFromPath(file: string): Promise<Buffer | string> {
  if (!path.isAbsolute(file)) return 'path must be an absolute path of a file on this computer.';
  let size: number;
  try {
    const st = await stat(file);
    if (!st.isFile()) return `${path.basename(file)} is not a file.`;
    size = st.size;
  } catch {
    return `${path.basename(file)} could not be read.`;
  }
  if (size > MAX_IMAGE_BYTES) return `${path.basename(file)} is too large (over 25 MB).`;
  // Only the first bytes are read before it is known to be a picture.
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    if (!sniffImage(head)) return `${path.basename(file)} is not an image file.`;
  } finally {
    await handle.close();
  }
  return readFile(file);
}

export const getLibraryImages: Handler<'GET /api/library/images'> = async (_req, ctx) => ({
  status: 200,
  body: { images: sorted(await readIndex(ctx)).map((e) => shown(ctx, e)) },
});

export const postLibraryImageAdd: Handler<'POST /api/library/images/add'> = async (req, ctx) => {
  const b = req.body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return badRequest('Send {"key", "card", "label", "fileName"?, and "path" or "data"}.');
  const { key, card, label } = b;
  if (!text(key) || key === '' || !text(card) || card === '' || !text(label)) return badRequest('key, card and label must be text of at most 300 characters.');
  const fileName = b['fileName'] ?? (typeof b['path'] === 'string' ? path.basename(b['path']) : 'image');
  if (!text(fileName)) return badRequest('fileName must be text of at most 300 characters.');
  let bytes: Buffer;
  if (typeof b['path'] === 'string') {
    const r = await bytesFromPath(b['path']);
    if (typeof r === 'string') return badRequest(r);
    bytes = r;
  } else if (typeof b['data'] === 'string') {
    bytes = Buffer.from(b['data'], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) return badRequest(`${fileName} is too large (over 25 MB).`);
  } else return badRequest('Send the picture as "path" (a file on this computer) or "data" (base64).');
  const kind = sniffImage(bytes.subarray(0, 16));
  if (!kind) return badRequest(`${fileName} is not an image file.`);
  const file = `${createHash('sha1').update(key).digest('hex')}.${kind.ext}`;
  const entry: IndexEntry = { key, card, label, fileName, type: kind.type, size: bytes.length, addedAt: Date.now(), file };
  await serialized(indexFile(ctx), async () => {
    const entries = await readIndex(ctx);
    const old = entries.find((e) => e.key === key);
    await writeAtomic(path.join(imagesDir(ctx), file), bytes);
    if (old && old.file !== file) await rm(path.join(imagesDir(ctx), old.file), { force: true });
    await writeIndex(ctx, [...entries.filter((e) => e.key !== key), entry]);
  });
  return { status: 200, body: { image: shown(ctx, entry) } };
};

export const postLibraryImageDelete: Handler<'POST /api/library/images/delete'> = async (req, ctx) => {
  const key = (req.body as Record<string, unknown> | null)?.['key'];
  if (!text(key) || key === '') return badRequest('Send {"key": "<image slot key>"}.');
  const deleted = await serialized(indexFile(ctx), async () => {
    const entries = await readIndex(ctx);
    const old = entries.find((e) => e.key === key);
    if (!old) return false;
    await writeIndex(ctx, entries.filter((e) => e.key !== key));
    await rm(path.join(imagesDir(ctx), old.file), { force: true });
    return true;
  });
  return { status: 200, body: { deleted } };
};

export const postLibraryImageClear: Handler<'POST /api/library/images/clear'> = async (_req, ctx) => {
  const deleted = await serialized(indexFile(ctx), async () => {
    const entries = await readIndex(ctx);
    await writeIndex(ctx, []);
    for (const e of entries) await rm(path.join(imagesDir(ctx), e.file), { force: true });
    return entries.length;
  });
  return { status: 200, body: { deleted } };
};
