/**
 * M15-3: the sweep (design 8.3, 17.5): the ledger read with its overlap and cursor rule, failed rows and `intake.stuck`, paging when many games end
 * in one millisecond, reconciliation of running starts by game id (a long recovery, a lost start, a row for a lost start), and a sweep with no
 * ledger.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryLadderStore } from '../../src/service/create';
import { acc, ended, FakeLedger, gid, harness, HOUR, MINUTE, recordOf } from './fixtures';
import { wrapStore } from './support';

const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8];
const A = acc(1);
const B = acc(2);
const C = acc(3);
const D = acc(4);

describe('M15-3: the sweep\'s ledger read (8.3)', () => {
  it('a crash between finishGame and intake (intake never called) is caught by the next sweep', async () => {
    const h = await harness({ accounts: PLAYERS });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), {});
    h.clock.set(r.endedAt);
    h.ledger!.commit(r);
    const rep = await h.svc.sweep();
    expect(rep).toMatchObject({ applied: 1, failed: 0, caughtUp: true });
    expect((await h.store.start(gid(1)))?.status).toBe('applied');
    expect(await h.store.intakeCursor()).toEqual({ endedAt: r.endedAt, game: gid(1) });
    expect(h.rated.map((x) => x.game)).toEqual([gid(1)]);
    // the overlap re-reads it: a duplicate, nothing more
    h.clock.advance(MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ applied: 0, duplicates: 1 });
  });

  for (const keyset of [true, false]) {
    it(`a row that commits after the sweep passed its endedAt, inside the overlap, is applied (${keyset ? 'resultsAfter' : 'results'})`, async () => {
      const h = await harness({ accounts: PLAYERS, ledger: new FakeLedger({ keyset }) });
      const t0 = h.clock.now();
      const late = ended(await h.start({ game: gid(1), accounts: [A, B] }), { endedAt: new Date(t0 + 20 * MINUTE).toISOString() });
      const early = ended(await h.start({ game: gid(2), accounts: [C, D] }), { endedAt: new Date(t0 + 21 * MINUTE).toISOString() });
      h.clock.set(t0 + 22 * MINUTE);
      h.ledger!.commit(early);
      await h.svc.sweep();
      expect(await h.store.intakeCursor()).toEqual({ endedAt: early.endedAt, game: gid(2) });
      h.ledger!.commit(late); // committed late (a retried commit), 1 minute before the cursor
      h.clock.advance(MINUTE);
      expect(await h.svc.sweep()).toMatchObject({ applied: 1, duplicates: 1 });
      expect((await h.store.start(gid(1)))?.status).toBe('applied');
      expect(await h.store.intakeCursor()).toEqual({ endedAt: early.endedAt, game: gid(2) });
      expect(h.ledger!.reads.find((x) => x.kind === (keyset ? 'resultsAfter' : 'results'))).toBeDefined();
    });
  }

  it('a row that commits later than the overlap is caught by reconciliation through ledger.result(game)', async () => {
    const h = await harness({ accounts: PLAYERS });
    const t0 = h.clock.now();
    const late = ended(await h.start({ game: gid(1), accounts: [A, B] }), { endedAt: new Date(t0 + 20 * MINUTE).toISOString() });
    h.ledger!.runningGames.add(gid(1));
    const other = ended(await h.start({ game: gid(2), accounts: [C, D], startedAt: new Date(t0 + 20 * MINUTE).toISOString() }), {
      endedAt: new Date(t0 + 45 * MINUTE).toISOString(),
    });
    h.clock.set(t0 + 46 * MINUTE);
    h.ledger!.commit(other);
    await h.svc.sweep(); // the cursor moves to 45 minutes; the read starts at 35 from now on
    // the late row commits now, 25 minutes behind the cursor: no ledger read sees it again
    h.ledger!.commit(late);
    h.clock.advance(MINUTE);
    const rep = await h.svc.sweep();
    expect(rep).toMatchObject({ applied: 1, reconciled: 1, lostStarts: 0 });
    expect((await h.store.start(gid(1)))?.status).toBe('applied');
    expect(h.ledger!.reads.filter((x) => x.kind === 'result').map((x) => x.arg)).toEqual([gid(1), gid(1)]);
  });

  it('the cursor stops before a failed row; later rows are applied; the next sweep takes the failed row again', async () => {
    const failing = new Set([gid(2)]);
    const store = wrapStore(createMemoryLadderStore(), {
      before: (m, args) => {
        if (m === 'applyGame' && failing.has((args[0] as { game: string }).game)) throw new Error('disk full');
      },
    });
    const h = await harness({ accounts: PLAYERS, store });
    const t0 = h.clock.now();
    const recs = [];
    for (let i = 1; i <= 3; i++) {
      const r = ended(await h.start({ game: gid(i), accounts: [acc(2 * i - 1), acc(2 * i)] }), { endedAt: new Date(t0 + (20 + i) * MINUTE).toISOString() });
      recs.push(r);
    }
    h.clock.set(t0 + 30 * MINUTE);
    for (const r of recs) h.ledger!.commit(r);
    const rep = await h.svc.sweep();
    expect(rep).toMatchObject({ applied: 2, failed: 1, caughtUp: false });
    expect(await h.store.intakeCursor()).toEqual({ endedAt: recs[0]!.endedAt, game: gid(1) });
    expect((await h.store.start(gid(3)))?.status).toBe('applied');
    failing.clear();
    h.clock.advance(MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ applied: 1, failed: 0, caughtUp: true });
    expect(await h.store.intakeCursor()).toEqual({ endedAt: recs[2]!.endedAt, game: gid(3) });
  });

  it('a row that failed in 10 sweeps in a row is logged intake.stuck at warn, and never skipped', async () => {
    const store = wrapStore(createMemoryLadderStore(), {
      before: (m, args) => {
        if (m === 'applyGame' && (args[0] as { game: string }).game === gid(1)) throw new Error('disk full');
      },
    });
    const h = await harness({ accounts: PLAYERS, store });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), {});
    h.clock.set(r.endedAt);
    h.ledger!.commit(r);
    for (let i = 1; i <= 10; i++) {
      await h.svc.sweep();
      expect(h.logs.events('warn').filter((e) => e === 'intake.stuck')).toHaveLength(i < 10 ? 0 : 1);
      h.clock.advance(MINUTE);
    }
    expect((await h.store.start(gid(1)))?.status).toBe('running');
    expect(await h.store.applied(gid(1))).toBeNull();
    expect(await h.store.intakeCursor()).toBeNull();
  });

  it('pages: many games ending in one millisecond on the inclusive read double the page until the read gets past them', async () => {
    const h = await harness({ accounts: PLAYERS, ledger: new FakeLedger({ keyset: false }) });
    const at = new Date(h.clock.now() + 20 * MINUTE).toISOString();
    for (let i = 0; i < 1101; i++) {
      // unranked records of other tables (nothing to rate, the same intake path): the volume is the point
      h.ledger!.commit({ ...recordOf({ game: `U${String(i).padStart(5, '0')}`, ladder: '1v1-standard', accounts: [acc(100), acc(101)], startedAt: h.clock.iso() }), endedAt: at, ranked: false, ladder: null });
    }
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), { endedAt: at });
    h.ledger!.commit(r);
    h.clock.set(Date.parse(at) + MINUTE);
    const rep = await h.svc.sweep();
    expect(rep).toMatchObject({ applied: 1, skipped: 1101, failed: 0, caughtUp: true });
    expect(h.ledger!.reads.filter((x) => x.kind === 'results').map((x) => x.limit)).toEqual([500, 500, 1000, 1000, 2000]);
    expect(await h.store.intakeCursor()).toEqual({ endedAt: at, game: 'U01100' });
  });

  it('keyset pages: every row once, in (endedAt, game) order', async () => {
    const h = await harness({ accounts: PLAYERS });
    const at = new Date(h.clock.now() + 20 * MINUTE).toISOString();
    for (let i = 0; i < 1200; i++) {
      h.ledger!.commit({ ...recordOf({ game: `U${String(i).padStart(5, '0')}`, ladder: '1v1-standard', accounts: [acc(100), acc(101)], startedAt: h.clock.iso() }), endedAt: at, ranked: false, ladder: null });
    }
    h.clock.set(Date.parse(at) + MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ skipped: 1200, caughtUp: true });
    expect(h.ledger!.reads.filter((x) => x.kind === 'resultsAfter').length).toBe(3);
  });

  it('a ledger that cannot be read fails the sweep and moves nothing', async () => {
    const h = await harness({ accounts: PLAYERS });
    h.ledger!.failing = true;
    await expect(h.svc.sweep()).rejects.toThrow(/outage/);
    expect(await h.store.intakeCursor()).toBeNull();
    h.ledger!.failing = false;
    expect((await h.svc.sweep()).caughtUp).toBe(true);
  });
});

describe('M15-3: reconciling running starts (8.3)', () => {
  it('a recovered game that ends 7 hours after its start (hosted reports it running until then) is rated, not lost', async () => {
    const h = await harness({ accounts: PLAYERS });
    const t0 = h.clock.now();
    const r = await h.start({ game: gid(1), accounts: [A, B] });
    h.ledger!.runningGames.add(gid(1));
    for (let i = 1; i <= 7; i++) {
      h.clock.set(t0 + i * HOUR);
      expect(await h.svc.sweep()).toMatchObject({ lostStarts: 0 });
    }
    const rec = ended(r, { endedAt: new Date(t0 + 7 * HOUR).toISOString() });
    h.ledger!.commit(rec);
    h.clock.advance(MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ applied: 1, lostStarts: 0 });
    expect((await h.store.start(gid(1)))?.status).toBe('applied');
    expect(h.notRated).toEqual([]);
  });

  it('a start hosted reports neither running nor recorded becomes lost, frees its accounts and tells the seats; a later row for it is skipped as lost', async () => {
    const h = await harness({ accounts: PLAYERS });
    const t0 = h.clock.now();
    const r = await h.start({ game: gid(1), accounts: [A, B] });
    h.clock.set(t0 + 29 * MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ lostStarts: 0 }); // younger than reconcileAfterMs: not asked about
    expect(h.ledger!.reads.filter((x) => x.kind === 'result')).toEqual([]);
    h.clock.set(t0 + 31 * MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ lostStarts: 1 });
    expect((await h.store.start(gid(1)))?.status).toBe('lost');
    expect([h.svc.accountBusy(A), h.svc.accountBusy(B)]).toEqual([false, false]);
    expect(h.notRated).toEqual([{ game: gid(1), ladder: '1v1-standard', reason: 'lost', accounts: [A, B] }]);
    expect(h.logs.events('warn')).toContain('intake.lost');
    // the accounts play on; then the lost game's row turns up after all: never rated after its players went on
    await h.play({ game: gid(2), accounts: [A, B] });
    const lateRow = ended(r, {});
    h.ledger!.commit(lateRow);
    expect(await h.svc.intake(lateRow)).toEqual({ kind: 'skipped', game: gid(1), reason: 'lost' });
    expect(h.notRated.map((e) => e.reason)).toEqual(['lost', 'lost']);
    expect(await h.svc.intake(lateRow)).toEqual({ kind: 'duplicate', game: gid(1) });
    expect((await h.store.ratings('1v1-standard', [A])).get(A)!.games).toBe(1);
  });

  it('a game that ends between its result() and the running() read is rated, not closed as lost (review of M15-3)', async () => {
    const h = await harness({ accounts: PLAYERS });
    const t0 = h.clock.now();
    const r1 = await h.start({ game: gid(1), accounts: [A, B] });
    await h.start({ game: gid(2), accounts: [C, D] });
    h.ledger!.runningGames.add(gid(1));
    h.ledger!.runningGames.add(gid(2));
    h.clock.set(t0 + 40 * MINUTE);
    // G1 ends while the sweep asks about G2: hosted's finishGame writes G1's record and ends its running row in one step
    const done = ended(r1, { endedAt: new Date(t0 + 39 * MINUTE).toISOString() });
    const result = h.ledger!.result.bind(h.ledger!);
    h.ledger!.result = async (game) => {
      if (game === gid(2) && !h.ledger!.records.has(gid(1))) h.ledger!.commit(done);
      return result(game);
    };
    const rep = await h.svc.sweep();
    expect(rep).toMatchObject({ applied: 1, reconciled: 1, lostStarts: 0 });
    expect((await h.store.start(gid(1)))?.status).toBe('applied');
    expect((await h.store.start(gid(2)))?.status).toBe('running');
    expect(h.rated.map((x) => x.game)).toEqual([gid(1)]);
    expect(h.notRated).toEqual([]);
    // the next sweep finds it a duplicate, and G2 still running
    h.clock.advance(MINUTE);
    expect(await h.svc.sweep()).toMatchObject({ applied: 0, skipped: 0, lostStarts: 0 });
    expect(h.notRated).toEqual([]);
  });

  it('at most 100 starts a sweep, oldest first', async () => {
    const h = await harness();
    const t0 = h.clock.now();
    for (let i = 0; i < 101; i++) {
      h.dir.add(acc(200 + 2 * i), 'x');
      h.dir.add(acc(201 + 2 * i), 'y');
      await h.start({ game: gid(i + 1), accounts: [acc(200 + 2 * i), acc(201 + 2 * i)], startedAt: new Date(t0 + i).toISOString() });
      h.ledger!.runningGames.add(gid(i + 1));
    }
    h.clock.set(t0 + HOUR);
    await h.svc.sweep();
    const asked = h.ledger!.reads.filter((x) => x.kind === 'result').map((x) => x.arg);
    expect(asked).toHaveLength(100);
    expect(asked[0]).toBe(gid(1));
    expect(asked).not.toContain(gid(101));
  });
});

describe('M15-3: a sweep with no ledger wired', () => {
  it('reads nothing, reconciles nothing, counts as caught up, and still closes seasons', async () => {
    const h = await harness({ accounts: PLAYERS, ledger: null });
    await h.start({ game: gid(1), accounts: [A, B] });
    h.clock.set('2026-11-01T00:16:00.000Z');
    const rep = await h.svc.sweep();
    // the other ladders close October; 1v1-standard waits for the running start that began before the end
    expect(rep).toMatchObject({ applied: 0, reconciled: 0, lostStarts: 0, caughtUp: true, seasonsClosed: ['2026-10'] });
    expect((await h.store.seasonRow('1v1-standard', '2026-10'))?.status ?? 'open').toBe('open');
    expect((await h.store.seasonRow('1v1-pioneer', '2026-10'))?.status).toBe('closed');
    const h2 = await harness({ accounts: PLAYERS, ledger: null });
    h2.clock.set('2026-11-01T00:16:00.000Z');
    expect((await h2.svc.sweep()).seasonsClosed).toEqual(['2026-10']);
  });

  it('two calls at once run one sweep', async () => {
    const h = await harness({ accounts: PLAYERS });
    const [x, y] = await Promise.all([h.svc.sweep(), h.svc.sweep()]);
    expect(x).toBe(y);
  });
});
