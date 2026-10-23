/**
 * RPL-0 review (replays design 8): a replay shows each perspective an action's events minus the ones it was given already. Answering a decision runs
 * the suspended action again from its start, so its events begin with the ones of the stop (`Suspension.emitted`). The recipe, for a seat, the public
 * view and the open view alike: `eventsFor(next, events.slice(replayedEventsFor(prev, action, viewer, { open })), viewer, { before: prev, open })`.
 *
 * Over seeded bot games: for every action and its answers (one action of the log, from a settled state to the next), each perspective is given each
 * event of the action exactly once (CR 733.1: a viewer from whom another player's cancellable action was hidden is given it all when it is settled).
 */
import { describe, expect, it } from 'vitest';
import { eventsFor, hiddenActionInProgress, replayedEvents, replayedEventsFor, type GameState, type PlayerId } from '../../src/index';
import { botGame, discardConfig, faceDownConfig, type PlayedGame } from './games';

type Perspective = PlayerId | null | 'open';
const PERSPECTIVES: Perspective[] = ['p1', 'p2', null, 'open'];

/** How many of `events` (the action's batch) the perspective is given after the change, and whether the change was hidden from it. */
function given(prev: GameState, next: GameState, g: PlayedGame, i: number, p: Perspective, recipe: typeof replayedEventsFor): { count: number; hidden: boolean } {
  const open = p === 'open';
  const viewer = open ? null : p;
  const raw = g.events[i]!;
  const fresh = raw.slice(recipe(prev, g.actions[i]!, viewer, { open }));
  const hidden = !open && hiddenActionInProgress(next, viewer);
  const shown = eventsFor(next, fresh, viewer, { before: prev, open });
  expect(shown.length === fresh.length || hidden).toBe(true); // eventsFor drops events only while a cancellable action is hidden
  return { count: hidden ? 0 : fresh.length, hidden };
}

/** For each perspective, the actions whose events it was given a different number of times than they happened (chains it saw part of are left out). */
function mismatches(g: PlayedGame, recipe: typeof replayedEventsFor): { checked: number; wrong: string[] } {
  const wrong: string[] = [];
  let checked = 0;
  for (const p of PERSPECTIVES) {
    let total = 0;
    let hiddenStops = 0;
    let shownStops = 0;
    let start = 0;
    for (let i = 0; i < g.actions.length; i++) {
      const prev = g.states[i]!;
      const next = g.states[i + 1]!;
      if (prev.suspended === null) {
        total = 0;
        hiddenStops = 0;
        shownStops = 0;
        start = i;
      }
      const r = given(prev, next, g, i, p, recipe);
      total += r.count;
      if (next.suspended !== null) {
        if (r.hidden) hiddenStops++;
        else shownStops++;
        continue;
      }
      // Settled: the last run's events are every event of the action. A perspective hidden from some stops but shown others is the documented case
      // where only the newest stop is known (core/apply.ts#replayedEvents); it is left out. So is an action cancelled or conceded in the middle (CR 733.1,
      // 104.3a): what its stops showed is taken back with the state, not given again.
      if (hiddenStops > 0 && shownStops > 0) continue;
      if (i > start && (g.actions[i]!.type === 'cancel' || g.actions[i]!.type === 'concede')) continue;
      if (i > start) checked++;
      if (total !== g.events[i]!.length) wrong.push(`${g.config.seed} ${String(p)} actions ${start}-${i}: given ${total} of ${g.events[i]!.length}`);
    }
  }
  return { checked, wrong };
}

describe('RPL-0 review: the events a replay shows each perspective (replays design 8)', { timeout: 300_000 }, () => {
  const games = (): PlayedGame[] => [botGame(discardConfig('rpl0-rv-disc-a'), 600), botGame(faceDownConfig('rpl0-rv-fd-a'), 600)];

  it('every perspective, the open view among them, is given each event of an action once, its answers included', () => {
    let checked = 0;
    for (const g of games()) {
      const r = mismatches(g, replayedEventsFor);
      expect(r.wrong).toEqual([]);
      checked += r.checked;
    }
    expect(checked).toBeGreaterThan(20); // actions with answers, each seen through by every perspective
  });

  it('the public view\'s count would show the open view a stop\'s events twice (the review\'s case), and seats and the public view keep replayedEvents', () => {
    const publicCount: typeof replayedEventsFor = (prev, action, viewer) => replayedEvents(prev, action, viewer);
    const twice = games().flatMap((g) => mismatches(g, publicCount).wrong).filter((w) => / open /.test(w));
    expect(twice.length).toBeGreaterThan(0);
    for (const g of games()) {
      for (let i = 0; i < g.actions.length; i++) {
        for (const p of ['p1', 'p2', null] as const) expect(replayedEventsFor(g.states[i]!, g.actions[i]!, p)).toBe(replayedEvents(g.states[i]!, g.actions[i]!, p));
      }
    }
  });
});
