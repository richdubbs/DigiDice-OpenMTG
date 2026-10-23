/**
 * RPL-2 (replays design 5.2, 5.3): a replay never plays wrong, against a test-only engine change. The engine's `gameDigest` is replaced, for this file
 * only, by one that differs from turn 4 on: the build that plays a game differently from there. The replay files are made with the real digest (the
 * engine's own `checkpointsOf`), so the check finds the first checkpoint of turn 4 differing.
 *  - Under another build: the replay plays exactly up to the last checkpoint that matches, then its recording takes over ("Recording from turn 3"), or
 *    without a recording it stops there ("You can watch it up to turn 3").
 *  - Under the same build (exact by construction, checked in the background): the difference is an engine bug; the recording takes over from there too,
 *    at once, even where the viewer already is.
 */
import { viewFor, type GameState } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { createReplayConnection } from '../../src/connection/ReplayConnection';
import { OPEN, seat } from '../../src/replays/viewer/policy';
import { aiGame, replayFileOf, TEST_BUILD } from './replay-files';

const change = vi.hoisted(() => ({ fromTurn: 4 }));

vi.mock('@openmtg/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@openmtg/engine')>();
  return { ...real, gameDigest: (s: GameState) => (s.turn.number >= change.fromTurn ? `d1:${'0'.repeat(32)}` : real.gameDigest(s)) };
});

const json = (x: unknown): string => JSON.stringify(x);
const OTHER_BUILD = 'e'.repeat(64);

/** The position of the last recorded checkpoint before turn 4: where the replay is exact up to. */
function lastGood(file: ReturnType<typeof replayFileOf>): number {
  const cps = file.play!.checkpoints;
  const bad = cps.findIndex((c) => c.turn >= change.fromTurn);
  expect(bad).toBeGreaterThan(0);
  return cps[bad - 1]!.action + 1;
}

describe('RPL-2: a replay against an engine that plays it differently (replays design 5)', { timeout: 300_000 }, () => {
  it('another build: it plays up to the last matching checkpoint, then the recording takes over', async () => {
    const g = aiGame('rpl2-diverge', 0, 1);
    expect(g.states[g.states.length - 1]!.turn.number).toBeGreaterThan(change.fromTurn);
    const file = replayFileOf(g, { build: OTHER_BUILD });
    const good = lastGood(file);
    const conn = createReplayConnection(file, { engineBuild: TEST_BUILD, perspective: OPEN });
    const c = conn.controller;
    expect(c.state().badge).toBe('checking');
    await c.ready();
    const turn = g.states[good]!.turn.number;
    expect(turn).toBe(change.fromTurn - 1);
    expect(c.state().badge).toBe('recordingFrom');
    expect(c.state().statusText).toBe(`Recording from turn ${turn}`);
    expect(conn.status!()).toBe(
      `From turn ${turn} this replay shows the recording; this version of OpenMTG plays the game differently than the one it was played on, commit 2a8e88ae, 2026-10-18.`,
    );
    c.seek(good);
    expect(conn.view().open).toBe(true);
    c.step(1);
    expect(conn.view().open).toBeUndefined();
    expect(conn.view().viewer).toBe('p1');
    expect(c.state().perspective).toEqual(seat('p1'));
    c.dispose();
  });

  it('another build without a recording: it stops there, "You can watch it up to turn 3"', async () => {
    const g = aiGame('rpl2-diverge', 0, 1);
    const file = replayFileOf(g, { build: OTHER_BUILD, noRecording: true });
    const good = lastGood(file);
    const conn = createReplayConnection(file, { engineBuild: TEST_BUILD });
    await conn.controller.ready();
    const c = conn.controller;
    expect(c.state().badge).toBe('watchingUpTo');
    expect(c.state().last).toBe(good);
    expect(conn.status!()).toBe(
      `This version of OpenMTG plays the game differently than the one it was played on, commit 2a8e88ae, 2026-10-18. You can watch it up to turn ${change.fromTurn - 1}.`,
    );
    c.seek(g.actions.length);
    expect(c.state().position).toBe(good);
    expect(json(conn.view())).toBe(json(viewFor(g.states[good]!, 'p1')));
    c.dispose();
  });

  it('the same build: the background check finds an engine bug, and the recording takes over at once where the viewer is', async () => {
    const g = aiGame('rpl2-diverge', 0, 1);
    const file = replayFileOf(g);
    const good = lastGood(file);
    const conn = createReplayConnection(file, { engineBuild: TEST_BUILD, perspective: OPEN });
    const c = conn.controller;
    // Exact by construction: it plays at once, in the open view.
    expect(c.state().badge).toBe('exact');
    expect(c.seek(g.actions.length)).toBe(true);
    expect(conn.view().open).toBe(true);
    let told = 0;
    conn.subscribe(() => told++);
    await c.ready();
    expect(told).toBeGreaterThan(0);
    expect(c.state().badge).toBe('recordingFrom');
    expect(conn.status!()).toBe(
      `From turn ${change.fromTurn - 1} this replay shows its recording: the game plays differently on the version of OpenMTG it was made on, which is a bug in OpenMTG.`,
    );
    // Still at the end, now from the recording (p1's view), and no longer switchable.
    expect(c.state().position).toBe(g.actions.length);
    expect(conn.view().open).toBeUndefined();
    const { defs: _d, ...want } = viewFor(g.states[g.actions.length]!, 'p1');
    const { defs: _e, ...got } = conn.view();
    expect(json(got)).toBe(json(want));
    expect(c.setPerspective(OPEN).ok).toBe(false);
    c.seek(good);
    expect(c.setPerspective(OPEN)).toEqual({ ok: true });
    expect(conn.view().open).toBe(true);
    c.dispose();
  });
});
