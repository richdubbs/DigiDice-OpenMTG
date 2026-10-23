/**
 * M15-5: `capStall` (design 11.1, 8.5: at least 2 ranked games that reached a per-game cap within 30 days, as the driver or in a void without one)
 * from the cap events of rated and void games, and `dodging` (8.6: at least 6 missed ranked ready checks within 24 hours) (17.8).
 */
import { describe, expect, it } from 'vitest';
import { createAbuseChecker, type AbuseDraft } from '@openmtg/ladder';
import { A, ago, applied, B, C, capEvent, context, D, FakeAbuseStore, HOUR_MS, NOW, NOW_MS, win } from './fixtures';

const checker = createAbuseChecker();

function only(drafts: AbuseDraft[], kind: AbuseDraft['kind']): AbuseDraft[] {
  return drafts.filter((d) => d.kind === kind);
}

describe('M15-5: capStall', () => {
  // a plain game at NOW between A and D, after which the per-game check runs
  const g = win('g', NOW, A, D);
  const rated = (at = ago(20)) => capEvent('c1', at, [[A, 0.81], [B, 0.19]], 1); // A drove a rated game to the action cap (and lost it)
  const voided = () => capEvent('c2', ago(5), [[C, 0.5], [A, 0.5]], null, { kind: 'time' }); // a void at the time cap, no driver

  it('fires on a rated cap game A drove and a void one it was in, within 30 days; the ladder is null (every ladder counts)', async () => {
    const store = new FakeAbuseStore().add(g);
    store.caps.push(rated(), voided());
    expect(only(await checker.afterGame(applied(g), context(store)), 'capStall')).toEqual([{
      kind: 'capStall', ladder: null, accounts: [A],
      evidence: { games: ['c1', 'c2'], stats: { caps: 2, asDriver: 1, voidCaps: 1, actionCaps: 1, timeCaps: 1, 'share.1': 0.81, 'share.2': 0.5 } },
    }]);
  });

  it('does not count a cap whose driver was another seat (A was stalled against), nor one more than 30 days back', async () => {
    const victim = new FakeAbuseStore().add(g);
    victim.caps.push(capEvent('c1', ago(20), [[A, 0.19], [B, 0.81]], 2), voided());
    expect(only(await checker.afterGame(applied(g), context(victim)), 'capStall')).toEqual([]);
    const old = new FakeAbuseStore().add(g);
    old.caps.push(rated(ago(30.01)), voided());
    expect(only(await checker.afterGame(applied(g), context(old)), 'capStall')).toEqual([]);
  });

  it("counts the game's own cap event even before a read returns it", async () => {
    const capped = win('g', NOW, B, A, { loss: 'limit' });
    const own = capEvent('g', NOW, [[B, 0.1], [A, 0.9]], 2);
    const store = new FakeAbuseStore().add(capped);
    store.caps.push(voided());
    const drafts = only(await checker.afterGame(applied(capped, own), context(store)), 'capStall');
    expect(drafts.map((d) => [d.accounts, d.evidence.games, d.evidence.stats['asDriver']])).toEqual([[[A], ['c2', 'g'], 1]]);
  });

  it('a void-only pattern (no game applied for either) is found by the daily sweep', async () => {
    const store = new FakeAbuseStore().add(win('g0', ago(3), A, D));
    store.caps.push(capEvent('c1', ago(12), [[A, 0.5], [B, 0.5]], null), voided());
    const drafts = only(await checker.daily([], context(store)), 'capStall');
    expect(drafts.map((d) => [d.accounts, d.evidence.games, d.evidence.stats['voidCaps']])).toEqual([[[A], ['c1', 'c2'], 2]]);
  });

  // Known limit, open (M15-5 review, finding 4): an account whose ranked games in the window ALL voided at a cap has no applied game, so neither
  // afterGame nor the daily sweep (which finds accounts through gamesSince) judges it. Fixing it needs a read AbuseContext lacks (cap events by time
  // for the sweep, owned by M15-1) or the service calling the checker for a skipped ranked game with a cap event (M15-3); listed for M15-11.
  // `it.fails` turns red once such an account is judged: then make it a plain `it`.
  it.fails('daily: an account whose cap games in the window all voided (no rated game) is judged', async () => {
    const store = new FakeAbuseStore().add(win('other', ago(1), B, C));
    store.caps.push(capEvent('v1', ago(12), [[A, 0.7], [B, 0.3]], null), capEvent('v2', ago(8), [[A, 0.7], [C, 0.3]], null));
    expect(only(await checker.daily([], context(store)), 'capStall').map((d) => d.accounts)).toEqual([[A]]);
  });
});

describe('M15-5: dodging', () => {
  const at = (hours: number) => new Date(NOW_MS - Math.round(hours * HOUR_MS)).toISOString();
  const six = [at(23), at(20), at(12), at(6), at(1), at(0)];

  it('fires on 6 missed ready checks within 24 hours: no games, the ladder null, each miss in epoch ms', async () => {
    const drafts = await checker.afterMiss(A, six, context(new FakeAbuseStore()));
    expect(drafts).toEqual([{
      kind: 'dodging', ladder: null, accounts: [A],
      evidence: { games: [], stats: { misses: 6, ...Object.fromEntries(six.map((m, i) => [`miss.${i + 1}`, Date.parse(m)])) } },
    }]);
  });

  it('stays quiet when the oldest is a moment more than 24 hours back; one exactly 24 hours back counts', async () => {
    const store = new FakeAbuseStore();
    const late = [new Date(NOW_MS - 24 * HOUR_MS - 1).toISOString(), ...six.slice(1)];
    expect(await checker.afterMiss(A, late, context(store))).toEqual([]);
    const edge = [new Date(NOW_MS - 24 * HOUR_MS).toISOString(), ...six.slice(1)];
    expect((await checker.afterMiss(A, edge, context(store))).map((d) => d.evidence.stats['misses'])).toEqual([6]);
  });

  it('reads the stored misses too, counting each time once', async () => {
    const store = new FakeAbuseStore();
    store.penaltyRows.set(A, { account: A, misses: six.slice(0, 5), cooldownUntil: null });
    expect(await checker.afterMiss(A, six.slice(0, 5), context(store))).toEqual([]);
    expect((await checker.afterMiss(A, six.slice(3), context(store))).map((d) => d.evidence.stats['misses'])).toEqual([6]);
    expect(store.callsOf('penalties')).toEqual([[A], [A]]);
  });

  it('is anchored at now: misses older than 24 hours before now never count', async () => {
    const drafts = await checker.afterMiss(A, six, { ...context(new FakeAbuseStore()), now: new Date(NOW_MS + 2 * HOUR_MS).toISOString() });
    expect(drafts).toEqual([]);
  });
});
