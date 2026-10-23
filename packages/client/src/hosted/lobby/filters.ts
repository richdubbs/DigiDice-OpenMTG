/**
 * What the lobby browser does with a listing on this side of the wire (hosted design 4.2): the server filters, sorts and pages (`browse`), and sends the
 * changes since as `lobbyUpdate` batches (`watchLobby`); this page keeps the page it was given and applies the batches to it. These are the server's own
 * rules (packages/hosted/src/lobby/query.ts), so that a batch for the filter in force changes the list exactly as a fresh `browse` would have:
 * test/m13-lobby/filters.test.ts pins the filter and the three sort orders against that file.
 *
 * Pure: no clock, no link.
 */
import { HOSTED_FORMATS, HOSTED_LIMITS, type LobbyFilter, type LobbyListing, type LobbySort, type LobbyUpdateMessage } from '@openmtg/hosted/api';

/** A copy of `f` with the fields that are set only (an `undefined` field is no field: the server refuses unknown fields and compares what is there). */
export function cleanFilter(f: LobbyFilter): LobbyFilter {
  const out: LobbyFilter = {};
  if (f.format !== undefined) out.format = f.format;
  if (f.seats !== undefined) out.seats = f.seats;
  if (f.open !== undefined) out.open = f.open;
  if (f.locked !== undefined) out.locked = f.locked;
  return out;
}

export function sameFilter(a: LobbyFilter | null, b: LobbyFilter | null): boolean {
  if (a === null || b === null) return a === b;
  return a.format === b.format && a.seats === b.seats && a.open === b.open && a.locked === b.locked;
}

/** Every field given must hold. `open`: only tables with a free seat (true) or only full ones (false); `locked`: only tables that need a password, or only those that do not. */
export function matchesFilter(l: LobbyListing, f: LobbyFilter): boolean {
  if (f.format !== undefined && l.format !== f.format) return false;
  if (f.seats !== undefined && l.seats !== f.seats) return false;
  if (f.open !== undefined && l.filled < l.seats !== f.open) return false;
  if (f.locked !== undefined && l.locked !== f.locked) return false;
  return true;
}

const FORMAT_ORDER: ReadonlyMap<string, number> = new Map(HOSTED_FORMATS.map((f, i) => [f.id, i]));

/** Newest first; the table id (a ULID: time, then random) settles the same millisecond. */
const byNewest = (a: LobbyListing, b: LobbyListing): number => b.createdAt - a.createdAt || (a.table < b.table ? 1 : a.table > b.table ? -1 : 0);

const COMPARE: Readonly<Record<LobbySort, (a: LobbyListing, b: LobbyListing) => number>> = {
  newest: byNewest,
  // the filled share of the seats compared as whole numbers (no rounding), then the number filled, then the newest
  filled: (a, b) => b.filled * a.seats - a.filled * b.seats || b.filled - a.filled || byNewest(a, b),
  format: (a, b) => (FORMAT_ORDER.get(a.format) ?? 0) - (FORMAT_ORDER.get(b.format) ?? 0) || byNewest(a, b),
};

export function compareListings(sort: LobbySort): (a: LobbyListing, b: LobbyListing) => number {
  return COMPARE[sort];
}

/** The listings in the order asked. */
export function sortListings(list: Iterable<LobbyListing>, sort: LobbySort): LobbyListing[] {
  return [...list].sort(COMPARE[sort]);
}

/**
 * A batch applied to the listings held: `added` and `changed` are upserts, `removed` deletes. A listing that does not match the filter in force is not
 * kept (the batch may have been made for the filter before it), and a `changed` one that no longer matches leaves.
 */
export function applyUpdate(
  held: ReadonlyMap<string, LobbyListing>,
  u: Pick<LobbyUpdateMessage, 'added' | 'changed' | 'removed'>,
  filter: LobbyFilter,
): Map<string, LobbyListing> {
  const next = new Map(held);
  for (const l of u.added) if (matchesFilter(l, filter)) next.set(l.table, l);
  for (const l of u.changed) {
    if (matchesFilter(l, filter)) next.set(l.table, l);
    else next.delete(l.table);
  }
  for (const id of u.removed) next.delete(id);
  return next;
}

/** How many pages `total` listings make. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / HOSTED_LIMITS.browsePage));
}
