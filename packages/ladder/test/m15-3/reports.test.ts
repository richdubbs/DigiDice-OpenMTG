/**
 * M15-3: abuse reports through the service (design 11.1-11.2, D18, 8.7, 17.8): the checks called after each game, each miss and once a UTC day
 * (with a fake checker; the heuristics are M15-5's), dedupe within 7 days by an HMAC key that holds no account id, the outbox (pending until the
 * sink accepts, then stripped to its key, kind and time, purged after 7 days), reports losing the account id after forgetAccount, and nothing a
 * report does changing a rating, a queue or a leaderboard.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ABUSE_REPORT_REASON, type AbuseDraft, type AbuseKind } from '../../src/abuse/types';
import { reportDedupeKey, REPORT_WINDOW_MS } from '../../src/service/reports';
import { acc, DAY, gid, harness, HOUR, MINUTE, memoryOf, TEST_SECRET, text, type Harness } from './fixtures';

const [A, B] = [acc(1), acc(2)];
const draft = (kind: AbuseKind = 'repeatedPairing', accounts = [B, A]): AbuseDraft => ({
  kind, ladder: '1v1-standard', accounts, evidence: { games: [gid(1)], stats: { games: 5 } },
});

async function played(): Promise<Harness> {
  const h = await harness({ accounts: [1, 2] });
  await h.play({ game: gid(1), accounts: [A, B] });
  return h;
}

describe('M15-3: filing reports (11.2)', () => {
  it('after each applied game the checks run for it and what they return is filed pending, with a ULID, the time and sorted accounts', async () => {
    const h = await harness({ accounts: [1, 2] });
    h.abuse.next.afterGame.push(draft());
    await h.play({ game: gid(1), accounts: [A, B] });
    expect(h.abuse.calls).toEqual([{ kind: 'afterGame', arg: gid(1) }]);
    const [r] = await h.store.pendingReports(5);
    expect(r).toMatchObject({ kind: 'repeatedPairing', ladder: '1v1-standard', accounts: [A, B], evidence: { games: [gid(1)], stats: { games: 5 } }, createdAt: h.clock.iso(), status: 'pending' });
    expect(r!.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it('one report per kind, ladder and set of accounts per 7-day window; the key is an HMAC that holds no account id', async () => {
    const h = await harness({ accounts: [1, 2] });
    for (let i = 0; i < 3; i++) {
      h.abuse.next.afterGame.push(draft(), draft('oneSided'));
      await h.play({ game: gid(i + 1), accounts: [A, B] });
      h.clock.advance(HOUR);
    }
    let reports = await h.store.reports('2026-01-01T00:00:00.000Z', 50);
    expect(reports.map((r) => r.kind).sort()).toEqual(['oneSided', 'repeatedPairing']);
    const key = Buffer.from(TEST_SECRET, 'base64url');
    const at = Date.parse(reports[0]!.createdAt);
    const expected = createHmac('sha256', key).update(`${reports[0]!.kind}|1v1-standard|${[A, B].join(',')}|${Math.floor(at / REPORT_WINDOW_MS)}`).digest('base64url');
    expect(reports[0]!.dedupeKey).toBe(expected);
    expect(reports[0]!.dedupeKey).toBe(reportDedupeKey(key, draft(reports[0]!.kind), at));
    for (const r of reports) {
      expect(r.dedupeKey).not.toContain(A.slice(4));
      expect(r.dedupeKey).not.toContain(B.slice(4));
    }
    // the next 7-day window files again
    h.clock.set(Math.ceil(at / REPORT_WINDOW_MS) * REPORT_WINDOW_MS + MINUTE);
    h.abuse.next.afterGame.push(draft());
    await h.play({ game: gid(9), accounts: [A, B] });
    reports = await h.store.reports('2026-01-01T00:00:00.000Z', 50);
    expect(reports.filter((r) => r.kind === 'repeatedPairing')).toHaveLength(2);
  });

  it('the outbox: pending until the sink accepts it, then sent and stripped to its key, kind and time; purged 7 days later', async () => {
    const h = await played();
    h.sink.refuse = true; // milestone 14 not wired yet
    h.abuse.next.afterGame.push(draft());
    await h.play({ game: gid(2), accounts: [A, B] });
    await h.svc.sweep();
    expect((await h.store.pendingReports(5)).map((r) => r.status)).toEqual(['pending']);
    expect(h.logs.events('warn')).toContain('reports.unsent');
    h.sink.refuse = false;
    h.clock.advance(MINUTE);
    await h.svc.sweep();
    expect(h.sink.submitted.map((r) => [r.kind, r.accounts])).toEqual([['repeatedPairing', [A, B]]]);
    expect(await h.store.pendingReports(5)).toEqual([]);
    const [sent] = await h.store.reports('2026-01-01T00:00:00.000Z', 5);
    expect(sent).toMatchObject({ kind: 'repeatedPairing', ladder: null, accounts: [], evidence: { games: [], stats: {} }, status: 'sent' });
    expect(text(memoryOf(h).dump()['reports'])).not.toContain(A);
    h.clock.advance(7 * DAY - 2 * MINUTE);
    await h.svc.sweep();
    expect(await h.store.reports('2026-01-01T00:00:00.000Z', 5)).toHaveLength(1);
    h.clock.advance(2 * MINUTE + 1); // strictly more than 7 days after it was sent
    await h.svc.sweep();
    expect(await h.store.reports('2026-01-01T00:00:00.000Z', 5)).toEqual([]);
  });

  it('reports lose the account id after forgetAccount; one whose accounts are all deleted is marked sent without a call', async () => {
    const h = await played();
    h.sink.refuse = true;
    h.abuse.next.afterGame.push(draft(), draft('smurf', [A]));
    await h.play({ game: gid(2), accounts: [A, B] });
    await h.svc.forgetAccount(A);
    const pending = await h.store.pendingReports(5);
    expect(pending.map((r) => r.accounts).sort((x, y) => y.length - x.length)).toEqual([[B, null], [null]]);
    h.sink.refuse = false;
    await h.svc.sweep();
    expect(h.sink.submitted.map((r) => r.accounts)).toEqual([[B, null]]);
    expect(await h.store.pendingReports(5)).toEqual([]);
  });

  it('a failing check or a bad draft is logged and never fails the game\'s intake (reports are advisory)', async () => {
    const h = await harness({ accounts: [1, 2] });
    h.abuse.afterGame = async () => {
      throw new Error('rule bug');
    };
    await h.play({ game: gid(1), accounts: [A, B] });
    expect(h.logs.events('warn')).toContain('abuse.checkFailed');
    const h2 = await harness({ accounts: [1, 2] });
    h2.abuse.next.afterGame.push({ kind: 'nonsense' } as never, draft());
    await h2.play({ game: gid(1), accounts: [A, B] });
    expect(h2.logs.events('warn')).toContain('abuse.badDraft');
    expect(await h2.store.pendingReports(5)).toHaveLength(1);
  });

  it('nothing a report does changes a rating, a queue entry, a cooldown or a leaderboard', async () => {
    const run = async (reports: boolean) => {
      const h = await harness({ accounts: [1, 2] });
      for (let i = 0; i < 12; i++) {
        if (reports) h.abuse.next.afterGame.push(draft('oneSided'), draft('sandbagging', [A]));
        await h.play({ game: gid(i + 1), accounts: [A, B], places: i % 3 === 1 ? [2, 1] : [1, 2] });
        h.clock.advance(HOUR);
      }
      if (reports) h.abuse.next.afterMiss.push(draft('dodging', [A]));
      await h.svc.readyCheckMissed('m', [A]);
      await h.svc.sweep();
      return {
        ratings: [...(await h.store.ratings('1v1-standard', [A, B]))], board: await h.svc.leaderboard({ ladder: '1v1-standard', season: 'current' }, null),
        eligibility: await h.svc.eligibility(A, '1v1-standard'), cooldown: h.svc.cooldownUntil(A), filed: (await h.store.reports('2026-01-01T00:00:00.000Z', 50)).length,
      };
    };
    const quiet = await run(false);
    const noisy = await run(true);
    expect(noisy.filed).toBe(3);
    expect({ ...noisy, filed: 0 }).toEqual({ ...quiet, filed: 0 });
  });
});

describe('M15-3: the daily abuse sweep (11.1)', () => {
  it('runs once per UTC day, with the seasons closed since the last run', async () => {
    const h = await harness({ accounts: [1, 2], start: '2026-10-31T23:50:00.000Z' });
    await h.svc.sweep();
    h.clock.advance(MINUTE);
    await h.svc.sweep();
    expect(h.abuse.calls.filter((c) => c.kind === 'daily').map((c) => c.arg)).toEqual([[]]);
    h.clock.set('2026-11-01T00:05:00.000Z'); // a new day, before October closes
    await h.svc.sweep();
    h.clock.set('2026-11-01T00:16:00.000Z'); // October closes
    await h.svc.sweep();
    h.clock.set('2026-11-02T00:01:00.000Z');
    h.abuse.next.daily.push(draft('parkedHigh', [A]));
    await h.svc.sweep();
    const daily = h.abuse.calls.filter((c) => c.kind === 'daily').map((c) => c.arg);
    expect(daily).toEqual([[], [], ['1v1-pauper', '1v1-pioneer', '1v1-standard', 'pod-commander'].map((ladder) => ({ ladder, season: '2026-10' }))]);
    // filed, and sent by the same sweep's outbox step
    expect(h.sink.submitted.map((r) => r.kind)).toEqual(['parkedHigh']);
  });

  it('a season that closed before a restart is handed over by the next process, once; one handed over before a restart is not again (review of M15-3)', async () => {
    const LADDERS_ALL = ['1v1-pauper', '1v1-pioneer', '1v1-standard', 'pod-commander'] as const;
    const october = LADDERS_ALL.map((ladder) => ({ ladder, season: '2026-10' }));
    const dailies = (x: { abuse: { calls: { kind: string; arg: unknown }[] } }) => x.abuse.calls.filter((c) => c.kind === 'daily').map((c) => c.arg);
    const h = await harness({ accounts: [1, 2], start: '2026-11-01T00:01:00.000Z' });
    await h.svc.sweep(); // the daily of 1 November, before October can close
    h.clock.set('2026-11-01T00:16:00.000Z');
    expect((await h.svc.sweep()).seasonsClosed).toEqual(['2026-10']);
    expect(dailies(h)).toEqual([[]]);
    // the server is down overnight, over the first sweep of 2 November; a new process starts at 08:00
    const h2 = await harness({ accounts: [1, 2], store: h.store, start: '2026-11-02T08:00:00.000Z' });
    await h2.svc.sweep();
    h2.clock.set('2026-11-03T00:01:00.000Z');
    await h2.svc.sweep();
    expect(dailies(h2)).toEqual([october, []]);
    expect((await h.store.seasonRow('1v1-standard', '2026-10'))?.dailyAt).toBe('2026-11-02T08:00:00.000Z');
    // and a restart after the handover does not hand it over again
    const h3 = await harness({ accounts: [1, 2], store: h.store, start: '2026-11-03T09:00:00.000Z' });
    await h3.svc.sweep();
    expect(dailies(h3)).toEqual([[]]);
  });

  it('a daily check that fails hands its closed seasons over again at the next day\'s run (review of M15-3)', async () => {
    const h = await harness({ accounts: [1, 2], start: '2026-11-01T00:16:00.000Z' });
    const handed: unknown[] = [];
    let fail = true;
    h.abuse.daily = async (closed) => {
      handed.push(closed.map((c) => c.season));
      if (fail) throw new Error('the check broke');
      return [];
    };
    await h.svc.sweep(); // closes October, then the daily of 1 November fails
    expect(h.logs.events('warn')).toContain('abuse.checkFailed');
    expect((await h.store.seasonRow('1v1-standard', '2026-10'))?.dailyAt ?? null).toBeNull();
    fail = false;
    h.clock.set('2026-11-02T00:01:00.000Z');
    await h.svc.sweep();
    h.clock.set('2026-11-03T00:01:00.000Z');
    await h.svc.sweep();
    expect(handed).toEqual([['2026-10', '2026-10', '2026-10', '2026-10'], ['2026-10', '2026-10', '2026-10', '2026-10'], []]);
  });

  it('maps every kind to milestone 14\'s report reasons as 11.2 gives them', () => {
    expect(ABUSE_REPORT_REASON).toEqual({
      repeatedPairing: 'collusion', oneSided: 'collusion', earlyConcessions: 'collusion', ratingTransfer: 'collusion',
      smurf: 'smurf', sandbagging: 'smurf', capStall: 'stalling', dodging: 'other', parkedHigh: 'other',
    });
  });
});
