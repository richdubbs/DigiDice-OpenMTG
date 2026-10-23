/**
 * Design 4.3, amended by WP30: `GameState.history` is shared between states like `log` and `lki` (only the array is copied, util/clone.ts), because it grows
 * for the whole game ("this game", CR 603.4) and deep-cloning it on every action made long games slower and slower. That is safe only if an entry is never
 * edited after it is written: an edit would change every earlier state and the replay (design 4.3 hazards 3 and 4 guard lki and the log the same way). Entries
 * are therefore frozen when they are recorded (triggers/history.ts#recordHistory).
 */
import { describe, expect, it } from 'vitest';
import type { GameState, HistoryEntry } from '../../../src/index';
import { cloneState } from '../../../src/util/clone';
import { castAuto, scenario } from '../helpers';

/** Cast Grizzly Bears (a cast and a zone change are recorded); returns the state and the entries the action wrote. */
function cast(): { next: GameState; written: HistoryEntry[] } {
  const s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
  const next = castAuto(s, 'Grizzly Bears');
  return { next, written: next.history.slice(s.history.length) };
}

describe('design 4.3 (WP30 amendment): history entries are written once, shared and frozen', () => {
  it('every recorded entry is frozen, facts included, and a copy shares the entries', () => {
    const { next, written } = cast();
    expect(written.length).toBeGreaterThan(0);
    for (const e of written) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(Object.isFrozen(e.facts)).toBe(true);
    }
    const copy = cloneState(next);
    expect(copy.history).not.toBe(next.history);
    expect(copy.history.every((e, i) => e === next.history[i])).toBe(true);
  });

  it('editing an entry in place is impossible, so no earlier state can change through a shared entry', () => {
    const e = cast().written[0]!;
    expect(() => { (e as { turn: number }).turn = 99; }).toThrow(TypeError);
    expect(() => { (e.facts as Record<string, unknown>)['x'] = 1; }).toThrow(TypeError);
  });
});
