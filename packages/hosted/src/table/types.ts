/**
 * The table actor's contract (design 2.2, 6.1-6.3; package M13-2): the commands a table takes and the step it returns for each one.
 *
 * The actor is deterministic: it never reads a clock, a random source or the network. Every command carries the server time `at` (milliseconds); the
 * same commands give the same steps, byte for byte. The runtime (M13-5) owns the mailbox, the group commit and the timer wheel; the gateway (M13-6)
 * owns the sockets, the flood gate and the frame checks; the actor owns one game.
 */
import type { Action, GameResult, PlayerId } from '@openmtg/engine';
import type { GameOutcome, HostedServerType, LossCode, PublicPlacement, SeatNumber } from '../api';
import type { VoidReason } from '../ledger/types';
import type { LogRecord } from '../store/api';

/**
 * A command for the table, in mailbox order. `seat` is the table seat of the connection it came from (the gateway knows which session sits where);
 * `at` is server time in milliseconds (a time before the table's last one is taken as that time). Fields from a browser (`action`, `text`, `reason`,
 * `seq`, `proposal`) are typed `unknown` here: the actor checks them again whatever the gateway checked (design 6.1).
 */
export type TableCommand =
  /** An engine action for this seat (`act`): `seq` is the view it was chosen from. The reply follows the change it caused. */
  | { t: 'act'; seat: SeatNumber; at: number; id: number; seq: unknown; action: unknown }
  /** Approve or reject another seat's by-hand changes (D12). */
  | { t: 'vote'; seat: SeatNumber; at: number; id: number; proposal: unknown; accept: unknown; reason?: unknown }
  /** Leave during the game: a concession (CR 104.3a), cause `left`; after the end: nothing to do but the reply. */
  | { t: 'leave'; seat: SeatNumber; at: number; id: number }
  /** A chat line to the table (never stored). The gateway's flood gate paces it. */
  | { t: 'chat'; seat: SeatNumber; at: number; id: number; text: unknown }
  /**
   * The full view again, from the seat's cached view. `id` absent: the gateway's own catch-up after a slow connection was put behind (design 3.5).
   * The gateway paces `sync` (one per 5 s per connection).
   */
  | { t: 'sync'; seat: SeatNumber; at: number; id?: number }
  /** The seat's connection is (back) in place: a full view follows (design 3.3). */
  | { t: 'connect'; seat: SeatNumber; at: number }
  /** The seat's connection dropped: its drop clock runs (design 5.3). */
  | { t: 'disconnect'; seat: SeatNumber; at: number }
  /** The timer wheel's wake-up at `nextDeadline` (design 4.4's same-instant order is the clock's). */
  | { t: 'tick'; at: number }
  /** The runtime voids the game (a failed commit, a quarantine, another engine build: design 2.3). */
  | { t: 'void'; at: number; reason: VoidReason };

export type TableCommandType = TableCommand['t'];

/** One message for one seat: its type (for routing and metrics) and its JSON text, ready for the socket (JSON work stays off the main thread). */
export interface SeatSend {
  seat: SeatNumber;
  t: HostedServerType;
  json: string;
}

/** The state at a checkpoint (every `TableLimits.checkpointEvery` records): what a snapshot stores (design 2.3), with its hash (`LogRecord.check`). */
export interface Checkpoint {
  seq: number;
  /** SHA-256 of `stateJson`, lowercase hex. */
  hash: string;
  /** The state as JSON without `defs` (the config holds them). Server only: never sent to anyone. */
  stateJson: string;
  /**
   * F31: the losses up to this checkpoint (out order, turn and the engine's citations: facts of the change's events, not of the state), so a recovery
   * can start at the snapshot after a player has lost (a 3-4 player game goes on). Absent in a snapshot written before them.
   */
  losses?: SnapshotLoss[];
}

/** F31: one player's loss as a snapshot keeps it (`TableActor`'s out order, out turn and loss citations). */
export interface SnapshotLoss {
  player: string;
  order: number;
  turn: number;
  rules: string[] | null;
}

/** Why a seat left the game by the table's own hand (design D11): the server applied its concession. Null: the engine (or the player's own concede). */
export type TableCause = 'timeout' | 'disconnect' | 'left';

/** A seat at the end of a won or drawn game: its public placement and what the ledger needs besides (design 7; M13-7 builds the `GameRecord`). */
export interface SeatOutcome extends PublicPlacement {
  player: PlayerId;
  /** 1 = first out; players out in the same change share one order. Null for players still in at the end. */
  outOrder: number | null;
  /** Bank time used (design 5.1). */
  timeUsedMs: number;
  /** 0 or 1. */
  timeouts: number;
  /** Disconnect allowance used (design 5.3; a recovery's reconnect window not counted). */
  disconnectedMs: number;
}

/** How the game ended. Produced once, in the step that ended it. */
export interface TableEnd {
  outcome: GameOutcome;
  /** The engine's `GameResult.reason`, or the void reason. */
  reason: string;
  /** The engine's result; null for a void game. */
  result: GameResult | null;
  at: number;
  /** Records applied (the last record's `seq`). */
  seq: number;
  /** Logged actions counted toward the per-game cap (setStops not counted). */
  actions: number;
  turns: number;
  /** In seat order; empty for a void game (never rated). */
  seats: SeatOutcome[];
}

/**
 * What one command produced.
 *
 * WRITE-AHEAD (design D4, 2.2 step 5-6): `records` must be committed (`GameStore.appendRecords`) before any of `sends` is delivered; a commit failure
 * voids the game (send the actor `{ t: 'void', reason: 'commit' }`). `checkpoint`, when present, is the state at its `seq`: snapshot it only after that
 * record committed (review 8). `end`, when present, goes into `finishGame` / `voidGame` with the last record.
 */
export interface TableStep {
  records: LogRecord[];
  sends: SeatSend[];
  end: TableEnd | null;
  checkpoint: Checkpoint | null;
  /** When to send the next `tick` (null: nothing runs out; the game is over). */
  nextDeadline: number | null;
}

/** An action as the log stores it (re-exported for the runtime's convenience). */
export type TableAction = Action;
/** A loss code (re-exported). */
export type TableLossCode = LossCode;
