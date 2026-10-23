/**
 * M13-10: drain (design 2.3, `Admission.drain`): nothing new is admitted, waiting starts are refused with `draining` on the next tick (the additive
 * `cause` of the `expired` event), starts already admitted go on to their ready check.
 */
import { describe, expect, it } from 'vitest';
import { MIN, Rig } from './helpers';

describe('M13-10: drain', () => {
  it('a new start is refused with draining and a retry time; nothing is queued', () => {
    const r = new Rig();
    r.adm.drain();
    expect(r.start('t')).toEqual({ kind: 'refused', reason: 'draining', retryAfterMs: 60_000 });
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 0 });
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'draining' })).toBe(1);
    expect(r.adm.stats().refused.draining).toBe(1);
  });

  it('waiting starts are refused on the next tick, with cause draining; starts in their ready check go on', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 9 });
    r.start('ready'); // takes the last unit
    r.start('A');
    r.start('B', { seats: 4 });
    expect(r.adm.size()).toEqual({ starts: 2, units: 6, reserved: 1 });
    r.adm.drain();
    // the queue is not touched before the tick
    expect(r.adm.size().starts).toBe(2);
    expect(r.go(0)).toEqual([
      { kind: 'expired', table: 'A', retryAfterMs: 60_000, cause: 'draining' },
      { kind: 'expired', table: 'B', retryAfterMs: 60_000, cause: 'draining' },
    ]);
    expect(r.adm.size()).toEqual({ starts: 0, units: 0, reserved: 1 });
    expect(r.adm.isReserved('ready')).toBe(true);
    // the admitted start begins as usual
    r.begin('ready', 1);
    expect(r.adm.size().reserved).toBe(0);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'draining' })).toBe(2);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'capacityTimeout' })).toBeUndefined();
    expect(r.adm.stats()).toMatchObject({ drained: 2, expired: 0 });
  });

  it('nothing is admitted after drain, even when units free up and the head would fit', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 10 });
    r.start('A');
    r.adm.drain();
    r.sig.set({ runningUnits: 0 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual([]);
    expect(r.adm.isWaiting('A')).toBe(false);
    expect(r.start('B')).toMatchObject({ kind: 'refused', reason: 'draining' });
    expect(r.tables(r.end(0), 'admitted')).toEqual([]);
  });

  it('a start that also waited past the maximum is reported as draining; draining twice changes nothing', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    r.start('old', { since: r.now - 30 * MIN });
    r.adm.drain();
    r.adm.drain();
    expect(r.go(0)).toEqual([{ kind: 'expired', table: 'old', retryAfterMs: 60_000, cause: 'draining' }]);
  });

  it('capacityState is full while draining (nothing can start)', () => {
    const r = new Rig();
    expect(r.adm.capacityState()).toBe('open');
    r.adm.drain();
    expect(r.adm.capacityState()).toBe('full');
  });

  it('the retry time of a drain is configurable', () => {
    const r = new Rig({ timing: { drainRetryAfterMs: 5_000 } });
    r.adm.drain();
    expect(r.start('t')).toMatchObject({ retryAfterMs: 5_000 });
  });
});
