/**
 * M15-6 (slow suite): waits by population (17.11: "with 50 players online the median 1v1 wait is under 30 s") and the matcher's tick with 2,000
 * entries (17.11: "under 50 ms on the owner's machine, reported, not asserted in the default suite"). The tick's time depends on the machine and its
 * load, so here only the 1v1 tick is held to 50 ms and the pod tick to a loose guard; docs/perf/m15-ladder-sim.md reports both.
 */
import { expect, it } from 'vitest';
import { describeSlow } from '../../../engine/test/slow';
import { TARGETS, waitsByPopulation } from './measure';
import { timeTick } from './tick';

describeSlow('M15-6: waits by population and the matcher\'s tick', () => {
  it('1v1: with 50 players online the median wait is under 30 s; more players, shorter waits and closer games', async () => {
    const [fifty, two] = await waitsByPopulation('1v1-standard', [50, 200], { days: 2 });
    expect(fifty!.matches).toBeGreaterThan(1000);
    expect(fifty!.median).toBeLessThan(TARGETS.wait50Ms);
    expect(two!.median).toBeLessThan(fifty!.median);
    expect(two!.spread).toBeLessThan(fifty!.spread);
  }, 300_000);

  it('pods: waits shrink as the population grows, and pods of 3 with it', async () => {
    const [few, many] = await waitsByPopulation('pod-commander', [20, 200], { days: 2 });
    expect(many!.median).toBeLessThan(few!.median);
    expect(many!.threes).toBeLessThan(few!.threes);
  }, 300_000);

  it('the tick with 2,000 entries: 1v1 under 50 ms here; pods measured', () => {
    const one = timeTick('1v1-standard', 'queue', 2000, 5);
    const stuck = timeTick('1v1-standard', 'stuck', 2000, 5);
    expect(one.matches).toBe(999);
    expect(stuck.matches).toBe(0);
    expect(one.medianMs).toBeLessThan(TARGETS.tickMs);
    expect(stuck.medianMs).toBeLessThan(TARGETS.tickMs);
    const pod = timeTick('pod-commander', 'queue', 2000, 3);
    const podStuck = timeTick('pod-commander', 'stuck', 2000, 3);
    expect(pod.matches).toBeGreaterThan(450);
    expect(podStuck.matches).toBe(0);
    // O(n · 220): about 0.05 ms an entry; a guard against a change that makes it quadratic, not the 50 ms target
    expect(Math.max(pod.medianMs, podStuck.medianMs)).toBeLessThan(1000);
  }, 120_000);
});
