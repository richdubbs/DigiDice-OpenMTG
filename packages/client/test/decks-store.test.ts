/** The deck library store: IndexedDB (through a small fake), the memory fallback, failed commits, blocked storage and edits from another tab. */
import { describe, expect, it } from 'vitest';
import { BrowserDeckStore, DeckConflictError, IndexedDbDeckStore, MemoryDeckStore, type DeckStore } from '../src/decks/store';
import { deckFixture } from './decks-fixtures';
import { FakeIdbControls } from './decks-fake-idb';

describe('IndexedDB deck store', () => {
  it('saves, lists newest first, reads back and deletes decks', async () => {
    const idb = new FakeIdbControls();
    const store = new IndexedDbDeckStore(idb.factory);
    await store.put(deckFixture({ id: 'a', name: 'Older', updatedAt: '2026-01-01T00:00:00Z' }));
    await store.put(deckFixture({ id: 'b', name: 'Newer' }));
    expect((await store.list()).map((d) => d.name)).toEqual(['Newer', 'Older']);
    expect((await store.get('a'))!.main).toEqual(deckFixture().main);
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });

  it('a save the browser aborts after the request succeeded (full disk) is reported, not taken as saved', async () => {
    const idb = new FakeIdbControls();
    const store = new IndexedDbDeckStore(idb.factory);
    await store.put(deckFixture());
    idb.abortNextCommit();
    await expect(store.put(deckFixture({ name: 'Lost' }))).rejects.toThrow(/no room left/);
    expect((await store.get('deck-1'))!.name).toBe('Gruul Test');
    idb.abortNextCommit();
    await expect(store.delete('deck-1')).rejects.toThrow();
    expect(await store.get('deck-1')).toBeDefined();
  });

  it('does not overwrite a deck changed elsewhere (another tab) since this screen loaded it', async () => {
    const stores: DeckStore[] = [new IndexedDbDeckStore(new FakeIdbControls().factory), new MemoryDeckStore()];
    for (const store of stores) {
      await store.put(deckFixture({ updatedAt: 'v1' }));
      await store.put(deckFixture({ name: 'Tab B', updatedAt: 'v2' }), 'v1');
      await expect(store.put(deckFixture({ name: 'Tab A', updatedAt: 'v3' }), 'v1')).rejects.toBeInstanceOf(DeckConflictError);
      expect((await store.get('deck-1'))!.name).toBe('Tab B');
      // A new deck (expected: not stored yet) must not replace one that exists.
      await expect(store.put(deckFixture({ updatedAt: 'v4' }), null)).rejects.toBeInstanceOf(DeckConflictError);
    }
  });
});

describe('browser deck store (IndexedDB with a memory fallback)', () => {
  it('falls back to memory, and says why, when the browser blocks site storage', async () => {
    const idb = new FakeIdbControls();
    idb.failOpen();
    const store = new BrowserDeckStore(idb.factory);
    expect(await store.list()).toEqual([]);
    expect(store.persistent).toBe(false);
    expect(store.storageNote).toMatch(/blocking site storage/);
    await store.put(deckFixture());
    expect((await store.get('deck-1'))!.name).toBe('Gruul Test');
  });

  it('keeps using IndexedDB when it opens', async () => {
    const idb = new FakeIdbControls();
    const store = new BrowserDeckStore(idb.factory);
    await store.put(deckFixture());
    expect(store.persistent).toBe(true);
    expect((await new IndexedDbDeckStore(idb.factory).get('deck-1'))!.name).toBe('Gruul Test');
  });

  it('a failed open is not cached: the IndexedDB store tries again on the next call', async () => {
    const idb = new FakeIdbControls();
    const store = new IndexedDbDeckStore(idb.factory);
    idb.failOpen(new DOMException('busy', 'UnknownError'));
    await expect(store.list()).rejects.toThrow();
    idb.failOpen(null);
    expect(await store.list()).toEqual([]);
    expect(idb.opens).toBe(2);
  });
});
