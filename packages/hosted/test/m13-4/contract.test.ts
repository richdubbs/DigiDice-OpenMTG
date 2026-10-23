/**
 * The storage contract suite (M13-4; design 8.1, 2.3, 8.3, review 2 and 8): the same tests against MemoryStore, FileStore and PostgresStore (PGlite in
 * process; also a real server when OPENMTG_TEST_PG_URL is set). In process only: no network, no database server needed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeResult } from '../../src/ledger';
import { VOID_REASONS } from '../../src/ledger/types';
import type { TableEnd } from '../../src/table';
import { ledgerGame, ledgerSeats } from '../m13-7/helpers';
import { GAME_STORE_METHODS, type LogRecord } from '../../src/store/api';
import { StoreError, type HostedStore } from '../../src/store';
import {
  action, at, DAY, gameRecord, newGame, record, records, report, running, seat, session, snapshot, startRow, storedConfig, T0,
} from './fixtures';
import { KITS, type StoreKit } from './kits';

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof StoreError ? e.code : `other: ${(e as Error).message}`;
  }
  return 'resolved';
};

for (const factory of KITS) {
  // fsync-heavy on a shared machine: a generous per-test timeout (the file store's tests take up to ~2 s alone)
  describe(`M13-4 store contract: ${factory.name}`, { timeout: 30_000 }, () => {
    let kit: StoreKit;
    let s: HostedStore;
    let clock = T0;
    beforeAll(() => factory.setup(), 60_000);
    afterAll(() => factory.teardown());
    beforeEach(async () => {
      clock = T0;
      kit = await factory.make(() => clock);
      s = kit.store;
    });
    afterEach(() => kit.done());

    it('implements every GameStore method and the extras', () => {
      for (const m of [...GAME_STORE_METHODS, 'countEngineError', 'setReportStatus'] as const) expect(typeof s[m], m).toBe('function');
    });

    describe('sessions', () => {
      it('stores, finds by token hash, touches and replaces a session; a token hash belongs to one session', async () => {
        await s.putSession(session('s1'));
        expect(await s.sessionByTokenHash('hash-s1')).toEqual(session('s1'));
        expect(await s.sessionByTokenHash('nope')).toBeNull();
        await s.touchSession('s1', at(5_000));
        expect((await s.sessionByTokenHash('hash-s1'))!.lastSeen).toEqual(at(5_000));
        await s.touchSession('unknown', at(1)); // a purged session: nothing to touch
        await s.putSession({ ...session('s1'), tokenHash: 'hash-new' });
        expect(await s.sessionByTokenHash('hash-s1')).toBeNull();
        expect((await s.sessionByTokenHash('hash-new'))!.id).toBe('s1');
        expect(await code(s.putSession(session('s2', T0, 'hash-new')))).toBe('exists');
        s = await kit.reopen();
        expect((await s.sessionByTokenHash('hash-new'))!.name).toBe('Name s1');
      });

      it('refuses text the database would refuse or change, and malformed ids', async () => {
        expect(await code(s.putSession({ ...session('s1'), name: 'a\u0000b' }))).toBe('value');
        expect(await code(s.putSession({ ...session('s1'), name: 'a\ud800b' }))).toBe('value');
        expect(await code(s.putSession(session('../evil')))).toBe('value');
        expect(await s.sessionByTokenHash('hash-s1')).toBeNull();
      });
    });

    describe('tables and games', () => {
      it('creates, updates and starts a table; status rules; the config comes back as the exact JSON text, without the seed', async () => {
        await s.createGame(newGame('g1'));
        expect(await code(s.createGame(newGame('g1')))).toBe('exists');
        expect(await code(s.loadForRecovery('g1'))).toBe('status'); // never started
        await s.updateLobby('g1', { title: 'New title', seatRows: [seat(1, 's1'), seat(2, 's2')], status: 'waitingCapacity', waitingSince: at(10) });
        expect(await code(s.updateLobby('nope', { title: 'x' }))).toBe('notFound');
        expect(await code(s.startGame('g1', { ...startRow(), config: { ...storedConfig(), seed: 'x' } as never }))).toBe('value');
        await s.startGame('g1', startRow(at(20)));
        expect(await code(s.startGame('g1', startRow()))).toBe('status');
        expect(await code(s.updateLobby('g1', { title: 'late' }))).toBe('status');
        s = await kit.reopen();
        const r = await s.loadForRecovery('g1');
        expect(JSON.stringify(r.config)).toBe(JSON.stringify(storedConfig()));
        expect(r).toMatchObject({ game: 'g1', status: 'running', seed: 'ab'.repeat(16), seating: [2, 1], engineBuild: 'build-1', snapshot: null, records: [], lastSeq: 0, recoveries: 0, engineErrors: 0 });
        expect('seed' in (r.config as object)).toBe(false);
      });

      it('waitingTables in their old order; runningGames by start, per node', async () => {
        for (const [id, w] of [['w1', 30], ['w2', 10], ['w3', 20]] as const) {
          await s.createGame(newGame(id));
          await s.updateLobby(id, { status: 'waitingCapacity', waitingSince: at(w) });
        }
        await s.createGame(newGame('lobby'));
        await s.updateLobby('w3', { status: 'lobby', waitingSince: null });
        await s.createGame(newGame('r1'));
        await s.startGame('r1', startRow(at(50), 'node-a'));
        await s.createGame(newGame('r2'));
        await s.startGame('r2', startRow(at(40), 'node-b'));
        s = await kit.reopen();
        expect(await s.waitingTables()).toEqual([{ id: 'w2', waitingSince: at(10) }, { id: 'w1', waitingSince: at(30) }]);
        expect(await s.runningGames()).toEqual(['r2', 'r1']);
        expect(await s.runningGames('node-a')).toEqual(['r1']);
        expect(await s.runningGames('node-c')).toEqual([]);
      });

      it('refuses text the database would refuse in the config at the start (review minor 4)', async () => {
        await s.createGame(newGame('g1'));
        for (const bad of ['nul\u0000', 'lone\ud800']) {
          expect(await code(s.startGame('g1', { ...startRow(), config: { ...storedConfig(), players: [{ id: 'p1', name: bad }] } as never }))).toBe('value');
        }
        expect(await code(s.loadForRecovery('g1'))).toBe('status');
        await s.startGame('g1', startRow());
      });

      it('refuses a seat given twice and text the database would refuse', async () => {
        expect(await code(s.createGame({ ...newGame('g1'), seatRows: [seat(1, 's1'), seat(1, 's2')] }))).not.toBe('resolved');
        expect(await code(s.createGame({ ...newGame('g2'), title: 'bad\u0000' }))).toBe('value');
        await s.createGame(newGame('g3'));
        const bad = seat(2, 's2');
        bad.deck!.main[0]!.name = 'Forest\ud800';
        expect(await code(s.updateLobby('g3', { seatRows: [seat(1, 's1'), bad] }))).toBe('value');
      });
    });

    describe('the action log', () => {
      it('appends and reads back records in order, exactly (key order, optional fields, clocks with actions, elapsedMs)', async () => {
        await running(s, 'g1');
        const r3 = record('g1', 3, { cause: 'approved', approvedBy: [1, 2], check: 'c'.repeat(64) });
        const batch1 = [record('g1', 1), record('g1', 2)];
        expect(await s.appendRecords(batch1)).toEqual({ committed: ['g1'], failed: [] });
        expect(await s.appendRecords([r3, record('g1', 4, { cause: 'timeout' })])).toEqual({ committed: ['g1'], failed: [] });
        expect(await s.appendRecords([])).toEqual({ committed: [], failed: [] });
        s = await kit.reopen();
        const r = await s.loadForRecovery('g1');
        expect(r.lastSeq).toBe(4);
        expect(r.records).toEqual([...batch1, r3, record('g1', 4, { cause: 'timeout' })]);
        expect(r.records.map((x) => JSON.stringify(x.action))).toEqual([1, 2, 3, 4].map((n) => JSON.stringify(action(n))));
        expect(Object.keys(r.records[0]!).sort()).toEqual(['action', 'at', 'clocks', 'elapsedMs', 'game', 'seat', 'seq']);
        expect(r.records[2]!.clocks[0]!.actions).toBe(2);
        expect(r.records[1]!.clocks[1]!.dropMs).toBe(120.5);
      });

      it('write-ahead order: a gap, a repeat, an unsorted batch, an unknown or unstarted game fail only that game; a commit is durable', async () => {
        await running(s, 'g1', 2);
        await running(s, 'g2', 0);
        await s.createGame(newGame('lobby'));
        const res = await s.appendRecords([
          record('g1', 4), // gap: expected 3
          record('g2', 1),
          record('lobby', 1),
          record('nope', 1),
          record('g2', 2),
        ]);
        expect(res.committed).toEqual(['g2']);
        expect(res.failed.map((f) => f.game)).toEqual(['g1', 'lobby', 'nope']);
        // a repeat of committed records: the same ones are a retried batch (an ambiguous commit) and count as committed; different ones fail
        expect(await s.appendRecords([record('g1', 1), record('g1', 2)])).toEqual({ committed: ['g1'], failed: [] });
        expect((await s.appendRecords([record('g1', 2, { seat: 9 })])).failed.map((f) => f.game)).toEqual(['g1']);
        expect((await s.appendRecords([record('g1', 2), record('g1', 3)])).failed.map((f) => f.game)).toEqual(['g1']); // half old, half new
        expect((await s.appendRecords([record('g1', 4), record('g1', 3)])).failed.map((f) => f.game)).toEqual(['g1']); // unsorted
        expect((await s.appendRecords([record('g1', 3), record('g1', 5)])).failed.map((f) => f.game)).toEqual(['g1']); // gap inside
        // durable once resolved: a restart sees exactly the committed records
        s = await kit.reopen();
        expect((await s.loadForRecovery('g1')).records.map((r) => r.seq)).toEqual([1, 2]);
        expect((await s.loadForRecovery('g2')).records.map((r) => r.seq)).toEqual([1, 2]);
        expect((await s.appendRecords([record('g1', 3)])).committed).toEqual(['g1']);
      });

      it('group commit isolation (review 2): a record with NUL and an unpaired surrogate fails only its game; the others commit; the game can retry', async () => {
        await running(s, 'a', 1);
        await running(s, 'b', 1);
        await running(s, 'c', 1);
        const poisoned: LogRecord = {
          ...record('b', 2),
          action: { type: 'answer', answer: { kind: 'chooseName', name: 'Bad\u0000name\ud800' }, player: 'p2' } as never,
        };
        const res = await s.appendRecords([record('a', 2), poisoned, record('c', 2), record('b', 3), record('a', 3), record('c', 3)]);
        expect(res.committed).toEqual(['a', 'c']);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]!.game).toBe('b');
        // each problem alone is refused too (jsonb refuses either escape)
        let aSeq = 4;
        for (const name of ['nul\u0000', 'lone\ud800', 'low\udc00x']) {
          const r = await s.appendRecords([{ ...record('b', 2), action: { type: 'answer', answer: { kind: 'chooseName', name }, player: 'p2' } as never }, record('a', aSeq++)]);
          expect(r.committed).toEqual(['a']);
          expect(r.failed.map((f) => f.game)).toEqual(['b']);
        }
        const key = await s.appendRecords([{ ...record('b', 2), action: { type: 'concede', ['k\u0000']: 1 } as never }]);
        expect(key.failed.map((f) => f.game)).toEqual(['b']);
        s = await kit.reopen();
        expect((await s.loadForRecovery('a')).lastSeq).toBe(6);
        expect((await s.loadForRecovery('c')).lastSeq).toBe(3);
        const b = await s.loadForRecovery('b');
        expect(b.lastSeq).toBe(1);
        expect(b.records).toEqual([record('b', 1)]);
        // a paired surrogate (an emoji) is fine, and the game goes on after the refusal
        const ok = { ...record('b', 2), action: { type: 'answer', answer: { kind: 'chooseName', name: 'Good 😀' }, player: 'p2' } as never };
        expect(await s.appendRecords([ok])).toEqual({ committed: ['b'], failed: [] });
        expect((await s.loadForRecovery('b')).records[1]).toEqual(ok);
      });
    });

    describe('snapshots (review 8)', () => {
      it('only for a committed seq; recovery takes the newest not past the last commit and the records after it', async () => {
        await running(s, 'g1', 5);
        expect(await code(s.putSnapshot(snapshot('g1', 6)))).toBe('order');
        expect(await code(s.putSnapshot(snapshot('nope', 1)))).toBe('notFound');
        await s.putSnapshot(snapshot('g1', 2));
        await s.putSnapshot(snapshot('g1', 4));
        await kit.forceSnapshot(snapshot('g1', 7)); // as a crash between a snapshot and its commit could leave
        s = await kit.reopen();
        const r = await s.loadForRecovery('g1');
        expect(r.snapshot).toEqual(snapshot('g1', 4));
        expect(r.snapshot!.state).toBeInstanceOf(Uint8Array);
        expect(r.records.map((x) => x.seq)).toEqual([5]);
        expect(r.lastSeq).toBe(5);
        // once 7 is committed, the snapshot at 7 is valid
        await s.appendRecords(records('g1', 6, 8));
        const r2 = await s.loadForRecovery('g1');
        expect(r2.snapshot!.seq).toBe(7);
        expect(r2.records.map((x) => x.seq)).toEqual([8]);
      });

      it('a snapshot past every commit is ignored entirely: recovery from the start', async () => {
        await running(s, 'g1', 1);
        await kit.forceSnapshot(snapshot('g1', 3));
        const r = await s.loadForRecovery('g1');
        expect(r.snapshot).toBeNull();
        expect(r.records.map((x) => x.seq)).toEqual([1]);
      });
    });

    describe('recovery reads (review MAJOR, minor 8)', () => {
      it('a log that does not cover the committed records exactly is refused as corrupt, never returned short', async () => {
        for (const [game, drop, snap] of [['mid', 2, 0], ['last', 4, 0], ['after-snap', 3, 2]] as const) {
          await running(s, game, 4);
          if (snap) await s.putSnapshot(snapshot(game, snap));
          await kit.dropRecord(game, drop);
          expect(await code(s.loadForRecovery(game)), game).toBe('corrupt');
        }
        // a record lost before the snapshot: a recovery from the start is refused; one from the snapshot either goes on (the stores that read only
        // the range) or is refused too (the file store reads, and checks, its whole log): never a short log either way
        await running(s, 'before-snap', 4);
        await s.putSnapshot(snapshot('before-snap', 3));
        await kit.dropRecord('before-snap', 1);
        expect(await code(s.loadForRecovery('before-snap', { ignoreSnapshots: true }))).toBe('corrupt');
        const fromSnap = await s.loadForRecovery('before-snap').then((r) => r.records.map((x) => x.seq), (e: unknown) => (e as StoreError).code);
        expect([[4], 'corrupt']).toContainEqual(fromSnap);
      });

      it('ignoreSnapshots: no snapshot, every record from the start (another engine build replays from the log)', async () => {
        await running(s, 'g1', 5);
        await s.putSnapshot(snapshot('g1', 4));
        const r = await s.loadForRecovery('g1', { ignoreSnapshots: true });
        expect(r.snapshot).toBeNull();
        expect(r.records).toEqual(records('g1', 1, 5));
        expect((await s.loadForRecovery('g1')).snapshot!.seq).toBe(4);
      });
    });

    describe('recovery counts', () => {
      it('countRecovery and countEngineError count up and come back with the recovery data', async () => {
        await running(s, 'g1', 1);
        expect(await s.countRecovery('g1')).toBe(1);
        expect(await s.countRecovery('g1')).toBe(2);
        expect(await s.countEngineError('g1')).toBe(1);
        expect(await code(s.countRecovery('nope'))).toBe('notFound');
        s = await kit.reopen();
        expect(await s.loadForRecovery('g1')).toMatchObject({ recoveries: 2, engineErrors: 1 });
      });
    });

    describe('ending games and the ledger', () => {
      it('finishGame: the final record, the result with its placements and the status in one step; snapshots go', async () => {
        await running(s, 'g1', 3);
        await s.putSnapshot(snapshot('g1', 2));
        const rec = gameRecord('g1', at(60_000));
        expect(await code(s.finishGame('g1', { ...rec, game: 'g2' }))).toBe('value');
        expect(await code(s.finishGame('g1', rec, record('g1', 5)))).toBe('order'); // the last record must continue the log
        expect((await s.loadForRecovery('g1')).status).toBe('running');
        await s.finishGame('g1', rec, record('g1', 4));
        // a retry of the same finish (an ambiguous commit) succeeds and changes nothing; a different result is refused (append-only)
        expect(await code(s.finishGame('g1', rec, record('g1', 4)))).toBe('resolved');
        expect(await code(s.finishGame('g1', rec))).toBe('resolved');
        expect(await code(s.finishGame('g1', { ...rec, reason: 'other' }))).toBe('exists');
        expect(await code(s.finishGame('g1', rec, record('g1', 4, { seat: 9 })))).toBe('exists');
        expect(await code(s.finishGame('g1', rec, record('g1', 5)))).toBe('exists');
        expect((await s.appendRecords([record('g1', 5)])).failed.map((f) => f.game)).toEqual(['g1']);
        s = await kit.reopen();
        const r = await s.loadForRecovery('g1');
        expect(r.status).toBe('finished');
        expect(r.lastSeq).toBe(4);
        expect(r.snapshot).toBeNull();
        expect(await s.runningGames()).toEqual([]);
        const [res] = await s.results(T0, 10);
        expect(res).toEqual({ ...rec, placements: [...rec.placements].sort((a, b) => a.seat - b.seat) });
        expect(res!.placements.map((p) => p.seat)).toEqual([1, 2]);
      });

      it('finishGame with a void record (a cap reached): status void, no placements', async () => {
        await running(s, 'g1', 1);
        await s.finishGame('g1', gameRecord('g1', at(1000), { outcome: 'void', reason: 'limit', placements: [] }));
        expect((await s.loadForRecovery('g1')).status).toBe('void');
        expect((await s.results(T0, 10))[0]).toMatchObject({ outcome: 'void', reason: 'limit', placements: [] });
      });

      it('voidGame: every reason; a running game gets a void ledger row, a lobby table none; quarantined; over is over', async () => {
        clock = at(99_000);
        for (const reason of VOID_REASONS) await running(s, `v-${reason}`, 2);
        for (const reason of VOID_REASONS) await s.voidGame(`v-${reason}`, reason);
        await running(s, 'q', 3);
        await s.putSnapshot(snapshot('q', 3));
        await s.voidGame('q', 'quarantined', 'quarantined');
        await s.createGame(newGame('lobby'));
        await s.voidGame('lobby', 'abandoned');
        await running(s, 'done', 1);
        await s.finishGame('done', gameRecord('done', at(1)));
        await s.voidGame('done', 'commit'); // already finished: nothing changes
        await s.voidGame('q', 'abandoned'); // already quarantined: nothing changes
        // a game already over is left as it is, whatever record comes with the call (review minor 8: checked only when it is written)
        await s.voidGame('done', 'commit', 'void', gameRecord('other', at(1)));
        expect(await code(s.voidGame('nope', 'commit'))).toBe('notFound');
        expect((await s.appendRecords([record('q', 4)])).failed.map((f) => f.game)).toEqual(['q']);
        s = await kit.reopen();
        const q = await s.loadForRecovery('q');
        expect(q).toMatchObject({ status: 'quarantined', lastSeq: 3, snapshot: null });
        expect((await s.loadForRecovery('done')).status).toBe('finished');
        expect((await s.loadForRecovery('v-limit')).status).toBe('void');
        const results = await s.results(T0, 100);
        const byGame = new Map(results.map((r) => [r.game, r]));
        expect(byGame.has('lobby')).toBe(false);
        for (const reason of VOID_REASONS) {
          expect(byGame.get(`v-${reason}`)).toEqual({
            game: `v-${reason}`, format: 'standard', variant: null, seats: 2, source: 'listed', ranked: false, outcome: 'void', reason, turns: 0, actions: 2,
            startedAt: T0.toISOString(), endedAt: at(99_000).toISOString(), engineBuild: 'build-1', placements: [],
            // every seat's logged actions from the last committed record's clocks (M13-7's seatActions)
            seatActions: [{ seat: 1, actions: 1 }, { seat: 2, actions: 1 }],
          });
        }
        expect(byGame.get('q')).toMatchObject({ outcome: 'void', reason: 'quarantined', actions: 3, seatActions: [{ seat: 1, actions: 2 }, { seat: 2, actions: 1 }] });
        expect(byGame.get('done')).toMatchObject({ outcome: 'win', reason: 'life' });
      });

      it('results: since (inclusive) and limit, ordered by end time then game id; every field of a placement kept', async () => {
        for (const [id, end] of [['e3', 3], ['e1', 1], ['e2b', 2], ['e2a', 2]] as const) {
          await running(s, id, 1);
          await s.finishGame(id, gameRecord(id, at(end * 1000)));
        }
        expect((await s.results(T0, 10)).map((r) => r.game)).toEqual(['e1', 'e2a', 'e2b', 'e3']);
        expect((await s.results(at(2000), 10)).map((r) => r.game)).toEqual(['e2a', 'e2b', 'e3']);
        expect((await s.results(T0, 2)).map((r) => r.game)).toEqual(['e1', 'e2a']);
        expect(await s.results(at(4000), 10)).toEqual([]);
        const p = (await s.results(T0, 1))[0]!.placements[1]!;
        expect(p).toEqual({
          seat: 2, player: 'p1', session: 's2', account: null, name: 'Player 2', deckHash: 'deck-2', place: 2, loss: 'life', lossRule: 'CR 704.5a',
          outTurn: 9, outOrder: 1, timeUsedMs: 123_456, timeouts: 0, disconnectedMs: 2_500,
        });
      });

      it('seatActions (M13-7) round-trip with a finished game; absent stays absent', async () => {
        await running(s, 'sa', 1);
        await s.finishGame('sa', gameRecord('sa', at(1000), { seatActions: [{ seat: 1, actions: 61 }, { seat: 2, actions: 59 }] }));
        await running(s, 'none', 1);
        await s.finishGame('none', gameRecord('none', at(2000)));
        s = await kit.reopen();
        const [a, b] = await s.results(T0, 10);
        expect(a!.seatActions).toEqual([{ seat: 1, actions: 61 }, { seat: 2, actions: 59 }]);
        expect('seatActions' in b!).toBe(false);
      });

      it('voidGame with the table\'s void record: that record is the ledger row (turns, actions, seatActions); it must match the game and reason', async () => {
        await running(s, 'vr', 2);
        const rec = gameRecord('vr', at(5000), {
          outcome: 'void', reason: 'limit', placements: [], turns: 7, actions: 2, seatActions: [{ seat: 1, actions: 9 }, { seat: 2, actions: 8 }],
        });
        expect(await code(s.voidGame('vr', 'commit', 'void', rec))).toBe('value');
        expect(await code(s.voidGame('vr', 'limit', 'void', { ...rec, game: 'other' }))).toBe('value');
        expect(await code(s.voidGame('vr', 'limit', 'void', { ...rec, placements: gameRecord('vr', at(1)).placements }))).toBe('value');
        expect((await s.loadForRecovery('vr')).status).toBe('running');
        await s.voidGame('vr', 'limit', 'void', rec);
        await running(s, 'vq', 1);
        await s.voidGame('vq', 'quarantined', 'quarantined', gameRecord('vq', at(6000), { outcome: 'void', reason: 'quarantined', placements: [] }));
        s = await kit.reopen();
        expect(await s.results(T0, 10)).toEqual([rec, gameRecord('vq', at(6000), { outcome: 'void', reason: 'quarantined', placements: [] })]);
        expect((await s.loadForRecovery('vq')).status).toBe('quarantined');
      });

      it('M13-7\'s writer through the store: a void game reaches results() with its per-seat action counts', async () => {
        await running(s, 'v1', 0);
        const end: TableEnd = { outcome: 'void', reason: 'recovery', result: null, at: 10, seq: 0, actions: 0, turns: 1, seats: [] };
        const r = await writeResult(s, { game: ledgerGame('v1'), end, seats: ledgerSeats(2) });
        expect(await s.results(new Date(0), 10)).toEqual([r]);
        expect(r.seatActions).toEqual([{ seat: 1, actions: 0 }, { seat: 2, actions: 0 }]);
        expect((await s.loadForRecovery('v1')).status).toBe('void');
      });

      it('sessionResults: a session\'s games newest first (void games have no placements), since, limit, keyset pages across equal end times', async () => {
        const mine = (id: string, end: number, seat: 1 | 2) =>
          gameRecord(id, at(end), {
            placements: gameRecord(id, at(end)).placements.map((p) => (p.seat === seat ? { ...p, session: 'me' } : p)).sort((a, b) => a.seat - b.seat),
          });
        const plan: [string, number, 1 | 2 | null][] = [['m1', 1000, 1], ['m2', 2000, 2], ['x1', 2500, null], ['m3', 3000, 1], ['m4', 3000, 2], ['m5', 3000, 1], ['m6', 4000, 2]];
        for (const [id, end, seatNo] of plan) {
          await running(s, id, 1);
          await s.finishGame(id, seatNo ? mine(id, end, seatNo) : gameRecord(id, at(end)));
        }
        await running(s, 'void-me', 1);
        await s.voidGame('void-me', 'abandoned');
        const order = ['m6', 'm5', 'm4', 'm3', 'm2', 'm1'];
        expect((await s.sessionResults('me', { since: T0, limit: 50 })).map((r) => r.game)).toEqual(order);
        expect((await s.sessionResults('me', { since: at(2000), limit: 50 })).map((r) => r.game)).toEqual(['m6', 'm5', 'm4', 'm3', 'm2']);
        expect((await s.sessionResults('nobody', { since: T0, limit: 50 }))).toEqual([]);
        // pages of 2, each continuing after the last row of the one before: every game once, in order, across the three that ended together
        const pages: string[][] = [];
        let before: { endedAt: string; game: string } | undefined;
        for (;;) {
          const page = await s.sessionResults('me', { since: T0, limit: 2, ...(before ? { before } : {}) });
          if (page.length === 0) break;
          pages.push(page.map((r) => r.game));
          const last = page[page.length - 1]!;
          before = { endedAt: last.endedAt, game: last.game };
        }
        expect(pages).toEqual([['m6', 'm5'], ['m4', 'm3'], ['m2', 'm1']]);
        // whole records, placements of every seat
        const [m6] = await s.sessionResults('me', { since: T0, limit: 1 });
        expect(m6).toEqual(mine('m6', 4000, 2));
      });
    });

    describe('the bug inbox', () => {
      it('stores reports with attachments as text (JSON escapes of NUL and lone surrogates kept verbatim); since and limit; status', async () => {
        const atts = [{ kind: 'view', json: '{"a":"\\u0000 and \\ud800","b":[1,2]}' }, { kind: 'client', json: '{"ua":"x"}' }];
        await s.putReport(report('r2', at(2000), atts));
        await s.putReport(report('r1', at(1000)));
        expect(await code(s.putReport(report('r1', at(1000))))).toBe('exists');
        expect(await code(s.putReport({ ...report('r3', at(1)), text: 'raw\u0000nul' }))).toBe('value');
        await s.setReportStatus('r1', 'read');
        expect(await code(s.setReportStatus('nope', 'read'))).toBe('notFound');
        s = await kit.reopen();
        expect(await s.reports(T0, 10)).toEqual([{ ...report('r1', at(1000)), status: 'read' }, report('r2', at(2000), atts)]);
        expect((await s.reports(at(1500), 10)).map((r) => r.id)).toEqual(['r2']);
        expect((await s.reports(T0, 1)).map((r) => r.id)).toEqual(['r1']);
      });
    });

    describe('retention (design 8.3: logs 90 days, results kept, sessions 30 days, lobby 7, void 90)', () => {
      it('purge deletes exactly the rows past their time', async () => {
        const policy = { logsDays: 90, lobbyDays: 7, voidDays: 90, sessionDays: 30 };
        const now = new Date(T0.getTime() + 200 * DAY);
        const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);
        await s.putSession(session('old', daysAgo(31)));
        await s.putSession(session('fresh', daysAgo(29)));
        // finished 91 and 89 days ago
        await running(s, 'fin-old', 3, daysAgo(92));
        await s.finishGame('fin-old', gameRecord('fin-old', daysAgo(91)));
        await running(s, 'fin-new', 2, daysAgo(90));
        await s.finishGame('fin-new', gameRecord('fin-new', daysAgo(89)));
        // void 91 and 10 days ago (the store's clock gives the end time)
        clock = daysAgo(91);
        await running(s, 'void-old', 4, daysAgo(92));
        await s.voidGame('void-old', 'abandoned');
        clock = daysAgo(10);
        await running(s, 'quar-new', 1, daysAgo(11));
        await s.voidGame('quar-new', 'quarantined', 'quarantined');
        // tables that never started: 8 and 6 days old; a long-running game is never purged
        await s.createGame(newGame('lobby-old', daysAgo(8)));
        await s.createGame(newGame('lobby-new', daysAgo(6)));
        clock = daysAgo(8);
        await s.createGame(newGame('lobby-voided', daysAgo(8))); // closed before it started: purged by the lobby rule (7 days), not 90
        await s.voidGame('lobby-voided', 'abandoned');
        await running(s, 'run', 2, daysAgo(120));
        await s.putSnapshot(snapshot('run', 2));
        // reports: the server's game log (any kind but the client's) goes after 90 days; the player's words and the client's attachments stay
        const atts = [{ kind: 'view', json: '{}' }, { kind: 'log', json: '{"records":[]}' }];
        await s.putReport(report('rep-old', daysAgo(91), atts));
        await s.putReport(report('rep-new', daysAgo(89), atts));
        await s.putReport(report('rep-old-client', daysAgo(95), [{ kind: 'settings', json: '{}' }]));
        s = await kit.reopen();
        const got = await s.purge(policy, now);
        expect(got).toEqual({ sessions: 1, games: 4, records: 7, snapshots: 0, reports: 1 });
        expect(await s.sessionByTokenHash('hash-old')).toBeNull();
        expect(await s.sessionByTokenHash('hash-fresh')).not.toBeNull();
        for (const gone of ['fin-old', 'void-old', 'lobby-old', 'lobby-voided']) expect(await code(s.loadForRecovery(gone)), gone).toBe('notFound');
        expect((await s.loadForRecovery('fin-new')).records).toHaveLength(2);
        expect((await s.loadForRecovery('quar-new')).status).toBe('quarantined');
        expect((await s.loadForRecovery('run')).snapshot!.seq).toBe(2);
        expect(await code(s.updateLobby('lobby-new', { title: 'still here' }))).toBe('resolved');
        // results are kept, the purged games' too
        expect((await s.results(new Date(0), 100)).map((r) => r.game).sort()).toEqual(['fin-new', 'fin-old', 'quar-new', 'void-old']);
        const reps = new Map((await s.reports(new Date(0), 10)).map((r) => [r.id, r]));
        expect(reps.get('rep-old')!.attachments).toEqual([{ kind: 'view', json: '{}' }]);
        expect(reps.get('rep-old')!.text).toBe('It broke (rep-old)');
        expect(reps.get('rep-new')!.attachments).toEqual(atts);
        expect(reps.get('rep-old-client')!.attachments).toEqual([{ kind: 'settings', json: '{}' }]);
        // a second purge finds nothing more
        expect(await s.purge(policy, now)).toEqual({ sessions: 0, games: 0, records: 0, snapshots: 0, reports: 0 });
      });
    });

    it('close: a closed store refuses work', async () => {
      await s.close();
      expect(await code(s.putSession(session('s1')))).toBe('closed');
    });
  });
}
