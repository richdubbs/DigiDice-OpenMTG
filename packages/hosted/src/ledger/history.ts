/**
 * Reading the ledger (design 7, review 7; package M13-7): the public projection of a game's record for clients, a session's match history and its
 * totals. Every reader builds new objects field by field: nothing of a placement's server-only part (session, account, deck fingerprint, player id,
 * out order, time used, time-outs, disconnected time) nor of the record's (engine build, action counts) is copied.
 */
import type { CommanderVariant } from '@openmtg/engine';
import type { GameOutcome, PublicPlacement, TableSize, TableSource } from '../api';
import type { GameStore } from '../store/api';
import { publicPlacement, publicPlacements, type GameRecord } from './types';

/** A game's record as any player may see it. */
export interface PublicGameRecord {
  game: string;
  format: string;
  variant: CommanderVariant | null;
  seats: TableSize;
  source: TableSource;
  ranked: boolean;
  outcome: GameOutcome;
  reason: string;
  turns: number;
  startedAt: string;
  endedAt: string;
  /** Best place first, ties in seat order (`publicPlacements`). */
  placements: PublicPlacement[];
}

/** The fields of `PublicGameRecord`, in order (pinned by test/m13-7). */
export const PUBLIC_RECORD_KEYS = [
  'game', 'format', 'variant', 'seats', 'source', 'ranked', 'outcome', 'reason', 'turns', 'startedAt', 'endedAt', 'placements',
] as const satisfies readonly (keyof PublicGameRecord)[];

/** The public projection of a record: a new object with exactly `PUBLIC_RECORD_KEYS`. */
export function publicRecord(r: GameRecord): PublicGameRecord {
  return {
    game: r.game, format: r.format, variant: r.variant, seats: r.seats, source: r.source, ranked: r.ranked, outcome: r.outcome, reason: r.reason,
    turns: r.turns, startedAt: r.startedAt, endedAt: r.endedAt, placements: publicPlacements(r.placements),
  };
}

/** One game of a session's match history: the public record and the session's own placement. */
export interface HistoryEntry extends PublicGameRecord {
  you: PublicPlacement;
}

/** Newest first: by end time, then the game id (ULIDs sort by time). */
const newestFirst = (a: GameRecord, b: GameRecord): number => (a.endedAt < b.endedAt ? 1 : a.endedAt > b.endedAt ? -1 : a.game < b.game ? 1 : a.game > b.game ? -1 : 0);

/** A session's games among `records` (won or drawn: a void game has no placements), newest first, at most `limit`. */
export function historyFor(records: readonly GameRecord[], session: string, limit = 50): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const r of [...records].sort(newestFirst)) {
    if (out.length >= limit) break;
    if (seen.has(r.game)) continue;
    const mine = r.placements.find((p) => p.session === session);
    if (!mine) continue;
    seen.add(r.game);
    out.push({ ...publicRecord(r), you: publicPlacement(mine) });
  }
  return out;
}

export interface ReadHistoryOptions {
  /** The earliest end time read. */
  since: Date;
  /** Entries returned, newest first (default 50). */
  limit?: number;
}

/**
 * A session's match history from a store: its newest games through the store's by-session query (`sessionResults`, on the placements' session
 * index), then `historyFor`.
 */
export async function readHistory(store: Pick<GameStore, 'sessionResults'>, session: string, o: ReadHistoryOptions): Promise<HistoryEntry[]> {
  const limit = Math.max(0, o.limit ?? 50);
  return historyFor(await store.sessionResults(session, { since: o.since, limit }), session, limit);
}

/** A session's totals: games won, drawn and lost (1st place without a loss is a win), overall and by format. */
export interface HistoryTotals {
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface SessionSummary extends HistoryTotals {
  byFormat: Record<string, HistoryTotals>;
}

/** The totals of a session's history entries. */
export function summaryOf(entries: readonly HistoryEntry[]): SessionSummary {
  const zero = (): HistoryTotals => ({ games: 0, wins: 0, draws: 0, losses: 0 });
  const all: SessionSummary = { ...zero(), byFormat: Object.create(null) as Record<string, HistoryTotals> }; // no prototype: a format is only a key
  for (const e of entries) {
    const f = (all.byFormat[e.format] ??= zero());
    const kind = e.you.loss === null ? 'wins' : e.you.loss === 'draw' ? 'draws' : 'losses';
    for (const t of [all, f]) {
      t.games++;
      t[kind]++;
    }
  }
  return all;
}
