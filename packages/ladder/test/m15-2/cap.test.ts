/**
 * M15-2: the cap rule (design 8.5, D11, 17.4): capShareThreshold and every capVerdict example of 8.5, including the forced-answer flood (equal raw
 * actions, one seat at 0 ms per decision and the other at 1-3 s: the slow seat is never the driver), the slow flood at the time cap, slow answers on
 * purpose, a tie for the top share, a total of 0 and an empty game. Each cap is judged by its own measure only.
 *
 * The flood cases are scripted decisions with fixed inputs (no traffic of any kind), counted by `clockAtCap` below: a test-only model of 8.5's
 * counting rule, which M15-8 builds into the hosted table clock (`initiated`, `chargedMs`). It also counts the two measures 8.5 rejected (m13's raw
 * actions and raw decision time, and own bank time beyond the free delay without the answers) so the cases pin why they were rejected.
 */
import { describe, expect, it } from 'vitest';
import { capShareThreshold, capVerdict, type CapSeat, type SeatNo } from '@openmtg/ladder/api';
import { near } from './helpers';

const MIN = 60_000;
const FREE_MS = 5_000;

/**
 * One decision at the table. `initiate`: a cast, activated ability, special action or accepted cancel the seat made on its own. `own`: any other
 * decision of its own (in its own turn, or a choice of its own spell). `answer`: a decision forced by seat `to`'s object (a pass or response with
 * that object on top, a choice it asks for, blockers in its attack).
 */
type Decision = { seat: SeatNo; ms: number; kind: 'initiate' | 'own' } | { seat: SeatNo; ms: number; kind: 'answer'; to: SeatNo };

/** 8.5's counting, per seat in `seats` order: the cap measures, and the two rejected ones. */
function clockAtCap(seats: readonly SeatNo[], decisions: readonly Decision[]) {
  const at = (s: SeatNo) => seats.indexOf(s);
  const cap: CapSeat[] = seats.map((seat) => ({ seat, initiated: 0, chargedMs: 0 }));
  const rawActions = seats.map(() => 0);
  const rawMs = seats.map(() => 0);
  const ownBankBeyondFree = seats.map(() => 0);
  for (const d of decisions) {
    const i = at(d.seat);
    rawActions[i]! += 1;
    rawMs[i]! += d.ms;
    if (d.kind === 'answer') {
      const forced = Math.min(d.ms, FREE_MS);
      cap[at(d.to)]!.chargedMs += forced; // the answer's time up to the free delay is the forcing seat's
      cap[i]!.chargedMs += d.ms - forced; // bank beyond it stays the answerer's (it chose to think)
    } else {
      if (d.kind === 'initiate') cap[i]!.initiated += 1;
      cap[i]!.chargedMs += d.ms;
      ownBankBeyondFree[i]! += Math.max(0, d.ms - FREE_MS);
    }
  }
  const asCap = (xs: number[]): CapSeat[] => seats.map((seat, i) => ({ seat, initiated: xs[i]!, chargedMs: xs[i]! }));
  return { cap, rawActions: asCap(rawActions), rawMs: asCap(rawMs), ownBankBeyondFree: asCap(ownBankBeyondFree) };
}

const repeat = <T>(n: number, f: (k: number) => T): T[] => Array.from({ length: n }, (_, k) => f(k));
const seats2 = (a: number, b: number): CapSeat[] => [{ seat: 1, initiated: a, chargedMs: a }, { seat: 2, initiated: b, chargedMs: b }];
const pod = (...m: number[]): CapSeat[] => m.map((x, i) => ({ seat: (i + 1) as SeatNo, initiated: x, chargedMs: x }));

describe('M15-2: the cap threshold (8.5)', () => {
  it('1/n + 0.25: 1v1 0.75, 3 players 0.583, 4 players 0.5', () => {
    expect(capShareThreshold(2)).toBe(0.75);
    near(capShareThreshold(3), 0.5833, 0.0001, '3 players');
    expect(capShareThreshold(4)).toBe(0.5);
    expect(capShareThreshold(1)).toBe(1.25);
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => capShareThreshold(bad), String(bad)).toThrow(RangeError);
  });
});

describe('M15-2: capVerdict, the examples of 8.5', () => {
  it('1v1, action cap: initiated 1,700 / 400 makes seat 1 the driver (0.810); 1,200 / 900 is void (0.571)', () => {
    const v = capVerdict('actions', seats2(1700, 400));
    expect(v.kind === 'driver' && v.seat).toBe(1);
    near(v.kind === 'driver' ? v.share : 0, 0.81, 0.0005, 'share');
    expect(capVerdict('actions', seats2(1200, 900))).toEqual({ kind: 'void' });
  });

  it('1v1, time cap: charged 90 / 30 minutes makes seat 1 the driver (0.75, inclusive); 70 / 50 is void (0.583)', () => {
    expect(capVerdict('time', seats2(90 * MIN, 30 * MIN))).toEqual({ kind: 'driver', seat: 1, share: 0.75 });
    expect(capVerdict('time', seats2(70 * MIN, 50 * MIN))).toEqual({ kind: 'void' });
    expect(capVerdict('time', seats2(30 * MIN, 90 * MIN))).toEqual({ kind: 'driver', seat: 2, share: 0.75 });
  });

  it('forced-answer flood at the action cap: equal raw actions, but initiated 1,990 / 10: seat 1 drives (0.995); the slow honest seat never does', () => {
    // Seat 1 scripts 1,990 cheap stack objects at 0 ms each; seat 2 answers every one in 1-3 s and initiates 10 actions of its own (4 s each),
    // which seat 1 answers at once.
    const script: Decision[] = [
      ...repeat(1990, (k): Decision[] => [{ seat: 1, ms: 0, kind: 'initiate' }, { seat: 2, ms: 1000 * (1 + (k % 3)), kind: 'answer', to: 1 }]).flat(),
      ...repeat(10, (): Decision[] => [{ seat: 2, ms: 4000, kind: 'initiate' }, { seat: 1, ms: 0, kind: 'answer', to: 2 }]).flat(),
    ];
    const clock = clockAtCap([1, 2], script);
    expect(clock.rawActions.map((s) => s.initiated), "m13's raw actions").toEqual([2000, 2000]);
    expect(clock.rawMs[1]!.chargedMs, 'raw decision time favours seat 2 heavily').toBeGreaterThan(100 * clock.rawMs[0]!.chargedMs);
    expect(clock.cap.map((s) => s.initiated)).toEqual([1990, 10]);
    expect(capVerdict('actions', clock.cap)).toEqual({ kind: 'driver', seat: 1, share: 0.995 });
    // the rejected measures: raw actions tie (void), raw decision time would give the game to the slow, honest seat 2
    expect(capVerdict('actions', clock.rawActions)).toEqual({ kind: 'void' });
    expect(capVerdict('time', clock.rawMs)).toMatchObject({ kind: 'driver', seat: 2 });
    // had the flood reached the time cap instead, the answers' time is charged to the seat that forced them: seat 1 again
    expect(clock.cap.map((s) => s.chargedMs)).toEqual([3_979_000, 40_000]);
    expect(capVerdict('time', clock.cap)).toMatchObject({ kind: 'driver', seat: 1 });
  });

  it('slow flood, time cap first: charged 110 / 10 minutes makes seat 1 the driver (0.917); both rejected rules are pinned', () => {
    // Seat 1 casts 1,200 objects using 4 s of free delay each (80 minutes, no bank); seat 2 answers each in 1.5 s (30 minutes, charged to seat 1)
    // and spends 10 minutes on its own turns (20 decisions of 30 s: 5 s free and 25 s bank).
    const script: Decision[] = [
      ...repeat(1200, (): Decision[] => [{ seat: 1, ms: 4000, kind: 'initiate' }, { seat: 2, ms: 1500, kind: 'answer', to: 1 }]).flat(),
      ...repeat(20, (): Decision => ({ seat: 2, ms: 30_000, kind: 'own' })),
    ];
    const clock = clockAtCap([1, 2], script);
    expect(clock.cap.map((s) => s.chargedMs)).toEqual([110 * MIN, 10 * MIN]);
    const v = capVerdict('time', clock.cap);
    expect(v.kind === 'driver' && v.seat).toBe(1);
    near(v.kind === 'driver' ? v.share : 0, 0.917, 0.0005, 'share');
    // raw decision time (80 / 40 minutes, 0.667) would void the game
    expect(clock.rawMs.map((s) => s.chargedMs)).toEqual([80 * MIN, 40 * MIN]);
    expect(capVerdict('time', clock.rawMs)).toEqual({ kind: 'void' });
    // only bank time beyond the free delay, without the answers, would make seat 2 the only seat with any time, and the driver
    expect(clock.ownBankBeyondFree.map((s) => s.chargedMs)).toEqual([0, 500_000]);
    expect(capVerdict('time', clock.ownBankBeyondFree)).toEqual({ kind: 'driver', seat: 2, share: 1 });
  });

  it('slow answers on purpose: seat 2 answers each of 100 objects in 30 s; seat 1 is charged 100 × 5 s (8.3 minutes), seat 2 keeps 41.7', () => {
    const script: Decision[] = repeat(100, (): Decision[] => [{ seat: 1, ms: 2000, kind: 'initiate' }, { seat: 2, ms: 30_000, kind: 'answer', to: 1 }]).flat();
    const clock = clockAtCap([1, 2], script);
    const forcedOnSeat1 = clock.cap[0]!.chargedMs - 100 * 2000;
    expect(forcedOnSeat1).toBe(500_000);
    near(forcedOnSeat1 / MIN, 8.3, 0.05, 'minutes charged to seat 1 for the answers');
    near(clock.cap[1]!.chargedMs / MIN, 41.7, 0.05, 'minutes seat 2 keeps');
    // so the slow answerer cannot make the other seat the driver; its own bank counts against it
    expect(capVerdict('time', clock.cap)).toEqual({ kind: 'driver', seat: 2, share: 2_500_000 / 3_200_000 });
  });

  it('a pod of 4 still in: initiated 1,500 / 400 / 300 / 300 makes seat 1 the driver (0.6 ≥ 0.5)', () => {
    expect(capVerdict('actions', pod(1500, 400, 300, 300))).toEqual({ kind: 'driver', seat: 1, share: 0.6 });
  });

  it('a pod of 4 at the time cap (240 minutes): charged 120 / 50 / 40 / 30 makes seat 1 the driver (0.5, inclusive); 100 / 60 / 50 / 30 is void (0.417)', () => {
    expect(capVerdict('time', pod(120 * MIN, 50 * MIN, 40 * MIN, 30 * MIN))).toEqual({ kind: 'driver', seat: 1, share: 0.5 });
    expect(capVerdict('time', pod(100 * MIN, 60 * MIN, 50 * MIN, 30 * MIN))).toEqual({ kind: 'void' });
  });

  it('a pod with one player out earlier: n = 3 and the threshold 0.583, inclusive exactly (7 of 12)', () => {
    const inGame: CapSeat[] = [{ seat: 1, initiated: 7, chargedMs: 0 }, { seat: 2, initiated: 3, chargedMs: 0 }, { seat: 4, initiated: 2, chargedMs: 0 }];
    expect(capVerdict('actions', inGame)).toEqual({ kind: 'driver', seat: 1, share: 7 / 12 });
    const under: CapSeat[] = [{ seat: 1, initiated: 699, chargedMs: 0 }, { seat: 2, initiated: 301, chargedMs: 0 }, { seat: 4, initiated: 200, chargedMs: 0 }];
    expect(capVerdict('actions', under)).toEqual({ kind: 'void' });
    // the driver is named by its seat number, whatever the order of the list
    expect(capVerdict('actions', [inGame[2]!, inGame[0]!, inGame[1]!])).toEqual({ kind: 'driver', seat: 1, share: 7 / 12 });
  });

  it('two seats sharing the top share is void (a pod of 4 with initiated 1,000 / 1,000 / 0 / 0); a total of 0 and an empty game are void', () => {
    expect(capVerdict('actions', pod(1000, 1000, 0, 0))).toEqual({ kind: 'void' });
    expect(capVerdict('time', seats2(60 * MIN, 60 * MIN))).toEqual({ kind: 'void' });
    expect(capVerdict('actions', pod(0, 0, 0, 0))).toEqual({ kind: 'void' });
    expect(capVerdict('time', seats2(0, 0))).toEqual({ kind: 'void' });
    expect(capVerdict('actions', [])).toEqual({ kind: 'void' });
    expect(capVerdict('time', [])).toEqual({ kind: 'void' });
  });

  it('each cap by its own measure only: the other measure never changes the verdict', () => {
    const actions: CapSeat[] = [{ seat: 1, initiated: 1700, chargedMs: 0 }, { seat: 2, initiated: 400, chargedMs: 999 * MIN }];
    expect(capVerdict('actions', actions)).toMatchObject({ kind: 'driver', seat: 1 });
    expect(capVerdict('time', actions)).toMatchObject({ kind: 'driver', seat: 2, share: 1 });
    const time: CapSeat[] = [{ seat: 1, initiated: 5000, chargedMs: 90 * MIN }, { seat: 2, initiated: 0, chargedMs: 30 * MIN }];
    expect(capVerdict('time', time)).toEqual({ kind: 'driver', seat: 1, share: 0.75 });
    expect(capVerdict('time', [{ ...time[0]!, initiated: 0 }, { ...time[1]!, initiated: 5000 }])).toEqual({ kind: 'driver', seat: 1, share: 0.75 });
  });

  it('refuses an unknown cap, a seat outside 1-4 or repeated, and a measure that is not a finite number of at least 0', () => {
    expect(() => capVerdict('size' as 'time', seats2(1, 2))).toThrow(RangeError);
    expect(() => capVerdict('actions', [{ seat: 1, initiated: 1, chargedMs: 0 }, { seat: 1, initiated: 2, chargedMs: 0 }])).toThrow(RangeError);
    expect(() => capVerdict('actions', [{ seat: 5 as SeatNo, initiated: 1, chargedMs: 0 }])).toThrow(RangeError);
    expect(() => capVerdict('actions', seats2(-1, 2))).toThrow(RangeError);
    expect(() => capVerdict('time', seats2(Number.NaN, 2))).toThrow(RangeError);
    expect(() => capVerdict('time', seats2(Infinity, 2))).toThrow(RangeError);
  });
});
