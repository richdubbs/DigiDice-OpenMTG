// @vitest-environment node
/**
 * M13-11, the one network exception of the owner's rule for milestone 13 (answer 12): ONE normal game over a real WebSocket on 127.0.0.1. The real hosted
 * server as `npm start -w @openmtg/hosted` builds it (`startHosted`: config, store, runtime with its game workers and deck pool, gateway, tables, the HTTP
 * server and the `ws` listener, on the engine's fixture cards, in memory), and two clients exactly as the page makes them: a `HostedLink` over `ws` with
 * the desktop app's loopback Origin and a `HostedConnection` on it. They make a private table by invite code, confirm the ready check, play the first
 * decisions of a game with the computer player's choices from their own views, chat, then one of them loses its connection mid-game and comes back
 * (the same guest, the same seat, command numbers still counting up), they play on, and one concedes: both get the result with the public placements.
 *
 * Normal traffic only: two connections, one game, nothing malformed, nothing repeated, nothing sent that a page would not send, and no probing. The drop
 * is one socket ended on this side, as a network that goes away does.
 */
import { chooseAction } from '@openmtg/ai';
import type { Action, PlayerId } from '@openmtg/engine';
import type { HostedDeck } from '@openmtg/hosted/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { HostedConnection } from '../../src/connection/HostedConnection';
import { HostedLink, type SocketLike } from '../../src/hosted/HostedLink';
import { MemoryHostedStorage } from '../../src/hosted/storage';
import { DECKS } from '../../../ai/test/decks';
import { startHosted, type HostedServer } from '../../../hosted/src/main';
import { MemoryLogger } from '../../../hosted/src/obs';

const FIXTURE_CARDS = new URL('../../../hosted/test/m13-5/fixture-cards.ts', import.meta.url).href;
/** The Origin of the desktop app's page (the gateway allows the loopback origins of the desktop app, design 3.1). */
const PAGE_ORIGIN = 'http://127.0.0.1:47600';

const deckOf = (i: number): HostedDeck => ({ main: DECKS[i]!.map(([name, count]) => ({ name, count })), sideboard: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

describe('two clients play on the real hosted server over a loopback WebSocket', () => {
  let server: HostedServer;
  const logger = new MemoryLogger();
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    server = await startHosted({
      env: { STORE: 'memory', WORKERS: '1', LEDGER_SECRET: 'ab'.repeat(32) },
      listenPort: 0,
      cards: { module: FIXTURE_CARDS },
      engineBuild: 'build-test',
      logger,
    });
  }, 120_000);

  afterAll(async () => {
    for (const s of sockets) if (s.readyState < 2) s.terminate();
    await server?.close();
  }, 60_000);

  function client(name: string, retryMs: number) {
    const storage = new MemoryHostedStorage();
    const mine: WebSocket[] = [];
    const link = new HostedLink({
      server: `ws://127.0.0.1:${server.port}`,
      name,
      storage,
      retryMs,
      pingEveryMs: 0,
      socket: (url) => {
        const ws = new WebSocket(url, { origin: PAGE_ORIGIN, perMessageDeflate: false });
        mine.push(ws);
        sockets.push(ws);
        return ws as unknown as SocketLike;
      },
    });
    return { name, link, storage, sockets: mine, conn: null as HostedConnection | null, moves: 0, busy: false, problems: [] as string[] };
  }
  type Client = ReturnType<typeof client>;

  /** The computer player's choice for this client's pending decision, sent through its HostedConnection like a click would be. */
  async function move(c: Client): Promise<boolean> {
    const conn = c.conn;
    if (!conn || c.busy) return false;
    const view = conn.view();
    const d = view.pending;
    if (view.result || !d || d.player !== view.viewer) return false;
    c.busy = true;
    const action: Action = chooseAction(view, d, `loopback-${c.name}`);
    const r = await conn.act(action);
    c.busy = false;
    c.moves++;
    if (!r.ok) c.problems.push(r.error.message);
    return true;
  }

  it('make a private table, confirm, play, one drops and returns, one concedes', async () => {
    const alice = client('Alice', 600);
    const bob = client('Bob', 600);
    await Promise.all([alice.link.connect(), bob.link.connect()]);
    expect(alice.link.welcome()).toMatchObject({ resumed: false, server: { protocol: 1, engineBuild: 'build-test' } });
    expect(alice.sockets[0]!.extensions).toBe(''); // no compression (design D7)
    const session = alice.link.welcome()!.session;
    const token = alice.link.welcome()!.token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // Alice types another name after the page connected: hello again on a fresh socket, the same session (the server shows the name of its last hello).
    await alice.link.rename('Alicia');
    expect(alice.sockets).toHaveLength(2);
    expect(alice.link.welcome()).toMatchObject({ resumed: true, name: 'Alicia', session });
    // the resumed welcome does not echo the token back; the page keeps the one the first welcome gave it
    expect(alice.link.welcome()).not.toHaveProperty('token');
    expect(alice.storage.session.token).toBe(token);

    // A private table: Alice gets the code for the other seat, Bob sits down with it.
    const made = await alice.link.command({ t: 'create', format: 'casual', seats: 2, visibility: 'private', deck: deckOf(0) }, { timeoutMs: 60_000 });
    if (!made.ok) throw new Error(`create: ${JSON.stringify(made.error)}`);
    expect(made.codes).toHaveLength(1);
    await until(() => alice.link.table()?.status === 'lobby', 10_000, "Alice's table");
    expect(alice.link.codes()).toEqual([{ seat: 2, code: made.codes![0]! }]);
    const joined = await bob.link.command({ t: 'join', code: made.codes![0]!.toLowerCase(), deck: deckOf(1) }, { timeoutMs: 60_000 });
    expect(joined).toMatchObject({ ok: true });

    // The ready check, then the game.
    await until(() => alice.link.readyCheck() !== null && bob.link.readyCheck() !== null, 10_000, 'the ready check');
    expect(await alice.link.confirm(alice.link.readyCheck()!.start)).toMatchObject({ ok: true });
    expect(await bob.link.confirm(bob.link.readyCheck()!.start)).toMatchObject({ ok: true });
    await until(() => alice.link.view() !== null && bob.link.view() !== null, 30_000, 'the first views');
    expect(alice.link.table()).toMatchObject({ status: 'playing', source: 'private', you: 1 });
    expect(bob.link.table()).toMatchObject({ status: 'playing', you: 2 });
    alice.conn = new HostedConnection(alice.link);
    bob.conn = new HostedConnection(bob.link);
    expect(alice.conn.view().viewer).toBe('p1');
    expect(bob.conn.view().viewer).toBe('p2');
    expect(alice.link.me()).toBe('p1');
    expect(bob.link.nameOfSeat(1)).toBe('Alicia');
    // the clocks are the server's: both banks, the running one marked
    await until(() => alice.link.clocks() !== null, 10_000, 'the clocks');
    expect(alice.link.clocks()!.seats.map((s) => s.seat)).toEqual([1, 2]);
    expect(alice.link.clocks()!.seats[0]!.bankMs).toBeLessThanOrEqual(900_000);

    // Play the first decisions: mulligans, who plays first, the first turns.
    const players = [alice, bob];
    const deadline = Date.now() + 90_000;
    while (alice.moves + bob.moves < 24) {
      if (Date.now() > deadline) throw new Error('the game did not get going');
      const acted = await Promise.all(players.map(move));
      if (!acted.some(Boolean)) await sleep(5);
    }
    expect(alice.problems).toEqual([]);
    expect(bob.problems).toEqual([]);

    // Chat reaches both; each line is the server's echo.
    expect(await bob.link.say('good luck')).toMatchObject({ ok: true });
    await until(() => alice.link.chat().length === 1 && bob.link.chat().length === 1, 10_000, 'the chat line');
    expect(alice.link.chat()[0]).toMatchObject({ from: 2, mine: false, text: 'good luck' });
    expect(bob.link.chat()[0]).toMatchObject({ from: 2, mine: true, text: 'good luck' });

    // Bob's network goes away. Alice is told; the game waits for Bob only when Bob must decide; Bob's away time runs on Alice's clocks.
    const idsBefore = bob.storage.session.nextId;
    expect(idsBefore).toBeGreaterThan(bob.moves); // one number for every command: the moves, the join, the ready check, the chat line
    bob.sockets[0]!.terminate();
    await until(() => bob.link.linkState() === 'lost', 10_000, "Bob's link to notice the drop");
    expect(bob.conn!.status()).toMatch(/Lost the connection to the game server/);
    await until(() => alice.link.away().get(2) === 'dropped', 10_000, 'the drop notice');
    await until(() => alice.link.clocks()!.seats.find((s) => s.seat === 2)!.dropRunning, 10_000, "Bob's away clock");
    expect(alice.conn!.status()).toMatch(/Bob lost the connection/);
    // Alice goes on while it is her decision
    for (let i = 0; i < 20; i++) if (!(await move(alice))) await sleep(10);

    // Bob's page opens the socket again by itself: the same guest, the same seat, a full view, and the counting goes on.
    await until(() => bob.link.linkState() === 'open' && bob.sockets.length === 2, 20_000, "Bob's return");
    expect(bob.link.welcome()).toMatchObject({ resumed: true, table: alice.link.table()!.table, seat: 2 });
    expect(bob.sockets[1]!.readyState).toBe(1);
    await until(() => !alice.link.away().has(2), 10_000, "Alice to hear that Bob is back");
    expect(alice.conn!.status()).toBeNull();
    expect(bob.conn!.status()).toBeNull();
    expect(alice.link.clocks()!.seats.find((s) => s.seat === 2)!.dropRunning).toBe(false);
    expect(bob.storage.session.nextId).toBeGreaterThanOrEqual(idsBefore);

    // Both play on: Bob's first moves after the return are not refused as stale.
    const bobBefore = bob.moves;
    const again = Date.now() + 60_000;
    while (bob.moves < bobBefore + 3) {
      if (Date.now() > again) throw new Error('Bob could not play after coming back');
      const acted = await Promise.all(players.map(move));
      if (!acted.some(Boolean)) await sleep(5);
    }
    expect(bob.problems).toEqual([]);
    expect(alice.problems).toEqual([]);
    expect(bob.storage.session.nextId).toBeGreaterThan(idsBefore);
    expect(alice.link.view()!.seq).toBe(bob.link.view()!.seq);

    // Alice concedes: both see the result and the public placements.
    const conceded = await alice.conn!.act({ type: 'concede', player: 'p1' as PlayerId });
    expect(conceded).toEqual({ ok: true });
    await until(() => alice.conn!.view().result !== null && bob.conn!.view().result !== null, 20_000, 'the result');
    await until(() => alice.link.result() !== null && bob.link.result() !== null, 20_000, 'the result message');
    expect(bob.conn!.view().result).toMatchObject({ winner: 'p2' });
    for (const c of [alice, bob]) {
      const r = c.link.result()!;
      expect(r.outcome).toBe('win');
      expect(r.placements.map((p) => [p.seat, p.name, p.place, p.loss])).toEqual([[2, 'Bob', 1, null], [1, 'Alicia', 2, 'concession']]);
      expect(c.conn!.legalActions()).toEqual([]);
    }

    // The server's ledger has the one game with both sessions, unranked.
    const rows = await server.store.results(new Date(0), 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.placements.map((p) => p.session).sort()).toEqual([session, bob.link.welcome()!.session].sort());

    // Leave: the table is left on both sides, and the sockets close.
    expect(await alice.link.leave()).toMatchObject({ ok: true });
    expect(await bob.link.leave()).toMatchObject({ ok: true });
    expect(alice.link.hasTable()).toBe(false);
    alice.link.close();
    bob.link.close();
    await until(() => server.gateway.connections === 0, 10_000, 'the connections to close');
    const log = logger.lines.join('\n');
    expect(log).not.toContain(alice.storage.session.token!);
    expect(log).not.toContain(bob.storage.session.token!);
  }, 240_000);
});
