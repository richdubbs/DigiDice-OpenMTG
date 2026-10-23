/**
 * M13-13 part B, the whole stack: matchmaking as `npm start` wires it (`startHosted`: the real game runtime and deck pool, capacity admission, the gateway
 * and tables, the match service on its own timer), driven in process. Two computer players queue for a quick match, are matched, confirm the ready check
 * and play: the first views, which the runtime delivers inside its start, reach them; the game is a `matched` one in the store, and its end frees its
 * units through the tables layer. A second server run shows a missed ready check with the real timer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InProcessTransport } from '../../src/gateway/in-process';
import { startHosted, type HostedServer } from '../../src/main';
import { MemoryLogger } from '../../src/obs';
import { MemoryStore } from '../../src/store';
import { aiPlayer, Browser, DECKS, deckOf, FIXTURE_CARDS, freshPeer, quiet, RIG_SECRET, type AiPlayer } from '../m13-6/harness';
import { rounds } from './rig';

/** The server as main.ts builds it; `readyCheckMatchMs` shortens the match ready check (the timing option's type is the design's literal figures). */
async function server(o: { readyCheckMatchMs?: number } = {}): Promise<HostedServer> {
  return startHosted({
    env: { STORE: 'memory', WORKERS: '1', LEDGER_SECRET: RIG_SECRET },
    store: new MemoryStore(),
    listenPort: null,
    cards: { module: FIXTURE_CARDS },
    engineBuild: 'build-test',
    logger: new MemoryLogger(),
    ...(o.readyCheckMatchMs !== undefined ? { timing: { readyCheckMatchMs: o.readyCheckMatchMs } as unknown as Parameters<typeof startHosted>[0]['timing'] } : {}),
  });
}

describe('M13-13 a quick match between two computer players on the real server', () => {
  let s: HostedServer;
  let a: AiPlayer;
  let b: AiPlayer;

  beforeAll(async () => {
    s = await server();
    const rig = { transport: new InProcessTransport(s.gateway) };
    a = await aiPlayer(rig, 'Alice', 'qm-a');
    b = await aiPlayer(rig, 'Bob', 'qm-b');
    a.seat.limit = 14;
    b.seat.limit = 14;
    expect(await a.browser.cmd({ t: 'queue', format: 'casual', size: 2, deck: deckOf(DECKS[0]!) })).toMatchObject({ ok: true });
    expect(await b.browser.cmd({ t: 'queue', format: 'casual', size: 2, deck: deckOf(DECKS[1]!) })).toMatchObject({ ok: true });
    await a.browser.client.until(() => a.seat.view !== null && b.seat.view !== null);
    await quiet([a, b]);
  }, 120_000);

  afterAll(async () => {
    await s?.close();
  }, 60_000);

  it('they are matched, confirm, and play: the messages come in the order of a start, and the first view reached each seat', () => {
    for (const p of [a, b]) {
      const types = p.browser.messages().map((m) => m.t);
      expect(types.indexOf('queueStatus')).toBeGreaterThan(0);
      expect(types.indexOf('readyCheck')).toBeGreaterThan(types.indexOf('queueStatus'));
      expect(types.indexOf('start')).toBeGreaterThan(types.lastIndexOf('readyCheck'));
      expect(types.indexOf('view')).toBeGreaterThan(types.indexOf('start'));
      expect(p.browser.of('start')).toHaveLength(1);
      expect(p.seat.moves).toBeGreaterThan(3);
      expect(p.seat.refusals).toEqual([]);
      expect(p.browser.last('table')!.table).toMatchObject({ source: 'matched', status: 'playing' });
    }
    expect(a.browser.last('table')!.table.you).toBe(1);
    expect(b.browser.last('table')!.table.you).toBe(2);
  });

  it('the game is a matched table in the store, running, with both sessions; the tables layer routes its seats', async () => {
    const game = a.browser.last('table')!.table.table;
    const row = (await s.store.tableRow(game))!;
    expect(row).toMatchObject({ source: 'matched', status: 'running', seats: 2, title: 'Quick match' });
    expect(row.seatRows.map((x) => x.session)).toEqual([a.browser.session, b.browser.session]);
    expect(s.gateway.tables.seatOf(a.browser.session)).toMatchObject({ table: game, seat: 1, status: 'playing' });
    expect(s.runtime.has(game)).toBe(true);
    expect((await s.store.loadForRecovery(game)).records.length).toBeGreaterThan(5);
    // nothing of the match is left in the service
    expect(s.gateway.tables.counts().playing).toBe(1);
  });

});

describe('M13-13 a missed ready check with the real timer', () => {
  it('the player who confirms is back in the queue, the one who does not is out, after the ready check\'s length and a tick of the service', async () => {
    const s = await server({ readyCheckMatchMs: 400 });
    try {
      const rig = { transport: new InProcessTransport(s.gateway) };
      const a = await aiPlayer(rig, 'Alice', 'mc-a');
      const b = Browser.connect(rig.transport, { peer: freshPeer() });
      await b.hello('Bob');
      expect(await a.browser.cmd({ t: 'queue', format: 'casual', size: 2, deck: deckOf(DECKS[0]!) })).toMatchObject({ ok: true });
      expect(await b.cmd({ t: 'queue', format: 'casual', size: 2, deck: deckOf(DECKS[1]!) })).toMatchObject({ ok: true });
      await b.client.until(() => b.last('readyCheck') !== undefined);
      expect(b.last('readyCheck')!.deadlineAt - Date.now()).toBeLessThanOrEqual(400);
      // Alice's player confirms by itself (AiSeat); Bob never does
      await a.browser.client.until(() => a.browser.of('notice').some((n) => n.kind === 'readyCheckFailed'), 10_000);
      await b.client.until(() => b.of('notice').some((n) => n.kind === 'readyCheckFailed'), 10_000);
      expect(a.browser.of('notice').find((n) => n.kind === 'readyCheckFailed')!.text).toMatch(/back in the queue/);
      expect(b.of('notice').find((n) => n.kind === 'readyCheckFailed')!.text).toMatch(/left the queue/);
      expect(rounds(a.browser)).toBe(1);
      expect(s.gateway.tables.counts().playing).toBe(0);
      // Alice is queued again (her next match waits for someone): a fresh player is matched with her
      const c = Browser.connect(rig.transport, { peer: freshPeer() });
      await c.hello('Carol');
      expect(await c.cmd({ t: 'queue', format: 'casual', size: 2, deck: deckOf(DECKS[2]!) })).toMatchObject({ ok: true });
      await c.client.until(() => c.last('readyCheck') !== undefined);
      await a.browser.client.until(() => rounds(a.browser) === 2);
    } finally {
      await s.close();
    }
  }, 60_000);
});
