/**
 * RPL-2 (replays design 8, "Pacing"): the replay speeds, the board animator's time base each one sets (the design's table), the condensed speeds above
 * 4x and their muted sounds, the dwell after each kind of change, and real time with its pauses capped at 3 s.
 */
import { describe, expect, it } from 'vitest';
import {
  animatorBase, DWELL_MS, dwellMs, isCondensed, mutedByDefault, nextSpeed, REAL_TIME_CAP_MS, REPLAY_SPEEDS, speedLabel, type ReplaySpeed,
} from '../../../src/replays/viewer/pacing';

describe('RPL-2: replay speeds (replays design 8)', () => {
  it('the speeds offered are 0.25x to 16x and real time', () => {
    expect(REPLAY_SPEEDS).toEqual([0.25, 0.5, 1, 2, 4, 8, 16, 'real']);
    expect(REPLAY_SPEEDS.map(speedLabel)).toEqual(['0.25×', '0.5×', '1×', '2×', '4×', '8×', '16×', 'Real time']);
  });

  it('each speed maps to the animator base of the design\'s table at the normal setting; 8x and 16x are condensed', () => {
    const table: [ReplaySpeed, number | null][] = [[0.25, 4], [0.5, 2], [1, 1], [2, 0.5], [4, 0.25], [8, null], [16, null], ['real', 1]];
    for (const [speed, base] of table) {
      expect(animatorBase(speed, 1), String(speed)).toBe(base);
      expect(isCondensed(speed), String(speed)).toBe(base === null);
    }
  });

  it('the player\'s Animation speed multiplies in; Off or reduced motion makes every speed condensed', () => {
    expect(animatorBase(1, 1.7)).toBeCloseTo(1.7);
    expect(animatorBase(0.25, 1.7)).toBeCloseTo(6.8);
    expect(animatorBase(2, 0.6)).toBeCloseTo(0.3);
    // 4x at the fast setting is below the animator's own floor (0.2): the animator holds it there (board/fx/Animator.ts), it is still animated.
    expect(animatorBase(4, 0.6)).toBeCloseTo(0.15);
    for (const speed of REPLAY_SPEEDS) expect(animatorBase(speed, null)).toBeNull();
  });

  it('sounds are muted by default above 4x only', () => {
    expect(REPLAY_SPEEDS.filter(mutedByDefault)).toEqual([8, 16]);
  });

  it('the dwell after a change is 400 ms after a pass, 700 ms after a decision, 1,000 ms at a turn start, divided by the speed', () => {
    expect(DWELL_MS).toEqual({ pass: 400, decision: 700, turn: 1000 });
    expect(dwellMs('pass', 1)).toBe(400);
    expect(dwellMs('decision', 2)).toBe(350);
    expect(dwellMs('turn', 0.25)).toBe(4000);
    expect(dwellMs('turn', 16)).toBe(62.5);
  });

  it('real time waits the players\' own pause between two actions, capped at 3 s', () => {
    expect(REAL_TIME_CAP_MS).toBe(3000);
    expect(dwellMs('pass', 'real', 1200)).toBe(1200);
    expect(dwellMs('decision', 'real', 45_000)).toBe(3000);
    expect(dwellMs('decision', 'real', -5)).toBe(0);
    expect(dwellMs('turn', 'real')).toBe(1000);
  });

  it('[ and ] step through the speeds and stop at the ends; real time counts as 1x', () => {
    expect(nextSpeed(1, 1)).toBe(2);
    expect(nextSpeed(16, 1)).toBe(16);
    expect(nextSpeed(0.25, -1)).toBe(0.25);
    expect(nextSpeed('real', 1)).toBe(2);
    expect(nextSpeed('real', -1)).toBe(0.5);
  });
});
