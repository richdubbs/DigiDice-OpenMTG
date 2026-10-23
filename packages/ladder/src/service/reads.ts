/**
 * M15-3: the reads (design 10.1-10.3, 6.1, 6.4, D16, D17; LadderService.status, leaderboard, history, profile). Server only. Any viewer, guests
 * included (`viewer` null). They write nothing but the leaderboard's `listed` refresh (a serial-queue job).
 *
 * Privacy, as 10.1-10.3 and m14 2.4 give it:
 * - A leaderboard row shows a name only for an account that is listed (the store has no row otherwise) and whose PrivacySettings.leaderboards is
 *   true, and only while it has a current name; otherwise it is "Hidden player" (rank, rating and tier; no name, no id, no games count). A deleted
 *   account's row in a closed season is "Deleted player". The account itself always sees its own row in full.
 * - A history is read only when AccountDirectory.historyVisible(subject, viewer). Its seats' names go through displayNameAt with the viewer; a seat
 *   whose account has leaderboards false is "Hidden player" without a tier (except to that account itself); a deleted one "Deleted player". For an
 *   unlisted subject (leaderboards false), other viewers get no rating numbers: subject.before and .after are null (its tier after stays).
 * - A profile exists only for an active account. For an account with leaderboards false, every other viewer gets the limited projection of 10.3.
 *   It lists the ladders the account has a rating in: `ratings[i]` and `seasons[i]` (the current season's record, SeasonView carries no ladder) are
 *   the same ladder, in LADDER_IDS order; `badges` holds every season badge, newest season first.
 * - No read result holds a deck, a session id, a timing or another player's rating change: none of them is ever stored (8.2).
 */
import {
  ACCOUNT_ID_SHAPE, isLadderId, isSeasonId, LADDER_IDS, LADDER_LIMITS, LADDERS, seasonBounds, seasonOf, tierOf, type HistoryEntry,
  type HistoryPage, type HistoryPlayer, type LadderId, type LadderProfile, type LadderStatus, type LeaderboardEntry, type LeaderboardPage,
  type SeasonBadge, type SeasonId,
} from '../api';
import type { AccountId, PrivacySettings } from '../accounts';
import type { HistoryRow, SeasonRecord } from '../store/api';
import type { ServiceCore } from './core';
import { historyCursor, LadderCursorError, leaderboardCursor, openCursor } from './cursor';
import { cooldownUntil } from './queue';
import { liveEligible, ratingViewOf, seasonViewOf } from './views';

function accountOf(label: string, x: unknown): AccountId {
  if (typeof x !== 'string' || !ACCOUNT_ID_SHAPE.test(x)) throw new RangeError(`${label}: ${String(x)} is not an account id`);
  return x as AccountId;
}

function viewerOf(x: unknown): AccountId | null {
  return x === null || x === undefined ? null : accountOf('viewer', x);
}

function limitOf(x: unknown, dflt: number, max: number): number {
  if (x === undefined) return dflt;
  if (typeof x !== 'number' || !Number.isInteger(x) || x < 1 || x > max) throw new RangeError(`limit must be a whole number from 1 to ${max}`);
  return x;
}

/** Whether `a` chose to be listed by name (PrivacySettings.leaderboards). An account whose settings cannot be read counts as not. */
function namedOnBoards(privacy: ReadonlyMap<AccountId, PrivacySettings>, a: AccountId): boolean {
  return privacy.get(a)?.leaderboards === true;
}

export async function status(core: ServiceCore, viewerIn: AccountId | null): Promise<LadderStatus> {
  const viewer = viewerOf(viewerIn);
  const nowMs = core.nowMs();
  const now = new Date(nowMs).toISOString();
  const current = seasonOf(now);
  const until = viewer === null ? null : cooldownUntil(core, viewer);
  const ladders = [];
  for (const ladder of LADDER_IDS) {
    const def = LADDERS[ladder];
    let me: LadderStatus['ladders'][number]['me'] = null;
    if (viewer !== null) {
      const row = (await core.store.ratings(ladder, [viewer])).get(viewer) ?? null;
      const rec = await core.store.seasonRecord(viewer, ladder, current);
      const floors = await core.floorsOf(ladder, current);
      const rank = liveEligible(def, rec, now) ? await core.store.rankOf({ ladder, season: current, minGames: def.leaderboardGames, now }, rec.standing) : null;
      const { rating, details } = ratingViewOf(def, row, now, floors, rank, false);
      me = { rating, details, season: seasonViewOf(def, current, rec, rank, false) };
    }
    ladders.push({
      ladder,
      offered: core.offered.has(ladder),
      queue: core.queue === null ? { waiting: 0, estimatedWaitMs: null } : core.queue.status(ladder, nowMs),
      me,
    });
  }
  return {
    season: { id: current, endsAt: seasonBounds(current).endsAt },
    signedIn: viewer !== null,
    cooldownUntil: until === null ? null : new Date(until).toISOString(),
    ladders,
  };
}

/** Sets the ladder's listed mirror of these accounts from milestone 14's standings; returns how many records changed (10.1). Serial queue. */
export async function refreshListed(core: ServiceCore, accounts: readonly AccountId[]): Promise<number> {
  const list = [...new Set(accounts)];
  if (list.length === 0) return 0;
  const standings = await core.ports.accounts.standings(list);
  let changed = 0;
  for (const a of list) changed += await core.store.setListed(a, standings.get(a)?.listed === true);
  return changed;
}

export async function leaderboard(
  core: ServiceCore,
  q: { ladder: LadderId; season: SeasonId | 'current'; cursor?: string; limit?: number },
  viewerIn: AccountId | null,
): Promise<LeaderboardPage> {
  if (typeof q !== 'object' || q === null) throw new RangeError('leaderboard: no query');
  const viewer = viewerOf(viewerIn);
  if (!isLadderId(q.ladder)) throw new RangeError(`leaderboard: ${String(q.ladder)} is not a ladder id`);
  const ladder = q.ladder;
  const def = LADDERS[ladder];
  const now = core.nowIso();
  const season = q.season === 'current' ? seasonOf(now) : q.season;
  if (!isSeasonId(season)) throw new RangeError(`leaderboard: ${String(q.season)} is not a season id`);
  const limit = limitOf(q.limit, LADDER_LIMITS.leaderboardPage, LADDER_LIMITS.leaderboardPageMax);
  let after: { key: number; games: number; sortKey: string } | undefined;
  if (q.cursor !== undefined) {
    const c = openCursor(core.cursors, q.cursor, 'leaderboard');
    if (c === null || c.kind !== 'leaderboard') throw new LadderCursorError('leaderboard: the cursor is not one of this server');
    after = { key: c.key, games: c.games, sortKey: c.sortKey };
  }
  const closed = (await core.store.seasonRow(ladder, season))?.status === 'closed';
  const base = { ladder, season, closed, minGames: def.leaderboardGames, now };
  let rows = await core.store.leaderboard({ ...base, after, limit: limit + 1 });
  if (!closed) {
    // the listed mirror, refreshed at read (10.1): if any flag of the page's accounts differs, write the fresh flags and read the page once more
    const accounts = rows.flatMap((r) => (r.account === null ? [] : [r.account]));
    if ((await core.serial(() => refreshListed(core, accounts))) > 0) rows = await core.store.leaderboard({ ...base, after, limit: limit + 1 });
  }
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const total = await core.store.leaderboardCount(base);
  const ranks = new Map<number, number>();
  if (!closed) {
    for (const s of new Set(page.map((r) => r.standing!))) ranks.set(s, await core.store.rankOf({ ladder, season, minGames: def.leaderboardGames, now }, s));
  }
  const live = page.flatMap((r) => (r.account === null ? [] : [r.account]));
  const [privacy, names] = live.length > 0
    ? await Promise.all([core.ports.accounts.privacy(live), core.ports.accounts.names(live)])
    : [new Map<AccountId, PrivacySettings>(), new Map<AccountId, string>()];
  const floors = await core.floorsOf(ladder, season);
  const entries = page.map((r): LeaderboardEntry => {
    const rank = closed ? r.finalRank! : ranks.get(r.standing!)!;
    const display = r.display!;
    const tier = r.tier ?? tierOf(display, floors);
    if (r.account === null) return { rank, display, tier, games: r.games, account: null, name: null, deleted: true, you: false };
    if (viewer === r.account) return { rank, display, tier, games: r.games, account: r.account, name: names.get(r.account) ?? null, deleted: false, you: true };
    if (!namedOnBoards(privacy, r.account) || !names.has(r.account)) {
      return { rank, display, tier, games: null, account: null, name: null, deleted: false, you: false };
    }
    return { rank, display, tier, games: r.games, account: r.account, name: names.get(r.account)!, deleted: false, you: false };
  });
  const last = page[page.length - 1];
  const next = more && last !== undefined
    ? leaderboardCursor(core.cursors, { key: (closed ? last.finalStanding : last.standing)!, games: last.games, sortKey: last.sortKey })
    : null;
  return { ladder, season, closed, total, entries, next };
}

export async function history(
  core: ServiceCore,
  q: { account: AccountId; ladder?: LadderId; cursor?: string; limit?: number },
  viewerIn: AccountId | null,
): Promise<HistoryPage | null> {
  if (typeof q !== 'object' || q === null) throw new RangeError('history: no query');
  const viewer = viewerOf(viewerIn);
  const subject = accountOf('history', q.account);
  if (q.ladder !== undefined && !isLadderId(q.ladder)) throw new RangeError(`history: ${String(q.ladder)} is not a ladder id`);
  const limit = limitOf(q.limit, LADDER_LIMITS.historyPage, LADDER_LIMITS.historyPage);
  let before: { endedAt: string; game: string } | undefined;
  if (q.cursor !== undefined) {
    const c = openCursor(core.cursors, q.cursor, 'history');
    if (c === null || c.kind !== 'history') throw new LadderCursorError('history: the cursor is not one of this server');
    before = { endedAt: c.endedAt, game: c.game };
  }
  if (!(await core.ports.accounts.historyVisible(subject, viewer))) return null;
  const rows = await core.store.history({ account: subject, ladder: q.ladder, before, limit: limit + 1 });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const accounts = [...new Set(page.flatMap((r) => r.seats.flatMap((s) => (s.account === null ? [] : [s.account]))).concat(subject))];
  const privacy = await core.ports.accounts.privacy(accounts);
  const subjectLimited = viewer !== subject && !namedOnBoards(privacy, subject);
  const replays = core.ports.replays !== null && page.length > 0 ? await core.ports.replays.availability(page.map((r) => r.game)) : new Map();
  const entries: HistoryEntry[] = [];
  for (const row of page) entries.push(await historyEntry(core, row, subject, viewer, privacy, subjectLimited, replays.get(row.game) ?? null));
  const last = page[page.length - 1];
  return { account: subject, entries, next: more && last !== undefined ? historyCursor(core.cursors, { endedAt: last.endedAt, game: last.game }) : null };
}

async function historyEntry(
  core: ServiceCore,
  row: HistoryRow,
  subject: AccountId,
  viewer: AccountId | null,
  privacy: ReadonlyMap<AccountId, PrivacySettings>,
  subjectLimited: boolean,
  replay: { until: string; full: boolean } | null,
): Promise<HistoryEntry> {
  const players: HistoryPlayer[] = [];
  for (const s of row.seats) {
    const base = { seat: s.seat, place: s.place, loss: s.loss, lossRule: s.lossRule, outTurn: s.outTurn };
    if (s.account === null) {
      players.push({ ...base, account: null, name: null, deleted: true, tier: null });
    } else if (s.account !== viewer && s.account !== subject && !namedOnBoards(privacy, s.account)) {
      players.push({ ...base, account: null, name: null, deleted: false, tier: null });
    } else {
      const name = await core.ports.accounts.displayNameAt(s.account, s.name, viewer);
      players.push({ ...base, account: s.account, name, deleted: false, tier: s.tierAfter });
    }
  }
  const me = row.seats.find((s) => s.account === subject)!;
  return {
    game: row.game, ladder: row.ladder, season: row.season, endedAt: row.endedAt, turns: row.turns, outcome: row.outcome, players,
    subject: {
      seat: me.seat, place: me.place,
      before: subjectLimited ? null : me.displayBefore,
      after: subjectLimited ? null : me.displayAfter,
      tierAfter: me.tierAfter,
    },
    replay: replay === null ? null : { until: replay.until, full: replay.full },
  };
}

export async function profile(core: ServiceCore, accountIn: AccountId, viewerIn: AccountId | null): Promise<LadderProfile | null> {
  const account = accountOf('profile', accountIn);
  const viewer = viewerOf(viewerIn);
  const standing = await core.ports.accounts.standing(account);
  if (standing === null || standing.status !== 'active') return null;
  const own = viewer === account;
  const limited = !own && !namedOnBoards(await core.ports.accounts.privacy([account]), account);
  const now = core.nowIso();
  const current = seasonOf(now);
  const ratings = [];
  const seasons = [];
  for (const ladder of LADDER_IDS) {
    const def = LADDERS[ladder];
    const row = (await core.store.ratings(ladder, [account])).get(account) ?? null;
    if (row === null) continue;
    const rec: SeasonRecord | null = await core.store.seasonRecord(account, ladder, current);
    const rank = liveEligible(def, rec, now) ? await core.store.rankOf({ ladder, season: current, minGames: def.leaderboardGames, now }, rec.standing) : null;
    ratings.push(ratingViewOf(def, row, now, await core.floorsOf(ladder, current), rank, limited).rating);
    seasons.push(seasonViewOf(def, current, rec, rank, limited));
  }
  const badges: SeasonBadge[] = (await core.store.seasonRecords(account))
    .filter((r) => r.badge !== null)
    .map((r) => ({ ladder: r.ladder, season: r.season, tier: r.badge!, rank: limited ? null : r.finalRank }));
  return { account, limited, ratings, seasons, badges };
}
