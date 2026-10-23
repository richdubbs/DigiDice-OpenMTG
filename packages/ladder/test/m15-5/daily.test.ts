/**
 * M15-5: the daily sweep (design 11.1: "a daily sweep over the last 30 days"; 17.8 "the daily sweep pages through gamesSince") and what every check
 * may touch: it pages `gamesSince` over all ladders (games ending in one millisecond included) to find the accounts with games in the window, judges
 * the same rules as the per-game check anchored at `now`, each case once, in a fixed order; and no check calls anything but the store's reads, or
 * changes what they return (D18: reports only; nothing a check does changes a rating, a queue or a leaderboard).
 */
import { describe, expect, it } from 'vitest';
import { createAbuseChecker, type AbuseContext, type AbuseDraft, type HistoryRow } from '@openmtg/ladder';
import { A, acc, ago, applied, B, C, capEvent, context, D, directory, E, F, FakeAbuseStore, NOW, row, seasonRecord, win, RULES_11_1 } from './fixtures';

const checker = createAbuseChecker(RULES_11_1);

/** 450 games of 900 accounts that each play once, 250 of them ending in the same millisecond. */
function fillers(): HistoryRow[] {
  return Array.from({ length: 450 }, (_, i) => win(`x${String(i).padStart(3, '0')}`, i < 250 ? ago(20) : ago(19 - i / 100), acc(2000 + 2 * i), acc(2001 + 2 * i)));
}

/** A concedes 5 games before turn 3 to 5 opponents in the last 2 days (earlyConcessions). */
function conceder(): HistoryRow[] {
  return [B, C, D, E, F].map((o, i) => win(`e${i + 1}`, ago(2 - i * 0.4), o, A, { loss: 'concession', outTurn: 1, turns: 1 }));
}

describe('M15-5: the daily sweep', () => {
  it('pages through gamesSince from 30 days back, past a page boundary inside one millisecond, and finds the account on the last page', async () => {
    const store = new FakeAbuseStore().add(...fillers(), ...conceder());
    const ctx = context(store);
    const drafts = await checker.daily([], ctx);
    expect(drafts.map((d) => [d.kind, d.accounts])).toEqual([['earlyConcessions', [A]]]);
    const pages = store.callsOf('gamesSince').map((a) => a[0] as { since: string; after?: { endedAt: string; game: string }; limit: number; ladder?: string });
    expect(pages.map((p) => [p.since, p.after?.game, p.ladder])).toEqual([[ago(30), undefined, undefined], [ago(30), 'x199', undefined], [ago(30), 'x399', undefined]]);
    // every account with a game in the window was looked at once, its standings asked in batches
    expect(store.callsOf('history')).toHaveLength(900 + 6);
    expect(store.callsOf('capEvents')).toHaveLength(906);
    const asked = (ctx.accounts as ReturnType<typeof directory>).asked;
    expect(asked.map((b) => b.length)).toEqual([200, 200, 200, 200, 106]);
  });

  it('leaves out games older than the window and games of the future', async () => {
    const store = new FakeAbuseStore().add(
      ...[B, C, D, E, F].map((o, i) => win(`old${i}`, ago(30.5 + i), o, A, { loss: 'concession', outTurn: 1 })),
      win('later', ago(-1), B, C),
    );
    expect(await checker.daily([], context(store))).toEqual([]);
    expect(store.callsOf('history')).toEqual([]);
  });

  it('judges what the per-game check judges, anchored at now, and each pair once (from its lower account id)', async () => {
    // repeatedPairing and oneSided for A and B, earlyConcessions for A (B is never behind)
    const rows = [6, 5, 3, 2, 0].map((d, i) => win(`p${i + 1}`, ago(d), B, A, { loss: 'concession', outTurn: 2, turns: 2 }));
    const store = new FakeAbuseStore().add(...rows);
    const perGame = await checker.afterGame(applied(rows[4]!), context(store));
    const sweep = await checker.daily([], context(store));
    expect(perGame.map((d) => d.kind)).toEqual(['earlyConcessions', 'repeatedPairing', 'oneSided']);
    expect(sweep).toEqual(perGame);
    // a day later the first game has left repeatedPairing's and earlyConcessions' 7 days; oneSided's 30 days still hold all five
    const later = await checker.daily([], context(store, { now: ago(-1.5) }));
    expect(later.map((d) => d.kind)).toEqual(['oneSided']);
  });

  it('gives the same drafts in the same order for the same store and time', async () => {
    const quick = { outTurn: 3, turns: 3 }; // before turn 4 (oneSided), not before turn 3 and by 'life' (earlyConcessions stays quiet)
    const store = new FakeAbuseStore().add(...conceder(), ...[6, 5, 3, 2, 0].map((d, i) => win(`p${i + 1}`, ago(d), D, C, quick)));
    store.caps.push(capEvent('c1', ago(9), [[E, 0.9], [F, 0.1]], 1), capEvent('c2', ago(4), [[F, 0.5], [E, 0.5]], null));
    const one = await checker.daily([], context(store));
    const two = await checker.daily([], context(store));
    expect(one.map((d) => [d.kind, d.accounts])).toEqual([
      ['earlyConcessions', [A]], ['repeatedPairing', [C, D]], ['oneSided', [C, D]], ['capStall', [E]],
    ]);
    expect(two).toEqual(one);
  });
});

describe('M15-5: reports only', () => {
  const READS = new Set(['pairGames', 'history', 'gamesSince', 'capEvents', 'penalties', 'seasonRecord', 'seasonRecordsOf']);

  /** The store behind a guard that fails on anything but its reads (a write, or any other member). */
  function guarded(store: FakeAbuseStore): { ctx: AbuseContext; touched: Set<string> } {
    const touched = new Set<string>();
    const proxy = new Proxy(store, {
      get(target, key, receiver) {
        if (typeof key === 'string' && !READS.has(key)) throw new Error(`a check touched store.${key}`);
        touched.add(String(key));
        const v = Reflect.get(target, key, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
      set() {
        throw new Error('a check wrote the store');
      },
    });
    return { ctx: { ...context(store), store: proxy as unknown as AbuseContext['store'] }, touched };
  }

  it('afterGame, afterMiss and daily read and never write; the stored rows are unchanged', async () => {
    const store = new FakeAbuseStore().add(...conceder(), ...[6, 5, 3, 2, 0].map((d, i) => win(`p${i + 1}`, ago(d), D, C, { loss: 'left', outTurn: 1 })));
    store.caps.push(capEvent('c1', ago(9), [[A, 0.9], [B, 0.1]], 1), capEvent('c2', ago(4), [[B, 0.5], [A, 0.5]], null));
    store.penaltyRows.set(A, { account: A, misses: [ago(0.5), ago(0.4), ago(0.3), ago(0.2), ago(0.1)], cooldownUntil: ago(-0.01) });
    store.records.push(seasonRecord(A, { display: 1820, ratings: [1600, 1650, 1700], lastGameAt: '2026-09-02T00:00:00.000Z', finalRank: 1 }));
    const before = structuredClone({ rows: store.rows, caps: store.caps, penalties: [...store.penaltyRows], records: store.records });
    const { ctx, touched } = guarded(store);

    const drafts: AbuseDraft[] = [];
    drafts.push(...await checker.afterGame(applied(store.rows[4]!), ctx));
    drafts.push(...await checker.afterGame(applied(row('pod', NOW, [{ account: A, place: 1 }, { account: B, place: 2 }, { account: C, place: 3 }])), ctx));
    drafts.push(...await checker.afterMiss(A, [NOW], ctx));
    drafts.push(...await checker.daily([{ ladder: '1v1-standard', season: '2026-09' }], ctx));

    expect(new Set(drafts.map((d) => d.kind))).toEqual(new Set(['earlyConcessions', 'repeatedPairing', 'oneSided', 'capStall', 'dodging', 'parkedHigh']));
    expect([...touched].sort()).toEqual(['capEvents', 'gamesSince', 'history', 'pairGames', 'penalties', 'seasonRecordsOf']);
    expect({ rows: store.rows, caps: store.caps, penalties: [...store.penaltyRows], records: store.records }).toEqual(before);
    // a draft is only a draft: no id, time, dedupe key or status (the service adds them), and only game ids and numbers as evidence
    for (const d of drafts) {
      expect(Object.keys(d).sort()).toEqual(['accounts', 'evidence', 'kind', 'ladder']);
      expect(Object.keys(d.evidence).sort()).toEqual(['games', 'stats']);
      expect(d.accounts).toEqual([...d.accounts].sort());
      for (const v of Object.values(d.evidence.stats)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
