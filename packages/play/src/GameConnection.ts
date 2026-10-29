/**
 * The only way the UI talks to a game (docs/design/m8-client.md "Data flow"; docs/design/online.md). The UI renders the `GameView` of `view()` (from the
 * engine's `viewFor`, never a raw state) and sends `Action`s with `act`. Implementations: `LocalConnection` (engine in the browser, hot-seat) and, in
 * milestone 9, `RemoteConnection` (WebSocket to the local server, which talks UDP to the other player). Online play then needs no UI changes.
 *
 * `subscribe`, `view` and `handoff` have the shape React's `useSyncExternalStore` expects: `view()` returns the same object until something changes.
 * Every member is a function property that works unbound (implement them as bound arrow properties), so `useSyncExternalStore(conn.subscribe, conn.view)` works.
 *
 * Godot plan phase 1: moved here from packages/client/src/connection (types only), with LocalConnection; the client re-exports it from its old path.
 */
import type { Action, ActionError, GameEvent, GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { ClockView } from '@openmtg/hosted/api';

export type ActResult = { ok: true } | { ok: false; error: ActionError };

/** The events of one applied action, for the board's animations (the engine returns them from `applyAction`; they are not part of the state). */
export interface EventBatch {
  /**
   * Grows by one with every applied action. An undo, a hand-off or anything else that changes the view without a new action keeps it, so a screen never
   * plays the same batch twice and never animates a view it did not see happen.
   */
  readonly seq: number;
  /** What happened, in order, with what the viewer of `view()` may not see removed (CR 400.2; the engine's `eventsFor`, core/view-events.ts, which packages/net uses for online guests too). */
  readonly events: readonly GameEvent[];
}

export interface GameConnection {
  /**
   * Where the game runs: `'local'` (the engine in this browser), `'remote'` (online, the host's engine). RPL-0 INTERFACE CHANGE (replays design 8): `'replay'`,
   * a saved game played back read-only (`connection/ReplayConnection.ts`, RPL-2): no legal actions, `act` refuses, no undo and no hand-off. A screen
   * treats it as a game it only watches.
   */
  readonly kind: 'local' | 'remote' | 'replay';
  /** The current view for the player shown on this screen (a spectator view while a hot-seat hand-off is pending). Stable between changes. */
  readonly view: () => GameView;
  /**
   * The legal priority actions of the shown player (CR 117.1), for highlighting playable cards and listing what a card can do. Empty while a hand-off
   * is pending, while the game waits for a decision instead of priority, and for a player without priority. Stable between changes, like `view()`.
   * A remote connection receives them from the host with each view.
   */
  readonly legalActions: () => readonly LegalAction[];
  /**
   * Send an action for the shown player. Rejected (never half-applied, CR 733) when it is illegal or when its `player` is not the player this
   * connection acts for; the error carries the engine's explanation and rule citations. One exception: a `concede` is accepted from any player of this
   * connection at any time, even while a hand-off is pending (CR 104.3a: a player can concede at any time). Never throws: an unexpected engine error
   * comes back as a rejection.
   */
  readonly act: (action: Action) => Promise<ActResult>;
  /** Called after every change of `view()`, `legalActions()` or `handoff()`. Returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Whether `undo()` would do something (hot-seat only; online games never undo, docs/design/online.md). False after an action that can never be
   * taken back: one that moved cards to or from a library, shuffled, revealed or showed hidden cards, or decided a random result (CR 733.1, CR 400.2),
   * and once the game is over (CR 104.1).
   */
  readonly canUndo: () => boolean;
  /** Take back the shown player's last action. Returns false when nothing was undone. */
  readonly undo: () => boolean;
  /**
   * Hot-seat hidden information: the player who must act next when that is not the player shown now. While it is non-null the screen shows a
   * full-screen "Pass to <name>" cover and `view()` is a spectator view (hands and libraries hidden). Always null for a remote connection.
   */
  readonly handoff: () => PlayerId | null;
  /** The next player clicked through the cover: show their view. */
  readonly acceptHandoff: () => void;
  /**
   * C6 addition (INTERFACE CHANGE, optional): the players who sit at this screen and may concede here (CR 104.3a): every player in hot-seat, only the
   * human against the computer. Absent: only the viewer (an online game).
   */
  readonly seated?: () => readonly PlayerId[];
  /**
   * C6 addition (INTERFACE CHANGE, optional): a problem on the other side of the connection the screen must show, or null (the computer could not
   * decide; in milestone 9 a lost link). Stable between changes, like `view()`; a change is announced through `subscribe`. Absent: never a problem.
   * M12-5b: it concerns this screen's own side only (its link, the game closed, a host that left and keeps serving the game); in a 3-4 player online game
   * the other players' presence (their links, drop clocks and who left) is the online panel's, not this text's.
   */
  readonly status?: () => string | null;
  /**
   * ui/arena addition (INTERFACE CHANGE, optional): the events of the last applied action, redacted for the player whose view `view()` is (a spectator
   * while a hot-seat hand-off is pending). Stable between changes, like `view()`; read it in the same notification as `view()`, which is the view right
   * after those events. Absent: the screen shows every change at once, without animations. Milestone 9's RemoteConnection returns the events the host
   * sends with each view (packages/net `eventsFor`).
   */
  readonly events?: () => EventBatch;
  /**
   * M13-11 addition (INTERFACE CHANGE, optional; hosted design 5, 12): the clocks of a game on the DigiDice server, as last sent: a bank per seat, the free
   * delay of the control period, the away time, and the time left before a game nobody is connected to ends. `at` is this page's own clock at the moment they
   * arrived, so the countdown (hosted/clocks.ts `clocksAt`) needs nothing from the server's time of day; the page counts down itself, the server sends the
   * clocks only when one starts or stops. Stable between changes, like `view()`; a change is announced through `subscribe`. Null before the first clock, absent
   * for a game without clocks (hot-seat, a game against the computer, a milestone 9 online game).
   */
  readonly clocks?: () => ClockView | null;
}
