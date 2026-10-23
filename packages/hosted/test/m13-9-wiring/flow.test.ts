/**
 * M13-13 part B: matchmaking wired into the gateway (design 4.5, 4.6): two queued guests are matched, admitted, confirm the ready check and their
 * `matched` game starts; a missed ready check sends the confirmer back to the front; leaving; a drain. The real gateway on the in-process transport,
 * the real `MatchmakingService` on `FifoMatcher`, the real `CapacityAdmission` on fake signals, a fake clock.
 */
import { describe, expect, it } from 'vitest';
import { METRICS } from '../../src/obs';
import { counted } from '../m13-6/harness';
import { confirm, enqueue, makeMatchRig, rounds } from './rig';

const SEC = 1_000;

describe('M13-13 two queued guests are matched, admitted, ready and started', () => {
  it('queue, match, ready check, start: every message in its order, the game started as a matched table with both seats', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');

    expect(await enqueue(a)).toMatchObject({ ok: true });
    // queued: the status first (nobody else waits), the reply before anything else of the match
    expect(a.last('queueStatus')!.queue).toEqual({ kind: 'match', format: 'casual', size: 2, waiting: 1, estimatedWaitMs: null });
    expect(r.service.busy(a.session)).toBe(true);
    expect(a.of('readyCheck')).toEqual([]);

    expect(await enqueue(b)).toMatchObject({ ok: true });
    await a.client.until(() => a.last('readyCheck') !== undefined);
    await b.client.until(() => b.last('readyCheck') !== undefined);

    // the match is a table of source 'matched' in its ready check, seen from each seat
    const tableA = a.last('table')!.table;
    const tableB = b.last('table')!.table;
    expect(tableA).toMatchObject({ source: 'matched', status: 'readyCheck', format: 'casual', title: 'Quick match', locked: false, creator: null, you: 1 });
    expect(tableB).toMatchObject({ table: tableA.table, you: 2 });
    expect(tableA.seats.map((s) => [s.seat, s.name])).toEqual([[1, 'Alice'], [2, 'Bob']]);
    const rcA = a.last('readyCheck')!;
    expect(rcA.deadlineAt).toBe(r.clock.now() + 15 * SEC);
    expect(rcA.players).toEqual([{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: false }]);
    expect(b.last('readyCheck')!.start).toBe(rcA.start);
    // admission holds the match's units while its ready check runs
    expect(r.capacity.size().reserved).toBe(1);

    // Alice confirms: both see it; nothing starts yet
    expect(await confirm(a)).toMatchObject({ ok: true, table: tableA.table });
    await b.client.until(() => b.last('readyCheck')!.players[0]!.ready);
    expect(r.matchRuntime.starts).toEqual([]);
    expect(await confirm(b)).toMatchObject({ ok: true });
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    await b.client.until(() => b.last('table')!.table.status === 'playing');

    // the game: created as a matched table, started on the runtime with both seats, their decks and clocks
    expect(r.matchRuntime.starts).toHaveLength(1);
    const start = r.matchRuntime.starts[0]!;
    expect(start).toMatchObject({ game: tableA.table, format: 'casual', source: 'matched', connected: [1, 2] });
    expect(start.seats.map((s) => [s.seat, s.name, s.session])).toEqual([[1, 'Alice', a.session], [2, 'Bob', b.session]]);
    expect(start.clock).toEqual({ bankMs: 900_000, delayMs: 5_000, dropMs: 300_000 });
    const row = (await r.store.tableRow(tableA.table))!;
    expect(row).toMatchObject({ source: 'matched', status: 'running', title: 'Quick match', seats: 2, seating: [1, 2] });
    expect(row.seatRows.map((s) => [s.seat, s.session, s.name])).toEqual([[1, a.session, 'Alice'], [2, b.session, 'Bob']]);
    // the units pass from admission's reservation to the runtime
    expect(r.capacity.size().reserved).toBe(0);
    expect(r.capacity.stats()).toMatchObject({ admitted: 1, begun: 1 });

    // the seats have their routes in the tables layer now, and the service holds nothing
    expect(r.gateway.tables.seatOf(a.session)).toEqual({ table: tableA.table, seat: 1, status: 'playing', left: false });
    expect(r.gateway.tables.seatOf(b.session)).toMatchObject({ seat: 2, status: 'playing' });
    expect(r.service.busy(a.session)).toBe(false);
    expect(r.service.owns(tableA.table)).toBe(false);
    expect(r.service.held).toEqual({ sessions: 0, matches: 0, early: 0 });
    // what the runtime delivered inside its start (before the routes existed) reached each seat, once, after the ready check
    expect(a.of('start')).toHaveLength(1);
    expect(a.of('start')[0]).toEqual({ t: 'start', table: tableA.table, players: [{ id: 'p1', name: 'Alice', seat: 1 }, { id: 'p2', name: 'Bob', seat: 2 }] });
    expect(b.of('start')).toHaveLength(1);
    expect(a.messages().map((m) => m.t).indexOf('start')).toBeGreaterThan(a.messages().map((m) => m.t).lastIndexOf('readyCheck'));
    // a player at a game cannot queue again (one game at a time; the gateway's queue bucket gives one command per 5 s)
    r.clock.advance(5 * SEC);
    expect(await enqueue(a)).toMatchObject({ ok: false, error: { code: 'busy' } });
  });

  it('the queued session sees the others waiting (rounded) and no one is matched across formats', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    const c = await r.player('Carol');
    await enqueue(a);
    await enqueue(b, { format: 'pauper' });
    await enqueue(c, { format: 'pauper' });
    await r.step();
    // Bob and Carol queued for the same format: matched; Alice waits alone for hers
    expect(b.last('readyCheck')).toBeDefined();
    expect(a.of('readyCheck')).toEqual([]);
    expect(r.service.busy(a.session)).toBe(true);
    // the status repeats at most every 5 s and only when it changed
    const before = a.of('queueStatus').length;
    await r.step(4 * SEC);
    expect(a.of('queueStatus').length).toBe(before);
    const d = await r.player('Dave');
    await enqueue(d);
    await a.client.until(() => a.last('readyCheck') !== undefined);
  });

  it('a start that needs capacity waits as a match: its seats see the table waiting and their place, and the ready check follows when capacity frees', async () => {
    const r = await makeMatchRig({ capacityUnits: 1 });
    r.signals.s.runningUnits = 1;
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('table') !== undefined);
    expect(a.last('table')!.table).toMatchObject({ status: 'waitingCapacity', source: 'matched' });
    expect(a.last('queueStatus')!.queue).toMatchObject({ kind: 'capacity', table: a.last('table')!.table.table, position: 1, unitsAhead: 0 });
    expect(a.of('readyCheck')).toEqual([]);
    expect(r.service.busy(a.session)).toBe(true);
    expect(r.capacity.isWaiting(a.last('table')!.table.table)).toBe(true);
    // capacity frees: the next admission step admits the head and the service (not the tables layer) hears it
    r.signals.s.runningUnits = 0;
    await r.step();
    await a.client.until(() => a.last('readyCheck') !== undefined);
    expect(a.last('table')!.table.status).toBe('readyCheck');
    await confirm(a);
    await confirm(b);
    await a.client.until(() => a.last('table')!.table.status === 'playing');
    expect(r.matchRuntime.starts).toHaveLength(1);
  });
});

describe('M13-13 a missed ready check', () => {
  it('the confirmer goes back to the front of the queue with the waiting time kept; the one who did not confirm is out and told; admission counts the failure once', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    r.clock.advance(3 * SEC);
    await enqueue(b);
    await a.client.until(() => a.last('readyCheck') !== undefined);
    await confirm(a);
    const failedTable = a.last('table')!.table.table;
    // the 15 seconds pass
    await r.step(14 * SEC);
    expect(a.of('notice').filter((n) => n.kind === 'readyCheckFailed')).toEqual([]);
    await r.step(2 * SEC);
    const noticeA = a.of('notice').find((n) => n.kind === 'readyCheckFailed')!;
    expect(noticeA.text).toMatch(/back in the queue/);
    expect(b.of('notice').find((n) => n.kind === 'readyCheckFailed')!.text).toMatch(/left the queue/);
    // Alice waits again; Bob does not
    expect(r.service.busy(a.session)).toBe(true);
    expect(r.service.busy(b.session)).toBe(false);
    // the service holds Alice's deck only: Bob's is let go with his place
    expect(r.service.held).toEqual({ sessions: 1, matches: 0, early: 0 });
    expect(a.last('queueStatus')!.queue).toMatchObject({ kind: 'match', waiting: 1 });
    // admission freed the reserved units and counted the failure (it alone owns the metric)
    expect(r.capacity.size().reserved).toBe(0);
    expect(counted(r.metrics, METRICS.readyCheckFailures, { kind: 'match' })).toBe(1);
    expect(r.matchRuntime.starts).toEqual([]);
    expect(await r.store.tableRow(failedTable)).toBeNull();
    // Carol arrives: Alice is matched with her at once, and Alice's wait counts from her first entry
    const c = await r.player('Carol');
    await enqueue(c);
    await a.client.until(() => rounds(a) === 2);
    await c.client.until(() => c.last('readyCheck') !== undefined);
    const waits = r.metrics.observations.get('openmtg_hosted_match_wait_seconds{format="casual",size="2"}')!;
    // the first match: Alice waited 3 s, Bob 0; the second: Alice 3 + 16 s since she first queued, Carol 0
    expect(waits.map((x) => Math.round(x))).toEqual([3, 0, 19, 0]);
  });

  it('two missed ready checks within ten minutes pause queuing for two minutes (limitReached with the wait)', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    for (let i = 0; i < 2; i++) {
      const b = await r.player(`Partner${i}`);
      await enqueue(a);
      await enqueue(b);
      await a.client.until(() => rounds(a) === i + 1);
      await confirm(b);
      await r.step(16 * SEC); // Alice never confirms
      expect(r.service.busy(a.session)).toBe(false);
      // the partner confirmed: back at the front; get it out of the way for the next round
      await b.cmd({ t: 'unqueue' });
    }
    const third = await enqueue(a);
    expect(third).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    if (third.ok) throw new Error('unreachable');
    expect(third.error.retryAfterMs).toBeGreaterThan(100 * SEC);
    expect(third.error.retryAfterMs).toBeLessThanOrEqual(120 * SEC);
    await r.step(121 * SEC);
    expect(await enqueue(a)).toMatchObject({ ok: true });
  });
});

describe('M13-13 leaving', () => {
  it('unqueue leaves the queue (and is ok when there is nothing to leave)', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    await enqueue(a);
    expect(r.service.busy(a.session)).toBe(true);
    r.clock.advance(5 * SEC);
    expect(await a.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    expect(r.service.busy(a.session)).toBe(false);
    expect(r.service.held).toEqual({ sessions: 0, matches: 0, early: 0 });
    r.clock.advance(5 * SEC);
    expect(await a.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    const b = await r.player('Bob');
    await enqueue(b);
    await r.step(10 * SEC);
    // Alice left: Bob is not matched with her
    expect(b.of('readyCheck')).toEqual([]);
  });

  it('leaving during the ready check fails it at once: the leaver is out (no miss), the other goes back to the front', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('readyCheck') !== undefined);
    r.clock.advance(5 * SEC);
    expect(await a.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    await b.client.until(() => b.of('notice').some((n) => n.kind === 'readyCheckFailed'));
    expect(b.of('notice').find((n) => n.kind === 'readyCheckFailed')!.text).toMatch(/player left/);
    expect(r.service.busy(a.session)).toBe(false);
    expect(r.service.busy(b.session)).toBe(true);
    expect(r.capacity.size().reserved).toBe(0);
    // a seat that left is not a ready check that ran out: admission counts no failure
    expect(counted(r.metrics, METRICS.readyCheckFailures, { kind: 'match' })).toBe(0);
    // no miss for the leaver: she can queue at once, and is matched with Bob
    r.clock.advance(5 * SEC);
    expect(await enqueue(a)).toMatchObject({ ok: true });
    await b.client.until(() => rounds(b) === 2);
  });

  it('leaving while the start waits for capacity: the other goes back to the front, admission forgets the start', async () => {
    const r = await makeMatchRig({ capacityUnits: 1 });
    r.signals.s.runningUnits = 1;
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    await enqueue(a);
    await enqueue(b);
    await a.client.until(() => a.last('table') !== undefined);
    expect(r.capacity.size().starts).toBe(1);
    r.clock.advance(5 * SEC);
    expect(await a.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    await b.client.until(() => b.of('notice').some((n) => n.kind === 'tableClosed'));
    expect(r.capacity.size().starts).toBe(0);
    expect(r.service.busy(a.session)).toBe(false);
    expect(r.service.busy(b.session)).toBe(true);
    // no ready check was shown, so no miss for anyone
    expect(counted(r.metrics, METRICS.readyCheckFailures, { kind: 'match' })).toBe(0);
  });
});

describe('M13-13 a drain', () => {
  it('queued sessions and matches that have not started are told queueLost; no one queues after it', async () => {
    const r = await makeMatchRig();
    const a = await r.player('Alice');
    const b = await r.player('Bob');
    const c = await r.player('Carol');
    await enqueue(a, { format: 'pauper' });
    await enqueue(b);
    await enqueue(c);
    await b.client.until(() => b.last('readyCheck') !== undefined); // Bob and Carol are in a ready check, Alice waits alone
    r.gateway.drain();
    r.service.drain();
    await r.step();
    for (const p of [a, b, c]) {
      const lost = p.of('notice').filter((n) => n.kind === 'queueLost');
      expect(lost, p.session).toHaveLength(1);
      expect(r.service.busy(p.session)).toBe(false);
    }
    expect(r.capacity.size().reserved).toBe(0);
    expect(r.service.held).toEqual({ sessions: 0, matches: 0, early: 0 });
    const d = await r.player('Dave');
    expect(await enqueue(d)).toMatchObject({ ok: false, error: { code: 'draining' } });
    // the gateway's own drain is enough: the service notices it on its next tick
    const r2 = await makeMatchRig();
    const e = await r2.player('Eve');
    await enqueue(e);
    r2.gateway.drain();
    await r2.step();
    expect(e.of('notice').filter((n) => n.kind === 'queueLost')).toHaveLength(1);
  });
});
