/**
 * RPL-2: the controller of a replay connection, for the game screen. Only a type comes from connection/ReplayConnection.ts, so the game screen does not
 * load the replay code (the replay library loads it when a replay is opened).
 */
import type { ReplayController } from '../../connection/ReplayConnection';
import { registeredReplayController } from './registry';

/** The controller of a replay connection, or of its sealed form (game/sealed.ts); null for any other connection. */
export function replayControllerOf(connection: object): ReplayController | null {
  return registeredReplayController(connection) as ReplayController | null;
}
