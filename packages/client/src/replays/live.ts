/**
 * RPL-1 (replays design 7.1, 10): the replays of the games on this page, by their connection, for what the rest of the app does with a game's replay
 * without holding the game: the end screen (GameOver.tsx: Watch replay, Keep replay, "Show my cards in replays") and the navigation (app/nav.tsx:
 * leaving the game screen saves the game's replay). Each game is registered under its connection and the connection's sealed form (game/sealed.ts),
 * the one the game route carries.
 *
 * FXH (audit m5, CR 400.2): what this hands out is a `LiveReplay`, never the recorder or the game: its members name the people at the screen and say
 * what they chose, and give the replay file only once the game is over. The map is module scope, out of the React tree.
 *
 * No engine imports: the navigation imports this file, and the page's first chunk must not carry the engine (app/App.tsx).
 */
import type { PlayerId, ReplayFile } from '@openmtg/engine';
import type { GameConnection } from '../connection/GameConnection';

/** What the end screen shows of a game's replay, as one snapshot (stable between changes, for `useSyncExternalStore`). */
export interface LiveReplayState {
  /** `'recording'` while the game runs, `'saving'` from its end until its replay is in the library, then `'saved'` (or `'failed'`). */
  phase: 'recording' | 'saving' | 'saved' | 'failed';
  /** Why saving failed, in plain words. */
  error: string | null;
  /** The people who agreed to show their cards in replays (design 6). */
  agreed: readonly PlayerId[];
  /** The player marked it Keep. */
  kept: boolean;
}

export interface LiveReplay {
  /** The people at the screen whose agreement counts (design 6): every person in hot-seat; computer seats need none. */
  readonly people: readonly { id: PlayerId; name: string }[];
  /** Whether each person is asked "Show my cards in replays" (more than one person at the screen, design 6). */
  readonly asksAgreement: boolean;
  readonly state: () => LiveReplayState;
  readonly subscribe: (listener: () => void) => () => void;
  /** A person's "Show my cards in replays" (default off); recorded in the replay file. */
  readonly setAgreed: (player: PlayerId, agree: boolean) => void;
  /** Keep replay: never removed by the library's retention. */
  readonly setKept: (keep: boolean) => void;
  /** The finished game's replay as the library keeps it, once saved; null while the game runs or when it could not be saved. */
  readonly file: () => Promise<ReplayFile | null>;
  /**
   * RPL-4 INTERFACE CHANGE (optional; replays design 11): the game as recorded up to now, for a bug report the player asked for (bugs/capture.ts),
   * while the game runs too: the config and the log so far, with the last action's checkpoint (an unfinished game is marked `'abandoned'`). A report of
   * a local game holds the game as its replay does (design 6: never more than this machine had). The bug report code takes it in a closure and saves
   * it; no screen keeps it (FXH: React props and state hold only views).
   */
  readonly soFar?: () => ReplayFile;
  /** The player left the game screen: the replay is saved now (an unfinished game as abandoned, design 7.1). */
  readonly left: () => void;
}

const live = new WeakMap<GameConnection, LiveReplay>();

/** Register a game's replay under each form of its connection. */
export function registerLiveReplay(connections: readonly GameConnection[], replay: LiveReplay): void {
  for (const c of connections) live.set(c, replay);
}

/** The replay of the game on `connection`, or null (a game that is not recorded: online, a replay being watched). */
export function liveReplayOf(connection: GameConnection): LiveReplay | null {
  return live.get(connection) ?? null;
}

/** The navigation took the game on `connection` off the screen for good (it is no longer on the back stack). */
export function leftGameScreen(connection: GameConnection): void {
  const r = live.get(connection);
  if (!r) return;
  try {
    r.left();
  } catch (e) {
    console.error('[Replays] saving the replay on leaving failed', e);
  }
}
