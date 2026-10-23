/**
 * Capacity admission's contract (design D16, 4.6; owner, 2026-10-15: "there needs to be a queue as well for games when the server is reaching
 * capacity"). M13-10 builds the FIFO capacity queue on it; the gateway and tables (M13-6) and matchmaking (M13-9) call it; the runtime (M13-5) supplies
 * the signals.
 *
 * - Only game **starts** are admitted (a full listed or private table, a matchmaking match). Running games are never slowed, paused or queued.
 * - **Units**: a 1v1 game 1, a 3-player pod 4, a 4-player pod 5 (planning figures, measured by M13-15, configurable: `UNITS_*`).
 * - **The soft limit** is reached when any signal is at or past its level (`softSignal`).
 * - **Strict FIFO in units**: a start waits whenever anything waits before it; the head is admitted as soon as `admissible` holds for its units (nobody
 *   passes it: a 5-unit pod is never starved by a stream of 1v1 games). A start that arrives with an empty queue is admitted at once under the same test
 *   (so "under the soft limit" means: its units fit under `capacityUnits` and no other signal is set). Ranked matches (milestone 15) get no priority.
 * - **Which is intended (M13-1 review)**: `admissible` refuses while ANY soft signal other than units is set, the head included. The soft levels (heap and
 *   outbound budget 80%) are below the critical ones of design 4.6 (90%), so "above a critical level nothing is admitted, even at the head" always holds
 *   and needs no test of its own: the contract has no separate critical level. The queue drains only while CPU, p95, heap and outbound are all under
 *   their soft levels and the head's units fit.
 * - **Reserved units**: a start admitted but not yet begun (its ready check runs, up to 30 s) holds its units as RESERVED. `admissible` counts them with
 *   the running units, so one freed slot never admits several heads within one ready-check window. The reservation ends with `begun` (the game was
 *   created: the runtime's `runningUnits` counts it from then on; until its next signal reading the units may be counted twice, which errs on the safe
 *   side, never zero times) or `released` (the ready check failed or a seat left: the units are free again).
 * - **Hard limits**: at most `queueMax` waiting starts and `waitMaxMs` of waiting; past them `serverBusy` with `retryAfterMs`.
 * - One waiting start per session (D6) and at most 2 per address key.
 */
import type { ServerInfo, TableSize, TableSource } from '../api';

/** Capacity units per table size (design 4.6). */
export interface UnitWeights {
  /** A 1v1 game (2 seats). */
  two: number;
  /** A 3-player pod. */
  three: number;
  /** A 4-player pod. */
  four: number;
}

export const DEFAULT_UNITS: Readonly<UnitWeights> = { two: 1, three: 4, four: 5 };

/** The units of a game of `seats` players. */
export function capacityUnits(seats: TableSize, w: Readonly<UnitWeights> = DEFAULT_UNITS): number {
  return seats === 2 ? w.two : seats === 3 ? w.three : w.four;
}

/** What the runtime reports (M13-5; design 4.6). Fractions are 0..1 of their limit. */
export interface CapacitySignals {
  /** Units of the games running now. */
  runningUnits: number;
  /** The game workers' CPU over the last 30 s. */
  cpu: number;
  /** The server-side p95 action time over the last minute (milliseconds); null before enough samples. */
  p95ActionMs: number | null;
  /** The fullest game worker's heap, as a fraction of its limit. */
  workerHeap: number;
  /** The outbound budget in use (design 3.5). */
  outbound: number;
  /**
   * M13-5 INTERFACE CHANGE (additive): the store is failing now (an outage; the runtime pauses the affected tables up to 60 s). Nothing is admitted
   * while it is set. Absent: false.
   */
  store?: boolean;
}

/** The runtime's signal source (M13-5 implements it; tests pass a fake). */
export interface SignalSource {
  read(now: number): CapacitySignals;
}

export interface AdmissionLimits {
  /** `CAPACITY_UNITS` (default 900: about 400 1v1 games and 100 pods, answer 16). */
  capacityUnits: number;
  /** Soft levels: CPU 75%, p95 100 ms, worker heap 80%, outbound budget 80%. */
  cpuSoft: number;
  p95SoftMs: number;
  heapSoft: number;
  outboundSoft: number;
  /** `CAPACITY_QUEUE_MAX` (300) waiting starts at most; `CAPACITY_WAIT_MAX_MINUTES` (20) of waiting at most. */
  queueMax: number;
  waitMaxMs: number;
  /** Waiting starts per address key at most (2); per session always 1. */
  perAddress: number;
  units: UnitWeights;
}

export const DEFAULT_ADMISSION_LIMITS: Readonly<AdmissionLimits> = {
  capacityUnits: 900,
  cpuSoft: 0.75,
  p95SoftMs: 100,
  heapSoft: 0.8,
  outboundSoft: 0.8,
  queueMax: 300,
  waitMaxMs: 20 * 60_000,
  perAddress: 2,
  units: { ...DEFAULT_UNITS },
};

/** Which signal set the soft limit (for the metrics: design 4.6). */
export type SoftSignal = 'units' | 'cpu' | 'p95' | 'heap' | 'outbound' | 'store';

/** The first signal at or past its soft level, in this order: units, store (M13-5), cpu, p95, heap, outbound; null under the soft limit. */
export function softSignal(s: CapacitySignals, l: Readonly<AdmissionLimits>): SoftSignal | null {
  if (s.runningUnits >= l.capacityUnits) return 'units';
  return otherSignal(s, l);
}

function otherSignal(s: CapacitySignals, l: Readonly<AdmissionLimits>): Exclude<SoftSignal, 'units'> | null {
  if (s.store === true) return 'store';
  if (s.cpu >= l.cpuSoft) return 'cpu';
  if (s.p95ActionMs !== null && s.p95ActionMs >= l.p95SoftMs) return 'p95';
  if (s.workerHeap >= l.heapSoft) return 'heap';
  if (s.outbound >= l.outboundSoft) return 'outbound';
  return null;
}

/**
 * Whether a start of `units` may be admitted now (at the head of the queue, or with an empty queue): no soft signal but units is set, and its units fit
 * beside the running units and the units `reserved` by starts admitted but not yet begun.
 */
export function admissible(s: CapacitySignals, l: Readonly<AdmissionLimits>, units: number, reserved: number): boolean {
  return otherSignal(s, l) === null && s.runningUnits + reserved + units <= l.capacityUnits;
}

/**
 * The estimated wait of a start with `unitsAhead` units before it (its own included), from the units freed in the last `windowMs` (design 4.6: the last
 * 10 minutes); null when nothing has freed in that window (no estimate).
 */
export function estimateWaitMs(unitsAhead: number, freedUnits: number, windowMs = 10 * 60_000): number | null {
  if (freedUnits <= 0) return null;
  return Math.ceil((unitsAhead / freedUnits) * windowMs);
}

/** A game start asking to begin. */
export interface StartRequest {
  /** The table (game) id. */
  table: string;
  source: TableSource;
  seats: TableSize;
  units: number;
  /** The seated sessions and their address keys (one waiting start per session, two per address key). */
  sessions: string[];
  addressKeys: string[];
  /** When the start became waiting (server time, ms); after a restart, `games.waiting_since` keeps the old order (design 4.6). */
  since: number;
}

export type AdmissionDecision =
  | { kind: 'admitted' }
  // M13-10 (a comment, not a change): `position` counts from 1; `unitsAhead` is the units of the starts BEFORE it (its own not included);
  // `estimatedWaitMs` is `estimateWaitMs(unitsAhead + its own units, ...)`. The same for the `position` events.
  | { kind: 'waiting'; position: number; unitsAhead: number; estimatedWaitMs: number | null }
  | { kind: 'refused'; reason: AdmissionRefusal; retryAfterMs: number };

export const ADMISSION_REFUSALS = ['queueFull', 'session', 'address', 'draining'] as const;
export type AdmissionRefusal = (typeof ADMISSION_REFUSALS)[number];

/** What changed in the queue (`tick`, `freed`): admitted heads, entries that waited too long, new positions to show. */
export type AdmissionEvent =
  | { kind: 'admitted'; table: string }
  | {
      kind: 'expired';
      table: string;
      retryAfterMs: number;
      /**
       * INTERFACE CHANGE (M13-10, additive): 'draining' when `drain()` removed the start (design 4.6: "refused with 'draining' on the next tick": the
       * gateway answers `draining`, not `serverBusy`); absent: it waited past `waitMaxMs` (`serverBusy`, a `capacityTimeout` notice).
       */
      cause?: 'draining';
    }
  | { kind: 'position'; table: string; position: number; unitsAhead: number; estimatedWaitMs: number | null };

/**
 * Where a waiting start stands now (M13-10; moved here from queue.ts so the interface can name it): `position` counts from 1; `unitsAhead` is the units of
 * the starts before it, its own not included; `estimatedWaitMs` counts its own as well and never passes the longest wait (`waitMaxMs`).
 */
export interface QueueStanding {
  position: number;
  unitsAhead: number;
  estimatedWaitMs: number | null;
}

/**
 * Why an admitted start did not begin (INTERFACE CHANGE (M13-10), additive: `Admission.released`'s third argument). Only 'readyCheck' is a ready-check failure
 * for the metrics (admission counts it, with a reservation that lapsed; callers must not count it again): the ready check ran out, someone did not confirm.
 * 'left': a seat left or stood up during the check; 'closed': the table closed (the creator left, it expired); 'startFailed': the runtime refused or failed
 * the start. Absent: not counted.
 */
export type ReleaseCause = 'readyCheck' | 'left' | 'closed' | 'startFailed';

export interface Admission {
  /** A start asks to begin: admitted now, waiting at the back, or refused (`serverBusy`). */
  request(r: StartRequest, now: number): AdmissionDecision;
  /** The start no longer waits (`unqueue`, `leave`, a seat that reopened). False when it was not waiting. */
  withdraw(table: string, now: number): boolean;
  /** An admitted start began (its game was created): its reserved units end (the runtime's `runningUnits` counts the game). */
  begun(table: string, now: number): void;
  /** An admitted start did not begin (its ready check failed, a seat left): its reserved units are free again; the head is re-checked. */
  released(table: string, now: number, cause?: ReleaseCause): AdmissionEvent[];
  /** A running game of `units` ended: the head is re-checked, and the freed units feed the wait estimate. */
  freed(units: number, now: number): AdmissionEvent[];
  /** Re-check the head and the waiting times (the timer wheel calls it). */
  tick(now: number): AdmissionEvent[];
  /** The queue now: waiting starts and their units, and the units reserved by admitted starts that have not begun. */
  size(): { starts: number; units: number; reserved: number };
  /** Stop admitting (drain: design 2.3); waiting starts are refused with 'draining' on the next tick. */
  drain(): void;
  /**
   * INTERFACE CHANGE (M13-10, additive; the rest of this interface after `drain`): `ServerInfo.capacity` for the `welcome`: 'open' when a start would be admitted
   * at once, 'queueing' when it would wait (the queue is not empty, or a soft signal is set, or its units do not fit), 'full' when it would be refused
   * (the queue is full, or draining). From the last signal reading (`tick`, `request`, `freed`, `released`).
   */
  capacityState(): ServerInfo['capacity'];
  /** Where the table's waiting start stands now (a reconnecting player's `queueStatus`); null when it does not wait. */
  lookup(table: string, now: number): QueueStanding | null;
  /** The table has a start waiting. */
  isWaiting(table: string): boolean;
  /** The session has a start waiting for capacity (matchmaking's `sessionBusy`, D6). */
  hasWaitingSession(session: string): boolean;
  /**
   * After a restart: the starts that waited or were in a ready check (`since` = `games.waiting_since`), requested in their old order whatever order the caller
   * found them in; the only call that may back-date a `since`. Decisions in that order.
   */
  restore(starts: readonly StartRequest[], now: number): { table: string; decision: AdmissionDecision }[];
}

/**
 * A test double for the gateway and tables (M13-6) before M13-10 lands: admits every start at once (the server under its soft limit), and counts what it
 * admitted. Not a capacity queue.
 */
export class ImmediateAdmission implements Admission {
  admitted: string[] = [];
  private readonly reserved = new Map<string, number>();
  private draining = false;

  request(r: StartRequest): AdmissionDecision {
    if (this.draining) return { kind: 'refused', reason: 'draining', retryAfterMs: 60_000 };
    this.admitted.push(r.table);
    this.reserved.set(r.table, r.units);
    return { kind: 'admitted' };
  }
  withdraw(): boolean {
    return false;
  }
  begun(table: string): void {
    this.reserved.delete(table);
  }
  released(table: string): AdmissionEvent[] {
    this.reserved.delete(table);
    return [];
  }
  freed(): AdmissionEvent[] {
    return [];
  }
  tick(): AdmissionEvent[] {
    return [];
  }
  size(): { starts: number; units: number; reserved: number } {
    let reserved = 0;
    for (const u of this.reserved.values()) reserved += u;
    return { starts: 0, units: 0, reserved };
  }
  drain(): void {
    this.draining = true;
  }
  capacityState(): ServerInfo['capacity'] {
    return this.draining ? 'full' : 'open';
  }
  lookup(): QueueStanding | null {
    return null;
  }
  isWaiting(): boolean {
    return false;
  }
  hasWaitingSession(): boolean {
    return false;
  }
  restore(starts: readonly StartRequest[]): { table: string; decision: AdmissionDecision }[] {
    return starts.map((r) => ({ table: r.table, decision: this.request(r) }));
  }
}
