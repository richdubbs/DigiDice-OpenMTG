/**
 * Player-uploaded card images, stored only in this browser's IndexedDB (ARCHITECTURE.md "Card images" A: "Stored only in the player's browser
 * (IndexedDB), keyed by image slot; never uploaded"). One record per image slot (engine `imageSlots`: one per printed side); storing a slot again
 * replaces its image.
 */

export interface StoredImage {
  /** Image slot key (engine `ImageSlot.key`). */
  key: string;
  /** Oracle name of the card or token the slot belongs to. */
  card: string;
  /** The slot's label ("Delver of Secrets (front)"). */
  label: string;
  /** Name of the file the player uploaded. */
  fileName: string;
  /** MIME type ("image/jpeg"). */
  type: string;
  size: number;
  blob: Blob;
  /** When it was stored (ms since the epoch); display only. */
  addedAt: number;
}

export interface ImageStore {
  /** False when this browser has no IndexedDB (uploads are then unavailable; placeholders and Scryfall images still work). */
  readonly available: boolean;
  get(key: string): Promise<StoredImage | undefined>;
  /** Store (or replace) the image of a slot. */
  put(image: StoredImage): Promise<void>;
  /** Store (or replace) several images in one transaction, with one notification (an upload batch). */
  putMany(images: readonly StoredImage[]): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every stored image, sorted by card name then slot label. */
  list(): Promise<StoredImage[]>;
  clear(): Promise<void>;
  /** Called after every change made through this store, with the slot keys it changed (null: possibly every slot, as after `clear`). */
  subscribe(listener: StoreListener): () => void;
}

export type StoreListener = (changed: readonly string[] | null) => void;

export const IMAGE_DB_NAME = 'openmtg-images';
const DB_VERSION = 1;
const STORE = 'images';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

export const byCardThenLabel = (a: StoredImage, b: StoredImage): number => a.card.localeCompare(b.card) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

/** The IndexedDB store. `factory` defaults to the browser's `indexedDB`; tests pass a fake. The database is opened on first use. */
export function idbImageStore(factory: IDBFactory | undefined = globalThis.indexedDB, dbName = IMAGE_DB_NAME): ImageStore {
  const listeners = new Set<StoreListener>();
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!factory) return Promise.reject(new Error('This browser has no IndexedDB: uploaded images cannot be stored.'));
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(dbName, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => {
          d.close();
          db = null;
        };
        resolve(d);
      };
      r.onerror = () => {
        db = null;
        reject(r.error ?? new Error('Could not open the image database'));
      };
      r.onblocked = () => reject(new Error('The image database is blocked by another tab'));
    });
    return db;
  };
  const notify = (changed: readonly string[] | null) => {
    for (const l of [...listeners]) l(changed);
  };
  const write = async (changed: readonly string[] | null, fn: (s: IDBObjectStore) => void): Promise<void> => {
    const tx = (await open()).transaction(STORE, 'readwrite');
    const done = finished(tx);
    fn(tx.objectStore(STORE));
    await done;
    notify(changed);
  };
  const read = async <T>(fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => request(fn((await open()).transaction(STORE, 'readonly').objectStore(STORE)));

  return {
    available: factory !== undefined,
    get: (key) => read((s) => s.get(key) as IDBRequest<StoredImage | undefined>),
    put: (image) => write([image.key], (s) => void s.put(image)),
    putMany: async (images) => {
      if (images.length === 0) return;
      await write(
        images.map((i) => i.key),
        (s) => {
          for (const i of images) s.put(i);
        },
      );
    },
    delete: (key) => write([key], (s) => void s.delete(key)),
    list: async () => (await read((s) => s.getAll() as IDBRequest<StoredImage[]>)).sort(byCardThenLabel),
    clear: () => write(null, (s) => void s.clear()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
