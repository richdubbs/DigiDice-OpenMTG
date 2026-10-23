/**
 * M15-3: the sweep (design 8.3, 7, 11.1-11.2; LadderService.sweep, at start and every 60 s). Server only. One sweep at a time: a call while one runs
 * answers that one's report. Its steps, in order:
 *
 * 1. **The ledger read** (8.3), from the intake cursor less `cursorOverlapMs` (10 minutes; from the first season's start when there is no cursor
 *    yet): `ledger.resultsAfter` (keyset) when hosted has it, else `ledger.results` (m13's, inclusive `since`), 500 rows a page. Every row goes
 *    through intake in (endedAt, game) order, each as a job of the serial queue. The cursor never passes a row that was not applied, skipped or
 *    found duplicate: it moves to the last row of the leading run of such rows, never back. A 'failed' row stops it there (the later rows still go
 *    through intake; the next sweep reads from the failed row again); a row that failed in 10 sweeps in a row is logged `intake.stuck` at warn and
 *    never skipped. A full page with no row past the read position (more than a page of games ended in one millisecond, on the inclusive read)
 *    doubles the page, up to 10,000. A page that comes back short means the read caught up.
 * 2. **Reconciling running starts** (8.3): the running registry entries older than `reconcileAfterMs` (30 minutes), oldest first, at most 100.
 *    Hosted's record by game id goes through intake; a game hosted still has as running is left alone; one hosted has neither recorded nor running
 *    closes as `lost` (its accounts may queue again, its seats are told "not rated"), but only after its record is asked for once more AFTER the
 *    running read: a game that ended between its first result() and running() is not running and recorded by then, and goes through intake.
 * 3. **Season closes** (7, src/service/seasons.ts).
 * 4. **The daily abuse sweep** (11.1): at the first sweep of each UTC day, `AbuseChecker.daily` with the seasons closed since the last run: the
 *    closed seasons not yet handed over, as their rows record (SeasonRow.dailyAt), so a restart neither misses nor repeats one.
 * 5. **The report outbox** (11.2): up to 100 pending reports to the moderation sink, each accepted one marked sent (a report whose accounts are all
 *    deleted is marked sent without a call); sent stubs older than 7 days purged.
 *
 * With no ledger wired (`ledger: null`), steps 1 and 2 do nothing and the read counts as caught up. Before step 1 the current season's row of each
 * offered ladder is written if it is missing, so its floors are recorded at the season's start (6.3). `SweepReport.reports` counts the reports
 * filed into the outbox while the sweep ran (by its steps, and by any intake hosted ran meanwhile). Scheduling (at start, every
 * `LadderConfig.sweepEveryMs`) is hosted's (13.8).
 */
import { LADDER_IDS, nextSeason, seasonBounds, seasonOf, type LadderId, type SeasonId } from '../api';
import { isoMs } from '../api/season';
import type { IntakeResult } from '../ledger';
import type { IntakeCursor } from '../store/api';
import type { SweepReport } from './api';
import { liveAccounts, message, type ServiceCore } from './core';
import { intakeRecord } from './intake';
import { REPORT_WINDOW_MS } from './reports';
import { closeSeasonNow } from './seasons';

export const SWEEP_PAGE = 500;
export const SWEEP_PAGE_MAX = 10_000;
export const RECONCILE_LIMIT = 100;
export const STUCK_AFTER = 10;
export const OUTBOX_BATCH = 100;

/**
 * The sweep's own memory (not the store's): failures per game, the seasons known closed, the UTC day of the last daily run. Which closed seasons the
 * daily run has seen is the store's (SeasonRow.dailyAt), so a restart loses none.
 */
export class SweepState {
  /** Game → sweeps in a row in which its intake failed. */
  readonly failures = new Map<string, number>();
  /** Ladder → the last season known closed (so a sweep does not read every season since the first). */
  readonly closedThrough = new Map<LadderId, SeasonId>();
  lastDailyDay: string | null = null;
  running: Promise<SweepReport> | null = null;
}

function emptyReport(): SweepReport {
  return { applied: 0, skipped: 0, duplicates: 0, failed: 0, reconciled: 0, lostStarts: 0, caughtUp: true, seasonsClosed: [], reports: 0 };
}

function count(report: SweepReport, r: IntakeResult): void {
  if (r.kind === 'applied') report.applied++;
  else if (r.kind === 'skipped') report.skipped++;
  else if (r.kind === 'duplicate') report.duplicates++;
  else report.failed++;
}

function validTime(x: unknown): x is string {
  try {
    isoMs(x as string);
    return true;
  } catch {
    return false;
  }
}

/** (endedAt, game) order, times as instants. */
function compare(a: IntakeCursor, b: IntakeCursor): number {
  return isoMs(a.endedAt) - isoMs(b.endedAt) || (a.game < b.game ? -1 : a.game > b.game ? 1 : 0);
}

export function sweep(core: ServiceCore, state: SweepState): Promise<SweepReport> {
  core.mustBeOpen('sweep');
  if (state.running) return state.running;
  const run = runSweep(core, state).finally(() => {
    state.running = null;
  });
  state.running = run;
  return run;
}

async function runSweep(core: ServiceCore, state: SweepState): Promise<SweepReport> {
  const report = emptyReport();
  const filedBefore = core.filed;
  const readStartedAt = core.nowMs();
  const failedNow = new Set<string>();
  const okNow = new Set<string>();
  const note = (r: IntakeResult) => {
    count(report, r);
    if (r.kind === 'failed') failedNow.add(r.game);
    else okNow.add(r.game);
  };
  // the current season's row of each offered ladder, with its floors, from the season's first sweep on (6.3)
  const current = seasonOf(new Date(readStartedAt).toISOString());
  for (const ladder of LADDER_IDS) if (core.offered.has(ladder)) await core.serial(() => core.seasonRowOf(ladder, current));
  const ledger = core.ports.ledger;
  if (ledger !== null) {
    report.caughtUp = await readLedger(core, ledger, note);
    // the games this sweep's read already took in (or tried) are not asked about again
    await reconcile(core, ledger, report, note, new Set([...okNow, ...failedNow]));
  }
  for (const g of okNow) state.failures.delete(g);
  for (const g of failedNow) {
    const n = (state.failures.get(g) ?? 0) + 1;
    state.failures.set(g, n);
    if (n >= STUCK_AFTER) core.log.warn('intake.stuck', { game: g, sweeps: n });
  }
  report.seasonsClosed = await closeSeasons(core, state, readStartedAt, report.caughtUp);
  await daily(core, state);
  await sendOutbox(core);
  report.reports = core.filed - filedBefore;
  return report;
}

/** Step 1. Returns whether the read caught up (a short last page, and no row failed). */
async function readLedger(
  core: ServiceCore,
  ledger: NonNullable<ServiceCore['ports']['ledger']>,
  note: (r: IntakeResult) => void,
): Promise<boolean> {
  const cursor = await core.store.intakeCursor();
  const from = cursor === null
    ? seasonBounds(core.config.firstSeason).startsAt
    : new Date(Math.max(0, isoMs(cursor.endedAt) - core.config.cursorOverlapMs)).toISOString();
  let pos: IntakeCursor = { endedAt: from, game: '' };
  let limit = SWEEP_PAGE;
  let next: IntakeCursor | null = cursor;
  let blocked = false;
  let caughtUp = false;
  for (;;) {
    const page = ledger.resultsAfter ? await ledger.resultsAfter(pos, limit) : await ledger.results(new Date(pos.endedAt), limit);
    if (!Array.isArray(page)) throw new TypeError('the ledger read did not answer a list');
    const timed = new Set(page.filter((r) => validTime(r?.endedAt) && typeof r.game === 'string'));
    // rows without a time cannot be placed in the order: they still go through intake (it refuses them), and never move the cursor
    for (const r of page) if (!timed.has(r)) note(await core.serial(() => intakeRecord(core, r)));
    // past the read position only: the inclusive read (results) gives the rows of pos's millisecond again
    const rows = [...timed]
      .map((r) => ({ r, at: { endedAt: r.endedAt, game: r.game } }))
      .filter((x) => compare(x.at, pos) > 0)
      .sort((a, b) => compare(a.at, b.at));
    for (const { r, at } of rows) {
      const res = await core.serial(() => intakeRecord(core, r));
      note(res);
      if (res.kind === 'failed') blocked = true;
      else if (!blocked && (next === null || compare(at, next) > 0)) next = at;
    }
    if (page.length < limit) {
      caughtUp = !blocked;
      break;
    }
    const last = rows[rows.length - 1];
    if (last === undefined) {
      if (limit >= SWEEP_PAGE_MAX) {
        core.log.warn('intake.pageFull', { endedAt: pos.endedAt, limit });
        break;
      }
      limit = Math.min(limit * 2, SWEEP_PAGE_MAX);
      continue;
    }
    pos = last.at;
  }
  if (next !== null && (cursor === null || compare(next, cursor) > 0)) await core.store.setIntakeCursor(next);
  return caughtUp;
}

/** Step 2. */
async function reconcile(
  core: ServiceCore,
  ledger: NonNullable<ServiceCore['ports']['ledger']>,
  report: SweepReport,
  note: (r: IntakeResult) => void,
  seen: ReadonlySet<string>,
): Promise<void> {
  const before = new Date(Math.max(0, core.nowMs() - core.config.reconcileAfterMs)).toISOString();
  const starts = await core.store.runningStarts({ startedBefore: before, limit: RECONCILE_LIMIT });
  const unrecorded: string[] = [];
  for (const s of starts) {
    if (seen.has(s.game)) continue;
    const rec = await ledger.result(s.game);
    if (rec !== null && rec !== undefined) {
      report.reconciled++;
      note(await core.serial(() => intakeRecord(core, rec)));
    } else unrecorded.push(s.game);
  }
  if (unrecorded.length === 0) return;
  const running = await ledger.running(unrecorded);
  for (const game of unrecorded) {
    if (running.has(game)) continue;
    const lost = await core.serial(async () => {
      const start = await core.store.start(game);
      if (start === null || start.status !== 'running') return false;
      // Asked again, now that hosted has it as not running: a game that ended after its first result() and before running() is recorded by now
      // (finishGame writes the record and ends the running row in one transaction), so only a game with neither is lost (review of M15-3).
      const rec = await ledger.result(game);
      if (rec !== null && rec !== undefined) {
        report.reconciled++;
        note(await intakeRecord(core, rec));
        return false;
      }
      await core.store.closeStart(game, 'lost', core.nowIso());
      core.freeStart(start);
      core.log.warn('intake.lost', { game, ladder: start.ladder, startedAt: start.startedAt });
      core.emitNotRated({ game, ladder: start.ladder, reason: 'lost', accounts: liveAccounts(start) });
      return true;
    });
    if (lost) report.lostStarts++;
  }
}

/** Step 3: every season due, ladder by ladder, oldest first. */
async function closeSeasons(core: ServiceCore, state: SweepState, readStartedAt: number, caughtUp: boolean): Promise<SeasonId[]> {
  const now = core.nowMs();
  const current = seasonOf(new Date(now).toISOString());
  const closed = new Set<SeasonId>();
  for (const ladder of LADDER_IDS) {
    const known = state.closedThrough.get(ladder);
    for (let s = known === undefined ? core.config.firstSeason : nextSeason(known); s < current; s = nextSeason(s)) {
      const due = isoMs(seasonBounds(s).endsAt) + core.config.closeGraceMs;
      if (now < due) break;
      const row = await core.store.seasonRow(ladder, s);
      if (row?.status !== 'closed') {
        if (!caughtUp || readStartedAt < due) break;
        const endsAt = seasonBounds(s).endsAt;
        const runningBefore = (await core.store.runningStarts({ startedBefore: endsAt })).some((x) => x.ladder === ladder);
        if (runningBefore) break;
        if ((await core.serial(() => closeSeasonNow(core, ladder, s))) === 'closed') closed.add(s);
      }
      state.closedThrough.set(ladder, s);
    }
  }
  return [...closed].sort();
}

/** The season before `s`. */
function previousSeason(s: SeasonId): SeasonId {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return m > 1 ? `${s.slice(0, 4)}-${String(m - 1).padStart(2, '0')}` : `${String(y - 1).padStart(4, '0')}-12`;
}

/**
 * Step 4. The closed seasons handed over are the ones of the last two seasons whose row has no `dailyAt` yet; once the check ran and its reports
 * were filed, each gets `dailyAt`, in the store. So a season that closed before a restart (an outage over the first sweep of the next day) is still
 * handed over once, and one handed over before a restart is not handed over again (review of M15-3: the time of the last run used to live only in
 * this process's memory). A check that failed hands them over again at the next day's run.
 */
async function daily(core: ServiceCore, state: SweepState): Promise<void> {
  const now = core.nowMs();
  const nowIso = new Date(now).toISOString();
  const day = nowIso.slice(0, 10);
  if (state.lastDailyDay === day) return;
  const closedSeasons: { ladder: LadderId; season: SeasonId }[] = [];
  const current = seasonOf(nowIso);
  for (const ladder of LADDER_IDS) {
    for (let s = previousSeason(current), i = 0; i < 2; s = previousSeason(s), i++) {
      if (s < core.config.firstSeason) break;
      const row = await core.store.seasonRow(ladder, s);
      if (row?.status === 'closed' && (row.dailyAt ?? null) === null) closedSeasons.push({ ladder, season: s });
    }
  }
  closedSeasons.sort((a, b) => (a.season < b.season ? -1 : a.season > b.season ? 1 : a.ladder < b.ladder ? -1 : 1));
  const filed = await core.check('daily', (ctx) => core.ports.abuse.daily(closedSeasons, ctx));
  if (filed !== null) {
    for (const { ladder, season } of closedSeasons) {
      await core.serial(async () => {
        const row = await core.store.seasonRow(ladder, season);
        if (row?.status === 'closed' && (row.dailyAt ?? null) === null) await core.store.putSeasonRow({ ...row, dailyAt: nowIso });
      });
    }
  }
  state.lastDailyDay = day;
}

/** Step 5. */
async function sendOutbox(core: ServiceCore): Promise<void> {
  const pending = await core.store.pendingReports(OUTBOX_BATCH);
  let refused = 0;
  let error = '';
  for (const r of pending) {
    if (r.accounts.every((a) => a === null)) {
      await core.store.markReportSent(r.id, core.nowIso());
      continue;
    }
    try {
      await core.ports.moderation.submit(r);
    } catch (e) {
      refused++;
      error = message(e);
      continue;
    }
    await core.store.markReportSent(r.id, core.nowIso());
  }
  if (refused > 0) core.log.warn('reports.unsent', { reports: refused, error });
  await core.store.purgeReports(new Date(Math.max(0, core.nowMs() - REPORT_WINDOW_MS)).toISOString());
}
