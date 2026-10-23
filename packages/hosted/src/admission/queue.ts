/**
 * Capacity admission (design 4.6, D16; owner, 2026-10-15; package M13-10): the FIFO capacity queue behind the `Admission` contract (api.ts).
 *
 * - **What decides**: `admissible` (api.ts) on the runtime's signals (`SignalSource.read`: running units, CPU, p95, heap, outbound, store) and the units
 *   RESERVED by starts admitted but not yet begun. This module adds the queue around that test and nothing else: it never touches a running game.
 * - **The queue**: strict FIFO in units, ordered by `since` (the time the start became waiting). `request` holds a `since` to the back of the queue (never
 *   before the last waiting start's) and to now; only `restore`, after a restart, brings `games.waiting_since`'s old order back. A start waits whenever
 *   anything waits before it; only the head is admitted, as soon as its units fit. A start that arrives with an empty queue is admitted at once under the
 *   same test. `source` gives no priority (ranked matches included, milestone 15). The queue keeps its own copy of every request.
 * - **Pacing**: the soft levels are gates, and the CPU and p95 windows lag by 30 to 60 s, so a queue that all fits when a signal dips would go in at once
 *   and push the signal over again. At most `paceFraction` (10%) of the capacity, never less than a 4-player pod, is admitted from the queue per
 *   `paceEveryMs` (1 s). A start that arrives with an empty queue is not paced.
 * - **Reservations**: an admitted start holds its units until `begun` or `released`; a safety net drops a reservation that neither came for within its
 *   ready check plus `startGraceMs` (units reserved for ever would be capacity lost for good), and counts it as a failed ready check. Admission alone counts
 *   `readyCheckFailures`: a `released` with cause 'readyCheck' (the ready check ran out) and a lapse; a seat that left, a closed table or a refused start do not.
 * - **Hard limits**: `queueMax` waiting starts (past it `queueFull`, i.e. `serverBusy`), `waitMaxMs` of waiting (past it the entry is removed: `expired`),
 *   one waiting start per session and `perAddress` per address key.
 * - **Pure in time**: no timers inside; `now` is the caller's server time (the timer wheel calls `tick` about once a second, also with an empty queue: the
 *   gauges and `capacityState` come from the last reading).
 * - **How callers use it**: `request` when a table fills or a match forms; on `admitted` (the decision, or an event from `tick`, `freed` or `released`) they
 *   run the ready check; when it passes they call `TableRouter.start` and, once that has returned (the runtime counts the game's units from then on),
 *   `begun`; when it fails, or the start is refused, or a seat leaves, `released(table, now, cause)` ('readyCheck' for a check that ran out, else 'left',
 *   'closed' or 'startFailed'). `RuntimeEvents.ended` calls `freed(units)`. `withdraw` for a start that waits and no longer should (`unqueue`, `leave`).
 *   Every event `tick`, `freed` and `released` return must be handled: `expired` removes the start from its table. `withdraw` and `begun` step too (a head
 *   that fits is admitted at once); their events go to `onEvents` in a microtask (pass the same handler), or come with the next step's return.
 *
 * Positions are 1-based; `unitsAhead` counts the units strictly before the start (its own not included); the estimate adds the start's own units
 * (`estimateWaitMs`: the units that must free before it fits) and never passes `waitMaxMs`, the longest a start waits. `position` events are sent for a start only when its position, the units ahead or the
 * estimate changed, and at most once per `positionEveryMs` (a change held back is sent by a later step: nothing is lost, nothing floods).
 */
import type { ServerInfo, TableSource } from '../api';
import { METRICS, NULL_LOGGER, NULL_METRICS, type Logger, type Metrics } from '../obs';
import {
  admissible, softSignal, type Admission, type AdmissionDecision, type AdmissionEvent, type AdmissionLimits, type AdmissionRefusal, type CapacitySignals,
  type QueueStanding, type ReleaseCause, type SignalSource, type SoftSignal, type StartRequest,
} from './api';
import { FreedWindow } from './freed-window';
import { checkAdmissionLimits, checkAdmissionTiming, DEFAULT_ADMISSION_TIMING, withDefaults, type AdmissionTiming } from './limits';

/** The soft signals, in `softSignal`'s order (the values of the metrics' `signal` label). */
export const SOFT_SIGNALS: readonly SoftSignal[] = ['units', 'store', 'cpu', 'p95', 'heap', 'outbound'];

/** A change of the estimate that is worth a new `position`: at least this many milliseconds and this fraction of the estimate last shown. */
const ESTIMATE_STEP_MS = 10_000;
const ESTIMATE_STEP_FRACTION = 0.2;

export interface CapacityAdmissionOptions {
  /** The runtime (`Runtime` is a `SignalSource`); tests pass a fake. */
  signals: SignalSource;
  /** Over `DEFAULT_ADMISSION_LIMITS`; `admissionLimitsOf(config)` for the server's configuration. */
  limits?: Partial<AdmissionLimits>;
  timing?: Partial<AdmissionTiming>;
  metrics?: Metrics;
  logger?: Logger;
  /**
   * Called, in a microtask and never inside the call that caused them, with the events a `withdraw` or a `begun` produced (a head that fits now, new
   * positions). Without it they are carried to the next `tick`, `freed` or `released`, which returns them first. The gateway passes its event handler, so a
   * head is told at once instead of at the next tick.
   */
  onEvents?: (events: AdmissionEvent[]) => void;
}

/** What admission did since it was built (for the operator and the tests; the Prometheus figures are `METRICS.capacity*`). */
export interface AdmissionStats {
  /** Starts admitted (at once or from the queue), and how many of them at once. */
  admitted: number;
  immediate: number;
  /** Admitted starts whose game was created (`begun`). */
  begun: number;
  refused: Record<AdmissionRefusal, number>;
  /** Waiting starts withdrawn (`unqueue`, `leave`, a seat that reopened), or replaced by the same table asking again with other seats. */
  left: number;
  /** Waiting starts removed for waiting past the maximum, and those removed by `drain`. */
  expired: number;
  drained: number;
  /** Reservations that ended in `released` (any cause), those that failed their ready check (`released` with cause 'readyCheck', or lapsed): the metric. */
  released: number;
  readyCheckFailures: number;
  /** Reservations dropped by the safety net. */
  lapsed: number;
  /** Admissions held back by the pacing at least once (a step that stopped admitting heads that fitted). */
  paced: number;
}

interface Reported extends QueueStanding {
  at: number;
}

interface Waiting {
  req: StartRequest;
  /** `req.since`, never in the future. */
  since: number;
  keys: string[];
  reported: Reported;
}

interface Reservation {
  units: number;
  source: TableSource;
  /** Who sat at the table (`seatsOf`). */
  seated: string;
  /** The safety net: the reservation lapses at this time. */
  until: number;
}

/** The sessions of a start as one string (sorted, each once): two requests for a table are the same start when this is equal. */
function seatsOf(r: StartRequest): string {
  return [...new Set(r.sessions)].sort().join('\u0000');
}

function estimateChanged(a: Reported, b: QueueStanding): boolean {
  if (a.position !== b.position || a.unitsAhead !== b.unitsAhead) return true;
  if (a.estimatedWaitMs === null || b.estimatedWaitMs === null) return a.estimatedWaitMs !== b.estimatedWaitMs;
  return Math.abs(a.estimatedWaitMs - b.estimatedWaitMs) >= Math.max(ESTIMATE_STEP_MS, a.estimatedWaitMs * ESTIMATE_STEP_FRACTION);
}

export class CapacityAdmission implements Admission {
  readonly limits: Readonly<AdmissionLimits>;
  readonly timing: Readonly<AdmissionTiming>;
  private readonly signals: SignalSource;
  private readonly metrics: Metrics;
  private readonly log: Logger;
  private readonly window: FreedWindow;

  /** Waiting starts in queue order (`since`, then arrival). */
  private readonly waiting: Waiting[] = [];
  private readonly byTable = new Map<string, Waiting>();
  private readonly bySession = new Map<string, Waiting>();
  private readonly byAddress = new Map<string, number>();
  private waitingUnits = 0;
  private readonly reservations = new Map<string, Reservation>();
  private reservedUnits = 0;
  private draining = false;
  /** Events a `withdraw` or `begun` produced that no one has taken yet (the next step's return, or `onEvents`). */
  private carried: AdmissionEvent[] = [];
  private flushing = false;
  private readonly onEvents: ((events: AdmissionEvent[]) => void) | null;
  /** Pacing: the units admitted from the queue since `paceFrom`. */
  private paceFrom = Number.NEGATIVE_INFINITY;
  private pacedUnits = 0;
  /** The signals as last read, and which soft signal they set. */
  private last: CapacitySignals | null = null;
  private soft: SoftSignal | null = null;
  private readonly counts: AdmissionStats = {
    admitted: 0, immediate: 0, begun: 0, refused: { queueFull: 0, session: 0, address: 0, draining: 0 }, left: 0, expired: 0, drained: 0, released: 0, readyCheckFailures: 0, lapsed: 0, paced: 0,
  };

  /** Throws a `RangeError` for limits or timing that cannot be right (`checkAdmissionLimits`, `checkAdmissionTiming`). */
  constructor(o: CapacityAdmissionOptions) {
    this.limits = withDefaults(o.limits);
    checkAdmissionLimits(this.limits);
    this.timing = { ...DEFAULT_ADMISSION_TIMING, ...o.timing };
    checkAdmissionTiming(this.timing);
    this.signals = o.signals;
    this.metrics = o.metrics ?? NULL_METRICS;
    this.log = o.logger ?? NULL_LOGGER;
    this.onEvents = o.onEvents ?? null;
    this.window = new FreedWindow(this.timing.estimateWindowMs, this.timing.estimateMinWindowMs);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Admission (api.ts)

  request(r: StartRequest, now: number): AdmissionDecision {
    return this.ask(r, now, false);
  }

  /**
   * `restore` asks with `backdate`: only a start that waited before a restart may keep an older `since` than the starts waiting now. Any other `since`
   * is held to the back of the queue (never before the last waiting start's) and to now (never in the future): a caller's clock or mistake cannot jump
   * the queue, or sort a start to its tail with a time that stops the expiry of the starts behind it.
   */
  private ask(given: StartRequest, now: number, backdate: boolean): AdmissionDecision {
    this.window.start(now);
    this.lapse(now);
    if (!Number.isInteger(given.units) || given.units < 1) throw new RangeError(`Admission: the units of a start must be a whole number of at least 1 (table ${given.table}).`);
    if (!Number.isFinite(given.since)) throw new RangeError(`Admission: the since of a start must be a time in milliseconds (table ${given.table}).`);
    // The queue keeps its own copy: a caller that edits its arrays afterwards must not leave a ghost session or address behind.
    const r: StartRequest = { ...given, sessions: [...given.sessions], addressKeys: [...given.addressKeys] };
    if (this.draining) return this.refuse(r, 'draining', this.timing.drainRetryAfterMs);
    // A start asking again with the same seats (the caller did not withdraw it): the same answer, nothing counted twice. With other seats it is another
    // start: the old one's ready check failed, or its place in the queue is lost (a table that changes its seats goes to the back).
    const seated = seatsOf(r);
    const held = this.reservations.get(r.table);
    if (held) {
      if (held.seated === seated) {
        // Still on its way to begin: the safety net starts again from now.
        held.until = now + this.readyMs(held.source) + this.timing.startGraceMs;
        return { kind: 'admitted' };
      }
      this.failReady(r.table, held, 'seats');
    }
    const known = this.byTable.get(r.table);
    if (known) {
      if (seatsOf(known.req) === seated) return { kind: 'waiting', ...this.standing(known, now) };
      this.remove(known);
      this.leave(r.table, 'seats', now, known.since);
    }
    if (r.sessions.some((s) => this.bySession.has(s))) return this.refuse(r, 'session', 0);
    const keys = [...new Set(r.addressKeys)];
    if (keys.some((k) => (this.byAddress.get(k) ?? 0) >= this.limits.perAddress)) return this.refuse(r, 'address', 0);

    const tail = this.waiting[this.waiting.length - 1];
    const since = Math.min(backdate ? r.since : Math.max(r.since, tail?.since ?? Number.NEGATIVE_INFINITY), now);
    if (this.waiting.length === 0 && admissible(this.read(now), this.limits, r.units, this.reservedUnits)) {
      this.admit(r.table, r.units, r.source, seated, since, now, false);
      this.publish(now);
      return { kind: 'admitted' };
    }
    // A start that could never fit would sit at the head for ever and stop everyone behind it.
    if (r.units > this.limits.capacityUnits || this.waiting.length >= this.limits.queueMax) return this.refuse(r, 'queueFull', this.timing.busyRetryAfterMs);

    const w: Waiting = { req: r, since, keys, reported: { at: now, position: 0, unitsAhead: 0, estimatedWaitMs: null } };
    this.insert(w);
    const standing = this.standing(w, now);
    w.reported = { at: now, ...standing };
    this.log.log('debug', 'capacityQueued', { game: r.table, units: r.units, source: r.source, position: standing.position });
    this.publish(now);
    return { kind: 'waiting', ...standing };
  }

  withdraw(table: string, now: number): boolean {
    this.window.start(now);
    const w = this.byTable.get(table);
    if (!w) return false;
    this.remove(w);
    this.leave(table, 'withdrawn', now, w.since);
    // The head may have changed (or been the one that left): the next one is admitted now if it fits, and told at once (`onEvents`) or at the next tick.
    this.carry(this.step(now));
    return true;
  }

  begun(table: string, now: number): void {
    this.window.start(now);
    if (!this.release(table)) {
      this.log.log('debug', 'capacityBegunUnknown', { game: table });
      return;
    }
    this.counts.begun++;
    // The runtime counts the game now and the reservation has ended: the units are no longer counted twice, which may let the head in.
    this.carry(this.step(now));
  }

  released(table: string, now: number, cause?: ReleaseCause): AdmissionEvent[] {
    this.window.start(now);
    const res = this.reservations.get(table);
    if (!res) return this.takeCarried([]);
    this.failReady(table, res, cause ?? 'unknown');
    return this.takeCarried(this.step(now));
  }

  freed(units: number, now: number): AdmissionEvent[] {
    this.window.start(now);
    this.window.add(units, now);
    return this.takeCarried(this.step(now));
  }

  tick(now: number): AdmissionEvent[] {
    this.window.start(now);
    return this.takeCarried(this.step(now));
  }

  size(): { starts: number; units: number; reserved: number } {
    return { starts: this.waiting.length, units: this.waitingUnits, reserved: this.reservedUnits };
  }

  drain(): void {
    if (!this.draining) this.log.log('info', 'capacityDrain', { waiting: this.waiting.length, reserved: this.reservations.size });
    this.draining = true;
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Beyond the contract (the gateway, tables and matchmaking use these through the class)

  /**
   * After a restart: the starts that were waiting or in a ready check (`games.waiting_since` as `since`), requested in their old order whatever order the
   * caller found them in (a start asking first would otherwise be admitted ahead of an older one that asks a moment later). Decisions in that order.
   */
  restore(starts: readonly StartRequest[], now: number): { table: string; decision: AdmissionDecision }[] {
    for (const r of starts) if (!Number.isFinite(r.since)) throw new RangeError('Admission: the since of a start must be a time in milliseconds (table ' + r.table + ').');
    return [...starts]
      .sort((a, b) => a.since - b.since || (a.table < b.table ? -1 : a.table > b.table ? 1 : 0))
      .map((r) => ({ table: r.table, decision: this.ask(r, now, true) }));
  }

  /** The table's place in the queue now (the `queueStatus` of a reconnecting player, `welcome.queue`); null when it does not wait. */
  lookup(table: string, now: number): QueueStanding | null {
    const w = this.byTable.get(table);
    return w ? this.standing(w, now) : null;
  }

  /** The table has a start waiting. */
  isWaiting(table: string): boolean {
    return this.byTable.has(table);
  }

  /** The table's start was admitted and has neither begun nor been released (its ready check runs). */
  isReserved(table: string): boolean {
    return this.reservations.has(table);
  }

  /** The session has a start waiting (matchmaking's `sessionBusy`: D6, one game at a time). */
  hasWaitingSession(session: string): boolean {
    return this.bySession.has(session);
  }

  /**
   * `ServerInfo.capacity` (the `welcome`): 'open' when a start would be admitted at once, 'queueing' when it would wait, 'full' when it would be refused
   * (`serverBusy`, or `draining`). From the last signal reading (`tick`, `request`, `freed`).
   */
  capacityState(): ServerInfo['capacity'] {
    if (this.draining) return 'full';
    const fits = this.last === null || admissible(this.last, this.limits, this.limits.units.two, this.reservedUnits);
    if (this.waiting.length === 0 && fits) return 'open';
    return this.waiting.length >= this.limits.queueMax ? 'full' : 'queueing';
  }

  /** The soft signal at the last reading (null: under the soft limit). */
  softLimit(): SoftSignal | null {
    return this.soft;
  }

  stats(): AdmissionStats {
    return { ...this.counts, refused: { ...this.counts.refused } };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The step: what every change of capacity does

  /** Lapse stale reservations, remove starts that waited too long (or all of them when draining), admit heads while they fit, report new positions. */
  private step(now: number): AdmissionEvent[] {
    const events: AdmissionEvent[] = [];
    this.lapse(now);

    if (this.draining) {
      while (this.waiting.length > 0) events.push(this.expire(this.waiting[0]!, now, 'draining'));
    } else {
      // The queue is ordered by `since`, so the starts that waited too long are always its first ones.
      while (this.waiting.length > 0 && now - this.waiting[0]!.since > this.limits.waitMaxMs) events.push(this.expire(this.waiting[0]!, now, null));
    }

    const signals = this.read(now);
    if (now - this.paceFrom >= this.timing.paceEveryMs || now < this.paceFrom) {
      this.paceFrom = now;
      this.pacedUnits = 0;
    }
    // Never less than the biggest start, so a pod is not stopped by the pacing alone.
    const pace = Math.max(Math.ceil(this.limits.capacityUnits * this.timing.paceFraction), this.limits.units.four);
    while (!this.draining && this.waiting.length > 0) {
      const head = this.waiting[0]!;
      if (!admissible(signals, this.limits, head.req.units, this.reservedUnits)) break;
      if (this.pacedUnits > 0 && this.pacedUnits + head.req.units > pace) {
        this.counts.paced++;
        break;
      }
      this.remove(head);
      this.admit(head.req.table, head.req.units, head.req.source, seatsOf(head.req), head.since, now, true);
      this.pacedUnits += head.req.units;
      events.push({ kind: 'admitted', table: head.req.table });
    }

    this.report(now, events);
    this.publish(now);
    return events;
  }

  /** Reservations whose ready check, plus the grace for the runtime's start, ran out without `begun` or `released`: the units are free again. */
  private lapse(now: number): void {
    for (const [table, res] of this.reservations) {
      if (res.until > now) continue;
      this.release(table);
      this.counts.lapsed++;
      this.countReadyCheckFailure(res);
      this.log.log('warn', 'capacityLapsed', { game: table, units: res.units, source: res.source });
    }
  }

  private expire(w: Waiting, now: number, cause: 'draining' | null): AdmissionEvent {
    this.remove(w);
    const table = w.req.table;
    if (cause === 'draining') {
      this.counts.drained++;
      this.metrics.inc(METRICS.refusals, { reason: 'draining' });
    } else {
      this.counts.expired++;
      this.metrics.inc(METRICS.refusals, { reason: 'capacityTimeout' });
    }
    this.log.log('info', 'capacityExpired', { game: table, waitMs: Math.max(0, now - w.since), cause: cause ?? 'waited' });
    return cause === 'draining'
      ? { kind: 'expired', table, retryAfterMs: this.timing.drainRetryAfterMs, cause }
      : { kind: 'expired', table, retryAfterMs: this.timing.busyRetryAfterMs };
  }

  /** The `position` events due: a start whose place changed, at most once per `positionEveryMs`. */
  private report(now: number, events: AdmissionEvent[]): void {
    let ahead = 0;
    for (let i = 0; i < this.waiting.length; i++) {
      const w = this.waiting[i]!;
      const cur: QueueStanding = { position: i + 1, unitsAhead: ahead, estimatedWaitMs: this.estimate(ahead + w.req.units, now) };
      if (now - w.reported.at >= this.timing.positionEveryMs && estimateChanged(w.reported, cur)) {
        w.reported = { at: now, ...cur };
        events.push({ kind: 'position', table: w.req.table, ...cur });
      }
      ahead += w.req.units;
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // The queue and the reservations

  private admit(table: string, units: number, source: TableSource, seated: string, since: number, now: number, queued: boolean): void {
    this.reservations.set(table, { units, source, seated, until: now + this.readyMs(source) + this.timing.startGraceMs });
    this.reservedUnits += units;
    this.counts.admitted++;
    if (!queued) this.counts.immediate++;
    const waitMs = Math.max(0, now - since);
    this.metrics.observe(METRICS.capacityWaitSeconds, waitMs / 1000);
    this.log.log('info', 'capacityAdmitted', { game: table, units, source, waitMs, queued });
  }

  /**
   * An admitted start did not begin (`released`, or the table asked again with other seats): the units are free again. Only a ready check that ran out
   * ('readyCheck') counts as a ready-check failure; a seat that left, a table that closed, a start the runtime refused and a change of seats do not.
   */
  private failReady(table: string, res: Reservation, cause: ReleaseCause | 'unknown' | 'seats'): void {
    this.release(table);
    this.counts.released++;
    if (cause === 'readyCheck') this.countReadyCheckFailure(res);
    this.log.log('info', 'capacityReleased', { game: table, units: res.units, source: res.source, cause });
  }

  private countReadyCheckFailure(res: Reservation): void {
    this.counts.readyCheckFailures++;
    this.metrics.inc(METRICS.readyCheckFailures, { kind: res.source === 'matched' ? 'match' : 'table' });
  }

  /** A waiting start left the queue before it was admitted (it asked to, or its table's seats changed). */
  private leave(table: string, why: 'withdrawn' | 'seats', now: number, since: number): void {
    this.counts.left++;
    this.metrics.inc(METRICS.capacityLeft, { reason: why });
    this.log.log('info', 'capacityLeft', { game: table, waitMs: Math.max(0, now - since), cause: why });
  }

  private readyMs(source: TableSource): number {
    return source === 'matched' ? this.timing.readyCheckMatchMs : this.timing.readyCheckTableMs;
  }

  /** Events a call produced that it cannot return (`withdraw`, `begun`): kept for the next step's return, or given to `onEvents` in a microtask. */
  private carry(events: AdmissionEvent[]): void {
    if (events.length === 0) return;
    this.carried.push(...events);
    if (this.onEvents === null || this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => {
      this.flushing = false;
      const due = this.takeCarried([]);
      if (due.length > 0) this.onEvents?.(due);
    });
  }

  /** The carried events first, then `events`. */
  private takeCarried(events: AdmissionEvent[]): AdmissionEvent[] {
    if (this.carried.length === 0) return events;
    const out = [...this.carried, ...events];
    this.carried = [];
    return out;
  }

  /** Ends a reservation (begun, released, lapsed); false when there was none. */
  private release(table: string): boolean {
    const res = this.reservations.get(table);
    if (!res) return false;
    this.reservations.delete(table);
    this.reservedUnits -= res.units;
    return true;
  }

  /** In `since` order; a start with the same `since` as others goes behind them. */
  private insert(w: Waiting): void {
    let i = this.waiting.length;
    while (i > 0 && this.waiting[i - 1]!.since > w.since) i--;
    this.waiting.splice(i, 0, w);
    this.byTable.set(w.req.table, w);
    for (const s of w.req.sessions) this.bySession.set(s, w);
    for (const k of w.keys) this.byAddress.set(k, (this.byAddress.get(k) ?? 0) + 1);
    this.waitingUnits += w.req.units;
  }

  private remove(w: Waiting): void {
    this.waiting.splice(this.waiting.indexOf(w), 1);
    this.byTable.delete(w.req.table);
    for (const s of w.req.sessions) if (this.bySession.get(s) === w) this.bySession.delete(s);
    for (const k of w.keys) {
      const n = (this.byAddress.get(k) ?? 0) - 1;
      if (n > 0) this.byAddress.set(k, n);
      else this.byAddress.delete(k);
    }
    this.waitingUnits -= w.req.units;
  }

  /** The wait for `units` to free, never longer than a start may wait at all: past `waitMaxMs` it is removed (design 4.6), so a longer time is no news. */
  private estimate(units: number, now: number): number | null {
    const e = this.window.estimate(units, now);
    return e === null ? null : Math.min(e, this.limits.waitMaxMs);
  }

  private standing(w: Waiting, now: number): QueueStanding {
    let ahead = 0;
    let position = 1;
    for (const x of this.waiting) {
      if (x === w) break;
      ahead += x.req.units;
      position++;
    }
    return { position, unitsAhead: ahead, estimatedWaitMs: this.estimate(ahead + w.req.units, now) };
  }

  private refuse(r: StartRequest, reason: AdmissionRefusal, retryAfterMs: number): AdmissionDecision {
    this.counts.refused[reason]++;
    this.metrics.inc(METRICS.refusals, { reason });
    this.log.log('info', 'capacityRefused', { game: r.table, refusal: reason, source: r.source, units: r.units });
    return { kind: 'refused', reason, retryAfterMs };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------
  // Signals and metrics

  /** The runtime's signals now, with the soft limit's gauges. */
  private read(now: number): CapacitySignals {
    const s = this.signals.read(now);
    this.last = s;
    this.metrics.set(METRICS.capacityUnits, s.runningUnits);
    const soft = softSignal(s, this.limits);
    for (const signal of SOFT_SIGNALS) this.metrics.set(METRICS.capacitySoft, signal === soft ? 1 : 0, { signal });
    if (soft !== this.soft) {
      // Entering or leaving the soft limit is news; moving from one signal to another is detail.
      this.log.log(soft === null || this.soft === null ? 'info' : 'debug', 'capacitySoft', { signal: soft ?? 'none', running: s.runningUnits });
      this.soft = soft;
    }
    return s;
  }

  /** The queue's gauges. */
  private publish(now: number): void {
    this.metrics.set(METRICS.capacityQueueStarts, this.waiting.length);
    this.metrics.set(METRICS.capacityQueueUnits, this.waitingUnits);
    const head = this.waiting[0];
    this.metrics.set(METRICS.capacityHeadAgeSeconds, head ? Math.max(0, now - head.since) / 1000 : 0);
  }
}
