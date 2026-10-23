/**
 * M15-3: what the parts of the ladder service share (design 13.4, 8.3): the ports, the memory kept for the synchronous lookups (running starts and
 * cooldowns, loaded by `open`), the serial queue, the listeners and the report filing. Server only. The parts are src/service/{intake,sweep,
 * seasons,reads,rights,penalties}.ts; src/service/create.ts puts them together as the LadderService.
 *
 * **The serial queue** (8.3): everything that writes ratings, registry seats or season records runs as one job of a promise chain, one job at a
 * time (intake, each step of the sweep that writes, registerStart, forgetAccount, resetRating, standingChanged, the leaderboard's listed refresh,
 * readyCheckMissed). So an erasure never interleaves with a computation in flight, and the memory and file stores need no locks. A job that fails
 * does not stop the chain.
 */
import { ABUSE_REPORT_REASON, type AbuseContext, type AbuseDraft } from '../abuse/types';
import type { AccountId } from '../accounts';
import { LADDER_IDS, seasonBounds, type LadderId, type RatedNotice, type SeasonId } from '../api';
import type { RankedStart } from '../ledger';
import type { RankedMatcher } from '../match/api';
import type { LadderStore, SeasonRow } from '../store/api';
import type { LadderConfig, LadderPorts, NotRatedEvent } from './api';
import { checkLadderConfig, floorsFor, secretKey } from './config';
import { cursorKeys, type CursorKeys } from './cursor';
import { reportOf } from './reports';

export const DAY_MS = 86_400_000;

export type RatedListener = (notices: readonly RatedNotice[], game: string) => void;
export type NotRatedListener = (e: NotRatedEvent) => void;

export class ServiceCore {
  readonly store: LadderStore;
  readonly config: LadderConfig;
  readonly log: LadderPorts['log'];
  /** The HMAC key of the report dedupe keys (11.2). */
  readonly reportKey: Buffer;
  readonly cursors: CursorKeys;
  readonly offered: ReadonlySet<LadderId>;
  /** Account → the game of its running ranked start (D9): loaded by open, kept by registerStart, every close and forgetAccount. */
  readonly busy = new Map<AccountId, string>();
  /** Account → the end of its ranked-queue cooldown in ms (8.6): loaded by open, kept by readyCheckMissed and forgetAccount. */
  readonly cooldowns = new Map<AccountId, number>();
  readonly rated = new Set<RatedListener>();
  readonly notRated = new Set<NotRatedListener>();
  queue: Pick<RankedMatcher, 'queued' | 'status' | 'window' | 'accounts'> | null = null;
  opened = false;
  /** Reports filed into the outbox since the service was made (SweepReport.reports counts a sweep's share). */
  filed = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly ports: LadderPorts) {
    if (typeof ports !== 'object' || ports === null) throw new TypeError('createLadderService: the ports are missing');
    for (const p of ['store', 'clock', 'accounts', 'moderation', 'abuse', 'config', 'log'] as const) {
      if (ports[p] === undefined || ports[p] === null) throw new TypeError(`createLadderService: the ${p} port is missing`);
    }
    this.config = checkLadderConfig(ports.config);
    this.store = ports.store;
    this.log = ports.log;
    this.reportKey = secretKey(this.config.secret);
    this.cursors = cursorKeys(this.config.secret);
    this.offered = new Set(this.config.offered);
  }

  nowMs(): number {
    const t = this.ports.clock.now();
    if (!Number.isSafeInteger(t) || t < 0) throw new RangeError(`the ladder clock gave ${String(t)}, not whole ms since the epoch`);
    return t;
  }

  nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  /** Runs `f` as the next job of the serial queue. */
  serial<R>(f: () => Promise<R>): Promise<R> {
    const run = this.chain.then(f, f);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Throws unless open() ran: the synchronous lookups would answer from an empty memory. */
  mustBeOpen(what: string): void {
    if (!this.opened) throw new Error(`LadderService.${what}: call open() first`);
  }

  /** A running start's accounts leave the busy memory once the start is closed (applied, skipped, void or lost). */
  freeStart(start: Pick<RankedStart, 'game' | 'seats'>): void {
    for (const s of start.seats) if (s.account !== null && this.busy.get(s.account) === start.game) this.busy.delete(s.account);
  }

  emitRated(notices: readonly RatedNotice[], game: string): void {
    for (const l of [...this.rated]) {
      try {
        l(notices, game);
      } catch (e) {
        this.log.warn('ladder.listenerFailed', { listener: 'onRated', game, error: message(e) });
      }
    }
  }

  emitNotRated(e: NotRatedEvent): void {
    for (const l of [...this.notRated]) {
      try {
        l(e);
      } catch (err) {
        this.log.warn('ladder.listenerFailed', { listener: 'onNotRated', game: e.game, error: message(err) });
      }
    }
  }

  abuseContext(): AbuseContext {
    return { store: this.store, accounts: this.ports.accounts, now: this.nowIso() };
  }

  /**
   * Files the drafts of a check into the outbox (11.2): each gets its ULID, time, HMAC dedupe key and status 'pending'; a draft whose key is already
   * filed (the same kind, ladder and accounts within the 7-day window) is a duplicate and dropped. A draft that is not of the AbuseDraft shape is
   * logged and dropped. Returns how many were stored. Reports only: nothing here changes a rating, a queue or a leaderboard (D18).
   */
  async fileReports(drafts: readonly AbuseDraft[], source: string): Promise<number> {
    if (!Array.isArray(drafts)) {
      this.log.warn('abuse.badDrafts', { source });
      return 0;
    }
    let n = 0;
    for (const d of drafts) {
      if (!isDraft(d)) {
        this.log.warn('abuse.badDraft', { source });
        continue;
      }
      if ((await this.store.putReport(reportOf(this.reportKey, d, this.nowMs()))) === 'stored') n++;
    }
    this.filed += n;
    if (n > 0) this.log.info('abuse.filed', { source, reports: n });
    return n;
  }

  /**
   * Runs an abuse check and files what it returns; a failing check is logged, never fails the caller (reports are advisory, D18). Returns how many
   * reports were filed, or null when the check or its filing failed (the daily sweep then hands its closed seasons over again the next day).
   */
  async check(source: string, f: (ctx: AbuseContext) => Promise<AbuseDraft[]>): Promise<number | null> {
    let drafts: AbuseDraft[];
    try {
      drafts = await f(this.abuseContext());
    } catch (e) {
      this.log.warn('abuse.checkFailed', { source, error: message(e) });
      return null;
    }
    try {
      return await this.fileReports(drafts, source);
    } catch (e) {
      this.log.warn('abuse.fileFailed', { source, error: message(e) });
      return null;
    }
  }

  /**
   * The season row of `ladder` and `season`, written open with the configured floors if there is none yet (6.3: floors are recorded per season,
   * at its start, and change only at the next). Called on the serial queue.
   */
  async seasonRowOf(ladder: LadderId, season: SeasonId): Promise<SeasonRow> {
    const row = await this.store.seasonRow(ladder, season);
    if (row !== null) return row;
    seasonBounds(season);
    const fresh: SeasonRow = { ladder, season, status: 'open', floors: [...floorsFor(this.config, ladder)], closedAt: null, eligible: null };
    await this.store.putSeasonRow(fresh);
    return fresh;
  }

  /** The floors a read uses for `season`: its row's, else the configured ones (a read writes nothing). */
  async floorsOf(ladder: LadderId, season: SeasonId): Promise<readonly number[]> {
    return (await this.store.seasonRow(ladder, season))?.floors ?? floorsFor(this.config, ladder);
  }
}

function isDraft(d: unknown): d is AbuseDraft {
  if (typeof d !== 'object' || d === null) return false;
  const x = d as Partial<AbuseDraft>;
  return typeof x.kind === 'string' && Object.hasOwn(ABUSE_REPORT_REASON, x.kind)
    && (x.ladder === null || (typeof x.ladder === 'string' && (LADDER_IDS as readonly string[]).includes(x.ladder)))
    && Array.isArray(x.accounts) && x.accounts.every((a) => a === null || typeof a === 'string')
    && typeof x.evidence === 'object' && x.evidence !== null && Array.isArray(x.evidence.games) && x.evidence.games.every((g) => typeof g === 'string')
    && typeof x.evidence.stats === 'object' && x.evidence.stats !== null
    && Object.values(x.evidence.stats).every((v) => typeof v === 'number' && Number.isFinite(v));
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The live accounts of a start's seats. */
export function liveAccounts(start: Pick<RankedStart, 'seats'>): AccountId[] {
  return start.seats.flatMap((s) => (s.account === null ? [] : [s.account]));
}
