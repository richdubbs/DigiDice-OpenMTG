/**
 * Retention (design 8.3, owner answer 11; package M13-14): `GameStore.purge` deletes what the policy lets go (action logs, decklists and report logs of
 * finished games after 90 days, lobby tables that never started after 7, void and quarantined games after 90, guest sessions 30 days after their last
 * use; results and placements are kept). Two ways to run it:
 *
 * - `runPurge`, once: the operator's `purge` command (src/ops/main.ts);
 * - `startPurgeSchedule`, daily inside the server: the design says "`purge` runs daily". Not wired by this package (main.ts is the gateway package's):
 *   `const purging = startPurgeSchedule({ store, retention: config.retention, logger })` after the store is open and `purging.stop()` in `close`.
 *
 * The purge is idempotent and only ever deletes rows older than the policy, so a run that overlaps another, or that is repeated, is harmless; the schedule
 * still never starts a run while one is going. A failing run is logged (`purgeFailed`) and tried again at the next time, never thrown.
 */
import { NULL_LOGGER, type Logger } from '../obs';
import type { GameStore, PurgeReport, RetentionPolicy } from '../store/api';

export const DAY_MS = 86_400_000;

/** Purges once and logs the counts. Throws what the store throws. */
export async function runPurge(store: Pick<GameStore, 'purge'>, retention: RetentionPolicy, now: Date = new Date(), logger: Logger = NULL_LOGGER): Promise<PurgeReport> {
  const report = await store.purge(
    { logsDays: retention.logsDays, lobbyDays: retention.lobbyDays, voidDays: retention.voidDays, sessionDays: retention.sessionDays },
    now,
  );
  logger.log('info', 'purge', { ...report });
  return report;
}

/** The timers the schedule uses (tests pass their own). */
export interface PurgeTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const SYSTEM_TIMERS: PurgeTimers = {
  set: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
};

export interface PurgeScheduleOptions {
  store: Pick<GameStore, 'purge'>;
  retention: RetentionPolicy;
  logger?: Logger;
  /** The first run, after the server has been up this long (default 10 minutes: not in the middle of a recovery); then every `everyMs` (default a day). */
  firstAfterMs?: number;
  everyMs?: number;
  now?: () => Date;
  timers?: PurgeTimers;
}

export interface PurgeSchedule {
  /** Cancels the next run; a run that is going finishes. */
  stop(): void;
  /** Runs now (the timer's own path); resolves to the report, or null when a run is going or it failed. */
  runNow(): Promise<PurgeReport | null>;
}

/** Runs `runPurge` first after `firstAfterMs`, then every `everyMs`; the timer is unref'd (it never keeps the process alive). */
export function startPurgeSchedule(o: PurgeScheduleOptions): PurgeSchedule {
  const logger = o.logger ?? NULL_LOGGER;
  const timers = o.timers ?? SYSTEM_TIMERS;
  const everyMs = o.everyMs ?? DAY_MS;
  let handle: unknown = null;
  let running: Promise<PurgeReport | null> | null = null;
  let stopped = false;

  const run = (): Promise<PurgeReport | null> => {
    if (running) return Promise.resolve(null);
    running = runPurge(o.store, o.retention, (o.now ?? (() => new Date()))(), logger).then(
      (r) => r,
      (e: unknown) => {
        logger.log('error', 'purgeFailed', { error: e instanceof Error ? e.name : 'error' });
        return null;
      },
    ).finally(() => {
      running = null;
    });
    return running;
  };
  const arm = (ms: number): void => {
    if (stopped) return;
    handle = timers.set(() => {
      void run().then(() => arm(everyMs));
    }, ms);
  };
  arm(o.firstAfterMs ?? 10 * 60_000);
  return {
    stop: () => {
      stopped = true;
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
    runNow: run,
  };
}
