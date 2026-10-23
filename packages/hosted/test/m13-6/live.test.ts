/**
 * M13-6: a game in progress through the gateway on the real runtime (design 3.3, 4.4, 5.3; computer players on in-process browsers): a dropped player
 * comes back with the token and a full view; a second socket with the token replaces the first (4001); while nobody is connected the drop clocks wait
 * (review 6) and the abandonment timer runs; when it ends the game is void and whoever comes back is told; Leave concedes (CR 104.3a).
 *
 * The games pause by giving the computer players a number of moves (`AiSeat.limit`); a paused game is quiet, so what a test does next starts from a known
 * point. The abandonment test lets the five minutes pass: the runtime's clock is a test clock (`RuntimeOptions.now`) and its one long timer, the table's
 * next deadline, is shortened to a moment of real time, advancing that clock by the time it was set for when it fires.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerId } from '@openmtg/engine';
import { CLOSE_REPLACED, HOSTED_TIMING } from '../../src/api';
import { aiPlayer, createTable, DECKS, deckOf, makeRig, quiet, scanSeatFrames, type AiPlayer, type Rig } from './harness';

/** Scans every frame the seat was sent, whichever connections they came on (design 6.4). */
async function scan(rig: Rig, game: string, mine: { frames: string[]; player: PlayerId }, other: { session: string; token: string; deckHash: string; deck: ReturnType<typeof deckOf> }) {
  const stored = await rig.store.loadForRecovery(game, { ignoreSnapshots: true });
  return scanSeatFrames({ config: { ...stored.config, seed: stored.seed }, records: stored.records, frames: mine.frames, player: mine.player, others: [other] });
}

/** Two computer players at a started listed table, paused after `moves` moves each. */
async function pausedGame(rig: Rig, tag: string, moves: number): Promise<{ a: AiPlayer; b: AiPlayer; game: string; decks: [ReturnType<typeof deckOf>, ReturnType<typeof deckOf>] }> {
  const decks: [ReturnType<typeof deckOf>, ReturnType<typeof deckOf>] = [deckOf(DECKS[0]!), deckOf(DECKS[1]!)];
  const a = await aiPlayer(rig, 'Alice', `${tag}-a`);
  const b = await aiPlayer(rig, 'Bob', `${tag}-b`);
  a.seat.limit = moves;
  b.seat.limit = moves;
  const { table } = await createTable(a.browser, { deck: decks[0] });
  expect(await b.browser.cmd({ t: 'join', table, deck: decks[1] })).toMatchObject({ ok: true });
  await a.browser.client.until(() => a.seat.view !== null && b.seat.view !== null);
  await quiet([a, b]);
  return { a, b, game: table, decks };
}

const resume = (...players: AiPlayer[]) => {
  for (const p of players) {
    p.seat.limit = null;
    p.seat.act();
  }
};

describe('M13-6 a player who drops and comes back; a second socket with the token', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = await makeRig({ workers: 1 });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('the game goes on for the other seat; the token brings the seat back with a full view, and a newer socket replaces an older one (4001)', async () => {
    const { a, b, game, decks } = await pausedGame(rig, 'drop', 8);
    const bobsToken = b.browser.token;
    const bobsFrames = b.frames.length;
    // Bob's socket drops: Alice is told, and his drop clock runs on her screen
    b.browser.client.close();
    await a.browser.client.until(() => a.browser.of('notice').some((n) => n.kind === 'playerDropped'));
    expect(a.browser.of('notice').find((n) => n.kind === 'playerDropped')).toMatchObject({ seat: 2 });
    await a.browser.client.until(() => a.browser.of('clock').some((c) => c.seats.find((s) => s.seat === 2)?.dropRunning === true));
    expect(rig.gateway.tables.seatOf(b.browser.session)).toMatchObject({ table: game, seat: 2 });
    // Alice plays on until the game waits for Bob
    resume(a);
    await quiet([a]);
    // Bob comes back on a new connection with his token: his seat, a full view, and everyone hears it
    const back = await aiPlayer(rig, 'Bob', 'drop-b2', { token: bobsToken, after: b });
    expect(back.browser.last('welcome')).toMatchObject({ resumed: true, table: game, seat: 2, session: b.browser.session });
    await back.browser.client.until(() => back.seat.view !== null);
    const firstGameFrame = back.browser.messages().find((m) => m.t === 'view' || m.t === 'patch');
    expect(firstGameFrame?.t).toBe('view');
    await a.browser.client.until(() => a.browser.of('notice').some((n) => n.kind === 'playerBack'));
    await a.browser.client.until(() => a.browser.of('clock').at(-1)!.seats.find((s) => s.seat === 2)?.dropRunning === false);
    // a newer socket replaces it (the older one stops playing first: the newer goes on counting where it stopped)
    back.seat.limit = back.seat.moves;
    await quiet([a, back]);
    const newer = await aiPlayer(rig, 'Bob', 'drop-b3', { token: bobsToken, after: back });
    await back.browser.client.until(() => back.browser.client.closed !== null);
    expect(back.browser.client.closed).toMatchObject({ code: CLOSE_REPLACED });
    expect(back.browser.of('bye').at(-1)?.reason).toBe('You connected again from elsewhere.');
    expect(newer.browser.last('welcome')).toMatchObject({ resumed: true, table: game, seat: 2 });
    // the game is played out
    resume(a, newer);
    await Promise.all([a.done(), newer.done()]);
    await rig.runtime.settleAll();
    expect(a.seat.result).toEqual(newer.seat.result);
    expect(a.seat.result!.outcome).toMatch(/win|draw/);
    expect(a.seat.refusals).toEqual([]);
    // what the replaced seat was sent across three connections holds nothing of the other seat's (design 6.4)
    const row = (await rig.store.tableRow(game))!;
    const alice = { session: a.browser.session, token: a.browser.token, deckHash: row.seatRows[0]!.deckHash!, deck: decks[0] };
    const bob = { session: b.browser.session, token: bobsToken, deckHash: row.seatRows[1]!.deckHash!, deck: decks[1] };
    const bobFrames = [...b.frames.slice(0, bobsFrames), ...back.frames, ...newer.frames];
    expect(await scan(rig, game, { frames: bobFrames, player: newer.seat.player! }, alice)).toBe(bobFrames.length);
    expect(await scan(rig, game, { frames: a.frames, player: a.seat.player! }, bob)).toBe(a.frames.length);
    // the game was not touched by the drop: it is a normal result in the ledger
    const rows = await rig.store.results(new Date(0), 10);
    expect(rows.find((r) => r.game === game)?.outcome).toMatch(/win|draw/);
  }, 240_000);
});

describe('M13-6 nobody connected: the drop clocks wait (design 4.4, review 6)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = await makeRig({ workers: 1 });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('while both are away the drop clock of the first to drop does not run; the one who returns stops the abandonment and the game is played out', async () => {
    const { a, b, game } = await pausedGame(rig, 'away', 8);
    b.browser.client.close();
    await a.browser.client.until(() => a.browser.of('clock').some((c) => c.seats.find((s) => s.seat === 2)?.dropRunning === true));
    const last = a.browser.of('clock').at(-1)!;
    const dropped = last.seats.find((s) => s.seat === 2)!;
    expect(dropped).toMatchObject({ dropRunning: true });
    expect(last.abandonMs).toBeUndefined();
    // Alice drops too: nobody is connected, and for a while
    const aliceToken = a.browser.token;
    const bobToken = b.browser.token;
    a.browser.client.close();
    await new Promise((r) => setTimeout(r, 1_500));
    // Alice returns: Bob's drop clock took up where it stopped, not where it would have been
    const alice = await aiPlayer(rig, 'Alice', 'away-a2', { token: aliceToken, after: a });
    await alice.browser.client.until(() => alice.browser.of('clock').length > 0);
    const now = alice.browser.of('clock').at(-1)!;
    const bobNow = now.seats.find((s) => s.seat === 2)!;
    expect(now.abandonMs).toBeUndefined(); // she is there: the abandonment timer is stopped
    expect(bobNow.dropRunning).toBe(true);
    const elapsed = now.at - last.at;
    expect(elapsed).toBeGreaterThanOrEqual(1_500);
    // Had it run through, it would have lost `elapsed`; it lost what ran before Alice left and nothing after
    expect(dropped.dropMs - bobNow.dropMs).toBeLessThanOrEqual(elapsed - 1_000);
    // Bob comes back, and the game is played to a normal end
    const bob = await aiPlayer(rig, 'Bob', 'away-b2', { token: bobToken, after: b });
    resume(alice, bob);
    await Promise.all([alice.done(), bob.done()]);
    await rig.runtime.settleAll();
    expect(alice.seat.result!.outcome).toMatch(/win|draw/);
    expect(alice.seat.refusals).toEqual([]);
    expect((await rig.store.results(new Date(0), 10)).find((r) => r.game === game)?.outcome).toMatch(/win|draw/);
  }, 240_000);

});

describe('M13-6 nobody connected for five minutes: the abandonment timer ends the game', () => {
  let rig: Rig;
  const warp = { ms: 0 };
  const realSetTimeout = globalThis.setTimeout as (fn: () => void, ms?: number, ...args: unknown[]) => ReturnType<typeof setTimeout>;

  // A runtime of its own: its timer wheel arms one real timer for the earliest deadline of all its tables, and keeps it while it is early enough; a timer
  // armed by an earlier game would stand in for this one's.
  beforeAll(async () => {
    rig = await makeRig({ workers: 1, now: () => Date.now() + warp.ms });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);
  afterEach(() => vi.restoreAllMocks());

  it('five minutes with nobody connected void the game ("abandoned"); a player who comes back is told, and the ledger has a void game without placements', async () => {
    const { a, b, game } = await pausedGame(rig, 'gone', 8);
    const tokens = [a.browser.token, b.browser.token];
    // the runtime's one long timer (the table's next deadline: the five minutes) runs in a moment of real time and moves the test clock by what it was set for
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
      if (typeof ms === 'number' && ms >= HOSTED_TIMING.abandonMs - 60_000 && ms <= HOSTED_TIMING.abandonMs + 60_000) {
        return realSetTimeout(() => {
          warp.ms += ms;
          fn();
        }, 25, ...args);
      }
      return realSetTimeout(fn, ms, ...args);
    }) as typeof setTimeout);
    a.browser.client.close();
    b.browser.client.close();
    // the table is void once the runtime has the ledger row for it
    for (let i = 0; i < 400 && (await rig.store.results(new Date(0), 20)).every((r) => r.game !== game); i++) await new Promise((r) => setTimeout(r, 50));
    const row = (await rig.store.results(new Date(0), 20)).find((r) => r.game === game)!;
    expect(row).toMatchObject({ game, outcome: 'void', reason: 'abandoned', placements: [] });
    expect(warp.ms).toBeGreaterThanOrEqual(HOSTED_TIMING.abandonMs - 60_000);
    vi.restoreAllMocks();
    expect(rig.gateway.tables.seatOf(a.browser.session)).toMatchObject({ table: game, status: 'over' });
    // Alice comes back: the table sends the full view and the void result (what a reconnecting seat is sent: welcome, view, clocks, and the result of a game that has ended)
    const alice = await aiPlayer(rig, 'Alice', 'gone-a2', { token: tokens[0]! });
    expect(alice.browser.last('welcome')).toMatchObject({ resumed: true, table: game, seat: 1 });
    await alice.done();
    expect(alice.seat.result).toMatchObject({ outcome: 'void', reason: 'abandoned', result: null, placements: [] });
    // a void game is nobody's history (no placements)
    expect(await alice.browser.cmd({ t: 'history' })).toMatchObject({ ok: true, history: [] });
    // and she may sit down at a new table
    const bob = await aiPlayer(rig, 'Bob', 'gone-b2', { token: tokens[1]! });
    const next = await createTable(bob.browser, { deck: deckOf(DECKS[2]!) });
    expect(await alice.browser.cmd({ t: 'join', table: next.table, deck: deckOf(DECKS[0]!) })).toMatchObject({ ok: true });
  }, 120_000);
});

describe('M13-6 Leave during a game is a concession (CR 104.3a)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = await makeRig({ workers: 1 });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('the leaver loses ("left"), the other seat wins at once and is told; the leaver may sit down elsewhere; coming back shows no table', async () => {
    const { a, b, game } = await pausedGame(rig, 'leave', 6);
    const reply = b.browser.client.until(() => b.browser.of('reply').some((r) => r.id === 600));
    b.browser.client.send({ t: 'leave', id: 600 });
    await reply;
    expect(b.browser.of('reply').find((r) => r.id === 600)).toMatchObject({ ok: true });
    await a.done();
    expect(a.seat.result).toMatchObject({ outcome: 'win' });
    expect(a.seat.result!.placements.find((p) => p.seat === 2)).toMatchObject({ place: 2, loss: 'left' });
    expect(a.seat.result!.placements.find((p) => p.seat === 1)).toMatchObject({ place: 1, loss: null });
    expect(a.browser.of('notice').map((n) => n.kind)).toContain('playerLeft');
    await rig.runtime.settleAll();
    const row = (await rig.store.results(new Date(0), 10)).find((r) => r.game === game)!;
    expect(row.placements.find((p) => p.session === b.browser.session)).toMatchObject({ loss: 'left' });
    // Bob is out of the game: coming back he has no table, and another is open to him at once
    expect(rig.gateway.tables.busyIn(b.browser.session)).toBeNull();
    const bobBack = await aiPlayer(rig, 'Bob', 'leave-b2', { token: b.browser.token, after: b });
    expect(bobBack.browser.last('welcome')).toMatchObject({ resumed: true });
    expect(bobBack.browser.last('welcome')!.table).toBeUndefined();
    expect(bobBack.browser.last('welcome')!.seat).toBeUndefined();
    const eve = await aiPlayer(rig, 'Eve', 'leave-eve');
    const next = await createTable(eve.browser, { deck: deckOf(DECKS[2]!) });
    expect(await bobBack.browser.cmd({ t: 'join', table: next.table, deck: deckOf(DECKS[1]!) })).toMatchObject({ ok: true });
    // the winner still has her table (it stays for good-game chat)
    expect(rig.gateway.tables.seatOf(a.browser.session)).toMatchObject({ table: game });
  }, 180_000);
});
