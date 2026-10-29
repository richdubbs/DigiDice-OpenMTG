/**
 * RPL-2 (replays design 5, 6, 8): a saved game played back read-only. The replay itself (its states, the check, the clock, whose view it shows) is
 * @openmtg/play's replay/connection.ts, which the local server also plays to the Godot app; this file gives it this client's engine build and the
 * checking worker, and registers its controller for the game screen.
 */
import type { ReplayFile } from '@openmtg/engine';
import { createReplayConnection as createPlayback, type ReplayConnection, type ReplayConnectionOptions } from '@openmtg/play/replay/connection';
import { ENGINE_BUILD } from '../engine-build';
import { DEFAULT_TIMERS, defaultChecker } from '../replays/viewer/check';
import { registerReplayController } from '../replays/viewer/registry';

export * from '@openmtg/play/replay/connection';

/**
 * A replay as a read-only game connection, with its controller. Throws `ReplayUnplayable` for a replay with nothing this client can show (no game this
 * engine can run, no recording it can read); every other problem (another build that plays the game differently, a damaged frame) is shown by the
 * connection itself.
 */
export function createReplayConnection(replay: ReplayFile, options: ReplayConnectionOptions = {}): ReplayConnection {
  const connection = createPlayback(replay, {
    ...options,
    engineBuild: options.engineBuild !== undefined ? options.engineBuild : ENGINE_BUILD,
    checker: options.checker ?? defaultChecker(options.timers ?? DEFAULT_TIMERS),
  });
  registerReplayController(connection, connection.controller);
  return connection;
}

/** The controller of a replay connection (or of its sealed form, game/sealed.ts); null for any other connection. */
export { replayControllerOf } from '../replays/viewer/controllerOf';
