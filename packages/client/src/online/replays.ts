/**
 * RPL-3 (replays design 7.2, 7.3, 6): the one call the online setup screens make to have an online game's replay kept, and the page's start-up sweep of
 * online replays.
 *
 * `recordOnlineGame(connection, link)`: a guest records what it is shown (online/recording.ts: the recorder on its `RemoteConnection`, and the whole game
 * instead once the host shares it); the host reads its game's record from its own server at the end (online/hostReplay.ts). Either way the game's
 * `LiveReplay` is registered under the connection and its sealed form (replays/live.ts), so the end screen offers Watch replay and Keep replay; the
 * "Show my cards in replays" choice is the online panel's (OnlineGamePanel). Recording never stops a game: a failure is logged and the game is played
 * unrecorded. `keepSharedOnlineGame(link)`: the setup screens keep a game the host shared after the guest's page left the game screen.
 */
import type { GameConnection } from '../connection/GameConnection';
import type { RemoteConnection } from '../connection/RemoteConnection';
import { sealConnection } from '../game/sealed';
import { pageReplays, type ReplayEnv } from '../replays/env';
import { registerLiveReplay, type LiveReplay } from '../replays/live';
import { collectHostReplays, OnlineHostReplay, pageRequest, serverReplays, type ServerRequest } from './hostReplay';
import type { OnlineLink } from './OnlineLink';
import { finishAbandonedOnline, keepSharedGame, OnlineGuestRecorder } from './recording';

/** What `recordOnlineGame` started: the guest's recorder or the host's replay (null: none, the game is not recorded). */
export type OnlineReplay = { role: 'guest'; recorder: OnlineGuestRecorder; live: LiveReplay } | { role: 'host'; replay: OnlineHostReplay; live: LiveReplay } | null;

/** Keep the replay of the online game on `connection` (see the file comment); `sealed`: the form the game route holds (default its sealed form). */
export function recordOnlineGame(connection: RemoteConnection, link: OnlineLink, env: ReplayEnv = pageReplays(), sealed: GameConnection = sealConnection(connection)): OnlineReplay {
  try {
    const status = link.status();
    if (status.role === 'guest') {
      const recorder = OnlineGuestRecorder.start(connection, link, env);
      registerLiveReplay([connection, sealed], recorder.live);
      return { role: 'guest', recorder, live: recorder.live };
    }
    if (status.role === 'host') {
      const me = status.me ?? connection.view().viewer;
      const name = connection.view().players.find((p) => p.id === me)?.name ?? 'Host';
      const replay = OnlineHostReplay.start(link, env, name);
      if (!replay) return null;
      registerLiveReplay([connection, sealed], replay.live);
      return { role: 'host', replay, live: replay.live };
    }
  } catch (e) {
    console.error('[Replays] the online game could not be recorded', e);
  }
  return null;
}

/**
 * For the online setup screens (setup.tsx), which see the game this player's server has open: a game the host shared after this player's page left its
 * game screen waits at the server until that game is left; it replaces this player's recording now (online/recording.ts `keepSharedGame`). Never throws.
 */
export function keepSharedOnlineGame(link: OnlineLink, env: ReplayEnv = pageReplays()): Promise<boolean> {
  return keepSharedGame(link, env);
}

/**
 * Once per page at start (replays/record.ts `sweepOnStart`): an online recording a closed tab or a crash left unfinished becomes an abandoned replay, but
 * not the one of the game this page's server still has open (a reloaded page: its recording goes on when the player returns to the game), and the
 * records this page's server still keeps of the games it hosted come into the library. Never throws.
 */
export async function sweepOnlineReplays(env: ReplayEnv = pageReplays(), request: ServerRequest = pageRequest): Promise<void> {
  const server = await serverReplays(request);
  try {
    await finishAbandonedOnline(env, { open: server?.open ?? null });
  } catch (e) {
    console.error('[Replays] the unfinished online games could not be read', e);
  }
  try {
    await collectHostReplays(env, request, server);
  } catch (e) {
    console.error('[Replays] the online games this server kept could not be read', e);
  }
}
