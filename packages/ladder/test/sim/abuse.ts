/**
 * M15-6: M15-5's abuse heuristics run over simulated play (design 11.1, 17.11: "honest simulated play files no oneSided or sandbagging report and
 * fewer than 1 in 1,000 accounts get any report").
 *
 * The checker is the real one (createAbuseChecker, with ABUSE_RULES or swept overrides), called as the service calls it: `afterGame` after every
 * rated game, `afterMiss` after every missed ready check, `daily` at the first sweep of each UTC day with the seasons closed since. What it reads is
 * this file's `SimAbuseStore`: the reads of AbuseContext over the simulation's own history, indexed by account, pair and time, because the memory
 * store scans every row on every read (fine for tests, too slow for a few hundred thousand games). Its answers follow the memory store's
 * (src/store/memory.ts: the same filters, orders and limits); test/sim/service.test.ts runs a small simulation through the real LadderService and
 * finds the same reports.
 *
 * Reports are counted as the service files them (src/service/reports.ts): one per kind, ladder, sorted accounts and 7-day window of the filing time.
 */
import type { AccountDirectory, AccountId, Standing } from '../../src/accounts';
import type { LadderId, SeasonId } from '../../src/api';
import { createAbuseChecker } from '../../src/abuse/index';
import type { AbuseChecker, AbuseContext, AbuseDraft, AbuseKind, AbuseRules } from '../../src/abuse/types';
import type { AppliedGame, CapEvent, HistoryRow, IntakeCursor, PenaltyRow, SeasonRecord } from '../../src/store/api';
import { REPORT_WINDOW_MS } from '../../src/service/reports';

type Store = AbuseContext['store'];

function cmpText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Indexed { row: HistoryRow; ms: number }

/** (ms, game) of x before (ms, game) of y. */
function before(x: { ms: number; game: string }, y: { ms: number; game: string }): boolean {
  return x.ms < y.ms || (x.ms === y.ms && x.game < y.game);
}

/** The first index whose row is not before (ms, game). */
function lowerBound(list: readonly Indexed[], ms: number, game: string): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const m = list[mid]!;
    if (before({ ms: m.ms, game: m.row.game }, { ms, game })) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Inserts keeping (ms, game) order (rows come in end order; equal end times are put in game order). */
function insert(list: Indexed[], x: Indexed): void {
  let i = list.length;
  while (i > 0 && before({ ms: x.ms, game: x.row.game }, { ms: list[i - 1]!.ms, game: list[i - 1]!.row.game })) i--;
  list.splice(i, 0, x);
}

/** AbuseContext's store over the simulation's history. */
export class SimAbuseStore implements Store {
  readonly #all: Indexed[] = [];
  readonly #byAccount = new Map<AccountId, Indexed[]>();
  readonly #byPair = new Map<string, Indexed[]>();
  readonly #misses = new Map<AccountId, string[]>();
  readonly #records: (ladder: LadderId, season: SeasonId) => SeasonRecord[];

  /** `records`: every season record of a ladder and season, any order (seasonRecord and seasonRecordsOf read it). */
  constructor(records: (ladder: LadderId, season: SeasonId) => SeasonRecord[]) {
    this.#records = records;
  }

  add(row: HistoryRow): void {
    const x: Indexed = { row, ms: Date.parse(row.endedAt) };
    insert(this.#all, x);
    const accounts = row.seats.flatMap((s) => (s.account === null ? [] : [s.account]));
    for (const a of accounts) {
      let list = this.#byAccount.get(a);
      if (list === undefined) this.#byAccount.set(a, (list = []));
      insert(list, x);
    }
    for (let i = 0; i < accounts.length; i++) {
      for (let j = i + 1; j < accounts.length; j++) {
        const key = pairKey(accounts[i]!, accounts[j]!);
        let list = this.#byPair.get(key);
        if (list === undefined) this.#byPair.set(key, (list = []));
        insert(list, x);
      }
    }
  }

  setMisses(account: AccountId, misses: readonly string[]): void {
    this.#misses.set(account, [...misses]);
  }

  get games(): number {
    return this.#all.length;
  }

  async history(q: { account: AccountId; ladder?: LadderId; before?: IntakeCursor; limit: number }): Promise<HistoryRow[]> {
    const list = this.#byAccount.get(q.account) ?? [];
    let i = q.before === undefined ? list.length : lowerBound(list, Date.parse(q.before.endedAt), q.before.game);
    const out: HistoryRow[] = [];
    while (--i >= 0 && out.length < q.limit) {
      const r = list[i]!.row;
      if (q.ladder === undefined || r.ladder === q.ladder) out.push(r);
    }
    return out;
  }

  async pairGames(a: AccountId, b: AccountId, ladder: LadderId, since: string): Promise<HistoryRow[]> {
    if (a === b) return [];
    const list = this.#byPair.get(pairKey(a, b)) ?? [];
    const sinceMs = Date.parse(since);
    const out: HistoryRow[] = [];
    for (let i = lowerBound(list, sinceMs, ''); i < list.length; i++) if (list[i]!.row.ladder === ladder) out.push(list[i]!.row);
    return out;
  }

  async gamesSince(q: { ladder?: LadderId; since: string; after?: IntakeCursor; limit: number }): Promise<HistoryRow[]> {
    const sinceMs = Date.parse(q.since);
    let i = lowerBound(this.#all, sinceMs, '');
    if (q.after !== undefined) {
      const afterMs = Date.parse(q.after.endedAt);
      // strictly after the cursor
      let j = lowerBound(this.#all, afterMs, q.after.game);
      while (j < this.#all.length && this.#all[j]!.ms === afterMs && this.#all[j]!.row.game === q.after.game) j++;
      i = Math.max(i, j);
    }
    const out: HistoryRow[] = [];
    for (; i < this.#all.length && out.length < q.limit; i++) {
      const r = this.#all[i]!.row;
      if (q.ladder === undefined || r.ladder === q.ladder) out.push(r);
    }
    return out;
  }

  /** The simulation plays no game to a per-game cap (8.5): capStall never has evidence. */
  async capEvents(): Promise<CapEvent[]> {
    return [];
  }

  async penalties(account: AccountId): Promise<PenaltyRow | null> {
    const misses = this.#misses.get(account);
    return misses === undefined ? null : { account, misses: [...misses], cooldownUntil: null };
  }

  async seasonRecord(account: AccountId, ladder: LadderId, season: SeasonId): Promise<SeasonRecord | null> {
    return this.#records(ladder, season).find((r) => r.account === account) ?? null;
  }

  async seasonRecordsOf(ladder: LadderId, season: SeasonId, after: string | null, limit: number): Promise<SeasonRecord[]> {
    return this.#records(ladder, season)
      .filter((r) => after === null || r.sortKey > after)
      .sort((a, b) => cmpText(a.sortKey, b.sortKey))
      .slice(0, limit);
  }
}

function pairKey(a: AccountId, b: AccountId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Milestone 14's directory as the simulation needs it: every account active and listed, created when it arrived. */
export class SimDirectory implements AccountDirectory {
  readonly #created = new Map<AccountId, string>();

  add(account: AccountId, createdAt: string): void {
    this.#created.set(account, createdAt);
  }

  async standing(id: AccountId): Promise<Standing | null> {
    const createdAt = this.#created.get(id);
    return createdAt === undefined ? null : { account: id, status: 'active', ranked: true, listed: true, chat: true, until: null, createdAt };
  }

  async standings(ids: readonly AccountId[]): Promise<Map<AccountId, Standing>> {
    const out = new Map<AccountId, Standing>();
    for (const id of ids) {
      const s = await this.standing(id);
      if (s !== null) out.set(id, s);
    }
    return out;
  }

  async names(ids: readonly AccountId[]): Promise<Map<AccountId, string>> {
    return new Map(ids.filter((id) => this.#created.has(id)).map((id) => [id, nameOf(id)]));
  }

  async blockedAmong(): Promise<[AccountId, AccountId][]> {
    return [];
  }

  async silenced(): Promise<boolean> {
    return false;
  }

  async privacy(ids: readonly AccountId[]) {
    return new Map(ids.filter((id) => this.#created.has(id)).map((id) => [id, { history: 'public' as const, leaderboards: true, guestsAtMyTables: true }]));
  }

  async displayNameAt(id: AccountId, nameAtTheTime: string, viewer?: AccountId | null): Promise<string> {
    return viewer === id ? nameAtTheTime : nameOf(id);
  }

  async historyVisible(id: AccountId): Promise<boolean> {
    return this.#created.has(id);
  }
}

/** The simulation's account ids: "acc_" and 26 digits (digits are Crockford base32; the shape of ACCOUNT_ID_SHAPE). */
export function simAccount(i: number): AccountId {
  return `acc_${String(i).padStart(26, '0')}` as AccountId;
}

export function nameOf(id: AccountId): string {
  return `Player ${Number(id.slice(4))}`;
}

/** What the checker filed over a run, as the service's outbox would hold it. */
export interface ReportTally {
  /** Distinct reports (kind, ladder, sorted accounts, 7-day window). */
  reports: number;
  byKind: Partial<Record<AbuseKind, number>>;
  /** Accounts named by any report. */
  accounts: Set<AccountId>;
  /** The keys "kind|ladder|accounts|window", for the service cross-check. */
  keys: Set<string>;
  /** The first few reports of each kind, as filed (for the report's examples). */
  samples: Partial<Record<AbuseKind, AbuseDraft[]>>;
  /** Every report as filed: its kind, its filing time and its accounts. */
  filed: { kind: AbuseKind; ms: number; accounts: AccountId[] }[];
}

export function emptyTally(): ReportTally {
  return { reports: 0, byKind: {}, accounts: new Set(), keys: new Set(), samples: {}, filed: [] };
}

const SAMPLES_PER_KIND = 5;

/** The checker over the simulation's store, filing drafts into a tally. */
export class SimAbuseRunner {
  readonly store: SimAbuseStore;
  readonly directory: SimDirectory;
  readonly checker: AbuseChecker;
  readonly tally: ReportTally = emptyTally();

  constructor(store: SimAbuseStore, directory: SimDirectory, rules?: Readonly<AbuseRules>) {
    this.store = store;
    this.directory = directory;
    this.checker = createAbuseChecker(rules);
  }

  #ctx(nowMs: number): AbuseContext {
    return { store: this.store, accounts: this.directory, now: new Date(nowMs).toISOString() };
  }

  file(drafts: readonly AbuseDraft[], nowMs: number): void {
    for (const d of drafts) {
      const accounts = [...d.accounts].sort((a, b) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : cmpText(a, b)));
      const key = [d.kind, d.ladder ?? '', accounts.map((a) => a ?? '').join(','), String(Math.floor(nowMs / REPORT_WINDOW_MS))].join('|');
      if (this.tally.keys.has(key)) continue;
      this.tally.keys.add(key);
      this.tally.reports++;
      this.tally.byKind[d.kind] = (this.tally.byKind[d.kind] ?? 0) + 1;
      for (const a of accounts) if (a !== null) this.tally.accounts.add(a);
      this.tally.filed.push({ kind: d.kind, ms: nowMs, accounts: accounts.filter((a): a is AccountId => a !== null) });
      const samples = (this.tally.samples[d.kind] ??= []);
      if (samples.length < SAMPLES_PER_KIND) samples.push(structuredClone(d));
    }
  }

  /** After a rated game (the service's intake: filed at the game's end in the simulation). */
  async afterGame(g: AppliedGame): Promise<void> {
    const nowMs = Date.parse(g.endedAt);
    this.file(await this.checker.afterGame(g, this.#ctx(nowMs)), nowMs);
  }

  async afterMiss(account: AccountId, misses: readonly string[], nowMs: number): Promise<void> {
    this.file(await this.checker.afterMiss(account, misses, this.#ctx(nowMs)), nowMs);
  }

  async daily(closedSeasons: readonly { ladder: LadderId; season: SeasonId }[], nowMs: number): Promise<void> {
    this.file(await this.checker.daily(closedSeasons, this.#ctx(nowMs)), nowMs);
  }
}

/** What the checks read, in the order the service would have called them: a run recorded once, checked again under other thresholds. */
export type AbuseEvent =
  | { kind: 'game'; ms: number; row: HistoryRow }
  | { kind: 'miss'; ms: number; account: AccountId; misses: string[] }
  | { kind: 'daily'; ms: number; closed: SeasonId[] };

export interface RecordedHistory {
  ladder: LadderId;
  events: AbuseEvent[];
  /** Each closed season's records as the close left them (parkedHigh reads them). */
  records: Map<SeasonId, SeasonRecord[]>;
  /** Every account and when it was created (milestone 14's createdAt, the smurf rule's age). */
  created: [AccountId, string][];
}

/**
 * The checks over a recorded run with `rules` (the service's calls in the same order: afterGame after each game, afterMiss after each miss, daily
 * with the seasons closed since): the reports the service would have filed. With the thresholds the run used inline, the same tally.
 */
export async function replayAbuse(h: RecordedHistory, rules?: Readonly<AbuseRules>): Promise<ReportTally> {
  const store = new SimAbuseStore((ladder, season) => (ladder === h.ladder ? h.records.get(season) ?? [] : []));
  const directory = new SimDirectory();
  for (const [a, t] of h.created) directory.add(a, t);
  const runner = new SimAbuseRunner(store, directory, rules);
  let n = 0;
  for (const e of h.events) {
    // a long replay gives the event loop a turn now and then (a test runner's messages wait for one)
    if (++n % 20_000 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    if (e.kind === 'game') {
      store.add(e.row);
      await runner.afterGame({ ...e.row, appliedAt: e.row.endedAt, ratings: [], seasonRecords: [], cap: null });
    } else if (e.kind === 'miss') {
      store.setMisses(e.account, e.misses);
      await runner.afterMiss(e.account, e.misses, e.ms);
    } else {
      await runner.daily(e.closed.map((season) => ({ ladder: h.ladder, season })), e.ms);
    }
  }
  return runner.tally;
}
