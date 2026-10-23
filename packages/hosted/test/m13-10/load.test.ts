/**
 * M13-10: simulated load (design 4.6, 9.3; owner rule: in process only, never network load). A fake clock steps one second at a time; the runtime's own
 * `RuntimeSignals` report running units, worker CPU (fed by the simulated games and a CPU spike), p95 and heap; starts arrive on a fixed schedule (1v1
 * tables, 3- and 4-player pods, listed and matched) far above capacity, some fail their ready check, some leave while waiting; then arrivals stop and the
 * queue drains. Every second the invariants of design 4.6 are checked: units never exceed capacity, strict FIFO (admissions in arrival order, an
 * admission at once only into an empty queue), nobody admitted while the CPU is over its soft level, waits within the maximum.
 *
 * Admission only READS the runtime's signals (`SignalSource.read`) and never touches a running game (the contract has no handle on one): the last test
 * says so with a source that offers nothing else. Running games' action times with a full queue are M13-15's run.
 */
import { describe, expect, it } from 'vitest';
import { CapacityAdmission, startRequestFor, type AdmissionEvent, type SignalSource } from '../../src/admission';
import { MemoryMetrics } from '../../src/obs';
import { RuntimeSignals } from '../../src/runtime';
import { MIN, SEC } from './helpers';

const CAPACITY = 60;
const QUEUE_MAX = 50;
const WAIT_MAX = 5 * MIN;
const ARRIVALS_END = 1_500;
const SPIKE = { from: 600, to: 760 };

interface Game {
  units: number;
  endsAt: number;
}

interface Admitted {
  table: string;
  units: number;
  readyAt: number;
  fails: boolean;
}

interface Outcome {
  arrivals: number;
  immediate: number;
  queued: number;
  refused: Record<string, number>;
  expired: number;
  left: number;
  failedChecks: number;
  /** Admitted 3-player (4 units) and 4-player (5 units) pods. */
  pods3: number;
  pods4: number;
  maxQueue: number;
  maxUnitsInUse: number;
  /** Seconds in which starts waited although some units were free and the CPU was calm: the head was a pod that did not fit yet (nobody passes it). */
  blockedSteps: number;
  waits: number[];
  admissionOrder: number[];
  positionEvents: number;
  steps: number;
}

function simulate(): Outcome {
  const base = 10_000_000;
  let t = 0;
  let now = base;
  let running = 0;
  const signals = new RuntimeSignals({ runningUnits: () => running, workers: () => 1, outbound: () => 0.1 }, 20, () => now);
  const metrics = new MemoryMetrics();
  const adm = new CapacityAdmission({
    signals,
    metrics,
    limits: { capacityUnits: CAPACITY, queueMax: QUEUE_MAX, waitMaxMs: WAIT_MAX, perAddress: 2 },
  });

  const games: Game[] = [];
  /** How long each game lasts once it has begun. */
  const holds = new Map<string, number>();
  const checks: Admitted[] = [];
  const waiting = new Map<string, { units: number; index: number; since: number }>();
  const index = new Map<string, number>();
  const o: Outcome = {
    arrivals: 0, immediate: 0, queued: 0, refused: {}, expired: 0, left: 0, failedChecks: 0, pods3: 0, pods4: 0, maxQueue: 0, maxUnitsInUse: 0, blockedSteps: 0, waits: [],
    admissionOrder: [], positionEvents: 0, steps: 0,
  };
  let admittedCount = 0;
  let stepAdmissions = 0;

  const admitted = (table: string, units: number, source: string, immediate: boolean, since: number): void => {
    admittedCount++;
    stepAdmissions++;
    o.admissionOrder.push(index.get(table)!);
    if (immediate) o.immediate++;
    else o.queued++;
    if (units === 4) o.pods3++;
    else if (units === 5) o.pods4++;
    o.waits.push(now - since);
    // every tenth admitted start fails its ready check; the others confirm after 10 s (a table) or 5 s (a match)
    checks.push({ table, units, readyAt: now + (source === 'matched' ? 5 * SEC : 10 * SEC), fails: admittedCount % 10 === 0 });
  };

  const handle = (events: AdmissionEvent[]): void => {
    for (const e of events) {
      if (e.kind === 'admitted') {
        const w = waiting.get(e.table)!;
        waiting.delete(e.table);
        // a start admitted from the queue waited at most the maximum (the step removes the ones past it first)
        expect(now - w.since, e.table).toBeLessThanOrEqual(WAIT_MAX);
        admitted(e.table, w.units, e.table.endsWith('m') ? 'matched' : 'listed', false, w.since);
      } else if (e.kind === 'expired') {
        expect(waiting.delete(e.table), e.table).toBe(true);
        o.expired++;
      } else {
        o.positionEvents++;
        expect(waiting.has(e.table), e.table).toBe(true);
      }
    }
  };

  const arrive = (): void => {
    const kinds: { seats: 2 | 3 | 4; hold: number }[] = [];
    if (t % 2 === 0) kinds.push({ seats: 2, hold: 240 + (t % 7) * 30 });
    if (t % 31 === 7) kinds.push({ seats: 4, hold: 600 });
    if (t % 47 === 11) kinds.push({ seats: 3, hold: 500 });
    for (const k of kinds) {
      const matched = t % 3 === 0;
      const table = `g${o.arrivals}${matched ? 'm' : 'l'}`;
      index.set(table, o.arrivals);
      o.arrivals++;
      const req = startRequestFor({
        table, source: matched ? 'matched' : 'listed', seats: k.seats, sessions: Array.from({ length: k.seats }, (_, i) => `${table}:${i}`),
        addressKeys: [`a${o.arrivals % 60}`], since: now,
      });
      holds.set(table, k.hold * SEC);
      const before = adm.size().starts;
      const d = adm.request(req, now);
      if (d.kind === 'admitted') {
        // an admission at once only into an empty queue
        expect(before, table).toBe(0);
        admitted(table, req.units, req.source, true, now);
      } else if (d.kind === 'waiting') {
        waiting.set(table, { units: req.units, index: o.arrivals - 1, since: now });
        expect(d.position).toBe(adm.size().starts);
      } else {
        o.refused[d.reason] = (o.refused[d.reason] ?? 0) + 1;
        expect(d.retryAfterMs).toBeGreaterThanOrEqual(0);
      }
    }
  };

  for (t = 0; t < 6_000; t++) {
    o.steps++;
    stepAdmissions = 0;
    now = base + t * SEC;
    // the games' work: 4 ms of a worker per second per running unit, and a CPU spike (a hot minute) that fills the 30 s window
    signals.workerBusy(running * 4 + (t >= SPIKE.from && t < SPIKE.to ? 900 : 0));
    signals.actionTime(20);

    // ready checks that ran out: the game begins (the runtime counts it first, then admission is told), or the check failed
    for (let i = checks.length - 1; i >= 0; i--) {
      const c = checks[i]!;
      if (c.readyAt > now) continue;
      checks.splice(i, 1);
      if (c.fails) {
        o.failedChecks++;
        handle(adm.released(c.table, now));
      } else {
        running += c.units;
        games.push({ units: c.units, endsAt: now + holds.get(c.table)! });
        adm.begun(c.table, now);
      }
    }
    // games that ended free their units
    for (let i = games.length - 1; i >= 0; i--) {
      const g = games[i]!;
      if (g.endsAt > now) continue;
      games.splice(i, 1);
      running -= g.units;
      handle(adm.freed(g.units, now));
    }
    // players who give up: every 13th arrival leaves after two minutes of waiting
    for (const [table, w] of [...waiting]) {
      if (w.index % 13 === 0 && now - w.since >= 120 * SEC) {
        expect(adm.withdraw(table, now), table).toBe(true);
        waiting.delete(table);
        o.left++;
      }
    }
    if (t < ARRIVALS_END) arrive();
    handle(adm.tick(now));

    // the invariants of design 4.6, every second
    const size = adm.size();
    expect(size.starts, `t=${t}`).toBe(waiting.size);
    expect(size.units, `t=${t}`).toBe([...waiting.values()].reduce((n, w) => n + w.units, 0));
    expect(size.starts).toBeLessThanOrEqual(QUEUE_MAX);
    expect(running + size.reserved, `t=${t}`).toBeLessThanOrEqual(CAPACITY);
    o.maxQueue = Math.max(o.maxQueue, size.starts);
    o.maxUnitsInUse = Math.max(o.maxUnitsInUse, running + size.reserved);
    if (size.starts > 0 && running + size.reserved < CAPACITY && signals.read(now).cpu < 0.75) o.blockedSteps++;
    // nobody is admitted while the workers' CPU is over its soft level
    if (stepAdmissions > 0) expect(signals.read(now).cpu, `t=${t}`).toBeLessThan(0.75);

    if (t >= ARRIVALS_END && waiting.size === 0 && games.length === 0 && checks.length === 0) break;
  }
  // everything resolved, and the accounting adds up
  expect(adm.size()).toEqual({ starts: 0, units: 0, reserved: 0 });
  expect(running).toBe(0);
  const refused = Object.values(o.refused).reduce((n, x) => n + x, 0);
  expect(o.immediate + o.queued + refused + o.expired + o.left).toBe(o.arrivals);
  expect(adm.stats()).toMatchObject({ admitted: o.immediate + o.queued, immediate: o.immediate, left: o.left, expired: o.expired, released: o.failedChecks });
  return o;
}

describe('M13-10: simulated load (fake clock, the runtime\'s own signals, fixed arrivals)', () => {
  /** The run is made once, by the first test that asks (an invariant that fails inside it fails that test). */
  let run: Outcome | undefined;
  const outcome = (): Outcome => (run ??= simulate());

  it('holds every invariant of design 4.6 through a long run far above capacity (checked every second inside the run)', () => {
    const o = outcome();
    expect(o.arrivals).toBeGreaterThan(800);
    expect(o.steps).toBeGreaterThan(ARRIVALS_END);
    // the queue filled to its limit, and the units were used up to the capacity
    expect(o.maxQueue).toBe(QUEUE_MAX);
    expect(o.maxUnitsInUse).toBeGreaterThan(CAPACITY - 6);
    expect(o.maxUnitsInUse).toBeLessThanOrEqual(CAPACITY);
  });

  it('strict FIFO: starts are admitted in the order they arrived, at once or after waiting', () => {
    const o = outcome();
    expect(o.admissionOrder.length).toBe(o.immediate + o.queued);
    for (let i = 1; i < o.admissionOrder.length; i++) expect(o.admissionOrder[i]!, `admission ${i}`).toBeGreaterThan(o.admissionOrder[i - 1]!);
  });

  it('everything above capacity is queued, refused (serverBusy) or expires: the hard limits did their work, and some of every kind happened', () => {
    const o = outcome();
    expect(o.queued).toBeGreaterThan(50);
    expect(o.immediate).toBeGreaterThan(5);
    expect(o.refused['queueFull'] ?? 0).toBeGreaterThan(100);
    expect(o.refused['address'] ?? 0).toBeGreaterThan(0);
    expect(o.expired).toBeGreaterThan(5);
    expect(o.left).toBeGreaterThan(3);
    expect(o.failedChecks).toBeGreaterThan(5);
    expect(o.positionEvents).toBeGreaterThan(100);
  });

  it('pods are not starved by the stream of 1v1 games: both sizes of pod were admitted from the queue', () => {
    const o = outcome();
    // the head was a pod waiting for units to free while free units went unused: that is what FIFO in units costs, and what keeps pods from starving
    expect(o.blockedSteps).toBeGreaterThan(50);
    expect(o.pods3).toBeGreaterThan(3);
    expect(o.pods4).toBeGreaterThan(3);
  });

  it('waits stay within the maximum, and some waits were long', () => {
    const o = outcome();
    expect(Math.max(...o.waits)).toBeLessThanOrEqual(WAIT_MAX);
    expect(o.waits.filter((w) => w >= 2 * MIN).length).toBeGreaterThan(5);
  });
});

describe('M13-10: admission only observes', () => {
  it('reads the signal source and calls nothing else on it: running games are never slowed, paused or queued', () => {
    const calls: string[] = [];
    const source: SignalSource = {
      read: (now) => {
        calls.push(`read@${now}`);
        return { runningUnits: 95, cpu: 0.4, p95ActionMs: 40, workerHeap: 0.3, outbound: 0.1 };
      },
    };
    const proxy = new Proxy(source, {
      get(target, key) {
        if (key !== 'read') calls.push(`touched:${String(key)}`);
        return Reflect.get(target, key);
      },
    });
    const adm = new CapacityAdmission({ signals: proxy, limits: { capacityUnits: 100 } });
    const req = (table: string, seats: 2 | 4) => startRequestFor({ table, source: 'listed', seats, sessions: [`s${table}`], addressKeys: [`k${table}`], since: 0 });
    adm.request(req('pod', 4), 0); // 95 + 5 fits: admitted
    adm.request(req('pod2', 4), 0); // waits
    adm.request(req('solo', 2), 0);
    adm.tick(1_000);
    adm.freed(5, 2_000);
    adm.begun('pod', 3_000);
    adm.released('pod2', 4_000);
    adm.withdraw('solo', 5_000);
    adm.drain();
    adm.tick(6_000);
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((c) => c.startsWith('read@'))).toBe(true);
  });
});
