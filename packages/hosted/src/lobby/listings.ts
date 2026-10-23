/**
 * The listing index (design 4.2, 4.7; package M13-8): the listed, unstarted tables as the tables layer reports them (`ListingSink`), the operator's
 * hidden set, and the sorted views that `browse` pages through. In memory only: after a restart `Tables.restore` reports the tables again, and
 * `reconcile(Tables.listings())` brings the index back in step with the tables layer should a report ever have been missed.
 *
 * - **Hidden** (design 4.2, the operator's admin command): a hidden table stays in the index but is not visible: not in `browse`, and its changes are
 *   not reported. The hide holds for `HIDE_TTL_MS` (a listed table lives minutes), and at most `MAX_HIDDEN` tables are held hidden (the oldest hide is
 *   dropped first), so the set cannot grow without bound. `hide` does not need the table to be listed now: a hide that came before a restart's
 *   `restore` still applies when the table is reported.
 * - **Changes** (`onChange`): called once per net change of what is visible, with the visible listing before and after (null: not listed). A report that
 *   changes nothing visible (a hidden table's changes, the same listing again) is not a change.
 */
import type { LobbyFilter, LobbyListing, LobbySort } from '../api';
import type { ListingSink } from '../tables/hooks';
import { compareListings, pageOf, sameListing } from './query';

/** How long a hide holds: far more than a table lives (an unstarted table expires 5 minutes after the last join). */
export const HIDE_TTL_MS = 24 * 3_600_000;
export const MAX_HIDDEN = 1_000;

export type ListingChange = (table: string, before: LobbyListing | null, after: LobbyListing | null) => void;

export class ListingIndex implements ListingSink {
  /** Every listed table the tables layer reported, hidden or not. */
  private readonly all = new Map<string, LobbyListing>();
  /** Hidden table ids and when each was hidden (oldest first). */
  private readonly hiddenAt = new Map<string, number>();
  /** The sorted visible listings per order; dropped at every change and built again by the next `browse`. */
  private readonly views = new Map<LobbySort, LobbyListing[]>();

  constructor(private readonly onChange: ListingChange = () => undefined) {}

  /** `ListingSink`: a listed unstarted table was added or changed, or left the listing (null: started, closed, expired). */
  changed(table: string, listing: LobbyListing | null): void {
    const before = this.get(table);
    if (listing === null) this.all.delete(table);
    else this.all.set(table, listing);
    this.settle(table, before);
  }

  /** The visible listing of a table, or null (not listed, or hidden). */
  get(table: string): LobbyListing | null {
    const l = this.all.get(table);
    return l !== undefined && !this.hiddenAt.has(table) ? l : null;
  }

  /** How many listings are visible. */
  get size(): number {
    return this.all.size - this.hiddenListed();
  }

  /** Every listed table the index holds, hidden ones included. */
  get held(): number {
    return this.all.size;
  }

  /** One page of the visible listings that match `filter` in the order `sort` (design 4.2: at most 50), and how many match in all. */
  page(filter: LobbyFilter, sort: LobbySort, page: number): { tables: LobbyListing[]; total: number } {
    return pageOf(this.sorted(sort), filter, page);
  }

  /** Every visible listing, newest first. */
  visible(): readonly LobbyListing[] {
    return this.sorted('newest');
  }

  /** Hides a table (whether or not it is listed now). True when a visible listing was taken away by it. */
  hide(table: string, now: number): boolean {
    const before = this.get(table);
    this.hiddenAt.delete(table);
    this.hiddenAt.set(table, now);
    while (this.hiddenAt.size > MAX_HIDDEN) {
      const oldest = this.hiddenAt.keys().next().value as string;
      this.unhide(oldest);
    }
    this.settle(table, before);
    return before !== null;
  }

  /** Lifts a hide. True when the table was hidden. */
  unhide(table: string): boolean {
    const before = this.get(table);
    const was = this.hiddenAt.delete(table);
    this.settle(table, before);
    return was;
  }

  isHidden(table: string): boolean {
    return this.hiddenAt.has(table);
  }

  hiddenTables(): string[] {
    return [...this.hiddenAt.keys()];
  }

  /** Hides that ran out (`HIDE_TTL_MS`) are lifted. */
  prune(now: number): void {
    for (const [table, at] of [...this.hiddenAt]) if (now - at >= HIDE_TTL_MS) this.unhide(table);
  }

  /** The tables layer's own list is the truth: what it lacks leaves the index, what it has is set (a change only where it differs). */
  reconcile(listings: readonly LobbyListing[]): void {
    const live = new Set(listings.map((l) => l.table));
    for (const table of [...this.all.keys()]) if (!live.has(table)) this.changed(table, null);
    for (const l of listings) this.changed(l.table, l);
  }

  private hiddenListed(): number {
    let n = 0;
    for (const table of this.hiddenAt.keys()) if (this.all.has(table)) n++;
    return n;
  }

  private sorted(sort: LobbySort): LobbyListing[] {
    let view = this.views.get(sort);
    if (!view) {
      view = [...this.all].filter(([table]) => !this.hiddenAt.has(table)).map(([, l]) => l).sort(compareListings(sort));
      this.views.set(sort, view);
    }
    return view;
  }

  private settle(table: string, before: LobbyListing | null): void {
    this.views.clear();
    const after = this.get(table);
    if (before === null && after === null) return;
    if (before !== null && after !== null && sameListing(before, after)) return;
    this.onChange(table, before, after);
  }
}
