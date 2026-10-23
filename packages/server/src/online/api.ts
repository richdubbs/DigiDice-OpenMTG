/**
 * The online-play contract between the browser and its local OpenMTG server (docs/design/online.md, "Browser and local server"). Milestone 9: the
 * browser cannot open UDP sockets, so its own server plays the game over UDP (packages/net) and the browser talks to that server over a localhost
 * WebSocket with these messages.
 *
 * Browser-safe like api.ts: types and plain constants only, imports only from `@openmtg/engine`. The client imports it as
 * `import type ... from '@openmtg/server/online'` (RemoteConnection, Host and Join screens).
 *
 *   1. GET /api/online/session                    -> { token, protocol } (same origin only; never readable by another site: no CORS headers)
 *   2. new WebSocket(`ws://${location.host}/api/online/socket?token=${token}`)
 *      The upgrade is refused (403) unless Origin is exactly this server's origin (or a configured dev origin), Host is a loopback name with the
 *      server's port, and the token matches (audit 2026-10-12 m11).
 *   3. The server sends `status` at once (and the current view, if a game runs), then whenever something changes.
 *   4. The browser sends commands (`ClientMessage`), each with its own `id`; the server answers every one with a `reply` of the same id.
 *
 * One online game per server at a time. A second socket (another tab, a reload) takes over from the first, which is closed with code 4001; the game
 * goes on and the new socket gets the status and the current view. Closing the socket does not end the game: `leave` does.
 *
 * RPL-3 (replays design 6, 7.2, 16.3): replays of online games. The browser sends its player's "Show my cards in replays" (`replayConsent`, default
 * off; the status's `replay` says what the server holds). A guest's server passes on the whole game when the host shared it (`replayGame`: after the end,
 * every player agreed), also to a new socket. The host's server keeps the game's record in its data directory; its page reads it as a replay file:
 *   GET    /api/replays/online        -> OnlineReplayList (the records this server keeps, and the replay id of the game it has open)
 *   GET    /api/replays/online/<id>   -> ReplayFile (packages/engine replay/format.ts; 409 while that game is still running here)
 *   DELETE /api/replays/online/<id>   -> { ok: true } (the page has kept it)
 * Same-origin requests of this server's own page only, like GET /api/online/session.
 */
import type { Action, GameEvent, GameResult, GameView, LegalAction, PlayerId, ReplayFile } from '@openmtg/engine';

/** Path of the token request (GET). */
export const ONLINE_SESSION_PATH = '/api/online/session';
/** Path of the WebSocket upgrade; the token goes in the `token` query parameter. */
export const ONLINE_SOCKET_PATH = '/api/online/socket';
/**
 * Version of these messages; `GET /api/online/session` reports it. Bump it when a message changes shape. 2 (M12-5b): the 3-4 player fields and the
 * `spectating` phase of M12-5a (a page of version 1 would not show the seats, codes, lobby or table). 3 (RPL-3): `replayConsent`, `replayGame`, the
 * status's `replay` and the replays API (a page of version 2 would offer no "Show my cards in replays" and keep no online replay).
 */
export const ONLINE_PROTOCOL = 3;
/** RPL-3: the replays API of the host's records (see the file comment). */
export const ONLINE_REPLAYS_PATH = '/api/replays/online';
/**
 * RPL-3: the largest replay file a guest's server passes on (bytes of gzip): packages/net's REPLAY_GAME_MAX_BYTES (replays design 6: at most 1 MB). Here
 * too, browser-safe, for the page's bounded read of it.
 */
export const REPLAY_GAME_MAX_BYTES = 1024 * 1024;
/** Default UDP port a host listens on (packages/net DEFAULT_PORT). */
export const DEFAULT_GAME_PORT = 47620;
/** Largest message the server accepts from the browser (bytes; a decklist is far smaller). */
export const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;
/** WebSocket close codes the server uses (4000-4999 are for applications, RFC 6455 section 7.4.2). */
export const CLOSE_REPLACED = 4001;
export const CLOSE_PROTOCOL = 4002;
export const CLOSE_SHUTDOWN = 4003;

export interface OnlineSessionResponse {
  /** The per-launch token for the socket URL (64 hex digits). */
  token: string;
  protocol: number;
}

/** A decklist by Oracle names only (the host resolves the names with its own card data). */
export interface OnlineDeck {
  main: { name: string; count: number }[];
  sideboard: { name: string; count: number }[];
  /**
   * M11-3: the commander section (one card, or two partners: CR 903.3, 702.124); `main` is the rest of the deck (the 99). Required in a Commander format
   * (Commander, Duel Commander, Brawl, Standard Brawl: the host's `format`), refused in any other.
   */
  commander?: { name: string; count: number }[];
  /**
   * CMP1 INTERFACE CHANGE (additive): the companion section, at most one card (CR 702.139a), in any format; the host checks its condition. Absent: none
   * (an MTGO list may keep it in the sideboard: the host's validator reads it there).
   */
  companion?: { name: string; count: number }[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Browser -> server. Every command has an `id` (a positive integer the browser picks, normally counting up); the answer is a `reply` with that id.

export type ClientMessage =
  /** Ask for the status and the current view again. */
  | { t: 'status'; id: number }
  /**
   * Host a game: open UDP `port` (default 47620; 0 = any free port), make a join code, check `deck` for `format` (default "casual"). The status then
   * shows the code and the port to give the other player; the game starts when the guest joins.
   */
  | {
    t: 'host'; id: number; name: string; deck: OnlineDeck; format?: string; port?: number;
    /**
     * M12-1, M12-5a (m12 design 4.6, section 6): a 3- or 4-player game. The host gets one join code per guest seat (`OnlineStatus.codes`), the guests
     * wait in a lobby, and the game starts when every seat is taken, the players seated at random (CR 806.3).
     */
    seats?: 3 | 4;
  }
  /** Join a game: `address` is "ip:port", "[ipv6]:port" or "name:port" (the port may be left out: 47620), `code` the host's join code. */
  | { t: 'join'; id: number; address: string; code: string; name: string; deck: OnlineDeck }
  /**
   * An action for this player. The server checks its shape, that `player` is this player, and that it fits the current view (a priority action must
   * be one of `legal`, an answer must name the pending decision); then the host's engine decides (CR 733: an illegal action changes nothing).
   */
  | { t: 'act'; id: number; action: Action }
  /**
   * Accept or reject another player's manual adjustments (`manualProposal`). A two-player game: the host answers the guest's, and the
   * guest the host's. M12-5a (m12 design 4.6): in a 3-4 player game every player answers every other player's proposal (it is applied
   * when all have accepted, rejected by one).
   */
  | { t: 'manual'; id: number; proposal: number; accept: boolean; reason?: string }
  /**
   * Host only: end the game for a guest that left and does not come back (its concession, CR 104.3a). M12-5a: `player`, which guest of a 3-4 player game
   * (default: the only one whose link is down); the drop clock does it by itself after 5 minutes.
   */
  | { t: 'forfeit'; id: number; player?: PlayerId }
  | { t: 'chat'; id: number; text: string }
  /**
   * RPL-3: this player's "Show my cards in replays" (their hand, face-down cards and decklist; default off). Any time during the game and after its end,
   * until the game was shared; the host keeps every player's last choice (a player who left keeps theirs). The status's `replay.agree` follows.
   */
  | { t: 'replayConsent'; id: number; agree: boolean }
  /**
   * Leave the game (the other side is told) and go back to `idle`. Also after game over: the link stays up until a side leaves. A game still running
   * is conceded for this player first (CL4, CR 104.3a), so the other side sees its win and why before the bye.
   * M12-5a: the host of a running 3-4 player game concedes and its server keeps running the game for the others (`spectating`); a
   * second `leave` closes it (the game ends for everyone without a result). A guest's Leave concedes and the game goes on for the others.
   */
  | { t: 'leave'; id: number };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Server -> browser

export type OnlineRole = 'none' | 'host' | 'guest';
/**
 * idle: no game. starting: the host's port is opening and its deck being checked; joining: the guest is connecting. waiting: the host waits for a
 * guest (M12-5a: a 3-4 player game, host and guests: the lobby, until every seat is taken). playing. reconnecting: the guest lost the link and tries
 * again (the game waits). over: the game has a result (CR 104.1); the link stays up until a side leaves. closed: the game ended for this side
 * (`closedReason`); `leave` (or a new host or join) clears it. spectating (M12-5a): the host player left a running 3-4 player game and
 * this server keeps running it for the others ("keep OpenMTG open"); the view is the table without a hand; `leave` again closes it.
 */
export type OnlinePhase = 'idle' | 'starting' | 'joining' | 'waiting' | 'playing' | 'reconnecting' | 'over' | 'closed' | 'spectating';

export interface OnlineStatus {
  role: OnlineRole;
  phase: OnlinePhase;
  /** This side's player id (host p1, guest p2), once known. */
  me?: PlayerId;
  /** The other player's name, once known. */
  opponent?: string;
  /** Whether the other side's link is up (the host: the guest is connected; the guest: the link to the host). */
  opponentConnected?: boolean;
  format?: string;
  /** Host: the join code to give the guest (groups of four) and the UDP port actually bound (forward it on the router). */
  code?: string;
  port?: number;
  /** Guest: the address joined. */
  address?: string;
  /** Deck and version warnings (cards without legality data, a different rules pack...). */
  warnings: string[];
  result?: GameResult;
  closedReason?: string;
  /**
   * M12-1, M12-5a (m12 design 4.6, section 6): every player of the table (seat order in the lobby, seating order once the game runs, CR 806.3), with their
   * link (`connected`), whether they left the game (`left`, CR 104.5, 800.4a), and when a dropped player forfeits (`forfeitAt`, epoch ms of this machine;
   * the host's clock counts: 5 minutes). Absent in a two-player game, which keeps `opponent` and `opponentConnected`.
   */
  players?: OnlinePlayerStatus[];
  /** M12-5a: a 3-4 player game: the seats at the table, the host's included. */
  seats?: 3 | 4;
  /** M12-5a: a guest of a 3-4 player game: its seat (2-4; its player is `p<seat>`). */
  seat?: number;
  /** M12-5a: the host of a 3-4 player game: one join code per guest seat, to give each guest their own (`code` is seat 2's). */
  codes?: OnlineSeatCode[];
  /** RPL-3: the game's replay as this server knows it, once a game is open (absent while idle). */
  replay?: OnlineReplayStatus;
}

/** RPL-3 (replays design 6, 16.3): what the status says of the game's replay. */
export interface OnlineReplayStatus {
  /**
   * The replay's id in this player's library ("r-" and 20 hexadecimal digits). The host: its record's id on this server (`ONLINE_REPLAYS_PATH`/<id>).
   * A guest: the id its page records the game under, the same for every page of this game (a reloaded page goes on with the same replay).
   */
  id: string;
  /** This player's "Show my cards in replays", as this server last sent it to the host (a guest) or holds it (the host). Default off. */
  agree: boolean;
  /**
   * A guest only: the choice this player made while the link to the host was down (the other value than `agree`), sent when the link is back; until
   * then the host has `agree`, and a game that ends meanwhile counts that.
   */
  pending?: boolean;
  /** The host only: the players who agreed so far, in seating order (a player who left keeps their last choice). */
  agreed?: PlayerId[];
  /**
   * The whole game was shared with every player (the host sent it; a guest got it): after the end, every player agreed. Final: later choices change
   * nothing. False until then (and when the game was too large to send: `tooLarge`).
   */
  shared: boolean;
  /** The host only: every player agreed, but the game was too large to send (the guests keep their recordings). */
  tooLarge?: true;
}

/** RPL-3: one record the host's server keeps (GET `ONLINE_REPLAYS_PATH`). */
export interface OnlineReplayListEntry {
  id: string;
  /** ISO 8601. */
  startedAt: string;
  /** The players' names in seating order. */
  players: string[];
  /** The game ended (CR 104); a record without an end was left unfinished. */
  over: boolean;
  /** The game is still running on this server: its replay is not ready yet. */
  running: boolean;
}

export interface OnlineReplayList {
  replays: OnlineReplayListEntry[];
  /**
   * The replay id of the game this server has open now (hosting or joined, until it is left or closed), or null: a page's start-up sweep leaves that
   * game's replay alone (a guest's recording of it goes on when the page returns to the game).
   */
  open: string | null;
}

/** RPL-3: GET `ONLINE_REPLAYS_PATH`/<id>: the record as a replay file (kind 'game', mode 'onlineHost', saved by the host's player). */
export type OnlineReplayResponse = ReplayFile;

/** M12-1, M12-5a (m12 design 4.6): one player of a multiplayer online game (`OnlineStatus.players`). */
export interface OnlinePlayerStatus {
  id: PlayerId;
  name: string;
  connected: boolean;
  left?: boolean;
  forfeitAt?: number;
  /** M12-5a: the seat (1: the host). */
  seat?: number;
  /** M12-5a: false while the seat is open (the lobby; `name` is then empty). */
  taken?: boolean;
}

/** M12-5a: one guest seat's join code (`OnlineStatus.codes`). */
export interface OnlineSeatCode {
  seat: number;
  player: PlayerId;
  code: string;
  /** A guest sits there (the code is spent: only that guest's session can take the seat back). */
  taken: boolean;
}

/**
 * Manual adjustments for this player to answer (in words: what this player may know of the game, CR 400.2). A two-player game: the guest's, for the
 * host (no `player`, no `waiting`): the host's, for the guest (with `player` and `waiting`; the host's page gets its own too). M12-5a:
 * a 3-4 player game: any player's, for every other player (`player`: who proposes them; `waiting`: whose answer is still awaited). This player's own
 * proposal comes too, so the page can show who is still to answer (`player` is then `me`).
 */
export interface OnlineManualProposal {
  id: number;
  sourceName: string;
  text: string;
  lines: string[];
  player?: PlayerId;
  waiting?: PlayerId[];
}

/** Error codes of `reply` and `notice`: packages/net's NetErrorCode, plus the server's own. */
export type OnlineErrorCode =
  | 'badCode' | 'hostNotFound' | 'timeout' | 'version' | 'rulesPack' | 'deckRejected' | 'gameFull' | 'notStarted' | 'notYourPlayer' | 'illegalAction'
  | 'stale' | 'manualRejected' | 'engineError' | 'badMessage' | 'rateLimited' | 'protocol' | 'disconnected' | 'closed'
  /** The server's own: a game runs already (leave it first); no card data (host only); the UDP port is in use; this side cannot do that (host only...). */
  | 'busy' | 'noCardData' | 'portInUse' | 'notAllowed' | 'noGame';

export interface OnlineError {
  code: OnlineErrorCode;
  message: string;
  /** CR citations of an engine refusal. */
  rules?: string[];
  /** Lines to list (a deck's problems). */
  details?: string[];
}

/** M12F: one line of the table's chat as the local server keeps it (`chatHistory`). */
export interface OnlineChatLine {
  text: string;
  /** This player's own line. */
  mine?: true;
  /** Another player's line: its sender (a 3-4 player game; a two-player game's lines from the other side have none). */
  from?: PlayerId;
}

/** M12F: how many chat lines of a game the local server keeps for a reloaded page (the oldest go first). */
export const CHAT_HISTORY_LINES = 200;

export type ServerMessage =
  | { t: 'status'; status: OnlineStatus }
  /**
   * This player's view (the host's `viewFor` for this player only: CR 400.2), the events of the change redacted for this player (the event feed:
   * LocalConnection's `events()` batch), and this player's legal priority actions. `seq` (actions applied so far) only goes up.
   */
  | { t: 'view'; seq: number; view: GameView; events: GameEvent[]; legal: LegalAction[] }
  | { t: 'reply'; id: number; ok: true }
  | { t: 'reply'; id: number; ok: false; error: OnlineError }
  /** Manual adjustments to answer with `manual` (two players: each side the other's; M12-5a, 3-4 players: everyone; sent again after each answer). */
  | { t: 'manualProposal'; proposal: OnlineManualProposal }
  /**
   * The proposal was withdrawn (its player sent another action), or answered. M12-5a: `outcome` (applied, rejected by `by`, withdrawn, or failed when it
   * was applied).
   */
  | { t: 'manualClosed'; proposal: number; outcome?: 'applied' | 'rejected' | 'withdrawn' | 'failed'; by?: PlayerId }
  /** A chat line from another player. M12-5a: `from`, its sender (a 3-4 player game: every line has one). */
  | { t: 'chat'; text: string; from?: PlayerId }
  /**
   * M12F: the table's chat so far (the last CHAT_HISTORY_LINES lines of this game, oldest first, this player's own lines included), sent with the status
   * to every new socket and on `status`, so a reloaded page gets its chat back. It replaces the lines the page holds; empty when no game is open.
   */
  | { t: 'chatHistory'; lines: OnlineChatLine[] }
  /**
   * RPL-3: the whole game as a replay file, gzipped, in base64 (at most REPLAY_GAME_MAX_BYTES of gzip), for a guest: the host shared it after the end,
   * every player having agreed. Sent once when it arrives, and again to every new socket (after the status and the view). The page checks it as any
   * replay file before it keeps it.
   */
  | { t: 'replayGame'; data: string }
  /**
   * Something to tell the player: the other side left, dropped or came back, a connection was refused, the host reported an error. M12-1, M12-5a (m12
   * design 4.6): `player`, the player a notice is about in a multiplayer game (who joined the lobby, left, dropped, came back or forfeited: a forfeit is
   * `opponentLeft`).
   */
  | { t: 'notice'; kind: 'opponentJoined' | 'opponentLeft' | 'opponentDropped' | 'opponentBack' | 'refused' | 'hostError'; text: string; player?: PlayerId };
