/**
 * Object URLs of the uploaded images the screen currently shows, read from the image store on demand and refreshed when the store changes. Each URL
 * points at a Blob in this browser's memory; nothing leaves the browser.
 */
import type { ImageStore } from './store';

/** URL.createObjectURL / revokeObjectURL, injectable for tests (jsdom has neither). */
export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export const browserObjectUrls: ObjectUrls = {
  create: (blob) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : ''),
  revoke: (url) => {
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  },
};

/** What is known about one slot: still loading, no upload, or the URL of the uploaded image. */
export type UploadState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; url: string };

const LOADING: UploadState = { status: 'loading' };
const NONE: UploadState = { status: 'none' };

export class UploadedImages {
  private readonly entries = new Map<string, UploadState>();
  private readonly listeners = new Set<() => void>();
  /** Per slot, bumped by every change to it, so a load that started before the change does not overwrite a newer one. */
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly store: ImageStore,
    private readonly urls: ObjectUrls = browserObjectUrls,
  ) {
    store.subscribe((changed) => this.refresh(changed));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The current state of a slot (stable object until it changes); `undefined` when nobody asked for it yet. */
  peek(key: string): UploadState | undefined {
    return this.entries.get(key);
  }

  /** Start loading a slot if it is not known yet. */
  load(key: string): void {
    if (this.entries.has(key)) return;
    if (!this.store.available) {
      this.set(key, NONE);
      return;
    }
    this.entries.set(key, LOADING);
    void this.fetch(key, this.generations.get(key) ?? 0);
  }

  private async fetch(key: string, generation: number): Promise<void> {
    let next: UploadState = NONE;
    try {
      const img = await this.store.get(key);
      if (img) next = { status: 'ready', url: this.urls.create(img.blob) };
    } catch {
      next = NONE;
    }
    if (generation !== (this.generations.get(key) ?? 0)) {
      if (next.status === 'ready') this.urls.revoke(next.url);
      return;
    }
    this.set(key, next);
  }

  private set(key: string, state: UploadState): void {
    const old = this.entries.get(key);
    this.entries.set(key, state);
    if (old?.status === 'ready' && (state.status !== 'ready' || state.url !== old.url)) this.urls.revoke(old.url);
    for (const l of [...this.listeners]) l();
  }

  /**
   * Re-read the slots a change names that were shown so far (every shown slot when the change names none); the old URLs stay valid until their
   * replacement is ready. A load still running for a re-read slot is superseded.
   */
  private refresh(changed: readonly string[] | null): void {
    const keys = changed === null ? [...this.entries.keys()] : changed.filter((k) => this.entries.has(k));
    for (const key of keys) {
      const generation = (this.generations.get(key) ?? 0) + 1;
      this.generations.set(key, generation);
      void this.fetch(key, generation);
    }
  }
}
