/**
 * M13-10: every soft signal (design 4.6): running units, CPU 75%, p95 100 ms, worker heap 80%, outbound budget 80%, and the store (M13-5). Each one alone
 * holds starts back, the head included, and lets them go when it clears; the runtime's own `RuntimeSignals` drive admission in the last tests.
 */
import { describe, expect, it } from 'vitest';
import { CapacityAdmission, SOFT_SIGNALS, type CapacitySignals, type SoftSignal } from '../../src/admission';
import { MemoryMetrics, METRIC_LABEL_VALUES } from '../../src/obs';
import { RuntimeSignals } from '../../src/runtime';
import { MIN, Rig } from './helpers';

const SIGNALS: [SoftSignal, Partial<CapacitySignals>, Partial<CapacitySignals>, Partial<CapacitySignals>][] = [
  // [signal, at its soft level, just under it, back to calm]
  ['units', { runningUnits: 900 }, { runningUnits: 899 }, { runningUnits: 0 }],
  ['store', { store: true }, { store: false }, { store: false }],
  ['cpu', { cpu: 0.75 }, { cpu: 0.7499 }, { cpu: 0.1 }],
  ['p95', { p95ActionMs: 100 }, { p95ActionMs: 99.9 }, { p95ActionMs: 20 }],
  ['heap', { workerHeap: 0.8 }, { workerHeap: 0.7999 }, { workerHeap: 0.3 }],
  ['outbound', { outbound: 0.8 }, { outbound: 0.7999 }, { outbound: 0.05 }],
];

describe('M13-10: every soft signal holds starts back', () => {
  it('knows the signals of the contract: the values of the metrics\' signal label', () => {
    expect([...SOFT_SIGNALS].sort()).toEqual([...METRIC_LABEL_VALUES.signal].sort());
    expect(SIGNALS.map(([s]) => s).sort()).toEqual([...SOFT_SIGNALS].sort());
  });

  for (const [signal, set, under, calm] of SIGNALS) {
    it(`${signal}: a start waits while it is set, nobody is admitted at the head, and the queue drains when it clears`, () => {
      const r = new Rig();
      r.sig.set({ runningUnits: 5 });
      r.sig.set(set);
      expect(r.ask('first')).toBe('waiting');
      expect(r.ask('second')).toBe('waiting');
      expect(r.adm.softLimit()).toBe(signal);
      expect(r.adm.capacityState()).toBe('queueing');
      // the gauge names this signal, and only this one
      for (const s of SOFT_SIGNALS) expect(r.value('openmtg_hosted_capacity_soft', { signal: s }), s).toBe(s === signal ? 1 : 0);

      // time passes and units free, and the head stays where it is: only 'units' is about units
      for (let i = 0; i < 3; i++) {
        r.go(MIN);
        if (signal !== 'units') expect(r.tables(r.end(1), 'admitted')).toEqual([]);
      }
      expect(r.adm.size().starts).toBe(2);
      expect(r.adm.size().reserved).toBe(0);

      // just under its level the head goes, and the second after it when it fits (units: only one unit is left)
      r.sig.set(under);
      expect(r.tables(r.go(1_000), 'admitted')).toEqual(signal === 'units' ? ['first'] : ['first', 'second']);
      r.sig.set(calm);
      expect(r.tables(r.go(1_000), 'admitted')).toEqual(signal === 'units' ? ['second'] : []);
      expect(r.adm.size().starts).toBe(0);
      expect(r.adm.softLimit()).toBeNull();
    });

    it(`${signal}: just under its level a start is admitted at once`, () => {
      const r = new Rig();
      r.sig.set(under);
      expect(r.ask('t')).toBe('admitted');
      expect(r.adm.softLimit()).toBeNull();
      expect(r.adm.capacityState()).toBe(signal === 'units' ? 'queueing' : 'open');
    });
  }

  it('a start with an empty queue waits while a signal is set, and goes at the next step after it clears', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.9 });
    expect(r.ask('t')).toBe('waiting');
    r.sig.set({ cpu: 0.2 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['t']);
  });

  it('above the critical levels (heap or outbound budget at 90%) nothing is admitted, the head included: they are above the soft ones', () => {
    for (const set of [{ workerHeap: 0.9 }, { workerHeap: 0.97 }, { outbound: 0.9 }, { outbound: 1 }, { workerHeap: 0.95, outbound: 0.95 }]) {
      const r = new Rig();
      r.sig.set({ runningUnits: 5, ...set });
      expect(r.ask('head'), JSON.stringify(set)).toBe('waiting');
      for (let i = 0; i < 5; i++) {
        // games end and a minute passes: all the units are free, the head still waits
        expect(r.tables(r.end(1), 'admitted')).toEqual([]);
        expect(r.tables(r.go(MIN), 'admitted')).toEqual([]);
      }
      expect(r.adm.size().starts).toBe(1);
      r.sig.set({ workerHeap: 0.3, outbound: 0.05 });
      expect(r.tables(r.go(1_000), 'admitted')).toEqual(['head']);
    }
  });

  it('the p95 is no signal before the runtime has enough samples (null)', () => {
    const r = new Rig();
    r.sig.set({ p95ActionMs: null });
    expect(r.ask('t')).toBe('admitted');
  });

  it('with several signals set the gauge names the first in the contract\'s order, and the queue stays closed until all have cleared', () => {
    const r = new Rig();
    r.sig.set({ cpu: 0.8, workerHeap: 0.85, outbound: 0.9 });
    expect(r.ask('t')).toBe('waiting');
    expect(r.adm.softLimit()).toBe('cpu');
    r.sig.set({ cpu: 0.2 });
    expect(r.go(1_000)).toEqual([]);
    expect(r.adm.softLimit()).toBe('heap');
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'heap' })).toBe(1);
    expect(r.value('openmtg_hosted_capacity_soft', { signal: 'cpu' })).toBe(0);
    r.sig.set({ workerHeap: 0.4 });
    expect(r.go(1_000)).toEqual([]);
    expect(r.adm.softLimit()).toBe('outbound');
    r.sig.set({ outbound: 0.1 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['t']);
    // units come before the store, the store before CPU
    r.sig.set({ runningUnits: 900, store: true, cpu: 0.9 });
    r.go(1_000);
    expect(r.adm.softLimit()).toBe('units');
    r.sig.set({ runningUnits: 10 });
    r.go(1_000);
    expect(r.adm.softLimit()).toBe('store');
    r.sig.set({ store: false });
    r.go(1_000);
    expect(r.adm.softLimit()).toBe('cpu');
  });

  it('the queue drains only while every other signal is calm and the head\'s units fit: the units alone do not open it', () => {
    const r = new Rig({ limits: { capacityUnits: 10 } });
    r.sig.set({ runningUnits: 10, cpu: 0.8 });
    for (const id of ['a', 'b', 'c']) r.start(id);
    // eight units free up, but the CPU is high: nobody is admitted
    r.sig.set({ runningUnits: 2 });
    expect(r.go(1_000)).toEqual([]);
    r.sig.set({ cpu: 0.7 });
    expect(r.tables(r.go(1_000), 'admitted')).toEqual(['a', 'b', 'c']);
  });
});

describe('M13-10: driven by the runtime\'s own signals (RuntimeSignals, M13-5)', () => {
  function rig(workers = 2) {
    const t = { now: 1_000_000, running: 0, outbound: 0, store: false };
    const signals = new RuntimeSignals({ runningUnits: () => t.running, workers: () => workers, outbound: () => t.outbound, store: () => t.store }, 3, () => t.now);
    const metrics = new MemoryMetrics();
    const adm = new CapacityAdmission({ signals, metrics, limits: { capacityUnits: 100 } });
    const ask = (id: string) =>
      adm.request({ table: id, source: 'listed', seats: 2, units: 1, sessions: [`s:${id}`], addressKeys: [`a:${id}`], since: t.now }, t.now).kind;
    const go = (ms: number) => {
      t.now += ms;
      return adm.tick(t.now);
    };
    return { t, signals, adm, ask, go, metrics };
  }

  it('worker CPU: 46 s busy of 60 s (two workers, 30 s window) is 77% and holds starts; once the window has moved on they go', () => {
    const { t, signals, adm, ask, go } = rig();
    expect(ask('calm')).toBe('admitted');
    adm.begun('calm', t.now);
    signals.workerBusy(46_000);
    expect(ask('busy')).toBe('waiting');
    expect(go(29_000)).toEqual([]);
    expect(adm.softLimit()).toBe('cpu');
    expect(go(2_000)).toEqual([{ kind: 'admitted', table: 'busy' }]);
    expect(adm.softLimit()).toBeNull();
  });

  it('p95 action time: three slow actions (after the minimum samples) hold starts for a minute', () => {
    const { t, signals, adm, ask, go } = rig();
    for (let i = 0; i < 2; i++) signals.actionTime(150);
    expect(ask('few samples')).toBe('admitted');
    adm.begun('few samples', t.now);
    signals.actionTime(150);
    expect(ask('slow')).toBe('waiting');
    expect(adm.softLimit()).toBe('p95');
    expect(go(59_000)).toEqual([]);
    expect(go(2_000)).toEqual([{ kind: 'admitted', table: 'slow' }]);
  });

  it('heap, outbound budget and the store: set by their sources, cleared by them', () => {
    const { t, signals, ask, go, adm } = rig();
    signals.heap(0, { used: 850, limit: 1000 });
    signals.heap(1, { used: 100, limit: 1000 });
    expect(ask('heap')).toBe('waiting');
    expect(adm.softLimit()).toBe('heap');
    signals.heap(0, { used: 300, limit: 1000 });
    t.outbound = 0.85;
    expect(go(1_000)).toEqual([]);
    expect(adm.softLimit()).toBe('outbound');
    t.outbound = 0.1;
    t.store = true;
    expect(go(1_000)).toEqual([]);
    expect(adm.softLimit()).toBe('store');
    t.store = false;
    expect(go(1_000)).toEqual([{ kind: 'admitted', table: 'heap' }]);
  });

  it('the units: the runtime\'s running units against CAPACITY_UNITS', () => {
    const { t, ask, go, adm } = rig();
    t.running = 100;
    expect(ask('full')).toBe('waiting');
    expect(adm.softLimit()).toBe('units');
    t.running = 99;
    expect(go(1_000)).toEqual([{ kind: 'admitted', table: 'full' }]);
  });
});
