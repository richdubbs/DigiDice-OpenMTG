/**
 * M13-6: a restart through main.ts's wiring (design 2.3, 4.6, 4.7; `startHosted` with a file store, driven in process): the process stops with a game
 * running, a private table and a listed table waiting, and a full table in its ready check; the next one recovers the game, restores the lobby tables
 * and the codes' hashes, and the players come back with their tokens: the game is played out, the code still works, the ready check starts again and the
 * game after it starts.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { InProcessTransport } from '../../src/gateway/in-process';
import { startHosted, type HostedServer } from '../../src/main';
import { MemoryLogger } from '../../src/obs';
import { aiPlayer, type Browser, createTable, DECKS, deckOf, FIXTURE_CARDS, guest, quiet, RIG_SECRET, scanSeatFrames, type AiPlayer } from './harness';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5 });
});

async function start(dir: string, logger: MemoryLogger): Promise<{ server: HostedServer; rig: { transport: InProcessTransport } }> {
  const server = await startHosted({
    env: { STORE: 'file', DATA_DIR: dir, WORKERS: '1', LEDGER_SECRET: RIG_SECRET },
    listenPort: null,
    cards: { module: FIXTURE_CARDS },
    engineBuild: 'build-test',
    logger,
  });
  return { server, rig: { transport: new InProcessTransport(server.gateway) } };
}

describe('M13-6 a restart: recovery of the game, the lobby tables and the sessions', () => {
  it('the game is recovered and played out; the private table\'s code still works; the full table\'s ready check starts again and its game is played', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omtg-m136-'));
    dirs.push(dir);
    const decks = [deckOf(DECKS[0]!), deckOf(DECKS[1]!), deckOf(DECKS[2]!)] as const;

    // ---- the first process
    const log1 = new MemoryLogger();
    const one = await start(dir, log1);
    expect(one.server.recovery).toEqual({ recovered: [], voided: [] });
    const a = await aiPlayer(one.rig, 'Alice', 'r-a');
    const b = await aiPlayer(one.rig, 'Bob', 'r-b');
    a.seat.limit = 10;
    b.seat.limit = 10;
    const game = (await createTable(a.browser, { deck: decks[0] })).table;
    expect(await b.browser.cmd({ t: 'join', table: game, deck: decks[1] })).toMatchObject({ ok: true });
    await a.browser.client.until(() => a.seat.view !== null && b.seat.view !== null);
    await quiet([a, b]);
    expect(a.seat.moves + b.seat.moves).toBeGreaterThan(5);
    // a private table with a code, a listed table, and a full table whose ready check nobody confirms
    const carol = await guest(one.rig, 'Carol');
    const priv = await createTable(carol, { visibility: 'private', deck: decks[2] });
    const dave = await guest(one.rig, 'Dave');
    const listed = await createTable(dave, { title: 'Dave plays', deck: decks[2] });
    const e = await guest(one.rig, 'Eve');
    const f = await guest(one.rig, 'Fay');
    const full = await createTable(e, { deck: decks[0] });
    expect(await f.cmd({ t: 'join', table: full.table, deck: decks[1] })).toMatchObject({ ok: true });
    await f.client.until(() => f.last('readyCheck') !== undefined);
    const tokens = { a: a.browser.token, b: b.browser.token, carol: carol.token, dave: dave.token, e: e.token, f: f.token };
    const aliceFrames = [...a.frames];
    const bobFrames = [...b.frames];
    // the process stops (nobody confirmed the ready check): the game stays 'running' in the store
    await one.server.close();
    expect(a.browser.client.closed).not.toBeNull();

    // ---- the second process, on the same files
    const log2 = new MemoryLogger();
    const two = await start(dir, log2);
    try {
      expect(two.server.recovery.recovered).toEqual([game]);
      expect(two.server.recovery.voided).toEqual([]);
      expect(log2.entries().find((x) => x['event'] === 'recovered')).toMatchObject({ games: 1, voided: 0, tables: 3 });
      expect(two.server.gateway.tables.seatOf(a.browser.session)).toMatchObject({ table: game, seat: 1, status: 'playing' });
      expect(two.server.gateway.tables.counts()).toMatchObject({ playing: 1, lobby: 2, readyCheck: 1 });
      expect(two.server.gateway.tables.listings().map((l) => l.title)).toEqual(['Dave plays']);

      // the players of the game come back with their tokens: a full view at the point they stopped, and the game goes on to its end
      const alice = await aiPlayer(two.rig, 'Alice', 'r-a2', { token: tokens.a, after: a });
      const bob = await aiPlayer(two.rig, 'Bob', 'r-b2', { token: tokens.b, after: b });
      expect(alice.browser.last('welcome')).toMatchObject({ resumed: true, table: game, seat: 1, session: a.browser.session });
      expect(bob.browser.last('welcome')).toMatchObject({ resumed: true, table: game, seat: 2, session: b.browser.session });
      await alice.browser.client.until(() => alice.seat.view !== null);
      expect(alice.browser.messages().find((m) => m.t === 'view' || m.t === 'patch')?.t).toBe('view');
      expect(alice.seat.view!.viewer).toBe(a.seat.player);

      // the private table's code works (only its hash was kept); Carol's seat and the table are as she left them
      const hal = await guest(two.rig, 'Hal');
      expect(await hal.cmd({ t: 'join', code: priv.codes[0]!, deck: decks[0] })).toMatchObject({ ok: true, table: priv.table });
      const carol2 = await guest(two.rig, 'Carol', {}, tokens.carol);
      expect(carol2.last('welcome')).toMatchObject({ resumed: true, table: priv.table, seat: 1 });
      const dave2 = await guest(two.rig, 'Dave', {}, tokens.dave);
      expect(dave2.last('welcome')).toMatchObject({ resumed: true, table: listed.table, seat: 1 });

      // the full table's ready check is running again; its players come back (computer players now: they confirm it), and the game starts (the decks are
      // prepared again) and is played
      const eve = await aiPlayer(two.rig, 'Eve', 'r-e2', { token: tokens.e });
      const fay = await aiPlayer(two.rig, 'Fay', 'r-f2', { token: tokens.f });
      expect(eve.browser.last('welcome')).toMatchObject({ resumed: true, table: full.table, seat: 1 });
      expect(eve.browser.of('readyCheck').length).toBeGreaterThan(0);
      expect(eve.browser.of('table')[0]!.table).toMatchObject({ status: 'readyCheck', seats: [{ name: 'Eve' }, { name: 'Fay' }] });
      await Promise.all([alice.done(), bob.done(), eve.done(), fay.done()]);
      await two.server.runtime.settleAll();
      for (const p of [alice, bob, eve, fay] as AiPlayer[]) expect(p.seat.result!.outcome, p.seat.tag).toMatch(/win|draw/);
      expect(alice.seat.result).toEqual(bob.seat.result);
      expect(eve.seat.result).toEqual(fay.seat.result);
      expect(alice.seat.refusals).toEqual([]);
      expect(bob.seat.refusals).toEqual([]);

      // the ledger of the recovered game has the sessions of the first process
      const rows = await two.server.store.results(new Date(0), 10);
      const row = rows.find((r) => r.game === game)!;
      expect(row.outcome).toMatch(/win|draw/);
      expect(row).toMatchObject({ seats: 2, source: 'listed' });
      expect(row.placements.map((p) => p.session).sort()).toEqual([a.browser.session, b.browser.session].sort());
      expect(rows.some((r) => r.game === full.table)).toBe(true);
      // nothing of the other seat reached a player across the two processes (design 6.4)
      const stored = await two.server.store.loadForRecovery(game, { ignoreSnapshots: true });
      const seatRow = (await two.server.store.tableRow(game))!.seatRows;
      const alicePlays = [...aliceFrames, ...alice.frames];
      const bobPlays = [...bobFrames, ...bob.frames];
      const secrets = (who: Browser, i: 0 | 1) => ({ session: who.session, token: who.token, deckHash: seatRow[i]!.deckHash!, deck: [decks[0], decks[1]][i]! });
      const config = { ...stored.config, seed: stored.seed };
      expect(scanSeatFrames({ config, records: stored.records, frames: alicePlays, player: alice.seat.player!, others: [secrets(b.browser, 1)] })).toBe(alicePlays.length);
      expect(scanSeatFrames({ config, records: stored.records, frames: bobPlays, player: bob.seat.player!, others: [secrets(a.browser, 0)] })).toBe(bobPlays.length);
      // nothing on disk holds a token or a client's address (the sessions kept only the hash of their token; addresses are for limits and the log)
      const files = (await readdir(dir, { recursive: true })).map((f) => join(dir, f));
      let read = 0;
      for (const f of files) {
        const text = await readFile(f, 'utf8').catch(() => null);
        if (text === null) continue;
        read++;
        for (const token of Object.values(tokens)) expect(text, f).not.toContain(token);
        expect(text, f).not.toMatch(/10.d{1,3}.d{1,3}.7/);
      }
      expect(read).toBeGreaterThan(3);
    } finally {
      await two.server.close();
    }
  }, 300_000);
});
