/**
 * M13-10: the metrics and logs of design 4.6 (running units, the soft limit and which signal set it, the queue's length in starts and units, the wait
 * histogram at admission, the age of the head, refusals, ready-check failures) and `capacityState` for the welcome. `MemoryMetrics` refuses any metric
 * name, label or label value outside the closed sets of obs.ts, so a wrong label is a failed test.
 */
import { describe, expect, it } from 'vitest';
import { Rig, MIN, SEC } from './helpers';

describe('M13-10: metrics', () => {
  it('running units, the soft limit by signal, the queue in starts and units, and the age of the head', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 10 });
    r.start('A');
    r.go(30 * SEC);
    r.start('B', { seats: 4 });
    r.start('C', { seats: 3 });
    r.go(30 * SEC);
    expect(r.value('openmtg_hosted_capacity_units')).toBe(10);
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'units' })).toBe(1);
    for (const s of ['store', 'cpu', 'p95', 'heap', 'outbound'] as const) expect(r.value('openmtg_hosted_capacity_soft', { signal: s }), s).toBe(0);
    expect(r.value('openmtg_hosted_capacity_queue_starts')).toBe(3);
    expect(r.value('openmtg_hosted_capacity_queue_units')).toBe(10);
    expect(r.value('openmtg_hosted_capacity_head_age_seconds')).toBe(60);

    // A is admitted: the head is now B, which began waiting 30 s after A
    r.end(1);
    expect(r.value('openmtg_hosted_capacity_units')).toBe(9);
    expect(r.value('openmtg_hosted_capacity_queue_starts')).toBe(2);
    expect(r.value('openmtg_hosted_capacity_queue_units')).toBe(9);
    expect(r.value('openmtg_hosted_capacity_head_age_seconds')).toBe(30);
  });

  it('the soft limit gauge follows the first signal set, and clears', () => {
    const r = new Rig();
    r.ask('t0');
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'units' })).toBe(0);
    r.sig.set({ outbound: 0.85 });
    r.go(SEC);
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'outbound' })).toBe(1);
    r.sig.set({ outbound: 0.1, workerHeap: 0.9 });
    r.go(SEC);
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'outbound' })).toBe(0);
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'heap' })).toBe(1);
    r.sig.set({ workerHeap: 0.1 });
    r.go(SEC);
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'heap' })).toBe(0);
  });

  it('the wait histogram at admission: 0 for a start admitted at once, the time waited for one that waited', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.ask('now');
    r.sig.set({ runningUnits: 10 });
    r.start('A');
    r.go(90 * SEC);
    r.start('B');
    r.go(30 * SEC);
    r.end(1);
    r.go(10 * SEC);
    r.end(1);
    expect(r.observed('openmtg_hosted_capacity_wait_seconds')).toEqual([0, 120, 40]);
  });

  it('an empty queue reads zero', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    r.start('A');
    r.go(10 * SEC);
    expect(r.value('openmtg_hosted_capacity_head_age_seconds')).toBe(10);
    r.adm.withdraw('A', r.now);
    expect(r.value('openmtg_hosted_capacity_queue_starts')).toBe(0);
    expect(r.value('openmtg_hosted_capacity_queue_units')).toBe(0);
    expect(r.value('openmtg_hosted_capacity_head_age_seconds')).toBe(0);
  });

  it('refusals by reason, starts that waited too long as capacityTimeout, ready-check failures by kind', () => {
    const r = new Rig({ limits: { queueMax: 1, waitMaxMs: 5 * MIN } });
    r.sig.set({ cpu: 0.9 });
    r.start('A', { sessions: ['s1'], addressKeys: ['k'] });
    r.start('B', { sessions: ['s1'] });
    r.start('C', { addressKeys: ['k'] });
    r.start('D');
    r.go(5 * MIN + 1);
    r.sig.set({ cpu: 0.1 });
    r.start('M', { source: 'matched' });
    r.adm.released('M', r.now, 'readyCheck');
    r.adm.drain();
    r.start('E');
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'session' })).toBe(1);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'queueFull' })).toBe(2);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'draining' })).toBe(1);
    expect(r.value('openmtg_hosted_refusals_total', { reason: 'capacityTimeout' })).toBe(1);
    expect(r.value('openmtg_hosted_ready_check_failures_total', { kind: 'match' })).toBe(1);
    expect(r.adm.stats()).toMatchObject({ expired: 1, released: 1, refused: { queueFull: 2, session: 1, address: 0, draining: 1 } });
  });
});

describe('M13-10: capacityState (the welcome\'s `capacity`)', () => {
  it('open when a start would be admitted now, queueing when it would wait, full when it would be refused', () => {
    const r = new Rig({ limits: { capacityUnits: 10, queueMax: 2 } });
    expect(r.adm.capacityState()).toBe('open');
    r.ask('a');
    expect(r.adm.capacityState()).toBe('open');
    r.sig.set({ runningUnits: 9 });
    r.go(SEC);
    // 9 running and 1 reserved: the next 1v1 game would wait
    expect(r.adm.capacityState()).toBe('queueing');
    r.start('w1');
    expect(r.adm.capacityState()).toBe('queueing');
    r.start('w2');
    expect(r.adm.capacityState()).toBe('full');
    r.adm.withdraw('w2', r.now);
    expect(r.adm.capacityState()).toBe('queueing');
    r.adm.withdraw('w1', r.now);
    r.adm.begun('a', r.now);
    r.go(SEC);
    // 9 of 10 running, nothing reserved: a 1v1 game fits (a pod would not; 'open' is about the smallest start)
    expect(r.adm.capacityState()).toBe('open');
  });

  it('any soft signal means queueing', () => {
    const r = new Rig();
    r.sig.set({ p95ActionMs: 120 });
    r.go(SEC);
    expect(r.adm.capacityState()).toBe('queueing');
    r.sig.set({ p95ActionMs: 20 });
    r.go(SEC);
    expect(r.adm.capacityState()).toBe('open');
  });
});

describe('M13-10: logs', () => {
  it('one flat line per decision, with the game and the facts, and never a session or an address key', () => {
    const r = new Rig({ limits: { capacityUnits: 10, queueMax: 1 } });
    r.sig.set({ runningUnits: 10 });
    r.start('A', { sessions: ['session-alice'], addressKeys: ['203.0.113.7'] });
    r.start('B', { sessions: ['session-bob'], addressKeys: ['203.0.113.8'] });
    r.start('C', { sessions: ['session-alice'] });
    r.go(10 * SEC);
    r.end(1);
    r.adm.released('A', r.now);
    r.adm.withdraw('B', r.now);
    expect(r.logger.lines.join('\n')).not.toMatch(/session-|203\.0\.113/);
    const events = r.logger.entries().map((e) => e['event']);
    // (A queued; B and C were refused: the queue holds one start and alice already waits; B never waited, so it cannot leave)
    expect(events).toEqual(['capacitySoft', 'capacityQueued', 'capacityRefused', 'capacityRefused', 'capacitySoft', 'capacityAdmitted', 'capacityReleased']);
    const admitted = r.logger.entries().find((e) => e['event'] === 'capacityAdmitted');
    expect(admitted).toMatchObject({ game: 'A', units: 1, source: 'listed', queued: true });
    // entering the soft limit is news, and so is leaving it (here: a game ended)
    expect(r.logger.entries().filter((e) => e['event'] === 'capacitySoft')).toEqual([
      expect.objectContaining({ signal: 'units', level: 'info', running: 10 }),
      expect.objectContaining({ signal: 'none', level: 'info', running: 9 }),
    ]);
  });
});
