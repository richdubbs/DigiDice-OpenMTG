/**
 * RPL-1 (replays design 8, 10): the one door from the library and the end screen to playback. Watching a replay opens the game screen with the
 * connection that `createReplayConnection(replay, options)` of `connection/ReplayConnection.ts` (RPL-2) makes. That module is loaded on the first Watch
 * (a lazy chunk), so the library and the end screen do not carry the playback code.
 *
 * The connection is put on the game route as it is: the game screen finds its controller by the connection, sealed or not (replays/viewer/controllerOf.ts,
 * game/sealed.ts). A replay with nothing this client can show (`ReplayUnplayable`), or any other problem in opening it, becomes the notice.
 *
 * RPL-4 (replays design 11): the file is registered under the connection and its sealed form (bugs/watched.ts), so a bug report made while it is
 * watched carries the replay as the player has it.
 */
import type { ReplayFile } from '@openmtg/engine';
import { registerWatchedReplay } from '../bugs/watched';
import type { GameConnection } from '../connection/GameConnection';
import type { ReplayConnectionOptions } from '../connection/ReplayConnection';
import { sealConnection } from '../game/sealed';

export type OpenedReplay = { connection: GameConnection; notice: null } | { connection: null; notice: string };

/** Open `replay` for watching: its connection, or why it cannot be watched (never throws). */
export async function openReplay(replay: ReplayFile, options: ReplayConnectionOptions = {}): Promise<OpenedReplay> {
  try {
    const { createReplayConnection } = await import('../connection/ReplayConnection');
    const connection = createReplayConnection(replay, options);
    registerWatchedReplay([connection, sealConnection(connection)], replay);
    return { connection, notice: null };
  } catch (e) {
    return { connection: null, notice: `This replay cannot be watched: ${e instanceof Error ? e.message : String(e)}` };
  }
}
