/**
 * M13-12: the lobby browser's filter and orders on this side of the wire (src/hosted/lobby/filters.ts) are the server's own (packages/hosted/src/lobby/
 * query.ts): a batch applied here changes the list exactly as a fresh `browse` would. Pinned on a fixed set of listings, every filter and every order.
 */
import { HOSTED_FORMATS, type LobbyFilter, type LobbyListing, type LobbySort, type TableSize } from '@openmtg/hosted/api';
import { describe, expect, it } from 'vitest';
import * as server from '../../../hosted/src/lobby/query';
import { applyUpdate, cleanFilter, matchesFilter, pageCount, sameFilter, sortListings } from '../../src/hosted/lobby/filters';

const CLOCK = { bankMs: 900_000, delayMs: 5_000, dropMs: 300_000 };
const T = 1_800_000_000_000;

function listing(table: string, o: Partial<LobbyListing> = {}): LobbyListing {
  return { table, title: `Table ${table}`, format: 'casual', variant: null, seats: 2, filled: 1, locked: false, clock: CLOCK, creator: 'Alice', ranked: false, createdAt: T, ...o };
}

/** Every format, sizes 2-4, filled 1 to full, locked or not, and ties in time (the id settles them). */
const LISTINGS: LobbyListing[] = [];
let n = 0;
for (const f of HOSTED_FORMATS) {
  for (const seats of [2, 3, 4] as TableSize[]) {
    if (seats > 2 && !f.pods) continue;
    for (let filled = 1; filled <= seats; filled++) {
      for (const locked of [false, true]) {
        n++;
        LISTINGS.push(listing(`01J${String(n).padStart(4, '0')}`, { format: f.id, seats, filled, locked, createdAt: T + (n % 7) * 1000 }));
      }
    }
  }
}

const FILTERS: LobbyFilter[] = [{}];
for (const format of [undefined, 'casual', 'commander', 'pauper'] as const)
  for (const seats of [undefined, 2, 4] as const)
    for (const open of [undefined, true, false])
      for (const locked of [undefined, true, false]) {
        const f: LobbyFilter = {};
        if (format) f.format = format;
        if (seats) f.seats = seats;
        if (open !== undefined) f.open = open;
        if (locked !== undefined) f.locked = locked;
        FILTERS.push(f);
      }

describe('M13-12 the client keeps the server\'s lobby rules', () => {
  it('the filter matches the same listings as the server\'s, for every filter', () => {
    expect(LISTINGS.length).toBeGreaterThan(60);
    for (const f of FILTERS) {
      const mine = LISTINGS.filter((l) => matchesFilter(l, f)).map((l) => l.table);
      const theirs = LISTINGS.filter((l) => server.matchesFilter(l, f)).map((l) => l.table);
      expect(mine, JSON.stringify(f)).toEqual(theirs);
    }
  });

  it.each(['newest', 'filled', 'format'] as LobbySort[])('the %s order is the server\'s', (sort) => {
    const shuffled = [...LISTINGS].reverse();
    expect(sortListings(shuffled, sort).map((l) => l.table)).toEqual([...shuffled].sort(server.compareListings(sort)).map((l) => l.table));
  });

  it('a filter is cleaned as the server normalizes it, and compared the same way', () => {
    const raw = { format: 'casual', seats: undefined, open: true, locked: undefined } as LobbyFilter;
    expect(cleanFilter(raw)).toEqual(server.normalizeFilter(raw));
    expect(Object.keys(cleanFilter(raw))).toEqual(['format', 'open']);
    for (const a of FILTERS.slice(0, 20)) for (const b of FILTERS.slice(0, 20)) expect(sameFilter(a, b)).toBe(server.sameFilter(a, b));
    expect(sameFilter(null, null)).toBe(true);
    expect(sameFilter(null, {})).toBe(false);
  });

  it('a batch gives what a fresh page would: upserts, deletes, and a changed table that stops matching leaves', () => {
    const filter: LobbyFilter = { open: true };
    const held = new Map([listing('A'), listing('B'), listing('C')].map((l) => [l.table, l]));
    const next = applyUpdate(held, { added: [listing('D'), listing('E', { filled: 2 })], changed: [listing('B', { filled: 2 }), listing('C', { title: 'New name' })], removed: ['A', 'Z'] }, filter);
    expect([...next.keys()].sort()).toEqual(['C', 'D']);
    expect(next.get('C')!.title).toBe('New name');
    // the same as the server's page of what the tables are now
    const now = [listing('B', { filled: 2 }), listing('C', { title: 'New name' }), listing('D'), listing('E', { filled: 2 })];
    expect(server.pageOf(sortListings(now, 'newest'), filter, 0).tables.map((l) => l.table).sort()).toEqual(['C', 'D']);
  });

  it('pages of 50', () => {
    expect([0, 1, 50, 51, 100, 101].map(pageCount)).toEqual([1, 1, 1, 2, 2, 3]);
  });
});
