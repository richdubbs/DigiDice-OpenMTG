/**
 * RPL-1 (replays design 6, 10): the end screen's replay panel. Next to Rematch, New game and Home: Watch replay, Keep replay, and in hot-seat each
 * person's "Show my cards in replays" (default off). The agreement is recorded in the replay file (`reveal`): every seat and the open view only once
 * every person agreed (D4, CR 400.2); one person against the computer needs no agreement (adopted answer 1).
 */
import { act as reactAct, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { viewFor, type ReplayFile } from '@openmtg/engine';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav, type Route } from '../../src/app/nav';
import type { GameConnection } from '../../src/connection/GameConnection';
import { LocalConnection } from '../../src/connection/LocalConnection';
import { ComputerGame } from '../../src/game/computer';
import { GameOver } from '../../src/game/GameOver';
import { sealConnection } from '../../src/game/sealed';
import { liveReplayOf } from '../../src/replays/live';
import { recordLocalGame } from '../../src/replays/record';
import { duel, playUntil, settle, testEnv } from './helpers';

const opened = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../src/replays/openReplay', () => ({
  openReplay: opened.fn,
}));

/** The notice openReplay gives for a replay with nothing this client can show. */
const UNWATCHABLE = 'This replay cannot be watched: This replay holds nothing this version of OpenMTG can show.';

afterEach(() => opened.fn.mockReset());

/** A finished, recorded game on the game route, its end screen rendered as the game screen renders it. */
async function finished(make: (env: ReturnType<typeof testEnv>) => LocalConnection | ComputerGame) {
  const env = testEnv();
  const game = make(env);
  const local = game instanceof LocalConnection ? game : game.local;
  await playUntil(local, () => local.session.state.result !== null);
  expect(local.session.state.result).not.toBeNull();
  const connection = sealConnection(game);
  const routes: Route[] = [];
  function Probe() {
    const { route } = useNav();
    useEffect(() => {
      routes.push(route);
    }, [route]);
    if (route.screen !== 'game' || route.connection !== connection) return <p>{route.screen} screen</p>;
    const view = viewFor(local.session.state, null);
    return <GameOver view={view} result={view.result!} onNewGame={() => {}} onHome={() => {}} />;
  }
  render(
    <NavProvider initial={{ screen: 'game', connection }}>
      <Probe />
    </NavProvider>,
  );
  await settle();
  const file = async (): Promise<ReplayFile> => {
    await settle();
    const [entry] = await env.library.list();
    const read = await env.library.read(entry!.key);
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  return { env, connection, routes, file };
}

const panel = () => screen.getByRole('group', { name: 'Replay' });

describe('RPL-1: the end screen offers the replay (design 10)', () => {
  it('shows Watch replay and Keep replay next to the game-over buttons; Keep marks the library entry Keep', async () => {
    const { env } = await finished((env) => recordLocalGame(new LocalConnection(duel('rpl1-end-keep', 4)), { format: 'casual' }, env));
    const over = screen.getByRole('region', { name: 'Game over' });
    expect(within(over).getByRole('button', { name: 'New game' })).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: 'Watch replay' })).toBeTruthy();
    const keep = within(panel()).getByRole('button', { name: 'Keep replay' });
    expect(keep.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(keep);
    expect(within(panel()).getByRole('button', { name: 'Keep replay' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(async () => expect((await env.library.list())[0]!.keep).toBe(true));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Keep replay' }));
    await waitFor(async () => expect((await env.library.list())[0]!.keep).toBe(false));
  });

  it('Watch replay opens the game screen with the saved replay through the playback adapter', async () => {
    const replayConnection = { kind: 'replay' } as unknown as GameConnection;
    opened.fn.mockResolvedValue({ connection: replayConnection, notice: null });
    const { routes, file } = await finished((env) => recordLocalGame(new LocalConnection(duel('rpl1-end-watch', 4)), { format: 'casual' }, env));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Watch replay' }));
    await waitFor(() => expect(routes[routes.length - 1]).toEqual({ screen: 'game', connection: replayConnection }));
    expect(opened.fn.mock.calls[0]![0]).toEqual(await file());
  });

  it('Watch replay says why when the replay cannot be watched', async () => {
    opened.fn.mockResolvedValue({ connection: null, notice: UNWATCHABLE });
    await finished((env) => recordLocalGame(new LocalConnection(duel('rpl1-end-none', 4)), { format: 'casual' }, env));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Watch replay' }));
    expect((await within(panel()).findByRole('alert')).textContent).toBe(UNWATCHABLE);
  });

  it('a game that is not recorded (online) shows no replay panel', () => {
    const conn = new LocalConnection(duel('rpl1-end-unrecorded'));
    const view = { ...viewFor(conn.session.state, null), result: { winner: 'p1', reason: 'Bob has 0 or less life' } };
    render(
      <NavProvider initial={{ screen: 'game', connection: sealConnection(conn) }}>
        <GameOver view={view} result={view.result} onNewGame={() => {}} onHome={() => {}} />
      </NavProvider>,
    );
    expect(screen.getByRole('region', { name: 'Game over' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Replay' })).toBeNull();
  });
});

describe('RPL-1: "Show my cards in replays" (design 6, D4, CR 400.2): the agreement is recorded in the replay file', () => {
  it('hot-seat: each person ticks their own, default off; the replay opens on the public view until every person agreed', async () => {
    const { connection, file } = await finished((env) => recordLocalGame(new LocalConnection(duel('rpl1-end-reveal', 4)), { format: 'casual' }, env));
    const box = (name: string) => within(panel()).getByRole('checkbox', { name: `${name}: show my cards in replays` }) as HTMLInputElement;
    expect(within(panel()).getByRole('group', { name: 'Show my cards in replays' })).toBeTruthy();
    expect(box('Alice').checked).toBe(false);
    expect(box('Bob').checked).toBe(false);
    expect((await file()).reveal).toEqual({ policy: 'own', agreed: [] });
    reactAct(() => {
      fireEvent.click(box('Bob'));
    });
    expect(box('Bob').checked).toBe(true);
    await waitFor(async () => expect((await file()).reveal).toEqual({ policy: 'own', agreed: ['p2'] }));
    reactAct(() => {
      fireEvent.click(box('Alice'));
    });
    await waitFor(async () => expect((await file()).reveal).toEqual({ policy: 'all', agreed: ['p1', 'p2'] }));
    // a change of mind counts: the last choice is the one recorded
    reactAct(() => {
      fireEvent.click(box('Alice'));
    });
    await waitFor(async () => expect((await file()).reveal).toEqual({ policy: 'own', agreed: ['p2'] }));
    expect(liveReplayOf(connection)!.state().agreed).toEqual(['p2']);
  });

  it('one person against the computer: no toggle, and the replay may show every card (adopted answer 1)', async () => {
    const { file } = await finished((env) =>
      recordLocalGame(new ComputerGame(duel('rpl1-end-vs', 4), 'p1', 'p2', { delayMs: 0, seed: 'c' }), { format: 'casual' }, env),
    );
    expect(within(panel()).queryByRole('checkbox')).toBeNull();
    expect((await file()).reveal).toEqual({ policy: 'all', agreed: ['p1'] });
  });
});
