/**
 * M15-5: the `AbuseChecker` of design 11.1 and 13.4: when each heuristic of src/abuse/checks.ts runs and what it reads. Server only. Reads only
 * (through `AbuseContext`): it never writes the store, and never bans, mutes, resets or changes a rating, a queue or a leaderboard (D18). The service
 * (M15-3) files what it returns: it adds the id, the time, the HMAC dedupe key and `pending`, and dedupes within 7 days.
 *
 * - `afterGame(g)`: for the game's accounts, anchored at the game's end (so a game taken in late is judged in its own time):
 *   earlyConcessions, ratingTransfer, sandbagging and smurf for each account (`history` in the game's ladder, and milestone 14's `standings` for
 *   the account's age); repeatedPairing and oneSided for every pair of its accounts (`pairGames`); capStall for each account (`capEvents`). The
 *   game itself (and its cap event) counts even if a read does not return it yet.
 * - `afterMiss(account, misses)`: dodging, anchored at `now`, over the misses given and the stored ones (`penalties`).
 * - `daily(closedSeasons)`: anchored at `now`, the same game rules again for every account with a rated game within the longest game rule's
 *   window (30 days by default), found by paging `gamesSince` (all ladders); each account's games come from its own `history`, and each pair is
 *   judged once, from the history of its lower account id. It catches what a per-game check could not see: a cap event of a void game (no game is
 *   applied for it) of an account with a rated game in the window, a check that failed, a rule whose window closed between games. Then parkedHigh
 *   over every record of the seasons given (`seasonRecordsOf`), with the season's last game from `history`.
 *
 * Each call returns each case (kind, ladder, accounts) at most once, in one fixed order (per ladder, per account by id: its own rules, then its
 * pairs with higher ids; then capStall per account; then parkedHigh), so the same store and time give the same drafts. A pattern that stays inside
 * a rule's window is drafted again by later calls; the service's 7-day dedupe keeps that to one report per 7-day window.
 *
 * Known limit, open (M15-5 review, finding 4): the daily sweep finds accounts through their applied games, so an account whose ranked games in the
 * window all voided at a cap (the purest "void without a driver" staller, each game kept just under the driver share) is judged only at its next
 * rated game, and never if it has none. AbuseContext has no read of cap events by time. The fix is outside M15-5: a keyset read of cap events by
 * time for the sweep (a contract change, M15-1's owner), or the service calling the checker for a skipped ranked game with a cap event (M15-3's
 * owner). Listed for M15-11; test/m15-5/caps-misses.test.ts pins it with an `it.fails`.
 */
import type { AccountId, Standing } from '../accounts';
import { LADDER_IDS, seasonBounds, type LadderId, type SeasonId } from '../api';
import type { AppliedGame, CapEvent, HistoryRow, IntakeCursor } from '../store/api';
import {
  checkAccountGames, checkCapStall, checkDodging, checkPair, checkSmurf, DAY_MS, isoAt, parkedHighDraft, parkedHighStats, timeMs,
} from './checks';
import type { ResolvedAbuseRules } from './rules';
import type { AbuseContext, AbuseDraft } from './types';

/** Rows per store read. */
export const ABUSE_READ_PAGE = 200;
/** Accounts per `standings` call of the daily sweep. */
const STANDINGS_BATCH = 200;

type Store = AbuseContext['store'];

function cmpText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The drafts of one call, once per case, in the order they were found. */
class Drafts {
  readonly #seen = new Set<string>();
  readonly #list: AbuseDraft[] = [];

  add(d: AbuseDraft | readonly AbuseDraft[] | null): void {
    if (d === null) return;
    for (const x of Array.isArray(d) ? (d as readonly AbuseDraft[]) : [d as AbuseDraft]) {
      const key = `${x.kind}|${x.ladder ?? ''}|${x.accounts.join(',')}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      this.#list.push(x);
    }
  }

  list(): AbuseDraft[] {
    return this.#list;
  }
}

/** The longest window the account rules need from `history` (sandbagging's fall and rise together). */
function historyDays(rules: ResolvedAbuseRules): number {
  return Math.max(rules.earlyConcessionsDays, rules.ratingTransferDays, rules.sandbaggingFallDays + rules.sandbaggingRiseDays);
}

/** The daily sweep's window: the longest of every game rule (the smurf age included, so a new account's whole career is inside it). */
function dailyDays(rules: ResolvedAbuseRules): number {
  return Math.max(historyDays(rules), rules.repeatedPairingDays, rules.oneSidedDays, rules.smurfAccountDays, rules.capStallDays);
}

function young(standing: Standing | undefined, anchorMs: number, rules: ResolvedAbuseRules): boolean {
  return standing !== undefined && anchorMs - timeMs(standing.createdAt, 'createdAt') <= rules.smurfAccountDays * DAY_MS;
}

/**
 * The account's games in `ladder` that ended at or before `untilMs`, newest first from the store, paged until a page reaches before `sinceMs` and
 * at least `minRows` rows were kept (or the history ends). Rows older than `sinceMs` on the last page are kept too; the checks apply their windows.
 */
async function readHistory(
  store: Store,
  account: AccountId,
  ladder: LadderId,
  sinceMs: number,
  untilMs: number,
  minRows: number,
): Promise<HistoryRow[]> {
  const out: HistoryRow[] = [];
  const seen = new Set<string>();
  let before: IntakeCursor | undefined;
  for (;;) {
    const page = await store.history(
      before === undefined ? { account, ladder, limit: ABUSE_READ_PAGE } : { account, ladder, before, limit: ABUSE_READ_PAGE },
    );
    let fresh = 0;
    for (const row of page) {
      if (seen.has(row.game)) continue;
      seen.add(row.game);
      fresh++;
      if (row.ladder === ladder && timeMs(row.endedAt) <= untilMs) out.push(row);
    }
    const last = page[page.length - 1];
    if (last === undefined || page.length < ABUSE_READ_PAGE || fresh === 0) break;
    if (timeMs(last.endedAt) < sinceMs && out.length >= minRows) break;
    before = { endedAt: last.endedAt, game: last.game };
  }
  return out;
}

function historyRowOf(g: AppliedGame): HistoryRow {
  return { game: g.game, ladder: g.ladder, season: g.season, endedAt: g.endedAt, outcome: g.outcome, turns: g.turns, seats: g.seats };
}

function withRow(rows: readonly HistoryRow[], row: HistoryRow): HistoryRow[] {
  return rows.some((r) => r.game === row.game) ? [...rows] : [...rows, row];
}

function withCap(events: readonly CapEvent[], cap: CapEvent | null): CapEvent[] {
  return cap === null || events.some((e) => e.game === cap.game) ? [...events] : [...events, cap];
}

function accountsOf(g: AppliedGame): AccountId[] {
  const set = new Set<AccountId>();
  for (const s of g.seats) if (s.account !== null) set.add(s.account);
  return [...set].sort(cmpText);
}

export async function afterGame(g: AppliedGame, ctx: AbuseContext, rules: ResolvedAbuseRules): Promise<AbuseDraft[]> {
  const anchorMs = timeMs(g.endedAt, "the game's endedAt");
  const row = historyRowOf(g);
  const accounts = accountsOf(g);
  const out = new Drafts();

  // the daily sweep's order: per account, its own rules and then its pairs with the higher account ids; then capStall per account
  const standings = accounts.length === 0 ? new Map<AccountId, Standing>() : await ctx.accounts.standings(accounts);
  const sinceMs = anchorMs - historyDays(rules) * DAY_MS;
  const pairSince = isoAt(anchorMs - Math.max(rules.repeatedPairingDays, rules.oneSidedDays) * DAY_MS);
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i]!;
    const standing = standings.get(a);
    const isYoung = young(standing, anchorMs, rules);
    const rows = withRow(await readHistory(ctx.store, a, g.ladder, sinceMs, anchorMs, isYoung ? rules.smurfMaxGames + 1 : 0), row);
    out.add(checkAccountGames(a, g.ladder, rows, anchorMs, rules));
    if (isYoung) out.add(checkSmurf(a, g.ladder, rows, standing!.createdAt, anchorMs, rules));
    for (const b of accounts.slice(i + 1)) {
      const pair = withRow(await ctx.store.pairGames(a, b, g.ladder, pairSince), row).filter((r) => timeMs(r.endedAt) <= anchorMs);
      out.add(checkPair(a, b, g.ladder, pair, anchorMs, rules));
    }
  }
  const capSince = isoAt(anchorMs - rules.capStallDays * DAY_MS);
  for (const a of accounts) out.add(checkCapStall(a, withCap(await ctx.store.capEvents(a, capSince), g.cap), anchorMs, rules));
  return out.list();
}

export async function afterMiss(account: AccountId, misses: readonly string[], ctx: AbuseContext, rules: ResolvedAbuseRules): Promise<AbuseDraft[]> {
  const anchorMs = timeMs(ctx.now, 'now');
  const stored = await ctx.store.penalties(account);
  const d = checkDodging(account, [...misses, ...(stored?.misses ?? [])], anchorMs, rules);
  return d === null ? [] : [d];
}

/** (endedAt, game) of `a` after that of `b`. */
function cursorAfter(a: IntakeCursor, b: IntakeCursor): boolean {
  const ta = timeMs(a.endedAt);
  const tb = timeMs(b.endedAt);
  return ta > tb || (ta === tb && a.game > b.game);
}

/** Every (ladder, account) with a rated game in [sinceMs, untilMs], paging gamesSince over all ladders. */
async function playedSince(store: Store, sinceMs: number, untilMs: number): Promise<Map<LadderId, Set<AccountId>>> {
  const played = new Map<LadderId, Set<AccountId>>();
  const since = isoAt(sinceMs);
  let after: IntakeCursor | undefined;
  for (;;) {
    const page = await store.gamesSince(after === undefined ? { since, limit: ABUSE_READ_PAGE } : { since, after, limit: ABUSE_READ_PAGE });
    for (const row of page) {
      const t = timeMs(row.endedAt);
      if (t < sinceMs || t > untilMs) continue;
      let set = played.get(row.ladder);
      if (set === undefined) played.set(row.ladder, (set = new Set()));
      for (const s of row.seats) if (s.account !== null) set.add(s.account);
    }
    const last = page[page.length - 1];
    if (last === undefined || page.length < ABUSE_READ_PAGE) break;
    const next = { endedAt: last.endedAt, game: last.game };
    if (after !== undefined && !cursorAfter(next, after)) break; // a store that does not move on: stop rather than loop
    after = next;
  }
  return played;
}

async function standingsOf(ctx: AbuseContext, accounts: readonly AccountId[]): Promise<Map<AccountId, Standing>> {
  const out = new Map<AccountId, Standing>();
  for (let i = 0; i < accounts.length; i += STANDINGS_BATCH) {
    for (const [id, s] of await ctx.accounts.standings(accounts.slice(i, i + STANDINGS_BATCH))) out.set(id, s);
  }
  return out;
}

/** The id of the account's last game in `ladder` before the season's end, if the history still has it. */
async function lastGameOf(store: Store, account: AccountId, ladder: LadderId, season: SeasonId, endsAt: string): Promise<string | null> {
  const endsMs = timeMs(endsAt);
  const rows = await store.history({ account, ladder, before: { endedAt: endsAt, game: '' }, limit: 5 });
  let best: HistoryRow | null = null;
  for (const r of rows) {
    if (r.ladder !== ladder || r.season !== season || timeMs(r.endedAt) >= endsMs) continue;
    if (best === null || cursorAfter(r, best)) best = r;
  }
  return best?.game ?? null;
}

export async function daily(
  closedSeasons: readonly { ladder: LadderId; season: SeasonId }[],
  ctx: AbuseContext,
  rules: ResolvedAbuseRules,
): Promise<AbuseDraft[]> {
  const anchorMs = timeMs(ctx.now, 'now');
  const sinceMs = anchorMs - dailyDays(rules) * DAY_MS;
  const out = new Drafts();

  const played = await playedSince(ctx.store, sinceMs, anchorMs);
  const everyone = [...new Set([...played.values()].flatMap((s) => [...s]))].sort(cmpText);
  const standings = await standingsOf(ctx, everyone);
  const ladders = [...played.keys()].sort((a, b) => {
    const ia = (LADDER_IDS as readonly string[]).indexOf(a);
    const ib = (LADDER_IDS as readonly string[]).indexOf(b);
    return ia - ib || cmpText(a, b);
  });
  for (const ladder of ladders) {
    for (const a of [...played.get(ladder)!].sort(cmpText)) {
      const rows = await readHistory(ctx.store, a, ladder, sinceMs, anchorMs, 0);
      out.add(checkAccountGames(a, ladder, rows, anchorMs, rules));
      const standing = standings.get(a);
      if (young(standing, anchorMs, rules)) out.add(checkSmurf(a, ladder, rows, standing!.createdAt, anchorMs, rules));
      const byOpponent = new Map<AccountId, HistoryRow[]>();
      for (const r of rows) {
        for (const s of r.seats) {
          if (s.account === null || cmpText(s.account, a) <= 0) continue;
          const list = byOpponent.get(s.account);
          if (list) list.push(r);
          else byOpponent.set(s.account, [r]);
        }
      }
      for (const b of [...byOpponent.keys()].sort(cmpText)) out.add(checkPair(a, b, ladder, byOpponent.get(b)!, anchorMs, rules));
    }
  }
  const capSince = isoAt(anchorMs - rules.capStallDays * DAY_MS);
  for (const a of everyone) out.add(checkCapStall(a, await ctx.store.capEvents(a, capSince), anchorMs, rules));

  for (const { ladder, season } of closedSeasons) {
    const { endsAt } = seasonBounds(season);
    const endsMs = timeMs(endsAt);
    let after: string | null = null;
    for (;;) {
      const page = await ctx.store.seasonRecordsOf(ladder, season, after, ABUSE_READ_PAGE);
      for (const record of page) {
        if (record.ladder !== ladder || record.season !== season) continue;
        const stats = parkedHighStats(record, endsMs, rules);
        if (stats !== null) out.add(parkedHighDraft(record, stats, await lastGameOf(ctx.store, record.account!, ladder, season, endsAt)));
      }
      const last = page[page.length - 1];
      if (last === undefined || page.length < ABUSE_READ_PAGE) break;
      if (after !== null && cmpText(last.sortKey, after) <= 0) break; // a store that does not move on: stop rather than loop
      after = last.sortKey;
    }
  }
  return out.list();
}
