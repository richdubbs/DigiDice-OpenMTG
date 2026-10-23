/**
 * The group commit (design 2.2 step 5, 2.3, D4; package M13-5): records of many tables go to the store in one `appendRecords` every `everyMs` or
 * `maxRecords` records, whichever comes first; one batch at a time.
 * - **Each game is isolated**: a game the store reports failed (its own rows refused) is retried once on its own, and then fails only itself (the caller
 *   voids it, reason 'commit').
 * - **A store outage pauses** (outage.ts): a batch whose call throws a transient error is retried with a backoff for up to `outage.maxMs` (60 s); the
 *   tables in it wait, their messages held back; new records gather for the next batch meanwhile. Only past the bound does every game of the batch
 *   fail (`outage: true`).
 */
import { performance } from 'node:perf_hooks';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { GameStore, LogRecord } from '../store/api';
import { DEFAULT_OUTAGE, withRetry, type OutagePolicy } from './outage';

export type CommitOutcome = { ok: true } | { ok: false; error: string; outage: boolean };

interface Entry {
  game: string;
  records: LogRecord[];
  resolve: (o: CommitOutcome) => void;
}

export interface GroupCommitOptions {
  everyMs: number;
  maxRecords: number;
  outage?: Readonly<OutagePolicy>;
  logger?: Logger;
  metrics?: Metrics;
  /** A store call failed transiently (the runtime marks the outage: no new starts, readiness fails, notices). */
  onTransient?(): void;
  /** A store call succeeded (the outage, if any, is over). */
  onHealthy?(): void;
}

const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

export class GroupCommitter {
  private pending: Entry[] = [];
  private pendingRecords = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly outage: Readonly<OutagePolicy>;
  /** Games whose records are in the batch being written now (the tables waiting through an outage). */
  readonly writing = new Set<string>();
  /** Batches written (tests and metrics). */
  batches = 0;
  private stopped = false;

  constructor(private readonly store: Pick<GameStore, 'appendRecords'>, private readonly o: GroupCommitOptions) {
    this.logger = o.logger ?? NULL_LOGGER;
    this.metrics = o.metrics ?? NULL_METRICS;
    this.outage = o.outage ?? DEFAULT_OUTAGE;
  }

  /** Commits one step's records of a game (in `seq` order). Resolves once they are durable, or failed. */
  add(game: string, records: LogRecord[]): Promise<CommitOutcome> {
    if (records.length === 0) return Promise.resolve({ ok: true });
    return new Promise((resolve) => {
      this.pending.push({ game, records, resolve });
      this.pendingRecords += records.length;
      if (this.pendingRecords >= this.o.maxRecords) this.kick();
      else if (!this.timer && !this.running) this.timer = setTimeout(() => this.kick(), this.o.everyMs);
    });
  }

  /**
   * Stops retrying through an outage (close): a batch waiting for the store fails at its next failed attempt instead of waiting out the bound; its
   * tables stay 'running' in the store (nothing is voided while closing) and the next start recovers them from their committed records.
   */
  stop(): void {
    this.stopped = true;
  }

  /** Waits until everything added so far is committed or failed. */
  async flush(): Promise<void> {
    while (this.pending.length > 0 || this.running) {
      this.kick();
      if (this.running) await this.running;
    }
  }

  /** Games waiting for the store: in the batch being written, or gathered for the next one. */
  waitingGames(): string[] {
    return [...new Set([...this.writing, ...this.pending.map((e) => e.game)])];
  }

  private kick(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running || this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.pendingRecords = 0;
    for (const e of batch) this.writing.add(e.game);
    this.running = this.write(batch).finally(() => {
      this.writing.clear();
      this.running = null;
      if (this.pendingRecords >= this.o.maxRecords) this.kick();
      else if (this.pending.length > 0 && !this.timer) this.timer = setTimeout(() => this.kick(), this.o.everyMs);
    });
  }

  /** One store call through the outage policy. */
  private call(records: LogRecord[]): Promise<Map<string, string>> {
    return withRetry(() => this.append(records), this.outage, {
      failed: (e) => {
        this.logger.log('error', 'commitRetry', { records: records.length, error: errorName(e) });
        this.o.onTransient?.();
      },
      stop: () => this.stopped,
    });
  }

  private async write(batch: Entry[]): Promise<void> {
    const t0 = performance.now();
    this.batches++;
    const records = batch.flatMap((e) => e.records);
    let failed: Map<string, string>;
    try {
      failed = await this.call(records);
      this.o.onHealthy?.();
    } catch (e) {
      // Past the outage bound (or a refusal of the whole batch): every game of it fails.
      this.logger.log('error', 'commitBatchFailed', { records: records.length, error: errorName(e) });
      this.metrics.observe(METRICS.commitSeconds, (performance.now() - t0) / 1000);
      for (const x of batch) x.resolve({ ok: false, error: errorName(e), outage: true });
      return;
    }
    // One retry for each game the store refused, on its own (an ambiguous failure; a value the store refuses fails again).
    for (const [game, error] of [...failed]) {
      const mine = batch.filter((x) => x.game === game).flatMap((x) => x.records);
      try {
        const again = await this.call(mine);
        if (!again.has(game)) failed.delete(game);
        else failed.set(game, again.get(game)!);
      } catch {
        failed.set(game, error);
      }
    }
    this.metrics.observe(METRICS.commitSeconds, (performance.now() - t0) / 1000);
    for (const e of batch) {
      const error = failed.get(e.game);
      e.resolve(error === undefined ? { ok: true } : { ok: false, error, outage: false });
    }
  }

  private async append(records: LogRecord[]): Promise<Map<string, string>> {
    const r = await this.store.appendRecords(records);
    return new Map(r.failed.map((f) => [f.game, f.error]));
  }
}
