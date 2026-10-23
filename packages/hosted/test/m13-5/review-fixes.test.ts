/**
 * M13-5 review fixes (worker threads, in process, no sockets).
 * - MAJOR 1: the table whose message was at a worker that died is the suspect, whatever the exit: its command is never sent again (its seat gets an
 *   error), it is quarantined, and the worker's other tables are recovered without their recoveries counting. Before: the running command was put back
 *   and re-sent next to the same tables, so a poison command killed the worker again and every table on it was quarantined.
 * - MAJOR 2 (owner decision): a store outage PAUSES the tables waiting for a commit (sends held back), refuses starts, fails readiness and sets
 *   admission's 'store' signal, tells the waiting seats after a few seconds, and voids only past the 60 s bound (shortened here). The runtime's own voids
 *   are durable: `ended` only once the store has the void; a void the store never got before the process stopped is applied by the next `open()`
 *   (a quarantined culprit is never placed again).
 * - Minors: a snapshot of another build is not a start (1); a start that stalls its worker ends quietly (6); a table being voided takes no input (7).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_ADMISSION_LIMITS, softSignal } from '../../src/admission/api';
import { MemoryLogger } from '../../src/obs';
import type { TableDirectory } from '../../src/runtime';
import { MemoryStore } from '../../src/store';
import type { GameStore } from '../../src/store/api';
import { DECKS, Driver, lobbyRow, startSeats, T0 } from './harness';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (what: string, ok: () => boolean, ms = 60_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
};

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5 });
});

/** A store that can be "unreachable": while `down`, every call throws a connection error (transient: not a StoreError). */
function flakyStore(base: GameStore) {
  const ctl = { down: false, calls: 0, voidError: null as Error | null };
  const store = new Proxy(base, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv) as unknown;
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        ctl.calls++;
        if (ctl.down && prop !== 'close') return Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
        if (prop === 'voidGame' && ctl.voidError) return Promise.reject(ctl.voidError);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { store, ctl };
}

const directoryOf = (games: string[]): TableDirectory => ({
  async meta(g) {
    if (!games.includes(g)) return null;
    return { game: g, format: 'casual', source: 'listed', seats: 2, startedAt: T0, ledgerSeats: startSeats(g, DECKS[0]!, DECKS[1]!).map((s) => ({ seat: s.seat, session: s.session, deckHash: s.deckHash })) };
  },
});

describe('MAJOR 1: the suspect of a worker loss', () => {
  it('a poison command kills its worker once: its table is quarantined (the command is never re-sent, its seat answered), the other recovers uncounted', async () => {
    const store = new MemoryStore();
    const driver = new Driver();
    const logger = new MemoryLogger();
    const rt = driver.make({ store, workers: 1, testHooks: true, logger });
    try {
      await rt.open();
      const a = await driver.start(store, 'a', DECKS[0]!, DECKS[1]!);
      const b = await driver.start(store, 'b', DECKS[1]!, DECKS[2]!);
      await Promise.all([a.play(6), b.play(6)]);
      await rt.settleAll();
      const bBefore = (await rt.inspect('b'))!;
      // a's next command ends the worker (as an out-of-memory exit while handling it would).
      rt.debug('a', { poison: true });
      await rt.settleAll();
      void a.play(7);
      await until('a quarantined', () => driver.ended.get('a')?.status === 'quarantined');
      await until('b recovered', () => driver.recovered.some((r) => r.game === 'b'));
      await rt.settleAll();
      // The worker died once: the command was not sent again next to b.
      expect(logger.lines.filter((l) => l.includes('"workerLost"'))).toHaveLength(1);
      expect(a.refusals.some((r) => r.endsWith(':engineError'))).toBe(true);
      expect(a.result).toMatchObject({ outcome: 'void', reason: 'quarantined' });
      expect((await store.loadForRecovery('a')).status).toBe('quarantined');
      // b: recovered to its state, its recovery not counted (it did nothing), and it plays to the end.
      expect(await rt.inspect('b')).toMatchObject({ seq: bBefore.seq, hash: bBefore.hash });
      expect((await store.loadForRecovery('b')).recoveries).toBe(0);
      await b.play(null);
      await rt.settleAll();
      expect(driver.ended.get('b')?.status).toBe('finished');
    } finally {
      await rt.close();
    }
  }, 180_000);
});

describe('MAJOR 2: store outages pause; the runtime\'s voids are durable', () => {
  const outage = { maxMs: 1_500, firstMs: 50, capMs: 200, noticeMs: 300 };

  it('a short outage pauses the tables (sends held back, a notice), refuses starts, sets the store signal and readiness; then they play on', async () => {
    const mem = new MemoryStore();
    const { store, ctl } = flakyStore(mem);
    const driver = new Driver();
    const rt = driver.make({ store, workers: 1, tuning: { outage } });
    try {
      await rt.open();
      const o1 = await driver.start(store, 'o1', DECKS[0]!, DECKS[1]!);
      const o2 = await driver.start(store, 'o2', DECKS[2]!, DECKS[0]!);
      const games = Promise.all([o1.play(null), o2.play(null)]);
      await until('some moves', () => o1.moves > 3 && o2.moves > 3);
      ctl.down = true;
      await until('the outage is seen', () => rt.storeOutage(), 10_000);
      await sleep(700);
      // Nothing past the committed log was sent: every seat's view is at most the store's last record.
      for (const t of [o1, o2]) {
        const last = (await mem.loadForRecovery(t.game)).lastSeq;
        for (const s of t.seats.values()) expect(s.seq).toBeLessThanOrEqual(last);
      }
      const sig = rt.read(Date.now());
      expect(sig.store).toBe(true);
      expect(softSignal(sig, DEFAULT_ADMISSION_LIMITS)).toBe('store');
      expect(rt.ready()).toMatchObject({ ok: false, reasons: ['store'] });
      await mem.createGame(lobbyRow('o3'));
      expect(await rt.start({ game: 'o3', format: 'casual', source: 'listed', seats: startSeats('o3', DECKS[0]!, DECKS[1]!), at: T0 })).toMatchObject({ ok: false, reason: 'busy' });
      const notices = [o1, o2].flatMap((t) => t.transcript).filter((x) => x.includes('"kind":"degraded"'));
      expect(notices.length).toBeGreaterThan(0);
      // The store answers again within the bound: nothing was voided, the games play to the end.
      ctl.down = false;
      await games;
      await rt.settleAll();
      expect(rt.storeOutage()).toBe(false);
      expect(rt.ready().ok).toBe(true);
      for (const t of [o1, o2]) {
        expect(driver.ended.get(t.game)?.status).toBe('finished');
        expect(t.refusals).toEqual([]);
      }
    } finally {
      await rt.close();
    }
  }, 180_000);

  it('past the bound the table is voided, but `ended` comes only once the store has the void', async () => {
    const mem = new MemoryStore();
    const { store, ctl } = flakyStore(mem);
    const driver = new Driver();
    const rt = driver.make({ store, workers: 1, tuning: { outage } });
    try {
      await rt.open();
      const p1 = await driver.start(store, 'p1', DECKS[0]!, DECKS[1]!);
      void p1.play(null);
      await until('some moves', () => p1.moves > 3);
      ctl.down = true;
      // Voided in memory (it takes no input), not reported, not sent: the store has not got it.
      await until('p1 voiding', () => !rt.submit('p1', { t: 'chat', seat: 1, id: 999, text: 'hello' }), 20_000);
      await sleep(outage.maxMs * 2);
      expect(driver.ended.has('p1')).toBe(false);
      expect(p1.result).toBeNull();
      ctl.down = false;
      await until('p1 ended', () => driver.ended.has('p1'), 20_000);
      expect(driver.ended.get('p1')).toMatchObject({ status: 'void', end: { reason: 'commit' } });
      expect(p1.result).toMatchObject({ outcome: 'void', reason: 'commit' });
      expect((await mem.loadForRecovery('p1')).status).toBe('void');
      expect((await mem.results(new Date(0), 10)).map((r) => [r.game, r.reason])).toEqual([['p1', 'commit']]);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it('a void the store never got before the process stopped is applied by the next open(); a quarantined culprit is never placed again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openmtg-m13-5-pending-'));
    dirs.push(dir);
    const file = join(dir, 'pending-voids.json');
    const mem = new MemoryStore();
    const { store, ctl } = flakyStore(mem);
    {
      const driver = new Driver();
      const rt = driver.make({ store, workers: 1, testHooks: true, tuning: { outage, watchdogMs: 400 }, pendingVoidsFile: file });
      try {
        await rt.open();
        const v1 = await driver.start(store, 'v1', DECKS[0]!, DECKS[1]!);
        const q1 = await driver.start(store, 'q1', DECKS[1]!, DECKS[2]!);
        await Promise.all([v1.play(4), q1.play(4)]);
        await rt.settleAll();
        // v1 moves into an outage and past its bound: its void cannot be saved.
        ctl.down = true;
        void v1.play(20);
        await until('v1 voiding', () => !rt.submit('v1', { t: 'chat', seat: 1, id: 7, text: 'x' }), 20_000);
        // q1 stalls the worker meanwhile: its quarantine cannot be saved either.
        rt.debug('q1', { hang: 20_000 });
        await until('q1 voiding', () => !rt.submit('q1', { t: 'chat', seat: 1, id: 8, text: 'x' }), 10_000);
        const read = async () => JSON.parse(await readFile(file, 'utf8').catch(() => '[]')) as { game: string; reason: string; status: string }[];
        for (let i = 0; i < 500 && (await read()).length < 2; i++) await sleep(20);
        expect(driver.ended.size).toBe(0);
        const pending = await read();
        expect(pending.map((p) => [p.game, p.reason, p.status]).sort()).toEqual([['q1', 'quarantined', 'quarantined'], ['v1', 'commit', 'void']]);
      } finally {
        // The process stops with the store still down.
        await rt.close();
      }
    }
    ctl.down = false;
    expect((await mem.loadForRecovery('q1')).status).toBe('running');
    const driver = new Driver();
    const rt = driver.make({ store, workers: 1, pendingVoidsFile: file, directory: directoryOf(['v1', 'q1']) });
    try {
      const report = await rt.open();
      expect(report).toEqual({ recovered: [], voided: [{ game: 'q1', reason: 'quarantined' }, { game: 'v1', reason: 'commit' }] });
      expect((await mem.loadForRecovery('q1')).status).toBe('quarantined');
      expect((await mem.loadForRecovery('v1')).status).toBe('void');
      expect(rt.has('q1')).toBe(false);
      expect(await rt.start({ game: 'q1', format: 'casual', source: 'listed', seats: startSeats('q1', DECKS[0]!, DECKS[1]!), at: T0 })).toMatchObject({ ok: false, reason: 'exists' });
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([]);
    } finally {
      await rt.close();
    }
  }, 180_000);
});

describe('re-review: permanent errors are not outages; close() does not wait out an outage', () => {
  it('a voidGame that fails for good (SQLSTATE 23514) is no outage: no retries, readiness stays; the void stays pending, the culprit quarantined, the next open() applies it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openmtg-m13-5-perm-'));
    dirs.push(dir);
    const file = join(dir, 'pending-voids.json');
    const mem = new MemoryStore();
    const { store, ctl } = flakyStore(mem);
    {
      const driver = new Driver();
      const logger = new MemoryLogger();
      const rt = driver.make({ store, workers: 1, testHooks: true, logger, tuning: { watchdogMs: 400 }, pendingVoidsFile: file });
      try {
        await rt.open();
        const z = await driver.start(store, 'z', DECKS[0]!, DECKS[1]!);
        await z.play(4);
        await rt.settleAll();
        ctl.voidError = Object.assign(new Error('new row violates check constraint'), { code: '23514' });
        const calls = ctl.calls;
        rt.debug('z', { hang: 20_000 });
        await until('z ended', () => driver.ended.has('z'), 20_000);
        // Reported once, as pending; one voidGame call (no outage retries); starts and readiness never flipped.
        expect(driver.ended.get('z')).toMatchObject({ status: 'quarantined', pending: true });
        expect(z.result).toMatchObject({ outcome: 'void', reason: 'quarantined' });
        expect(ctl.calls - calls).toBeLessThanOrEqual(3);
        expect(logger.lines.some((l) => l.includes('"storeOutage"'))).toBe(false);
        expect(rt.storeOutage()).toBe(false);
        expect(rt.has('z')).toBe(false);
        expect(await rt.start({ game: 'z', format: 'casual', source: 'listed', seats: startSeats('z', DECKS[0]!, DECKS[1]!), at: T0 })).toMatchObject({ ok: false, reason: 'exists' });
        expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([{ game: 'z', reason: 'quarantined', status: 'quarantined' }]);
        expect((await mem.loadForRecovery('z')).status).toBe('running');
      } finally {
        await rt.close();
      }
    }
    // The next start: the store takes it now; z is quarantined, never recovered.
    ctl.voidError = null;
    const driver = new Driver();
    const rt = driver.make({ store, workers: 1, pendingVoidsFile: file, directory: directoryOf(['z']) });
    try {
      expect(await rt.open()).toEqual({ recovered: [], voided: [{ game: 'z', reason: 'quarantined' }] });
      expect((await mem.loadForRecovery('z')).status).toBe('quarantined');
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([]);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it('close() during an outage does not wait out the 60 s bound; the table stays running in the store and the next start recovers it', async () => {
    const mem = new MemoryStore();
    const { store, ctl } = flakyStore(mem);
    const d1 = new Driver();
    const r1 = d1.make({ store, workers: 1 });
    let seq = 0;
    try {
      await r1.open();
      const c = await d1.start(store, 'c', DECKS[0]!, DECKS[1]!);
      await c.play(4);
      await r1.settleAll();
      seq = (await mem.loadForRecovery('c')).lastSeq;
      ctl.down = true;
      void c.play(8);
      await until('a commit waiting', () => r1.storeOutage(), 10_000);
    } finally {
      const t0 = Date.now();
      await r1.close();
      expect(Date.now() - t0).toBeLessThan(15_000);
    }
    ctl.down = false;
    const stored = await mem.loadForRecovery('c');
    expect(stored.status).toBe('running');
    expect(stored.lastSeq).toBe(seq);
    const d2 = new Driver();
    const r2 = d2.make({ store, workers: 1, directory: directoryOf(['c']) });
    try {
      expect(await r2.open()).toEqual({ recovered: ['c'], voided: [] });
    } finally {
      await r2.close();
    }
  }, 120_000);
});

describe('minors', () => {
  it('(1) a snapshot of another engine build is not a start: the replay goes from the first record, to the same state', async () => {
    const mem = new MemoryStore();
    const d1 = new Driver();
    const r1 = d1.make({ store: mem, workers: 1 });
    let live;
    try {
      await r1.open();
      const s1 = await d1.start(mem, 's1', DECKS[0]!, DECKS[1]!, { limits: { checkpointEvery: 5 } });
      await s1.play(15);
      await r1.settleAll();
      live = (await r1.inspect('s1'))!;
      expect((await mem.loadForRecovery('s1')).snapshot).not.toBeNull();
    } finally {
      await r1.close();
    }
    // The store's newest snapshot claims another build.
    const other = new Proxy(mem, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (prop === 'loadForRecovery') {
          return async (id: string, o?: { ignoreSnapshots?: boolean }) => {
            const r = await target.loadForRecovery(id, o);
            return r.snapshot ? { ...r, snapshot: { ...r.snapshot, engineBuild: 'build-old' } } : r;
          };
        }
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const d2 = new Driver();
    const r2 = d2.make({ store: other, workers: 1, directory: directoryOf(['s1']) });
    try {
      expect(await r2.open()).toEqual({ recovered: ['s1'], voided: [] });
      expect(d2.recovered).toEqual([{ game: 's1', cause: 'restart', fromSnapshot: null }]);
      expect(await r2.inspect('s1')).toMatchObject({ seq: live.seq, hash: live.hash });
    } finally {
      await r2.close();
    }
  }, 120_000);

  it('(3) a recovery past its total budget stops the worker; the recovering table is quarantined', async () => {
    const mem = new MemoryStore();
    const driver = new Driver();
    const rt = driver.make({ store: mem, workers: 1, testHooks: true, tuning: { recoveryBudgetMs: 1 } });
    try {
      await rt.open();
      const r1 = await driver.start(mem, 'r1', DECKS[0]!, DECKS[1]!);
      await r1.play(30);
      await rt.settleAll();
      // The worker dies between messages: r1's recovery (a replay of its whole log) runs past a 1 ms budget.
      rt.debug('r1', { exit: 1 });
      await until('r1 quarantined', () => driver.ended.get('r1')?.status === 'quarantined');
      expect((await mem.loadForRecovery('r1')).status).toBe('quarantined');
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('(6) a start that kills its worker ends quietly: start() fails, nothing is reported ended, the game id is never placed', async () => {
    const mem = new MemoryStore();
    const driver = new Driver();
    const rt = driver.make({ store: mem, workers: 1, testHooks: true });
    try {
      await rt.open();
      await mem.createGame(lobbyRow('w1'));
      expect(rt.debug('w1', { poison: true }, 0)).toBe(true);
      await sleep(50);
      const r = await rt.start({ game: 'w1', format: 'casual', source: 'listed', seats: startSeats('w1', DECKS[0]!, DECKS[1]!), at: T0 });
      expect(r).toMatchObject({ ok: false, reason: 'failed' });
      await sleep(100);
      expect(driver.ended.size).toBe(0);
      expect(rt.has('w1')).toBe(false);
      expect(await mem.runningGames()).toEqual([]);
      expect(await mem.results(new Date(0), 10)).toEqual([]);
      expect(await rt.start({ game: 'w1', format: 'casual', source: 'listed', seats: startSeats('w1', DECKS[0]!, DECKS[1]!), at: T0 })).toMatchObject({ ok: false, reason: 'exists' });
    } finally {
      await rt.close();
    }
  }, 60_000);
});
