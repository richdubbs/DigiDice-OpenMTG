/**
 * M13-8: live lobby updates (design 4.2, 3.4, 3.6): batches of at most one `lobbyUpdate` a second per connection, merged per table (what the browser
 * holds against what it should hold), relative to each watcher's filter, and the limits on watchers (4 per address key, `MAX_LOBBY_WATCHERS` in all).
 * The browser service is driven directly on numbers for time, then through the real gateway and tables. No timers, no randomness.
 */
import { describe, expect, it } from 'vitest';
import { type LobbyFilter, type LobbyListing, type LobbyUpdateMessage } from '../../src/api';
import { LobbyBrowser, RECONCILE_EVERY_MS } from '../../src/lobby';
import { METRICS, MemoryLogger, MemoryMetrics } from '../../src/obs';
import { createTable, guest, settle, TEST_DECK } from '../m13-6/harness';
import { advance, ids, listing, lobbyGateway, SEC } from './helpers';

const T = 1_800_000_000_000;

/** A watcher that records every batch it is sent, with the time `now` had when it was sent. */
function watch(lobby: LobbyBrowser, conn: number, key: string, filter: LobbyFilter | null, clock: { t: number }) {
  const got: { at: number; m: LobbyUpdateMessage }[] = [];
  const error = lobby.watch(conn, key, filter, (m) => got.push({ at: clock.t, m }), clock.t);
  return { got, error, updates: () => got.map((g) => g.m) };
}

/** The tables of a batch as `added|changed|removed` ids, for short assertions. */
const brief = (m: LobbyUpdateMessage) => ({ added: ids(m.added), changed: ids(m.changed), removed: m.removed });

function rig(o: ConstructorParameters<typeof LobbyBrowser>[0] = {}) {
  const clock = { t: T };
  const metrics = new MemoryMetrics();
  const logger = new MemoryLogger();
  const lobby = new LobbyBrowser({ now: () => clock.t, metrics, logger, ...o });
  const tick = (ms = 0) => {
    clock.t += ms;
    lobby.tick(clock.t);
  };
  return { lobby, clock, tick, metrics, logger };
}

describe('M13-8 batches: one lobbyUpdate a second per connection, held until it is due', () => {
  it('a change waits for the next tick; the first batch goes out at once, the next not before a second later', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A'));
    expect(w.got).toEqual([]);
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }]);
    lobby.changed('B', listing('B'));
    tick(999);
    expect(w.got).toHaveLength(1);
    tick(1);
    expect(w.updates().map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }, { added: ['B'], changed: [], removed: [] }]);
    expect(w.got.map((g) => g.at)).toEqual([T, T + 1_000]);
  });

  it('a hundred changes over ten seconds make at most eleven batches, never two within a second', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    for (let i = 0; i < 100; i++) {
      lobby.changed('A', listing('A', { filled: 1 + (i % 2), title: `Title ${i}` }));
      tick(100);
    }
    tick(1_000);
    const times = w.got.map((g) => g.at);
    expect(times.length).toBeGreaterThanOrEqual(10);
    expect(times.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!, `batches ${i - 1} and ${i}`).toBeGreaterThanOrEqual(1_000);
    // every batch is one table's latest state, never a queue of every step
    for (const m of w.updates()) expect(m.added.length + m.changed.length).toBe(1);
    expect(w.updates().at(-1)!.changed[0]!.title).toBe('Title 99');
  });

  it('each connection has its own second: a busy one does not hold another back, and a quiet one is not made to wait', () => {
    const { lobby, clock, tick } = rig();
    const a = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A'));
    tick();
    const b = watch(lobby, 2, 'k2', {}, clock);
    lobby.changed('B', listing('B'));
    tick(10);
    expect(a.got).toHaveLength(1);
    expect(a.updates().map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }]);
    expect(b.updates().map(brief)).toEqual([{ added: ['B'], changed: [], removed: [] }]); // b was never sent anything: it is due at once
    tick(1_000);
    expect(a.updates().map(brief).at(-1)).toEqual({ added: ['B'], changed: [], removed: [] });
  });

  it('with nothing to say, nothing is sent', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    for (let i = 0; i < 20; i++) tick(500);
    expect(w.got).toEqual([]);
  });
});

describe('M13-8 batches are net: what the browser holds against what it should hold', () => {
  it('added then changed is one added with the latest listing; changed twice is one changed', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A', { filled: 1 }));
    lobby.changed('A', listing('A', { filled: 2 }));
    tick();
    expect(w.updates()[0]!.added).toEqual([listing('A', { filled: 2 })]);
    expect(w.updates()[0]!.changed).toEqual([]);
    lobby.changed('A', listing('A', { filled: 1 }));
    lobby.changed('A', listing('A', { filled: 3, title: 'Later' }));
    tick(1_000);
    expect(w.updates()[1]!.changed).toEqual([listing('A', { filled: 3, title: 'Later' })]);
    expect(w.updates()[1]!.added).toEqual([]);
  });

  it('added then removed within the second is sent as removed (the browser may have browsed it in between), and only that', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A'));
    lobby.changed('A', null);
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: [], changed: [], removed: ['A'] }]);
    lobby.changed('B', listing('B'));
    tick(1_000);
    expect(w.updates().map(brief).at(-1)).toEqual({ added: ['B'], changed: [], removed: [] });
  });

  it('removed then listed again within the second is a change (the browser still has it); changed back to what it showed is sent as it is now', () => {
    const { lobby, clock, tick } = rig();
    lobby.changed('A', listing('A', { filled: 1 }));
    lobby.changed('B', listing('B', { filled: 1 }));
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', null);
    lobby.changed('A', listing('A', { filled: 2 }));
    lobby.changed('B', listing('B', { filled: 2 }));
    lobby.changed('B', listing('B', { filled: 1 }));
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: [], changed: ['A', 'B'], removed: [] }]);
    expect(w.updates()[0]!.changed.find((l) => l.table === 'B')).toEqual(listing('B', { filled: 1 }));
  });

  it('a browse inside the batch window leaves no ghost: a table shown by the browse and gone by the batch is removed; one shown changed and changed back is set back (M13-8 review, finding 2)', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    // what the browser shows: the batches it got, and what a browse returned, applied as the client applies them
    const shown = new Map<string, LobbyListing>();
    const apply = (m: LobbyUpdateMessage) => {
      for (const l of [...m.added, ...m.changed]) shown.set(l.table, l);
      for (const id of m.removed) shown.delete(id);
    };
    lobby.changed('Y', listing('Y', { filled: 1 }));
    tick();
    w.updates().forEach(apply);
    lobby.changed('X', listing('X'));
    lobby.changed('Y', listing('Y', { filled: 2 }));
    for (const l of lobby.browse({ t: 'browse', filter: {}, sort: 'newest', page: 0 } as Parameters<LobbyBrowser['browse']>[0], clock.t).tables) shown.set(l.table, l);
    expect([...shown.keys()].sort()).toEqual(['X', 'Y']);
    lobby.changed('X', null);
    lobby.changed('Y', listing('Y', { filled: 1 }));
    tick(1_000);
    w.updates().slice(1).forEach(apply);
    expect([...shown.keys()]).toEqual(['Y']);
    expect(shown.get('Y')).toEqual(listing('Y', { filled: 1 }));
  });

  it('a wall clock set back does not stop the batches (M13-8 review, finding 4)', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A', { filled: 1 }));
    tick();
    clock.t -= 10 * 60 * SEC;
    for (let i = 0; i < 5; i++) {
      lobby.changed('A', listing('A', { filled: 1 + ((i + 1) % 2) }));
      tick(1_000);
    }
    expect(w.got.length).toBe(6);
  });

  it('changed then removed is a removal; removed ids are table ids only', () => {
    const { lobby, clock, tick } = rig();
    lobby.changed('A', listing('A'));
    lobby.changed('B', listing('B'));
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A', { filled: 2 }));
    lobby.changed('A', null);
    lobby.changed('B', null);
    tick();
    expect(w.updates()).toEqual([{ t: 'lobbyUpdate', added: [], changed: [], removed: ['A', 'B'] }]);
  });

  it('a batch holds one entry per table however much happened to it', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    for (let i = 0; i < 2_000; i++) lobby.changed(`T${i % 7}`, listing(`T${i % 7}`, { title: `Title ${i}` }));
    expect(lobby.stats().waiting).toBe(1);
    tick();
    expect(w.updates()).toHaveLength(1);
    expect(w.updates()[0]!.added).toHaveLength(7);
    expect(lobby.stats().waiting).toBe(0);
  });
});

describe('M13-8 batches follow each watcher\'s filter', () => {
  it('a table that stops matching is removed, one that starts matching is added, one that never matches is not mentioned', () => {
    const { lobby, clock, tick } = rig();
    const open = watch(lobby, 1, 'k1', { open: true }, clock);
    const locked = watch(lobby, 2, 'k2', { locked: true }, clock);
    const commander = watch(lobby, 3, 'k3', { format: 'commander', seats: 4 }, clock);
    lobby.changed('A', listing('A', { filled: 1 }));
    tick();
    lobby.changed('A', listing('A', { filled: 2 })); // full
    tick(1_000);
    lobby.changed('A', listing('A', { filled: 1 })); // a seat opened
    tick(1_000);
    expect(open.updates().map(brief)).toEqual([
      { added: ['A'], changed: [], removed: [] }, { added: [], changed: [], removed: ['A'] }, { added: ['A'], changed: [], removed: [] },
    ]);
    expect(locked.got).toEqual([]);
    expect(commander.got).toEqual([]);
    lobby.changed('P', listing('P', { format: 'commander', seats: 4, filled: 1, locked: true }));
    tick(1_000);
    expect(commander.updates().map(brief)).toEqual([{ added: ['P'], changed: [], removed: [] }]);
    expect(locked.updates().map(brief)).toEqual([{ added: ['P'], changed: [], removed: [] }]);
    expect(open.updates().map(brief).at(-1)).toEqual({ added: ['P'], changed: [], removed: [] });
  });

  it('what a filter-less watcher is told about the same changes is every table', () => {
    const { lobby, clock, tick } = rig();
    const all = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A', { format: 'standard' }));
    lobby.changed('B', listing('B', { format: 'brawl', seats: 3 }));
    lobby.changed('C', listing('C', { locked: true }));
    tick();
    expect(all.updates().map(brief)).toEqual([{ added: ['A', 'B', 'C'], changed: [], removed: [] }]);
  });
});

describe('M13-8 one subscription per connection: replaced, repeated, stopped, closed', () => {
  it('watching again with another filter replaces the subscription and drops what the old one held', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', { format: 'standard' }, clock);
    lobby.changed('A', listing('A', { format: 'standard' }));
    expect(lobby.stats().waiting).toBe(1);
    const again = lobby.watch(1, 'k1', { format: 'brawl' }, (m) => w.got.push({ at: clock.t, m }), clock.t);
    expect(again).toBeNull();
    expect(lobby.stats()).toMatchObject({ watchers: 1, waiting: 0 });
    tick();
    expect(w.got).toEqual([]);
    lobby.changed('B', listing('B', { format: 'brawl' }));
    lobby.changed('C', listing('C', { format: 'standard' }));
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: ['B'], changed: [], removed: [] }]);
  });

  it('asking for the same filter again changes nothing and loses nothing it holds', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', { open: true }, clock);
    lobby.changed('A', listing('A'));
    expect(lobby.watch(1, 'k1', { open: true }, (m) => w.got.push({ at: clock.t, m }), clock.t)).toBeNull();
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }]);
    expect(lobby.stats().watchers).toBe(1);
  });

  it('watching again with the same filter and a new callback sends to the new callback only (M13-8 review, test gap)', () => {
    const { lobby, clock, tick } = rig();
    const first = watch(lobby, 1, 'k1', {}, clock);
    const second: LobbyUpdateMessage[] = [];
    expect(lobby.watch(1, 'k1', {}, (m) => second.push(m), clock.t)).toBeNull();
    lobby.changed('A', listing('A'));
    tick();
    expect(first.got).toEqual([]);
    expect(second.map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }]);
  });

  it('a filter that differs only in locked is another filter: watching again with it replaces the old one (M13-8 review, test gap)', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', { locked: false }, clock);
    expect(lobby.watch(1, 'k1', { locked: true }, (m) => w.got.push({ at: clock.t, m }), clock.t)).toBeNull();
    lobby.changed('A', listing('A', { locked: false }));
    lobby.changed('B', listing('B', { locked: true }));
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: ['B'], changed: [], removed: [] }]);
  });

  it('the filter is copied: changing the object the caller passed does not change the subscription', () => {
    const { lobby, clock, tick } = rig();
    const filter: LobbyFilter = { format: 'standard' };
    const w = watch(lobby, 1, 'k1', filter, clock);
    filter.format = 'brawl';
    lobby.changed('A', listing('A', { format: 'standard' }));
    lobby.changed('B', listing('B', { format: 'brawl' }));
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }]);
  });

  it('a null filter ends it: nothing more is sent, what was held is dropped, the slot is free; stopping twice is fine', () => {
    const { lobby, clock, tick } = rig({ perKey: 1 });
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A'));
    expect(lobby.watch(1, 'k1', null, () => undefined, clock.t)).toBeNull();
    expect(lobby.watch(1, 'k1', null, () => undefined, clock.t)).toBeNull();
    tick();
    expect(w.got).toEqual([]);
    expect(lobby.stats()).toMatchObject({ watchers: 0, waiting: 0 });
    expect(watch(lobby, 2, 'k1', {}, clock).error).toBeNull();
  });

  it('a closed connection is forgotten at once, with what it held; a connection that never watched may be closed too', () => {
    const { lobby, clock, tick } = rig();
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A'));
    lobby.closed(1);
    lobby.closed(1);
    lobby.closed(99);
    tick(5_000);
    expect(w.got).toEqual([]);
    expect(lobby.stats()).toMatchObject({ watchers: 0, waiting: 0 });
  });
});

describe('M13-8 limits: 4 watchers per address key and MAX_LOBBY_WATCHERS in all', () => {
  it('a fifth subscription from one address key is refused (limitReached, with a time to come back) and counted; other keys are not affected', () => {
    const { lobby, clock, metrics } = rig();
    for (let conn = 1; conn <= 4; conn++) expect(watch(lobby, conn, '203.0.113.7', {}, clock).error).toBeNull();
    const refused = watch(lobby, 5, '203.0.113.7', {}, clock).error;
    expect(refused).toMatchObject({ code: 'limitReached', retryAfterMs: 60_000 });
    expect(refused!.message).toMatch(/refresh/);
    expect(metrics.values.get(MemoryMetrics.key(METRICS.refusals, { reason: 'watchers' }))).toBe(1);
    expect(watch(lobby, 6, '203.0.113.8', {}, clock).error).toBeNull();
    expect(lobby.stats().watchers).toBe(5);
  });

  it('a connection that already watches may change its filter at the limit; a closed or stopped one gives its slot back', () => {
    const { lobby, clock } = rig();
    for (let conn = 1; conn <= 4; conn++) watch(lobby, conn, 'k', {}, clock);
    expect(watch(lobby, 3, 'k', { format: 'brawl' }, clock).error).toBeNull();
    expect(watch(lobby, 5, 'k', {}, clock).error).not.toBeNull();
    lobby.closed(2);
    expect(watch(lobby, 5, 'k', {}, clock).error).toBeNull();
    expect(watch(lobby, 6, 'k', {}, clock).error).not.toBeNull();
    lobby.watch(1, 'k', null, () => undefined, clock.t);
    expect(watch(lobby, 6, 'k', {}, clock).error).toBeNull();
  });

  it('the total is MAX_LOBBY_WATCHERS: the next one is refused whoever it is, and the room comes back when one closes', () => {
    const { lobby, clock, metrics } = rig({ maxWatchers: 6 });
    for (let conn = 1; conn <= 6; conn++) expect(watch(lobby, conn, `key${conn}`, {}, clock).error, `watcher ${conn}`).toBeNull();
    const refused = watch(lobby, 7, 'key7', {}, clock).error;
    expect(refused).toMatchObject({ code: 'limitReached' });
    expect(refused!.message).toMatch(/every 10 seconds/);
    expect(metrics.values.get(MemoryMetrics.key(METRICS.refusals, { reason: 'watchers' }))).toBe(1);
    lobby.closed(4);
    expect(watch(lobby, 7, 'key7', {}, clock).error).toBeNull();
  });

  it('the defaults are 4 per key and 2,000 in all', () => {
    const { lobby, clock } = rig();
    for (let conn = 1; conn <= 500; conn++) for (let k = 0; k < 4; k++) expect(watch(lobby, conn * 10 + k, `key${conn}`, {}, clock).error).toBeNull();
    expect(lobby.stats().watchers).toBe(2_000);
    expect(watch(lobby, 999_999, 'fresh', {}, clock).error).toMatchObject({ code: 'limitReached' });
    expect(watch(lobby, 999_998, 'key1', {}, clock).error).toMatchObject({ code: 'limitReached' });
  });
});

describe('M13-8 a failing push never reaches the tables layer or another watcher', () => {
  it('a push that throws ends that subscription and is logged by the error\'s name; the others get their batch', () => {
    const { lobby, clock, tick, logger } = rig();
    lobby.watch(1, 'k1', {}, () => {
      throw new TypeError('the socket is gone: secret detail');
    }, clock.t);
    const ok = watch(lobby, 2, 'k2', {}, clock);
    lobby.changed('A', listing('A'));
    expect(() => tick()).not.toThrow();
    expect(ids(ok.updates()[0]!.added)).toEqual(['A']);
    expect(lobby.stats().watchers).toBe(1);
    const lines = logger.lines.join('\n');
    expect(lines).toContain('lobbyPushError');
    expect(lines).toContain('TypeError');
    expect(lines).not.toContain('secret detail');
  });
});

describe('M13-8 hide, unhide and the settling against the tables layer\'s list reach the watchers', () => {
  it('hiding a listed table removes it for every watcher; its changes are silent; unhide announces its latest state', () => {
    const { lobby, clock, tick } = rig();
    lobby.changed('A', listing('A'));
    lobby.changed('B', listing('B'));
    const w = watch(lobby, 1, 'k1', {}, clock);
    expect(lobby.hide('A')).toBe(true);
    tick();
    expect(w.updates().map(brief)).toEqual([{ added: [], changed: [], removed: ['A'] }]);
    lobby.changed('A', listing('A', { filled: 2 }));
    tick(1_000);
    expect(w.got).toHaveLength(1);
    expect(lobby.unhide('A')).toBe(true);
    tick(1_000);
    expect(w.updates().at(-1)!.added).toEqual([listing('A', { filled: 2 })]);
  });

  it('every RECONCILE_EVERY_MS the index is settled against the tables layer\'s list: a report that was missed reaches the watchers late, not never', () => {
    let truth: LobbyListing[] = [listing('A'), listing('B')];
    const { lobby, clock, tick } = rig({ source: () => truth });
    const w = watch(lobby, 1, 'k1', {}, clock);
    tick(); // the first tick settles at once
    expect(w.updates().map(brief)).toEqual([{ added: ['A', 'B'], changed: [], removed: [] }]);
    truth = [listing('B', { filled: 2 }), listing('C')]; // nothing was reported
    tick(RECONCILE_EVERY_MS - 1);
    expect(w.got).toHaveLength(1);
    tick(1);
    expect(w.updates().map(brief).at(-1)).toEqual({ added: ['C'], changed: ['B'], removed: ['A'] });
  });

  it('a source that fails is logged and the browser goes on', () => {
    const { lobby, clock, tick, logger } = rig({ source: () => { throw new Error('tables fell over'); } });
    const w = watch(lobby, 1, 'k1', {}, clock);
    lobby.changed('A', listing('A'));
    expect(() => tick()).not.toThrow();
    expect(ids(w.updates()[0]!.added)).toEqual(['A']);
    expect(logger.lines.join('\n')).toContain('lobbyError');
  });

  it('a hide that ran out is lifted by the settling', () => {
    const { lobby, clock, tick } = rig({ source: () => [listing('A')] });
    tick();
    lobby.hide('A', clock.t);
    const w = watch(lobby, 1, 'k1', {}, clock);
    tick(24 * 3_600_000);
    expect(ids(w.updates()[0]!.added)).toEqual(['A']);
  });
});

describe('M13-8 the timer', () => {
  it('start runs tick on a timer (a quarter second) and stop ends it', async () => {
    const lobby = new LobbyBrowser();
    const got: LobbyUpdateMessage[] = [];
    lobby.watch(1, 'k', {}, (m) => got.push(m), Date.now());
    lobby.start();
    lobby.start();
    lobby.changed('A', listing('A'));
    await new Promise((r) => setTimeout(r, 700));
    expect(got.map(brief)).toEqual([{ added: ['A'], changed: [], removed: [] }]);
    lobby.stop();
    lobby.stop();
    lobby.changed('B', listing('B'));
    await new Promise((r) => setTimeout(r, 800));
    expect(got).toHaveLength(1);
  });
});

describe('M13-8 live updates through the real gateway and tables', () => {
  it('watchLobby: a table made and filled within the second is only ever named as removed; one that is announced is removed when it fills', async () => {
    const t = lobbyGateway();
    const watcher = await guest(t, 'Watcher');
    const bystander = await guest(t, 'Bystander');
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dave');
    expect(await watcher.cmd({ t: 'watchLobby', filter: { format: 'casual' } })).toMatchObject({ ok: true });
    const quick = await createTable(a);
    expect((await b.cmd({ t: 'join', table: quick.table, deck: TEST_DECK })).ok).toBe(true); // full at once: its ready check began
    advance(t, SEC);
    await settle(3);
    // the browser may have browsed it within the second, so its end is said (M13-8 review, finding 2); it is never added
    expect(watcher.of('lobbyUpdate')).toEqual([{ t: 'lobbyUpdate', added: [], changed: [], removed: [quick.table] }]);
    const slow = await createTable(c, { title: 'Slow table' });
    advance(t, SEC);
    await settle(3);
    expect(watcher.of('lobbyUpdate').at(-1)).toEqual(
      { t: 'lobbyUpdate', added: [expect.objectContaining({ table: slow.table, title: 'Slow table', filled: 1, creator: 'Carol' })], changed: [], removed: [] },
    );
    expect((await d.cmd({ t: 'join', table: slow.table, deck: TEST_DECK })).ok).toBe(true);
    advance(t, SEC);
    await settle(3);
    expect(watcher.of('lobbyUpdate').at(-1)).toEqual({ t: 'lobbyUpdate', added: [], changed: [], removed: [slow.table] });
    expect(bystander.of('lobbyUpdate')).toEqual([]);
  });

  it('a 4-seat table\'s joins are changes, a leaving player is a change, the creator leaving removes it', async () => {
    const t = lobbyGateway({ env: { PODS_ENABLED: '1' } });
    const watcher = await guest(t, 'Watcher');
    const [a, b, c] = [await guest(t, 'Alice'), await guest(t, 'Bob'), await guest(t, 'Carol')];
    await watcher.cmd({ t: 'watchLobby', filter: { seats: 4 } });
    const pod = await createTable(a, { format: 'commander', seats: 4 });
    advance(t, SEC);
    await b.cmd({ t: 'join', table: pod.table, deck: TEST_DECK });
    advance(t, SEC);
    await c.cmd({ t: 'join', table: pod.table, deck: TEST_DECK });
    advance(t, SEC);
    await b.cmd({ t: 'leave' });
    advance(t, SEC);
    await a.cmd({ t: 'leave' });
    advance(t, SEC);
    await settle(3);
    const filled = (m: LobbyUpdateMessage) => [...m.added, ...m.changed].map((l) => l.filled);
    expect(watcher.of('lobbyUpdate').map((m) => [filled(m), m.removed.length])).toEqual([[[1], 0], [[2], 0], [[3], 0], [[2], 0], [[], 1]]);
  });

  it('a hide is a removal for the browsers that watch; the table goes on for the people at it', async () => {
    const t = lobbyGateway();
    const watcher = await guest(t, 'Watcher');
    const a = await guest(t, 'Alice');
    await watcher.cmd({ t: 'watchLobby', filter: {} });
    const { table } = await createTable(a, { title: 'Questionable title' });
    advance(t, SEC);
    t.lobby.hide(table);
    advance(t, SEC);
    await settle(3);
    expect(watcher.of('lobbyUpdate').map((m) => [ids(m.added), m.removed])).toEqual([[[table], []], [[], [table]]]);
    expect(t.gateway.tables.has(table)).toBe(true);
    expect(a.last('table')!.table.title).toBe('Questionable title');
  });

  it('the connection\'s close ends its subscription; five watchers from one address are refused the fifth, which counts as a strike but keeps its connection', async () => {
    const t = lobbyGateway();
    const peer = '203.0.113.99';
    const mine = [];
    for (let i = 0; i < 5; i++) mine.push(await guest(t, `Watcher${i}`, { peer }));
    for (let i = 0; i < 4; i++) expect(await mine[i]!.cmd({ t: 'watchLobby', filter: {} })).toMatchObject({ ok: true });
    expect(await mine[4]!.cmd({ t: 'watchLobby', filter: {} })).toMatchObject({ ok: false, error: { code: 'limitReached', retryAfterMs: 60_000 } });
    expect(mine[4]!.client.closed).toBeNull();
    expect(t.lobby.stats().watchers).toBe(4);
    mine[0]!.client.close();
    await settle(3);
    expect(t.lobby.stats().watchers).toBe(3);
    t.clock.advance(5 * SEC);
    expect(await mine[4]!.cmd({ t: 'watchLobby', filter: {} })).toMatchObject({ ok: true });
  });
});
