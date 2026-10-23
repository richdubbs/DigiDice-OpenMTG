/**
 * M13-13 part B: the edges of matchmaking through the gateway (design 4.5, 4.6): refusals of `queue`, admission's refusals and events for a match, a start
 * the runtime refuses, connections that drop and return, the no-immediate-rematch rule across real games, `gone` and `drain` called as the gateway calls
 * them, and the event routing between matched tables and the tables layer's own.
 */
import { describe, expect, it } from 'vitest';
import { METRICS } from '../../src/obs';
import { counted, createTable, ScriptedAdmission, startTable, TEST_DECK } from '../m13-6/harness';
import { Browser } from '../m13-6/harness';
import { confirm, DECK, drop, enqueue, makeMatchRig, rounds } from './rig';

const SEC = 1_000;

describe('M13-13 queue refusals', () => {
  it('a deck that is not legal is refused with its problems and the session is not queued', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const bad = await enqueue(a, { deck: { main: [{ name: 'Bad Card', count: 4 }], sideboard: [] } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'deckRejected', details: ['Unknown card: Bad Card'] } });
    expect(r.service.busy(a.session)).toBe(false);
  });

  it('a queue this server does not offer: a pod queue while pods are off is notYet, a format it does not host is notAllowed', async () => {
    const r = await makeMatchRig({ env: { HOSTED_FORMATS: 'casual,commander' } });
    const a = await r.player('Alice');
    expect(await enqueue(a, { format: 'commander', size: 'pod' })).toMatchObject({ ok: false, error: { code: 'notYet' } });
    r.clock.advance(5 * SEC);
    expect(await enqueue(a, { format: 'pauper' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    expect(r.matchRuntime.prepared).toBe(0); // refused before the deck pool was asked
    r.clock.advance(5 * SEC);
    expect(await enqueue(a, { format: 'commander' })).toMatchObject({ ok: true });
  });

  it('already queued, and at a table: busy; two entries per address key: the third is limitReached', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice', { peer: '10.9.9.9' });
    const b = await r.player('Bob', { peer: '10.9.9.9' });
    const c = await r.player('Carol', { peer: '10.9.9.9' });
    expect(await enqueue(a)).toMatchObject({ ok: true });
    r.clock.advance(5 * SEC);
    expect(await enqueue(a)).toMatchObject({ ok: false, error: { code: 'busy' } });
    // Bob and Carol share Alice's address key: two entries are allowed (they may even be matched with each other), the third is not
    expect(await enqueue(b, { format: 'pauper' })).toMatchObject({ ok: true });
    expect(await enqueue(c, { format: 'standard' })).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    // a session that sits at a table is refused by the gateway before the service
    const d = await r.player('Dave');
    await createTable(d);
    expect(await enqueue(d)).toMatchObject({ ok: false, error: { code: 'busy' } });
  });

  it('a drain that begins while the deck is being checked refuses the entry with draining (not as a queue that is not offered)', async () => {
    const r = await makeMatchRig();
    r.matchRuntime.prepareDelayMs = 30;
    const a = await r.player('Alice');
    const reply = enqueue(a);
    await new Promise((res) => setTimeout(res, 5));
    r.gateway.drain();
    expect(await reply).toMatchObject({ ok: false, error: { code: 'draining' } });
    expect(r.service.busy(a.session)).toBe(false);
  });

  it('a session queued here cannot sit down at a table (one game at a time)', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    expect(await b.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: true });
    const t = b.last('table')!.table.table;
    expect(await a.cmd({ t: 'join', table: t, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
  });
});

describe('M13-13 admission refuses or answers late', () => {
  it('a match capacity admission refuses (the queue is full) comes apart: everyone keeps their place and is tried again after the back-off', async () => {
    const sa = new ScriptedAdmission();
    sa.mode = { refuse: 'queueFull' };
    const r = await makeMatchRig({ admission: sa });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await r.step(0);
    expect(sa.requests).toHaveLength(1);
    expect(a.of('readyCheck')).toEqual([]);
    expect(r.service.busy(a.session)).toBe(true);
    expect(r.service.owns(sa.requests[0]!.table)).toBe(false);
    // not tried again every second: the members are skipped for the back-off (5 s)
    await r.step(4 * SEC);
    expect(sa.requests).toHaveLength(1);
    sa.mode = 'admit';
    await r.step(2 * SEC);
    expect(sa.requests).toHaveLength(2);
    expect(sa.requests[1]!.table).not.toBe(sa.requests[0]!.table);
    await a.client.until(() => a.last('readyCheck') !== undefined);
  });

  it('refused because the server drains: the members are told queueLost', async () => {
    const sa = new ScriptedAdmission();
    sa.mode = { refuse: 'draining' };
    const r = await makeMatchRig({ admission: sa });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await r.step(0);
    for (const p of [a, b]) {
      expect(p.of('notice').filter((n) => n.kind === 'queueLost')).toHaveLength(1);
      expect(r.service.busy(p.session)).toBe(false);
    }
  });

  it('a start that waits gets its position updates, then the admitted event; one that waited past the longest wait goes back to the queue with a notice', async () => {
    const sa = new ScriptedAdmission();
    sa.mode = 'wait';
    const r = await makeMatchRig({ admission: sa });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('queueStatus')?.queue.kind === 'capacity');
    const table = sa.requests[0]!.table;
    sa.push({ kind: 'position', table, position: 2, unitsAhead: 3, estimatedWaitMs: 60_000 });
    await r.step();
    expect(a.last('queueStatus')!.queue).toEqual({ kind: 'capacity', table, position: 2, unitsAhead: 3, estimatedWaitMs: 60_000 });
    sa.push({ kind: 'expired', table, retryAfterMs: 120_000 });
    await r.step();
    expect(a.of('notice').find((n) => n.kind === 'capacityTimeout')).toBeDefined();
    expect(r.service.owns(table)).toBe(false);
    // both are back in the queue at the front and matched again at once: a new table, waiting again; this time admission lets it in
    expect(sa.requests).toHaveLength(2);
    const second = sa.requests[1]!.table;
    expect(second).not.toBe(table);
    expect(r.service.owns(second)).toBe(true);
    sa.push({ kind: 'admitted', table: second });
    await r.step();
    await a.client.until(() => a.last('readyCheck') !== undefined);
    expect(a.last('table')!.table).toMatchObject({ table: second, status: 'readyCheck' });
    // an event for a table that is not a match of the service reaches nobody here (the tables layer's own events are its)
    sa.push({ kind: 'admitted', table: 'SOMEONE-ELSES' });
    await r.step();
    expect(rounds(a)).toBe(1);
  });

  it('an admission wait that ends because the server drains: the members are told queueLost, not sent back to wait', async () => {
    const sa = new ScriptedAdmission();
    sa.mode = 'wait';
    const r = await makeMatchRig({ admission: sa });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('table') !== undefined);
    sa.push({ kind: 'expired', table: sa.requests[0]!.table, retryAfterMs: 60_000, cause: 'draining' });
    await r.step();
    for (const p of [a, b]) expect(p.of('notice').filter((n) => n.kind === 'queueLost')).toHaveLength(1);
    expect(r.service.busy(a.session)).toBe(false);
  });
});

describe('M13-13 a start the runtime refuses', () => {
  it('admission is told (startFailed), the game row is voided, and the players, who all confirmed, are back at the front and matched again; the retry starts', async () => {
    const sa = new ScriptedAdmission();
    const r = await makeMatchRig({ admission: sa });
    r.matchRuntime.startResult = () => ({ ok: false, reason: 'failed', message: 'The game could not start on the server.' });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.of('notice').some((n) => n.kind === 'tableClosed'));
    const failed = sa.requests[0]!.table;
    expect(sa.releaseCauses).toEqual(['startFailed']);
    expect(sa.begins).toEqual([]);
    expect((await r.store.tableRow(failed))!.status).toBe('void');
    expect(r.gateway.tables.seatOf(a.session)).toBeNull();
    // nobody lost their place: the same two are matched again at once, with a new table, and this time the runtime starts it
    r.matchRuntime.startResult = null;
    await a.client.until(() => rounds(a) === 2);
    await b.client.until(() => rounds(b) === 2);
    expect(sa.requests).toHaveLength(2);
    expect(sa.requests[1]!.table).not.toBe(failed);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(sa.begins).toEqual([sa.requests[1]!.table]);
  });

  it('a store that cannot create the game row fails the start the same way: no row, the players are back in the queue', async () => {
    const r = await makeMatchRig();
    let fail = true;
    const create = r.store.createGame.bind(r.store);
    r.store.createGame = async (g) => {
      if (fail) throw new Error('disk full');
      return create(g);
    };
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.of('notice').some((n) => n.kind === 'tableClosed'));
    expect(r.matchRuntime.starts).toEqual([]);
    // the failed match's units are free; the two are back at the front and match again at once (a new ready check, a new reservation)
    await a.client.until(() => rounds(a) === 2);
    expect(r.capacity.size().reserved).toBe(1);
    expect(r.service.busy(a.session)).toBe(true);
    fail = false;
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(r.matchRuntime.starts).toHaveLength(1);
  });

  it('a drain that arrives while the game starts: the runtime refuses, the players get queueLost and are not queued', async () => {
    const r = await makeMatchRig();
    r.matchRuntime.startResult = () => ({ ok: false, reason: 'draining', message: 'The server is restarting soon; no new games start now.' });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.of('notice').some((n) => n.kind === 'queueLost'));
    expect(r.service.busy(a.session)).toBe(false);
    expect(r.service.busy(b.session)).toBe(false);
    expect(r.capacity.size().reserved).toBe(0);
  });
});

describe('M13-13 while the game starts', () => {
  it("the runtime's deliveries come after the seats' routes; a leave is refused with busy; the table views follow", async () => {
    const r = await makeMatchRig();
    let release!: () => void;
    r.matchRuntime.hold = new Promise<void>((res) => (release = res));
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await r.step(0);
    // starting: the match is the service's still, and it holds the session
    const table = a.last('table')!.table.table;
    expect(r.service.owns(table)).toBe(true);
    expect(r.service.busy(a.session)).toBe(true);
    expect(r.gateway.tables.seatOf(a.session)).toBeNull();
    r.clock.advance(5 * SEC);
    expect(await a.cmd({ t: 'unqueue' })).toMatchObject({ ok: false, error: { code: 'busy' } });
    // a delivery of the starting game is kept, not sent to anyone; one of another game is not the service's
    expect(r.service.intercept(table, [{ seat: 1, t: 'notice', json: '{"t":"notice","kind":"degraded","text":"kept"}' }])).toBe(true);
    expect(r.service.intercept('OTHER-GAME', [])).toBe(false);
    expect(a.of('notice').filter((n) => n.text === 'kept')).toEqual([]);
    release();
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    // after the routes: the kept delivery went out, then the start the runtime delivered inside its start (its own order), then the table view
    const types = a.messages().map((m) => (m.t === 'notice' ? `notice:${(m as { text: string }).text}` : m.t));
    expect(types.indexOf('notice:kept')).toBeGreaterThan(types.lastIndexOf('readyCheck'));
    expect(types.indexOf('notice:kept')).toBeLessThan(types.lastIndexOf('table'));
    expect(r.service.owns(table)).toBe(false);
    expect(r.gateway.tables.seatOf(a.session)).toMatchObject({ table, status: 'playing' });
  });

  it('a seat that dropped while the game started is told to the table once its routes exist', async () => {
    const r = await makeMatchRig();
    let release!: () => void;
    r.matchRuntime.hold = new Promise<void>((res) => (release = res));
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await r.step(0);
    await drop(b);
    release();
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    await settleAll(r);
    // the runtime started the game with both seats connected; Bob's drop is reported to the table (a 'disconnect' for seat 2)
    expect(r.matchRuntime.starts[0]!.connected).toEqual([1, 2]);
    expect(r.matchRuntime.inputs.filter((i) => i.input.t === 'disconnect').map((i) => (i.input as { seat: number }).seat)).toEqual([2]);
  });
});

describe('M13-13 connections', () => {
  it('a queued session that is not connected is not matched and keeps its place; back, it is told its status and matched', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    await enqueue(a);
    const token = a.token;
    await drop(a);
    await r.step();
    const c = await r.player('Carol');
    await enqueue(c);
    await r.step(10 * SEC);
    expect(c.of('readyCheck')).toEqual([]);
    expect(r.service.busy(a.session)).toBe(true);
    const a2 = Browser.connect(r, { peer: '10.7.7.7' });
    r.connections.add(a2);
    await a2.hello('Alice', token);
    expect(a2.session).toBe(a.session);
    await r.step();
    // Alice is told where she stands again, and the match forms with Carol
    await a2.client.until(() => a2.last('readyCheck') !== undefined);
    expect(a2.of('queueStatus').length).toBeGreaterThanOrEqual(1);
    await c.client.until(() => c.last('readyCheck') !== undefined);
  });

  it('a queued session gone for good (30 s) leaves the queue', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    await enqueue(a);
    await drop(a);
    await r.step(); // noticed
    await r.step(29 * SEC);
    expect(r.service.busy(a.session)).toBe(true);
    await r.step(2 * SEC);
    expect(r.service.busy(a.session)).toBe(false);
  });

  it('a match member who drops during the ready check fails it after 5 s as the leaver; the other goes back to the front; a member who is back in time is told the ready check again', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(b);
    const token = a.token;
    await drop(a);
    await r.step(); // Alice's drop is noticed
    const a2 = Browser.connect(r, { peer: '10.7.7.8' });
    r.connections.add(a2);
    await a2.hello('Alice', token);
    await r.step(2 * SEC);
    // back within the grace: her table and the ready check are sent again, and she may confirm
    expect(a2.last('table')!.table).toMatchObject({ status: 'readyCheck', you: 1 });
    expect(a2.last('readyCheck')!.players).toEqual([{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: true }]);
    await drop(a2);
    await r.step();
    await r.step(6 * SEC);
    await b.client.until(() => b.of('notice').some((n) => n.kind === 'readyCheckFailed'));
    expect(b.last('notice')!.text).toMatch(/player left/);
    expect(r.service.busy(b.session)).toBe(true);
    expect(r.service.busy(a.session)).toBe(false);
  });
});

describe('M13-13 no immediate rematch, across real games', () => {
  it('two sessions that just played each other are not matched again while someone else fits; after 60 s of waiting they may be', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    // both leave the game (a concession): they may queue again
    a.client.send({ t: 'leave', id: 90 });
    b.client.send({ t: 'leave', id: 90 });
    await r.step();
    expect(r.gateway.tables.busyIn(a.session)).toBeNull();
    r.clock.advance(5 * SEC);
    await enqueue(a);
    await enqueue(b);
    await r.step(10 * SEC);
    expect(rounds(a)).toBe(1); // no second ready check: the pair is a recent one
    const c = await r.player('Carol');
    await enqueue(c);
    await r.step();
    await a.client.until(() => rounds(a) === 2);
    expect(c.last('readyCheck')).toBeDefined();
    expect(rounds(b)).toBe(1);
    // Bob waits on; with nobody else, once he has waited more than 60 s the pair may meet again (here Alice is in a ready check, so Carol and Alice go first)
    expect(r.service.busy(b.session)).toBe(true);
  });

  it('with nobody else to play, the recent pair is matched once one has waited more than 60 s', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    a.client.send({ t: 'leave', id: 90 });
    b.client.send({ t: 'leave', id: 90 });
    await r.step();
    r.clock.advance(5 * SEC);
    await enqueue(a);
    await enqueue(b);
    await r.step(30 * SEC);
    expect(rounds(a)).toBe(1);
    await r.step(31 * SEC);
    await r.step(5 * SEC);
    expect(rounds(a)).toBe(2);
  });
});

describe('M13-13 gone and drain as the gateway calls them', () => {
  it('gone: a queued session leaves; in a ready check it fails the check as the leaver; while the start waits for capacity the others go back', async () => {
    const r = await makeMatchRig({ capacityUnits: 1 });
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    expect(r.service.busy(a.session)).toBe(true);
    r.service.gone(a.session);
    expect(r.service.busy(a.session)).toBe(false);
    // in a ready check
    r.clock.advance(5 * SEC);
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('readyCheck') !== undefined);
    r.service.gone(b.session);
    await a.client.until(() => a.of('notice').some((n) => n.kind === 'readyCheckFailed'));
    expect(r.service.busy(b.session)).toBe(false);
    expect(r.service.busy(a.session)).toBe(true);
    expect(r.capacity.size().reserved).toBe(0);
    // waiting for capacity
    r.signals.s.runningUnits = 1;
    const c = await r.player('Carol');
    await enqueue(c);
    await a.client.until(() => a.last('table')?.table.status === 'waitingCapacity');
    expect(r.capacity.size().starts).toBe(1);
    r.service.gone(c.session);
    expect(r.capacity.size().starts).toBe(0);
    expect(r.service.busy(c.session)).toBe(false);
    expect(r.service.busy(a.session)).toBe(true);
    // a session the service does not know, or one whose game has started: nothing happens
    r.service.gone('NOBODY');
  });

  it('drain called directly: the matcher is drained and every queued session gets one queueLost, once', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b, { format: 'pauper' });
    r.service.drain();
    r.service.drain();
    await settleAll(r);
    for (const p of [a, b]) expect(p.of('notice').filter((n) => n.kind === 'queueLost')).toHaveLength(1);
    expect(r.service.busy(a.session)).toBe(false);
  });
});

async function settleAll(r: { step(ms?: number): Promise<void> }): Promise<void> {
  await r.step(0);
}

describe('M13-13 the matched tables and the tables layer share admission', () => {
  it('each layer hears the events of its own tables: the head of the capacity queue (a listed table) is admitted first, then the match, once the table has begun', async () => {
    const r = await makeMatchRig({ capacityUnits: 1 });
    r.signals.s.runningUnits = 1;
    const carol = await r.player('Carol');
    const dave = await r.player('Dave');
    const { table } = await createTable(carol);
    await dave.cmd({ t: 'join', table, deck: DECK });
    await carol.client.until(() => carol.last('table')?.table.status === 'waitingCapacity');
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('table') !== undefined);
    expect(a.last('queueStatus')!.queue).toMatchObject({ kind: 'capacity', position: 2, unitsAhead: 1 });
    expect(r.capacity.size().starts).toBe(2);
    // one unit frees: the table at the head is admitted (the tables layer hears it), the match behind it is not
    r.signals.s.runningUnits = 0;
    await r.step();
    await carol.client.until(() => carol.last('readyCheck') !== undefined);
    expect(r.gateway.tables.counts().readyCheck).toBe(1);
    expect(a.of('readyCheck')).toEqual([]);
    // the table's players confirm and its game begins; the units it reserved are the runtime's now, which this fake does not count: the match is admitted at once
    await confirm(carol);
    await confirm(dave);
    await carol.client.until(() => carol.last('table')?.table.status === 'playing');
    await a.client.until(() => a.last('readyCheck') !== undefined);
    expect(a.last('table')!.table.status).toBe('readyCheck');
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(r.matchRuntime.starts.map((s) => s.source)).toEqual(['listed', 'matched']);
    expect(counted(r.metrics, METRICS.readyCheckFailures, { kind: 'match' })).toBe(0);
  });

  it('a finished table game frees its units through the tables layer as ever (a match is not in the way), and a started match game does the same', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    const game = a.last('table')!.table.table;
    const freed: number[] = [];
    const inner = r.routed.freed.bind(r.routed);
    r.routed.freed = (units, now) => (freed.push(units), inner(units, now));
    // the runtime says the game ended: the tables layer (which adopted the game) frees its units
    r.gateway.events.ended!({ game, end: { kind: 'win' } as never, record: null, status: 'finished', units: 1 });
    expect(freed).toEqual([1]);
    expect(r.gateway.tables.counts().over).toBe(1);
    // and another unrelated listed table still starts as before
    const { a: c, b: d } = await startTable(r);
    expect(c.last('table')!.table.status).toBe('playing');
    expect(d.session).not.toBe('');
  });
});
