/**
 * The gateway's seams for the packages that build on it (design 13.1). Each is optional: without it the command is answered `notYet`.
 *
 * - `LobbyService` (M13-8, design 4.2): `browse` pages and `watchLobby` live updates of the listed tables. The tables layer feeds it through its
 *   `ListingSink` (tables/hooks.ts) and `Tables.listings()`.
 * - `MatchService` (M13-9, design 4.5): the unranked quick-match queue (`queue`, `unqueue`, the match's `ready`); a queued session takes part in a game
 *   (one at a time, D6), so the tables layer asks `busy`.
 * - `ReportService` (M13-13, design 4.8): `report` into the bug inbox.
 */
import type { BrowseMessage, HostedError, LobbyFilter, LobbyListing, LobbyUpdateMessage, QueueMessage, ReportMessage, SeatNumber } from '../api';
import type { TableReply, Who } from '../tables/tables';

export interface LobbyService {
  /** One page of listed tables (at most 50) and how many match. */
  browse(m: BrowseMessage, now: number): { tables: LobbyListing[]; total: number };
  /**
   * Subscribes connection `conn` (from address key `key`) to live updates of the listed tables matching `filter`, or stops (`filter` null). `push` sends
   * a `lobbyUpdate` to that connection (the gateway's outbound budget applies; a connection that is behind drops them). A refusal (limits): an error.
   */
  watch(conn: number, key: string, filter: LobbyFilter | null, push: (m: LobbyUpdateMessage) => void, now: number): HostedError | null;
  /** The connection closed (its subscription ends). */
  closed(conn: number): void;
}

export interface MatchService {
  queue(who: Who, m: QueueMessage): Promise<TableReply>;
  /** Null: the session is not in a matchmaking queue. */
  unqueue(who: Who): Promise<TableReply | null>;
  /** A matchmaking ready check (null: not one of its ready checks). */
  ready(who: Who, start: string): TableReply | null;
  /** The session is queued or matched (it may not sit at a table). */
  busy(session: string): boolean;
  /**
   * M13-6 INTERFACE CHANGE (additive, optional): the session has had no connection for `HOSTED_TIMING.goneAfterMs` (5 minutes; a shorter drop keeps its
   * place in the queue, `FifoMatcher`'s `matchable`): its queue entry leaves (`Matcher.leave`). Called once per drop; a session that comes back first is never
   * reported. A session that sits at a table or plays is reported too (the service ignores what it does not hold).
   */
  gone?(session: string): void;
  /** M13-6 INTERFACE CHANGE (additive, optional): the server drains (design 2.3): stop matching, and tell each queued session `queueLost` (`Matcher.drain`). Called once. */
  drain?(): void;
}

export interface ReportService {
  /** `seat`: where the reporting session sits (a game id and its seat), if anywhere. */
  report(who: Who, m: ReportMessage, seat: { table: string; seat: SeatNumber } | null): Promise<TableReply>;
}

export interface GatewayHooks {
  lobby?: LobbyService;
  match?: MatchService;
  reports?: ReportService;
}
