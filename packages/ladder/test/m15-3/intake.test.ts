/**
 * M15-3: intake through the service (design 8.1-8.5, 8.7, D8-D10, 17.5): what each skip stores and how it closes the registry entry, in one write;
 * exactly once; the order of games; erasure racing a computation; deleted seats; caps, leavers and void games. The sweep's cases are in
 * sweep.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { createLadderService, createMemoryLadderStore, type MemoryLadderStore } from '../../src/service/create';
import { LADDERS, type Glicko2State } from '../../src/api';
import { fixedRandom } from '../support/random';
import { acc, ended, gid, harness, MINUTE, memoryOf, recordOf, TEST_CONFIG } from './fixtures';
import { crashingStore, placesInDump, wrapStore } from './support';

const A = acc(1);
const B = acc(2);
const C = acc(3);
const D = acc(4);
const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8];

describe('M15-3: intake, the skips of 8.2', () => {
  it('unranked and unregistered records: nothing to close, nobody told; unregistered stored and logged at warn', async () => {
    const h = await harness({ accounts: PLAYERS });
    const plain = { ...recordOf({ game: gid(1), ladder: '1v1-standard', accounts: [A, B], startedAt: h.clock.iso() }), ranked: false, ladder: null };
    expect(await h.svc.intake(plain)).toEqual({ kind: 'skipped', game: gid(1), reason: 'unranked' });
    expect(await h.store.applied(gid(1))).toBeNull();
    const stray = recordOf({ game: gid(2), ladder: '1v1-standard', accounts: [A, B], startedAt: h.clock.iso() });
    expect(await h.svc.intake(stray)).toEqual({ kind: 'skipped', game: gid(2), reason: 'unregistered' });
    expect((await h.store.applied(gid(2)))?.status).toBe('skipped');
    expect(await h.svc.intake(stray)).toEqual({ kind: 'duplicate', game: gid(2) });
    expect(h.logs.lines.filter((l) => l.level === 'warn' && l.event === 'intake.skipped').map((l) => l.fields['reason'])).toEqual(['unregistered']);
    expect(h.notRated).toEqual([]);
    expect(await h.store.ratings('1v1-standard', [A, B])).toEqual(new Map());
  });

  const closing = [
    ['void', (r: ReturnType<typeof recordOf>) => ended(r, { outcome: 'void' }), 'void', 'void'],
    ['mismatch (not ranked)', (r: ReturnType<typeof recordOf>) => ({ ...r, ranked: false }), 'mismatch', 'skipped'],
    ['mismatch (another ladder)', (r: ReturnType<typeof recordOf>) => ({ ...r, ladder: '1v1-pauper' }), 'mismatch', 'skipped'],
    ['mismatch (another account)', (r: ReturnType<typeof recordOf>) => ({ ...r, placements: r.placements.map((p, i) => ({ ...p, account: i === 1 ? acc(99) : p.account })) }), 'mismatch', 'skipped'],
    ['malformed', (r: ReturnType<typeof recordOf>) => ended(r, { places: [2, 2] }), 'malformed', 'skipped'],
  ] as const;

  for (const [name, change, reason, status] of closing) {
    it(`${name}: stored skipped, the registry entry closed as ${status} in the same write, the accounts free, the seats told`, async () => {
      const base = createMemoryLadderStore();
      const crash = crashingStore(base, 'markSkipped');
      const h = await harness({ accounts: PLAYERS, store: crash.store });
      const r = change(await h.start({ game: gid(1), accounts: [A, B] }) as ReturnType<typeof recordOf>);
      expect(h.svc.accountBusy(A)).toBe(true);
      expect(await h.svc.intake(r as never)).toEqual({ kind: 'skipped', game: gid(1), reason });
      // the process "died" right after markSkipped: the start is closed all the same (one write), and a restart answers duplicate
      expect(crash.crashed()).toBe(true);
      expect((await base.start(gid(1)))?.status).toBe(status);
      expect((await base.applied(gid(1)))?.status).toBe('skipped');
      expect([h.svc.accountBusy(A), h.svc.accountBusy(B)]).toEqual([false, false]);
      expect(h.notRated).toEqual([{ game: gid(1), ladder: '1v1-standard', reason, accounts: [A, B] }]);
      expect(h.rated).toEqual([]);
      // restarted on what the crash left: no running start, and the record again is a duplicate
      const again = await harness({ accounts: PLAYERS, store: base });
      expect(await again.store.runningStarts()).toEqual([]);
      expect(await again.svc.intake(r as never)).toEqual({ kind: 'duplicate', game: gid(1) });
      expect(again.notRated).toEqual([]);
    });
  }

  it('ladderOff: a ladder switched off since the start is skipped and its entry closed', async () => {
    const store = createMemoryLadderStore();
    const h1 = await harness({ accounts: PLAYERS, store });
    const r = ended(await h1.start({ game: gid(1), accounts: [A, B] }), {});
    const h2 = await harness({ accounts: PLAYERS, store, config: { offered: ['1v1-pioneer'] } });
    expect(await h2.svc.intake(r)).toEqual({ kind: 'skipped', game: gid(1), reason: 'ladderOff' });
    expect((await store.start(gid(1)))?.status).toBe('skipped');
    expect(h2.notRated.map((e) => e.reason)).toEqual(['ladderOff']);
  });

  it('a record for an entry already closed (applied, void or skipped) is a duplicate: nothing more is written', async () => {
    const h = await harness({ accounts: PLAYERS });
    const r = await h.play({ game: gid(1), accounts: [A, B] });
    const before = memoryOf(h).dump();
    expect(await h.svc.intake(r)).toEqual({ kind: 'duplicate', game: gid(1) });
    expect(await h.svc.intake(ended(r, { outcome: 'void' }))).toEqual({ kind: 'duplicate', game: gid(1) });
    expect(memoryOf(h).dump()).toEqual(before);
    expect(h.rated).toHaveLength(1);
  });

  it('a malformed record without a game id is refused without a write or a retry', async () => {
    const h = await harness({ accounts: PLAYERS });
    expect(await h.svc.intake({} as never)).toEqual({ kind: 'skipped', game: '', reason: 'malformed' });
    expect(Object.values(memoryOf(h).dump()).flat()).toEqual([]);
  });
});

describe('M15-3: intake, rated games', () => {
  it('a rated game: ratings, history, season records, the start closed, the accounts free, the notices sent; once only', async () => {
    const h = await harness({ accounts: PLAYERS });
    await h.play({ game: gid(1), accounts: [A, B] });
    const rows = await h.store.ratings('1v1-standard', [A, B]);
    expect([(rows.get(A)!.state as Glicko2State).r > 1500, (rows.get(B)!.state as Glicko2State).r < 1500]).toEqual([true, true]);
    expect((await h.store.start(gid(1)))?.status).toBe('applied');
    expect([h.svc.accountBusy(A), h.svc.accountBusy(B)]).toEqual([false, false]);
    expect(h.rated).toHaveLength(1);
    expect(h.rated[0]!.notices.map((n) => [n.seat, n.place, n.before, n.after, n.placementLeft, n.provisional])).toEqual([[1, 1, null, null, 9, false], [2, 2, null, null, 9, false]]);
    expect((await h.store.seasonRecord(A, '1v1-standard', '2026-10'))?.wins).toBe(1);
    expect(h.abuse.calls.map((c) => c.kind)).toEqual(['afterGame']);
  });

  it('the same games in every order the per-account rule allows give equal stores (but for appliedAt and closedAt)', async () => {
    // g1 (A-B) and g2 (C-D) run together, then g3 (A-C) and g4 (B-D): A's games keep their order, the others commute
    const dumps: unknown[] = [];
    for (const [first, second] of [[[1, 2], [3, 4]], [[2, 1], [3, 4]], [[1, 2], [4, 3]], [[2, 1], [4, 3]]] as const) {
      const h = await harness({ accounts: PLAYERS, store: createMemoryLadderStore({ random: fixedRandom('order') }) });
      const t0 = h.clock.now();
      const games = { 1: [A, B], 2: [C, D], 3: [A, C], 4: [B, D] } as const;
      const recs = new Map<number, ReturnType<typeof ended>>();
      for (const g of [1, 2]) recs.set(g, ended(await h.start({ game: gid(g), accounts: [...games[g as 1 | 2]], startedAt: new Date(t0).toISOString() }), { endedAt: new Date(t0 + (20 + g) * MINUTE).toISOString() }));
      for (const g of first) {
        h.clock.advance(7 * MINUTE);
        await h.svc.intake(recs.get(g)!);
      }
      h.clock.set(t0 + HOUR_MS);
      for (const g of [3, 4]) recs.set(g, ended(await h.start({ game: gid(g), accounts: [...games[g as 3 | 4]] }), { endedAt: new Date(t0 + HOUR_MS + (20 + g) * MINUTE).toISOString(), places: g === 3 ? [2, 1] : [1, 2] }));
      for (const g of second) {
        h.clock.advance(11 * MINUTE);
        await h.svc.intake(recs.get(g)!);
      }
      dumps.push(normalize(memoryOf(h).dump()));
    }
    for (const d of dumps.slice(1)) expect(d).toEqual(dumps[0]);
  });

  it('a stale version is a conflict, recomputed from the fresh rows', async () => {
    let once = false;
    const raw: MemoryLadderStore = createMemoryLadderStore();
    const store = wrapStore(raw, {
      before: async (m) => {
        if (m === 'applyGame' && once) {
          once = false;
          // another process changed B's row in between (a reset, so the fresh row is plainly different)
          const b = (await raw.ratings('1v1-standard', [B])).get(B)!;
          await raw.resetRating({ ...b, version: b.version + 1, games: 0, lastRatedAt: null }, { id: 'adj1', account: B, ladder: '1v1-standard', by: 'mod', reason: 'r', before: b, after: null, at: '2026-10-15T12:00:00.000Z' });
        }
      },
    });
    const h = await harness({ accounts: PLAYERS, store });
    await h.play({ game: gid(1), accounts: [A, B] });
    once = true;
    h.clock.advance(HOUR_MS);
    await h.play({ game: gid(2), accounts: [A, B] });
    expect(h.logs.events('info')).toContain('intake.conflict');
    expect((await h.store.ratings('1v1-standard', [B])).get(B)!.games).toBe(1); // computed from the reset row (games 0), not the stale one
    expect((await h.store.start(gid(2)))?.status).toBe('applied');
  });

  it('three conflicts in a row: failed, nothing written, the start still running', async () => {
    const h = await harness({ accounts: PLAYERS });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), {});
    // every applyGame answers conflict: the stored rows keep changing under the computation
    const h2 = await harness({
      accounts: PLAYERS,
      store: new Proxy(h.store, { get: (t, p, rcv) => (p === 'applyGame' ? async () => 'conflict' : Reflect.get(t, p, rcv)) }),
    });
    const res = await h2.svc.intake(r);
    expect(res).toMatchObject({ kind: 'failed', game: gid(1) });
    expect(h2.logs.lines.filter((l) => l.event === 'intake.conflict')).toHaveLength(3);
    expect((await h.store.start(gid(1)))?.status).toBe('running');
    expect(await h.store.applied(gid(1))).toBeNull();
  });

  it('a store failure is failed, nothing written; a later intake of the same record applies it', async () => {
    let fail = true;
    const store = wrapStore(createMemoryLadderStore(), { before: (m) => { if (m === 'applyGame' && fail) throw new Error('disk full'); } });
    const h = await harness({ accounts: PLAYERS, store });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), {});
    expect(await h.svc.intake(r)).toEqual({ kind: 'failed', game: gid(1), error: 'disk full' });
    expect(h.svc.accountBusy(A)).toBe(true);
    fail = false;
    expect((await h.svc.intake(r)).kind).toBe('applied');
  });

  it('forgetAccount while the computation of the account\'s first game is in flight: no row, record or seat keeps the id (the serial queue)', async () => {
    let hold: (() => void) | null = null;
    let held = false;
    const base = createMemoryLadderStore();
    const store = wrapStore(base, {
      before: (m) => {
        if (m === 'seasonRecord' && !held) {
          held = true;
          return new Promise<void>((r) => { hold = r; });
        }
      },
    });
    const h = await harness({ accounts: PLAYERS, store });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), {});
    const intake = h.svc.intake(r);
    await new Promise((r2) => setTimeout(r2, 5));
    expect(held).toBe(true);
    const forget = h.svc.forgetAccount(A);
    hold!();
    expect((await intake).kind).toBe('applied');
    const report = await forget;
    expect(report.ratings).toBe(1);
    expect(placesInDump(base.dump(), A)).toEqual([]);
    expect(h.svc.accountBusy(A)).toBe(false);
  });

  it('an account deleted mid-game: rated from its start snapshot like a live row (G10b), stored nowhere; the opponent as if it were not deleted', async () => {
    const run = async (forget: boolean) => {
      const h = await harness({ accounts: PLAYERS, start: '2026-10-31T23:40:00.000Z' });
      // both have history: A from September, B from October
      await h.play({ game: gid(1), accounts: [A, C], startedAt: '2026-09-20T12:00:00.000Z', durationMs: 20 * MINUTE });
      await h.play({ game: gid(2), accounts: [B, D], startedAt: '2026-10-30T23:00:00.000Z', durationMs: 20 * MINUTE });
      h.clock.set('2026-10-31T23:40:00.000Z');
      const r = await h.start({ game: gid(3), accounts: [A, B] });
      if (forget) await h.svc.forgetAccount(A);
      h.clock.set('2026-11-01T00:20:00.000Z');
      const rec = ended(r, { places: [2, 1], endedAt: '2026-11-01T00:20:00.000Z' });
      if (forget) rec.placements[0] = { ...rec.placements[0]!, account: null, name: 'Deleted player' };
      expect((await h.svc.intake(rec)).kind).toBe('applied');
      return h;
    };
    const live = await run(false);
    const del = await run(true);
    expect((await del.store.ratings('1v1-standard', [B])).get(B)!.state).toEqual((await live.store.ratings('1v1-standard', [B])).get(B)!.state);
    expect(placesInDump(memoryOf(del).dump(), A)).toEqual([]);
    expect(del.rated.at(-1)!.notices.map((n) => n.seat)).toEqual([2]);
    const seat = (await del.store.history({ account: B, limit: 1 }))[0]!.seats[0]!;
    expect([seat.account, seat.name, seat.after]).toEqual([null, 'Deleted player', null]);
    expect((await del.store.start(gid(3)))!.seats[0]).toEqual({ seat: 1, account: null, row: null, games: 0 });
  });

  it('a ledger placement already anonymised while the registry seat names a live account: rated normally', async () => {
    const h = await harness({ accounts: PLAYERS });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), {});
    r.placements[0] = { ...r.placements[0]!, account: null, name: 'Deleted player' };
    expect((await h.svc.intake(r)).kind).toBe('applied');
    expect((await h.store.ratings('1v1-standard', [A])).get(A)?.games).toBe(1);
  });

  it('a cap driver loses like any loser, and its cap event is stored; a void cap game\'s cap event too', async () => {
    const h = await harness({ accounts: PLAYERS });
    const cap = { kind: 'actions' as const, verdict: { kind: 'driver' as const, seat: 2 as const, share: 0.81 }, seats: [{ seat: 1 as const, initiated: 400, chargedMs: 0 }, { seat: 2 as const, initiated: 1700, chargedMs: 0 }] };
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), { loss: [null, 'limit'] });
    expect((await h.svc.intake({ ...r, cap })).kind).toBe('applied');
    const ref = await harness({ accounts: PLAYERS });
    await ref.play({ game: gid(1), accounts: [A, B] });
    expect((await h.store.ratings('1v1-standard', [A, B]))).toEqual(await ref.store.ratings('1v1-standard', [A, B]));
    expect((await h.store.capEvents(B, '2026-01-01T00:00:00.000Z')).map((c) => [c.game, c.verdict.kind, c.seats[1]!.account])).toEqual([[gid(1), 'driver', B]]);
    h.clock.advance(HOUR_MS);
    const v = ended(await h.start({ game: gid(2), accounts: [C, D] }), { outcome: 'void' });
    const voidCap = { kind: 'time' as const, verdict: { kind: 'void' as const }, seats: [{ seat: 1 as const, initiated: 0, chargedMs: 3_600_000 }, { seat: 2 as const, initiated: 0, chargedMs: 3_600_000 }] };
    expect(await h.svc.intake({ ...v, reason: 'limit', cap: voidCap })).toEqual({ kind: 'skipped', game: gid(2), reason: 'void' });
    expect((await h.store.capEvents(C, '2026-01-01T00:00:00.000Z')).map((c) => [c.game, c.kind, c.verdict.kind, c.seats.map((s) => s.share)])).toEqual([[gid(2), 'time', 'void', [0.5, 0.5]]]);
  });

  it('leavers, time-outs and disconnects are losses at their place, nothing more (D10)', async () => {
    const results = [];
    for (const loss of ['life', 'left', 'timeout', 'disconnect', 'concession'] as const) {
      const h = await harness({ accounts: PLAYERS });
      const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), { loss: [null, loss] });
      await h.svc.intake(r);
      results.push([...(await h.store.ratings('1v1-standard', [A, B])).values()].map((x) => x.state));
    }
    for (const x of results.slice(1)) expect(x).toEqual(results[0]);
  });

  it('void games are never rated; the seats are told "not rated" with the reason', async () => {
    const h = await harness({ accounts: PLAYERS });
    const r = ended(await h.start({ game: gid(1), accounts: [A, B] }), { outcome: 'void' });
    expect(await h.svc.intake(r)).toEqual({ kind: 'skipped', game: gid(1), reason: 'void' });
    expect(await h.store.ratings('1v1-standard', [A, B])).toEqual(new Map());
    expect(h.notRated).toEqual([{ game: gid(1), ladder: '1v1-standard', reason: 'void', accounts: [A, B] }]);
  });

  it('a pod: four seats rated by finishing order, a shared place a draw', async () => {
    const h = await harness({ accounts: PLAYERS });
    const r = ended(await h.start({ game: gid(1), ladder: 'pod-commander', accounts: [A, B, C, D] }), { places: [1, 2, 2, 4] });
    expect((await h.svc.intake(r)).kind).toBe('applied');
    const recs = await Promise.all([A, B, C, D].map((a) => h.store.seasonRecord(a, 'pod-commander', '2026-10')));
    expect(recs.map((x) => [x!.wins, x!.losses, x!.places])).toEqual([[1, 0, [1, 0, 0, 0]], [0, 1, [0, 1, 0, 0]], [0, 1, [0, 1, 0, 0]], [0, 1, [0, 0, 0, 1]]]);
    expect(LADDERS['pod-commander'].model).toBe('wenglin');
  });
});

describe('M15-3: the registry and the memory of running games', () => {
  it('registerStart is idempotent, snapshots each seat\'s stored row unreset, and refuses an account already in a running game', async () => {
    const h = await harness({ accounts: PLAYERS });
    await h.play({ game: gid(1), accounts: [A, B], startedAt: '2026-10-15T12:00:00.000Z' });
    h.clock.set('2026-11-02T12:00:00.000Z');
    await h.start({ game: gid(2), accounts: [A, C] });
    const s = (await h.store.start(gid(2)))!;
    const row = (await h.store.ratings('1v1-standard', [A])).get(A)!;
    expect(s.seats[0]).toEqual({ seat: 1, account: A, row: { state: row.state, season: '2026-10', lastRatedAt: row.lastRatedAt }, games: 1 });
    expect(s.seats[1]).toEqual({ seat: 2, account: C, row: { state: { model: 'glicko2', r: 1500, rd: 350, vol: 0.06 }, season: '2026-11', lastRatedAt: null }, games: 0 });
    await h.start({ game: gid(2), accounts: [A, C] });
    expect((await h.store.runningStarts()).length).toBe(1);
    await expect(h.start({ game: gid(3), accounts: [A, D] })).rejects.toThrow(/already in a running ranked game/);
    await expect(h.svc.registerStart({ game: gid(4), match: 'm', ladder: '1v1-standard', startedAt: h.clock.iso(), seats: [{ seat: 1, account: D }] })).rejects.toThrow(RangeError);
  });

  it('open() loads the running starts and cooldowns; accountBusy follows registerStart, every close and forgetAccount', async () => {
    const store = createMemoryLadderStore();
    const h = await harness({ accounts: PLAYERS, store });
    await h.start({ game: gid(1), accounts: [A, B] });
    await h.start({ game: gid(2), accounts: [C, D] });
    const h2 = await harness({ accounts: PLAYERS, store });
    expect([A, B, C, D].map((a) => h2.svc.accountBusy(a))).toEqual([true, true, true, true]);
    await h2.svc.forgetAccount(C);
    expect([h2.svc.accountBusy(C), h2.svc.accountBusy(D)]).toEqual([false, true]);
  });

  it('every method that needs the memory refuses before open()', async () => {
    const h = await harness({ accounts: PLAYERS });
    const fresh = createLadderService({
      store: h.store, clock: h.clock, accounts: h.dir, moderation: h.sink, abuse: h.abuse, ledger: null, replays: null, config: TEST_CONFIG, log: h.logs.log,
    });
    await expect(fresh.intake(recordOf({ game: gid(1), ladder: '1v1-standard', accounts: [A, B], startedAt: h.clock.iso() }))).rejects.toThrow(/open\(\) first/);
    await expect(fresh.sweep()).rejects.toThrow(/open\(\) first/);
    expect(fresh.accountBusy(A)).toBe(false);
  });

  it('the configuration is checked at creation', async () => {
    const h = await harness();
    const ports = { store: h.store, clock: h.clock, accounts: h.dir, moderation: h.sink, abuse: h.abuse, ledger: null, replays: null, log: h.logs.log };
    expect(() => createLadderService({ ...ports, config: { ...TEST_CONFIG, secret: 'short' } })).toThrow(/secret/);
    expect(() => createLadderService({ ...ports, config: { ...TEST_CONFIG, firstSeason: '2026-13' } })).toThrow(/firstSeason/);
    expect(() => createLadderService({ ...ports, config: { ...TEST_CONFIG, offered: ['chess' as never] } })).toThrow(/offered/);
    expect(() => createLadderService({ ...ports, config: { ...TEST_CONFIG, tierFloors: { '1v1-standard': [1, 2] } } })).toThrow(/floors/);
  });
});

const HOUR_MS = 60 * MINUTE;

/** A dump without the times and ids that are allowed to differ between orders (appliedAt, closedAt, the markers' times). */
function normalize(dump: Record<string, [string, unknown][]>): unknown {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (typeof x !== 'object' || x === null) return x;
    return Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'appliedAt' && k !== 'closedAt' && k !== 'at').map(([k, v]) => [k, strip(v)]));
  };
  return Object.fromEntries(Object.entries(dump).map(([t, rows]) => [t, rows.map(([k, v]) => [k, strip(v)]).sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1))]));
}

