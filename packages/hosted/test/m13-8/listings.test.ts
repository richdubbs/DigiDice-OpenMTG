/**
 * M13-8: the listing index and `browse` (design 4.2): filters, the three sort orders, pages of 50, the operator's hidden set, the sink the tables layer
 * feeds, and the browser's view of tables made through the real gateway. Fixed listings, no randomness.
 */
import { describe, expect, it } from 'vitest';
import { HIDE_TTL_MS, ListingIndex, LobbyBrowser, MAX_HIDDEN, matchesFilter, normalizeFilter, pageOf, sameListing } from '../../src/lobby';
import type { LobbyFilter, LobbyListing, LobbySort } from '../../src/api';
import { createTable, guest, settle, TEST_DECK } from '../m13-6/harness';
import { advance, ids, listing, listings, lobbyGateway, MIN, SEC } from './helpers';

const T0 = 1_800_000_000_000;

/** Twelve tables of every kind the filters tell apart. */
function mixed(): LobbyListing[] {
  return [
    listing('A01', { format: 'standard', seats: 2, filled: 1, locked: false, createdAt: T0 + 1 * SEC }),
    listing('A02', { format: 'standard', seats: 2, filled: 1, locked: true, createdAt: T0 + 2 * SEC }),
    listing('A03', { format: 'pioneer', seats: 2, filled: 1, locked: false, createdAt: T0 + 3 * SEC }),
    listing('A04', { format: 'commander', seats: 4, filled: 1, locked: false, createdAt: T0 + 4 * SEC }),
    listing('A05', { format: 'commander', seats: 4, filled: 3, locked: false, createdAt: T0 + 5 * SEC }),
    listing('A06', { format: 'commander', seats: 3, filled: 2, locked: true, createdAt: T0 + 6 * SEC }),
    listing('A07', { format: 'commander', seats: 2, filled: 1, locked: false, createdAt: T0 + 7 * SEC }),
    listing('A08', { format: 'brawl', seats: 4, filled: 2, locked: true, createdAt: T0 + 8 * SEC }),
    listing('A09', { format: 'brawl', seats: 3, filled: 1, locked: false, createdAt: T0 + 9 * SEC }),
    listing('A10', { format: 'casual', seats: 2, filled: 2, locked: false, createdAt: T0 + 10 * SEC }), // full
    listing('A11', { format: 'casual', seats: 2, filled: 2, locked: true, createdAt: T0 + 11 * SEC }), // full
    listing('A12', { format: 'pauper', seats: 2, filled: 1, locked: false, createdAt: T0 + 12 * SEC }),
  ];
}

function indexOf(xs: readonly LobbyListing[]): ListingIndex {
  const index = new ListingIndex();
  for (const l of xs) index.changed(l.table, l);
  return index;
}

const browse = (index: ListingIndex, filter: LobbyFilter = {}, sort: LobbySort = 'newest', page = 0) => index.page(filter, sort, page);

describe('M13-8 filters (server side: format, seats, open, locked)', () => {
  const index = indexOf(mixed());
  const by = (filter: LobbyFilter) => ids(browse(index, filter).tables).sort();

  it('no filter lists everything; each field filters alone', () => {
    expect(browse(index).total).toBe(12);
    expect(by({ format: 'commander' })).toEqual(['A04', 'A05', 'A06', 'A07']);
    expect(by({ format: 'standard' })).toEqual(['A01', 'A02']);
    expect(by({ format: 'vintage' })).toEqual([]);
    expect(by({ seats: 2 })).toEqual(['A01', 'A02', 'A03', 'A07', 'A10', 'A11', 'A12']);
    expect(by({ seats: 3 })).toEqual(['A06', 'A09']);
    expect(by({ seats: 4 })).toEqual(['A04', 'A05', 'A08']);
    expect(by({ locked: true })).toEqual(['A02', 'A06', 'A08', 'A11']);
    expect(by({ locked: false })).toEqual(['A01', 'A03', 'A04', 'A05', 'A07', 'A09', 'A10', 'A12']);
  });

  it('open: true is the tables with an open seat, open: false the full ones', () => {
    expect(by({ open: true })).toEqual(['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A12']);
    expect(by({ open: false })).toEqual(['A10', 'A11']);
  });

  it('fields combine: every field given must hold', () => {
    expect(by({ format: 'commander', seats: 4 })).toEqual(['A04', 'A05']);
    expect(by({ format: 'commander', seats: 4, open: true, locked: false })).toEqual(['A04', 'A05']);
    expect(by({ format: 'commander', locked: true })).toEqual(['A06']);
    expect(by({ format: 'brawl', seats: 4, locked: false })).toEqual([]);
    expect(by({ seats: 2, open: true, locked: true })).toEqual(['A02']);
    expect(by({ seats: 2, open: false, locked: true })).toEqual(['A11']);
  });

  it('a field that is undefined does not filter, and a filter is copied to its known fields only', () => {
    expect(matchesFilter(listing('X'), { format: undefined, locked: undefined })).toBe(true);
    const given = { format: 'casual', seats: undefined, open: true, extra: 'x' } as unknown as LobbyFilter;
    const copy = normalizeFilter(given);
    expect(copy).toEqual({ format: 'casual', open: true });
    expect(Object.keys(copy)).toEqual(['format', 'open']);
    given.format = 'pauper';
    expect(copy.format).toBe('casual');
  });

  it('total is how many match, whatever the page', () => {
    const r = browse(index, { seats: 2 }, 'newest', 5);
    expect(r).toEqual({ tables: [], total: 7 });
  });
});

describe('M13-8 sorting: newest, most filled, format', () => {
  it('newest: the latest created first; the same millisecond by table id, later ids first', () => {
    const index = indexOf([
      listing('B1', { createdAt: T0 }), listing('B2', { createdAt: T0 + 5 }), listing('B3', { createdAt: T0 + 5 }), listing('B4', { createdAt: T0 - 5 }),
    ]);
    expect(ids(browse(index, {}, 'newest').tables)).toEqual(['B3', 'B2', 'B1', 'B4']);
  });

  it('filled: the filled share of the seats first (3 of 4 before 1 of 2), then more filled, then newest', () => {
    const index = indexOf([
      listing('C1', { seats: 2, filled: 1, createdAt: T0 + 1 }), // 1/2
      listing('C2', { seats: 4, filled: 3, createdAt: T0 + 2 }), // 3/4
      listing('C3', { seats: 4, filled: 2, createdAt: T0 + 3 }), // 2/4 = 1/2, more filled than C1
      listing('C4', { seats: 3, filled: 1, createdAt: T0 + 4 }), // 1/3
      listing('C5', { seats: 4, filled: 1, createdAt: T0 + 5 }), // 1/4
      listing('C6', { seats: 2, filled: 1, createdAt: T0 + 6 }), // 1/2, newer than C1
      listing('C7', { seats: 3, filled: 2, createdAt: T0 + 7 }), // 2/3
    ]);
    expect(ids(browse(index, {}, 'filled').tables)).toEqual(['C2', 'C7', 'C3', 'C6', 'C1', 'C4', 'C5']);
  });

  it('format: the order the server lists its formats in, then newest', () => {
    const index = indexOf([
      listing('D1', { format: 'brawl', createdAt: T0 + 1 }), listing('D2', { format: 'standard', createdAt: T0 + 2 }), listing('D3', { format: 'commander', createdAt: T0 + 3 }),
      listing('D4', { format: 'standard', createdAt: T0 + 4 }), listing('D5', { format: 'casual', createdAt: T0 + 5 }), listing('D6', { format: 'pioneer', createdAt: T0 + 6 }),
      listing('D7', { format: 'duel', createdAt: T0 + 7 }), listing('D8', { format: 'standardbrawl', createdAt: T0 + 8 }),
    ]);
    expect(ids(browse(index, {}, 'format').tables)).toEqual(['D4', 'D2', 'D6', 'D5', 'D7', 'D3', 'D1', 'D8']);
  });

  it('the order is total: the same listings in any arrival order sort the same', () => {
    const xs = listings(30, (i) => ({ createdAt: T0 + (i % 4) * SEC, filled: 1 + (i % 2), seats: i % 3 === 0 ? 4 : 2 }));
    const forward = indexOf(xs);
    const backward = indexOf([...xs].reverse());
    for (const sort of ['newest', 'filled', 'format'] as const) expect(ids(browse(backward, {}, sort).tables), sort).toEqual(ids(browse(forward, {}, sort).tables));
  });

  it('a filter applies before the order: the same table is never listed twice or skipped across pages', () => {
    const xs = listings(130, (i) => ({ seats: i % 2 === 0 ? 2 : 4, filled: 1 + (i % 2) }));
    const index = indexOf(xs);
    for (const sort of ['newest', 'filled', 'format'] as const) {
      const seen: string[] = [];
      for (let p = 0; p < 3; p++) seen.push(...ids(browse(index, { seats: 2 }, sort, p).tables));
      expect(new Set(seen).size, sort).toBe(65);
      expect(seen.length, sort).toBe(65);
    }
  });
});

describe('M13-8 pages: at most 50, page 0 first', () => {
  const index = indexOf(listings(120));

  it('120 tables are 50, 50 and 20, then nothing; total is 120 every time', () => {
    const pages = [0, 1, 2, 3].map((p) => browse(index, {}, 'newest', p));
    expect(pages.map((p) => p.tables.length)).toEqual([50, 50, 20, 0]);
    expect(pages.map((p) => p.total)).toEqual([120, 120, 120, 120]);
    expect(ids(pages[0]!.tables)[0]).toBe('T120');
    expect(ids(pages[0]!.tables).at(-1)).toBe('T071');
    expect(ids(pages[1]!.tables)[0]).toBe('T070');
    expect(ids(pages[2]!.tables).at(-1)).toBe('T001');
  });

  it('a page number out of range, negative or not whole is page 0 or empty, never an error', () => {
    expect(browse(index, {}, 'newest', 10_000)).toEqual({ tables: [], total: 120 });
    expect(pageOf(index.visible(), {}, -3).tables).toHaveLength(50);
    expect(pageOf(index.visible(), {}, Number.NaN).tables).toHaveLength(50);
    expect(pageOf(index.visible(), {}, 1.5).tables).toHaveLength(50);
  });

  it('exactly 50 tables are one page; 51 are two', () => {
    expect(browse(indexOf(listings(50)), {}, 'newest', 1)).toEqual({ tables: [], total: 50 });
    expect(browse(indexOf(listings(51)), {}, 'newest', 1).tables).toHaveLength(1);
  });
});

describe('M13-8 the index follows what the tables layer reports', () => {
  it('added, changed and removed (null) listings; a report for a table it never had is nothing', () => {
    const changes: string[] = [];
    const index = new ListingIndex((table, before, after) => changes.push(`${table}:${before?.filled ?? '-'}>${after?.filled ?? '-'}`));
    index.changed('X', null);
    expect(changes).toEqual([]);
    index.changed('X', listing('X', { filled: 1 }));
    index.changed('X', listing('X', { filled: 2 }));
    index.changed('X', null);
    index.changed('X', null);
    expect(changes).toEqual(['X:->1', 'X:1>2', 'X:2>-']);
    expect(index.size).toBe(0);
  });

  it('the same listing again is not a change, and it does not change what browse shows', () => {
    const changes: string[] = [];
    const index = new ListingIndex((t) => changes.push(t));
    index.changed('X', listing('X'));
    index.changed('X', listing('X'));
    index.changed('X', { ...listing('X'), clock: { ...listing('X').clock } });
    expect(changes).toEqual(['X']);
    expect(index.size).toBe(1);
  });

  it('sameListing compares every field a listing shows', () => {
    const base = listing('S');
    expect(sameListing(base, { ...base })).toBe(true);
    for (const change of [
      { table: 'S2' }, { title: 'Other' }, { format: 'modern' as const }, { variant: 'brawl' as const }, { seats: 4 as const }, { filled: 2 }, { locked: true },
      { creator: 'Bob' }, { createdAt: T0 + 1 }, { clock: { ...base.clock, bankMs: 1 } }, { clock: { ...base.clock, delayMs: 1 } }, { clock: { ...base.clock, dropMs: 1 } },
    ] satisfies Partial<LobbyListing>[]) {
      expect(sameListing(base, { ...base, ...change }), JSON.stringify(change)).toBe(false);
    }
  });

  it('what browse returns is a snapshot: a later change does not alter a page already taken', () => {
    const index = indexOf([listing('X', { filled: 1 })]);
    const page = browse(index).tables;
    index.changed('X', listing('X', { filled: 2 }));
    expect(page[0]!.filled).toBe(1);
    expect(browse(index).tables[0]!.filled).toBe(2);
  });

  it('reconcile settles the index with the tables layer\'s own list: what it lacks goes, what it has is set, and only differences are changes', () => {
    const changes: string[] = [];
    const index = new ListingIndex((table, before, after) => changes.push(`${table}:${before ? 'b' : '-'}${after ? 'a' : '-'}`));
    index.changed('K1', listing('K1'));
    index.changed('K2', listing('K2'));
    index.changed('K3', listing('K3'));
    changes.length = 0;
    index.reconcile([listing('K2'), listing('K3', { filled: 2 }), listing('K4')]);
    expect(changes.sort()).toEqual(['K1:b-', 'K3:ba', 'K4:-a']);
    expect(ids(browse(index).tables).sort()).toEqual(['K2', 'K3', 'K4']);
  });
});

describe('M13-8 the operator\'s hidden tables (design 4.2)', () => {
  it('a hidden table is not in browse, in no count, and its changes are silent; unhide shows its latest state', () => {
    const changes: string[] = [];
    const index = new ListingIndex((table, before, after) => changes.push(`${table}:${before ? 'b' : '-'}${after ? 'a' : '-'}`));
    for (const l of listings(3)) index.changed(l.table, l);
    changes.length = 0;
    expect(index.hide('T002', T0)).toBe(true);
    expect(changes).toEqual(['T002:b-']);
    expect(ids(browse(index).tables)).toEqual(['T003', 'T001']);
    expect(browse(index).total).toBe(2);
    expect(index.size).toBe(2);
    expect(index.held).toBe(3);
    changes.length = 0;
    index.changed('T002', listing('T002', { filled: 2 }));
    index.changed('T002', null);
    index.changed('T002', listing('T002', { filled: 2, title: 'Back again' }));
    expect(changes).toEqual([]);
    expect(index.unhide('T002')).toBe(true);
    expect(changes).toEqual(['T002:-a']);
    expect(browse(index).tables.find((l) => l.table === 'T002')).toMatchObject({ filled: 2, title: 'Back again' });
    expect(index.unhide('T002')).toBe(false);
  });

  it('hide says whether it took a visible listing away; a hide before the table is reported holds when it is', () => {
    const index = new ListingIndex();
    expect(index.hide('LATER', T0)).toBe(false);
    index.changed('LATER', listing('LATER'));
    expect(browse(index)).toEqual({ tables: [], total: 0 });
    expect(index.isHidden('LATER')).toBe(true);
    expect(index.hide('LATER', T0 + 1)).toBe(false);
  });

  it('a hide runs out after 24 hours, and no more than MAX_HIDDEN are held (the oldest is lifted first)', () => {
    const index = new ListingIndex();
    index.changed('OLD', listing('OLD'));
    index.hide('OLD', T0);
    index.prune(T0 + HIDE_TTL_MS - 1);
    expect(index.isHidden('OLD')).toBe(true);
    index.prune(T0 + HIDE_TTL_MS);
    expect(index.isHidden('OLD')).toBe(false);
    expect(ids(browse(index).tables)).toEqual(['OLD']);
    for (let i = 0; i < MAX_HIDDEN + 5; i++) index.hide(`H${i}`, T0 + i);
    expect(index.hiddenTables()).toHaveLength(MAX_HIDDEN);
    expect(index.isHidden('H0')).toBe(false);
    expect(index.isHidden(`H${MAX_HIDDEN + 4}`)).toBe(true);
  });

  it('hiding a table again refreshes it: the oldest hide is the one that goes when there are too many', () => {
    const index = new ListingIndex();
    index.hide('A', T0);
    for (let i = 0; i < MAX_HIDDEN - 1; i++) index.hide(`H${i}`, T0 + 1 + i);
    index.hide('A', T0 + 5_000);
    index.hide('NEW', T0 + 6_000);
    expect(index.hiddenTables()).toHaveLength(MAX_HIDDEN);
    expect(index.isHidden('A')).toBe(true);
    expect(index.isHidden('H0')).toBe(false);
    expect(index.isHidden('NEW')).toBe(true);
  });

  it('tables that are hidden do not count toward the browser\'s visible number', () => {
    const lobby = new LobbyBrowser();
    for (const l of listings(4)) lobby.changed(l.table, l);
    lobby.hide('T001');
    lobby.hide('T004');
    expect(lobby.stats()).toMatchObject({ visible: 2, held: 4, hidden: 2 });
    expect(lobby.browse({ t: 'browse', id: 1, filter: {}, sort: 'newest', page: 0 }, 0).total).toBe(2);
  });
});

describe('M13-8 browse through the gateway: the listed tables the tables layer makes', () => {
  it('a listed table is shown with what the lobby needs and nothing it must not (a password, a seat\'s deck or session)', async () => {
    const t = lobbyGateway();
    const alice = await guest(t, 'Alice');
    const bob = await guest(t, 'Bob');
    const { table } = await createTable(alice, { title: 'Casual evening', password: 'open sesame' });
    const r = await bob.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
    expect(r).toMatchObject({ ok: true, total: 1, tables: [{ table, title: 'Casual evening', format: 'casual', variant: null, seats: 2, filled: 1, locked: true, creator: 'Alice', ranked: false }] });
    expect(r.ok && r.tables![0]!.clock).toEqual({ bankMs: 900_000, delayMs: 5_000, dropMs: 300_000 });
    const text = JSON.stringify(r);
    for (const secret of ['open sesame', alice.session, alice.token, 'Forest']) expect(text).not.toContain(secret);
    expect(Object.keys(r.ok ? r.tables![0]! : {}).sort()).toEqual(['clock', 'createdAt', 'creator', 'filled', 'format', 'locked', 'ranked', 'seats', 'table', 'title', 'variant']);
  });

  it('a default title is "<name>\'s table"; private tables are never listed', async () => {
    const t = lobbyGateway();
    const alice = await guest(t, 'Alice');
    const bob = await guest(t, 'Bob');
    const carol = await guest(t, 'Carol');
    await createTable(alice);
    await createTable(bob, { visibility: 'private' });
    const r = await carol.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
    expect(r).toMatchObject({ ok: true, total: 1, tables: [{ title: "Alice's table", creator: 'Alice' }] });
  });

  it('filters, sorting and paging by the protocol: 3 formats, passwords or not, seats filled as people sit', async () => {
    const t = lobbyGateway({ env: { PODS_ENABLED: '1' } });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dave');
    const e = await guest(t, 'Erin');
    const viewer = await guest(t, 'Viewer');
    const pod = await createTable(a, { format: 'commander', seats: 4, title: 'Pod night' });
    advance(t, 10 * SEC);
    await createTable(b, { format: 'standard', title: 'Standard bo1', password: 'letmein' });
    advance(t, 10 * SEC);
    await createTable(c, { title: 'Just casual' });
    expect((await d.cmd({ t: 'join', table: pod.table, deck: TEST_DECK })).ok).toBe(true);
    expect((await e.cmd({ t: 'join', table: pod.table, deck: TEST_DECK })).ok).toBe(true);
    const browse = async (filter: LobbyFilter, sort: LobbySort = 'newest', page = 0) => {
      const r = await viewer.cmd({ t: 'browse', filter, sort, page });
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      advance(t, 1_000); // each browse is one of the viewer's 2 a second
      return r.tables!.map((l) => `${l.title}:${l.filled}/${l.seats}`);
    };
    expect(await browse({})).toEqual(['Just casual:1/2', 'Standard bo1:1/2', 'Pod night:3/4']);
    expect(await browse({}, 'filled')).toEqual(['Pod night:3/4', 'Just casual:1/2', 'Standard bo1:1/2']);
    expect(await browse({}, 'format')).toEqual(['Standard bo1:1/2', 'Just casual:1/2', 'Pod night:3/4']);
    expect(await browse({ locked: true })).toEqual(['Standard bo1:1/2']);
    expect(await browse({ seats: 4 })).toEqual(['Pod night:3/4']);
    expect(await browse({ format: 'commander', open: true, locked: false })).toEqual(['Pod night:3/4']);
    expect(await browse({ format: 'brawl' })).toEqual([]);
    expect(await browse({}, 'newest', 1)).toEqual([]);
  });

  it('a table leaves the list when it fills (its ready check), when its creator leaves, and when it expires; it comes back when a ready check fails', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dave');
    const e = await guest(t, 'Erin');
    const viewer = await guest(t, 'Viewer');
    const total = async () => {
      advance(t, 600);
      const r = await viewer.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
      return r.ok ? r.total : -1;
    };
    const first = await createTable(a);
    expect(await total()).toBe(1);
    expect((await b.cmd({ t: 'join', table: first.table, deck: TEST_DECK })).ok).toBe(true); // full: its ready check starts
    expect(await total()).toBe(0);
    // nobody confirms: the creator did not, so the table closes (design 4.1) and does not come back
    t.clock.advance(31 * SEC);
    t.gateway.tables.tick(t.clock.now());
    await settle();
    expect(await total()).toBe(0);
    await createTable(c);
    expect(await total()).toBe(1);
    expect((await c.cmd({ t: 'leave' })).ok).toBe(true);
    expect(await total()).toBe(0);
    await createTable(d);
    expect(await total()).toBe(1);
    t.clock.advance(5 * MIN + SEC);
    t.gateway.tables.tick(t.clock.now());
    await settle();
    expect(await total()).toBe(0);
    // a table whose other player did not confirm in time is stood up and the table is listed again
    const fourth = await createTable(e);
    const f = await guest(t, 'Frank');
    expect((await f.cmd({ t: 'join', table: fourth.table, deck: TEST_DECK })).ok).toBe(true);
    expect(await total()).toBe(0);
    await e.client.until(() => e.last('readyCheck') !== undefined);
    expect((await e.cmd({ t: 'ready', start: e.last('readyCheck')!.start })).ok).toBe(true);
    t.clock.advance(31 * SEC);
    t.gateway.tables.tick(t.clock.now());
    await settle();
    expect(await total()).toBe(1);
    expect(t.lobby.index.get(fourth.table)).toMatchObject({ filled: 1 });
  });

  it('a started game is not in the lobby', async () => {
    const t = lobbyGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const viewer = await guest(t, 'Viewer');
    const { table } = await createTable(a);
    await b.cmd({ t: 'join', table, deck: TEST_DECK });
    for (const who of [a, b]) {
      await who.client.until(() => who.last('readyCheck') !== undefined);
      await who.cmd({ t: 'ready', start: who.last('readyCheck')!.start });
    }
    await a.client.until(() => a.last('table')?.table.status === 'playing');
    const r = await viewer.cmd({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
    expect(r).toMatchObject({ ok: true, total: 0, tables: [] });
    expect(t.lobby.stats().held).toBe(0);
  });
});
