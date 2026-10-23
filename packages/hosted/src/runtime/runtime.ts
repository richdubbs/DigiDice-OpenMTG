/**
 * The game runtime (design 2.1-2.3, D3-D5, D15, 4.6's signals; package M13-5): the main thread's side of the game workers.
 *
 * - **Placement and routing**: a table is placed on the least-loaded live game worker (capacity units) when it starts and stays there; `submit` routes by
 *   game id. A recovery re-places a table on the replacement worker.
 * - **Mailboxes**: each table's messages wait in its mailbox on the main thread; the table has at most one message at its worker, and its next message
 *   goes only after the previous step's records committed. Each worker has at most one message in flight (the watchdog knows the culprit exactly).
 * - **Group commit, write-ahead**: a step's records go into the group commit (runtime/commit.ts); its sends are delivered only after they committed; a
 *   won or drawn game's last record goes into `finishGame`'s transaction with the ledger row (`writeResult` with `commitLast`), before the result is sent.
 *   A game whose own rows the store refuses (twice) is void, that table only (`void { reason: 'commit' }`, design 2.3); the sends of the step that
 *   failed are never delivered.
 * - **Store outages** (owner decision, review MAJOR 2; outage.ts): the store unreachable PAUSES the tables waiting for it (sends held back) for up to
 *   60 s with a backoff; starts are refused (`busy`, admission's 'store' signal), `ready()` fails, waiting seats get a notice after 3 s; only past the
 *   bound is a table voided. The runtime's own voids are durable: noted as pending (pending.ts) and retried until the store has them; `ended` and the
 *   players' notice come only then; `open()` applies voids an earlier process could not save before it recovers anything.
 * - **Snapshots**: a step's checkpoint (every 100 records) is stored after its record committed (`putSnapshot`, review 8).
 * - **The timer wheel**: one deadline per table (`TableStep.nextDeadline`), re-armed after every step; a due table gets a `tick` behind the messages
 *   already in its mailbox (inputs received before an instant go first: the clock's same-instant rule).
 * - **The watchdog** (D15): a worker message (an action, a start, a recovery's replayed record, an inspection) past `watchdogMs` terminates the worker.
 *   Whenever a worker is lost (the watchdog, a crash, an out-of-memory exit), the table whose message was in flight is the suspect (review MAJOR 1):
 *   its message is never sent again (its seat gets an error) and it is quarantined (void, status 'quarantined', its log kept; never placed again); the
 *   worker's other tables are recovered on a fresh worker without their recoveries counting. Only a worker that died between messages has no suspect
 *   (then every recovery counts). A recovery also has a total time budget. A worker that dies while booting is replaced after a backoff.
 * - **Recovery** (D5): counted per table (`countRecovery`); a table needing its `maxRecoveries`th (2nd) recovery is quarantined instead. Same engine build:
 *   the newest snapshot of this build plus the records after it, every checkpoint hash compared (a mismatch is an engine bug: void 'recovery', counted as an engine
 *   error). Another build: every record from the first, every checkpoint hash compared (a mismatch, or a record that no longer applies: void 'updated'),
 *   or void at once (`otherBuild: 'void'`). Seats the runtime knew as connected get a `connect` (a full view) after a worker recovery.
 * - **The ledger**: at a game's end `writeResult` (M13-7); a void game's records are committed first.
 * - **Drain** (design 2.3): no new starts; running games go on; at `drainMaxMinutes` the rest are void ('updated').
 */
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { commanderVariantOf, type DeckSubmission } from '@openmtg/net/server-kit';
import type { GameConfig } from '@openmtg/engine';
import type { SeatNumber } from '../api';
import { capacityUnits, DEFAULT_UNITS, type CapacitySignals, type UnitWeights } from '../admission/api';
import { RUNTIME_LIMITS } from '../config';
import { TimerWheel } from '../clock/timer-wheel';
import { voidStatus, type LedgerGame } from '../ledger/record';
import type { GameRecord, VoidReason } from '../ledger/types';
import { writeResult } from '../ledger/writer';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import type { GameStore, LogRecord, RecoveryData } from '../store/api';
import { newTableSeed, tableConfig } from '../table/config';
import type { SeatSend, TableCommand, TableEnd } from '../table/types';
import type {
  DeckResult, DrainReport, GameWorkerReply, GameWorkerRequest, RecoveryCause, RecoveryReport, Runtime, RuntimeEvents, RuntimeOptions, RuntimeTuning,
  SeatInput, StartGameRequest, StartGameResult, TableInspection, TableMeta, WireCheckpoint, WireStep,
} from './api';
import { GroupCommitter } from './commit';
import { DEFAULT_OUTAGE, isSettled, isTransient, withRetry } from './outage';
import { PendingVoids } from './pending';
import { DeckWorkerPool } from './deck-pool';
import { RuntimeSignals } from './signals';
import { DEFAULT_CARD_SOURCE, GAME_WORKER_ENTRY, spawnWorker } from './spawn';
import type { Worker } from 'node:worker_threads';

export const DEFAULT_TUNING: Readonly<RuntimeTuning> = {
  watchdogMs: RUNTIME_LIMITS.watchdogMs,
  commitEveryMs: RUNTIME_LIMITS.commitEveryMs,
  commitMaxRecords: RUNTIME_LIMITS.commitMaxRecords,
  deckDeadlineMs: RUNTIME_LIMITS.deckDeadlineMs,
  deckQueue: RUNTIME_LIMITS.deckQueue,
  workerHeapMb: RUNTIME_LIMITS.workerHeapMb,
  maxRecoveries: RUNTIME_LIMITS.maxRecoveries,
  unloadAfterMs: 10 * 60_000,
  drainMaxMinutes: 250,
  otherBuild: 'verify',
  p95MinSamples: 20,
  outage: { ...DEFAULT_OUTAGE },
  recoveryBudgetMs: 60_000,
  voidRetryMs: 5 * 60_000,
  hotTableMs: 20_000,
  respawnFirstMs: 1_000,
  respawnCapMs: 30_000,
};

/** What players read when the runtime itself ends a game without a result (the table actor's words for the same reasons). */
const VOID_WORDS: Record<VoidReason, string> = {
  abandoned: 'nobody in the game was connected for 5 minutes',
  limit: 'it reached a limit of the server (actions, time or size)',
  recovery: 'the server could not restore it',
  commit: 'the server could not save it',
  quarantined: 'it stopped the server',
  updated: 'the server was updated',
};

type Phase = 'starting' | 'idle' | 'queued' | 'busy' | 'committing' | 'recovering';

interface Queued {
  cmd: TableCommand;
  /** Real time it was submitted (the action-time signal). */
  received: number;
}

interface Table {
  game: string;
  meta: TableMeta;
  units: number;
  host: number;
  mailbox: Queued[];
  phase: Phase;
  /** The command at the worker now (dropped if the worker dies: its table is the suspect). */
  current: Queued | null;
  /** The store has the game as started (`startGame` succeeded): a void of a table that never got this far writes nothing. */
  stored: boolean;
  /** Seats the gateway has connected (from `connect` / `disconnect`) and seats that left. */
  connected: Set<SeatNumber>;
  left: Set<SeatNumber>;
  lastRecord: LogRecord | null;
  engineErrors: number;
  ended: TableEnd | null;
  gone: boolean;
  /** Being voided by the runtime itself (quarantine, a failed recovery or commit): no more commands go to it. */
  doomed: boolean;
  /** Its actor is about to void it (a failed commit): no more input is taken (review minor 7). */
  voiding: boolean;
  /** Recover when idle; `count`: the recovery counts toward quarantine (false when another table was the known suspect of a worker loss). */
  needsRecovery: { cause: RecoveryCause; count: boolean } | null;
  /** Worker time this table used (real ms), for the hot-table warning. */
  busy: { at: number; ms: number }[];
  hotWarned: number;
  /** The "busy saving" notice of the current store outage was sent. */
  outageNoticed: boolean;
  unloadTimer: ReturnType<typeof setTimeout> | null;
  idleWaiters: (() => void)[];
}

interface Job {
  id: number;
  game: string;
  kind: GameWorkerRequest['kind'];
  /** Built when it is dispatched (a command job takes its mailbox head then). */
  build(): GameWorkerRequest;
  onReply(m: GameWorkerReply): void;
  /** The worker died with this job queued or in flight. */
  onLost(): void;
}

interface Host {
  index: number;
  worker: Worker;
  ready: boolean;
  dead: boolean;
  queue: Job[];
  inflight: { job: Job; started: number; timer: ReturnType<typeof setTimeout> | null; budget: ReturnType<typeof setTimeout> | null } | null;
  tables: Set<string>;
  /** Set when the main thread terminates it (the exit that follows is expected). */
  terminating: boolean;
  crash: { oom: boolean } | null;
  /** Workers of this slot that died before they were ready, in a row (the respawn backoff). */
  bootFailures: number;
}

const realNow = (): number => performance.now();

export class GameRuntime implements Runtime {
  private readonly store: GameStore;
  private readonly events: RuntimeEvents;
  private readonly tuning: RuntimeTuning;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly now: () => number;
  /** This process's engine build (`RuntimeOptions.engineBuild`, else net's fingerprint of the engine sources, read in `open`). */
  engineBuild: string;
  readonly workerCount: number;
  private readonly hosts: Host[] = [];
  private readonly tables = new Map<string, Table>();
  private readonly committer: GroupCommitter;
  private readonly wheel = new TimerWheel<string>();
  private wheelTimer: { at: number; handle: ReturnType<typeof setTimeout> } | null = null;
  private deckPool: DeckWorkerPool | null = null;
  private readonly signals: RuntimeSignals;
  /** The capacity units per table size (`UNITS_*`): the same weights admission reserves and frees with (M13-10 review). */
  private readonly weights: Readonly<UnitWeights>;
  private drainingNow = false;
  /** close() has begun: nothing new is dispatched or recovered. */
  private closing = false;
  private closed = false;
  private nextJob = 1;
  private readonly work = new Set<Promise<unknown>>();
  private readonly changeWaiters = new Set<() => void>();
  /** Games quarantined in this process (never placed again, also not by a later `start` with the same id). */
  private readonly quarantined = new Set<string>();
  /** Voids decided but not yet in the store (applied by the next open() if this process stops first). */
  private pending: PendingVoids | null = null;
  /** Since when (real time) the store has been failing; null while it answers. */
  private outageSince: number | null = null;
  private outageTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: RuntimeOptions) {
    this.store = o.store;
    this.events = o.events;
    this.tuning = { ...DEFAULT_TUNING, ...o.tuning };
    this.logger = o.logger ?? NULL_LOGGER;
    this.metrics = o.metrics ?? NULL_METRICS;
    this.now = o.now ?? Date.now;
    this.engineBuild = o.engineBuild ?? 'unknown';
    this.weights = { ...DEFAULT_UNITS, ...o.units };
    this.workerCount = Math.max(1, o.workers ?? cpus().length - 1);
    this.committer = new GroupCommitter(this.store, {
      everyMs: this.tuning.commitEveryMs, maxRecords: this.tuning.commitMaxRecords, outage: this.tuning.outage, logger: this.logger, metrics: this.metrics,
      onTransient: () => this.storeFailing(), onHealthy: () => this.storeHealthy(),
    });
    this.signals = new RuntimeSignals(
      {
        runningUnits: () => this.runningUnits(), workers: () => this.hosts.filter((h) => !h.dead).length, outbound: () => (o.outbound ? o.outbound() : 0),
        store: () => this.outageSince !== null,
      },
      this.tuning.p95MinSamples,
      realNow,
    );
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Life cycle

  async open(): Promise<RecoveryReport> {
    // net's build fingerprint, loaded only when no build is given (net's index carries its UDP link too, which the hosted server never uses).
    if (this.o.engineBuild === undefined) this.engineBuild = (await import('@openmtg/net')).localVersions().build ?? 'unknown';
    for (let i = 0; i < this.workerCount; i++) this.hosts.push(this.spawnHost(i));
    const decks = this.o.deckWorkers ?? 1;
    if (decks > 0) {
      this.deckPool = new DeckWorkerPool({
        workers: decks,
        cards: this.o.cards ?? { module: DEFAULT_CARD_SOURCE, options: { cacheDir: this.o.cardDataDir ?? null } },
        deadlineMs: this.tuning.deckDeadlineMs,
        queue: this.tuning.deckQueue,
        logger: this.logger,
      });
    }
    await Promise.all([this.whenHostsReady(), this.deckPool?.ready()]);
    const report: RecoveryReport = { recovered: [], voided: [] };
    // Voids an earlier process decided but could not save come first: a quarantined culprit is never placed again.
    this.pending = await PendingVoids.open(this.o.pendingVoidsFile ?? null);
    for (const v of this.pending.list()) {
      let saved = true;
      try {
        await this.retry(() => this.store.voidGame(v.game, v.reason, v.status));
      } catch (e) {
        if (isTransient(e)) throw e; // the store is down: this process cannot start yet
        if (!isSettled(e)) {
          // Refused for good: kept for the next start (and the developer); never placed in this process.
          saved = false;
          this.logger.log('error', 'pendingVoidRefused', { game: v.game, reason: v.reason, error: e instanceof Error ? e.name : 'error' });
        }
      }
      if (saved) await this.pending.remove(v.game).catch(() => undefined);
      // Never placed again in this process, whatever the store said (a pending 'void' too: its players were told it was over).
      this.quarantined.add(v.game);
      report.voided.push({ game: v.game, reason: v.reason });
    }
    const games = (await this.retry(() => this.store.runningGames(this.o.node ?? undefined))).filter((g) => !this.quarantined.has(g));
    await Promise.all(games.map(async (game) => {
      const r = await this.recoverGame(game, 'restart', null);
      if (r === 'recovered') report.recovered.push(game);
      else if (r) report.voided.push({ game, reason: r });
    }));
    report.recovered.sort();
    report.voided.sort((a, b) => a.game.localeCompare(b.game));
    return report;
  }

  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    // A batch waiting through an outage fails at its next attempt instead of waiting out the bound (nothing is voided while closing).
    this.committer.stop();
    if (this.outageTimer) clearInterval(this.outageTimer);
    this.outageTimer = null;
    // Work in progress (commits, ledger writes) finishes first; nothing new is dispatched.
    while (this.work.size > 0) await Promise.allSettled([...this.work]);
    this.closed = true;
    await this.committer.flush();
    if (this.wheelTimer) clearTimeout(this.wheelTimer.handle);
    this.wheelTimer = null;
    for (const t of this.tables.values()) {
      if (t.unloadTimer) clearTimeout(t.unloadTimer);
      for (const w of t.idleWaiters.splice(0)) w();
    }
    for (const w of [...this.changeWaiters]) w();
    await Promise.all(this.hosts.map(async (h) => {
      h.terminating = true;
      h.dead = true;
      if (h.inflight?.timer) clearTimeout(h.inflight.timer);
      const jobs = [...(h.inflight ? [h.inflight.job] : []), ...h.queue.splice(0)];
      h.inflight = null;
      for (const j of jobs) j.onLost();
      await h.worker.terminate();
    }));
    await this.deckPool?.close();
  }

  get draining(): boolean {
    return this.drainingNow;
  }

  async drain(): Promise<DrainReport> {
    this.drainingNow = true;
    const live = () => [...this.tables.values()].filter((t) => !t.ended && !t.gone);
    const before = new Set(live().map((t) => t.game));
    const deadline = realNow() + this.tuning.drainMaxMinutes * 60_000;
    const voided: string[] = [];
    while (live().length > 0) {
      const left = deadline - realNow();
      if (left <= 0) {
        for (const t of live()) {
          if (voided.includes(t.game)) continue;
          voided.push(t.game);
          this.enqueue(t, { t: 'void', at: this.now(), reason: 'updated' }, true);
        }
        await this.changed(1_000);
        continue;
      }
      await this.changed(Math.min(left, 1_000));
    }
    await this.settleAll();
    const finished = [...before].filter((g) => !voided.includes(g)).length;
    return { finished, voided: voided.sort() };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Router

  async start(req: StartGameRequest): Promise<StartGameResult> {
    if (this.closed || this.closing) return { ok: false, reason: 'closed', message: 'The server is stopping.' };
    if (this.drainingNow) return { ok: false, reason: 'draining', message: 'The server is restarting soon; no new games start now.' };
    if (this.outageSince !== null) return { ok: false, reason: 'busy', message: 'The server is busy saving games; try again shortly.' };
    if (this.tables.has(req.game) || this.quarantined.has(req.game)) return { ok: false, reason: 'exists', message: 'This game is already running.' };
    const n = req.seats.length;
    if (n < 2 || n > 4) return { ok: false, reason: 'failed', message: 'The game could not start on the server.' };
    const seed = req.seed ?? newTableSeed();
    let config: GameConfig;
    let seating: SeatNumber[];
    try {
      ({ config, seating } = tableConfig(req.format, req.seats.map((s) => ({ seat: s.seat, name: s.name, deck: s.deck })), seed));
    } catch (e) {
      // The detail (an engine or configuration error text) goes to the log, by name only as everywhere; the players are told a fixed text.
      this.logger.log('error', 'startFailed', { game: req.game, phase: 'config', error: e instanceof Error ? e.name : 'error' });
      return { ok: false, reason: 'failed', message: 'The game could not start on the server.' };
    }
    const at = req.at ?? this.now();
    const meta: TableMeta = {
      game: req.game, format: req.format, source: req.source, seats: n as 2 | 3 | 4, startedAt: at,
      ledgerSeats: req.seats.map((s) => ({ seat: s.seat, session: s.session, account: s.account ?? null, deckHash: s.deckHash })),
      ...(req.clock ? { clock: req.clock } : {}), ...(req.limits ? { limits: req.limits } : {}),
    };
    const host = this.leastLoaded();
    if (!host) return { ok: false, reason: 'closed', message: 'No game worker is running.' };
    const t = this.newTable(meta, host);
    t.phase = 'starting';
    for (const s of req.connected ?? req.seats.map((x) => x.seat)) t.connected.add(s);
    const connected = [...t.connected];
    // The actor first (an engine that refuses the configuration never reaches the store), then the store's start, then the first step.
    const reply = await this.request(host, req.game, 'start', (id) => ({
      kind: 'start', id, game: req.game, config, seating, at, connected, ...(meta.clock ? { clock: meta.clock } : {}), ...(meta.limits ? { limits: meta.limits } : {}),
    }));
    if (!reply || reply.kind !== 'step') {
      if (reply?.kind === 'failed') this.logger.log('error', 'startFailed', { game: req.game, error: reply.error.split(':')[0] ?? 'error' });
      this.removeTable(t, false);
      return { ok: false, reason: 'failed', message: 'The game could not start on the server.' };
    }
    const { seed: _seed, ...stored } = config;
    try {
      await this.store.startGame(req.game, {
        config: stored, seed, seating, engineBuild: this.engineBuild, rulesPack: req.rulesPack ?? null, startedAt: new Date(at), node: this.o.node ?? null,
      });
    } catch (e) {
      this.logger.log('error', 'startGameFailed', { game: req.game, error: e instanceof Error ? e.name : 'error' });
      if (isTransient(e)) this.storeFailing();
      this.removeTable(t, false);
      return { ok: false, reason: isTransient(e) ? 'busy' : 'failed', message: 'The game could not be saved on the server.' };
    }
    t.stored = true;
    if (t.gone || t.doomed) return { ok: false, reason: 'failed', message: 'The game could not start on the server.' };
    await this.track(this.afterStep(t, reply.step, reply.engineErrors, null));
    return { ok: true, game: req.game, worker: host.index, seating };
  }

  submit(game: string, input: SeatInput): boolean {
    const t = this.tables.get(game);
    // A table the runtime is voiding takes nothing more (its players get the void's notice and result).
    if (!t || t.gone || t.doomed || t.voiding || this.closed) return false;
    const cmd = { ...input, at: input.at ?? this.now() } as TableCommand;
    if (cmd.t === 'connect') t.connected.add(cmd.seat);
    else if (cmd.t === 'disconnect') t.connected.delete(cmd.seat);
    else if (cmd.t === 'leave') {
      t.left.add(cmd.seat);
      t.connected.delete(cmd.seat);
    }
    this.enqueue(t, cmd, false);
    // An ended table goes once every seat has left it (design 2.2 step 7).
    if (t.ended && cmd.t === 'leave' && t.meta.ledgerSeats.every((s) => t.left.has(s.seat))) this.unloadSoon(t, 0);
    return true;
  }

  /**
   * Readiness (`/readyz`, design 10.2): every game worker answers, the store is reachable, the process is not draining. `reasons` names what is not.
   */
  ready(): { ok: boolean; reasons: ('workers' | 'store' | 'draining' | 'closed')[] } {
    const reasons: ('workers' | 'store' | 'draining' | 'closed')[] = [];
    if (this.closed || this.closing) reasons.push('closed');
    if (this.hosts.length === 0 || this.hosts.some((h) => h.dead || !h.ready)) reasons.push('workers');
    if (this.outageSince !== null) reasons.push('store');
    if (this.drainingNow) reasons.push('draining');
    return { ok: reasons.length === 0, reasons };
  }

  /** Whether the store is failing now (an outage: tables wait, starts are refused). */
  storeOutage(): boolean {
    return this.outageSince !== null;
  }

  locate(game: string): number | null {
    const t = this.tables.get(game);
    return t && !t.gone ? t.host : null;
  }

  has(game: string): boolean {
    const t = this.tables.get(game);
    return !!t && !t.gone;
  }

  async inspect(game: string): Promise<TableInspection | null> {
    const t = this.tables.get(game);
    if (!t || t.gone) return null;
    await this.settled(t);
    if (t.gone) return null;
    const host = this.hosts[t.host];
    if (!host || host.dead) return null;
    const reply = await this.request(host, game, 'inspect', (id) => ({ kind: 'inspect', id, game }));
    if (!reply || reply.kind !== 'inspected' || !reply.info) return null;
    return { ...reply.info, worker: t.host };
  }

  /**
   * Test hooks (`testHooks`): block the table's worker for `ms` (a stuck action); end the worker between messages (a crash without a suspect); make the
   * table's next command end the worker (a crash while handling it).
   */
  debug(game: string, op: { hang: number } | { exit: number } | { poison: true }, worker?: number): boolean {
    if (!this.o.testHooks) return false;
    const t = this.tables.get(game);
    // `worker`: a game not loaded yet (a poisoned start).
    const host = t ? this.hosts[t.host] : worker !== undefined ? this.hosts[worker] : undefined;
    if (!host || host.dead) return false;
    const job: Job = {
      id: this.nextJob++, game, kind: 'hang' in op ? 'hang' : 'exit' in op ? 'exit' : 'poison',
      build: () => ('hang' in op ? { kind: 'hang', id: job.id, game, ms: op.hang } : 'exit' in op ? { kind: 'exit', id: job.id, game, code: op.exit } : { kind: 'poison', id: job.id, game }),
      onReply: () => undefined,
      onLost: () => undefined,
    };
    host.queue.push(job);
    this.pump(host);
    return true;
  }

  /** Resolves when every table's mailbox is empty, nothing is at a worker or committing, and the commit batch is written. */
  async settleAll(): Promise<void> {
    for (;;) {
      const busy = [...this.tables.values()].filter((t) => !t.gone && !t.doomed && (t.phase !== 'idle' || t.mailbox.length > 0));
      if (busy.length === 0 && this.work.size === 0) break;
      await Promise.all([...busy.map((t) => this.settled(t)), ...[...this.work]]);
    }
    await this.committer.flush();
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Deck pool and signals

  prepare(deck: DeckSubmission, format: string): Promise<DeckResult> {
    if (!this.deckPool) return Promise.resolve({ ok: false, errors: ['Deck checks are not available on this server now.'], warnings: [], busy: true });
    return this.deckPool.prepare(deck, format);
  }

  read(now: number): CapacitySignals {
    return this.signals.read(now);
  }

  /** The capacity units of the games running now (ended games kept for chat are not counted). */
  runningUnits(): number {
    let n = 0;
    for (const t of this.tables.values()) if (!t.gone && !t.ended) n += t.units;
    return n;
  }

  /** The games loaded here (running or ended and kept for chat). */
  games(): string[] {
    return [...this.tables.values()].filter((t) => !t.gone).map((t) => t.game).sort();
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Tables and mailboxes

  private newTable(meta: TableMeta, host: Host): Table {
    const t: Table = {
      game: meta.game, meta, units: capacityUnits(meta.seats, this.weights), host: host.index, mailbox: [], phase: 'idle', current: null, connected: new Set(),
      left: new Set(), lastRecord: null, engineErrors: 0, ended: null, gone: false, doomed: false, voiding: false, needsRecovery: null, unloadTimer: null, idleWaiters: [],
      stored: false, busy: [], hotWarned: 0, outageNoticed: false,
    };
    this.tables.set(meta.game, t);
    host.tables.add(meta.game);
    this.metrics.set(METRICS.capacityUnits, this.runningUnits());
    return t;
  }

  private enqueue(t: Table, cmd: TableCommand, front: boolean): void {
    const q: Queued = { cmd, received: realNow() };
    if (front) t.mailbox.unshift(q);
    else t.mailbox.push(q);
    this.schedule(t);
  }

  /** An idle table with mail gets one command job on its worker. */
  private schedule(t: Table): void {
    if (this.closed || this.closing || t.gone || t.doomed) return;
    if (t.phase !== 'idle') return;
    if (t.needsRecovery) {
      const { cause, count } = t.needsRecovery;
      t.needsRecovery = null;
      void this.track(this.recoverGame(t.game, cause, t, count));
      return;
    }
    if (t.mailbox.length === 0) {
      for (const w of t.idleWaiters.splice(0)) w();
      return;
    }
    const host = this.hosts[t.host];
    if (!host || host.dead) return;
    t.phase = 'queued';
    const job: Job = {
      id: this.nextJob++, game: t.game, kind: 'command',
      build: () => {
        const q = t.mailbox.shift()!;
        t.current = q;
        t.phase = 'busy';
        return { kind: 'command', id: job.id, game: t.game, cmd: q.cmd };
      },
      onReply: (m) => {
        const q = t.current;
        t.current = null;
        if (m.kind !== 'step') {
          this.logger.log('error', 'tableCommandFailed', { game: t.game, error: m.kind === 'failed' ? m.error.split(':')[0] ?? 'error' : m.kind });
          t.phase = 'idle';
          this.schedule(t);
          return;
        }
        void this.track(this.afterStep(t, m.step, m.engineErrors, q));
      },
      onLost: () => {
        // The worker died: a command it was running is never sent again (its table is the suspect, workerLost); a queued one was not taken yet.
        t.current = null;
      },
    };
    host.queue.push(job);
    this.pump(host);
  }

  private settled(t: Table): Promise<void> {
    if (t.gone || t.doomed || this.closed || this.closing || (t.phase === 'idle' && t.mailbox.length === 0 && !t.needsRecovery)) return Promise.resolve();
    return new Promise((resolve) => t.idleWaiters.push(resolve));
  }

  /** Resolves on the next table change (an end, a removal) or after `ms`. */
  private changed(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.changeWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.changeWaiters.add(done);
    });
  }

  private notifyChange(): void {
    for (const w of [...this.changeWaiters]) w();
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.work.add(p);
    void p.finally(() => this.work.delete(p)).catch(() => undefined);
    return p;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Steps: commit, snapshot, ledger, delivery

  private async afterStep(t: Table, step: WireStep, engineErrors: number, q: Queued | null): Promise<void> {
    t.phase = 'committing';
    try {
      this.countEngineErrors(t, engineErrors);
      const end = step.end;
      // A won or drawn game's last record goes into finishGame's transaction with its result (design 7); everything else into the group commit.
      const finishing = end !== null && end.outcome !== 'void' && step.records.length > 0;
      const batch = finishing ? step.records.slice(0, -1) : step.records;
      if (batch.length > 0) {
        // Through a store outage the table waits here (up to the outage bound), its messages held back.
        const out = await this.committer.add(t.game, batch);
        if (!out.ok) {
          this.logger.log('error', 'commitFailed', { game: t.game, seq: batch[0]!.seq, outage: out.outage, error: out.error.split(':')[0] ?? 'error' });
          await this.commitFailed(t, end !== null);
          return;
        }
        t.lastRecord = batch[batch.length - 1]!;
      }
      if (step.checkpoint && !end) void this.track(this.snapshot(t, step.checkpoint));
      if (end) {
        const written = await this.writeLedger(t, end, finishing ? step.records[step.records.length - 1]! : null);
        if (!written.ok) return;
        this.deliver(t, step.sends);
        this.onEnded(t, written.end, written.record);
        return;
      }
      this.deliver(t, step.sends);
      if (q && q.cmd.t === 'act') {
        const ms = realNow() - q.received;
        this.signals.actionTime(ms);
        this.metrics.observe(METRICS.actionSeconds, ms / 1000);
        this.metrics.inc(METRICS.actions);
      }
      this.arm(t, step.nextDeadline);
    } catch (e) {
      this.logger.log('error', 'stepFailed', { game: t.game, error: e instanceof Error ? e.name : 'error' });
    } finally {
      if (t.phase === 'committing') t.phase = 'idle';
      this.schedule(t);
    }
  }

  private countEngineErrors(t: Table, now: number): void {
    const delta = now - t.engineErrors;
    if (delta <= 0) return;
    t.engineErrors = now;
    this.metrics.inc(METRICS.engineErrors, {}, delta);
    for (let i = 0; i < delta; i++) void this.track(this.store.countEngineError(t.game).catch(() => 0));
  }

  private async snapshot(t: Table, cp: WireCheckpoint): Promise<void> {
    try {
      await this.store.putSnapshot({ game: t.game, seq: cp.seq, engineBuild: this.engineBuild, hash: cp.hash, state: cp.gz, createdAt: new Date(this.now()) });
    } catch (e) {
      // A missing snapshot only lengthens a recovery.
      this.logger.log('warn', 'snapshotFailed', { game: t.game, seq: cp.seq, error: e instanceof Error ? e.name : 'error' });
    }
  }

  /**
   * A step's records could not be committed (the store refused this game's rows twice, or an outage outlasted its bound): the table is void, reason
   * 'commit' (design 2.3). The step's sends are dropped. The actor voids the game if it still runs (its notice and result go to the seats once the void
   * is saved); a step that had already ended the game is voided here.
   */
  private async commitFailed(t: Table, stepEnded: boolean): Promise<void> {
    t.voiding = true;
    if (stepEnded || t.ended) {
      await this.voidHere(t, 'commit', 'void');
      return;
    }
    // Only the void is left to do: the input still waiting is dropped (its seats get the void's notice and result).
    t.mailbox.length = 0;
    this.enqueue(t, { t: 'void', at: this.now(), reason: 'commit' }, true);
  }

  /**
   * The ledger row of an ended game (`writeResult`), retried through a store outage (up to its bound). A failure voids the game here, durably (`voidHere`):
   * nothing derived from an unsaved record is sent, and `ended` comes only once the store has the void.
   */
  private async writeLedger(t: Table, end: TableEnd, last: LogRecord | null): Promise<{ ok: true; record: GameRecord; end: TableEnd } | { ok: false }> {
    const prior = t.lastRecord;
    // A void end after a failed commit counts only what was committed.
    const e = end.outcome === 'void' && (prior?.seq ?? 0) !== end.seq ? { ...end, seq: prior?.seq ?? 0 } : end;
    const input = { game: this.ledgerGame(t.meta), end: e, seats: t.meta.ledgerSeats, last: last ?? prior, commitLast: last !== null };
    try {
      const record = await this.retry(() => writeResult(this.store, input));
      if (last) t.lastRecord = last;
      return { ok: true, record, end: e };
    } catch (error) {
      this.logger.log('error', 'ledgerFailed', { game: t.game, outcome: end.outcome, error: error instanceof Error ? error.name : 'error' });
    }
    // A void game's records are committed: its void stands (the store builds the row). A won or drawn game's last record may not be: void 'commit'.
    if (end.outcome === 'void') await this.voidHere(t, end.reason as VoidReason, voidStatus(end.reason as VoidReason), e);
    else await this.voidHere(t, 'commit', 'void');
    return { ok: false };
  }

  private ledgerGame(meta: TableMeta): LedgerGame {
    return { game: meta.game, format: meta.format, variant: commanderVariantOf(meta.format), seats: meta.seats, source: meta.source, startedAt: meta.startedAt, engineBuild: this.engineBuild };
  }

  private deliver(t: Table, sends: readonly SeatSend[]): void {
    if (sends.length === 0 || this.closed) return;
    try {
      this.events.deliver(t.game, sends);
    } catch (e) {
      this.logger.log('error', 'deliverFailed', { game: t.game, error: e instanceof Error ? e.name : 'error' });
    }
  }

  /** The notice and result the actor would send for a void game, to the seats still connected (when the runtime voids a table it cannot ask). */
  private voidSends(t: Table, reason: VoidReason): SeatSend[] {
    const notice = JSON.stringify({ t: 'notice', kind: 'voided', text: `The game ends without a result: ${VOID_WORDS[reason]}.` });
    const result = JSON.stringify({ t: 'result', outcome: 'void', reason, result: null, placements: [] });
    const out: SeatSend[] = [];
    for (const s of t.meta.ledgerSeats.map((x) => x.seat).sort((a, b) => a - b)) {
      if (!t.connected.has(s) || t.left.has(s)) continue;
      out.push({ seat: s, t: 'notice', json: notice }, { seat: s, t: 'result', json: result });
    }
    return out;
  }

  /**
   * Voids a table without its actor's help (quarantine, a failed recovery, a commit or ledger failure): DURABLY. The void is noted as pending (a file the
   * next `open()` applies if this process stops first), then the store is asked until it has it (`voidGame`; it builds the ledger row from the committed
   * records); only then do the seats get the notice and result and the gateway `ended`. A table that never reached the store (a start that failed)
   * ends quietly: nothing was started, so nothing is voided or reported.
   */
  private async voidHere(t: Table, reason: VoidReason, status: 'void' | 'quarantined', end?: TableEnd): Promise<void> {
    t.doomed = true;
    if (status === 'quarantined') {
      this.quarantined.add(t.game);
      this.metrics.inc(METRICS.quarantines);
    }
    for (const w of t.idleWaiters.splice(0)) w();
    if (!t.stored) {
      this.removeTable(t, false);
      return;
    }
    const saved = await this.durableVoid(t.game, reason, status);
    if (saved === 'closing') {
      // The process is closing with the store still down: the pending void is applied by the next open(). Nothing is reported as ended meanwhile.
      this.logger.log('error', 'voidPending', { game: t.game, reason });
      return;
    }
    const e: TableEnd = end ?? { outcome: 'void', reason, result: null, at: this.now(), seq: t.lastRecord?.seq ?? 0, actions: 0, turns: 0, seats: [] };
    this.deliver(t, this.voidSends(t, reason));
    if (saved === 'pending') {
      // The store would not take it: kept in the pending file for the next start; quarantined here (never placed again in this process).
      this.quarantined.add(t.game);
      this.onEnded(t, e, null, status, true);
      this.removeTable(t, true);
      return;
    }
    this.onEnded(t, e, null, status);
    // Nothing of a quarantined table stays: it is never placed again.
    if (status === 'quarantined') this.removeTable(t, true);
  }

  /**
   * Notes the void as pending, then asks the store: transient failures are retried with the outage backoff for up to `voidRetryMs`. 'saved': the store
   * has it (or the game was already over: nothing to void), and the note is taken off. 'pending': the store refused it for good (a permanent error:
   * logged) or stayed unreachable past the bound; the note stays for the next `open()`. 'closing': the runtime closed first (the note stays).
   */
  private async durableVoid(game: string, reason: VoidReason, status: 'void' | 'quarantined'): Promise<'saved' | 'pending' | 'closing'> {
    try {
      await this.pending?.add({ game, reason, status });
    } catch (e) {
      this.logger.log('error', 'pendingVoidWriteFailed', { game, error: e instanceof Error ? e.name : 'error' });
    }
    try {
      await withRetry(() => this.store.voidGame(game, reason, status), { ...this.tuning.outage, maxMs: this.tuning.voidRetryMs }, {
        failed: () => this.storeFailing(),
        stop: () => this.closing,
      });
      this.storeHealthy();
    } catch (e) {
      if (isTransient(e)) {
        if (this.closing) return 'closing';
        this.logger.log('error', 'voidPending', { game, reason, error: e instanceof Error ? e.name : 'error' });
        return 'pending';
      }
      if (!isSettled(e)) {
        this.logger.log('error', 'voidRefused', { game, reason, error: e instanceof Error ? e.name : 'error' });
        return 'pending';
      }
      // The game is already over in the store (or unknown): nothing more to void.
    }
    await this.pending?.remove(game).catch(() => undefined);
    return 'saved';
  }

  /** A store call through the outage policy: transient failures retried with a backoff up to the bound (marking the outage), permanent ones thrown. */
  private retry<T>(fn: () => Promise<T>, o: { stop?: () => boolean } = {}): Promise<T> {
    return withRetry(fn, this.tuning.outage, { failed: () => this.storeFailing(), ...(o.stop ? { stop: o.stop } : {}) }).then((v) => {
      this.storeHealthy();
      return v;
    });
  }

  /** A store call failed transiently: the outage (no starts, readiness fails; the seats of waiting tables are told after `noticeMs`). */
  private storeFailing(): void {
    if (this.outageSince !== null || this.closing) return;
    this.outageSince = realNow();
    this.logger.log('error', 'storeOutage', {});
    this.outageTimer = setInterval(() => this.outageNotices(), Math.min(1_000, this.tuning.outage.noticeMs));
    this.outageTimer.unref?.();
  }

  private storeHealthy(): void {
    if (this.outageSince === null) return;
    this.logger.log('info', 'storeBack', { ms: Math.round(realNow() - this.outageSince) });
    this.outageSince = null;
    if (this.outageTimer) clearInterval(this.outageTimer);
    this.outageTimer = null;
    for (const t of this.tables.values()) t.outageNoticed = false;
  }

  /** Seats of the tables waiting for the store get one notice per outage, once it has lasted `noticeMs`. */
  private outageNotices(): void {
    if (this.outageSince === null || realNow() - this.outageSince < this.tuning.outage.noticeMs) return;
    const notice = JSON.stringify({ t: 'notice', kind: 'degraded', text: 'The server is busy saving this game; please wait a moment.' });
    for (const t of this.tables.values()) {
      if (t.gone || t.outageNoticed || t.phase !== 'committing') continue;
      t.outageNoticed = true;
      const sends: SeatSend[] = [];
      for (const s of [...t.connected].sort((a, b) => a - b)) if (!t.left.has(s)) sends.push({ seat: s, t: 'notice', json: notice });
      this.deliver(t, sends);
    }
  }

  private onEnded(t: Table, end: TableEnd, record: GameRecord | null, status?: 'void' | 'quarantined', pending = false): void {
    if (t.ended) return;
    t.ended = end;
    this.wheel.delete(t.game);
    if (end.outcome === 'void') this.metrics.inc(METRICS.voids, { reason: end.reason });
    this.metrics.set(METRICS.capacityUnits, this.runningUnits());
    const st = end.outcome === 'void' ? (status ?? voidStatus(end.reason as VoidReason)) : 'finished';
    try {
      this.events.ended?.({ game: t.game, end, record, status: st, units: t.units, ...(pending ? { pending: true } : {}) });
    } catch (e) {
      this.logger.log('error', 'endedHandlerFailed', { game: t.game, error: e instanceof Error ? e.name : 'error' });
    }
    if (!t.gone) {
      if (t.meta.ledgerSeats.every((s) => t.left.has(s.seat))) this.unloadSoon(t, 0);
      else this.unloadSoon(t, this.tuning.unloadAfterMs);
    }
    this.notifyChange();
  }

  private unloadSoon(t: Table, ms: number): void {
    if (t.unloadTimer) clearTimeout(t.unloadTimer);
    t.unloadTimer = setTimeout(() => {
      t.unloadTimer = null;
      void this.settled(t).then(() => this.removeTable(t, true));
    }, ms);
    t.unloadTimer.unref?.();
  }

  /** Takes a table out of memory (its actor too, when its worker lives). */
  private removeTable(t: Table, notify: boolean): void {
    if (t.gone) return;
    t.gone = true;
    if (t.unloadTimer) clearTimeout(t.unloadTimer);
    this.wheel.delete(t.game);
    this.tables.delete(t.game);
    const host = this.hosts[t.host];
    if (host) {
      host.tables.delete(t.game);
      if (!host.dead) this.dropActor(t);
    }
    for (const w of t.idleWaiters.splice(0)) w();
    this.metrics.set(METRICS.capacityUnits, this.runningUnits());
    if (notify && !this.closed) {
      try {
        this.events.unloaded?.(t.game);
      } catch {
        // the gateway's handler; nothing to undo here
      }
    }
    this.notifyChange();
  }

  private dropActor(t: Table): void {
    const host = this.hosts[t.host];
    if (!host || host.dead || this.closed) return;
    const job: Job = {
      id: this.nextJob++, game: t.game, kind: 'unload', build: () => ({ kind: 'unload', id: job.id, game: t.game }), onReply: () => undefined, onLost: () => undefined,
    };
    host.queue.push(job);
    this.pump(host);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The timer wheel

  private arm(t: Table, at: number | null): void {
    if (t.gone || t.ended) return;
    this.wheel.set(t.game, at);
    this.rearm();
  }

  private rearm(): void {
    if (this.closed) return;
    const next = this.wheel.next();
    if (next === null) {
      if (this.wheelTimer) clearTimeout(this.wheelTimer.handle);
      this.wheelTimer = null;
      return;
    }
    if (this.wheelTimer && this.wheelTimer.at <= next) return;
    if (this.wheelTimer) clearTimeout(this.wheelTimer.handle);
    const delay = Math.min(Math.max(0, next - this.now()), 2_147_483_647);
    const handle = setTimeout(() => this.fire(), delay);
    handle.unref?.();
    this.wheelTimer = { at: next, handle };
  }

  /**
   * The wheel's timer: the due tables get a `tick` stamped with this instant. Inputs already received go first (M13-3's same-instant rule): the ticks
   * are queued after the event loop's pending I/O (setImmediate runs after the poll phase, where the gateway reads its sockets), behind whatever those
   * messages put in the mailboxes.
   */
  private fire(): void {
    this.wheelTimer = null;
    const now = this.now();
    const due = this.wheel.due(now);
    setImmediate(() => {
      for (const game of due) {
        const t = this.tables.get(game);
        if (!t || t.gone || t.ended || this.closing) continue;
        // One tick waiting is enough.
        if (!t.mailbox.some((q) => q.cmd.t === 'tick')) this.enqueue(t, { t: 'tick', at: now }, false);
      }
    });
    this.rearm();
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Recovery

  /**
   * Rebuilds a table from the store (design 2.3) on its worker (a replaced one) or, after a restart, on the least-loaded worker. Returns 'recovered',
   * the void reason when it was voided instead, or null when the game was no longer running.
   */
  private async recoverGame(game: string, cause: RecoveryCause, existing: Table | null, counted = true): Promise<'recovered' | VoidReason | null> {
    let t = existing;
    if (t) t.phase = 'recovering';
    this.metrics.inc(METRICS.recoveries);
    let count = 0;
    let full: RecoveryData;
    try {
      // Counted unless another table was the known suspect of the worker loss that brought this one here (review MAJOR 1).
      if (counted) count = await this.retry(() => this.store.countRecovery(game));
      full = await this.retry(() => this.store.loadForRecovery(game, { ignoreSnapshots: true }));
    } catch (e) {
      this.logger.log('error', 'recoveryLoadFailed', { game, error: e instanceof Error ? e.name : 'error' });
      if (isTransient(e)) {
        // The store is down past the outage bound: a restart cannot go on without it; a loaded table tries again later (it is not voided for it).
        if (!t) throw e;
        const table = t;
        table.phase = 'idle';
        const retry = setTimeout(() => {
          if (table.gone || table.doomed) return;
          table.needsRecovery = { cause, count: false };
          this.schedule(table);
        }, this.tuning.outage.capMs);
        retry.unref?.();
        return null;
      }
      return this.voidUnloaded(game, t, 'recovery', 'void');
    }
    if (full.status !== 'running') {
      if (t) this.removeTable(t, true);
      return null;
    }
    const meta = t?.meta ?? (await this.o.directory?.meta(game).catch(() => null)) ?? null;
    if (!t && meta) {
      const host = this.leastLoaded();
      if (!host) return null;
      t = this.newTable(meta, host);
      t.phase = 'recovering';
    }
    if (t) t.stored = true;
    if (t) t.lastRecord = full.records[full.records.length - 1] ?? null;
    // D5: a table that needs its second recovery is quarantined, never placed again.
    if (count >= this.tuning.maxRecoveries) return this.voidUnloaded(game, t, 'quarantined', 'quarantined');
    if (!meta || !t) return this.voidUnloaded(game, t, 'recovery', 'void');
    const sameBuild = full.engineBuild === this.engineBuild;
    if (!sameBuild && this.tuning.otherBuild === 'void') return this.voidUnloaded(game, t, 'updated', 'void');
    let snapshot: RecoveryData['snapshot'] = null;
    if (sameBuild) {
      try {
        snapshot = (await this.store.loadForRecovery(game)).snapshot;
      } catch {
        snapshot = null; // replay from the first record
      }
      // Only a snapshot taken under this very build is a start (review minor 1); any other is replayed past.
      if (snapshot && snapshot.engineBuild !== this.engineBuild) snapshot = null;
    }
    const host = this.hosts[t.host]!;
    const config = { ...(full.config as Omit<GameConfig, 'seed'>), seed: full.seed } as GameConfig;
    const table = t;
    const reply = await this.request(host, game, 'recover', (id) => ({
      kind: 'recover', id, game, config, seating: full.seating, at: this.now(), records: full.records,
      snapshot: snapshot ? { seq: snapshot.seq, hash: snapshot.hash, state: snapshot.state } : null,
      ...(meta.clock ? { clock: meta.clock } : {}), ...(meta.limits ? { limits: meta.limits } : {}),
    }));
    if (table.gone || table.doomed) return 'quarantined';
    if (!reply) {
      // The worker died while this recovery waited in its queue (another table was at the worker): workerLost set it to recover again.
      table.phase = 'idle';
      this.schedule(table);
      return 'recovered';
    }
    if (reply.kind !== 'recovered') {
      this.logger.log('error', 'recoveryFailed', { game, sameBuild, error: reply.kind === 'failed' ? reply.error.split(':')[0] ?? 'error' : reply.kind });
      return this.voidUnloaded(game, table, sameBuild ? 'recovery' : 'updated', 'void');
    }
    if (reply.mismatches.length > 0) {
      // Same build: the engine is not deterministic here (a bug, flagged). Another build: it plays this game differently ("the server was updated").
      this.logger.log('error', 'recoveryMismatch', { game, sameBuild, first: reply.mismatches[0] ?? null, count: reply.mismatches.length });
      if (sameBuild) {
        this.metrics.inc(METRICS.engineErrors);
        void this.track(this.store.countEngineError(game).catch(() => 0));
      }
      table.mailbox.unshift({ cmd: { t: 'void', at: this.now(), reason: sameBuild ? 'recovery' : 'updated' }, received: realNow() });
    }
    // Seats the gateway still has connected get their full views (a worker recovery; after a restart the players reconnect).
    const seats = [...table.connected].filter((s) => !table.left.has(s)).sort((a, b) => b - a);
    const at = this.now();
    for (const seat of seats) table.mailbox.splice(reply.mismatches.length > 0 ? 1 : 0, 0, { cmd: { t: 'connect', seat, at }, received: realNow() });
    table.engineErrors = reply.engineErrors;
    try {
      this.events.recovered?.(game, { cause, seq: reply.seq, fromSnapshot: reply.fromSnapshot });
    } catch {
      // the gateway's handler
    }
    await this.afterStep(table, reply.step, reply.engineErrors, null);
    return reply.mismatches.length > 0 ? (sameBuild ? 'recovery' : 'updated') : 'recovered';
  }

  /** Voids a game during recovery: through `voidHere` when it is loaded, else in the store only (nobody is connected to a table that is not loaded). */
  private async voidUnloaded(game: string, t: Table | null, reason: VoidReason, status: 'void' | 'quarantined'): Promise<VoidReason> {
    if (t) {
      t.phase = 'idle';
      await this.voidHere(t, reason, status);
      if (!t.gone && status !== 'quarantined') {
        // A void table without an actor holds nothing to chat with: it leaves memory.
        this.removeTable(t, true);
      }
      return reason;
    }
    if (status === 'quarantined') {
      this.quarantined.add(game);
      this.metrics.inc(METRICS.quarantines);
    }
    const saved = await this.durableVoid(game, reason, status);
    if (saved === 'saved') this.metrics.inc(METRICS.voids, { reason });
    else this.quarantined.add(game); // pending: never placed again in this process
    return reason;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Workers

  private spawnHost(index: number, bootFailures = 0): Host {
    const worker = spawnWorker(GAME_WORKER_ENTRY, { index, testHooks: this.o.testHooks === true }, { heapMb: this.tuning.workerHeapMb, name: `game-${index}` });
    const host: Host = { index, worker, ready: false, dead: false, queue: [], inflight: null, tables: new Set(), terminating: false, crash: null, bootFailures };
    worker.on('message', (m: GameWorkerReply) => this.onWorkerMessage(host, m));
    worker.on('error', (e: Error & { code?: string }) => {
      host.crash = { oom: e.code === 'ERR_WORKER_OUT_OF_MEMORY' };
      this.logger.log('error', 'workerError', { worker: index, error: e.name, code: e.code ?? null });
    });
    worker.on('exit', (code) => {
      if (host.dead || host.terminating || this.closed) return;
      this.logger.log('error', 'workerExit', { worker: index, code });
      // The table whose message was at the worker is the suspect, whatever the exit (an out-of-memory exit included: review MAJOR 1); a worker that
      // died between messages has none.
      const job = host.inflight?.job ?? null;
      this.workerLost(host, job ? job.game : null, host.crash?.oom ? 'oom' : 'crash');
    });
    return host;
  }

  private async whenHostsReady(): Promise<void> {
    while (!this.closed && this.hosts.some((h) => !h.ready && !h.dead)) await new Promise((r) => setTimeout(r, 20));
  }

  /** The live worker with the fewest running units (ties: the lowest index). */
  private leastLoaded(): Host | null {
    let best: Host | null = null;
    let bestUnits = Infinity;
    for (const h of this.hosts) {
      if (h.dead) continue;
      let units = 0;
      for (const g of h.tables) {
        const t = this.tables.get(g);
        if (t && !t.ended) units += t.units;
      }
      if (units < bestUnits) {
        best = h;
        bestUnits = units;
      }
    }
    return best;
  }

  /** One job and its reply (null: the worker died with it; `onLost` lets the caller react). */
  private request(host: Host, game: string, kind: GameWorkerRequest['kind'], build: (id: number) => GameWorkerRequest, o: { onLost?: () => void } = {}): Promise<GameWorkerReply | null> {
    return new Promise((resolve) => {
      const id = this.nextJob++;
      host.queue.push({
        id, game, kind,
        build: () => build(id),
        onReply: (m) => resolve(m),
        onLost: () => {
          o.onLost?.();
          resolve(null);
        },
      });
      this.pump(host);
    });
  }

  private pump(host: Host): void {
    if (this.closed || host.dead || !host.ready || host.inflight) return;
    const job = host.queue.shift();
    if (!job) return;
    let msg: GameWorkerRequest;
    try {
      msg = job.build();
    } catch (e) {
      this.logger.log('error', 'jobBuildFailed', { worker: host.index, game: job.game, error: e instanceof Error ? e.name : 'error' });
      return this.pump(host);
    }
    host.inflight = { job, started: realNow(), timer: null, budget: null };
    this.armWatchdog(host);
    if (job.kind === 'recover') {
      // A recovery's replay has a total budget too (review minor 3): one huge log must not hold the worker's other tables for long.
      const f = host.inflight;
      f.budget = setTimeout(() => this.stuck(host, job, 'recoveryBudget'), this.tuning.recoveryBudgetMs);
    }
    try {
      host.worker.postMessage(msg);
    } catch (e) {
      // A message that cannot be cloned is a programming error: that job fails, the worker goes on.
      this.logger.log('error', 'postFailed', { worker: host.index, game: job.game, error: e instanceof Error ? e.name : 'error' });
      if (host.inflight.timer) clearTimeout(host.inflight.timer);
      if (host.inflight.budget) clearTimeout(host.inflight.budget);
      host.inflight = null;
      job.onReply({ kind: 'failed', id: job.id, game: job.game, error: 'post' });
      this.pump(host);
    }
  }

  private armWatchdog(host: Host): void {
    const f = host.inflight;
    if (!f) return;
    if (f.timer) clearTimeout(f.timer);
    const job = f.job;
    f.timer = setTimeout(() => this.stuck(host, job, 'watchdog'), this.tuning.watchdogMs);
  }

  /** The watchdog (or a recovery's total budget) fired: the worker is terminated, the table of its message quarantined. */
  private stuck(host: Host, job: Job, why: 'watchdog' | 'recoveryBudget'): void {
    const f = host.inflight;
    if (!f || f.job !== job || host.dead) return;
    this.logger.log('error', why, { worker: host.index, game: job.game, kind: job.kind, ms: Math.round(realNow() - f.started) });
    this.metrics.inc(METRICS.watchdogTerminations);
    host.terminating = true;
    this.workerLost(host, job.game, 'watchdog');
    void host.worker.terminate();
  }

  private onWorkerMessage(host: Host, m: GameWorkerReply): void {
    if (host.dead) return;
    switch (m.kind) {
      case 'ready':
        host.ready = true;
        host.bootFailures = 0;
        return this.pump(host);
      case 'log':
        return this.logger.log(m.level, m.event, m.fields);
      case 'progress':
        // Each replayed record has the full deadline (design 2.3).
        if (host.inflight?.job.id === m.id) this.armWatchdog(host);
        return;
      default: {
        const f = host.inflight;
        if (!f || f.job.id !== m.id) return; // a reply to a job that is no longer in flight
        if (f.timer) clearTimeout(f.timer);
        if (f.budget) clearTimeout(f.budget);
        host.inflight = null;
        const ms = realNow() - f.started;
        this.signals.workerBusy(ms);
        this.tableBusy(f.job.game, ms);
        if ('heap' in m) {
          this.signals.heap(host.index, m.heap);
          this.metrics.set(METRICS.workerHeapBytes, m.heap.used, { worker: String(host.index) });
        }
        try {
          f.job.onReply(m);
        } finally {
          this.pump(host);
        }
      }
    }
  }

  /**
   * Worker time per table (review minor 4): a table that keeps its worker busy for more than `hotTableMs` in a minute is logged (once a minute) for the
   * operator. There is no per-table CPU budget beyond the watchdog's 5 s per message: such a table delays its worker's other tables (documented).
   */
  private tableBusy(game: string, ms: number): void {
    const t = this.tables.get(game);
    if (!t) return;
    const now = realNow();
    t.busy.push({ at: now, ms });
    while (t.busy.length > 0 && t.busy[0]!.at < now - 60_000) t.busy.shift();
    const used = t.busy.reduce((n, x) => n + x.ms, 0);
    if (used > this.tuning.hotTableMs && now - t.hotWarned > 60_000) {
      t.hotWarned = now;
      this.logger.log('warn', 'tableHot', { game, worker: t.host, ms: Math.round(used) });
    }
  }

  /**
   * A worker is gone: the watchdog terminated it, or it exited (a crash, out of memory). The table whose message was in flight is the SUSPECT (review
   * MAJOR 1): that message is never sent again (its seat gets an error), and the table is quarantined (void, never placed again). The worker's other
   * tables are recovered on its replacement; their recoveries do not count toward quarantine when the suspect is known (they did nothing), and count
   * when it is not (the worker died between messages). A worker that died before it was ready is replaced after a backoff (review minor 8).
   */
  private workerLost(host: Host, suspect: string | null, why: 'watchdog' | 'crash' | 'oom'): void {
    if (host.dead) return;
    host.dead = true;
    if (host.inflight?.timer) clearTimeout(host.inflight.timer);
    if (host.inflight?.budget) clearTimeout(host.inflight.budget);
    this.signals.heap(host.index, null);
    const jobs = [...(host.inflight ? [host.inflight.job] : []), ...host.queue.splice(0)];
    host.inflight = null;
    this.logger.log('error', 'workerLost', { worker: host.index, why, suspect: suspect ?? null, tables: host.tables.size, booted: host.ready });
    // The suspect is marked first, so nothing its lost jobs' callers do brings it back; its running command is kept only to answer its seat.
    const guilty = suspect ? this.tables.get(suspect) : undefined;
    const dropped = guilty?.current ?? null;
    if (guilty) {
      guilty.doomed = true;
      this.quarantined.add(guilty.game);
    }
    for (const job of jobs) {
      try {
        job.onLost();
      } catch {
        // a lost job's caller
      }
    }
    const replacement = this.closed || this.closing ? null : this.replaceHost(host);
    for (const game of [...host.tables]) {
      const t = this.tables.get(game);
      if (!t || t.gone) continue;
      if (game === suspect) {
        t.current = null;
        t.mailbox.length = 0;
        t.phase = 'idle';
        if (dropped && 'id' in dropped.cmd && typeof dropped.cmd.id === 'number' && 'seat' in dropped.cmd) {
          const reply = JSON.stringify({ t: 'reply', id: dropped.cmd.id, ok: false, error: { code: 'engineError', message: 'The server failed on this message; the game is stopped.' } });
          this.deliver(t, [{ seat: dropped.cmd.seat, t: 'reply', json: reply }]);
        }
        void this.track(this.voidHere(t, 'quarantined', 'quarantined'));
        continue;
      }
      if (t.ended) {
        // Its result is written: only the chat table goes.
        this.removeTable(t, true);
        continue;
      }
      if (!replacement) continue;
      t.host = replacement.index;
      replacement.tables.add(game);
      t.needsRecovery = { cause: 'worker', count: suspect === null };
      // A table at a commit or waiting for a start or recovery reply recovers when that is over (the lost reply's caller makes it idle).
      if (t.phase !== 'committing' && t.phase !== 'recovering' && t.phase !== 'starting') {
        t.phase = 'idle';
        this.schedule(t);
      }
    }
  }

  /**
   * The slot's next worker. One that died before it was ready is replaced after a backoff (1 s doubling to 30 s), so a worker that cannot boot is not
   * respawned in a tight loop; the slot's tables wait (the host is dead until then) and are scheduled when it is back.
   */
  private replaceHost(host: Host): Host {
    const failures = host.ready ? 0 : host.bootFailures + 1;
    if (failures === 0) {
      const next = this.spawnHost(host.index);
      this.hosts[host.index] = next;
      return next;
    }
    const delay = Math.min(this.tuning.respawnCapMs, this.tuning.respawnFirstMs * 2 ** (failures - 1));
    this.logger.log('error', 'workerBootFailed', { worker: host.index, failures, retryMs: delay });
    // A placeholder in the slot (dead, not ready) holds the tables until the real worker is spawned.
    const placeholder: Host = { ...host, queue: [], inflight: null, tables: new Set(), dead: true, ready: false, terminating: true, bootFailures: failures };
    this.hosts[host.index] = placeholder;
    const timer = setTimeout(() => {
      if (this.closed || this.closing || this.hosts[host.index] !== placeholder) return;
      const next = this.spawnHost(host.index, failures);
      next.tables = placeholder.tables;
      this.hosts[host.index] = next;
      for (const g of next.tables) {
        const t = this.tables.get(g);
        if (t) this.schedule(t);
      }
    }, delay);
    timer.unref?.();
    return placeholder;
  }
}
