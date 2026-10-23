/**
 * The ledger's record of a finished game (design 7; package M13-7): a `GameRecord` built from the table's end (`TableEnd`: outcome, reason, turns,
 * actions and every seat's `SeatOutcome` from the placement rule) and what only the tables layer knows (each seat's session, account and deck
 * fingerprint; the game's format, source and start). Checked before anything is written: a record that does not add up is refused, never stored.
 *
 * A void game (abandoned, a cap, a failed recovery or commit, quarantine, another build) has no placements and is never rated; its record still carries
 * the per-seat action counts (`seatActions`) milestone 15's cap rule asks about (design 5.5).
 */
import type { CommanderVariant } from '@openmtg/engine';
import { LOSS_CODES, type SeatNumber, type TableSize, type TableSource } from '../api';
import type { LogRecord } from '../store/api';
import type { SeatOutcome, TableEnd } from '../table/types';
import { VOID_REASONS, type GameRecord, type Placement, type SeatActions, type VoidReason } from './types';

/** A record the ledger refuses (the caller logs it for the developer; nothing is written). */
export class LedgerError extends Error {
  constructor(message: string) {
    super(`ledger: ${message}`);
    this.name = 'LedgerError';
  }
}

/** The game as the tables layer knows it (the `games` row). */
export interface LedgerGame {
  /** The game id (a ULID). */
  game: string;
  format: string;
  variant: CommanderVariant | null;
  seats: TableSize;
  source: TableSource;
  /** The game's start: server time in milliseconds, or a Date (`StartRow.startedAt`). */
  startedAt: number | Date;
  engineBuild: string;
}

/** A seat as the tables layer knows it (the `seats` row): never sent to a player. */
export interface LedgerSeat {
  seat: SeatNumber;
  /** The guest session id (never the token). */
  session: string;
  /** Milestone 14; null (or absent) in milestone 13. */
  account?: string | null;
  /** `deckFingerprint` of the seat's prepared deck (`SeatRow.deckHash`). */
  deckHash: string;
}

export interface LedgerInput {
  game: LedgerGame;
  /** The table's end (`TableStep.end`, `TableActor.ended`). */
  end: TableEnd;
  /** Every seat of the table, any order. */
  seats: readonly LedgerSeat[];
  /** The game's last record (committed or about to be): its clock readings give the per-seat action counts. Null or absent: no record (all 0). */
  last?: LogRecord | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_MIN = -8.64e15;
const ISO_MAX = 8.64e15;

/** ISO 8601 of a server time or a Date (clamped to the Date range; never throws). */
export function isoTime(t: number | Date): string {
  const ms = typeof t === 'number' ? t : t.getTime();
  return new Date(Number.isFinite(ms) ? Math.min(Math.max(ms, ISO_MIN), ISO_MAX) : 0).toISOString();
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Every seat's logged actions in a record's clock readings (table seats; 0 for a seat without a reading or a record written before M13-3). */
export function seatActionsOf(seats: readonly SeatNumber[], last: LogRecord | null | undefined): SeatActions[] {
  const byClock = new Map((last?.clocks ?? []).map((c) => [c.seat, c.actions ?? 0] as const));
  return [...seats].sort((a, b) => a - b).map((seat) => ({ seat, actions: byClock.get(seat) ?? 0 }));
}

function checkSeats(game: LedgerGame, seats: readonly LedgerSeat[]): void {
  if (seats.length !== game.seats) throw new LedgerError(`${seats.length} seats for a table of ${game.seats}`);
  const numbers = new Set<number>();
  for (const s of seats) {
    if (!Number.isInteger(s.seat) || s.seat < 1 || s.seat > game.seats) throw new LedgerError(`seat ${s.seat} is not a seat of a table of ${game.seats}`);
    if (numbers.has(s.seat)) throw new LedgerError(`seat ${s.seat} twice`);
    numbers.add(s.seat);
    if (typeof s.session !== 'string' || s.session === '') throw new LedgerError(`seat ${s.seat} has no session`);
    if (!HEX64.test(s.deckHash)) throw new LedgerError(`seat ${s.seat}: the deck fingerprint is not 64 lowercase hex digits`);
  }
}

function checkOutcome(o: SeatOutcome, n: number): void {
  if (!Number.isInteger(o.place) || o.place < 1 || o.place > n) throw new LedgerError(`seat ${o.seat}: place ${o.place} of ${n}`);
  if (o.loss !== null && !LOSS_CODES.includes(o.loss)) throw new LedgerError(`seat ${o.seat}: unknown loss code ${String(o.loss)}`);
  if ((o.loss === null) !== (o.lossRule === null)) throw new LedgerError(`seat ${o.seat}: a loss and its rule go together`);
  if (!isCount(o.timeUsedMs) || !isCount(o.disconnectedMs)) throw new LedgerError(`seat ${o.seat}: time used and disconnected time are counts of milliseconds`);
  if (o.timeouts !== 0 && o.timeouts !== 1) throw new LedgerError(`seat ${o.seat}: timeouts is 0 or 1`);
  if (o.outOrder !== null && (!Number.isInteger(o.outOrder) || o.outOrder < 1)) throw new LedgerError(`seat ${o.seat}: out order ${o.outOrder}`);
  if (o.outTurn !== null && !isCount(o.outTurn)) throw new LedgerError(`seat ${o.seat}: out turn ${o.outTurn}`);
}

/** Checks a won or drawn end's placements against the result: one winner in 1st place without a loss, or (a draw) nobody without one. */
function checkPlacements(end: TableEnd, n: number, seatNumbers: ReadonlySet<number>): void {
  if (!end.result) throw new LedgerError(`a ${end.outcome} without the engine's result`);
  if (end.seats.length !== n) throw new LedgerError(`${end.seats.length} placements for a table of ${n}`);
  const seen = new Set<number>();
  for (const o of end.seats) {
    if (!seatNumbers.has(o.seat) || seen.has(o.seat)) throw new LedgerError(`placement for seat ${o.seat} does not match the table's seats`);
    seen.add(o.seat);
    checkOutcome(o, n);
  }
  const winners = end.seats.filter((o) => o.loss === null);
  if (end.outcome === 'win') {
    if (end.result.winner === null) throw new LedgerError('a win without a winner');
    if (winners.length !== 1 || winners[0]!.player !== end.result.winner || winners[0]!.place !== 1) throw new LedgerError('a win needs exactly one winner, 1st, without a loss');
    if (end.seats.some((o) => o.loss === 'draw')) throw new LedgerError('a won game has no draws');
    if (end.seats.some((o) => o.loss !== null && o.place === 1)) throw new LedgerError('only the winner is 1st in a won game');
  } else {
    if (end.result.winner !== null) throw new LedgerError('a draw with a winner');
    if (winners.length !== 0) throw new LedgerError('a drawn game has no winner');
    if (!end.seats.some((o) => o.loss === 'draw' && o.place === 1)) throw new LedgerError('a drawn game has players who drew, 1st');
  }
}

/**
 * The `GameRecord` of a game's end (see the file comment). Placements in seat order; `ranked` false (milestone 13). Throws `LedgerError` for a record
 * that does not add up (seats, places, loss codes, the winner, a void reason, the fingerprints).
 */
export function buildGameRecord(input: LedgerInput): GameRecord {
  const { game, end, seats, last } = input;
  if (typeof game.game !== 'string' || game.game === '') throw new LedgerError('no game id');
  if (last && last.game !== game.game) throw new LedgerError(`the last record is of game ${last.game}, not ${game.game}`);
  if (last && last.seq !== end.seq) throw new LedgerError(`the last record has seq ${last.seq}; the game ended at ${end.seq}`);
  if (!isCount(end.turns) || !isCount(end.actions) || !isCount(end.seq)) throw new LedgerError('turns, actions and seq are counts');
  checkSeats(game, seats);
  const bySeat = new Map(seats.map((s) => [s.seat, s] as const));
  const seatActions = seatActionsOf(seats.map((s) => s.seat), last);
  const base = {
    game: game.game, format: game.format, variant: game.variant, seats: game.seats, source: game.source, ranked: false as const, outcome: end.outcome,
    reason: end.reason, turns: end.turns, actions: end.actions, startedAt: isoTime(game.startedAt), endedAt: isoTime(end.at), engineBuild: game.engineBuild,
  };
  if (end.outcome === 'void') {
    if (!(VOID_REASONS as readonly string[]).includes(end.reason)) throw new LedgerError(`unknown void reason ${end.reason}`);
    if (end.seats.length !== 0 || end.result !== null) throw new LedgerError('a void game has no placements and no result');
    return { ...base, placements: [], seatActions };
  }
  if (end.outcome !== 'win' && end.outcome !== 'draw') throw new LedgerError(`unknown outcome ${String(end.outcome)}`);
  checkPlacements(end, game.seats, new Set(bySeat.keys()));
  const placements: Placement[] = [...end.seats]
    .sort((a, b) => a.seat - b.seat)
    .map((o) => {
      const s = bySeat.get(o.seat)!;
      return {
        seat: o.seat, name: o.name, place: o.place, loss: o.loss, lossRule: o.lossRule, outTurn: o.outTurn,
        player: o.player, session: s.session, account: s.account ?? null, deckHash: s.deckHash, outOrder: o.outOrder,
        timeUsedMs: o.timeUsedMs, timeouts: o.timeouts, disconnectedMs: o.disconnectedMs,
      };
    });
  return { ...base, placements, seatActions };
}

/** A void reason's record status (`GameStore.voidGame`): quarantine keeps its own status (design D5). */
export function voidStatus(reason: VoidReason): 'void' | 'quarantined' {
  return reason === 'quarantined' ? 'quarantined' : 'void';
}
