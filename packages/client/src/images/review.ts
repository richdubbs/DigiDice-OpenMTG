/**
 * The images waiting for review (ARCHITECTURE.md "Card images" A: "unmatched or ambiguous images go to a review screen where the player picks the
 * card"). Kept with the page's image sources, not in the screen, so leaving the Images screen never drops them; they last until the page is closed.
 */
import type { ReviewItem } from './matching';

export class ReviewQueue {
  private items: readonly ReviewItem[] = [];
  private readonly listeners = new Set<() => void>();
  private batches = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The items, oldest first (the same array until it changes). */
  readonly get = (): readonly ReviewItem[] => this.items;

  /** Add an upload's items; their ids are made unique across uploads. */
  add(items: readonly ReviewItem[]): void {
    if (items.length === 0) return;
    const tag = ++this.batches;
    this.set([...this.items, ...items.map((it) => ({ ...it, id: `${tag}-${it.id}` }))]);
  }

  remove(id: string): void {
    this.set(this.items.filter((x) => x.id !== id));
  }

  clear(): void {
    this.set([]);
  }

  private set(items: readonly ReviewItem[]): void {
    this.items = items;
    for (const l of [...this.listeners]) l();
  }
}
