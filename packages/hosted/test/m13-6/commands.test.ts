/**
 * M13-6: the gateway's commands that reach other packages' seams (design 3.4; the lobby, matchmaking and report services are M13-8, M13-9 and M13-13's,
 * here fakes), the match history, failures of the store and of a hook (nothing a client sends throws out of a handler: audit C4), the capacity shown in
 * `welcome`, and a slow connection (design 3.5) as the gateway sees it: behind mode, the catch-up with `sync` and no id, the hard cap.
 */
import { describe, expect, it } from 'vitest';
import { CLOSE_REFUSED, type LobbyFilter, type LobbyListing, type LobbyUpdateMessage } from '../../src/api';
import type { GatewayHooks, LobbyService, MatchService, ReportService } from '../../src/gateway/hooks';
import { METRICS } from '../../src/obs';
import { MemoryStore } from '../../src/store';
import type { TableReply } from '../../src/tables/tables';
import { newGame, record, startRow } from '../m13-4/fixtures';
import { Browser, counted, createTable, guest, makeGateway, ScriptedAdmission, settle, startTable, TEST_DECK } from './harness';

const listing = (table: string, filled = 1): LobbyListing => ({
  table, title: `Table ${table}`, format: 'casual', variant: null, seats: 2, filled, locked: false, clock: { bankMs: 900_000, delayMs: 5_000, dropMs: 300_000 },
  creator: 'Alice', ranked: false, createdAt: 0,
});

describe('M13-6 the lobby, matchmaking and report seams', () => {
  it('browse and watchLobby go to the lobby service with the connection, its address key and a push; updates reach only that connection; closing ends the watch', async () => {
    const calls: string[] = [];
    let push: ((m: LobbyUpdateMessage) => void) | null = null;
    const lobby: LobbyService = {
      browse: (m, now) => (calls.push(`browse:${JSON.stringify(m.filter)}:${m.sort}:${m.page}:${now}`), { tables: [listing('T1')], total: 7 }),
      watch: (conn, key, filter, p) => {
        calls.push(`watch:${conn}:${key}:${JSON.stringify(filter)}`);
        push = p;
        return filter?.format === 'vintage' ? { code: 'limitReached', message: 'Too many watchers.' } : null;
      },
      closed: (conn) => calls.push(`closed:${conn}`),
    };
    const t = makeGateway({ hooks: { lobby } });
    const a = await guest(t, 'Alice', { peer: '203.0.113.80' });
    const b = await guest(t, 'Bob');
    const filter: LobbyFilter = { format: 'casual', open: true };
    expect(await a.cmd({ t: 'browse', filter, sort: 'filled', page: 2 })).toEqual({ t: 'reply', id: 1, ok: true, tables: [listing('T1')], total: 7 });
    expect(calls).toEqual([`browse:${JSON.stringify(filter)}:filled:2:${t.clock.now()}`]);
    expect(await a.cmd({ t: 'watchLobby', filter })).toMatchObject({ ok: true });
    expect(calls.at(-1)).toBe(`watch:1:4:203.0.113.80:${JSON.stringify(filter)}`);
    push!({ t: 'lobbyUpdate', added: [listing('T2')], changed: [], removed: [] });
    await settle(3);
    expect(a.last('lobbyUpdate')).toEqual({ t: 'lobbyUpdate', added: [listing('T2')], changed: [], removed: [] });
    expect(b.of('lobbyUpdate')).toEqual([]);
    // a refusal of the service is the reply (and a strike)
    t.clock.advance(5_000);
    expect(await a.cmd({ t: 'watchLobby', filter: { format: 'vintage' } })).toMatchObject({ ok: false, error: { code: 'limitReached' } });
    expect(counted(t.metrics, METRICS.strikes)).toBe(1);
    a.client.close();
    await settle(3);
    expect(calls.at(-1)).toBe('closed:1');
  });

  it('queue, unqueue and ready go to the match service (ready: the match service first, then the table\'s own ready check); a seated session may not queue', async () => {
    const log: string[] = [];
    let readyAnswer: TableReply | null = { ok: true };
    const match: MatchService = {
      queue: async (who, m) => (log.push(`queue:${who.name}:${m.format}:${m.size}`), { ok: true }),
      unqueue: async (who) => (log.push(`unqueue:${who.name}`), { ok: true }),
      ready: (who, start) => (log.push(`ready:${who.name}:${start}`), readyAnswer),
      busy: () => false,
    };
    const t = makeGateway({ hooks: { match } });
    const a = await guest(t, 'Alice');
    expect(await a.cmd({ t: 'queue', format: 'casual', size: 2, deck: TEST_DECK })).toMatchObject({ ok: true });
    t.clock.advance(5_000);
    expect(await a.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
    expect(await a.cmd({ t: 'ready', start: 'abc123' })).toMatchObject({ ok: true });
    expect(log).toEqual(['queue:Alice:casual:2', 'unqueue:Alice', 'ready:Alice:abc123']);
    // not one of the match service's ready checks: the table's own (none here)
    readyAnswer = null;
    expect(await a.cmd({ t: 'ready', start: 'abc123' })).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
    // a seated session may not queue
    const b = await guest(t, 'Bob');
    await createTable(b);
    t.clock.advance(5_000);
    expect(await b.cmd({ t: 'queue', format: 'casual', size: 2, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy' } });
    expect(log).toHaveLength(4);
  });

  it('report goes to the report service with who sent it and where they sit (a game id and seat), or nowhere', async () => {
    const seen: { who: string; kind: string; at: { table: string; seat: number } | null }[] = [];
    const reports: ReportService = { report: async (who, m, at) => (seen.push({ who: who.name, kind: m.kind, at }), { ok: true }) };
    const t = makeGateway({ hooks: { reports } });
    const { a, table } = await startTable(t);
    const r = await a.cmd({ t: 'report', kind: 'bug', text: 'the stack looks wrong' });
    expect(r).toMatchObject({ ok: true });
    const c = await guest(t, 'Carol');
    expect(await c.cmd({ t: 'report', kind: 'title', text: 'a bad title', table })).toMatchObject({ ok: true });
    expect(seen).toEqual([{ who: 'Alice', kind: 'bug', at: { table, seat: 1 } }, { who: 'Carol', kind: 'title', at: null }]);
  });

  it('history: this session\'s games, newest first, as public projections (no sessions, no fingerprints)', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    expect(await a.cmd({ t: 'history' })).toMatchObject({ ok: true, history: [] });
    // two finished games the store holds, one of them with Alice
    const store = t.store;
    for (const [id, minutes] of [['01GAMEAAAAAAAAAAAAAAAAAAAA', 1], ['01GAMEBBBBBBBBBBBBBBBBBBBB', 2]] as const) {
      await store.createGame({ ...newGame(id), seatRows: [{ ...newGame(id).seatRows[0]!, session: a.session }, { ...newGame(id).seatRows[1]!, session: 'someone-else', name: 'Other' }] });
      await store.startGame(id, startRow());
      await store.appendRecords([record(id, 1)]);
      const placements = [
        { seat: 1, name: 'Alice', place: 1, loss: null, lossRule: null, outTurn: null, player: 'p1', session: a.session, account: null, deckHash: 'a'.repeat(64), outOrder: null, timeUsedMs: 5, timeouts: 0, disconnectedMs: 0 },
        { seat: 2, name: 'Other', place: 2, loss: 'life', lossRule: 'CR 104.3b', outTurn: 5, player: 'p2', session: 'someone-else', account: null, deckHash: 'b'.repeat(64), outOrder: 1, timeUsedMs: 9, timeouts: 0, disconnectedMs: 0 },
      ];
      await store.finishGame(id, {
        game: id, format: 'standard', variant: null, seats: 2, source: 'listed', ranked: false, outcome: 'win', reason: 'life', turns: 5, actions: 1,
        startedAt: new Date(t.clock.now() - minutes * 60_000).toISOString(), endedAt: new Date(t.clock.now() - minutes * 30_000).toISOString(), engineBuild: 'b',
        placements: placements as never,
      });
    }
    t.clock.advance(5_000);
    const r = await a.cmd({ t: 'history' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.history!.map((h) => h.game)).toEqual(['01GAMEAAAAAAAAAAAAAAAAAAAA', '01GAMEBBBBBBBBBBBBBBBBBBBB']);
    expect(r.history![0]).toMatchObject({ format: 'standard', outcome: 'win', reason: 'life', turns: 5, ranked: false, you: { seat: 1, place: 1, loss: null } });
    const text = JSON.stringify(r.history);
    for (const secret of ['someone-else', a.session, 'a'.repeat(64), 'b'.repeat(64), 'deckHash', 'timeUsedMs', 'engineBuild']) expect(text, secret).not.toContain(secret);
  });
});

describe('M13-6 the match service hears of sessions that are gone for good, and of the drain (review 4)', () => {
  function service() {
    const log: string[] = [];
    const match: MatchService = {
      queue: async () => ({ ok: true }), unqueue: async () => null, ready: () => null, busy: () => false,
      gone: (session) => log.push(`gone:${session}`),
      drain: () => log.push('drain'),
    };
    return { log, match };
  }

  it('a session with no connection for 5 minutes is gone (once); a drop that ends sooner, or a socket that is replaced, is not', async () => {
    const { log, match } = service();
    const t = makeGateway({ hooks: { match } });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    a.client.close();
    await settle(3);
    t.clock.advance(299_999);
    b.client.pong();
    c.client.pong();
    t.gateway.tick();
    expect(log).toEqual([]);
    // Bob drops at +4:59.999 and is back at +5:00; Carol's socket is replaced by a newer one (never without a connection)
    b.client.close();
    await settle(3);
    const b2 = await guest(t, 'Bob', {}, b.token);
    const c2 = await guest(t, 'Carol', {}, c.token);
    t.clock.advance(1);
    t.gateway.tick();
    expect(log).toEqual([`gone:${a.session}`]);
    // Bob and Carol are connected, so they are not gone however long that lasts (their sockets stay alive: pongs); Alice is reported once
    expect(c.client.closed).toMatchObject({ code: 4001 });
    for (let i = 0; i < 20; i++) {
      t.clock.advance(30_000);
      b2.client.pong();
      c2.client.pong();
      t.gateway.tick();
    }
    expect(log).toEqual([`gone:${a.session}`]);
  });

  it('the time counts from the last drop: a session that comes back and drops again is gone 5 minutes after that', async () => {
    const { log, match } = service();
    const t = makeGateway({ hooks: { match } });
    const a = await guest(t, 'Alice');
    a.client.close();
    await settle(3);
    t.clock.advance(4 * 60_000);
    const a2 = await guest(t, 'Alice', {}, a.token);
    t.clock.advance(60_000);
    a2.client.pong();
    a2.client.close();
    await settle(3);
    t.clock.advance(299_000);
    t.gateway.tick();
    expect(log).toEqual([]);
    t.clock.advance(1_000);
    t.gateway.tick();
    expect(log).toEqual([`gone:${a.session}`]);
  });

  it('a silent connection that the gateway closes counts as a drop too', async () => {
    const { log, match } = service();
    const t = makeGateway({ hooks: { match } });
    const a = await guest(t, 'Alice');
    t.clock.advance(45_000);
    t.gateway.tick();
    expect(a.client.closed).not.toBeNull();
    t.clock.advance(299_000);
    t.gateway.tick();
    expect(log).toEqual([]);
    t.clock.advance(1_000);
    t.gateway.tick();
    expect(log).toEqual([`gone:${a.session}`]);
  });

  it('the drain of the gateway tells the match service once; a service without these methods is left alone', async () => {
    const { log, match } = service();
    const t = makeGateway({ hooks: { match } });
    t.gateway.drain();
    t.gateway.drain();
    expect(log).toEqual(['drain']);
    const bare: MatchService = { queue: async () => ({ ok: true }), unqueue: async () => null, ready: () => null, busy: () => false };
    const u = makeGateway({ hooks: { match: bare } });
    const a = await guest(u, 'Alice');
    a.client.close();
    await settle(3);
    u.clock.advance(10 * 60_000);
    u.gateway.tick();
    u.gateway.drain();
    expect(u.gateway.draining).toBe(true);
  });
});

describe('M13-6 failures stay with their connection or command (audit C4: nothing a client sends throws out of a handler)', () => {
  it('a service that throws closes that connection only (1011); the others go on', async () => {
    const hooks: GatewayHooks = {
      lobby: { browse: () => { throw new Error('the lobby index fell over'); }, watch: () => null, closed: () => undefined },
      match: { queue: async () => { throw new Error('the matcher fell over'); }, unqueue: async () => null, ready: () => null, busy: () => false },
    };
    const t = makeGateway({ hooks });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    const c = await guest(t, 'Carol');
    a.client.send({ t: 'browse', id: 1, filter: {}, sort: 'newest', page: 0 });
    await a.client.until(() => a.client.closed !== null);
    expect(a.client.closed).toMatchObject({ code: 1011 });
    c.client.send({ t: 'queue', id: 1, format: 'casual', size: 2, deck: TEST_DECK });
    await c.client.until(() => c.client.closed !== null);
    expect(c.client.closed).toMatchObject({ code: 1011 });
    expect(t.logger.entries().filter((e) => e['event'] === 'connectionError')).toHaveLength(2);
    expect(t.logger.lines.join('\n')).not.toContain('fell over'); // the error's name, not its text
    expect(b.client.closed).toBeNull();
    expect(await b.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(t.gateway.connections).toBe(1);
  });

  it('a store that fails: no session (the hello is refused), no table (busy), no seat (busy); nothing is left half made', async () => {
    const ctl = { fail: null as string | null };
    const store = new MemoryStore({ fault: (op) => { if (op === ctl.fail) throw new Error('disk full'); } });
    const t = makeGateway({ store });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    ctl.fail = 'putGame';
    expect(await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy', message: 'The server could not save the table; try again.' } });
    expect(t.gateway.tables.counts()).toMatchObject({ lobby: 0 });
    expect(t.gateway.tables.seatOf(a.session)).toBeNull();
    ctl.fail = null;
    t.clock.advance(10_000);
    const { table } = await createTable(a);
    // the seat of a joiner is reverted when it cannot be saved
    ctl.fail = 'putGame';
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'busy', message: 'The server could not save your seat; try again.' } });
    expect(t.gateway.tables.seatOf(b.session)).toBeNull();
    expect(a.last('table')!.table.seats[1]!.name).toBeNull();
    ctl.fail = null;
    t.clock.advance(1_000);
    expect(await b.cmd({ t: 'join', table, deck: TEST_DECK })).toMatchObject({ ok: true });
    // a hello that cannot save its new session is refused, not half made
    ctl.fail = 'putSession';
    const c = Browser.connect(t, { peer: '203.0.113.90' });
    c.client.send({ t: 'hello', protocol: 1, name: 'Carol' });
    await c.client.until(() => c.client.closed !== null);
    expect(c.client.closed).toMatchObject({ code: CLOSE_REFUSED });
    expect(c.of('bye')[0]!.reason).toBe('The server could not start a session; try again shortly.');
    expect(c.of('welcome')).toEqual([]);
  });
});

describe('M13-6 a table the runtime no longer has (it was unloaded, voided or quarantined)', () => {
  it('act, vote, sync and chat are answered noTable; leave and the connection events do not fail', async () => {
    const t = makeGateway();
    const { a, table } = await startTable(t);
    t.runtime.games.delete(table);
    const seen = a.of('reply').length;
    a.client.send({ t: 'act', id: 100, seq: 0, action: { type: 'pass', player: 'p1' } });
    a.client.send({ t: 'vote', id: 101, proposal: 1, accept: true });
    a.client.send({ t: 'sync', id: 102 });
    a.client.send({ t: 'chat', id: 103, text: 'anyone there' });
    await settle(5);
    expect(a.of('reply').slice(seen).map((r) => [r.id, r.ok ? 'ok' : r.error.code])).toEqual([[100, 'noTable'], [101, 'noTable'], [102, 'noTable'], [103, 'noTable']]);
    expect(a.client.closed).toBeNull();
    // leaving a table that is gone is a plain ok, and the seat is free for another table
    expect(await a.cmd({ t: 'leave' })).toMatchObject({ ok: true });
    expect(t.gateway.tables.busyIn(a.session)).toBeNull();
    // a drop and a return of a seat at such a table change nothing
    a.client.close();
    await settle(3);
    expect((await guest(t, 'Alice', {}, a.token)).last('welcome')).toMatchObject({ resumed: true });
  });
});

describe('M13-6 welcome: the capacity the server is at', () => {
  it('open, queueing and full as admission reads them (M13-10: its signals and draining, not only the queue length)', async () => {
    const admission = new ScriptedAdmission();
    const t = makeGateway({ admission, env: { CAPACITY_QUEUE_MAX: '3' } });
    admission.size = () => ({ starts: 0, units: 0, reserved: 0 });
    expect((await guest(t, 'A')).last('welcome')!.server.capacity).toBe('open');
    admission.capacity = 'queueing'; // e.g. a soft signal holds starts back while nobody waits yet
    expect((await guest(t, 'B')).last('welcome')!.server.capacity).toBe('queueing');
    admission.capacity = null;
    admission.drain();
    expect((await guest(t, 'C')).last('welcome')!.server.capacity).toBe('full');
  });

  it('the formats offered are the configured ones with their table sizes and clocks', async () => {
    const t = makeGateway({ env: { HOSTED_FORMATS: 'casual,commander', PODS_ENABLED: '1' } });
    const w = (await guest(t, 'A')).last('welcome')!;
    expect(w.server.formats.map((f) => [f.id, f.seats])).toEqual([['casual', [2]], ['commander', [2, 3, 4]]]);
    expect(w.server.formats[0]!.clock).toEqual({ bankMs: 900_000, delayMs: 5_000, dropMs: 300_000 });
  });
});

describe('M13-6 a slow connection (design 3.5): behind mode, the catch-up, the hard cap', () => {
  /** A patch of about `kb` KB for a seat, as the table would send it. */
  const patch = (seq: number, kb: number): string => JSON.stringify({ t: 'patch', seq, base: seq - 1, ops: [{ op: 'set', path: '/x', value: 'y'.repeat(kb * 1024) }], events: [], legal: [] });

  it('one frame at a time reaches a reader that does not read; past 1 MB the connection goes behind: patches dropped, control messages kept, then one full view', async () => {
    const t = makeGateway();
    const { a, table } = await startTable(t);
    t.runtime.inputs.length = 0;
    a.client.stall();
    const frames = a.client.frames.length;
    for (let i = 1; i <= 8; i++) t.gateway.events.deliver(table, [{ seat: 1, t: 'patch', json: patch(i, 300) }]);
    await settle(3);
    // the socket was handed one 300 KB frame (256 KB is its high-water mark); the rest waited in the gateway, 1 MB at most, then were dropped
    expect(a.client.frames.length - frames).toBe(1);
    expect(t.logger.entries().some((e) => e['event'] === 'connectionBehind')).toBe(true);
    t.gateway.tick();
    expect(counted(t.metrics, METRICS.connectionsBehind)).toBe(1);
    expect(t.gateway.outbound()).toBeGreaterThan(0);
    // control messages still go, game payloads do not
    t.gateway.events.deliver(table, [
      { seat: 1, t: 'chat', json: JSON.stringify({ t: 'chat', from: 2, text: 'dropped while behind' }) },
      { seat: 1, t: 'notice', json: JSON.stringify({ t: 'notice', kind: 'playerDropped', text: 'kept while behind' }) },
    ]);
    // the reader wakes: everything handed over is written, the control message follows, then the catch-up is asked for (a sync with no id)
    a.client.release();
    await settle(5);
    expect(a.of('notice').map((n) => n.text)).toContain('kept while behind');
    expect(a.of('chat')).toEqual([]);
    expect(t.runtime.inputs).toEqual([{ game: table, input: { t: 'sync', seat: 1 } }]);
    // until the full view arrives, patches (whose base it no longer has) are dropped; the view puts it back to normal
    const seen = a.client.frames.length;
    t.gateway.events.deliver(table, [{ seat: 1, t: 'patch', json: patch(20, 1) }]);
    await settle(3);
    expect(a.client.frames.length).toBe(seen);
    t.gateway.events.deliver(table, [{ seat: 1, t: 'view', json: JSON.stringify({ t: 'view', seq: 21, view: {}, events: [], legal: [] }) }, { seat: 1, t: 'patch', json: patch(22, 1) }]);
    await settle(3);
    expect(a.of('view').at(-1)).toMatchObject({ seq: 21 });
    expect(a.of('patch').at(-1)).toMatchObject({ seq: 22 });
    t.gateway.tick();
    expect(counted(t.metrics, METRICS.connectionsBehind)).toBe(0);
    expect(a.client.closed).toBeNull();
  });

  it('the total budget (OUTBOUND_BUDGET_MB): above 80% the largest backlogs go behind first; at 100% the largest offender is closed (4004) and its bytes leave the budget', async () => {
    const MB = 1024 * 1024;
    const t = makeGateway({ env: { OUTBOUND_BUDGET_MB: '16' }, outboundLimits: { connection: 7 * MB, hardCap: 14 * MB } });
    const [one, two, three] = [await startTable(t, ['A1', 'B1']), await startTable(t, ['A2', 'B2']), await startTable(t, ['A3', 'B3'])];
    for (const p of [one, two, three]) p.a.client.stall();
    const sendPatches = (p: typeof one, n: number): void => {
      for (let i = 1; i <= n; i++) t.gateway.events.deliver(p.table, [{ seat: 1, t: 'patch', json: patch(i, 1024) }]);
    };
    const behind = (): number => {
      t.gateway.tick();
      return counted(t.metrics, METRICS.connectionsBehind);
    };
    // 6 + 3 + 3 MB of patches: 75% of the budget, no connection is past its own limit of 7 MB, nobody is behind
    sendPatches(one, 6);
    sendPatches(two, 3);
    sendPatches(three, 3);
    expect(behind()).toBe(0);
    expect(t.gateway.outbound()).toBeGreaterThan(0.7);
    expect(t.gateway.outbound()).toBeLessThan(0.8);
    // one more MB takes it over 80%: the largest backlog (the first connection's) goes behind and drops what it had queued; the others keep theirs
    sendPatches(three, 1);
    expect(behind()).toBe(1);
    expect(t.gateway.outbound()).toBeLessThan(0.8);
    expect(t.logger.entries().filter((e) => e['event'] === 'connectionBehind')).toHaveLength(1);
    // control messages still go to the one that is behind and pile up behind a reader that does not read: at 100% of the budget the largest backlog is closed
    const notice = JSON.stringify({ t: 'notice', kind: 'degraded', text: 'z'.repeat(MB) });
    for (let i = 0; i < 16 && one.a.client.closed === null; i++) t.gateway.events.deliver(one.table, [{ seat: 1, t: 'notice', json: notice }]);
    await one.a.client.until(() => one.a.client.closed !== null);
    expect(one.a.client.closed).toMatchObject({ code: CLOSE_REFUSED });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'outbound' })).toBe(1);
    // closed for its backlog: the socket is terminated (a close would keep its bytes alive for the close timer while the budget no longer counts them), with no bye
    expect(one.a.client.terminated).toBe(true);
    expect(one.a.of('bye')).toEqual([]);
    expect(two.a.client.closed).toBeNull();
    expect(three.a.client.closed).toBeNull();
    // what the closed connection held left the budget; on the way the other two were put behind too (the largest backlogs first, until the total was
    // under 80%), each keeping only the frame its socket holds
    expect(behind()).toBe(2);
    expect(t.gateway.outbound()).toBeGreaterThan(0.12);
    expect(t.gateway.outbound()).toBeLessThan(0.13);
  });

  it('a lobby watcher that is behind keeps its lobby updates (nothing sends them again)', async () => {
    let push: ((m: LobbyUpdateMessage) => void) | null = null;
    const lobby: LobbyService = { browse: () => ({ tables: [], total: 0 }), watch: (_c, _k, _f, p) => ((push = p), null), closed: () => undefined };
    const t = makeGateway({ hooks: { lobby } });
    const w = await guest(t, 'Watcher');
    expect(await w.cmd({ t: 'watchLobby', filter: null })).toMatchObject({ ok: true });
    w.client.stall();
    const batch = (i: number): LobbyUpdateMessage => ({ t: 'lobbyUpdate', added: [{ ...listing(`T${i}`), title: 'x'.repeat(300 * 1024) }], changed: [], removed: [] });
    // five batches of 300 KB: past 1 MB the connection is behind; the later batches are queued all the same
    for (let i = 1; i <= 5; i++) push!(batch(i));
    await settle(3);
    t.gateway.tick();
    expect(counted(t.metrics, METRICS.connectionsBehind)).toBe(1);
    w.client.release();
    await settle(5);
    expect(w.of('lobbyUpdate').map((m) => m.added[0]!.table)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(w.client.closed).toBeNull();
    t.gateway.tick();
    expect(counted(t.metrics, METRICS.connectionsBehind)).toBe(0);
  });

  it('while behind, control messages past 2 MB close the connection (4004); it can reconnect with its token and gets its view again', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    a.client.stall();
    const notice = (kb: number) => JSON.stringify({ t: 'notice', kind: 'degraded', text: 'z'.repeat(kb * 1024) });
    for (let i = 1; i <= 8; i++) t.gateway.events.deliver(table, [{ seat: 1, t: 'notice', json: notice(400) }]);
    await a.client.until(() => a.client.closed !== null);
    expect(a.client.closed).toMatchObject({ code: CLOSE_REFUSED });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'behind' })).toBe(1);
    expect(a.client.terminated).toBe(true);
    expect(t.gateway.outbound()).toBe(0); // its bytes left the budget
    expect(b.client.closed).toBeNull();
    t.runtime.inputs.length = 0;
    const again = await guest(t, 'Alice', {}, a.token);
    expect(again.last('welcome')).toMatchObject({ resumed: true, table, seat: 1 });
    await settle(3);
    expect(t.runtime.inputs.map((i) => i.input.t)).toContain('connect');
  });
});
