/**
 * M13-6: computer players play whole games through the gateway (design 13.1 M13-6, 6.4), in process: the real runtime (game workers, deck pool, store), the
 * gateway and its tables as main.ts wires them, browsers on the in-process transport that speak the protocol (hello, create or join, the ready check, views
 * and patches, actions, replies) and choose with `@openmtg/ai` from their own seat's view. A listed table and a private table (invite code) play at once.
 *
 * Design 6.4, the whole stack: every frame sent to a seat is searched for any trace of what that seat may not know: the real ids and names of the other
 * seat's hidden cards, the seed, the RNG state, a suspended action, the other seat's session id, token, deck fingerprint and decklist; an unseated
 * connection receives nothing of the game at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicPlacements } from '../../src/ledger/types';
import { aiPlayer, Browser, createTable, DECKS, deckOf, FakePasswords, preparedDeck, freshPeer, makeRig, scanSeatFrames, unseenOf, type AiPlayer, type Rig, type SeatSecrets } from './harness';

interface Played {
  game: string;
  seats: [AiPlayer, AiPlayer];
  decks: [ReturnType<typeof deckOf>, ReturnType<typeof deckOf>];
}

describe('M13-6 computer players through the gateway: a listed table and a private table at once', () => {
  let rig: Rig;
  let watcher: Browser;
  const played: Played[] = [];

  beforeAll(async () => {
    rig = await makeRig({ workers: 2 });
    // someone who is connected and sits nowhere, all the while
    watcher = Browser.connect(rig.transport, { peer: freshPeer() });
    await watcher.hello('Watcher');

    const decks = [deckOf(DECKS[0]!), deckOf(DECKS[1]!), deckOf(DECKS[2]!), deckOf(DECKS[0]!)] as const;
    const [a, b, c, d] = [
      await aiPlayer(rig, 'Alice', 'one-a'), await aiPlayer(rig, 'Bob', 'one-b'), await aiPlayer(rig, 'Carol', 'two-a'), await aiPlayer(rig, 'Dave', 'two-b'),
    ];
    // game one: a listed table joined by its id; game two: a private table joined with the creator's invite code
    const one = await createTable(a.browser, { deck: decks[0] });
    const two = await createTable(c.browser, { visibility: 'private', deck: decks[2] });
    expect(two.codes).toHaveLength(1);
    expect(await b.browser.cmd({ t: 'join', table: one.table, deck: decks[1] })).toMatchObject({ ok: true });
    expect(await d.browser.cmd({ t: 'join', code: two.codes[0]!, deck: decks[3] })).toMatchObject({ ok: true });
    played.push({ game: one.table, seats: [a, b], decks: [decks[0], decks[1]] }, { game: two.table, seats: [c, d], decks: [decks[2], decks[3]] });
    await Promise.all([a, b, c, d].map((p) => p.done()));
    await rig.runtime.settleAll();
  }, 300_000);

  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('both games play to the end: every seat gets the same result, no command was refused, and the unseated connection heard nothing of them', () => {
    for (const g of played) {
      const [a, b] = g.seats;
      expect(a.seat.result, g.game).not.toBeNull();
      expect(a.seat.result).toEqual(b.seat.result);
      expect(a.seat.result!.outcome).toMatch(/win|draw/);
      expect(a.seat.result!.placements).toHaveLength(2);
      expect(a.seat.refusals, `${g.game} seat 1`).toEqual([]);
      expect(b.seat.refusals, `${g.game} seat 2`).toEqual([]);
      expect(a.seat.moves).toBeGreaterThan(5);
      expect(b.seat.moves).toBeGreaterThan(5);
      // each seat hears its own table: the full view first, then patches
      expect(a.browser.of('start')).toHaveLength(1);
      expect(a.browser.of('view').length).toBeGreaterThanOrEqual(1);
      expect(a.browser.of('patch').length).toBeGreaterThan(5);
      expect(a.browser.of('clock').length).toBeGreaterThan(0);
    }
    // the connection that sits nowhere got its welcome and nothing else (no table, no view, no patch, no result, no clock)
    expect(watcher.messages().map((m) => m.t)).toEqual(['welcome']);
  });

  it('the ledger has both games with the sessions of the players; each player\'s history shows the game and no one else\'s secrets', async () => {
    const rows = await rig.store.results(new Date(0), 10);
    expect(rows.map((r) => r.game).sort()).toEqual(played.map((g) => g.game).sort());
    for (const g of played) {
      const row = rows.find((r) => r.game === g.game)!;
      expect(row.placements.map((p) => p.session).sort()).toEqual(g.seats.map((s) => s.browser.session).sort());
      expect(row).toMatchObject({ format: 'casual', seats: 2, ranked: false, engineBuild: 'build-test' });
      expect(row.source).toBe(g.game === played[0]!.game ? 'listed' : 'private');
      // the result the seats were sent is the record's public projection
      expect(g.seats[0].seat.result!.placements).toEqual(publicPlacements(row.placements));
      for (const p of g.seats) {
        const r = await p.browser.cmd({ t: 'history' });
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        expect(r.history).toHaveLength(1);
        expect(r.history![0]).toMatchObject({ game: g.game, format: 'casual', source: row.source, ranked: false, outcome: row.outcome });
        const own = row.placements.find((x) => x.session === p.browser.session)!;
        expect(r.history![0]!.you).toEqual({ seat: own.seat, name: own.name, place: own.place, loss: own.loss, lossRule: own.lossRule, outTurn: own.outTurn });
        const text = JSON.stringify(r.history);
        for (const other of row.placements) {
          if (other.session === p.browser.session) continue;
          expect(text).not.toContain(other.session);
          expect(text).not.toContain(other.deckHash);
        }
      }
    }
  });

  it('design 6.4, the whole stack: nothing a seat was sent holds anything of the other seat\'s hidden cards, the seed, the RNG, a suspended action, or the other seat\'s session, token, fingerprint or decklist', async () => {
    for (const g of played) {
      const stored = await rig.store.loadForRecovery(g.game, { ignoreSnapshots: true });
      const row = (await rig.store.tableRow(g.game))!;
      const config = { ...stored.config, seed: stored.seed };
      const secrets = (i: 0 | 1): SeatSecrets => ({
        session: g.seats[i].browser.session, token: g.seats[i].browser.token, deckHash: row.seatRows[i]!.deckHash!, deck: g.decks[i],
      });
      for (const i of [0, 1] as const) {
        const me = g.seats[i];
        const scanned = scanSeatFrames({ config, records: stored.records, frames: me.frames, player: me.seat.player!, others: [secrets(i === 0 ? 1 : 0)] });
        // every frame of a whole game was checked
        expect(scanned, `${g.game} seat ${i + 1}`).toBe(me.frames.length);
        expect(scanned).toBeGreaterThan(20);
      }
      // The scan is not blind: a frame that did carry one of these things fails it.
      const me = g.seats[0];
      const base = { config, records: stored.records, player: me.seat.player!, others: [secrets(1)] };
      const leak = (text: string) => () => scanSeatFrames({ ...base, frames: [...me.frames, text] });
      expect(leak(JSON.stringify({ t: 'notice', kind: 'degraded', text: secrets(1).session }))).toThrow();
      expect(leak(JSON.stringify({ t: 'notice', kind: 'degraded', text: secrets(1).token }))).toThrow();
      expect(leak(JSON.stringify({ t: 'notice', kind: 'degraded', text: secrets(1).deckHash }))).toThrow();
      expect(leak(JSON.stringify({ t: 'notice', kind: 'degraded', text: stored.seed }))).toThrow();
      expect(leak('{"t":"notice","kind":"degraded","text":"x","suspended":{}}')).toThrow();
      expect(leak(`{"t":"notice","kind":"degraded","text":"x","deck":${JSON.stringify(secrets(1).deck.main)}}`)).toThrow();
      // ... nor a card of the other seat's hand or library that this seat was never shown (its real id, its name)
      const unseen = unseenOf({ config, records: stored.records, frames: me.frames, player: me.seat.player! });
      expect(unseen.libraryNames.length).toBeGreaterThan(0);
      expect(leak(JSON.stringify({ t: 'notice', kind: 'degraded', text: `you draw ${unseen.libraryNames[0]}` }))).toThrow();
      if (unseen.handIds.length > 0) expect(leak(JSON.stringify({ t: 'notice', kind: 'degraded', text: 'x', card: unseen.handIds[0] }))).toThrow();
    }
  }, 120_000);

  it('the server\'s own log of two whole games holds no token, invite code, deck fingerprint or card name of a hand', async () => {
    const log = rig.logger.lines.join('\n');
    for (const g of played) {
      const row = (await rig.store.tableRow(g.game))!;
      for (const p of g.seats) {
        expect(log).not.toContain(p.browser.token);
      }
      for (const s of row.seatRows) expect(log).not.toContain(s.deckHash!);
    }
    for (const name of ['Lightning Bolt', 'Serra Angel', 'Counterspell', 'Garruk Wildspeaker']) expect(log, name).not.toContain(name);
  });

  it('a table that has ended is still there for good-game chat: the table says so, chat reaches both seats, and a new table may be made', async () => {
    const [a, b] = played[0]!.seats;
    expect(a.browser.last('table')!.table.status).toBe('over');
    const before = b.browser.of('chat').length;
    a.browser.client.send({ t: 'chat', id: 500, text: 'good game' });
    await b.browser.client.until(() => b.browser.of('chat').length > before);
    expect(b.browser.of('chat').at(-1)).toEqual({ t: 'chat', from: 1, text: 'good game' });
    expect(a.browser.of('chat').at(-1)).toEqual({ t: 'chat', from: 1, text: 'good game' });
    // an ended game is not "a game": Alice may sit down at another table (she leaves the old one by doing so)
    const eve = (await aiPlayer(rig, 'Eve', 'chat-eve')).browser;
    const next = await createTable(eve, { deck: deckOf(DECKS[0]!) });
    expect(await a.browser.cmd({ t: 'join', table: next.table, deck: deckOf(DECKS[1]!) })).toMatchObject({ ok: true, table: next.table });
    expect(rig.gateway.tables.seatOf(a.browser.session)).toMatchObject({ table: next.table, status: 'readyCheck' });
  });
});

describe('M13-6 decks through the real deck pool', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = await makeRig({ workers: 1 });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('an unknown card is refused with the problem listed; a legal deck sits (and warnings, if any, come back)', async () => {
    const a = (await aiPlayer(rig, 'Alice', 'deck-a')).browser;
    const bad = await a.cmd({ t: 'create', format: 'casual', seats: 2, visibility: 'listed', deck: { main: [{ name: 'Not A Real Card Name', count: 60 }], sideboard: [] } });
    expect(bad).toMatchObject({ ok: false, error: { code: 'deckRejected' } });
    if (!bad.ok) expect(bad.error.details!.join(' ')).toContain('Unknown card');
    expect(rig.gateway.tables.counts().lobby).toBe(0);
    const c = (await aiPlayer(rig, 'Carol', 'deck-c')).browser;
    const { table } = await createTable(c, { deck: deckOf(DECKS[0]!) });
    expect(table).toBeTruthy();
    // a deck too small for a Standard table is refused, with the reasons
    const b = (await aiPlayer(rig, 'Bob', 'deck-b')).browser;
    const small = await b.cmd({ t: 'create', format: 'standard', seats: 2, visibility: 'listed', deck: { main: [{ name: 'Forest', count: 10 }], sideboard: [] } });
    expect(small).toMatchObject({ ok: false, error: { code: 'deckRejected' } });
    if (!small.ok) expect(small.error.details!.length).toBeGreaterThan(0);
    expect(rig.gateway.tables.listings()).toHaveLength(1);
    expect(rig.gateway.tables.listings()[0]).toMatchObject({ table, filled: 1 });
  });
});

describe('M13-6 a locked table that starts leaves no password behind (design 4.3)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = await makeRig({ workers: 1, passwords: new FakePasswords() });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('the hash and the salt are in the row while the table waits and gone from it once the game runs', async () => {
    const a = await aiPlayer(rig, 'Alice', 'pw-a');
    const b = await aiPlayer(rig, 'Bob', 'pw-b');
    a.seat.limit = 2;
    b.seat.limit = 2;
    const { table } = await createTable(a.browser, { password: 'open sesame', deck: deckOf(DECKS[0]!) });
    expect(await rig.store.tableRow(table)).toMatchObject({ status: 'lobby', passwordHash: expect.stringMatching(/^[0-9a-f]{64}$/), passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(await b.browser.cmd({ t: 'join', table, password: 'open sesame', deck: deckOf(DECKS[1]!) })).toMatchObject({ ok: true });
    await a.browser.client.until(() => a.browser.of('start').length > 0 && b.browser.of('start').length > 0);
    const row = (await rig.store.tableRow(table))!;
    expect(row).toMatchObject({ status: 'running', passwordHash: null, passwordSalt: null });
    expect(rig.gateway.tables.listings()).toEqual([]);
  });
});

describe('M13-6 a game that cannot be configured gives the players a fixed text (review 8)', () => {
  let rig: Rig;
  beforeAll(async () => {
    rig = await makeRig({ workers: 1 });
  }, 120_000);
  afterAll(async () => {
    await rig?.close();
  }, 60_000);

  it('the runtime answers failed with a fixed message and logs the error by name; no engine text leaves it', async () => {
    const seat = (n: 1 | 2) => ({ seat: n, name: `P${n}`, session: `s${n}`, deck: preparedDeck(DECKS[0]!), deckHash: 'a'.repeat(64) });
    // a seat given twice: tableConfig refuses it with its own error text
    const r = await rig.runtime.start({ game: 'G1', format: 'casual', source: 'listed', seats: [seat(1), seat(1)] });
    expect(r).toEqual({ ok: false, reason: 'failed', message: 'The game could not start on the server.' });
    const logged = rig.logger.entries().find((e) => e['event'] === 'startFailed');
    expect(logged).toMatchObject({ game: 'G1', phase: 'config', error: 'Error' });
    expect(JSON.stringify(logged)).not.toContain('seat is given twice');
    // one seat only
    expect(await rig.runtime.start({ game: 'G2', format: 'casual', source: 'listed', seats: [seat(1)] })).toEqual({ ok: false, reason: 'failed', message: 'The game could not start on the server.' });
  });
});
