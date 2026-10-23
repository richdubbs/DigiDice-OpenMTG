/**
 * RPL-4: the replay file each replay connection plays, for a bug report made while watching it (replays design 11: a report carries "a replay as in
 * section 4"; from the replay viewer that is the replay being watched, as the player has it). replays/openReplay.ts, the one door to playback,
 * registers it under the connection and its sealed form (game/sealed.ts), the one the game screen holds.
 *
 * A leaf module with no imports, so the replay library does not load the bug report code. The map is module scope, out of the React tree (FXH).
 */

/** The replay as this registry holds it; @openmtg/engine's `ReplayFile`. */
type Replay = object;

const watched = new WeakMap<object, Replay>();

export function registerWatchedReplay(connections: readonly object[], replay: Replay): void {
  for (const c of connections) watched.set(c, replay);
}

export function watchedReplayOf(connection: object): Replay | null {
  return watched.get(connection) ?? null;
}
