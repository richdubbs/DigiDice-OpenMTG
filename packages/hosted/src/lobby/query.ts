/**
 * What the lobby browser asks of a listing (design 4.2; package M13-8): the filter, the three sort orders and the page. Pure functions, no state.
 *
 * - **Filter** (`LobbyFilter`): every field given must hold. `open`: true is only tables with an open seat, false only full ones; `locked`: true only
 *   tables that need a password, false only those that do not. An absent (or undefined) field does not filter.
 * - **Sort** (`LobbySort`): `newest` (newest first), `filled` (closest to full first: the filled share of the seats, then the number filled, then
 *   newest), `format` (the order of `HOSTED_FORMATS`, then newest). Every order ends with the table id, so it is total: a page never repeats or skips a
 *   table that did not change between two `browse` calls.
 */
import { HOSTED_FORMATS, HOSTED_LIMITS, type LobbyFilter, type LobbyListing, type LobbySort } from '../api';

/** A copy of `f` with its known fields only (what `watch` keeps: the caller's object is never held, and an `undefined` field is no field). */
export function normalizeFilter(f: LobbyFilter): LobbyFilter {
  const out: LobbyFilter = {};
  if (f.format !== undefined) out.format = f.format;
  if (f.seats !== undefined) out.seats = f.seats;
  if (f.open !== undefined) out.open = f.open;
  if (f.locked !== undefined) out.locked = f.locked;
  return out;
}

export function sameFilter(a: LobbyFilter, b: LobbyFilter): boolean {
  return a.format === b.format && a.seats === b.seats && a.open === b.open && a.locked === b.locked;
}

export function matchesFilter(l: LobbyListing, f: LobbyFilter): boolean {
  if (f.format !== undefined && l.format !== f.format) return false;
  if (f.seats !== undefined && l.seats !== f.seats) return false;
  if (f.open !== undefined && (l.filled < l.seats) !== f.open) return false;
  if (f.locked !== undefined && l.locked !== f.locked) return false;
  return true;
}

const FORMAT_ORDER: ReadonlyMap<string, number> = new Map(HOSTED_FORMATS.map((f, i) => [f.id, i]));

/** Newest first; the table id (a ULID: time, then random) settles the same millisecond. */
const byNewest = (a: LobbyListing, b: LobbyListing): number => b.createdAt - a.createdAt || (a.table < b.table ? 1 : a.table > b.table ? -1 : 0);

const COMPARE: Readonly<Record<LobbySort, (a: LobbyListing, b: LobbyListing) => number>> = {
  newest: byNewest,
  // filled / seats compared as a.filled * b.seats against b.filled * a.seats: whole numbers, no rounding
  filled: (a, b) => b.filled * a.seats - a.filled * b.seats || b.filled - a.filled || byNewest(a, b),
  format: (a, b) => (FORMAT_ORDER.get(a.format) ?? 0) - (FORMAT_ORDER.get(b.format) ?? 0) || byNewest(a, b),
};

export function compareListings(sort: LobbySort): (a: LobbyListing, b: LobbyListing) => number {
  return COMPARE[sort];
}

/** Whether two listings show the same (every field of a `LobbyListing`). */
export function sameListing(a: LobbyListing, b: LobbyListing): boolean {
  return (
    a.table === b.table && a.title === b.title && a.format === b.format && a.variant === b.variant && a.seats === b.seats && a.filled === b.filled &&
    a.locked === b.locked && a.clock.bankMs === b.clock.bankMs && a.clock.delayMs === b.clock.delayMs && a.clock.dropMs === b.clock.dropMs &&
    a.creator === b.creator && a.ranked === b.ranked && a.createdAt === b.createdAt
  );
}

/** One page (at most `HOSTED_LIMITS.browsePage`, page 0 first) of the listings of `sorted` that match `filter`, and how many match in all. */
export function pageOf(sorted: readonly LobbyListing[], filter: LobbyFilter, page: number): { tables: LobbyListing[]; total: number } {
  const size = HOSTED_LIMITS.browsePage;
  const from = Number.isSafeInteger(page) && page > 0 ? page * size : 0;
  const tables: LobbyListing[] = [];
  let total = 0;
  for (const l of sorted) {
    if (!matchesFilter(l, filter)) continue;
    if (total >= from && tables.length < size) tables.push(l);
    total++;
  }
  return { tables, total };
}
