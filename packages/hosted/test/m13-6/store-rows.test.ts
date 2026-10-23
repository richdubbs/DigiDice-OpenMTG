/**
 * M13-6: the two store methods the tables layer added (`tableRow`, `openTables`; INTERFACE CHANGE, additive), against the memory, file and PostgreSQL
 * (PGlite) stores with M13-4's kits: what a restart reads back of the unstarted tables and of a started game's row and seats, without the seed or the
 * config. In process only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HostedDeck } from '../../src/api';
import type { NewGameRow, SeatRow } from '../../src/store/api';
import type { HostedStore } from '../../src/store';
import { at, gameRecord, newGame, record, startRow, T0 } from '../m13-4/fixtures';
import { KITS, type StoreKit } from '../m13-4/kits';

const HEX = (c: string) => c.repeat(64);

const deck: HostedDeck = {
  main: [{ name: 'Forest', count: 20 }, { name: 'Zoë’s Café 🎲', count: 4 }],
  sideboard: [{ name: 'Lurrus of the Dream-Den', count: 1 }],
  commander: [{ name: 'Atraxa, Praetors\' Voice', count: 1 }],
  companion: [{ name: 'Lurrus of the Dream-Den', count: 1 }],
};

/** A table with both seats sat (decks, fingerprints, one invite hash left over) and a password. */
function table(id: string, createdAt: Date, o: Partial<NewGameRow> = {}): NewGameRow {
  const seat = (n: 1 | 2, session: string | null): SeatRow => ({
    seat: n, player: null, session, name: session ? `Ünï ${n}` : null, deck: session ? deck : null, deckHash: session ? HEX(String(n)) : null,
    inviteHash: session ? null : HEX('a'), joinedAt: session ? at(1_000 * n) : null, leftAt: null,
  });
  return {
    id, format: 'commander', variant: 'standard', seats: 2, source: 'private', title: '日本語のテーブル', passwordHash: HEX('b'), passwordSalt: 'c'.repeat(32), createdAt,
    seatRows: [seat(1, 's1'), seat(2, null)], ...o,
  } as NewGameRow;
}

for (const factory of KITS) {
  describe(`M13-6 table rows and open tables: ${factory.name}`, { timeout: 30_000 }, () => {
    let kit: StoreKit;
    let s: HostedStore;
    beforeAll(() => factory.setup(), 60_000);
    afterAll(() => factory.teardown());
    beforeEach(async () => {
      kit = await factory.make(() => T0);
      s = kit.store;
    });
    afterEach(() => kit.done());

    it('an unknown game has no row', async () => {
      expect(await s.tableRow('nope')).toBeNull();
      expect(await s.openTables()).toEqual([]);
    });

    it('a new table reads back as it was made (text in any script, decks with every section, invite hash, password hash and salt), unstarted', async () => {
      const g = table('g1', at(0));
      await s.createGame(g);
      const row = (await s.tableRow('g1'))!;
      expect(row).toEqual({ ...g, status: 'lobby', waitingSince: null, startedAt: null, seating: null });
      expect(row.seatRows[0]!.deck).toEqual(deck);
      expect(row.seatRows[1]).toMatchObject({ session: null, name: null, deck: null, deckHash: null, inviteHash: HEX('a') });
    });

    it('a changed lobby (a seat sat, waiting for capacity) reads back; a restart sees the same', async () => {
      await s.createGame(table('g1', at(0)));
      const sat = table('g1', at(0)).seatRows.map((r, i) => (i === 1 ? { ...r, session: 's2', name: 'Two', deck, deckHash: HEX('2'), inviteHash: null, joinedAt: at(5_000) } : r));
      await s.updateLobby('g1', { seatRows: sat, status: 'waitingCapacity', waitingSince: at(7_000) });
      const check = async (store: HostedStore) => {
        const row = (await store.tableRow('g1'))!;
        expect(row).toMatchObject({ status: 'waitingCapacity', waitingSince: at(7_000), startedAt: null, seating: null });
        expect(row.seatRows[1]).toMatchObject({ seat: 2, session: 's2', name: 'Two', deckHash: HEX('2'), inviteHash: null, joinedAt: at(5_000) });
        expect(row.seatRows[0]!.inviteHash).toBeNull();
      };
      await check(s);
      s = await kit.reopen();
      await check(s);
      await s.updateLobby('g1', { status: 'lobby', waitingSince: null });
      s = await kit.reopen();
      expect(await s.tableRow('g1')).toMatchObject({ status: 'lobby', waitingSince: null });
    });

    it('a started game keeps its row and seats, and the row has neither the seed nor the config', async () => {
      await s.createGame(table('g1', at(0)));
      await s.startGame('g1', startRow(at(20)));
      await s.appendRecords([record('g1', 1)]);
      const check = async (store: HostedStore) => {
        const row = (await store.tableRow('g1'))!;
        expect(row).toMatchObject({ status: 'running', startedAt: at(20), seating: [2, 1], format: 'commander', variant: 'standard', seats: 2 });
        expect(row.seatRows.map((r) => r.session)).toEqual(['s1', null]);
        const text = JSON.stringify(row);
        expect(text).not.toContain(startRow().seed);
        expect(text).not.toContain('"config"');
        expect(text).not.toContain('"seed"');
        expect(text).not.toContain('zzLongKey');
      };
      await check(s);
      await check(await kit.reopen());
    });

    it('a game that ended keeps its row with its status (finished, void)', async () => {
      await s.createGame(table('done', at(0), { seatRows: [table('x', at(0)).seatRows[0]!, { ...table('x', at(0)).seatRows[1]!, session: 's2', name: 'Two', deck, deckHash: HEX('2'), inviteHash: null, joinedAt: at(2) }] }));
      await s.startGame('done', startRow(at(20)));
      await s.appendRecords([record('done', 1)]);
      await s.finishGame('done', gameRecord('done', at(90_000)));
      await s.createGame(table('void', at(1)));
      await s.voidGame('void', 'abandoned');
      expect((await s.tableRow('done'))!.status).toBe('finished');
      expect((await s.tableRow('void'))!.status).toBe('void');
      expect(await s.openTables()).toEqual([]);
    });

    it('open tables are the unstarted ones (lobby and waiting for capacity), oldest first, then by id; started, finished and void ones are not there', async () => {
      await s.createGame(table('c', at(3_000)));
      await s.createGame(table('a', at(1_000)));
      await s.createGame(table('b2', at(2_000)));
      await s.createGame(table('b1', at(2_000)));
      await s.createGame(table('w', at(500)));
      await s.updateLobby('w', { status: 'waitingCapacity', waitingSince: at(600) });
      await s.createGame(table('started', at(100)));
      await s.startGame('started', startRow(at(200)));
      await s.createGame(table('voided', at(50)));
      await s.voidGame('voided', 'abandoned');
      const order = (await s.openTables()).map((r) => r.id);
      expect(order).toEqual(['w', 'a', 'b1', 'b2', 'c']);
      s = await kit.reopen();
      expect((await s.openTables()).map((r) => r.id)).toEqual(order);
      // the same rows as `tableRow` gives
      for (const r of await s.openTables()) expect(r).toEqual(await s.tableRow(r.id));
      expect((await s.openTables()).find((r) => r.id === 'w')).toMatchObject({ status: 'waitingCapacity', waitingSince: at(600) });
    });

    it('the password hash and salt are deleted with the table (design 4.3): when it starts, and when it is voided; a lobby table keeps them', async () => {
      await s.createGame(table('lobby', at(0)));
      await s.createGame(table('starts', at(1)));
      await s.createGame(table('closes', at(2)));
      expect(await s.tableRow('lobby')).toMatchObject({ passwordHash: HEX('b'), passwordSalt: 'c'.repeat(32) });
      // the table that starts: no hash and no salt in its row afterwards, nor after it finishes
      await s.startGame('starts', startRow(at(20)));
      expect(await s.tableRow('starts')).toMatchObject({ status: 'running', passwordHash: null, passwordSalt: null });
      await s.appendRecords([record('starts', 1)]);
      await s.finishGame('starts', gameRecord('starts', at(90_000)));
      expect(await s.tableRow('starts')).toMatchObject({ status: 'finished', passwordHash: null, passwordSalt: null });
      // the table that closes (or expires): voided with no ledger row
      await s.voidGame('closes', 'abandoned');
      expect(await s.tableRow('closes')).toMatchObject({ status: 'void', passwordHash: null, passwordSalt: null });
      // a restart reads the same, and the open table still has its password
      s = await kit.reopen();
      expect(await s.tableRow('starts')).toMatchObject({ passwordHash: null, passwordSalt: null });
      expect(await s.tableRow('closes')).toMatchObject({ passwordHash: null, passwordSalt: null });
      expect(await s.tableRow('lobby')).toMatchObject({ passwordHash: HEX('b'), passwordSalt: 'c'.repeat(32) });
      // a started game that is voided later has none either
      await s.createGame(table('late', at(3)));
      await s.startGame('late', startRow(at(30)));
      await s.voidGame('late', 'commit');
      expect(await s.tableRow('late')).toMatchObject({ status: 'void', passwordHash: null, passwordSalt: null });
    });

    it('markSeatLeft: a seat that left a started game reads back as left, once; unknown games and seats are notFound; a restart sees it', async () => {
      const sat = (g: NewGameRow): NewGameRow => ({ ...g, seatRows: g.seatRows.map((r) => (r.session === null ? { ...r, session: 's2', name: 'Two', deck, deckHash: HEX('2'), inviteHash: null, joinedAt: at(5_000) } : r)) });
      await s.createGame(sat(table('g1', at(0))));
      await s.startGame('g1', startRow(at(20)));
      expect((await s.tableRow('g1'))!.seatRows.map((r) => r.leftAt)).toEqual([null, null]);
      await s.markSeatLeft('g1', 2, at(60_000));
      expect((await s.tableRow('g1'))!.seatRows.map((r) => r.leftAt)).toEqual([null, at(60_000)]);
      // the first time stays (the call may be repeated)
      await s.markSeatLeft('g1', 2, at(90_000));
      expect((await s.tableRow('g1'))!.seatRows[1]!.leftAt).toEqual(at(60_000));
      // nothing else of the row moved
      expect(await s.tableRow('g1')).toMatchObject({ status: 'running', seatRows: [{ session: 's1', deckHash: HEX('1') }, { session: 's2', deckHash: HEX('2') }] });
      s = await kit.reopen();
      expect((await s.tableRow('g1'))!.seatRows.map((r) => r.leftAt)).toEqual([null, at(60_000)]);
      await expect(s.markSeatLeft('nope', 1, at(1))).rejects.toMatchObject({ code: 'notFound' });
      await expect(s.markSeatLeft('g1', 4, at(1))).rejects.toMatchObject({ code: 'notFound' });
    });

    it('a table without a password reads back with none; a matched table has no creator seat', async () => {
      await s.createGame(table('m', at(0), { source: 'matched', passwordHash: null, passwordSalt: null }));
      expect(await s.tableRow('m')).toMatchObject({ source: 'matched', passwordHash: null, passwordSalt: null });
      expect((await s.openTables()).map((r) => [r.id, r.source])).toEqual([['m', 'matched']]);
    });
  });
}
