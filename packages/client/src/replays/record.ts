/**
 * RPL-1 (replays design 7.1): the one call the New game screen makes to have a local game recorded, and the page's start-up sweep of abandoned games.
 *
 * `recordLocalGame(connection, { format })` starts a `GameRecorder` on the game's LocalConnection (a `ComputerGame`'s inner one) and registers its
 * `LiveReplay` under the connection and its sealed form (live.ts), and gives the connection back unchanged, so a call site wraps what it already
 * builds: `sealConnection(recordLocalGame(new LocalConnection(config), { format }))`. Recording never stops a game: a failure is logged and the game
 * is played unrecorded.
 *
 * Review 2026-10-26 F1: a game in the game worker (connection/WorkerConnection.ts) is recorded through its `recordSource()`: the worker sends the
 * checkpoints and the last state's facts with each change, never a state.
 */
import { LocalConnection } from '../connection/LocalConnection';
import type { GameConnection } from '../connection/GameConnection';
import type { RecordSource } from './recordSource';
import { sealConnection } from '../game/sealed';
import { pageReplays, type ReplayEnv } from './env';
import { registerLiveReplay } from './live';
import { GameRecorder, finishAbandoned } from './recorder';
import { sweepOnlineReplays } from '../online/replays';

/**
 * A connection whose game runs in this page: a hot-seat LocalConnection, or a game against the computer around one (game/computer.ts); or (F1) a game
 * in the game worker, which gives the recorder its `recordSource()` (WorkerConnection; by its shape, so this file does not load the worker's code).
 */
export type LocalGame =
  | LocalConnection
  | (GameConnection & { readonly local: LocalConnection })
  | (GameConnection & { readonly recordSource: () => RecordSource });

/** Record the game on `connection` (see the file comment). Returns `connection`. */
export function recordLocalGame<C extends LocalGame>(connection: C, opts: { format: string }, env: ReplayEnv = pageReplays()): C {
  try {
    const source = connection instanceof LocalConnection ? connection : 'recordSource' in connection ? connection.recordSource() : connection.local;
    const recorder = GameRecorder.start(source, { format: opts.format }, env);
    registerLiveReplay([connection, sealConnection(connection)], recorder.live);
  } catch (e) {
    console.error('[Replays] the game could not be recorded', e);
  }
  return connection;
}

let swept = false;

/**
 * Once per page, soon after it opens (app/nav.tsx): the games a closed tab or a crash left unfinished become abandoned replays (design 7.1), and the
 * replays still waiting for their fallback recording are completed (completion.ts). Only where there is IndexedDB to keep them in; never throws.
 */
export function sweepOnStart(env: ReplayEnv = pageReplays()): Promise<void> {
  if (swept) return Promise.resolve();
  swept = true;
  return finishAbandoned(env)
    .then(
      () => {},
      (e: unknown) => console.error('[Replays] the unfinished games could not be read', e),
    )
    // RPL-3: and the online ones (an unfinished guest's recording; the records the host's server kept, online/replays.ts). Never rejects.
    .then(() => sweepOnlineReplays(env));
}
