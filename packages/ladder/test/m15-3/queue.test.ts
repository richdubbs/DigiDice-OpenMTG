/**
 * M15-3: what the ranked queue needs from the ladder (design 8.6, 9.1, 9.4, 6.4, 13.4, 17.8): eligibility, the cooldown ladder over a rolling 24
 * hours (stored, so a reopen keeps it, and loaded into memory by open), the matcher's context, entries with their recent opponents and blocks, and
 * stakes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_RANKED_POLICY } from '../../src/match/api';
import { isUlid } from '../../src/ids';
import { openFileLadderStore } from '../../src/service/create';
import { acc, DAY, establish, gid, harness, HOUR, MINUTE } from './fixtures';

const [A, B, C, D] = [acc(1), acc(2), acc(3), acc(4)];
const root = mkdtempSync(join(tmpdir(), 'openmtg-m15-3-queue-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('M15-3: ready checks and cooldowns (8.6)', () => {
  it('within a rolling 24 hours: the 1st miss nothing, the 2nd 5 minutes, the 3rd 15, the 4th and later 60 each; no rating cost', async () => {
    const h = await harness({ accounts: [1, 2] });
    const t0 = h.clock.now();
    const got: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      h.clock.set(t0 + i * 2 * HOUR);
      got.push((await h.svc.readyCheckMissed(`m${i}`, [A]))[0]!.cooldownUntil);
    }
    const at = (ms: number) => new Date(ms).toISOString();
    expect(got).toEqual([null, at(t0 + 2 * HOUR + 5 * MINUTE), at(t0 + 4 * HOUR + 15 * MINUTE), at(t0 + 6 * HOUR + 60 * MINUTE), at(t0 + 8 * HOUR + 60 * MINUTE)]);
    expect(h.svc.cooldownUntil(A)).toBe(t0 + 8 * HOUR + 60 * MINUTE);
    expect(await h.store.ratings('1v1-standard', [A])).toEqual(new Map());
    // a miss older than 24 hours no longer counts: just over a day after the last one, the next miss is a 1st again
    h.clock.set(t0 + 8 * HOUR + 24 * HOUR + 1);
    expect((await h.svc.readyCheckMissed('late', [A]))[0]!.cooldownUntil).toBeNull();
    expect((await h.store.penalties(A))!.misses).toEqual([new Date(t0 + 8 * HOUR + 24 * HOUR + 1).toISOString()]);
    // the cooldown blocks only ranked queues: eligibility answers it with its end
    await h.svc.readyCheckMissed('again', [A]);
    expect(await h.svc.eligibility(A, '1v1-standard')).toEqual({ ok: false, reason: 'cooldown', until: new Date(h.clock.now() + 5 * MINUTE).toISOString() });
    h.clock.advance(5 * MINUTE);
    expect(await h.svc.eligibility(A, '1v1-standard')).toEqual({ ok: true });
    expect(h.svc.cooldownUntil(A)).toBeNull();
  });

  it('survives a store reopen: a new service loads the active cooldowns at open', async () => {
    const dir = join(root, 'cooldowns');
    let store = await openFileLadderStore({ dir });
    const h = await harness({ accounts: [1, 2], store });
    await h.svc.readyCheckMissed('m1', [A, B]);
    await h.svc.readyCheckMissed('m2', [A]);
    const until = h.svc.cooldownUntil(A)!;
    await store.close();
    store = await openFileLadderStore({ dir });
    const h2 = await harness({ accounts: [1, 2], store, start: h.clock.now() + MINUTE });
    expect(h2.svc.cooldownUntil(A)).toBe(until);
    expect(h2.svc.cooldownUntil(B)).toBeNull();
    expect(h2.svc.matcherContext(() => false).cooldown(A, h2.clock.now())).toBe(true);
    // the next miss escalates from the stored misses
    expect((await h2.svc.readyCheckMissed('m3', [A]))[0]!.cooldownUntil).toBe(new Date(h2.clock.now() + 15 * MINUTE).toISOString());
    await store.close();
  });

  it('each miss goes to the abuse checks (dodging), with the misses of the last 24 hours', async () => {
    const h = await harness({ accounts: [1] });
    await h.svc.readyCheckMissed('m1', [A]);
    h.clock.advance(MINUTE);
    await h.svc.readyCheckMissed('m2', [A]);
    expect(h.abuse.calls.filter((c) => c.kind === 'afterMiss').map((c) => (c.arg as { misses: string[] }).misses.length)).toEqual([1, 2]);
  });
});

describe('M15-3: eligibility and the matcher\'s context (13.4, 9.6)', () => {
  it('answers in order: notOffered, notSignedIn, notAllowed, inRankedGame, inQueue, cooldown, ok', async () => {
    const h = await harness({ accounts: [1, 2, 3, 4], config: { offered: ['1v1-standard', '1v1-pioneer'] } });
    expect(await h.svc.eligibility(A, 'pod-commander')).toEqual({ ok: false, reason: 'notOffered' });
    expect(await h.svc.eligibility('guest-1' as never, '1v1-standard')).toEqual({ ok: false, reason: 'notSignedIn' });
    h.dir.get(B).status = 'suspended';
    expect(await h.svc.eligibility(B, '1v1-standard')).toEqual({ ok: false, reason: 'notAllowed' });
    expect(await h.svc.eligibility(acc(50), '1v1-standard')).toEqual({ ok: false, reason: 'notAllowed' });
    await h.start({ game: gid(1), accounts: [C, D] });
    expect(await h.svc.eligibility(C, '1v1-pioneer')).toEqual({ ok: false, reason: 'inRankedGame' });
    expect(await h.svc.eligibility(A, '1v1-standard')).toEqual({ ok: true });
    h.svc.attachQueue({ queued: (a) => (a === A ? '1v1-pioneer' : null), status: () => ({ waiting: 0, estimatedWaitMs: null }), window: () => null, accounts: () => [] });
    expect(await h.svc.eligibility(A, '1v1-standard')).toEqual({ ok: false, reason: 'inQueue' });
    expect(() => h.svc.attachQueue({} as never)).toThrow(TypeError);
  });

  it('the matcher\'s context: the service\'s memory, the offered ladders, DEFAULT_RANKED_POLICY and ULID match ids', async () => {
    const h = await harness({ accounts: [1, 2, 3, 4], config: { offered: ['1v1-standard'] } });
    const sessions = new Set(['s1']);
    const ctx = h.svc.matcherContext((s) => sessions.has(s));
    await h.start({ game: gid(1), accounts: [A, B] });
    await h.svc.readyCheckMissed('m', [C]);
    await h.svc.readyCheckMissed('m', [C]);
    expect([ctx.sessionBusy('s1'), ctx.sessionBusy('s2')]).toEqual([true, false]);
    expect([ctx.accountBusy(A), ctx.accountBusy(C)]).toEqual([true, false]);
    expect([ctx.cooldown(C, h.clock.now()), ctx.cooldown(C, h.clock.now() + 5 * MINUTE), ctx.cooldown(D, h.clock.now())]).toEqual([true, false, false]);
    expect([ctx.offered('1v1-standard'), ctx.offered('1v1-pauper')]).toEqual([true, false]);
    expect(ctx.policy).toBe(DEFAULT_RANKED_POLICY);
    const ids = [ctx.newMatchId(), ctx.newMatchId()];
    expect(ids.every(isUlid)).toBe(true);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('M15-3: entries and stakes (9.1, 9.4, 6.4)', () => {
  it('entryFor: the rating now, placement, the last 3 games\' opponents newest first, and only the blocks that involve the entry', async () => {
    const h = await harness({ accounts: [1, 2, 3, 4, 5] });
    for (const [i, o] of [B, C, D, B].entries()) {
      await h.play({ game: gid(i + 1), accounts: [A, o] });
      h.clock.advance(HOUR);
    }
    h.dir.blocks.push([A, C], [B, D], [acc(5), A]);
    const { entry, blocks } = await h.svc.entryFor({ account: A, session: 's', addressKey: 'k', ladder: '1v1-standard', deck: 'd1', enteredAt: h.clock.now() }, [B, C, D, acc(5), A]);
    const row = (await h.store.ratings('1v1-standard', [A])).get(A)!;
    expect(entry).toMatchObject({ account: A, session: 's', addressKey: 'k', ladder: '1v1-standard', deck: 'd1', placement: true, recent: [[B], [D], [C]] });
    expect(entry.rating).toBe(Math.round((row.state as { r: number }).r));
    expect(entry.deviation).toBeGreaterThan((row.state as { rd: number }).rd); // an hour of time away
    expect(blocks).toEqual([[A, C], [acc(5), A]]);
    expect((await h.svc.entryFor({ account: acc(5), session: 's', addressKey: 'k', ladder: '1v1-standard', deck: 'd', enteredAt: 0 }, [])).entry)
      .toMatchObject({ rating: 1500, deviation: 350, placement: true, recent: [] });
    expect(await h.svc.blockedAmong([A, B, C, D])).toEqual([[A, C], [B, D]]);
  });

  it('stakes: a preview from ratingNow at the start (G4: +12 / -9), null during placement, by place for pods', async () => {
    const h = await harness({ accounts: [1, 2, 3, 4, 5, 6] });
    const now = h.clock.now();
    await establish(h, A, { model: 'glicko2', r: 1600, rd: 60, vol: 0.06 }, { lastRatedAt: new Date(now - 2 * DAY).toISOString() });
    await establish(h, B, { model: 'glicko2', r: 1650, rd: 80, vol: 0.06 }, { lastRatedAt: new Date(now - 10 * DAY).toISOString() });
    await h.start({ game: gid(1), accounts: [A, B] });
    const s = await h.svc.stakes(gid(1));
    expect(s.get(A)).toMatchObject({ ladder: '1v1-standard', kind: '1v1', win: 12, loss: -9 });
    expect(s.get(B)).toMatchObject({ kind: '1v1' });
    await h.start({ game: gid(2), accounts: [C, D] });
    expect((await h.svc.stakes(gid(2))).get(C)).toEqual({ ladder: '1v1-standard', kind: '1v1', win: null, draw: null, loss: null });
    for (const a of [acc(5), acc(6)]) await establish(h, a, { model: 'wenglin', mu: 25, sigma: 3 }, { ladder: 'pod-commander', games: 30 });
    // two established pod players and two new ones (in placement)
    await h.start({ game: gid(3), ladder: 'pod-commander', accounts: [acc(5), acc(6), acc(7), acc(8)] });
    const pod = await h.svc.stakes(gid(3));
    const five = pod.get(acc(5))!;
    expect(five.kind).toBe('pod');
    if (five.kind === 'pod') {
      expect(five.byPlace).toHaveLength(4);
      expect(five.byPlace[0]!).toBeGreaterThan(0);
      expect(five.byPlace[3]!).toBeLessThan(0);
    }
    expect(pod.get(acc(7))).toEqual({ ladder: 'pod-commander', kind: 'pod', byPlace: [null, null, null, null] });
    expect(await h.svc.stakes(gid(99))).toEqual(new Map());
  });
});
