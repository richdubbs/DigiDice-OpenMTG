/**
 * M13-6: the start of a game and the table's life around it (design 4.1, 4.4, 4.6's start flow), through the gateway on a fake runtime, a scripted
 * capacity admission and a fake clock: the ready check, a seat that does not confirm, waiting for capacity (position, unqueue, expiry, refusals), a start
 * the runtime refuses, drain, reconnecting before and during a game, the runtime's events (end, unload, deliveries), abandonment as the gateway sees it,
 * and the unstarted tables a restart brings back.
 */
import { describe, expect, it } from 'vitest';
import { METRICS } from '../../src/obs';
import type { TableEnded } from '../../src/runtime/api';
import { MemoryStore } from '../../src/store';
import { startRow } from '../m13-4/fixtures';
import { counted, createTable, guest, makeGateway, ready, ScriptedAdmission, settle, slowStore, startTable, TEST_DECK } from './harness';

const SEC = 1_000;
const MIN = 60_000;

/** Two guests at a full listed table whose ready check runs. */
async function fullTable(t: ReturnType<typeof makeGateway>) {
  const a = await guest(t, 'Alice');
  const b = await guest(t, 'Bob');
  const { table } = await createTable(a);
  expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
  return { a, b, table };
}

describe('M13-6 the ready check and the start (design 4.1)', () => {
  it('every seat confirms within 30 s; the game is then created with the decks, the clocks and who is connected', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    const { a, b, table } = await fullTable(t);
    await a.client.until(() => a.last('readyCheck') !== undefined && b.last('readyCheck') !== undefined);
    const rc = a.last('readyCheck')!;
    expect(rc).toMatchObject({ deadlineAt: t.clock.now() + 30 * SEC, players: [{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: false }] });
    expect(b.last('readyCheck')!.start).toBe(rc.start);
    expect(a.last('table')!.table.status).toBe('readyCheck');
    // the admission was asked once, for this table and its two sessions, one unit
    expect(admission.requests).toHaveLength(1);
    expect(admission.requests[0]).toMatchObject({ table, source: 'listed', seats: 2, units: 1, sessions: [a.session, b.session] });
    // not a ready check of this table
    expect(await a.cmd({ t: 'ready', start: 'deadbeef' })).toMatchObject({ ok: false, error: { code: 'notAllowed', message: 'There is no such ready check.' } });
    // Alice confirms: both are told
    expect(await a.cmd({ t: 'ready', start: rc.start })).toMatchObject({ ok: true, table });
    await b.client.until(() => b.last('readyCheck')!.players[0]!.ready);
    expect(b.last('table')!.table.seats.map((s) => s.ready)).toEqual([true, false]);
    expect(t.runtime.starts).toEqual([]);
    // again is harmless; Bob's confirmation starts the game
    expect(await a.cmd({ t: 'ready', start: rc.start })).toMatchObject({ ok: true });
    expect(await b.cmd({ t: 'ready', start: rc.start })).toMatchObject({ ok: true });
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(t.runtime.starts).toHaveLength(1);
    const start = t.runtime.starts[0]!;
    expect(start).toMatchObject({ game: table, format: 'casual', source: 'listed', clock: { bankMs: 15 * MIN, delayMs: 5 * SEC, dropMs: 5 * MIN }, connected: [1, 2] });
    expect(start.limits).toBeUndefined();
    expect(start.seats.map((s) => [s.seat, s.name, s.session, s.account ?? null])).toEqual([[1, 'Alice', a.session, null], [2, 'Bob', b.session, null]]);
    const row = (await t.store.tableRow(table))!;
    expect(start.seats.map((s) => s.deckHash)).toEqual(row.seatRows.map((s) => s.deckHash));
    expect(start.seats[0]!.deckHash).toMatch(/^[0-9a-f]{64}$/);
    expect(admission.begins).toEqual([table]);
    expect(t.gateway.tables.counts()).toMatchObject({ playing: 1, lobby: 0, readyCheck: 0 });
    expect(t.gateway.tables.listings()).toEqual([]);
    // a ready check is over once the game runs
    expect(await b.cmd({ t: 'ready', start: rc.start })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
  });

  it('a seat that does not confirm in time is stood up and the others go back to the lobby; the creator not confirming closes the table', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    const { a, b, table } = await fullTable(t);
    await ready(a);
    t.clock.advance(30 * SEC - 1);
    t.gateway.tables.tick();
    await settle(3);
    expect(a.of('notice')).toEqual([]);
    t.clock.advance(1);
    t.gateway.tables.tick();
    await settle(5);
    expect(a.of('notice').map((n) => n.kind)).toEqual(['readyCheckFailed']);
    expect(b.of('notice').map((n) => n.kind)).toEqual(['readyCheckFailed']);
    // the release names its cause, and admission alone counts the failure (M13-10): the tables count nothing themselves
    expect(admission.releases).toEqual([table]);
    expect(admission.releaseCauses).toEqual(['readyCheck']);
    expect(counted(t.metrics, METRICS.readyCheckFailures, { kind: 'table' })).toBe(0);
    // Bob was stood up; Alice sits alone in an open table
    expect(a.last('table')!.table).toMatchObject({ status: 'lobby', seats: [{ name: 'Alice', ready: false }, { name: null }] });
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
    expect(t.gateway.tables.listings()[0]).toMatchObject({ table, filled: 1 });
    expect((await t.store.tableRow(table))!.seatRows[1]).toMatchObject({ session: null });
    // and the table lives on for 5 more minutes
    t.clock.advance(5 * MIN - 1);
    t.gateway.tables.tick();
    expect(t.gateway.tables.has(table)).toBe(true);

    // the creator is the one who does not confirm
    const c = await guest(t, 'Carol');
    const d = await guest(t, 'Dora');
    const second = await createTable(c);
    expect(await d.cmd({ t: 'join', table: second.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await ready(d);
    t.clock.advance(30 * SEC);
    t.gateway.tables.tick();
    await settle(5);
    expect(d.of('notice').map((n) => n.kind)).toEqual(['readyCheckFailed', 'tableClosed']);
    expect(t.gateway.tables.has(second.table)).toBe(false);
    expect(t.gateway.tables.seatOf(d.session)).toBeNull();
    expect(admission.releaseCauses).toEqual(['readyCheck', 'readyCheck']);
  });

  it('a seat that leaves during the ready check reopens; the check does not carry over to the next time the table is full', async () => {
    const t = makeGateway();
    const { a, b, table } = await fullTable(t);
    await ready(a);
    t.clock.advance(SEC);
    expect(await b.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    const c = await guest(t, 'Carol');
    expect(await c.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await c.client.until(() => c.last('readyCheck') !== undefined);
    // a new check: nobody has confirmed yet
    expect(c.last('readyCheck')!.players.map((p) => p.ready)).toEqual([false, false]);
    expect(c.last('readyCheck')!.start).not.toBe(a.of('readyCheck')[0]!.start);
  });

  it('a game the runtime cannot start closes the table with the reason; a runtime that throws closes it too', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    // the runtime's own message (here an engine error naming a card) is never forwarded: a fixed text per reason
    t.runtime.startResult = () => ({ ok: false, reason: 'failed', message: 'Error: no definition for Secret Card Name (seed 123)' });
    const { a, b, table } = await fullTable(t);
    await ready(a);
    await ready(b);
    await a.client.until(() => a.of('notice').length > 0);
    expect(a.of('notice')).toEqual([{ t: 'notice', kind: 'tableClosed', text: 'The game could not start on the server.' }]);
    expect(JSON.stringify([a.client.frames, b.client.frames])).not.toContain('Secret Card Name');
    expect(b.of('notice').map((n) => n.kind)).toEqual(['tableClosed']);
    expect(admission.releases).toEqual([table]);
    expect(t.gateway.tables.has(table)).toBe(false);

    t.runtime.startResult = () => ({ ok: false, reason: 'draining', message: 'restarting' });
    t.clock.advance(10 * SEC);
    const second = await createTable(a);
    expect(await b.cmd({ t: 'join', table: second.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await ready(a);
    await ready(b);
    await a.client.until(() => a.of('notice').length > 1);
    expect(a.of('notice').at(-1)!.kind).toBe('serverDraining');

    t.runtime.startResult = () => {
      throw new Error('the runtime fell over');
    };
    t.clock.advance(10 * SEC);
    const third = await createTable(a);
    expect(await b.cmd({ t: 'join', table: third.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await ready(a);
    await ready(b);
    await a.client.until(() => a.of('notice').length > 2);
    expect(a.of('notice').at(-1)).toMatchObject({ kind: 'tableClosed', text: 'The game could not start on the server.' });
    expect(t.logger.entries().some((e) => e['event'] === 'tableStartError')).toBe(true);
    expect(t.gateway.tables.counts()).toMatchObject({ lobby: 0, readyCheck: 0, playing: 0 });
  });
});

describe('M13-6 an admitted start is released exactly once (its reserved units are given back once, whichever way the start ends)', () => {
  type Gw = ReturnType<typeof makeGateway>;
  type B = Awaited<ReturnType<typeof guest>>;

  /** A full table whose ready check runs, ended by `end`; the admission's releases and begins, and whether the table is gone. */
  async function scenario(setup: (t: Gw) => void, end: (t: Gw, a: B, b: B) => Promise<void>) {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    setup(t);
    const { a, b, table } = await fullTable(t);
    await end(t, a, b);
    await settle(5);
    return { releases: admission.releases, causes: admission.releaseCauses, begins: admission.begins, table, closed: !t.gateway.tables.has(table) };
  }
  const confirm = async (_t: Gw, a: B, b: B): Promise<void> => {
    await ready(a);
    await ready(b);
  };

  it('the runtime refuses or throws at the start: released once, the table closed', async () => {
    const refused = await scenario((t) => { t.runtime.startResult = () => ({ ok: false, reason: 'failed', message: 'no' }); }, confirm);
    expect(refused).toMatchObject({ releases: [refused.table], causes: ['startFailed'], begins: [], closed: true });
    const throwing = await scenario((t) => { t.runtime.startResult = () => { throw new Error('boom'); }; }, confirm);
    expect(throwing).toMatchObject({ releases: [throwing.table], causes: ['startFailed'], begins: [], closed: true });
  });

  it('a seat leaves during the ready check (a joiner: the seat opens; the creator: the table closes), or the server drains: released once', async () => {
    const joiner = await scenario(() => undefined, async (_t, _a, b) => void (await b.cmd({ t: 'leave' })));
    expect(joiner).toMatchObject({ releases: [joiner.table], causes: ['left'], closed: false });
    const creator = await scenario(() => undefined, async (_t, a) => void (await a.cmd({ t: 'leave' })));
    expect(creator).toMatchObject({ releases: [creator.table], causes: ['closed'], closed: true });
    const draining = await scenario(() => undefined, async (t) => t.gateway.drain());
    expect(draining).toMatchObject({ releases: [draining.table], causes: ['closed'], closed: true });
  });

  it('a game that does begin is never released', async () => {
    const fine = await scenario(() => undefined, confirm);
    expect(fine).toMatchObject({ releases: [], begins: [fine.table], closed: false });
  });

  it('after a restart the decks are prepared again at the start; a deck the pool now refuses closes the table, released once', async () => {
    const store = new MemoryStore();
    const one = makeGateway({ store });
    const a = await guest(one, 'Alice');
    const b = await guest(one, 'Bob');
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    const admission = new ScriptedAdmission();
    const two = makeGateway({ store, admission });
    await two.gateway.tables.restore();
    const a2 = await guest(two, 'Alice', {}, a.token);
    const b2 = await guest(two, 'Bob', {}, b.token);
    two.runtime.prepare = async () => ({ ok: false, errors: ['that card is no longer legal'], warnings: [] });
    await ready(a2);
    await ready(b2);
    await a2.client.until(() => a2.of('notice').some((n) => n.kind === 'tableClosed'));
    expect(a2.of('notice').at(-1)!.text).toBe("A player's deck could not be prepared again: the table is closed.");
    expect(admission.releases).toEqual([table]);
    expect(two.gateway.tables.has(table)).toBe(false);
  });
});

describe('M13-6 the last two seats of a pod taken together start it once (review 5)', () => {
  const POD = { PODS_ENABLED: '1' };
  async function pod(t: ReturnType<typeof makeGateway>) {
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    const { table } = await createTable(a, { format: 'commander', seats: 3 });
    return { a, b, c, table };
  }

  it('two joins in flight together: one admission request, one ready check for all three seats, one start', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission, env: POD, store: slowStore(new MemoryStore(), 'updateLobby', 30) });
    const { a, b, c, table } = await pod(t);
    const [rb, rc] = await Promise.all([b.cmd({ t: 'join', table, deck: TEST_DECK }), c.cmd({ t: 'join', table, deck: TEST_DECK })]);
    expect([rb.ok, rc.ok]).toEqual([true, true]);
    await settle(3);
    expect(admission.requests).toHaveLength(1);
    for (const x of [a, b, c]) expect(x.of('readyCheck').map((m) => m.start), x.session).toHaveLength(1);
    const starts = new Set([a, b, c].map((x) => x.last('readyCheck')!.start));
    expect(starts.size).toBe(1);
    expect(a.last('readyCheck')!.players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Carol']);
    for (const x of [a, b, c]) expect((await ready(x)).ok).toBe(true);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(t.runtime.starts).toHaveLength(1);
    expect(admission.begins).toEqual([table]);
  });

  it('a start that admission refuses undoes only the join that asked for it; the other seat stays', async () => {
    const admission = new ScriptedAdmission();
    admission.mode = { refuse: 'queueFull' };
    const t = makeGateway({ admission, env: POD, store: slowStore(new MemoryStore(), 'updateLobby', 30) });
    const { a, b, c, table } = await pod(t);
    const results = await Promise.all([b.cmd({ t: 'join', table, deck: TEST_DECK }), c.cmd({ t: 'join', table, deck: TEST_DECK })]);
    expect(admission.requests).toHaveLength(1);
    expect(results.map((r) => (r.ok ? 'ok' : r.error.code)).sort()).toEqual(['ok', 'serverBusy']);
    const seated = a.last('table')!.table.seats.map((x) => x.name);
    expect(seated.filter((n) => n !== null)).toHaveLength(2);
    expect(t.gateway.tables.seatOf(b.session) === null || t.gateway.tables.seatOf(c.session) === null).toBe(true);
  });
});

describe('M13-6 a table that closes while a player is taking its last seat', () => {
  it('the join is told the table is gone; no start is asked of admission for a table that no longer exists', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission, store: slowStore(new MemoryStore(), 'updateLobby', 40) });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    // Bob takes the seat (the store saves it, slowly) ...
    const join = b.cmd({ t: 'join', table, deck: TEST_DECK });
    await settle(2);
    // ... and Alice, the creator, leaves in that moment: the table closes
    a.client.send({ t: 'leave', id: 90 });
    const reply = await join;
    expect(reply).toMatchObject({ ok: false, error: { code: 'noTable' } });
    expect(admission.requests).toEqual([]);
    expect(admission.releases).toEqual([]);
    expect(t.gateway.tables.has(table)).toBe(false);
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
    expect(b.of('readyCheck')).toEqual([]);
    // Bob is free to sit elsewhere
    expect((await createTable(b)).table).toBeTruthy();
  });
});

describe('M13-6 waiting for capacity (design 4.6): the table keeps its seats, shows its position, and can be left', () => {
  async function waiting() {
    const admission = new ScriptedAdmission();
    admission.mode = 'wait';
    const t = makeGateway({ admission });
    const { a, b, table } = await fullTable(t);
    await a.client.until(() => a.last('queueStatus') !== undefined && b.last('queueStatus') !== undefined);
    return { t, admission, a, b, table };
  }

  it('a full table that cannot start waits: its status, the queue status for both, the row; it is not listed', async () => {
    const { t, a, b, table } = await waiting();
    const q = { kind: 'capacity', table, position: 1, unitsAhead: 1, estimatedWaitMs: null };
    expect(a.last('queueStatus')!.queue).toEqual(q);
    expect(b.last('queueStatus')!.queue).toEqual(q);
    expect(a.last('table')!.table.status).toBe('waitingCapacity');
    expect(t.gateway.tables.listings()).toEqual([]);
    expect(t.gateway.tables.counts()).toMatchObject({ waitingCapacity: 1 });
    const row = (await t.store.tableRow(table))!;
    expect(row.status).toBe('waitingCapacity');
    expect(row.waitingSince?.getTime()).toBe(t.clock.now());
    // a player who reconnects while waiting is told the queue in `welcome` and the status again
    a.client.close();
    await settle(3);
    const again = await guest(t, 'Alice', {}, a.token);
    expect(again.last('welcome')).toMatchObject({ resumed: true, table, seat: 1, queue: q });
    await again.client.until(() => again.last('queueStatus') !== undefined);
    expect(again.last('queueStatus')!.queue).toEqual(q);
  });

  it('positions come as admission sends them, at most once in 5 s; admitted, the ready check starts and the game with it', async () => {
    const { t, admission, a, b, table } = await waiting();
    const before = a.of('queueStatus').length;
    admission.push({ kind: 'position', table, position: 3, unitsAhead: 2, estimatedWaitMs: 120_000 });
    t.clock.advance(4 * SEC);
    t.gateway.tables.tick();
    expect(a.of('queueStatus')).toHaveLength(before);
    admission.push({ kind: 'position', table, position: 2, unitsAhead: 1, estimatedWaitMs: 60_000 });
    t.clock.advance(SEC);
    t.gateway.tables.tick();
    await settle(2);
    expect(a.of('queueStatus')).toHaveLength(before + 1);
    expect(a.last('queueStatus')!.queue).toEqual({ kind: 'capacity', table, position: 2, unitsAhead: 1, estimatedWaitMs: 60_000 });
    expect(b.last('queueStatus')!.queue).toMatchObject({ position: 2 });
    admission.push({ kind: 'admitted', table });
    t.gateway.tables.tick();
    await settle(2);
    expect(a.last('table')!.table.status).toBe('readyCheck');
    await ready(a);
    await ready(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(t.runtime.starts).toHaveLength(1);
    expect(admission.begins).toEqual([table]);
    // an event for a table that is gone, or no longer waiting, changes nothing
    admission.push({ kind: 'admitted', table }, { kind: 'admitted', table: 'nope' }, { kind: 'position', table, position: 1, unitsAhead: 0, estimatedWaitMs: null }, { kind: 'expired', table, retryAfterMs: 1 });
    const notices = a.of('notice').length;
    t.gateway.tables.tick();
    await settle(2);
    expect(t.gateway.tables.counts()).toMatchObject({ playing: 1, lobby: 0 });
    expect(a.of('notice')).toHaveLength(notices);
  });

  it('unqueue: the seat opens, admission is told, the table is open for players again; the creator leaving closes it', async () => {
    const { t, admission, a, b, table } = await waiting();
    t.clock.advance(5 * SEC);
    expect(await b.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    expect(admission.withdrawn).toEqual([table]);
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
    expect(a.last('table')!.table).toMatchObject({ status: 'lobby', seats: [{ name: 'Alice' }, { name: null }] });
    const row = (await t.store.tableRow(table))!;
    expect(row.status).toBe('lobby');
    expect(row.waitingSince).toBeNull();
    expect(t.gateway.tables.listings()[0]).toMatchObject({ table, filled: 1 });
    // not waiting any more: unqueue is a harmless ok
    t.clock.advance(5 * SEC);
    expect(await b.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    // joins again, waits again; the creator leaves: the table closes and its place in the queue goes
    t.clock.advance(SEC);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await b.client.until(() => b.last('table')!.table.status === 'waitingCapacity');
    t.clock.advance(SEC);
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(admission.withdrawn).toEqual([table, table]);
    expect(b.of('notice').map((n) => n.kind)).toEqual(['tableClosed']);
    expect(t.gateway.tables.has(table)).toBe(false);
  });

  it('a wait that ran out goes back to the lobby with a notice (capacityTimeout), the seats kept', async () => {
    const { t, admission, a, b, table } = await waiting();
    admission.push({ kind: 'expired', table, retryAfterMs: 60_000 });
    t.gateway.tables.tick();
    await settle(3);
    for (const x of [a, b]) expect(x.of('notice').map((n) => n.kind)).toEqual(['capacityTimeout']);
    expect(a.last('table')!.table).toMatchObject({ status: 'lobby', seats: [{ name: 'Alice' }, { name: 'Bob' }] });
    expect((await t.store.tableRow(table))!).toMatchObject({ status: 'lobby', waitingSince: null });
    expect(t.gateway.tables.listings()[0]).toMatchObject({ table, filled: 2 });
  });

  it('a start admission refuses undoes the last join: serverBusy (queue full), busy (a player already waits), draining', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const { table } = await createTable(a);
    for (const [refuse, code] of [['queueFull', 'serverBusy'], ['session', 'busy'], ['address', 'busy'], ['draining', 'draining']] as const) {
      admission.mode = { refuse };
      t.clock.advance(SEC);
      const r = await b.cmd({ t: 'join', table, deck: TEST_DECK });
      expect(r, refuse).toMatchObject({ ok: false, error: { code, ...(refuse === 'draining' ? {} : { retryAfterMs: 60_000 }) } });
      await settle(2);
      expect(t.gateway.tables.seatOf(b.session), refuse).toBeNull();
      expect(a.last('table')!.table.seats[1]!.name, refuse).toBeNull();
      expect((await t.store.tableRow(table))!.seatRows[1]!.session, refuse).toBeNull();
    }
    // the table is untouched and still open
    expect(t.gateway.tables.listings()[0]).toMatchObject({ table, filled: 1 });
    admission.mode = 'admit';
    t.clock.advance(SEC);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
  });
});

describe('M13-6 drain (design 2.3): no new tables or joins, open tables close, running games go on', () => {
  it('drain closes the unstarted tables with a notice, refuses new tables, joins and queue entries, and tells idle guests', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission, hooks: { match: { busy: () => false, queue: async () => ({ ok: true }), unqueue: async () => null, ready: () => null } } });
    const { a: p, b: q } = await startTable(t, ['Pat', 'Quinn']);
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const idle = await guest(t, 'Idle');
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    t.gateway.drain();
    expect(t.gateway.draining).toBe(true);
    expect(admission.draining).toBe(true);
    expect(t.gateway.tables.has(table)).toBe(false);
    // told once: by the closing of their table (not again by the general notice)
    for (const x of [a, b]) expect(x.of('notice')).toEqual([{ t: 'notice', kind: 'serverDraining', text: 'The server is restarting soon: this table is closed. Please try again in a few minutes.' }]);
    expect(idle.of('notice').map((n) => n.kind)).toEqual(['serverDraining']);
    // the running game is left alone: no notice from the gateway (the table actor speaks to its own), still seated
    expect(p.of('notice')).toEqual([]);
    expect(q.of('notice')).toEqual([]);
    expect(t.gateway.tables.counts()).toMatchObject({ playing: 1 });
    // new work is refused
    t.clock.advance(10 * SEC);
    expect(await idle.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'draining' } });
    expect(await idle.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'draining' } });
    expect(await idle.cmd({ t: 'queue', format: 'casual', size: 2, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'draining' } });
    // and the gateway still takes connections (players of running games come back)
    expect('refused' in t.transport.connect()).toBe(false);
  });
});

describe('M13-6 reconnecting (design 3.3)', () => {
  it('a seated player who drops keeps the seat: the others see it, and hello with the token puts the table and the ready check back', async () => {
    const t = makeGateway();
    const { a, b, table } = await fullTable(t);
    await a.client.until(() => a.last('readyCheck') !== undefined);
    b.client.close();
    await a.client.until(() => a.last('table')!.table.seats[1]!.connected === false);
    expect(t.gateway.tables.seatOf(b.session)).toMatchObject({ table, seat: 2 });
    const again = await guest(t, 'Bob', {}, b.token);
    expect(again.last('welcome')).toMatchObject({ resumed: true, table, seat: 2 });
    await again.client.until(() => again.last('readyCheck') !== undefined);
    expect(again.last('table')!.table).toMatchObject({ you: 2, status: 'readyCheck' });
    expect(again.last('readyCheck')!.start).toBe(a.last('readyCheck')!.start);
    await a.client.until(() => a.last('table')!.table.seats[1]!.connected === true);
    // the ready check goes on where it was
    expect(await ready(again)).toMatchObject({ ok: true });
  });

  it('in a game the runtime hears of the drop and of the return; a seat that left is not put back', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    t.runtime.inputs.length = 0;
    b.client.close();
    await settle(3);
    expect(t.runtime.inputs).toEqual([{ game: table, input: { t: 'disconnect', seat: 2 } }]);
    const again = await guest(t, 'Bob', {}, b.token);
    expect(again.last('welcome')).toMatchObject({ resumed: true, table, seat: 2 });
    await settle(3);
    expect(t.runtime.inputs.at(-1)).toEqual({ game: table, input: { t: 'connect', seat: 2 } });
    // Alice leaves (a concession the table applies); her later connection is not a seat any more
    a.client.send({ t: 'leave', id: 90 });
    await settle(3);
    expect(t.runtime.inputs.at(-1)).toEqual({ game: table, input: { t: 'leave', seat: 1, id: 90 } });
    a.client.close();
    await settle(3);
    expect(t.runtime.inputs.map((i) => i.input.t)).toEqual(['disconnect', 'connect', 'leave']);
    const back = await guest(t, 'Alice', {}, a.token);
    expect(back.last('welcome')?.table).toBeUndefined();
    expect(back.last('welcome')?.seat).toBeUndefined();
    await settle(3);
    expect(t.runtime.inputs.map((i) => i.input.t)).toEqual(['disconnect', 'connect', 'leave']);
  });
});

describe('M13-6 the runtime\'s events: deliveries, the end, the unload', () => {
  const voidEnd = (game: string): TableEnded => ({
    game, end: { outcome: 'void', reason: 'abandoned', result: null, at: 0, seq: 3, actions: 0, turns: 0, seats: [] }, record: null, status: 'void', units: 1,
  });

  it('deliveries go to the seat\'s current connection only, and only while its session still sits at that table', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    const line = (text: string) => JSON.stringify({ t: 'chat', from: 2, text });
    t.gateway.events.deliver(table, [{ seat: 1, t: 'chat', json: line('one') }, { seat: 2, t: 'chat', json: line('two') }]);
    await settle(3);
    expect(a.of('chat').map((m) => m.text)).toEqual(['one']);
    expect(b.of('chat').map((m) => m.text)).toEqual(['two']);
    // unknown game, unknown seat, a seat nobody holds: nothing happens
    t.gateway.events.deliver('nope', [{ seat: 1, t: 'chat', json: line('x') }]);
    t.gateway.events.deliver(table, [{ seat: 4, t: 'chat', json: line('y') }]);
    // a seat whose connection dropped gets nothing (it is not queued for the return: the table sends a full view then)
    b.client.close();
    await settle(3);
    t.gateway.events.deliver(table, [{ seat: 2, t: 'chat', json: line('three') }]);
    await settle(3);
    expect(b.of('chat').map((m) => m.text)).toEqual(['two']);
  });

  it('the end: the table is over for its seats, its capacity units are freed, chat goes on until the unload; sitting down elsewhere leaves the old table', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission });
    const { a, b, table } = await startTable(t);
    t.gateway.events.ended!(voidEnd(table));
    await settle(3);
    expect(admission.freedUnits).toEqual([1]);
    expect(a.last('table')!.table.status).toBe('over');
    expect(t.gateway.tables.counts()).toMatchObject({ over: 1, playing: 0 });
    // the table stays for good-game chat
    t.runtime.inputs.length = 0;
    a.client.send({ t: 'chat', id: 70, text: 'gg' });
    await settle(3);
    expect(t.runtime.inputs).toEqual([{ game: table, input: { t: 'chat', seat: 1, id: 70, text: 'gg' } }]);
    // an ended game is not "a game": Alice may sit down at a new table, which leaves the old one (the runtime unloads it when every seat has left)
    t.clock.advance(10 * SEC);
    const second = await createTable(a);
    expect(t.runtime.inputs.at(-1)).toEqual({ game: table, input: { t: 'leave', seat: 1, id: 1 } });
    expect(t.gateway.tables.seatOf(a.session)).toMatchObject({ table: second.table });
    // what the old table sends her no longer reaches her
    t.gateway.events.deliver(table, [{ seat: 1, t: 'chat', json: JSON.stringify({ t: 'chat', from: 2, text: 'late' }) }]);
    await settle(3);
    expect(a.of('chat').map((m) => m.text)).not.toContain('late');
    // Bob leaves the ended game himself, then the runtime unloads it
    b.client.send({ t: 'leave', id: 91 });
    await settle(3);
    expect(t.runtime.inputs.some((i) => i.input.t === 'leave' && (i.input as { seat: number }).seat === 2)).toBe(true);
    t.gateway.events.unloaded!(table);
    expect(t.gateway.tables.has(table)).toBe(false);
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
  });

  it('abandoned: nobody connected is the runtime\'s timer; the gateway tells it each drop and return, and shows the void to whoever is there', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    t.runtime.inputs.length = 0;
    a.client.close();
    b.client.close();
    await settle(3);
    expect(t.runtime.inputs.map((i) => i.input)).toEqual([{ t: 'disconnect', seat: 1 }, { t: 'disconnect', seat: 2 }]);
    // Bob comes back before the five minutes are over: the runtime hears it
    const bob = await guest(t, 'Bob', {}, b.token);
    expect(bob.last('welcome')).toMatchObject({ resumed: true, table, seat: 2 });
    await settle(3);
    expect(t.runtime.inputs.at(-1)).toEqual({ game: table, input: { t: 'connect', seat: 2 } });
    // the table voids the game later: Bob gets the result through the delivery, and the table is over for both of them
    t.gateway.events.deliver(table, [{ seat: 2, t: 'result', json: JSON.stringify({ t: 'result', outcome: 'void', reason: 'abandoned', result: null, placements: [] }) }]);
    t.gateway.events.ended!(voidEnd(table));
    await settle(3);
    expect(bob.last('result')).toMatchObject({ outcome: 'void', reason: 'abandoned' });
    expect(bob.last('table')!.table.status).toBe('over');
    expect(t.gateway.tables.seatOf(a.session)).toMatchObject({ status: 'over' });
  });
});

describe('M13-6 a seat that left a started game stays left after a restart (review 6)', () => {
  /** The runtime of these tests does not start games in the store: do it, as the real one does. */
  const started = async (t: ReturnType<typeof makeGateway>, ...games: string[]) => {
    for (const g of games) await t.store.startGame(g, startRow());
  };

  it('Leave writes left_at of the seat (once); the seat of the one who stayed has none', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    t.clock.advance(7_000);
    b.client.send({ t: 'leave', id: 90 });
    await settle(5);
    const row = (await t.store.tableRow(table))!;
    expect(row.seatRows.map((r) => r.leftAt)).toEqual([null, new Date(t.clock.now())]);
    // sitting down elsewhere leaves an ended game too (and a second leave changes nothing)
    t.clock.advance(1_000);
    b.client.send({ t: 'leave', id: 91 });
    await settle(5);
    expect((await t.store.tableRow(table))!.seatRows[1]!.leftAt).toEqual(new Date(t.clock.now() - 1_000));
    void a;
  });

  it('after a restart the adopted game does not seat the one who left: no table in the welcome, free to sit elsewhere; the one who stayed is seated', async () => {
    const store = new MemoryStore();
    const one = makeGateway({ store });
    const { a, b, table } = await startTable(one);
    b.client.send({ t: 'leave', id: 90 });
    await settle(5);
    await started(one, table);
    const two = makeGateway({ store });
    expect(await two.gateway.tables.adopt(table)).toBe(true);
    expect(two.gateway.tables.seatOf(a.session)).toMatchObject({ table, seat: 1, status: 'playing', left: false });
    expect(two.gateway.tables.busyIn(b.session)).toBeNull();
    const a2 = await guest(two, 'Alice', {}, a.token);
    const b2 = await guest(two, 'Bob', {}, b.token);
    expect(a2.last('welcome')).toMatchObject({ resumed: true, table, seat: 1 });
    expect(b2.last('welcome')!.table).toBeUndefined();
    expect((await createTable(b2)).table).toBeTruthy(); // not blocked until that game ends
  });

  it('a session that left one running game and sits at another is linked to the other, whichever game is adopted first', async () => {
    const store = new MemoryStore();
    const one = makeGateway({ store });
    const first = await startTable(one, ['Alice', 'Bob']);
    first.b.client.send({ t: 'leave', id: 90 });
    await settle(5);
    const carol = await guest(one, 'Carol');
    const dora = await guest(one, 'Dora');
    one.clock.advance(10_000);
    const second = await createTable(first.b);
    expect(await carol.cmd({ t: 'join', table: second.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await ready(first.b);
    await ready(carol);
    await first.b.client.until(() => first.b.last('table')!.table.status === 'playing');
    void dora;
    await started(one, first.table, second.table);
    for (const order of [[first.table, second.table], [second.table, first.table]]) {
      const two = makeGateway({ store });
      for (const g of order) expect(await two.gateway.tables.adopt(g)).toBe(true);
      expect(two.gateway.tables.seatOf(first.b.session), order.join()).toMatchObject({ table: second.table, left: false });
      expect(two.gateway.tables.busyIn(first.b.session)).toBe(second.table);
      expect(two.gateway.tables.seatOf(first.a.session)).toMatchObject({ table: first.table });
    }
  });
});

describe('M13-6 after a restart: the unstarted tables come back from the store (design 4.7)', () => {
  it('lobby tables, a private table\'s codes, seats and decks are restored; waiting tables ask again in their old order; sessions resume at their seats', async () => {
    const store = new MemoryStore();
    const admission = new ScriptedAdmission();
    admission.mode = 'wait';
    const one = makeGateway({ store, admission });
    // a private table with a code, a listed table, and two full tables waiting for capacity (the first waited longer)
    const a = await guest(one, 'Alice');
    const priv = await createTable(a, { visibility: 'private' });
    const b = await guest(one, 'Bob');
    const listed = await createTable(b, { title: 'Open table' });
    const [c, d, e, f] = [await guest(one, 'Carol'), await guest(one, 'Dora'), await guest(one, 'Eve'), await guest(one, 'Fay')];
    const w1 = await createTable(c);
    expect(await d.cmd({ t: 'join', table: w1.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    one.clock.advance(10 * SEC);
    const w2 = await createTable(e);
    expect(await f.cmd({ t: 'join', table: w2.table, deck: TEST_DECK })).toMatchObject({ ok: true });
    // a table that closed before the restart stays closed
    const g = await guest(one, 'Gus');
    const gone = await createTable(g);
    expect(await g.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    await settle(5);

    // the restart: a new gateway on the same store, a new admission (it admits at once now)
    const admission2 = new ScriptedAdmission();
    const two = makeGateway({ store, admission: admission2 });
    const sink: string[] = [];
    const sunk = makeGateway({ store, listings: { changed: (table, listing) => sink.push(`${table}:${listing?.filled ?? 'x'}`) } });
    expect(await sunk.gateway.tables.restore()).toBe(4);
    expect(await two.gateway.tables.restore()).toBe(4);
    expect(two.gateway.tables.has(gone.table)).toBe(false);
    expect(two.gateway.tables.has(priv.table) && two.gateway.tables.has(listed.table)).toBe(true);
    // the full tables asked again, the one that waited longer first; they are in a ready check now (admission admitted them)
    expect(admission2.requests.map((r) => r.table)).toEqual([w1.table, w2.table]);
    expect(two.gateway.tables.counts()).toMatchObject({ lobby: 2, readyCheck: 2 });
    // the listing is rebuilt (only the unstarted listed tables in the lobby; the waiting ones are in a ready check)
    expect(sunk.gateway.tables.listings().map((l) => [l.title, l.filled])).toEqual([['Open table', 1]]);
    expect(sink).toContain(`${listed.table}:1`);
    expect(two.gateway.tables.listings().map((l) => l.table)).toEqual([listed.table]);

    // the invite code still works (only its hash was stored)
    const h = await guest(two, 'Hal');
    expect(await h.cmd({ t: 'join', code: priv.codes[0]!, deck: TEST_DECK })).toMatchObject({ ok: true, table: priv.table });
    // the sessions resume at their seats with their tokens
    const alice = await guest(two, 'Alice', {}, a.token);
    expect(alice.last('welcome')).toMatchObject({ resumed: true, table: priv.table, seat: 1 });
    await alice.client.until(() => alice.last('table') !== undefined);
    expect(alice.last('table')!.table.seats.map((s) => s.name)).toEqual(['Alice', 'Hal']);
    const carol = await guest(two, 'Carol', {}, c.token);
    const dora = await guest(two, 'Dora', {}, d.token);
    await carol.client.until(() => carol.last('readyCheck') !== undefined);
    await dora.client.until(() => dora.last('readyCheck') !== undefined);
    // the decks were not kept prepared: they are prepared again at the start
    const prepared = two.runtime.prepared;
    await ready(carol);
    await ready(dora);
    await carol.client.until(() => carol.last('table')!.table.status === 'playing');
    expect(two.runtime.prepared - prepared).toBe(2);
    expect(two.runtime.starts).toHaveLength(1);
    expect(two.runtime.starts[0]).toMatchObject({ game: w1.table, seats: [{ seat: 1, name: 'Carol' }, { seat: 2, name: 'Dora' }] });
    expect(two.runtime.starts[0]!.seats.map((s) => s.deckHash)).toHaveLength(2);
  });

  it('tables that cannot be restored (matched tables, whose matcher is gone; a lobby row without its creator) are voided with a notice and not counted (review 7)', async () => {
    const store = new MemoryStore();
    const one = makeGateway({ store });
    const [a, b, c, d, e] = [await guest(one, 'Alice'), await guest(one, 'Bob'), await guest(one, 'Carol'), await guest(one, 'Dora'), await guest(one, 'Eve')];
    const seat = (n: 1 | 2, who: Awaited<ReturnType<typeof guest>> | null) => ({
      seat: n, player: null, session: who?.session ?? null, name: who ? 'Name' : null, deck: who ? TEST_DECK : null, deckHash: who ? 'f'.repeat(64) : null, inviteHash: null,
      joinedAt: who ? new Date(one.clock.now()) : null, leftAt: null,
    });
    const row = (id: string, source: 'matched' | 'listed', seats: ReturnType<typeof seat>[]) => ({
      id, format: 'casual' as const, variant: null, seats: 2 as const, source, title: `Table ${id}`, passwordHash: null, passwordSalt: null, createdAt: new Date(one.clock.now() + id.length),
      seatRows: seats,
    });
    await store.createGame(row('MATCHEDLOBBY', 'matched', [seat(1, a), seat(2, b)]));
    await store.createGame(row('MATCHEDWAIT', 'matched', [seat(1, c), seat(2, d)]));
    await store.updateLobby('MATCHEDWAIT', { status: 'waitingCapacity', waitingSince: new Date(one.clock.now()) });
    await store.createGame(row('NOCREATOR', 'listed', [seat(1, null), seat(2, e)]));
    // a table that can be restored beside them
    const f = await guest(one, 'Fay');
    const { table } = await createTable(f);

    const two = makeGateway({ store });
    expect(await two.gateway.tables.restore()).toBe(1);
    expect(two.gateway.tables.counts()).toMatchObject({ lobby: 1 });
    expect(two.gateway.tables.has(table)).toBe(true);
    await settle(5);
    for (const id of ['MATCHEDLOBBY', 'MATCHEDWAIT', 'NOCREATOR']) expect(await store.tableRow(id), id).toMatchObject({ status: 'void' });
    expect((await store.openTables()).map((r) => r.id)).toEqual([table]);
    // nobody is left sitting at them: the sessions are free, and each is told once, when it comes back
    expect(two.gateway.tables.seatOf(a.session)).toBeNull();
    const a2 = await guest(two, 'Alice', {}, a.token);
    const c2 = await guest(two, 'Carol', {}, c.token);
    const e2 = await guest(two, 'Eve', {}, e.token);
    await settle(3);
    expect(a2.of('notice')).toEqual([{ t: 'notice', kind: 'queueLost', text: 'The server restarted while your match was forming; please queue again.' }]);
    expect(c2.of('notice').map((n) => n.kind)).toEqual(['queueLost']);
    expect(e2.of('notice')).toEqual([{ t: 'notice', kind: 'tableClosed', text: 'The server restarted and your table could not be restored; please make a new one.' }]);
    a2.client.close();
    await settle(3);
    const a3 = await guest(two, 'Alice', {}, a.token);
    expect(a3.of('notice')).toEqual([]);
    expect((await createTable(a3)).table).toBeTruthy();
  });

  it('a restored ready check that nobody confirms runs out like any other', async () => {
    const store = new MemoryStore();
    const admission = new ScriptedAdmission();
    admission.mode = 'wait';
    const one = makeGateway({ store, admission });
    const a = await guest(one, 'Alice');
    const b = await guest(one, 'Bob');
    const { table } = await createTable(a);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    await settle(3);
    const two = makeGateway({ store });
    await two.gateway.tables.restore();
    expect(two.gateway.tables.counts()).toMatchObject({ readyCheck: 1 });
    two.clock.advance(30 * SEC);
    two.gateway.tables.tick();
    await settle(5);
    // the creator never came back: the table closed
    expect(two.gateway.tables.has(table)).toBe(false);
    expect((await store.tableRow(table))!.status).toBe('void');
  });
});
