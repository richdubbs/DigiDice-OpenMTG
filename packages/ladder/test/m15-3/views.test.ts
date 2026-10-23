/**
 * M15-3: what the reads show and to whom (design 10.2, 10.3, 6.1, 6.4, D17, m14 2.4, 17.6): history visibility and pages, names through
 * displayNameAt with the viewer, "Hidden player" seats, the limited projection of every type, a failed attempt to match a Hidden row, the accepted
 * stakes inversion of 6.4, guests, accounts without a profile, status, and no deck, session or timing in any result.
 */
import { describe, expect, it } from 'vitest';
import { GLICKO2 } from '../../src/api';
import {
  acc, DAY, establish, gid, harness, MINUTE, memoryOf, SECRET_FIXTURES, text, type Harness,
} from './fixtures';

const [A, B, H, O] = [acc(1), acc(2), acc(3), acc(4)];

/** A plays B and H alternately, 12 games (A wins two of three), after both are established; H chose not to be listed. */
async function world(): Promise<Harness> {
  const h = await harness({ accounts: [1, 2, 4] });
  h.dir.add(H, 'Hidden Hannah', { privacy: { leaderboards: false, history: 'public' } });
  for (const x of [B, H, O]) await establish(h, x, { model: 'glicko2', r: 1500, rd: 60, vol: 0.06 }, { games: 40 });
  for (let i = 0; i < 12; i++) {
    const other = i % 2 === 0 ? B : H;
    await h.play({ game: gid(i + 1), accounts: [A, other], places: i % 3 === 1 ? [2, 1] : [1, 2] }); // game 12 (against H) a win
    h.clock.advance(40 * MINUTE);
  }
  // H also plays O enough for its own board row
  for (let i = 0; i < 4; i++) {
    await h.play({ game: gid(100 + i), accounts: [H, O], places: [1, 2] });
    h.clock.advance(40 * MINUTE);
  }
  return h;
}

/** Every value under one of these keys anywhere in `x`. */
function valuesOf(x: unknown, keys: readonly string[]): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) {
      for (const [k, w] of Object.entries(v)) {
        if (keys.includes(k)) out.push(w);
        walk(w);
      }
    }
  };
  walk(x);
  return out;
}

describe('M15-3: match history (10.2)', () => {
  it('private by default: null for others and guests, full for the account itself; public: readable by anyone', async () => {
    const h = await world();
    expect(await h.svc.history({ account: A }, B)).toBeNull();
    expect(await h.svc.history({ account: A }, null)).toBeNull();
    const own = (await h.svc.history({ account: A }, A))!;
    expect(own.entries).toHaveLength(12);
    expect(own.entries[0]!.subject.before).not.toBeNull();
    h.dir.get(A).privacy.history = 'public';
    expect((await h.svc.history({ account: A }, null))!.entries).toHaveLength(12);
    expect((await h.svc.history({ account: A }, B))!.entries).toHaveLength(12);
    // a suspended subject's public history is null for others (m14 7.3), and an unknown account has none
    h.dir.get(A).status = 'suspended';
    expect(await h.svc.history({ account: A }, B)).toBeNull();
    expect(await h.svc.history({ account: acc(77) }, null)).toBeNull();
  });

  it('pages newest first, keyset by (endedAt, game), at most 50; a ladder filter', async () => {
    const h = await world();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const p = (await h.svc.history({ account: A, limit: 5, cursor }, A))!;
      seen.push(...p.entries.map((e) => e.game));
      if (p.next === null) break;
      cursor = p.next;
    }
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => gid(12 - i)));
    expect((await h.svc.history({ account: A, ladder: '1v1-pioneer' }, A))!.entries).toEqual([]);
    await expect(h.svc.history({ account: A, limit: 51 }, A)).rejects.toThrow(RangeError);
    await expect(h.svc.history({ account: A, cursor: 'h' + 'A'.repeat(50) }, A)).rejects.toThrow(RangeError);
  });

  it('an entry: every player\'s place, loss, CR citation, turn out, name and tier; the subject\'s own change; the replay availability', async () => {
    const h = await world();
    h.replays.available.set(gid(12), { until: '2027-01-13T00:00:00.000Z', full: true });
    const e = (await h.svc.history({ account: A, limit: 1 }, A))!.entries[0]!;
    const seat = (await h.store.history({ account: A, limit: 1 }))[0]!.seats[0]!;
    expect(e).toMatchObject({ game: gid(12), ladder: '1v1-standard', season: '2026-10', outcome: 'win', turns: 9, replay: { until: '2027-01-13T00:00:00.000Z', full: true } });
    expect(e.subject).toEqual({ seat: 1, place: 1, before: seat.displayBefore, after: seat.displayAfter, tierAfter: seat.tierAfter });
    expect(e.players[0]).toEqual({ seat: 1, place: 1, loss: null, lossRule: null, outTurn: null, account: A, name: 'Player 1', deleted: false, tier: seat.tierAfter });
    expect(e.players[1]).toMatchObject({ seat: 2, place: 2, loss: 'life', lossRule: 'CR 104.3a', outTurn: 8 });
    expect((await h.svc.history({ account: A, limit: 2 }, A))!.entries[1]!.replay).toBeNull();
  });

  it('names through displayNameAt with the viewer: the name at the time on the viewer\'s own seat, current names on every other seat', async () => {
    const h = await world();
    h.dir.get(A).privacy.history = 'public';
    h.dir.get(A).name = 'Alice Renamed';
    h.dir.get(B).name = 'Bob Renamed';
    const byA = (await h.svc.history({ account: A, limit: 2 }, A))!.entries[1]!; // the game against B
    expect(byA.players.map((p) => p.name)).toEqual(['Player 1', 'Bob Renamed']);
    const byB = (await h.svc.history({ account: A, limit: 2 }, B))!.entries[1]!;
    expect(byB.players.map((p) => p.name)).toEqual(['Alice Renamed', 'Player 2']);
    const byGuest = (await h.svc.history({ account: A, limit: 2 }, null))!.entries[1]!;
    expect(byGuest.players.map((p) => p.name)).toEqual(['Alice Renamed', 'Bob Renamed']);
    // a forced rename redacted A's old name: A itself now sees its current name too
    h.dir.get(A).redacted.add('Player 1');
    expect((await h.svc.history({ account: A, limit: 1 }, A))!.entries[0]!.players[0]!.name).toBe('Alice Renamed');
  });

  it('an opponent with leaderboards false is "Hidden player" without a tier in others\' histories; a deleted one "Deleted player"', async () => {
    const h = await world();
    const e = (await h.svc.history({ account: A, limit: 1 }, A))!.entries[0]!; // game 12 is against H
    expect(e.players[1]).toEqual({ seat: 2, place: 2, loss: 'life', lossRule: 'CR 104.3a', outTurn: 8, account: null, name: null, deleted: false, tier: null });
    // H itself sees its own seat
    h.dir.get(A).privacy.history = 'public';
    expect((await h.svc.history({ account: A, limit: 1 }, H))!.entries[0]!.players[1]).toMatchObject({ account: H, name: 'Hidden Hannah' });
    await h.svc.forgetAccount(B);
    const vsB = (await h.svc.history({ account: A, limit: 2 }, A))!.entries[1]!;
    expect(vsB.players[1]).toMatchObject({ seat: 2, account: null, name: null, deleted: true, tier: null });
  });
});

describe('M15-3: the limited view (10.3) and the Hidden row', () => {
  it('for every type, others get the limited projection of an account with leaderboards false; the account itself everything', async () => {
    const h = await world();
    const mine = (await h.svc.profile(H, H))!;
    const theirs = (await h.svc.profile(H, A))!;
    const guests = (await h.svc.profile(H, null))!;
    expect([mine.limited, theirs.limited, guests.limited]).toEqual([false, true, true]);
    const r = theirs.ratings[0]!;
    expect([r.display, r.rank]).toEqual([null, null]);
    expect([r.tier, r.provisional, r.placementLeft, r.games]).toEqual([mine.ratings[0]!.tier, mine.ratings[0]!.provisional, 0, mine.ratings[0]!.games]);
    expect(mine.ratings[0]!.display).not.toBeNull();
    const s = theirs.seasons[0]!;
    expect([s.display, s.peak, s.median, s.rank]).toEqual([null, null, null, null]);
    expect([s.tier, s.games, s.wins, s.draws, s.losses]).toEqual([mine.seasons[0]!.tier, mine.seasons[0]!.games, mine.seasons[0]!.wins, 0, mine.seasons[0]!.losses]);
    expect(mine.seasons[0]!.display).not.toBeNull();
    // its public history: no rating numbers for others, the tier after stays
    const hist = (await h.svc.history({ account: H, limit: 1 }, A))!.entries[0]!;
    const ownHist = (await h.svc.history({ account: H, limit: 1 }, H))!.entries[0]!;
    expect([hist.subject.before, hist.subject.after, hist.subject.tierAfter]).toEqual([null, null, ownHist.subject.tierAfter]);
    expect(ownHist.subject.after).not.toBeNull();
    // its leaderboard row (10.1): no name, id or games; itself, everything
    const row = (await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, A)).entries.find((e) => e.account === null && !e.deleted);
    expect(row).toMatchObject({ name: null, games: null });
  });

  it('an attempt to match a Hidden row through the profile and the public history fails: no rating, rank, peak, median or before/after reaches another viewer', async () => {
    const h = await world();
    const page = await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null);
    const hidden = page.entries.filter((e) => e.account === null);
    expect(hidden).toHaveLength(1);
    for (const viewer of [A, B, null]) {
      const profile = await h.svc.profile(H, viewer);
      const history = await h.svc.history({ account: H }, viewer);
      for (const v of valuesOf([profile, history], ['display', 'before', 'after', 'peak', 'median', 'rank'])) expect(v).toBeNull();
      expect(text([profile, history])).not.toContain(`"display":${hidden[0]!.display}`);
    }
    // the badges carry no rank for others either
    expect(valuesOf(await h.svc.profile(H, A), ['badges']).flat().every((b) => (b as { rank: unknown }).rank === null)).toBe(true);
  });

  it('accepted (6.4): a player\'s own win and loss stakes against a hidden 1650/80 opponent give E and the gap within a few points', async () => {
    const h = await harness({ accounts: [1] });
    h.dir.add(H, 'Hidden Hannah', { privacy: { leaderboards: false } });
    const now = h.clock.now();
    await establish(h, A, { model: 'glicko2', r: 1600, rd: 60, vol: 0.06 }, { lastRatedAt: new Date(now - 2 * DAY).toISOString() });
    await establish(h, H, { model: 'glicko2', r: 1650, rd: 80, vol: 0.06 }, { lastRatedAt: new Date(now - 10 * DAY).toISOString() });
    await h.start({ game: gid(1), accounts: [A, H] });
    const mine = (await h.svc.stakes(gid(1))).get(A)!;
    expect(mine).toEqual({ ladder: '1v1-standard', kind: '1v1', win: 12, draw: mine.kind === '1v1' ? mine.draw : null, loss: -9 });
    // what A can infer: E = l / (w + l), then the gap from H's g at game time (G4: RD 86.524)
    const E = 9 / (12 + 9);
    const phi = 86.524 / GLICKO2.scale;
    const g = 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
    const gap = (GLICKO2.scale * Math.log((1 - E) / E)) / g;
    expect(Math.abs(E - 0.431055)).toBeLessThan(0.005);
    expect(Math.abs(gap - 50)).toBeLessThan(5);
  });
});

describe('M15-3: profiles and status', () => {
  it('per ladder played: the rating view, the current season, every badge; none for a suspended, banned or deleting account, nor a leaderboard row', async () => {
    const h = await world();
    const p = (await h.svc.profile(A, null))!;
    expect(p.ratings.map((r) => r.ladder)).toEqual(['1v1-standard']);
    expect(p.seasons.map((s) => s.season)).toEqual(['2026-10']);
    expect(p.ratings[0]).toMatchObject({ placementLeft: 0, games: 12, provisional: false });
    expect(p.ratings[0]!.rank).toBe((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null)).entries.find((e) => e.account === A)!.rank);
    for (const status of ['suspended', 'banned', 'deleting'] as const) {
      h.dir.get(A).status = status;
      expect(await h.svc.profile(A, null)).toBeNull();
      expect(await h.svc.profile(A, A)).toBeNull();
      expect((await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null)).entries.some((e) => e.account === A)).toBe(false);
    }
    expect(await h.svc.profile(acc(88), null)).toBeNull();
  });

  it('status: the season, signed in or not, the cooldown, each ladder\'s queue and the viewer\'s own view with its details', async () => {
    const h = await world();
    const guest = await h.svc.status(null);
    expect(guest).toMatchObject({ season: { id: '2026-10', endsAt: '2026-11-01T00:00:00.000Z' }, signedIn: false, cooldownUntil: null });
    expect(guest.ladders.map((l) => [l.ladder, l.offered, l.queue, l.me])).toEqual([
      ['1v1-standard', true, { waiting: 0, estimatedWaitMs: null }, null], ['1v1-pioneer', true, { waiting: 0, estimatedWaitMs: null }, null],
      ['1v1-pauper', true, { waiting: 0, estimatedWaitMs: null }, null], ['pod-commander', true, { waiting: 0, estimatedWaitMs: null }, null],
    ]);
    h.svc.attachQueue({ queued: () => null, status: (l) => ({ waiting: l === '1v1-standard' ? 3 : 0, estimatedWaitMs: 40_000 }), window: () => null, accounts: () => [] });
    await h.svc.readyCheckMissed('m1', [A]);
    await h.svc.readyCheckMissed('m2', [A]);
    const me = await h.svc.status(A);
    expect(me.signedIn).toBe(true);
    expect(me.cooldownUntil).toBe(new Date(h.clock.now() + 5 * MINUTE).toISOString());
    const std = me.ladders[0]!;
    expect(std.queue).toEqual({ waiting: 3, estimatedWaitMs: 40_000 });
    const row = (await h.store.ratings('1v1-standard', [A])).get(A)!;
    expect(std.me!.details).toMatchObject({ state: row.state, lastRatedAt: row.lastRatedAt, floors: [1300, 1425, 1550, 1675, 1800] });
    expect(std.me!.details.provisionalFrom).not.toBeNull();
    expect(std.me!.rating.display).not.toBeNull();
    expect(std.me!.season).toMatchObject({ season: '2026-10', games: 12 });
    // a ladder never played: placement ahead, the initial state
    expect(me.ladders[3]!.me!.rating).toEqual({ ladder: 'pod-commander', display: null, tier: null, provisional: false, placementLeft: 10, games: 0, rank: null });
  });

  it('no read result, and nothing stored, holds a deck, a session id or a timing', async () => {
    const h = await world();
    h.dir.get(A).privacy.history = 'public';
    const reads = [
      await h.svc.status(A), await h.svc.status(null), await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null),
      await h.svc.history({ account: A }, A), await h.svc.history({ account: A }, null), await h.svc.profile(A, A), await h.svc.profile(H, null),
      await h.svc.exportAccount(A),
    ];
    for (const s of SECRET_FIXTURES) {
      expect(text(reads), s).not.toContain(s);
      expect(text(memoryOf(h).dump()), s).not.toContain(s);
    }
  });
});
