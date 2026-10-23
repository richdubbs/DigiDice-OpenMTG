/**
 * What capacity admission is configured with (design 4.6; package M13-10): the limits from the server's configuration, the timing the design fixes in
 * other sections (ready-check lengths, the estimate's window), and the check that refuses nonsense at construction. `CapacityAdmission` (queue.ts) takes
 * both; the gateway's `main.ts` builds them from `HostedConfig` with `admissionLimitsOf`.
 */
import { HOSTED_TIMING } from '../api';
import type { HostedConfig } from '../config';
import { capacityUnits, DEFAULT_ADMISSION_LIMITS, DEFAULT_UNITS, type AdmissionLimits, type StartRequest } from './api';

/** The time-based figures of admission (all in milliseconds). Tests shorten them; the defaults are the design's. */
export interface AdmissionTiming {
  /** The ready check's length (design 4.1, 4.5): 30 s for listed and private tables, 15 s for a matchmaking match. */
  readyCheckTableMs: number;
  readyCheckMatchMs: number;
  /**
   * After its ready check, an admitted start still needs the runtime's `start` to finish before the gateway calls `begun`: its reservation lapses this
   * long after the ready check's length, whatever the gateway did (a safety net against units reserved for ever).
   */
  startGraceMs: number;
  /** `retryAfterMs` of `serverBusy` (the queue is full, or a start waited too long) and of a refusal while draining. */
  busyRetryAfterMs: number;
  drainRetryAfterMs: number;
  /** A waiting start gets a new `position` at most this often (design 3.4: `queueStatus` at most once per 5 s). */
  positionEveryMs: number;
  /**
   * The wait estimate counts the units freed in the last `estimateWindowMs` (design 4.6: 10 minutes). In the first minutes of a process the window is the
   * time since admission was first used, but at least `estimateMinWindowMs` (so a few units freed in the first seconds do not promise too much).
   */
  estimateWindowMs: number;
  estimateMinWindowMs: number;
  /**
   * Pacing (M13-10 review): the soft levels are gates, and the CPU and p95 windows lag by 30 to 60 s, so a queue that all fits the moment a signal dips
   * would go in at once and push the signal over again. At most `paceFraction` of `capacityUnits` (at least a 4-player pod's units) is admitted FROM THE
   * QUEUE per `paceEveryMs` (0: per step); a start that arrives with an empty queue is not paced.
   */
  paceFraction: number;
  paceEveryMs: number;
}

export const DEFAULT_ADMISSION_TIMING: Readonly<AdmissionTiming> = {
  readyCheckTableMs: HOSTED_TIMING.readyCheckTableMs,
  readyCheckMatchMs: HOSTED_TIMING.readyCheckMatchMs,
  startGraceMs: 10_000,
  busyRetryAfterMs: 2 * 60_000,
  drainRetryAfterMs: 60_000,
  positionEveryMs: HOSTED_TIMING.queueStatusEveryMs,
  estimateWindowMs: 10 * 60_000,
  estimateMinWindowMs: 60_000,
  paceFraction: 0.1,
  paceEveryMs: 1_000,
};

/** The limits the configuration sets (`CAPACITY_UNITS`, `CAPACITY_QUEUE_MAX`, `CAPACITY_WAIT_MAX_MINUTES`, `UNITS_*`); the soft levels are the design's. */
export function admissionLimitsOf(c: Pick<HostedConfig, 'capacityUnits' | 'capacityQueueMax' | 'capacityWaitMaxMinutes' | 'units'>): AdmissionLimits {
  return {
    ...DEFAULT_ADMISSION_LIMITS,
    capacityUnits: c.capacityUnits,
    queueMax: c.capacityQueueMax,
    waitMaxMs: c.capacityWaitMaxMinutes * 60_000,
    units: { ...c.units },
  };
}

/** `limits` over the design's defaults (the units too, one by one). */
export function withDefaults(limits: Partial<AdmissionLimits> = {}): AdmissionLimits {
  return { ...DEFAULT_ADMISSION_LIMITS, ...limits, units: { ...DEFAULT_UNITS, ...limits.units } };
}

const wholeAtLeast = (n: number, min: number): boolean => Number.isInteger(n) && n >= min;
const fraction = (n: number): boolean => Number.isFinite(n) && n > 0 && n <= 1;

/**
 * Throws a `RangeError` naming the first limit that cannot be right: the capacity and the units whole and positive (a 1v1 game at most a 3-player pod at
 * most a 4-player pod), the soft levels sensible, the queue and the waits bounded, at least one waiting start per address key.
 */
export function checkAdmissionLimits(l: Readonly<AdmissionLimits>): void {
  const bad = (what: string): never => {
    throw new RangeError(`Admission limits: ${what}.`);
  };
  if (!wholeAtLeast(l.capacityUnits, 1)) bad('capacityUnits must be a whole number of at least 1');
  for (const [name, n] of Object.entries(l.units)) if (!wholeAtLeast(n, 1)) bad(`units.${name} must be a whole number of at least 1`);
  if (l.units.two > l.units.three || l.units.three > l.units.four) bad('units must not shrink with the table size (two <= three <= four)');
  if (!fraction(l.cpuSoft)) bad('cpuSoft must be above 0 and at most 1');
  if (!fraction(l.heapSoft)) bad('heapSoft must be above 0 and at most 1');
  if (!fraction(l.outboundSoft)) bad('outboundSoft must be above 0 and at most 1');
  if (!(Number.isFinite(l.p95SoftMs) && l.p95SoftMs > 0)) bad('p95SoftMs must be above 0');
  if (!wholeAtLeast(l.queueMax, 0)) bad('queueMax must be a whole number of at least 0');
  if (!(Number.isFinite(l.waitMaxMs) && l.waitMaxMs > 0)) bad('waitMaxMs must be above 0');
  if (!wholeAtLeast(l.perAddress, 1)) bad('perAddress must be a whole number of at least 1');
}

/** Throws a `RangeError` naming the first timing figure that cannot be right (lengths above 0, delays and grace not negative, all finite). */
export function checkAdmissionTiming(t: Readonly<AdmissionTiming>): void {
  const bad = (what: string): never => {
    throw new RangeError(`Admission timing: ${what}.`);
  };
  for (const name of ['readyCheckTableMs', 'readyCheckMatchMs', 'estimateWindowMs', 'estimateMinWindowMs'] as const) {
    if (!(Number.isFinite(t[name]) && t[name] > 0)) bad(`${name} must be above 0`);
  }
  for (const name of ['startGraceMs', 'busyRetryAfterMs', 'drainRetryAfterMs', 'positionEveryMs', 'paceEveryMs'] as const) {
    if (!(Number.isFinite(t[name]) && t[name] >= 0)) bad(`${name} must be 0 or more`);
  }
  if (!fraction(t.paceFraction)) bad('paceFraction must be above 0 and at most 1');
}

/** A `StartRequest` for a table of `fields.seats` players, its units from `weights` (the configured `UNITS_*`; callers never compute units themselves). */
export function startRequestFor(fields: Omit<StartRequest, 'units'>, weights: Readonly<AdmissionLimits['units']> = DEFAULT_UNITS): StartRequest {
  return { ...fields, units: capacityUnits(fields.seats, weights) };
}
