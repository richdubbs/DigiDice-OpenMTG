/** The IndexedDB image store (ARCHITECTURE.md "Card images" A: stored only in the browser, keyed by image slot). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idbImageStore, type StoredImage } from '../../src/images/store';
import { UploadedImages } from '../../src/images/uploads';
import { fakeIndexedDB, fakeObjectUrls } from '../fake-indexeddb';
import { imageFile } from '../card-fixtures';

const img = (key: string, card: string, label = key, fileName = `${key}.jpg`): StoredImage => ({ key, card, label, fileName, type: 'image/jpeg', size: 3, blob: imageFile(fileName), addedAt: 1 });

afterEach(() => vi.restoreAllMocks());

describe('idbImageStore', () => {
  it('creates its object store on first use and stores, reads and lists images by slot key', async () => {
    const idb = fakeIndexedDB();
    const store = idbImageStore(idb.factory, 'db1');
    expect(store.available).toBe(true);
    await store.put(img('Insectile Aberration', 'Delver of Secrets // Insectile Aberration', 'Insectile Aberration (back)'));
    await store.put(img('Delver of Secrets', 'Delver of Secrets // Insectile Aberration', 'Delver of Secrets (front)'));
    await store.put(img('Forest', 'Forest'));
    expect((await store.get('Forest'))?.fileName).toBe('Forest.jpg');
    expect((await store.get('Forest'))?.blob).toBeInstanceOf(Blob);
    expect(await store.get('Island')).toBeUndefined();
    // Sorted by card, then slot label.
    expect((await store.list()).map((i) => i.label)).toEqual(['Delver of Secrets (front)', 'Insectile Aberration (back)', 'Forest']);
    expect(idb.rows('db1', 'images')).toHaveLength(3);
  });

  it('storing a slot again replaces its image; delete and clear remove them', async () => {
    const store = idbImageStore(fakeIndexedDB().factory);
    await store.put(img('Forest', 'Forest', 'Forest', 'old.jpg'));
    await store.put(img('Forest', 'Forest', 'Forest', 'new.jpg'));
    expect((await store.list()).map((i) => i.fileName)).toEqual(['new.jpg']);
    await store.put(img('Island', 'Island'));
    await store.delete('Forest');
    expect((await store.list()).map((i) => i.key)).toEqual(['Island']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('notifies subscribers after each change, and a failed write rejects without notifying', async () => {
    const idb = fakeIndexedDB();
    const store = idbImageStore(idb.factory);
    const seen = vi.fn();
    const off = store.subscribe(seen);
    await store.put(img('Forest', 'Forest'));
    await store.delete('Forest');
    expect(seen).toHaveBeenCalledTimes(2);
    idb.failNextWrite();
    await expect(store.put(img('Island', 'Island'))).rejects.toThrow(/Quota/);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    await store.put(img('Island', 'Island'));
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('putMany stores a whole batch in one transaction and notifies once, naming the changed slots', async () => {
    const idb = fakeIndexedDB();
    const store = idbImageStore(idb.factory, 'batch');
    const seen: (readonly string[] | null)[] = [];
    store.subscribe((keys) => seen.push(keys));
    await store.putMany([img('Forest', 'Forest'), img('Island', 'Island'), img('Swamp', 'Swamp')]);
    expect(seen).toEqual([['Forest', 'Island', 'Swamp']]);
    expect(idb.rows('batch', 'images')).toHaveLength(3);
    await store.putMany([]);
    expect(seen).toHaveLength(1);
    await store.delete('Island');
    await store.clear();
    expect(seen.slice(1)).toEqual([['Island'], null]);
  });

  it('a browser without IndexedDB has no upload store (placeholders and Scryfall images still work)', async () => {
    const store = idbImageStore(undefined);
    // jsdom has no IndexedDB, so the default is unavailable too.
    expect(idbImageStore().available).toBe(false);
    expect(store.available).toBe(false);
    await expect(store.get('Forest')).rejects.toThrow(/no IndexedDB/);
  });
});

describe('UploadedImages', () => {
  it('loads a slot once, gives an object URL for its Blob, and revokes it when the image changes or goes', async () => {
    const store = idbImageStore(fakeIndexedDB().factory);
    const urls = fakeObjectUrls();
    const uploads = new UploadedImages(store, urls);
    const changed = vi.fn();
    uploads.subscribe(changed);
    expect(uploads.peek('Forest')).toBeUndefined();
    uploads.load('Forest');
    expect(uploads.peek('Forest')).toEqual({ status: 'loading' });
    await vi.waitFor(() => expect(uploads.peek('Forest')).toEqual({ status: 'none' }));

    await store.put(img('Forest', 'Forest'));
    await vi.waitFor(() => expect(uploads.peek('Forest')?.status).toBe('ready'));
    const first = uploads.peek('Forest');
    const url = first?.status === 'ready' ? first.url : '';
    expect(urls.live.get(url)).toBeInstanceOf(Blob);
    uploads.load('Forest'); // already known: no new read
    expect(uploads.peek('Forest')).toBe(first);

    await store.delete('Forest');
    await vi.waitFor(() => expect(uploads.peek('Forest')).toEqual({ status: 'none' }));
    expect(urls.revoked).toEqual([url]);
    expect(changed).toHaveBeenCalled();
  });

  it('re-reads only the slots a change names, not every slot it has shown', async () => {
    const store = idbImageStore(fakeIndexedDB().factory);
    await store.putMany([img('Forest', 'Forest'), img('Island', 'Island')]);
    const uploads = new UploadedImages(store, fakeObjectUrls());
    uploads.load('Forest');
    uploads.load('Island');
    await vi.waitFor(() => expect(uploads.peek('Island')?.status).toBe('ready'));
    const get = vi.spyOn(store, 'get');
    await store.put(img('Forest', 'Forest', 'Forest', 'new.jpg'));
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.map((c) => c[0])).toEqual(['Forest']);
    // A change that names nothing (clear) re-reads everything shown.
    get.mockClear();
    await store.clear();
    await vi.waitFor(() => expect(uploads.peek('Island')).toEqual({ status: 'none' }));
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual(['Forest', 'Island']);
  });

  it('answers "none" at once when the store is unavailable', () => {
    const uploads = new UploadedImages(idbImageStore(undefined), fakeObjectUrls());
    uploads.load('Forest');
    expect(uploads.peek('Forest')).toEqual({ status: 'none' });
  });
});
