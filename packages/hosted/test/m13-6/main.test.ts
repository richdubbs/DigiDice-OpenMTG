/**
 * M13-6: main.ts (`startHosted`, the process as `npm start` builds it), without a network (`listenPort: null` opens no listener; the servers' request
 * handlers are called in process). Configuration errors are all listed before anything starts; a start that fails after the workers are up stops them
 * again; drain (SIGTERM's path) lets a running game finish, refuses new tables, and `/readyz` says "draining"; the metrics listener serves what the process
 * counted, to the token only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InProcessTransport } from '../../src/gateway/in-process';
import { installSignals, startHosted, type HostedServer } from '../../src/main';
import { MemoryLogger } from '../../src/obs';
import { GameRuntime } from '../../src/runtime';
import { MemoryStore } from '../../src/store';
import { aiPlayer, callRequest, createTable, DECKS, deckOf, FIXTURE_CARDS, guest, quiet, RIG_SECRET } from './harness';

const TOKEN = 'd'.repeat(64);
const open: HostedServer[] = [];

async function start(env: Record<string, string> = {}, o: { store?: MemoryStore; logger?: MemoryLogger } = {}): Promise<{ server: HostedServer; rig: { transport: InProcessTransport } }> {
  const server = await startHosted({
    env: { STORE: 'memory', WORKERS: '1', LEDGER_SECRET: RIG_SECRET, METRICS_PORT: '9', METRICS_TOKEN: TOKEN, ...env },
    listenPort: null,
    metricsListenPort: null,
    cards: { module: FIXTURE_CARDS },
    engineBuild: 'build-test',
    logger: o.logger ?? new MemoryLogger(),
    ...(o.store ? { store: o.store } : {}),
  });
  open.push(server);
  return { server, rig: { transport: new InProcessTransport(server.gateway) } };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of open.splice(0)) await s.close();
});

describe('M13-6 starting: configuration errors are listed together; a failed start stops what it started', () => {
  it('every configuration error is in one message, secrets never echoed; nothing is started', async () => {
    const opened = vi.spyOn(GameRuntime.prototype, 'open');
    const err = await startHosted({ env: { PORT: 'abc', STORE: 'tape', LEDGER_SECRET: 'not-hex-at-all', METRICS_PORT: '9000' }, logger: new MemoryLogger() }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain('Configuration errors:');
    for (const v of ['PORT', 'STORE', 'LEDGER_SECRET', 'METRICS_TOKEN']) expect(message, v).toContain(v);
    expect(message).not.toContain('not-hex-at-all');
    expect(opened).not.toHaveBeenCalled();
  });

  it('a start that fails after the runtime is up (here: a port that cannot be listened on) stops the runtime and the timer', async () => {
    const opened = vi.spyOn(GameRuntime.prototype, 'open');
    const closed = vi.spyOn(GameRuntime.prototype, 'close');
    const err = await startHosted({
      env: { STORE: 'memory', WORKERS: '1' }, listenPort: 99_999, cards: { module: FIXTURE_CARDS }, engineBuild: 'build-test', logger: new MemoryLogger(),
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  }, 120_000);

  it('the config line the process logs has no secret', async () => {
    const logger = new MemoryLogger();
    await start({}, { logger });
    const config = logger.entries().find((e) => e['event'] === 'config')!;
    expect(JSON.stringify(config)).not.toContain(TOKEN);
    expect(JSON.stringify(config)).not.toContain(RIG_SECRET);
    expect(logger.entries().some((e) => e['event'] === 'listening')).toBe(true);
  }, 120_000);
});

describe('M13-6 health, readiness and drain', () => {
  it('/healthz and /readyz answer; drain keeps a running game, refuses new tables, shows "draining" in /readyz, and ends when the game has', async () => {
    const { server, rig } = await start();
    const get = (url: string) => callRequest(server.http, { url });
    expect(get('/healthz')).toMatchObject({ status: 200 });
    expect(get('/readyz')).toMatchObject({ status: 200, body: '{"ok":true,"reasons":[]}' });

    // a game running (paused), a table waiting
    const decks = [deckOf(DECKS[0]!), deckOf(DECKS[1]!)] as const;
    const a = await aiPlayer(rig, 'Alice', 'm-a');
    const b = await aiPlayer(rig, 'Bob', 'm-b');
    a.seat.limit = 8;
    b.seat.limit = 8;
    const game = (await createTable(a.browser, { deck: decks[0] })).table;
    expect(await b.browser.cmd({ t: 'join', table: game, deck: decks[1] })).toMatchObject({ ok: true });
    await a.browser.client.until(() => a.seat.view !== null && b.seat.view !== null);
    await quiet([a, b]);
    const waiting = await guest(rig, 'Carol');
    const table = await createTable(waiting, { deck: decks[0] });

    // SIGTERM's path: drain
    const drained = server.drain();
    expect(server.gateway.draining).toBe(true);
    expect(get('/readyz')).toMatchObject({ status: 503, body: '{"ok":false,"reasons":["draining"]}' });
    expect(get('/healthz')).toMatchObject({ status: 200 });
    // the waiting table was closed with a notice, new tables and joins are refused; the running game is untouched
    expect(waiting.of('notice').some((n) => n.kind === 'serverDraining')).toBe(true);
    expect(server.gateway.tables.has(table.table)).toBe(false);
    const late = await guest(rig, 'Dora');
    expect(await late.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: decks[0] })).toMatchObject({ ok: false, error: { code: 'draining' } });
    expect(server.gateway.tables.seatOf(a.browser.session)).toMatchObject({ table: game, status: 'playing' });
    // the game is played out; the drain ends with it
    let settled = false;
    void drained.then(() => (settled = true));
    await quiet([a, b]);
    expect(settled).toBe(false);
    for (const p of [a, b]) {
      p.seat.limit = null;
      p.seat.act();
    }
    await Promise.all([a.done(), b.done()]);
    expect(await drained).toEqual({ finished: 1, voided: [] });
    expect(a.seat.result!.outcome).toMatch(/win|draw/);
    expect(a.seat.refusals).toEqual([]);
  }, 240_000);

  it('/metrics (the metrics listener) serves what the process counted, to the bearer token only', async () => {
    const { server, rig } = await start();
    const a = await guest(rig, 'Alice');
    await createTable(a);
    const metrics = server.metricsHttp!;
    expect(callRequest(metrics, { url: '/metrics' }).status).toBe(401);
    expect(callRequest(metrics, { url: '/metrics', headers: { authorization: `Bearer ${'e'.repeat(64)}` } }).status).toBe(401);
    const ok = callRequest(metrics, { url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('openmtg_hosted_connections 1');
    expect(ok.body).toContain('openmtg_hosted_tables{status="lobby"} 1');
    // no secret, id or name in it
    expect(ok.body).not.toContain(a.token);
    expect(ok.body).not.toContain(a.session);
    expect(ok.body).not.toContain('Alice');
    // the gateway's own server never serves it
    expect(callRequest(server.http, { url: '/metrics', headers: { authorization: `Bearer ${TOKEN}` } }).status).toBe(404);
    expect(server.metricsPort).toBeNull();
    expect(server.port).toBe(0);
  }, 120_000);
});

describe('M13-6 signals: Ctrl-C cuts a drain (review 9)', () => {
  /** A process that records its handlers and exits, and a server whose drain and close the test finishes by hand. */
  function rig() {
    const handlers: Record<string, () => void> = {};
    const exits: number[] = [];
    const proc = { on: (sig: string, f: () => void) => void (handlers[sig] = f), exit: (code: number) => void exits.push(code) };
    let endDrain: (v: { finished: number; voided: string[] }) => void = () => undefined;
    let failDrain: (e: unknown) => void = () => undefined;
    let endClose: () => void = () => undefined;
    const calls: string[] = [];
    const server = {
      drain: () => (calls.push('drain'), new Promise<{ finished: number; voided: string[] }>((res, rej) => ((endDrain = res), (failDrain = rej)))),
      close: () => (calls.push('close'), new Promise<void>((res) => (endClose = res))),
    };
    installSignals(server, proc);
    return { handlers, exits, calls, endDrain: () => endDrain({ finished: 0, voided: [] }), failDrain: () => failDrain(new Error('x')), endClose: () => endClose() };
  }
  const tick = () => new Promise((r) => setImmediate(r));

  it('SIGINT stops at once (close, then exit 0); a second signal while it stops ends the process', async () => {
    const r = rig();
    r.handlers['SIGINT']!();
    expect(r.calls).toEqual(['close']);
    r.handlers['SIGINT']!();
    expect(r.exits).toEqual([1]);
    r.endClose();
    await tick();
    expect(r.exits).toEqual([1, 0]);
  });

  it('SIGTERM drains, then stops; when the drain ends by itself the process exits 0 after the close', async () => {
    const r = rig();
    r.handlers['SIGTERM']!();
    expect(r.calls).toEqual(['drain']);
    r.endDrain();
    await tick();
    expect(r.calls).toEqual(['drain', 'close']);
    r.endClose();
    await tick();
    expect(r.exits).toEqual([0]);
  });

  it('SIGINT during a drain stops at once, and the drain ending later does not close again', async () => {
    const r = rig();
    r.handlers['SIGTERM']!();
    r.handlers['SIGINT']!();
    expect(r.calls).toEqual(['drain', 'close']);
    r.endClose();
    await tick();
    expect(r.exits).toEqual([0]);
    r.endDrain();
    await tick();
    expect(r.calls).toEqual(['drain', 'close']);
  });

  it('a second SIGTERM during the drain stops at once too; a drain that fails exits 1', async () => {
    const r = rig();
    r.handlers['SIGTERM']!();
    r.handlers['SIGTERM']!();
    expect(r.calls).toEqual(['drain', 'close']);
    const f = rig();
    f.handlers['SIGTERM']!();
    f.failDrain();
    await tick();
    expect(f.exits).toEqual([1]);
    expect(f.calls).toEqual(['drain']);
  });
});
