/** The player's library in the server's data folder: the deck routes (save with the version check, list, get, delete), the settings object and the pictures. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LibraryDeck } from '../src/api';
import type { ApiRequest, ServerContext } from '../src/context';
import { decksDir, getLibraryDeck, getLibraryDecks, postLibraryDeckDelete, postLibraryDeckSave, readDeck } from '../src/library/decks';
import { getLibraryImages, imagesDir, MAX_IMAGE_BYTES, postLibraryImageAdd, postLibraryImageClear, postLibraryImageDelete, sniffImage } from '../src/library/images';
import { getLibrarySettings, MAX_SETTINGS_BYTES, postLibrarySettings } from '../src/library/settings';

let dir: string;
let ctx: ServerContext;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'openmtg-library-'));
  ctx = { cacheDir: path.join(dir, 'scryfall'), compiledDir: path.join(dir, 'compiled'), version: 'test' };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({ query: {}, params: {}, body: undefined, ...over });

function deck(over: Partial<LibraryDeck> = {}): LibraryDeck {
  return {
    id: '0b6f3c7e-2a59-4f0e-9a51-6f1d8f0b1c2d',
    name: 'Red burn',
    format: 'modern',
    main: [{ name: 'Lightning Bolt', count: 4, oracleId: '4457ed35-7c10-48c8-9776-456485fdf070' }, { name: 'Mountain', count: 20 }],
    sideboard: [],
    commander: [],
    companion: [],
    notes: '',
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...over,
  };
}

async function save(d: unknown, expected?: string | null) {
  return postLibraryDeckSave(req({ body: expected === undefined ? { deck: d } : { deck: d, expected } }), ctx);
}

describe('deck library', () => {
  it('starts empty, and keeps a saved deck in the library folder next to the card cache', async () => {
    expect(await getLibraryDecks(req(), ctx)).toEqual({ status: 200, body: { decks: [] } });
    expect((await save(deck(), null)).status).toBe(200);
    expect(readdirSync(path.join(dir, 'library', 'decks'))).toEqual(['0b6f3c7e-2a59-4f0e-9a51-6f1d8f0b1c2d.json']);
    expect(await getLibraryDeck(req({ params: { id: deck().id } }), ctx)).toEqual({ status: 200, body: { deck: deck() } });
  });

  it('lists the newest first, then by name', async () => {
    await save(deck({ id: 'a', name: 'Older', updatedAt: '2026-10-01T00:00:00.000Z' }));
    await save(deck({ id: 'b', name: 'Zed', updatedAt: '2026-10-20T00:00:00.000Z' }));
    await save(deck({ id: 'c', name: 'Alpha', updatedAt: '2026-10-20T00:00:00.000Z' }));
    const r = await getLibraryDecks(req(), ctx);
    expect(r.status === 200 && r.body.decks.map((d) => d.name)).toEqual(['Alpha', 'Zed', 'Older']);
  });

  it('refuses a save against another stored version and writes nothing (409 with the stored deck)', async () => {
    await save(deck(), null);
    const newer = deck({ name: 'Renamed', updatedAt: '2026-10-28T11:00:00.000Z' });
    expect((await save(newer, deck().updatedAt)).status).toBe(200);
    const stale = await save(deck({ name: 'Stale tab', updatedAt: '2026-10-28T12:00:00.000Z' }), deck().updatedAt);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'deckConflict', stored: { name: 'Renamed' } });
    const again = await save(deck({ name: 'Copy' }), null);
    expect(again.status).toBe(409);
    const r = await getLibraryDeck(req({ params: { id: deck().id } }), ctx);
    expect(r.status === 200 && r.body.deck.name).toBe('Renamed');
  });

  it('lets exactly one of two saves against the same version through', async () => {
    await save(deck(), null);
    const results = await Promise.all([
      save(deck({ name: 'One', updatedAt: '2026-10-28T11:00:00.000Z' }), deck().updatedAt),
      save(deck({ name: 'Two', updatedAt: '2026-10-28T11:00:01.000Z' }), deck().updatedAt),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(readdirSync(decksDir(ctx))).toEqual([`${deck().id}.json`]);
  });

  it('keeps the record fields only, fills missing sections and notes, and refuses what is not a deck', async () => {
    const r = await save({ ...deck(), extra: 'dropped', commander: undefined, companion: undefined, notes: undefined });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deck: deck() });
    for (const bad of [
      { ...deck(), id: '../escape' },
      { ...deck(), id: '' },
      { ...deck(), name: 5 },
      { ...deck(), main: [{ name: 'Mountain', count: 0 }] },
      { ...deck(), main: [{ name: 'Mountain', count: 1.5 }] },
      { ...deck(), main: [{ count: 1 }] },
      { ...deck(), sideboard: 'Mountain' },
      { ...deck(), updatedAt: undefined },
      'deck',
    ]) {
      expect((await save(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await postLibraryDeckSave(req({ body: { deck: deck(), expected: 7 } }), ctx)).status).toBe(400);
    expect((await getLibraryDeck(req({ params: { id: '..' } }), ctx)).status).toBe(400);
  });

  it('skips a stored file that does not read as a deck, or whose id is not its name', async () => {
    await save(deck());
    mkdirSync(decksDir(ctx), { recursive: true });
    writeFileSync(path.join(decksDir(ctx), 'broken.json'), '{ not json');
    writeFileSync(path.join(decksDir(ctx), 'other.json'), JSON.stringify(deck({ id: 'someone-else' })));
    const r = await getLibraryDecks(req(), ctx);
    expect(r.status === 200 && r.body.decks.map((d) => d.id)).toEqual([deck().id]);
    expect((await getLibraryDeck(req({ params: { id: 'other' } }), ctx)).status).toBe(404);
  });

  it('deletes a deck, and says when there was none', async () => {
    await save(deck());
    expect(await postLibraryDeckDelete(req({ body: { id: deck().id } }), ctx)).toEqual({ status: 200, body: { deleted: true } });
    expect(await postLibraryDeckDelete(req({ body: { id: deck().id } }), ctx)).toEqual({ status: 200, body: { deleted: false } });
    expect((await getLibraryDeck(req({ params: { id: deck().id } }), ctx)).status).toBe(404);
    expect((await postLibraryDeckDelete(req({ body: { id: '../x' } }), ctx)).status).toBe(400);
  });

  it('leaves no temporary files behind', async () => {
    for (let i = 0; i < 5; i++) await save(deck({ updatedAt: `2026-10-28T10:00:0${i}.000Z` }));
    expect(readdirSync(decksDir(ctx))).toEqual([`${deck().id}.json`]);
  });

  it('reads the desktop client record as it is', () => {
    expect(readDeck(deck({ cover: 'Lightning Bolt' }))).toEqual(deck({ cover: 'Lightning Bolt' }));
  });
});

describe('settings', () => {
  it('is null until saved, then gives back the object as sent', async () => {
    expect(await getLibrarySettings(req(), ctx)).toEqual({ status: 200, body: { settings: null, updatedAt: null } });
    const settings = { 'openmtg.settings': { animationSpeed: 'fast' }, names: ['Ann', 'Bo'] };
    const saved = await postLibrarySettings(req({ body: { settings } }), ctx);
    expect(saved.status).toBe(200);
    const r = await getLibrarySettings(req(), ctx);
    expect(r).toEqual({ status: 200, body: { settings, updatedAt: saved.status === 200 ? saved.body.updatedAt : '' } });
  });

  it('refuses what is not an object, and an object over the size limit', async () => {
    for (const body of [{}, { settings: [] }, { settings: 'x' }, null]) expect((await postLibrarySettings(req({ body }), ctx)).status).toBe(400);
    const big = { settings: { text: 'x'.repeat(MAX_SETTINGS_BYTES) } };
    expect((await postLibrarySettings(req({ body: big }), ctx)).status).toBe(400);
  });
});

describe('images', () => {
  // The smallest PNG: a 1x1 transparent pixel.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const add = (body: Record<string, unknown>) => postLibraryImageAdd(req({ body }), ctx);
  const slot = { key: 'Delver of Secrets', card: 'Delver of Secrets // Insectile Aberration', label: 'Delver of Secrets (front)' };

  it('starts empty, adds a picture from a file on this computer and lists it with its stored path', async () => {
    expect(await getLibraryImages(req(), ctx)).toEqual({ status: 200, body: { images: [] } });
    const file = path.join(dir, 'delver.png');
    writeFileSync(file, PNG);
    const r = await add({ ...slot, path: file });
    expect(r.status).toBe(200);
    const list = await getLibraryImages(req(), ctx);
    expect(list.status === 200 && list.body.images).toMatchObject([{ ...slot, fileName: 'delver.png', type: 'image/png', size: PNG.length }]);
    const stored = list.status === 200 ? list.body.images[0]!.path : '';
    expect(readFileSync(stored).equals(PNG)).toBe(true);
    expect(path.dirname(stored)).toBe(imagesDir(ctx));
  });

  it('adds one from its bytes, and a new picture for the same slot replaces the old file', async () => {
    expect((await add({ ...slot, fileName: 'a.png', data: PNG.toString('base64') })).status).toBe(200);
    const first = await getLibraryImages(req(), ctx);
    const oldPath = first.status === 200 ? first.body.images[0]!.path : '';
    expect((await add({ ...slot, fileName: 'b.jpg', data: JPEG.toString('base64') })).status).toBe(200);
    const second = await getLibraryImages(req(), ctx);
    expect(second.status === 200 && second.body.images.map((i) => [i.fileName, i.type])).toEqual([['b.jpg', 'image/jpeg']]);
    expect(existsSync(oldPath)).toBe(false);
  });

  it('refuses what is not a picture, a relative path, a missing file and a file over 25 MB', async () => {
    const text = path.join(dir, 'notes.txt');
    writeFileSync(text, 'just text');
    const big = path.join(dir, 'big.png');
    writeFileSync(big, PNG);
    truncateSync(big, MAX_IMAGE_BYTES + 1);
    for (const body of [
      { ...slot, path: text },
      { ...slot, path: 'relative.png' },
      { ...slot, path: path.join(dir, 'missing.png') },
      { ...slot, path: big },
      { ...slot, data: Buffer.from('hello').toString('base64') },
      { ...slot },
      { ...slot, key: '' },
    ]) {
      expect((await add(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await getLibraryImages(req(), ctx)).toEqual({ status: 200, body: { images: [] } });
  });

  it('deletes one picture, then all of them', async () => {
    await add({ ...slot, data: PNG.toString('base64') });
    await add({ key: 'Forest', card: 'Forest', label: 'Forest', data: PNG.toString('base64') });
    await add({ key: 'Island', card: 'Island', label: 'Island', data: JPEG.toString('base64') });
    expect(await postLibraryImageDelete(req({ body: { key: 'Forest' } }), ctx)).toEqual({ status: 200, body: { deleted: true } });
    expect(await postLibraryImageDelete(req({ body: { key: 'Forest' } }), ctx)).toEqual({ status: 200, body: { deleted: false } });
    const list = await getLibraryImages(req(), ctx);
    expect(list.status === 200 && list.body.images.map((i) => i.key)).toEqual(['Delver of Secrets', 'Island']);
    expect(await postLibraryImageClear(req({ body: {} }), ctx)).toEqual({ status: 200, body: { deleted: 2 } });
    expect(readdirSync(imagesDir(ctx))).toEqual(['index.json']);
  });

  it('knows a picture by its first bytes', () => {
    const ascii = (s: string) => Buffer.from(s, 'latin1');
    expect(sniffImage(PNG)?.type).toBe('image/png');
    expect(sniffImage(JPEG)?.type).toBe('image/jpeg');
    expect(sniffImage(ascii('GIF89a......'))?.type).toBe('image/gif');
    expect(sniffImage(ascii('RIFF\0\0\0\0WEBPVP8 '))?.type).toBe('image/webp');
    expect(sniffImage(ascii('BM\0\0\0\0\0\0'))?.type).toBe('image/bmp');
    expect(sniffImage(ascii('\0\0\0\x1cftypavif'))?.type).toBe('image/avif');
    expect(sniffImage(ascii('\0\0\0\x18ftypheic'))?.type).toBe('image/heic');
    expect(sniffImage(ascii('<svg xmlns='))).toBeNull();
    expect(sniffImage(ascii('%PDF-1.7'))).toBeNull();
  });
});
