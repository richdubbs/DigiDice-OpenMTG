/**
 * M13-6: ONE normal game over a real WebSocket on 127.0.0.1 (the owner's one network exception, answer 12): the whole server as `npm start` builds it
 * (`startHosted`: config, store, runtime, gateway, HTTP server and the `ws` listener), two computer players that connect like browsers (the desktop
 * app's loopback Origin), hello, make a table, take the seats, confirm the ready check, play every decision from their own view, and disconnect. Normal
 * traffic only: one game, two connections, nothing malformed, nothing repeated, no probing; every limit and every refusal is tested in process.
 *
 * Design 6.4 again, on the real socket: everything either player was sent is searched for what it may not know.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHosted, type HostedServer } from '../../src/main';
import { MemoryLogger } from '../../src/obs';
import { aiPlayerOn, Browser, createTable, DECKS, deckOf, FIXTURE_CARDS, RIG_SECRET, scanSeatFrames, WsLink, type AiPlayer } from './harness';

describe('M13-6 one normal game over a loopback WebSocket', () => {
  let server: HostedServer;
  const logger = new MemoryLogger();
  let alice: AiPlayer;
  let bob: AiPlayer;
  let links: WsLink[] = [];
  const decks = [deckOf(DECKS[0]!), deckOf(DECKS[1]!)] as const;
  let game = '';

  beforeAll(async () => {
    server = await startHosted({
      env: { STORE: 'memory', WORKERS: '1', LEDGER_SECRET: RIG_SECRET },
      listenPort: 0,
      cards: { module: FIXTURE_CARDS },
      engineBuild: 'build-test',
      logger,
    });
    expect(server.port).toBeGreaterThan(0);
    links = [await WsLink.connect(server.port), await WsLink.connect(server.port)];
    alice = await aiPlayerOn(new Browser(links[0]!), 'Alice', 'ws-a');
    bob = await aiPlayerOn(new Browser(links[1]!), 'Bob', 'ws-b');
    game = (await createTable(alice.browser, { deck: decks[0] })).table;
    expect(await bob.browser.cmd({ t: 'join', table: game, deck: decks[1] })).toMatchObject({ ok: true });
    await Promise.all([alice.done(), bob.done()]);
    await server.runtime.settleAll();
  }, 300_000);

  afterAll(async () => {
    for (const l of links) l.close();
    await server?.close();
  }, 60_000);

  it('the game is played to its end over the sockets: the same result for both, nothing refused, text frames only, no compression', () => {
    expect(alice.seat.result).not.toBeNull();
    expect(alice.seat.result).toEqual(bob.seat.result);
    expect(alice.seat.result!.outcome).toMatch(/win|draw/);
    expect(alice.seat.refusals).toEqual([]);
    expect(bob.seat.refusals).toEqual([]);
    expect(alice.seat.moves).toBeGreaterThan(5);
    for (const l of links) {
      expect(l.binary).toBe(0);
      expect(l.extensions).toBe('');
    }
    expect(alice.browser.of('welcome')[0]).toMatchObject({ resumed: false, server: { protocol: 1, engineBuild: 'build-test' } });
    expect(alice.browser.of('start')).toHaveLength(1);
    expect(alice.browser.of('patch').length).toBeGreaterThan(5);
    expect(server.gateway.connections).toBe(2);
  });

  it('the ledger has the game with both sessions; history over the socket shows it', async () => {
    const rows = await server.store.results(new Date(0), 10);
    expect(rows.map((r) => r.game)).toEqual([game]);
    expect(rows[0]!.placements.map((p) => p.session).sort()).toEqual([alice.browser.session, bob.browser.session].sort());
    const h = await alice.browser.cmd({ t: 'history' });
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.history!.map((e) => e.game)).toEqual([game]);
  });

  it('design 6.4 on the real socket: nothing either player was sent holds anything of the other\'s hidden cards, the seed, the RNG, a suspended action, or the other\'s session, token, fingerprint or decklist', async () => {
    const stored = await server.store.loadForRecovery(game, { ignoreSnapshots: true });
    const row = (await server.store.tableRow(game))!;
    const config = { ...stored.config, seed: stored.seed };
    const secrets = (p: AiPlayer, i: 0 | 1) => ({ session: p.browser.session, token: p.browser.token, deckHash: row.seatRows[i]!.deckHash!, deck: decks[i] });
    expect(scanSeatFrames({ config, records: stored.records, frames: alice.frames, player: alice.seat.player!, others: [secrets(bob, 1)] })).toBe(alice.frames.length);
    expect(scanSeatFrames({ config, records: stored.records, frames: bob.frames, player: bob.seat.player!, others: [secrets(alice, 0)] })).toBe(bob.frames.length);
    expect(alice.frames.length).toBeGreaterThan(20);
  });

  it('closing the sockets ends the connections; the server logged no token and no deck fingerprint', async () => {
    for (const l of links) l.close();
    for (let i = 0; i < 100 && server.gateway.connections > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(server.gateway.connections).toBe(0);
    const log = logger.lines.join('\n');
    expect(log).not.toContain(alice.browser.token);
    expect(log).not.toContain(bob.browser.token);
    for (const s of (await server.store.tableRow(game))!.seatRows) expect(log).not.toContain(s.deckHash!);
  });
});
