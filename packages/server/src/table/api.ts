/**
 * The table channel (Godot plan phase 1; ARCHITECTURE.md of the Godot project, section 4): one WebSocket on the local server, path `/table`, over which a
 * screen in another process (the Godot table, or the browser itself: packages/client connection/TableConnection.ts) plays a game whose engine runs in
 * the server. Any `GameConnection` (@openmtg/play) is exposed the same way; phase 1 builds hot-seat (`LocalConnection`) and computer (`ComputerGame`)
 * tables. JSON text frames, each an object with a `t` field, like packages/hosted/src/api.ts.
 *
 * Browser-safe like online/api.ts: types and plain constants only (type imports from `@openmtg/engine` and `@openmtg/hosted/api`). The client imports
 * it as `import type ... from '@openmtg/server/table'`.
 *
 *   1. ws://127.0.0.1:<port>/table. The upgrade is refused unless Host is a loopback name with the server's port and, when an `Origin` is sent, it is
 *      exactly this server's page (or a dev origin given with --allow-origin); `Sec-Fetch-Site`, when sent, must be same-origin or none
 *      (table/socket.ts `checkTableUpgrade`). A socket without an `Origin` (the Godot app) must give the per-launch token: in `hello`, or as the
 *      `token` query parameter of the upgrade.
 *   2. The client sends `hello` first; the server answers `welcome`. Anything else first closes the socket (TABLE_CLOSE_PROTOCOL).
 *   3. `start` makes a table (answered `table`, then a full `view`); `attach` resumes one (the app restarted, or the client's view fell out of step:
 *      answered `table` and a full `view`). One table per socket at a time; a table outlives its socket for TABLE_IDLE_MS, so a restarted app can
 *      attach again. A second socket that attaches takes the table over (the first gets a `notice`).
 *   4. Every change of the game is one `patch` (or a full `view`), with a sequence number one higher than the last. `act` is answered by `reply` after
 *      the change it made.
 *
 * Hidden information (CR 400.2): only the shown player's `viewFor` view and the events redacted for it (`LocalConnection.events()`, the engine's
 * `eventsFor`) ever leave the server; never a `GameState`, the random source or another player's hand. A hot-seat table is one screen: while a hand-off
 * is pending its view is the spectator view (`handoff` names the next player) until the client sends `handoff`.
 */
import type { Action, GameConfig, GameEvent, GameResult, GameView, LegalAction, PatchOp, PlayerId, StopSettings } from '@openmtg/engine';
import type { ClockView, ProposalView } from '@openmtg/hosted/api';

/** Path of the WebSocket upgrade. */
export const TABLE_SOCKET_PATH = '/table';
/** The `table` of "Report a bug" during an online game: the game the online socket has open (online/bridge.ts `bugCapture`). */
export const ONLINE_TABLE = 'online';
/** Version of these messages (`hello.protocol`, `welcome.protocol`). */
export const TABLE_PROTOCOL = 1;
/** Largest message the server accepts (bytes): a `start` carries the game's compiled card definitions. */
export const MAX_TABLE_MESSAGE_BYTES = 32 * 1024 * 1024;
/** More changes than this between the client's last `shown` and the next change, and the next change is a full `view` (the client jumps ahead). */
export const MAX_SHOWN_LAG = 6;
/** How long a table with no socket is kept for an `attach` before it is closed (ms). */
export const TABLE_IDLE_MS = 30 * 60 * 1000;
/** WebSocket close codes (application range, RFC 6455 section 7.4.2); the same numbers as online/api.ts where they mean the same. */
export const TABLE_CLOSE_PROTOCOL = 4002;
export const TABLE_CLOSE_SHUTDOWN = 4003;
export const TABLE_CLOSE_TOKEN = 4004;

/** The game kinds of `start`. Phase 1 builds `hotseat` and `computer`; `online` and `hosted` are answered with a `notice` (phase 4). */
export type TableKind = 'hotseat' | 'computer' | 'online' | 'hosted' | 'replay';
/** The client's animation speed (Settings): the computer's pause before each action (@openmtg/play `computerDelayMs`). */
export type TableSpeed = 'off' | 'fast' | 'normal' | 'slow';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Client -> server

export interface HelloMessage {
  t: 'hello';
  /** The per-launch token. Optional only for this server's own page (the upgrade came with this server's `Origin`). */
  token?: string;
  protocol: number;
}

export interface StartMessage {
  t: 'start';
  kind: TableKind;
  /** The game (the client's game/config.ts `buildConfig`); the players need ids (p1, p2, ...). */
  config: GameConfig;
  /** The players who sit at this screen: hot-seat default every player; against the computer the people (default: every player not in `computers`). */
  seats?: PlayerId[];
  /** The computer players (`computer` only; at least one). */
  computers?: PlayerId[];
  /** The computers' seed for their choices between equally good plays (default: random). */
  seed?: string;
  /** The client's animation speed: the computer's pause before each action (default normal). */
  speed?: TableSpeed;
  /** The game's format id ("casual", "standard", "commander", …), for its replay's title and facts. */
  format?: string;
}

/** Watch a replay of the library as a table (library/replays.ts, table/replay.ts): views and events as in a game; `act` is refused. */
export interface WatchMessage {
  t: 'watch';
  /** The replay's id. */
  replay: string;
  /** The view to open on ("seat:p1", "public", "open"), when the reveal policy allows it; default the policy's own. */
  perspective?: string;
}

/**
 * The replay's transport (@openmtg/play replay/connection.ts `ReplayController`): play, pause or toggle; one change back or forward; a position; a
 * turn's start, the next or the previous turn; the speed, or one speed faster or slower; the view; muting the sound above 4x.
 */
export interface ReplayControlMessage {
  t: 'replay';
  table: string;
  op: 'play' | 'pause' | 'toggle' | 'step' | 'seek' | 'turn' | 'nextTurn' | 'previousTurn' | 'speed' | 'changeSpeed' | 'perspective' | 'muteFast';
  /**
   * step and changeSpeed: 1 or -1; seek: the position; turn: the turn number; speed: 0.25, 0.5, 1, 2, 4, 8, 16 or "real"; perspective: a view's key;
   * muteFast: true or false.
   */
  value?: number | string | boolean | null;
}

/** The end screen's replay controls: mark the game's replay Keep, or say whether a person at the screen shows their cards in its replays. */
export interface RecordingControlMessage {
  t: 'recording';
  table: string;
  keep?: boolean;
  reveal?: { player: PlayerId; agreed: boolean };
}

/** "Report a bug" opens: take the moment the report is about (answered by `bugCaptured`). */
export interface BugCaptureMessage {
  t: 'bugCapture';
  table: string;
  id: number;
}

/** Make the report of the moment taken, with the reporter's words and the screen's environment (answered by `bugReportFile`). */
export interface BugReportMessage {
  t: 'bugReport';
  table: string;
  id: number;
  words: string;
  card?: string | null;
  environment: {
    app: { version: string; commit: string | null };
    browser: { userAgent: string; language?: string; screen?: string };
    settings: Record<string, string | number | boolean | null>;
    errors: { message: string; stack?: string; time?: string }[];
  };
}

export interface AttachMessage {
  t: 'attach';
  table: string;
}

export interface ActMessage {
  t: 'act';
  table: string;
  /** The client's counter; the `reply` carries it. */
  id: number;
  /** The seq of the view the action was chosen from: older than the last change that was not a stop toggle and it is refused as stale. */
  seq: number;
  action: Action;
}

export interface ShownMessage {
  t: 'shown';
  table: string;
  /** The table has finished animating and shows view `seq`; the computer waits for it (pacing). */
  seq: number;
}

export interface UndoMessage {
  t: 'undo';
  table: string;
  /** Optional: answered by a `reply` with this id (ok false when nothing was undone). */
  id?: number;
}

export interface HandoffMessage {
  t: 'handoff';
  table: string;
}

export interface StopsMessage {
  t: 'stops';
  table: string;
  player: PlayerId;
  stops: StopSettings;
  /** Optional: answered by a `reply` with this id. Never stale. */
  id?: number;
}

export interface LeaveMessage {
  t: 'leave';
  table: string;
}

export interface PingMessage {
  t: 'ping';
}

export type TableClientMessage =
  | HelloMessage
  | StartMessage
  | WatchMessage
  | ReplayControlMessage
  | RecordingControlMessage
  | BugCaptureMessage
  | BugReportMessage
  | AttachMessage
  | ActMessage
  | ShownMessage
  | UndoMessage
  | HandoffMessage
  | StopsMessage
  | LeaveMessage
  | PingMessage;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Server -> client

export interface WelcomeMessage {
  t: 'welcome';
  protocol: number;
  /** The server's version (its package version, or the desktop app's). */
  version: string;
  /** The table kinds this server builds, and the optional parts it supports. */
  features: string[];
}

export interface TableMessage {
  t: 'table';
  table: string;
  kind: TableKind;
  /** The players who sit at this screen. */
  seats: PlayerId[];
  /** The player whose view the screen shows now (null while a hand-off is pending: the spectator view). */
  viewer: PlayerId | null;
}

/** What every snapshot carries besides the view. */
export interface SnapshotFields {
  table: string;
  seq: number;
  /** The shown player's legal priority actions (CR 117.1); empty during a hand-off and while a decision other than priority waits. */
  legal: LegalAction[];
  /** The next player to sit down (hot-seat), or null. */
  handoff: PlayerId | null;
  canUndo: boolean;
  /** A problem the screen must show (the computer could not decide), or null. */
  status: string | null;
  /** A DigiDice table's clocks; absent for local games. */
  clocks?: ClockView | null;
}

export interface ViewMessage extends SnapshotFields {
  t: 'view';
  view: GameView;
  /**
   * Addition to the Godot ARCHITECTURE.md table: when this full view is a change (a patch would have been too long, the viewer changed, the client fell
   * behind), the change's events, as a `patch` carries them; empty on `attach`.
   */
  events: GameEvent[];
}

export interface PatchMessage extends SnapshotFields {
  t: 'patch';
  /** The view this patch applies to (engine core/view-patch.ts `nextView`); a client holding another seq sends `attach` for a full view. */
  base: number;
  ops: PatchOp[];
  /** The events of this change for the animations, redacted for the viewer (CR 400.2); empty when the change applied no action. */
  events: GameEvent[];
}

export interface ActionErrorBody {
  message: string;
  rules: string[];
}

export interface ReplyMessage {
  t: 'reply';
  id: number;
  ok: boolean;
  error?: ActionErrorBody;
}

/** As the DigiDice server's (packages/hosted api.ts); online and hosted tables only (phase 4). */
export interface TableProposalMessage {
  t: 'proposal';
  proposal: ProposalView;
}

export interface TableProposalClosedMessage {
  t: 'proposalClosed';
  proposal: number;
  outcome: 'approved' | 'rejected' | 'withdrawn';
}

export interface NoticeMessage {
  t: 'notice';
  text: string;
  level: 'info' | 'warning' | 'error';
}

export interface ResultMessage {
  t: 'result';
  table: string;
  result: GameResult;
  /** The replay file's name, when the game was recorded (not in phase 1). */
  replay?: string;
}

export interface PongMessage {
  t: 'pong';
}

/** A view of a replay: its key ("seat:p1", "public", "open") and its name ("Alice", "Public", "All cards"). */
export interface ReplayViewOption {
  key: string;
  label: string;
}

/**
 * Where a watched replay is and what its viewer shows (@openmtg/play replay/connection.ts `ReplayControllerState`), sent after the table's view whenever
 * it changes: the position and the last one, the clock, the view and the views allowed, the status and its notice, the label, the timeline's ticks and
 * markers, the caption of the last change, and how many changes were shown at once (each a jump, drawn without animation or sound).
 */
export interface ReplayStateMessage {
  t: 'replayState';
  table: string;
  position: number;
  last: number;
  playing: boolean;
  speed: number | 'real';
  muteFast: boolean;
  muted: boolean;
  perspective: ReplayViewOption;
  perspectives: ReplayViewOption[];
  perspectiveFixed: boolean;
  badge: 'checking' | 'exact' | 'checked' | 'recordingFrom' | 'watchingUpTo' | 'recording' | 'unplayable';
  statusText: string;
  notice: string | null;
  progress: number | null;
  playable: boolean;
  turn: number;
  step: string;
  activePlayer: PlayerId;
  label: string;
  valueText: string;
  ticks: { position: number; turn: number; player: PlayerId; seat: number }[];
  markers: { position: number; kinds: ('spell' | 'combat' | 'life' | 'left')[] }[];
  caption: string | null;
  jumps: number;
  players: { id: PlayerId; name: string }[];
  /** "Report this bug": a game replay of this very build that plays differently here (an engine bug). */
  offersReport: boolean;
}

/**
 * The game's replay (library/replays.ts `GameRecording`), after the table's view and whenever it changes: its id, where it stands ("recording" while the
 * game goes on, "saving", "saved", "failed" with `error`, "empty" when the game had no action), Keep, the people at the screen and who of them agreed to
 * show their cards in it.
 */
export interface RecordingMessage {
  t: 'recording';
  table: string;
  id: string;
  state: 'recording' | 'saving' | 'saved' | 'failed' | 'empty';
  error: string | null;
  keep: boolean;
  people: PlayerId[];
  agreed: PlayerId[];
}

/** The moment a report is about: what it holds ("game", "replay", "view"), its kind, the action (or frame) and how many there are; or why not. */
export interface BugCapturedMessage {
  t: 'bugCaptured';
  table: string;
  id: number;
  holds?: 'game' | 'replay' | 'recording' | 'view';
  kind?: 'game' | 'recording';
  at?: number;
  length?: number;
  error?: string;
}

/** The report to save: its file name ("openmtg-bug-2026-10-29-1530.openmtg-bug-report") and its bytes in base64; or why it could not be made. */
export interface BugReportFileMessage {
  t: 'bugReportFile';
  table: string;
  id: number;
  name?: string;
  data?: string;
  error?: string;
}

/** A replay control the replay refused (a view the reveal policy does not allow), with why. */
export interface ReplayRefusedMessage {
  t: 'replayRefused';
  table: string;
  message: string;
}

export type TableServerMessage =
  | WelcomeMessage
  | ReplayStateMessage
  | ReplayRefusedMessage
  | RecordingMessage
  | BugCapturedMessage
  | BugReportFileMessage
  | TableMessage
  | ViewMessage
  | PatchMessage
  | ReplyMessage
  | TableProposalMessage
  | TableProposalClosedMessage
  | NoticeMessage
  | ResultMessage
  | PongMessage;

/** The refusal of an `act` chosen from an old view (packages/hosted table/actor.ts, the same words). */
export const STALE_MESSAGE = 'The game moved on since the view this action was chosen from; choose again from the latest view.';
