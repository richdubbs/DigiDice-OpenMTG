/**
 * Fixtures of M15-5's tests (the abuse heuristics, design 11.1, 17.8): a read-only fake of the store the checks read (`AbuseContext['store']`, with
 * the keyset paging of 13.3 and a log of every call), a fake of milestone 14's `standings`, and builders of history rows, cap events and season
 * records. Fixed inputs only: no test depends on chance or on the wall clock.
 */
import type { AccountId, Standing } from '@openmtg/accounts/api';
import {
  LADDERS, WENGLIN, type AbuseContext, type AppliedGame, type AppliedSeat, type CapEvent, type CapVerdict, type HistoryRow, type IntakeCursor,
  type LadderId, type LossCode, type PenaltyRow, type Place, type RatingState, type SeasonRecord, type SeatNo, type TierId,
} from '@openmtg/ladder';

/** The thresholds as design 11.1 wrote them, before M15-6's tuning: these tests pin each rule's mechanics at them (their fixtures were built so). */
export { DESIGN_ABUSE_RULES as RULES_11_1 } from '../sim/recommend';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
/** The anchor of most tests: 15 October 2026, 12:00 UTC (the fake clock's start). */
export const NOW = '2026-10-15T12:00:00.000Z';
export const NOW_MS = Date.parse(NOW);

/** The ISO time `days` days before NOW (fractional days allowed, whole ms). */
export function ago(days: number, from = NOW_MS): string {
  return new Date(from - Math.round(days * DAY_MS)).toISOString();
}

/** An account id in milestone 14's shape; `n` orders them (acc(1) < acc(2) < ...). */
export function acc(n: number): AccountId {
  return `acc_0${String(n).padStart(25, '0')}` as AccountId;
}
export const A = acc(1);
export const B = acc(2);
export const C = acc(3);
export const D = acc(4);
export const E = acc(5);
export const F = acc(6);

// ---- history rows ---------------------------------------------------------------------------------------------------------------------------

export interface SeatSpec {
  account: AccountId | null;
  place: Place;
  /** Default: null for a place-1 seat alone at 1, 'draw' for a shared first place, else 'life'. */
  loss?: LossCode | null;
  /** Default: null for a seat with no loss, else the game's last turn. */
  outTurn?: number | null;
  /** Shown rating before and after (default 1500 and 1500). */
  from?: number;
  to?: number;
  /**
   * In placement: the rating is hidden (displayBefore and displayAfter null; the states stay). 'ends': the game that ends placement (the 10th, as
   * M15-3 applies it): hidden before it, shown after it.
   */
  placement?: boolean | 'ends';
}

function state(ladder: LadderId, shown: number): RatingState {
  return LADDERS[ladder].model === 'glicko2'
    ? { model: 'glicko2', r: shown, rd: 80, vol: 0.06 }
    : { model: 'wenglin', mu: WENGLIN.mu0 + (shown - 1500) / WENGLIN.displayScale, sigma: 3 };
}

/** A history row: game `id` ended at `endedAt` in `ladder` (default 1v1-standard) after `turns` turns (default 8). */
export function row(id: string, endedAt: string, specs: SeatSpec[], o: { ladder?: LadderId; turns?: number } = {}): HistoryRow {
  const ladder = o.ladder ?? '1v1-standard';
  const turns = o.turns ?? 8;
  const firsts = specs.filter((s) => s.place === 1).length;
  const seats: AppliedSeat[] = specs.map((s, i) => {
    const loss = s.loss !== undefined ? s.loss : s.place === 1 ? (firsts > 1 ? 'draw' : null) : 'life';
    const from = s.from ?? 1500;
    const to = s.to ?? 1500;
    const deleted = s.account === null;
    return {
      seat: (i + 1) as SeatNo,
      account: s.account,
      name: deleted ? 'Deleted player' : `Player ${i + 1}`,
      place: s.place,
      loss,
      lossRule: loss === null ? null : 'CR 104.3a',
      outTurn: s.outTurn !== undefined ? s.outTurn : loss === null || loss === 'draw' ? null : turns,
      before: deleted ? null : state(ladder, from),
      awayMs: 0,
      after: deleted ? null : state(ladder, to),
      displayBefore: deleted || s.placement ? null : from,
      displayAfter: deleted || s.placement === true ? null : to,
      tierAfter: deleted || s.placement === true ? null : 'pulse',
    };
  });
  return { game: id, ladder, season: endedAt.slice(0, 7), endedAt, outcome: firsts === 1 ? 'win' : 'draw', turns, seats };
}

/** A 1v1 game `winner` beat `loser`; `o.loss` and `o.outTurn` say how the loser went out; `o.w` and `o.l` are [from, to] shown ratings. */
export function win(
  id: string,
  endedAt: string,
  winner: AccountId,
  loser: AccountId,
  o: { loss?: LossCode; outTurn?: number; turns?: number; w?: [number, number]; l?: [number, number]; placement?: 'winner' | 'loser' | 'both'; ladder?: LadderId } = {},
): HistoryRow {
  return row(id, endedAt, [
    { account: winner, place: 1, from: o.w?.[0], to: o.w?.[1], placement: o.placement === 'winner' || o.placement === 'both' },
    {
      account: loser, place: 2, loss: o.loss ?? 'life', outTurn: o.outTurn, from: o.l?.[0], to: o.l?.[1],
      placement: o.placement === 'loser' || o.placement === 'both',
    },
  ], { turns: o.turns, ladder: o.ladder });
}

/** The AppliedGame of a history row (what the service hands afterGame once applyGame stored it). */
export function applied(r: HistoryRow, cap: CapEvent | null = null): AppliedGame {
  return { ...structuredClone(r), appliedAt: r.endedAt, ratings: [], seasonRecords: [], cap };
}

// ---- cap events and season records ----------------------------------------------------------------------------------------------------------

/** A cap event of `game` at `at`; `seats` are [account, share]; `driver` is the 1-based seat of the driver, or null for a void verdict. */
export function capEvent(game: string, at: string, seats: [AccountId | null, number][], driver: SeatNo | null, o: { ladder?: LadderId; kind?: 'actions' | 'time' } = {}): CapEvent {
  const verdict: CapVerdict = driver === null ? { kind: 'void' } : { kind: 'driver', seat: driver, share: seats[driver - 1]![1] };
  return {
    game, ladder: o.ladder ?? '1v1-standard', at, kind: o.kind ?? 'actions', verdict,
    seats: seats.map(([account, share], i) => ({ seat: (i + 1) as SeatNo, account, initiated: Math.round(share * 1000), chargedMs: 0, share })),
  };
}

/** A closed season's record with the fields parkedHigh reads; the rest are plain defaults. */
export function seasonRecord(
  account: AccountId | null,
  o: { ladder?: LadderId; season?: string; display: number; ratings: number[]; lastGameAt: string; finalRank?: number | null; badge?: TierId | null; sortKey?: string },
): SeasonRecord {
  return {
    account, ladder: o.ladder ?? '1v1-standard', season: o.season ?? '2026-09', sortKey: o.sortKey ?? account ?? 'deleted:00000000000000000000000000',
    listed: true, games: o.ratings.length + 10, wins: 0, draws: 0, losses: 0, places: null, display: o.display, deviation: 70, standing: o.display - 140,
    provisionalFrom: null, peak: Math.max(o.display, ...o.ratings), tier: 'laser', peakTier: 'laser', seasonRatings: o.ratings, careerGames: 60,
    lastGameAt: o.lastGameAt, finalStanding: o.display - 140, finalRank: o.finalRank ?? null, badge: o.badge ?? null,
  };
}

// ---- the fake store and directory -----------------------------------------------------------------------------------------------------------

function cmp(a: { endedAt: string; game: string }, b: { endedAt: string; game: string }): number {
  return Date.parse(a.endedAt) - Date.parse(b.endedAt) || (a.game < b.game ? -1 : a.game > b.game ? 1 : 0);
}

type AbuseStore = AbuseContext['store'];

const READS = ['pairGames', 'history', 'gamesSince', 'capEvents', 'penalties', 'seasonRecord', 'seasonRecordsOf'] as const;

/** The reads of 13.3 the checks may use, over plain arrays, returning copies; every call is logged. No write method exists. */
export class FakeAbuseStore implements AbuseStore {
  rows: HistoryRow[] = [];
  caps: CapEvent[] = [];
  penaltyRows = new Map<AccountId, PenaltyRow>();
  records: SeasonRecord[] = [];
  readonly calls: { method: (typeof READS)[number]; args: unknown[] }[] = [];

  add(...rows: HistoryRow[]): this {
    this.rows.push(...rows);
    return this;
  }

  callsOf(method: (typeof READS)[number]): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  async pairGames(a: AccountId, b: AccountId, ladder: LadderId, since: string): Promise<HistoryRow[]> {
    this.calls.push({ method: 'pairGames', args: [a, b, ladder, since] });
    const has = (r: HistoryRow, x: AccountId) => r.seats.some((s) => s.account === x);
    return structuredClone(this.rows.filter((r) => r.ladder === ladder && has(r, a) && has(r, b) && r.endedAt >= since).sort(cmp));
  }

  /** Newest first; `before` is exclusive. */
  async history(q: { account: AccountId; ladder?: LadderId; before?: IntakeCursor; limit: number }): Promise<HistoryRow[]> {
    this.calls.push({ method: 'history', args: [structuredClone(q)] });
    const mine = this.rows
      .filter((r) => r.seats.some((s) => s.account === q.account) && (q.ladder === undefined || r.ladder === q.ladder))
      .filter((r) => q.before === undefined || cmp(r, q.before) < 0)
      .sort((x, y) => cmp(y, x));
    return structuredClone(mine.slice(0, q.limit));
  }

  /** Oldest first, from `since` (inclusive); `after` is exclusive. */
  async gamesSince(q: { ladder?: LadderId; since: string; after?: IntakeCursor; limit: number }): Promise<HistoryRow[]> {
    this.calls.push({ method: 'gamesSince', args: [structuredClone(q)] });
    const rows = this.rows
      .filter((r) => (q.ladder === undefined || r.ladder === q.ladder) && Date.parse(r.endedAt) >= Date.parse(q.since))
      .filter((r) => q.after === undefined || cmp(r, q.after) > 0)
      .sort(cmp);
    return structuredClone(rows.slice(0, q.limit));
  }

  async capEvents(account: AccountId, since: string): Promise<CapEvent[]> {
    this.calls.push({ method: 'capEvents', args: [account, since] });
    return structuredClone(this.caps.filter((e) => e.seats.some((s) => s.account === account) && Date.parse(e.at) >= Date.parse(since)));
  }

  async penalties(account: AccountId): Promise<PenaltyRow | null> {
    this.calls.push({ method: 'penalties', args: [account] });
    return structuredClone(this.penaltyRows.get(account) ?? null);
  }

  async seasonRecord(account: AccountId, ladder: LadderId, season: string): Promise<SeasonRecord | null> {
    this.calls.push({ method: 'seasonRecord', args: [account, ladder, season] });
    return structuredClone(this.records.find((r) => r.account === account && r.ladder === ladder && r.season === season) ?? null);
  }

  /** By sortKey; `after` is exclusive. */
  async seasonRecordsOf(ladder: LadderId, season: string, after: string | null, limit: number): Promise<SeasonRecord[]> {
    this.calls.push({ method: 'seasonRecordsOf', args: [ladder, season, after, limit] });
    const rows = this.records
      .filter((r) => r.ladder === ladder && r.season === season && (after === null || r.sortKey > after))
      .sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0));
    return structuredClone(rows.slice(0, limit));
  }
}

/** Accounts made long ago unless `created` says otherwise (milestone 14's Standing.createdAt, the smurf rule's age). */
export function directory(created: Partial<Record<AccountId, string>> = {}): AbuseContext['accounts'] & { asked: AccountId[][] } {
  const asked: AccountId[][] = [];
  return {
    asked,
    async standings(ids: readonly AccountId[]): Promise<Map<AccountId, Standing>> {
      asked.push([...ids]);
      return new Map(ids.map((id) => [id, {
        account: id, status: 'active', ranked: true, listed: true, chat: true, until: null, createdAt: created[id] ?? '2025-01-01T00:00:00.000Z',
      } satisfies Standing]));
    },
  };
}

export function context(store: FakeAbuseStore, o: { now?: string; created?: Partial<Record<AccountId, string>> } = {}): AbuseContext {
  return { store, accounts: directory(o.created), now: o.now ?? NOW };
}
