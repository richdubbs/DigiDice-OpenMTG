/**
 * RPL-3 (replays design 7.3): a game the host shared after the guest's page left its game screen waits at the guest's server for a page; the online
 * setup screen that sees that game open (here the Join screen, over a fake local server socket: normal traffic only) keeps it: the guest's recording in
 * the library becomes the game, saved by this player.
 */
import { act as reactAct, render, screen } from '@testing-library/react';
import { encodeReplayGame, onlineReplayFile } from '@openmtg/net';
import { describe, expect, it } from 'vitest';
import { NavProvider } from '../../src/app/nav';
import { JoinScreen } from '../../src/online/JoinScreen';
import type { OnlineServices } from '../../src/online/setup';
import { botGame, discardConfig } from '../../../engine/test/rpl0/games';
import { testSettings } from '../game-fixtures';
import { fakeLink, flush } from '../online-fakes';
import { testEnv } from '../replays/helpers';
import { guestStatus, recordedGuest, recordOf, SHARED_APP, SHARED_BUILD } from './shared-fixtures';

const ID = 'r-0000000000000rpl3js1';

describe('RPL-3: the online setup screen keeps a game shared after the game screen was left', { timeout: 120_000 }, () => {
  it('the Join screen of a page whose server has the game open replaces the guest\'s recording with the game the host shared', async () => {
    const g = botGame(discardConfig('rpl3-setup-share'), 100);
    const env = testEnv({ build: SHARED_BUILD, completer: null });
    const page = await recordedGuest(g, env, ID);
    page.recorder.stop();
    expect((await env.library.list()).map((e) => e.summary.kind)).toEqual(['recording']);
    // A new page opens the Join screen: its server has the game open, over, and holds the game the host shared after the first page left.
    const data = encodeReplayGame(onlineReplayFile(recordOf(g), { savedBy: 'p2', mode: 'onlineGuest', app: SHARED_APP }))!;
    const f = fakeLink({ initial: [{ t: 'status', status: { ...guestStatus('p2', ID, { shared: true }), phase: 'over' } }, { t: 'replayGame', data }] });
    const services: OnlineServices = { listDecks: async () => [], openLink: () => f.link, replays: () => env };
    render(
      <NavProvider initial={{ screen: 'joinOnline' }}>
        <JoinScreen services={services} settings={testSettings()} />
      </NavProvider>,
    );
    await reactAct(flush);
    expect(screen.getByRole('region', { name: 'Open game' })).toBeTruthy();
    await reactAct(async () => {
      for (let i = 0; i < 200 && (await env.library.list())[0]?.summary.kind !== 'game'; i++) await new Promise((r) => setTimeout(r, 10));
    });
    const [entry] = await env.library.list();
    expect(entry?.summary).toMatchObject({ id: ID, kind: 'game', game: { mode: 'onlineGuest', savedBy: 'p2' }, reveal: { policy: 'all' } });
  });
});
