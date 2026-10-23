/**
 * M15-3: closing seasons (design 7, 10.1, 6.3, D7, D16). Server only. Run by the sweep (src/service/sweep.ts); each close is one job of the serial
 * queue.
 *
 * A season of a ladder closes once, at the first sweep at which (7):
 *   - the clock is `closeGraceMs` (15 minutes) past the season's end;
 *   - that sweep's ledger read started after that moment and caught up (its last page came back short and no row failed); with no ledger wired
 *     there are no ranked games and this holds at once;
 *   - no running registry entry of the ladder started before the season's end (a game across midnight belongs to the new season, but closing waits
 *     for it to be taken in).
 * Closing then refreshes the season's `listed` flags from milestone 14's standings (as a leaderboard read does), computes every record's final
 * standing with the deviation at the season's END (time away only, no reset: ratingNow at endsAt would count the next season's reset, see
 * src/api/season.ts), ranks the eligible ones competition style, sets every record's badge (the median rule, without the buffer) and marks the
 * season closed, all in one store write (closeSeason). The result does not depend on when the sweep ran.
 */
import { badgeTier, LADDERS, seasonBounds, standingOf, type LadderId, type SeasonId, type TierId } from '../api';
import { isoMs as isoMsOf } from '../api/season';
import type { SeasonRecord, SeasonRow } from '../store/api';
import { daysBetween, deviationAfter } from './views';
import type { ServiceCore } from './core';

/** Records read per page while closing a season. */
const PAGE = 500;

/** The final standing of a record at the season's end, or null when it is not eligible for the final leaderboard then (7, 10.1). */
export function finalStandingOf(ladder: LadderId, r: SeasonRecord, endsAt: string): number | null {
  const def = LADDERS[ladder];
  if (r.account === null || r.display === null || r.deviation === null || r.provisionalFrom === null) return null;
  if (r.games < def.leaderboardGames || !r.listed || !(isoMsOf(r.provisionalFrom) > isoMsOf(endsAt))) return null;
  return standingOf(r.display, deviationAfter(def.model, r.deviation, daysBetween(r.lastGameAt, endsAt)));
}

/** Competition ranks (1, 1, 3) of the final standings; null stays null. */
export function competitionRanks(standings: readonly (number | null)[]): (number | null)[] {
  const ranked = standings.filter((s): s is number => s !== null);
  return standings.map((s) => (s === null ? null : 1 + ranked.filter((x) => x > s).length));
}

/** Closes one season of one ladder (a serial-queue job): 'closed', or 'already' when another close got there first. */
export async function closeSeasonNow(core: ServiceCore, ladder: LadderId, season: SeasonId): Promise<'closed' | 'already'> {
  const row: SeasonRow = await core.seasonRowOf(ladder, season);
  if (row.status === 'closed') return 'already';
  const { endsAt } = seasonBounds(season);
  const records: SeasonRecord[] = [];
  for (let after: string | null = null; ;) {
    const page = await core.store.seasonRecordsOf(ladder, season, after, PAGE);
    records.push(...page);
    if (page.length < PAGE) break;
    after = page[page.length - 1]!.sortKey;
  }
  // the listed mirror, fresh at the close (10.1): a suspended, banned or unlisted account is not on the final board
  const live = records.flatMap((r) => (r.account === null ? [] : [r.account]));
  for (let i = 0; i < live.length; i += PAGE) {
    const batch = live.slice(i, i + PAGE);
    const standings = await core.ports.accounts.standings(batch);
    for (const r of records) {
      if (r.account === null || !batch.includes(r.account)) continue;
      const listed = standings.get(r.account)?.listed === true;
      if (listed !== r.listed) {
        await core.store.setListed(r.account, listed);
        r.listed = listed;
      }
    }
  }
  const standings = records.map((r) => finalStandingOf(ladder, r, endsAt));
  const ranks = competitionRanks(standings);
  const finals = records.map((r, i) => ({
    sortKey: r.sortKey,
    finalStanding: standings[i]!,
    finalRank: ranks[i]!,
    badge: (r.account === null ? null : badgeTier(r.seasonRatings, r.careerGames, row.floors)) as TierId | null,
  }));
  const res = await core.store.closeSeason(ladder, season, finals, core.nowIso());
  if (res === 'closed') {
    core.log.info('season.closed', { ladder, season, records: records.length, eligible: standings.filter((s) => s !== null).length });
  }
  return res;
}
