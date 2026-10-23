/**
 * RPL-2 (replays design 8, "Pacing"): how fast a replay plays. A replay is shown through the live game's `PacedConnection` and board animator; its speed
 * sets the animator's time base and the pause the replay clock makes after each change (the dwell).
 *
 * | Speed      | Animator base (normal setting) | What happens                                                                          |
 * |------------|--------------------------------|---------------------------------------------------------------------------------------|
 * | 0.25, 0.5  | 4, 2                           | animated, slower than live                                                            |
 * | 1          | 1                              | as live, stack acceleration as live                                                   |
 * | 2, 4       | 0.5, 0.25                      | animated; a big stack still speeds up, down to the animator's floor (0.2)             |
 * | 8, 16      | below the floor                | condensed: each change is shown without animation, with the condensed sounds         |
 * | real time  | 1                              | the players' own pauses between actions, each capped at 3 s (design 15.5, 16.5)       |
 *
 * The player's Animation speed setting multiplies in (slow is 1.7 times longer at every replay speed); Animation speed Off, or reduced motion, makes
 * every speed condensed. Sounds play as in a live game; above 4x they are muted by default, which the viewer can turn off.
 */

export type ReplaySpeed = 0.25 | 0.5 | 1 | 2 | 4 | 8 | 16 | 'real';

/** The speeds offered, slowest first; `'real'` (the players' own pace) last. */
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [0.25, 0.5, 1, 2, 4, 8, 16, 'real'];

/** The fastest speed that is still animated; faster ones are condensed. */
export const ANIMATED_MAX_SPEED = 4;

/** The longest pause real time keeps between two actions (ms): a player who thought for a minute is not waited for a minute. */
export const REAL_TIME_CAP_MS = 3000;

/** What a change was, for the pause after it: a pass that only moves to the next step, any other decision or action, or a new turn. */
export type ChangeKind = 'pass' | 'decision' | 'turn';

/** The pause after a change at 1x (ms, design 8): about 400 ms after a pass, 700 ms after a decision, 1,000 ms at a turn start. */
export const DWELL_MS: Readonly<Record<ChangeKind, number>> = { pass: 400, decision: 700, turn: 1000 };

/** How many times faster than live a speed plays (real time plays as live). */
export function speedFactor(speed: ReplaySpeed): number {
  return speed === 'real' ? 1 : speed;
}

/** True when a speed is too fast to animate readably: each change is shown at once (design 8, "condensed"). */
export function isCondensed(speed: ReplaySpeed): boolean {
  return speedFactor(speed) > ANIMATED_MAX_SPEED;
}

/** Sounds are muted by default above 4x (design 8). */
export function mutedByDefault(speed: ReplaySpeed): boolean {
  return isCondensed(speed);
}

/**
 * The board animator's time base for a speed: the inverse of the speed times the player's Animation speed scale (`settingScale`: fast 0.6, normal 1,
 * slow 1.7; null when animations are off or the player prefers reduced motion). Null means condensed: nothing is animated, every change is shown at once.
 * The animator applies its own floor (0.2) and stack acceleration on top (board/fx/Animator.ts).
 */
export function animatorBase(speed: ReplaySpeed, settingScale: number | null): number | null {
  if (settingScale === null || isCondensed(speed)) return null;
  return settingScale / speedFactor(speed);
}

/**
 * The pause after a change before the next one starts (ms): the dwell of its kind divided by the speed, or in real time the gap between the two actions'
 * times in the file, capped at `REAL_TIME_CAP_MS` (and the dwell when the file has no gap to give).
 */
export function dwellMs(kind: ChangeKind, speed: ReplaySpeed, gapMs?: number): number {
  if (speed === 'real') {
    const gap = gapMs !== undefined && Number.isFinite(gapMs) ? gapMs : DWELL_MS[kind];
    return Math.min(REAL_TIME_CAP_MS, Math.max(0, gap));
  }
  return DWELL_MS[kind] / speed;
}

/** "0.25×", "1×", "16×", "Real time". */
export function speedLabel(speed: ReplaySpeed): string {
  return speed === 'real' ? 'Real time' : `${speed}×`;
}

const FACTORS = REPLAY_SPEEDS.filter((s): s is Exclude<ReplaySpeed, 'real'> => s !== 'real');

/** The next speed up or down the scale (the `[` and `]` keys), staying at the ends; real time counts as 1x. */
export function nextSpeed(speed: ReplaySpeed, direction: 1 | -1): ReplaySpeed {
  const i = FACTORS.indexOf(speed === 'real' ? 1 : speed);
  return FACTORS[Math.min(FACTORS.length - 1, Math.max(0, i + direction))]!;
}
