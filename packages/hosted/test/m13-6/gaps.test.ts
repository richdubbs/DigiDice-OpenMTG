/**
 * M13-6 review: tests for single-line mutations of the gateway and tables that the fast tests let through (each test names the line it pins): the re-check
 * of "one game at a time" after the deck check, the one-minute sweep of sessions, touching a session when its socket closes, the fresh 5 minutes after a
 * capacity wait ran out, the address keys that reach admission, who is sent a table's views, `left` of a seat that sat down elsewhere, `seated()` for a seat
 * that left, coalesced syncs that must stay in order, and the 256-character Origin cap.
 */
import { describe, expect, it } from 'vitest';
import { originAllowed } from '../../src/gateway/origin';
import type { TableEnded } from '../../src/runtime/api';
import { Browser, createTable, freshPeer, guest, makeGateway, ScriptedAdmission, settle, startTable, TEST_DECK } from './harness';

const MIN = 60_000;
const DAY = 86_400_000;

describe('M13-6 one game at a time holds across the deck check (tables.ts join: the re-check after the deck pool)', () => {
  it('a join in flight on a socket that was replaced does not seat the session at a second table', async () => {
    const t = makeGateway();
    const c1 = await guest(t, 'Creator One');
    const c2 = await guest(t, 'Creator Two');
    const x = await createTable(c1);
    const y = await createTable(c2);
    const a = await guest(t, 'Alice');
    // Alice's first socket asks for table X; the deck pool takes its time ...
    t.runtime.prepareDelayMs = 100;
    a.client.send({ t: 'join', id: 5, table: x.table, deck: TEST_DECK });
    await settle(2);
    // ... her second socket (the first is replaced) asks for table Y, which the deck pool answers at once
    t.runtime.prepareDelayMs = 0;
    const a2 = Browser.connect(t, { peer: freshPeer() });
    await a2.hello('Alice', a.token);
    expect(await a2.cmd({ t: 'join', table: y.table, deck: TEST_DECK })).toMatchObject({ ok: true, table: y.table });
    // the first ask comes back from the deck pool: Alice already sits somewhere
    await new Promise((r) => setTimeout(r, 200));
    expect(t.gateway.tables.seatOf(a.session)).toMatchObject({ table: y.table });
    expect(t.gateway.tables.viewFor(x.table, null)!.seats.map((s) => s.name)).toEqual(['Creator One', null]);
    expect(t.gateway.tables.viewFor(y.table, null)!.seats.map((s) => s.name)).toEqual(['Creator Two', 'Alice']);
  });
});

describe('M13-6 sessions in memory (gateway.ts: the one-minute sweep, touchSession on close)', () => {
  it('a session that sits nowhere any more and has no connection leaves memory in the next minute\'s sweep, not before', async () => {
    const t = makeGateway();
    t.gateway.tick(); // the first tick sweeps; the next sweep is a minute later
    const { a, b, table } = await startTable(t);
    a.client.close();
    b.client.close();
    await settle(3);
    // both are seated at a running game: kept
    expect(t.gateway.sessionsInMemory).toBe(2);
    // the table is unloaded (the game was over and its seats left): nothing sits them now, but the sessions are still in memory until the sweep
    t.gateway.events.unloaded!(table);
    expect(t.gateway.sessionsInMemory).toBe(2);
    t.clock.advance(MIN - 1);
    t.gateway.tick();
    expect(t.gateway.sessionsInMemory).toBe(2);
    t.clock.advance(1);
    t.gateway.tick();
    expect(t.gateway.sessionsInMemory).toBe(0);
    // their rows are in the store: they come back as themselves
    expect((await guest(t, 'Alice', {}, a.token)).last('welcome')).toMatchObject({ resumed: true, session: a.session });
  });

  it('the 30 days of a session count from its last socket closing, not from its last hello', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    // connected for 25 days (the browser answers pings), closing then
    for (let day = 0; day < 25; day++) {
      t.clock.advance(DAY);
      a.client.pong();
      t.gateway.tick();
    }
    a.client.close();
    await settle(3);
    // 29 days later the session is 54 days old and was last used 29 days ago: still there; a day and a millisecond later it is gone
    t.clock.advance(29 * DAY);
    const back = await guest(t, 'Alice', {}, a.token);
    expect(back.last('welcome')).toMatchObject({ resumed: true, session: a.session });
    back.client.close();
    await settle(3);
    t.clock.advance(30 * DAY + 1);
    expect((await guest(t, 'Alice', {}, a.token)).last('welcome')!.resumed).toBe(false);
  });
});

describe('M13-6 tables: what reaches admission, who is sent views, who has left (tables.ts)', () => {
  it('the address keys of the seats reach admission (one start waiting per address key: 4.6), each once', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    const a = await guest(t, 'Alice', { peer: '203.0.113.1' });
    const b = await guest(t, 'Bob', { peer: '203.0.113.2' });
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(admission.requests[0]!.addressKeys).toEqual(['4:203.0.113.1', '4:203.0.113.2']);
    // two seats of one network: one key
    const c = await guest(t, 'Carol', { peer: '203.0.113.7' });
    const d = await guest(t, 'Dora', { peer: '203.0.113.7' });
    const second = await createTable(c);
    expect(await d.cmd({ t: 'join', table: second.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    expect(admission.requests[1]!.addressKeys).toEqual(['4:203.0.113.7']);
    expect(admission.requests[1]!.sessions).toEqual([c.session, d.session]);
  });

  it('a capacity wait that ran out gives the table a fresh 5 minutes, not what was left of its old ones (after the creator waited that long already)', async () => {
    const admission = new ScriptedAdmission();
    admission.mode = 'wait';
    const t = makeGateway({ admission });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    // 20 minutes of waiting for capacity (a waiting table does not expire), then admission gives up on it
    t.clock.advance(20 * MIN);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(true);
    admission.push({ kind: 'expired', table, retryAfterMs: 60_000 });
    t.gateway.tables.tick();
    await settle(3);
    expect(a.last('table')!.table.status).toBe('lobby');
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(true);
    t.clock.advance(5 * MIN - 1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(true);
    t.clock.advance(1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(false);
  });

  const voidEnd = (game: string): TableEnded => ({
    game, end: { outcome: 'void', reason: 'abandoned', result: null, at: 0, seq: 3, actions: 0, turns: 0, seats: [] }, record: null, status: 'void', units: 1,
  });

  it('a session that sat down at another table gets nothing more of the ended one (its views are sent to the seats still linked to it)', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    t.gateway.events.ended!(voidEnd(table));
    await settle(3);
    expect(a.last('table')!.table.table).toBe(table);
    t.clock.advance(10_000);
    const next = await createTable(a);
    const before = a.of('table').length;
    // the ended table's views go out again (the runtime reports the end once more): Bob is still linked to it, Alice is not
    t.gateway.events.ended!(voidEnd(table));
    await settle(3);
    expect(a.of('table').slice(before).filter((m) => m.table.table === table)).toEqual([]);
    expect(a.last('table')!.table.table).toBe(next.table);
    expect(b.last('table')!.table).toMatchObject({ table, status: 'over' });
  });

  it('a seat that sat down elsewhere has left the ended game: the table shows it as left, and the runtime was told once', async () => {
    const t = makeGateway();
    const { a, table } = await startTable(t);
    t.gateway.events.ended!(voidEnd(table));
    await settle(3);
    t.runtime.inputs.length = 0;
    t.clock.advance(10_000);
    await createTable(a);
    const view = t.gateway.tables.viewFor(table, null)!;
    expect(view.seats.map((s) => s.left)).toEqual([true, false]);
    expect(t.runtime.inputs.filter((i) => i.input.t === 'leave')).toEqual([{ game: table, input: { t: 'leave', seat: 1, id: 1 } }]);
  });
});

describe('M13-6 commands of a seat that left (gateway.ts seated(), onSync)', () => {
  it('after Leave the seat takes no more actions, votes or syncs for the game: notStarted, nothing reaches the runtime', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    a.client.send({ t: 'leave', id: 90 });
    await settle(3);
    t.runtime.inputs.length = 0;
    const seen = a.of('reply').length;
    a.client.send({ t: 'act', id: 91, seq: 0, action: { type: 'pass', player: 'p1' } });
    a.client.send({ t: 'vote', id: 92, proposal: 1, accept: true });
    a.client.send({ t: 'sync', id: 93 });
    await settle(5);
    expect(a.of('reply').slice(seen).map((r) => [r.id, r.ok ? 'ok' : r.error.code])).toEqual([[91, 'notStarted'], [92, 'notStarted'], [93, 'notStarted']]);
    expect(t.runtime.inputs).toEqual([]);
  });

  it('syncs wait in order: a sync that arrives after the five seconds, with earlier ones still waiting, does not jump ahead of them', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const syncs = () => t.runtime.inputs.filter((i) => i.input.t === 'sync').map((i) => (i.input as { id?: number }).id);
    a.client.send({ t: 'sync', id: 1 });
    await settle(3);
    t.clock.advance(1_000);
    a.client.send({ t: 'sync', id: 2 }); // waits for the five seconds
    await settle(3);
    // six seconds on, with no housekeeping tick yet: the next sync is due, but the earlier one is still waiting
    t.clock.advance(5_000);
    a.client.send({ t: 'sync', id: 3 });
    await settle(3);
    expect(syncs()).toEqual([1]);
    t.gateway.tick();
    await settle(3);
    expect(syncs()).toEqual([1, 3]);
  });
});

describe('M13-6 Origin: the 256-character cap (origin.ts)', () => {
  it('an origin of more than 256 characters is refused even when it is listed', () => {
    const long = `https://${'a'.repeat(240)}.example`;
    expect(long.length).toBe(256);
    const policy = { publicOrigins: [long, `https://${'b'.repeat(260)}.example`], allowDesktopOrigins: false };
    expect(originAllowed(long, policy)).toBe(true); // 256 or under: allowed
    const longer = `https://${'b'.repeat(260)}.example`;
    expect(longer.length).toBeGreaterThan(256);
    expect(originAllowed(longer, policy)).toBe(false);
  });
});
