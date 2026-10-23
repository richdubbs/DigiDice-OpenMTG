/**
 * RPL-1 and RPL-2 together (replays design 7.1, 8, 10): the playback adapter (openReplay.ts) opens what the library keeps in RPL-2's replay connection.
 * A game against the computer recorded by the recorder, saved when it ended and completed by the worker (its fallback recording), plays back on the
 * person's seat with the live game's views, exact under the same build; under another build that plays it differently its own recording takes over;
 * a replay with nothing this client can show gives the notice, never a throw. Leaving a replay for good (its route off the back stack) disposes it.
 */
import { ABILITY_MODEL_VERSION, replay as rerun, viewFor, type ReplayFile } from '@openmtg/engine';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavProvider, useNav, type Nav } from '../../src/app/nav';
import type { GameConnection } from '../../src/connection/GameConnection';
import { ComputerGame } from '../../src/game/computer';
import { sealConnection } from '../../src/game/sealed';
import { openReplay } from '../../src/replays/openReplay';
import { recordLocalGame } from '../../src/replays/record';
import { replayControllerOf } from '../../src/replays/viewer/controllerOf';
import { seat } from '../../src/replays/viewer/policy';
import { duel, inlineCompleter, playUntil, settle, testEnv } from './helpers';

const BUILD = 'a'.repeat(64);
const OTHER_BUILD = 'b'.repeat(64);
const json = (x: unknown): string => JSON.stringify(x);

/** A finished game against the computer as the library keeps it, with the live game's final state. */
async function finishedComputerGame(seed: string) {
  const env = testEnv({ completer: inlineCompleter, build: BUILD });
  const game = recordLocalGame(new ComputerGame(duel(seed, 4), 'p1', 'p2', { delayMs: 0, seed: 'c' }), { format: 'casual' }, env);
  await playUntil(game.local, () => game.local.session.state.result !== null);
  expect(game.local.session.state.result).not.toBeNull();
  await settle(40);
  const [entry] = await env.library.list();
  const read = await env.library.read(entry!.key);
  if (!read.ok) throw new Error(read.error.message);
  return { file: read.value, final: game.local.session.state };
}

async function watch(file: ReplayFile, engineBuild: string): Promise<GameConnection> {
  const opened = await openReplay(file, { engineBuild, sliceMs: 40 });
  expect(opened.notice).toBeNull();
  return opened.connection!;
}

describe('RPL-1 and RPL-2: the playback adapter opens the library\'s replays (replays design 8, 10)', { timeout: 120_000 }, () => {
  it('a recorded game against the computer plays back on the person\'s seat, exact under the same build, with the live game\'s views', async () => {
    const { file, final } = await finishedComputerGame('rpl-open-computer');
    expect(file.engine.build).toBe(BUILD);
    expect(file.recording).toBeDefined();
    const conn = await watch(file, BUILD);
    expect(conn.kind).toBe('replay');
    const c = replayControllerOf(conn)!;
    expect(c).not.toBeNull();
    // The game route carries the connection as it is, and the game screen below it holds the sealed form: both drive the same replay.
    expect(replayControllerOf(sealConnection(conn))).toBe(c);
    await c.ready();
    expect(c.state().badge).toBe('exact');
    expect(c.state().perspective).toEqual(seat('p1'));
    expect(c.state().last).toBe(file.play!.actions.length);
    // Every position shows what the person's seat was shown (CR 400.2: the computer's hand stays hidden on this perspective).
    const actions = file.play!.actions;
    expect(rerun(file.play!.config, actions).errors).toEqual([]);
    for (let i = 0; i <= actions.length; i += 7) {
      expect(c.seek(i)).toBe(i !== 0);
      expect(c.state().position).toBe(i);
      expect(json(conn.view()), `after ${i} actions`).toBe(json(viewFor(rerun(file.play!.config, actions.slice(0, i)).state, 'p1')));
    }
    expect(c.seek(0)).toBe(true);
    for (let i = 1; i <= actions.length; i++) expect(c.step(1)).toBe(true);
    expect(c.step(1)).toBe(false);
    expect(json(conn.view())).toBe(json(viewFor(final, 'p1')));
    expect(conn.view().result).toEqual(final.result);
    expect(conn.legalActions()).toEqual([]);
    c.dispose();
  });

  it('under another build that plays the game differently, the recording the worker made takes over and ends as the game ended', async () => {
    const { file, final } = await finishedComputerGame('rpl-open-diverge');
    // Another build's file whose last checkpoint this engine does not reach (a test-only difference: the digest is not this engine's).
    const cps = file.play!.checkpoints;
    const changed: ReplayFile = {
      ...file,
      engine: { ...file.engine, build: OTHER_BUILD },
      play: { ...file.play!, checkpoints: cps.map((cp, i) => (i === cps.length - 1 ? { ...cp, digest: `d1:${'0'.repeat(32)}` } : cp)) },
    };
    const conn = await watch(changed, BUILD);
    const c = replayControllerOf(conn)!;
    await c.ready();
    expect(c.state().badge).toBe('recordingFrom');
    expect(c.seek(c.state().last)).toBe(true);
    expect(conn.view().viewer).toBe('p1');
    expect(conn.view().result).toEqual(final.result);
    expect(conn.view().players.map((p) => p.life)).toEqual(viewFor(final, 'p1').players.map((p) => p.life));
    c.dispose();
  });

  it('a replay with nothing this client can show gives the notice, never a throw', async () => {
    const { file } = await finishedComputerGame('rpl-open-none');
    const { recording: _recording, ...noRecording } = file;
    const unreadable = { ...noRecording, engine: { ...file.engine, model: ABILITY_MODEL_VERSION + 1 } } as ReplayFile;
    const r = await openReplay(unreadable);
    expect(r.connection).toBeNull();
    expect(r.notice).toMatch(/^This replay cannot be watched: This replay's game was made with card model/);
    const broken = await openReplay({} as never);
    expect(broken.connection).toBeNull();
    expect(broken.notice).toMatch(/^This replay cannot be watched: /);
  });

  it('a replay whose route leaves the back stack is disposed; Settings over it keeps it', async () => {
    const { file } = await finishedComputerGame('rpl-open-leave');
    const conn = await watch(file, BUILD);
    const c = replayControllerOf(conn)!;
    let nav: Nav | null = null;
    function Probe() {
      nav = useNav();
      return null;
    }
    render(
      <NavProvider initial={{ screen: 'replays' }}>
        <Probe />
      </NavProvider>,
    );
    act(() => nav!.go({ screen: 'game', connection: conn }));
    act(() => nav!.go({ screen: 'settings' }));
    act(() => nav!.back());
    expect(c.seek(3)).toBe(true);
    c.setSpeed(16);
    c.play();
    expect(c.state().playing).toBe(true);
    await waitFor(() => expect(c.state().position).toBeGreaterThan(4));
    // Back to the library: the replay has left the game screen for good, and its clock and background work stop.
    act(() => nav!.back());
    const seq = conn.events!().seq;
    await new Promise((r) => setTimeout(r, 400));
    expect(conn.events!().seq).toBe(seq);
    expect(c.seek(0)).toBe(false);
    expect(c.step(1)).toBe(false);
  });
});
