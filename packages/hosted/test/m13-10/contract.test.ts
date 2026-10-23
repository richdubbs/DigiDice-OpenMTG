/**
 * M13-10: `CapacityAdmission` against the contract of api.ts (M13-1): it is an `Admission`, it answers like the `ImmediateAdmission` double while the
 * server is under its soft limit (so the gateway's tests with the double stay true), the package exports it, and the one additive contract change
 * (`expired.cause`) is what `drain` reports.
 */
import { describe, expect, it } from 'vitest';
import * as hosted from '@openmtg/hosted';
import {
  ImmediateAdmission, type Admission, type AdmissionDecision, type AdmissionEvent, type CapacitySignals, type SignalSource, type StartRequest,
} from '@openmtg/hosted';
import { CapacityAdmission } from '../../src/admission';

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const pin = <T extends true>(_: T): void => {};

const calm: SignalSource = { read: (): CapacitySignals => ({ runningUnits: 0, cpu: 0.1, p95ActionMs: 20, workerHeap: 0.3, outbound: 0.05 }) };
const asAdmission: Admission = new CapacityAdmission({ signals: calm });
pin<Equal<Parameters<Admission['request']>, [StartRequest, number]>>(true);
pin<Equal<ReturnType<Admission['freed']>, AdmissionEvent[]>>(true);

const request = (table: string, seats: 2 | 3 | 4 = 2): StartRequest => ({
  table, source: 'listed', seats, units: seats === 2 ? 1 : seats === 3 ? 4 : 5, sessions: [`${table}:1`], addressKeys: [`${table}:k`], since: 0,
});

describe('M13-10: the Admission contract', () => {
  it('is an Admission, with the contract\'s methods', () => {
    expect(typeof asAdmission.request).toBe('function');
    for (const m of ['request', 'withdraw', 'begun', 'released', 'freed', 'tick', 'size', 'drain', 'capacityState', 'lookup', 'isWaiting', 'hasWaitingSession', 'restore']) expect(typeof (asAdmission as unknown as Record<string, unknown>)[m], m).toBe('function');
  });

  it('answers like the ImmediateAdmission double under the soft limit: admitted at once, reserved until begun or released, refused when draining', () => {
    const real: Admission = new CapacityAdmission({ signals: calm });
    const fake: Admission = new ImmediateAdmission();
    const asked: AdmissionDecision[][] = [real, fake].map((a) => [a.request(request('g1'), 0), a.request(request('g2', 4), 0), a.request(request('g3', 3), 0)]);
    expect(asked[0]).toEqual(asked[1]);
    expect(real.size()).toEqual({ starts: 0, units: 0, reserved: 10 });
    expect(fake.size()).toEqual({ starts: 0, units: 0, reserved: 10 });
    for (const a of [real, fake]) {
      a.begun('g1', 1);
      expect(a.released('g2', 1)).toEqual([]);
      expect(a.size().reserved).toBe(4);
      expect(a.freed(1, 2)).toEqual([]);
      expect(a.tick(3)).toEqual([]);
      expect(a.withdraw('g3', 4)).toBe(false);
      a.drain();
    }
    expect(real.request(request('g4'), 5)).toEqual(fake.request(request('g4'), 5));
    expect(real.request(request('g4'), 5)).toMatchObject({ kind: 'refused', reason: 'draining', retryAfterMs: 60_000 });
  });

  it('is exported by the package, with its configuration helpers', () => {
    expect(hosted.CapacityAdmission).toBe(CapacityAdmission);
    for (const name of ['admissionLimitsOf', 'checkAdmissionLimits', 'startRequestFor', 'FreedWindow', 'DEFAULT_ADMISSION_TIMING', 'SOFT_SIGNALS', 'withDefaults']) {
      expect(hosted, name).toHaveProperty(name);
    }
    // the contract's own exports are still there
    for (const name of ['admissible', 'softSignal', 'estimateWaitMs', 'capacityUnits', 'ImmediateAdmission', 'DEFAULT_ADMISSION_LIMITS']) expect(hosted, name).toHaveProperty(name);
  });

  it('the additive contract change: an `expired` event may carry cause "draining" (absent: it waited too long)', () => {
    const plain: AdmissionEvent = { kind: 'expired', table: 't', retryAfterMs: 1 };
    const drained: AdmissionEvent = { kind: 'expired', table: 't', retryAfterMs: 1, cause: 'draining' };
    expect([plain, drained]).toHaveLength(2);
    pin<Equal<Extract<AdmissionEvent, { kind: 'expired' }>['cause'], 'draining' | undefined>>(true);
  });
});
