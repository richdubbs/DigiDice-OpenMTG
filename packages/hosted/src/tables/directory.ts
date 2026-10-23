/**
 * The runtime's `TableDirectory` (runtime/api.ts; design 2.3): after a restart, where the runtime finds what a recovered game needs besides its log to
 * finish it: the ledger's seats (each seat's session and deck fingerprint) and the table's settings, read from the `games` and `seats` rows
 * (`GameStore.tableRow`). A game whose row is missing, not running, or with a seat lacking its session or fingerprint is unknown (null): the runtime voids
 * it ('recovery').
 */
import type { ClockSettings, HostedFormatId, SeatNumber, TableSize } from '../api';
import { isHostedFormat } from '../api';
import type { TableDirectory, TableMeta } from '../runtime/api';
import type { GameStore, TableRow } from '../store/api';
import type { TableLimits } from '../table/limits';

export interface DirectoryOptions {
  /** The table's clocks (tables pass `clockFor(config.clocks, format, seats)`). */
  clock?: (format: HostedFormatId, seats: TableSize) => ClockSettings;
  /** Overrides of the table's limits (tests). */
  limits?: Partial<TableLimits>;
}

/** `TableMeta` of a started game's row, or null. */
export function metaOfRow(row: TableRow, o: DirectoryOptions = {}): TableMeta | null {
  if (row.status !== 'running' || row.startedAt === null || !isHostedFormat(row.format)) return null;
  const seats = row.seatRows.filter((s) => s.session !== null);
  if (seats.length !== row.seats || seats.some((s) => s.deckHash === null)) return null;
  return {
    game: row.id,
    format: row.format,
    source: row.source,
    seats: row.seats,
    startedAt: row.startedAt.getTime(),
    ledgerSeats: seats.map((s) => ({ seat: s.seat as SeatNumber, session: s.session!, account: null, deckHash: s.deckHash! })),
    ...(o.clock ? { clock: o.clock(row.format, row.seats) } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  };
}

export class StoreTableDirectory implements TableDirectory {
  constructor(private readonly store: Pick<GameStore, 'tableRow'>, private readonly o: DirectoryOptions = {}) {}

  async meta(game: string): Promise<TableMeta | null> {
    const row = await this.store.tableRow(game);
    return row ? metaOfRow(row, this.o) : null;
  }
}
