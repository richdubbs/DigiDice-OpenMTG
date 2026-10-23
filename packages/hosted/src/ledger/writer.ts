/**
 * Writing the ledger (design 7, 8.1; package M13-7): one call at the end of every started game, through the `GameStore` interface (M13-4's memory,
 * file and Postgres stores). Append-only: a game's result is written once, in the store's finishing transaction with the final record and the game's
 * status (`finishGame`); a void game is marked void or quarantined (`voidGame`) with its record (no placements; its turns, actions and per-seat
 * action counts reach `results()`, which outlive the 90-day logs: milestone 15's cap rule, design 5.5).
 */
import type { GameStore, LogRecord } from '../store/api';
import { buildGameRecord, LedgerError, voidStatus, type LedgerInput } from './record';
import type { GameRecord, VoidReason } from './types';

/** What the ledger needs of a store. */
export type LedgerStore = Pick<GameStore, 'finishGame' | 'voidGame'>;

export interface WriteResultInput extends LedgerInput {
  /**
   * True: `last` has not been committed yet and goes into `finishGame`'s transaction (design 7: the result, its placements, the final record and the
   * status at once). False or absent: every record is already committed (`appendRecords`). A void game's records are always committed first
   * (`voidGame` takes no record).
   */
  commitLast?: boolean;
}

/**
 * Builds the game's `GameRecord` (refusing one that does not add up, before anything is written) and writes it: `finishGame` for a won or drawn game,
 * `voidGame` for a void one. Returns the record (for the result metrics and the developer's log; never sent to players as is: `publicRecord`).
 */
export async function writeResult(store: LedgerStore, input: WriteResultInput): Promise<GameRecord> {
  const record = buildGameRecord(input);
  if (record.outcome === 'void') {
    if (input.commitLast) throw new LedgerError('a void game\'s records are committed with appendRecords first (voidGame takes no record)');
    const reason = record.reason as VoidReason;
    await store.voidGame(record.game, reason, voidStatus(reason), record);
    return record;
  }
  const last: LogRecord | undefined = input.commitLast && input.last ? input.last : undefined;
  if (input.commitLast && !last) throw new LedgerError('commitLast without a last record');
  await store.finishGame(record.game, record, last);
  return record;
}
