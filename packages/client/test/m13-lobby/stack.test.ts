// @vitest-environment node
/**
 * M13-12 on the whole stack (hosted design 13.5's gate, in process): the real hosted server as `startHosted` builds it (config, store, runtime with its
 * game workers and deck pool, gateway, tables, lobby browser with scrypt passwords and the word filter, matchmaking, capacity admission, bug inbox), with
 * NO listener: the page's `HostedLink`s reach the gateway through its in-process transport (gateway/in-process.ts), so there is no socket and no network
 * traffic at all (the owner's rule). Four players:
 *  - Alice makes an open table with a password; Bob's lobby feed sees it appear, live; a wrong password is refused, the right one sits him down; the
 *    ready check; they play; Bob sends a bug report, which lands in the server's inbox with the game; Alice concedes; both replays are kept.
 *  - With CAPACITY_UNITS=1 the server has room for one game: Carol and Dave find each other by quick match while it runs, and their start waits in
 *    line for room; when the first game ends it begins after their ready check.
 */
import { chooseAction } from '@openmtg/ai';
import type { Action } from '@openmtg/engine';
import type { HostedDeck, LobbyListing } from '@openmtg/hosted/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HostedConnection } from '../../src/connection/HostedConnection';
import { sealConnection } from '../../src/game/sealed';
import { HostedLink, type SocketLike } from '../../src/hosted/HostedLink';
import { LobbyWatcher } from '../../src/hosted/lobby/watcher';
import { recordHostedGame, type HostedRecorder } from '../../src/hosted/replay';
import { sendHostedBugReport } from '../../src/hosted/report';
import { MemoryHostedStorage } from '../../src/hosted/storage';
import type { ReportEnvironment } from '../../src/bugs/report';
import { DECKS } from '../../../ai/test/decks';
import { InProcessTransport, type InProcessClient } from '../../../hosted/src/gateway/in-process';
import { startHosted, type HostedServer } from '../../../hosted/src/main';
import { MemoryLogger } from '../../../hosted/src/obs';
import { testEnv } from '../replays/helpers';

const FIXTURE_CARDS = new URL('../../../hosted/test/m13-5/fixture-cards.ts', import.meta.url).href;
const PAGE_ORIGIN = 'http://127.0.0.1:47600';
const deckOf = (i: number): HostedDeck => ({ main: DECKS[i]!.map(([name, count]) => ({ name, count })), sideboard: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ENV: ReportEnvironment = {
  app: { name: 'OpenMTG', version: '0.0.0-test', commit: 'testcommit' } as ReportEnvironment['app'],
  browser: { userAgent: 'test' } as unknown as ReportEnvironment['browser'],
  settings: {} as ReportEnvironment['settings'],
  errors: [],
};

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/** The page's WebSocket, as the in-process transport: frames both ways asynchronously, the gateway's close and the page's own. */
class InProcessSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private readonly client: InProcessClient;

  constructor(transport: InProcessTransport) {
    const c = transport.connect({ origin: PAGE_ORIGIN });
    if ('refused' in c) throw new Error(`refused: ${c.refused.why}`);
    this.client = c;
    c.onFrame = (text) => this.onmessage?.({ data: text });
    for (const k of ['close', 'terminate'] as const) {
      const own = c.socket[k]?.bind(c.socket);
      c.socket[k] = (code: number, reason: string) => {
        own?.(code, reason);
        this.ended(code, reason);
      };
    }
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    this.client.send(data);
  }

  close(code = 1000, reason = ''): void {
    this.client.close();
    this.ended(code, reason);
  }

  private ended(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

describe('M13-12 the lobby, a password table, quick match and the line for room, on the real server in process', () => {
  let server: HostedServer;
  let transport: InProcessTransport;
  const logger = new MemoryLogger();

  beforeAll(async () => {
    server = await startHosted({
      env: { STORE: 'memory', WORKERS: '2', LEDGER_SECRET: 'ab'.repeat(32), CAPACITY_UNITS: '1' },
      listenPort: null,
      cards: { module: FIXTURE_CARDS },
      engineBuild: 'build-test',
      logger,
    });
    transport = new InProcessTransport(server.gateway);
  }, 120_000);

  afterAll(async () => {
    await server?.close();
  }, 60_000);

  function client(name: string) {
    const link = new HostedLink({ server: 'ws://in-process', name, storage: new MemoryHostedStorage(), retryMs: 300, pingEveryMs: 0, socket: () => new InProcessSocket(transport) });
    return { name, link, conn: null as HostedConnection | null, recorder: null as HostedRecorder | null, moves: 0, busy: false, problems: [] as string[] };
  }
  type Client = ReturnType<typeof client>;

  async function move(c: Client): Promise<boolean> {
    const conn = c.conn;
    if (!conn || c.busy) return false;
    const view = conn.view();
    const d = view.pending;
    if (view.result || !d || d.player !== view.viewer) return false;
    c.busy = true;
    const action: Action = chooseAction(view, d, `stack-${c.name}`);
    const r = await conn.act(action);
    c.busy = false;
    c.moves++;
    if (!r.ok) c.problems.push(r.error.message);
    return true;
  }

  async function play(players: Client[], moves: number): Promise<void> {
    const deadline = Date.now() + 90_000;
    const start = players.reduce((n, c) => n + c.moves, 0);
    while (players.reduce((n, c) => n + c.moves, 0) < start + moves) {
      if (Date.now() > deadline) throw new Error('the game did not get going');
      const acted = await Promise.all(players.map(move));
      if (!acted.some(Boolean)) await sleep(5);
    }
  }

  function seat(c: Client, env: ReturnType<typeof testEnv>): void {
    c.conn = new HostedConnection(c.link);
    c.recorder = recordHostedGame(c.conn, c.link, sealConnection(c.conn), env);
  }

  it('an open table with a password, seen live in the lobby, played, reported, conceded; a quick match waits in line for room and then plays', async () => {
    const env = testEnv({ now: () => Date.now() });
    const alice = client('Alice');
    const bob = client('Bob');
    const carol = client('Carol');
    const dave = client('Dave');
    await Promise.all([alice, bob, carol, dave].map((c) => c.link.connect()));

    // Bob watches the lobby (the feed the Open tables list runs on).
    const feed = new LobbyWatcher(bob.link, { filter: { open: true }, sort: 'newest', page: 0 });
    feed.start();
    await until(() => feed.getSnapshot().loaded && feed.getSnapshot().mode === 'live', 20_000, "Bob's lobby feed");
    expect(feed.getSnapshot().listings).toEqual([]);

    // Alice makes an open table with a password: it appears in Bob's list by itself, marked locked; no password is in anything Bob got.
    const password = 'kestrel-0942';
    const made = await alice.link.command({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', title: 'Friday   test table', password, deck: deckOf(0) }, { timeoutMs: 60_000 });
    expect(made).toMatchObject({ ok: true });
    await until(() => feed.getSnapshot().listings.length === 1, 20_000, 'the table in the lobby');
    const listing: LobbyListing = feed.getSnapshot().listings[0]!;
    expect(listing).toMatchObject({ title: 'Friday test table', format: 'casual', seats: 2, filled: 1, locked: true, creator: 'Alice' });

    // A wrong password is refused and leaves the seat open; the right one sits Bob down. The table leaves the "free seat" list.
    const wrong = await bob.link.command({ t: 'join', table: listing.table, password: 'not it', deck: deckOf(1) }, { timeoutMs: 60_000 });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'badPassword' } });
    await sleep(1_100); // the server takes one join attempt a second
    const right = await bob.link.command({ t: 'join', table: listing.table, password, deck: deckOf(1) }, { timeoutMs: 60_000 });
    expect(right).toMatchObject({ ok: true });
    await until(() => feed.getSnapshot().listings.length === 0, 20_000, 'the full table to leave the list');
    feed.stop();

    // The ready check, then the game (the server has room for this one).
    await until(() => alice.link.readyCheck() !== null && bob.link.readyCheck() !== null, 20_000, 'the ready check');
    expect(await alice.link.confirm(alice.link.readyCheck()!.start)).toMatchObject({ ok: true });
    expect(await bob.link.confirm(bob.link.readyCheck()!.start)).toMatchObject({ ok: true });
    await until(() => alice.link.view() !== null && bob.link.view() !== null, 30_000, 'the first views');
    expect(alice.link.table()).toMatchObject({ status: 'playing', source: 'listed' });
    seat(alice, env);
    seat(bob, env);
    await play([alice, bob], 16);
    expect([...alice.problems, ...bob.problems]).toEqual([]);

    // Meanwhile Carol and Dave look for a quick match: they are paired, and their start waits in line for room (one game's worth of room).
    for (const c of [carol, dave]) expect(await c.link.command({ t: 'queue', format: 'casual', size: 2, deck: deckOf(c === carol ? 0 : 1) }, { timeoutMs: 60_000 })).toMatchObject({ ok: true });
    expect(carol.link.searching()).toMatchObject({ format: 'casual', size: 2 });
    await until(() => carol.link.table()?.source === 'matched' && dave.link.table()?.source === 'matched', 30_000, 'the match');
    expect(carol.link.searching()).toBeNull();
    await until(() => carol.link.table()?.status === 'waitingCapacity' || carol.link.readyCheck() !== null, 30_000, 'the match to wait for room or check');
    const waited = carol.link.table()?.status === 'waitingCapacity';
    if (waited) {
      await until(() => carol.link.queue()?.kind === 'capacity', 20_000, 'the place in line');
      expect(carol.link.queue()).toMatchObject({ kind: 'capacity', position: 1 });
    }

    // Bob reports a bug from his game: the server's inbox has it, with his game and seat.
    expect(await sendHostedBugReport(bob.link, { words: 'Test report: the stack looked odd.', card: null }, ENV, bob.conn!.view())).toBeNull();
    const reports = await server.store.reports(new Date(0), 10);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: 'bug', seat: 2, text: 'Test report: the stack looked odd.', status: 'new' });
    expect(reports[0]!.game).toBe(alice.link.table()!.table);
    expect(reports[0]!.attachments.map((a) => a.kind).sort()).toEqual(['client', 'settings', 'view']);

    // Alice concedes: the result; both replays are kept, conceded, each of its own player's seat.
    expect(await alice.conn!.act({ type: 'concede', player: alice.conn!.view().viewer! })).toEqual({ ok: true });
    await until(() => alice.link.result() !== null && bob.link.result() !== null, 20_000, 'the result');
    for (const c of [alice, bob]) {
      const entry = await c.recorder!.finish();
      const read = await env.library.read(entry!.key);
      if (!read.ok) throw new Error(read.error.message);
      expect(read.value).toMatchObject({ kind: 'recording', game: { mode: 'hosted', savedBy: c.conn!.view().viewer, ended: 'conceded' } });
      expect(read.value.recording!.frames.length).toBeGreaterThan(5);
    }
    expect(await alice.link.leave()).toMatchObject({ ok: true });
    expect(await bob.link.leave()).toMatchObject({ ok: true });

    // Room again: the quick match's ready check, then its game.
    await until(() => carol.link.readyCheck() !== null && dave.link.readyCheck() !== null, 60_000, "the quick match's ready check");
    expect(await carol.link.confirm(carol.link.readyCheck()!.start)).toMatchObject({ ok: true });
    expect(await dave.link.confirm(dave.link.readyCheck()!.start)).toMatchObject({ ok: true });
    await until(() => carol.link.view() !== null && dave.link.view() !== null, 30_000, "the quick match's first views");
    expect(carol.link.table()).toMatchObject({ status: 'playing', source: 'matched' });
    seat(carol, env);
    seat(dave, env);
    await play([carol, dave], 8);
    expect([...carol.problems, ...dave.problems]).toEqual([]);
    expect(waited).toBe(true);

    for (const c of [carol, dave]) {
      await c.link.leave();
      c.link.close();
    }
    alice.link.close();
    bob.link.close();
    // nothing secret in the server's log: the password, the tokens
    const log = logger.lines.join('\n');
    expect(log).not.toContain(password);
    for (const c of [alice, bob, carol, dave]) expect(log).not.toContain(c.link.welcome()!.token);
  }, 300_000);
});
