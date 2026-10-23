/**
 * M15-3's service fixtures: fakes of every port (milestone 14's directory, hosted's ledger and replay index, the moderation sink, the abuse checker,
 * the log), a service on the memory store with the fake clock, and builders of ranked starts and ledger records. Fixed inputs only (owner rule).
 */
import { DEFAULT_PRIVACY, type AccountDirectory, type AccountId, type PrivacySettings, type Standing } from '@openmtg/accounts';
import {
  createLadderService, createMemoryLadderStore, DEFAULT_LADDER_CONFIG, type MemoryLadderStore,
} from '../../src/service/create';
import { DELETED_PLAYER_NAME, LADDERS, type LadderId, type LossCode, type NotRatedReason, type Place, type RatedNotice, type RatingState, type SeatNo } from '../../src/api';
import type { AbuseChecker, AbuseDraft, AbuseReport, ModerationSink } from '../../src/abuse/types';
import type { LedgerGameRecord, LedgerPlacement } from '../../src/ledger';
import type { LadderConfig, LadderService, LedgerSource, NotRatedEvent, ReplayIndex } from '../../src/service/api';
import type { IntakeCursor, LadderStore } from '../../src/store/api';
import { FakeClock } from '../support/clock';
import { fixedRandom } from '../support/random';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A valid account id: "acc_" and 26 digits (digits are Crockford base32). */
export const acc = (n: number): AccountId => `acc_${String(n).padStart(26, '0')}` as AccountId;
/** A game id of m13's shape (a ULID-like 26 characters). */
export const gid = (n: number): string => `01JG${String(n).padStart(22, '0')}`;

/** The fixture strings no read result and no stored row may ever hold (17.6): sessions, deck names and fingerprints, timings. */
export const SECRET_FIXTURES = ['gs_SESSIONFIXTURE', 'Fixture Burn Deck', 'deckhash-FIXTURE', 'timeUsedMs', 'disconnectedMs', 'timeouts', '"player"', 'outOrder'];

// ---- milestone 14's directory -----------------------------------------------------------------------------------------------------------------

export interface FakeAccount {
  name: string;
  status: Standing['status'];
  listed: boolean;
  privacy: PrivacySettings;
  createdAt: string;
  /** Names at the time that a forced rename redacted (displayNameAt shows the current name for them, also to the account itself). */
  redacted: Set<string>;
  erased: boolean;
}

export class FakeDirectory implements AccountDirectory {
  readonly accounts = new Map<AccountId, FakeAccount>();
  readonly blocks: [AccountId, AccountId][] = [];
  calls = 0;

  add(id: AccountId, name: string, o: Partial<Omit<FakeAccount, 'privacy'>> & { privacy?: Partial<PrivacySettings> } = {}): AccountId {
    this.accounts.set(id, {
      name, status: o.status ?? 'active', listed: o.listed ?? true, privacy: { ...DEFAULT_PRIVACY, ...o.privacy }, createdAt: o.createdAt ?? '2026-01-01T00:00:00.000Z',
      redacted: o.redacted ?? new Set(), erased: o.erased ?? false,
    });
    return id;
  }

  get(id: AccountId): FakeAccount {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`no fake account ${id}`);
    return a;
  }

  private live(id: AccountId): FakeAccount | null {
    const a = this.accounts.get(id);
    return a && !a.erased ? a : null;
  }

  async standing(id: AccountId): Promise<Standing | null> {
    this.calls++;
    const a = this.live(id);
    if (!a) return null;
    const active = a.status === 'active';
    return { account: id, status: a.status, ranked: active, listed: active && a.listed, chat: active, until: null, createdAt: a.createdAt };
  }

  async standings(ids: readonly AccountId[]): Promise<Map<AccountId, Standing>> {
    const out = new Map<AccountId, Standing>();
    for (const id of ids) {
      const s = await this.standing(id);
      if (s) out.set(id, s);
    }
    return out;
  }

  async names(ids: readonly AccountId[]): Promise<Map<AccountId, string>> {
    this.calls++;
    const out = new Map<AccountId, string>();
    for (const id of ids) {
      const a = this.live(id);
      if (a && a.status === 'active') out.set(id, a.name);
    }
    return out;
  }

  async blockedAmong(ids: readonly AccountId[]): Promise<[AccountId, AccountId][]> {
    this.calls++;
    return this.blocks.filter(([x, y]) => ids.includes(x) && ids.includes(y));
  }

  async silenced(): Promise<boolean> {
    return false;
  }

  async privacy(ids: readonly AccountId[]): Promise<Map<AccountId, PrivacySettings>> {
    this.calls++;
    const out = new Map<AccountId, PrivacySettings>();
    for (const id of ids) {
      const a = this.live(id);
      if (a) out.set(id, { ...a.privacy });
    }
    return out;
  }

  async displayNameAt(id: AccountId, nameAtTheTime: string, viewer?: AccountId | null): Promise<string> {
    this.calls++;
    const a = this.live(id);
    if (!a) return DELETED_PLAYER_NAME;
    if (viewer === id && !a.redacted.has(nameAtTheTime)) return nameAtTheTime;
    return a.name;
  }

  async historyVisible(id: AccountId, viewer: AccountId | null): Promise<boolean> {
    this.calls++;
    const a = this.live(id);
    if (!a) return false;
    if (viewer === id) return true;
    return a.status === 'active' && a.privacy.history === 'public';
  }
}

// ---- hosted's ledger ----------------------------------------------------------------------------------------------------------------------------

export class FakeLedger implements LedgerSource {
  /** Committed records (what results, resultsAfter and result can see). */
  readonly records = new Map<string, LedgerGameRecord>();
  /** Games hosted's games table has as running. */
  readonly runningGames = new Set<string>();
  /** Reads made: 'results' or 'resultsAfter', with their arguments. */
  readonly reads: { kind: 'results' | 'resultsAfter' | 'result' | 'running'; arg: unknown; limit?: number }[] = [];
  /** When set, the reads throw (an outage). */
  failing = false;
  resultsAfter?: (after: IntakeCursor, limit: number) => Promise<LedgerGameRecord[]>;

  constructor(o: { keyset?: boolean } = {}) {
    if (o.keyset !== false) {
      this.resultsAfter = async (after, limit) => {
        this.reads.push({ kind: 'resultsAfter', arg: after, limit });
        if (this.failing) throw new Error('ledger outage');
        return this.sorted().filter((r) => cmp(r, after) > 0).slice(0, limit).map(clone);
      };
    }
  }

  commit(r: LedgerGameRecord): void {
    this.records.set(r.game, clone(r));
    this.runningGames.delete(r.game);
  }

  private sorted(): LedgerGameRecord[] {
    return [...this.records.values()].sort((a, b) => cmp(a, b));
  }

  async results(since: Date, limit: number): Promise<LedgerGameRecord[]> {
    this.reads.push({ kind: 'results', arg: since.toISOString(), limit });
    if (this.failing) throw new Error('ledger outage');
    return this.sorted().filter((r) => Date.parse(r.endedAt) >= since.getTime()).slice(0, limit).map(clone);
  }

  async result(game: string): Promise<LedgerGameRecord | null> {
    this.reads.push({ kind: 'result', arg: game });
    if (this.failing) throw new Error('ledger outage');
    const r = this.records.get(game);
    return r ? clone(r) : null;
  }

  async running(games: readonly string[]): Promise<Set<string>> {
    this.reads.push({ kind: 'running', arg: [...games] });
    if (this.failing) throw new Error('ledger outage');
    return new Set(games.filter((g) => this.runningGames.has(g)));
  }
}

function cmp(a: { endedAt: string; game: string }, b: { endedAt: string; game: string }): number {
  return Date.parse(a.endedAt) - Date.parse(b.endedAt) || (a.game < b.game ? -1 : a.game > b.game ? 1 : 0);
}

const clone = <T>(x: T): T => structuredClone(x);

// ---- the other ports ---------------------------------------------------------------------------------------------------------------------------

export class FakeSink implements ModerationSink {
  readonly submitted: AbuseReport[] = [];
  refuse = false;
  async submit(r: AbuseReport): Promise<void> {
    if (this.refuse) throw new Error('the sink refuses (milestone 14 not wired)');
    this.submitted.push(clone(r));
  }
}

/** An AbuseChecker that records its calls and files what a test queues for it. */
export class FakeAbuse implements AbuseChecker {
  readonly calls: { kind: 'afterGame' | 'afterMiss' | 'daily'; arg: unknown }[] = [];
  next: { afterGame: AbuseDraft[]; afterMiss: AbuseDraft[]; daily: AbuseDraft[] } = { afterGame: [], afterMiss: [], daily: [] };
  async afterGame(g: Parameters<AbuseChecker['afterGame']>[0]): Promise<AbuseDraft[]> {
    this.calls.push({ kind: 'afterGame', arg: g.game });
    return this.next.afterGame.splice(0);
  }
  async afterMiss(account: AccountId, misses: readonly string[]): Promise<AbuseDraft[]> {
    this.calls.push({ kind: 'afterMiss', arg: { account, misses: [...misses] } });
    return this.next.afterMiss.splice(0);
  }
  async daily(closed: Parameters<AbuseChecker['daily']>[0]): Promise<AbuseDraft[]> {
    this.calls.push({ kind: 'daily', arg: closed.map((c) => ({ ...c })) });
    return this.next.daily.splice(0);
  }
}

export class FakeReplays implements ReplayIndex {
  readonly available = new Map<string, { until: string; full: boolean }>();
  async availability(games: readonly string[]): Promise<Map<string, { until: string; full: boolean }>> {
    return new Map(games.flatMap((g) => (this.available.has(g) ? [[g, this.available.get(g)!] as const] : [])));
  }
}

export interface LogLine { level: 'info' | 'warn'; event: string; fields: Record<string, unknown> }

export class Logs {
  readonly lines: LogLine[] = [];
  readonly log = {
    info: (event: string, fields: Record<string, unknown> = {}) => void this.lines.push({ level: 'info', event, fields }),
    warn: (event: string, fields: Record<string, unknown> = {}) => void this.lines.push({ level: 'warn', event, fields }),
  };
  events(level?: 'info' | 'warn'): string[] {
    return this.lines.filter((l) => level === undefined || l.level === level).map((l) => l.event);
  }
}

// ---- the service -------------------------------------------------------------------------------------------------------------------------------

/** base64url of 32 fixed bytes: the HMAC key of the dedupe keys and the cursors' key source. */
export const TEST_SECRET = Buffer.alloc(32, 7).toString('base64url');

export const TEST_CONFIG: LadderConfig = { ...DEFAULT_LADDER_CONFIG, firstSeason: '2026-10', secret: TEST_SECRET };

export interface Harness {
  svc: LadderService;
  store: LadderStore;
  clock: FakeClock;
  dir: FakeDirectory;
  ledger: FakeLedger | null;
  sink: FakeSink;
  abuse: FakeAbuse;
  replays: FakeReplays;
  logs: Logs;
  rated: { game: string; notices: RatedNotice[] }[];
  notRated: NotRatedEvent[];
  /** Runs `registerStart`, then returns a ledger record for it (not committed, not taken in). */
  start(o: StartOptions): Promise<LedgerGameRecord>;
  /** start + the record committed to the ledger + intake: a whole rated game. */
  play(o: StartOptions & EndOptions): Promise<LedgerGameRecord>;
}

export interface StartOptions {
  game: string;
  ladder?: LadderId;
  accounts: AccountId[];
  /** Default: the clock now. */
  startedAt?: string;
}
export interface EndOptions {
  /** Places in seat order (default 1, 2, ... : seat 1 wins). */
  places?: Place[];
  /** The game ends this long after its start (default 20 minutes); the clock moves there. */
  durationMs?: number;
  outcome?: 'win' | 'draw' | 'void';
  loss?: (LossCode | null)[];
}

export interface HarnessOptions {
  store?: LadderStore;
  ledger?: FakeLedger | null;
  config?: Partial<LadderConfig>;
  start?: number | string;
  /** Accounts to add to the directory up front, named "Player <n>". */
  accounts?: number[];
}

export async function harness(o: HarnessOptions = {}): Promise<Harness> {
  const clock = new FakeClock(o.start);
  const dir = new FakeDirectory();
  for (const n of o.accounts ?? []) dir.add(acc(n), `Player ${n}`);
  const ledger = o.ledger === undefined ? new FakeLedger() : o.ledger;
  const sink = new FakeSink();
  const abuse = new FakeAbuse();
  const replays = new FakeReplays();
  const logs = new Logs();
  const store = o.store ?? createMemoryLadderStore({ random: fixedRandom('m15-3') });
  const svc = createLadderService({
    store, clock, accounts: dir, moderation: sink, abuse, ledger, replays, config: { ...TEST_CONFIG, ...o.config }, log: logs.log,
  });
  const rated: Harness['rated'] = [];
  const notRated: NotRatedEvent[] = [];
  svc.onRated((notices, game) => rated.push({ game, notices: [...notices] }));
  svc.onNotRated((e) => notRated.push({ ...e, accounts: [...e.accounts] }));
  await svc.open();
  const h: Harness = {
    svc, store, clock, dir, ledger, sink, abuse, replays, logs, rated, notRated,
    async start(s) {
      const startedAt = s.startedAt ?? clock.iso();
      const ladder = s.ladder ?? '1v1-standard';
      await svc.registerStart({ game: s.game, match: `m${s.game}`, ladder, startedAt, seats: s.accounts.map((account, i) => ({ seat: (i + 1) as SeatNo, account })) });
      return recordOf({ game: s.game, ladder, accounts: s.accounts, startedAt, names: s.accounts.map((a) => dir.accounts.get(a)?.name ?? 'Someone') });
    },
    async play(p) {
      const startedAt = p.startedAt ?? clock.iso();
      const rec0 = await h.start({ ...p, startedAt });
      const endedAt = new Date(Date.parse(startedAt) + (p.durationMs ?? 20 * MINUTE)).toISOString();
      if (Date.parse(endedAt) > clock.now()) clock.set(endedAt);
      const rec = ended(rec0, { places: p.places, endedAt, outcome: p.outcome, loss: p.loss });
      ledger?.commit(rec);
      const res = await svc.intake(rec);
      if (res.kind === 'failed') throw new Error(`play: intake failed (${res.error})`);
      return rec;
    },
  };
  return h;
}

/** A ranked ledger record of a running start (not ended yet: ended() sets the result). */
export function recordOf(o: { game: string; ladder: LadderId; accounts: (AccountId | null)[]; startedAt: string; names?: string[] }): LedgerGameRecord {
  const def = LADDERS[o.ladder];
  const placements = o.accounts.map((account, i): LedgerPlacement => ({
    seat: (i + 1) as SeatNo, place: (i + 1) as Place, loss: i === 0 ? null : 'life', lossRule: i === 0 ? null : 'CR 104.3b', outTurn: i === 0 ? null : 8,
    account, name: o.names?.[i] ?? `Player ${i + 1}`, timeouts: 0, disconnectedMs: 1234, timeUsedMs: 456_789,
    // m13's server-only placement fields, which the ladder never stores (8.2)
    ...({ player: `p${i + 1}`, session: `gs_SESSIONFIXTURE${i + 1}`, deckHash: `deckhash-FIXTURE-${i + 1}`, deck: 'Fixture Burn Deck', outOrder: i === 0 ? null : i } as object),
  }));
  return {
    game: o.game, format: def.format, seats: o.accounts.length as 2 | 3 | 4, source: 'matched', ranked: true, ladder: o.ladder, outcome: 'win', reason: 'life',
    turns: 9, actions: 140, startedAt: o.startedAt, endedAt: new Date(Date.parse(o.startedAt) + 20 * MINUTE).toISOString(), engineBuild: 'test-build',
    placements, seatActions: o.accounts.map((_, i) => ({ seat: (i + 1) as SeatNo, actions: 70 })),
  };
}

/** The record with its result: places in seat order (1v1 draw: [1, 1]), the outcome, the end time, the loss codes (default 'life' for losers). */
export function ended(r: LedgerGameRecord, o: { places?: Place[]; endedAt?: string; outcome?: 'win' | 'draw' | 'void'; loss?: (LossCode | null)[] }): LedgerGameRecord {
  const places = o.places ?? r.placements.map((p) => p.place);
  const firsts = places.filter((p) => p === 1).length;
  const outcome = o.outcome ?? (firsts > 1 ? 'draw' : 'win');
  if (outcome === 'void') return { ...clone(r), outcome: 'void', reason: 'abandoned', endedAt: o.endedAt ?? r.endedAt, placements: [] };
  return {
    ...clone(r),
    outcome, reason: outcome === 'draw' ? 'draw' : 'life', endedAt: o.endedAt ?? r.endedAt,
    placements: r.placements.map((p, i) => {
      const place = places[i]!;
      const loss = o.loss?.[i] !== undefined ? o.loss[i]! : place === 1 ? (outcome === 'draw' ? 'draw' : null) : 'life';
      return { ...clone(p), place, loss, lossRule: loss === null ? null : 'CR 104.3a', outTurn: place === 1 && outcome === 'win' ? null : 8 };
    }),
  };
}

/** Plays `n` 1v1 games of `a` against fresh or given opponents, `a` winning (or losing), each `gap` apart; returns the game ids. */
export async function series(
  h: Harness,
  a: AccountId,
  opponents: AccountId[],
  o: { n: number; first: number; win?: boolean | ((i: number) => boolean); gapMs?: number; ladder?: LadderId },
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < o.n; i++) {
    const g = gid(o.first + i);
    ids.push(g);
    const opp = opponents[i % opponents.length]!;
    const won = typeof o.win === 'function' ? o.win(i) : o.win ?? true;
    await h.play({ game: g, ladder: o.ladder, accounts: [a, opp], places: won ? [1, 2] : [2, 1] });
    h.clock.advance(o.gapMs ?? HOUR);
  }
  return ids;
}

/**
 * Gives `a` a stored rating row directly (the memory and file stores' seedRating, a test-only write of a whole row, with no audit): an established
 * opponent without playing its history first. Test fixture only.
 */
export async function establish(
  h: Harness,
  a: AccountId,
  state: RatingState,
  o: { games?: number; lastRatedAt?: string; season?: string; ladder?: LadderId } = {},
): Promise<void> {
  const ladder = o.ladder ?? '1v1-standard';
  const before = (await h.store.ratings(ladder, [a])).get(a) ?? null;
  const row = {
    account: a, ladder, state, season: o.season ?? h.clock.iso().slice(0, 7), lastRatedAt: o.lastRatedAt ?? h.clock.iso(), games: o.games ?? 50, tier: null,
    version: (before?.version ?? 0) + 1,
  };
  await (h.store as MemoryLadderStore).seedRating(row);
}

/** Games that run side by side: all start now and end `durationMs` later, then are taken in in the order given. */
export async function round(
  h: Harness,
  games: { game: string; accounts: AccountId[]; places: Place[]; ladder?: LadderId }[],
  durationMs = 20 * MINUTE,
): Promise<void> {
  const startedAt = h.clock.iso();
  const recs = [];
  for (const g of games) recs.push({ g, rec: await h.start({ game: g.game, accounts: g.accounts, ladder: g.ladder, startedAt }) });
  h.clock.advance(durationMs);
  for (const { g, rec } of recs) {
    const r = ended(rec, { places: g.places, endedAt: h.clock.iso() });
    h.ledger?.commit(r);
    const res = await h.svc.intake(r);
    if (res.kind !== 'applied') throw new Error(`round: ${g.game} was ${res.kind}`);
  }
}

/** Every string of a dump or a read result, serialized, for searches. */
export const text = (x: unknown): string => JSON.stringify(x);

/** The memory store of a harness (made by harness() without a store). */
export const memoryOf = (h: Harness): MemoryLadderStore => h.store as MemoryLadderStore;

export type { NotRatedReason };
