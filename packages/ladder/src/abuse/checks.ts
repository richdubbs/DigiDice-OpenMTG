/**
 * M15-5: the heuristics of design 11.1 as pure functions over what the store returns (history rows, cap events, miss times, season records). Server
 * only. src/abuse/checker.ts reads the store and calls these; nothing here reads, writes or decides anything but whether a report is drafted (D18).
 *
 * Shared meanings (one place, so every rule reads the ledger the same way):
 * - A window is `[anchor − length, anchor]`, both ends included, by each game's `endedAt` (a cap event's `at`, a miss's time). The anchor is the
 *   end of the game a check runs after, or the time of a miss or of the daily sweep.
 * - A seat **lost** a game when the ledger gave it a loss code other than `draw` (it went out: `life`, `concession`, `left`, `timeout`, ...).
 * - A seat's **end turn** is the turn it went out (`outTurn`), else the game's last turn (`turns`). "Before turn N" is an end turn below N.
 * - Of two seats of one game, the one with the lower place is **ahead**; equal places put neither ahead.
 * - A seat **won** a game when it alone has place 1 (a 1v1 draw is 1, 1: nobody won). In a pod, finishing ahead of another seat is not a win.
 * - The exit that **ended** a game with a winner is that of its runner-up (the seats at place 2; 1v1: the loser). A pod seat's own earlier exit did
 *   not end the game: the others played on.
 * - A game's **change** for a seat is `displayAfter − displayBefore`, in shown points, only when both are shown (after placement, 6.2). "Before"
 *   is after any season reset (13.3), so a reset never counts as a gain or a fall.
 * - A change **came from** the opponents it was taken from: a gain from those placed behind the seat, a fall from those placed ahead of it, split
 *   equally between them (from those level with it when there are none, as in a draw). 1v1: the one opponent, the whole change. An opponent who
 *   finished ahead of the seat never gave it a gain.
 * - A seat's **shown rating after** a game is `displayAfter`: null during placement, when the rating is hidden from everyone and moves by about 100
 *   points a game (6.2). No rule fires on a hidden rating. Evidence may still carry it, the same number from the state (`displayRating`), and says
 *   so (smurf's `hiddenGames`, `hiddenPeak`).
 * - Rows of a deleted account carry `account` null and no rating values (8.7); no rule follows a null account.
 *
 * Evidence holds game ids and numbers only (`AbuseReport.evidence`), never names or decks. A per-game series is written as `name.i` (1-based, in
 * time order), at most the last EVIDENCE_SERIES_MAX entries of it.
 */
import type { AccountId } from '../accounts';
import { displayRating, LADDERS, TIER_IDS, type LadderId, type LossCode } from '../api';
import type { AppliedSeat, CapEvent, HistoryRow, SeasonRecord } from '../store/api';
import type { ResolvedAbuseRules } from './rules';
import type { AbuseDraft, AbuseKind } from './types';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
/** The longest per-game series one report carries (the newest entries; the game ids are always all there). */
export const EVIDENCE_SERIES_MAX = 100;

/** oneSided: how the exit that ended a game went out (a quick end, besides an early one). */
const PAIR_QUITS: ReadonlySet<LossCode> = new Set(['concession', 'left', 'timeout', 'disconnect']);
/** earlyConcessions. */
const EARLY_QUITS: ReadonlySet<LossCode> = new Set(['concession', 'left']);
/** sandbagging (at any turn). */
const SANDBAG_QUITS: ReadonlySet<LossCode> = new Set(['concession', 'left', 'timeout']);

// ---- small helpers ------------------------------------------------------------------------------------------------------------------------------

/** Epoch ms of an ISO-8601 time the server wrote; a RangeError otherwise. */
export function timeMs(iso: string, what = 'time'): number {
  const t = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) throw new RangeError(`abuse: ${what} is not an ISO-8601 time (${String(iso)})`);
  return t;
}

export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** The pod ladders (more than two seats): repeatedPairing counts pods with its own threshold. */
export function isPodLadder(ladder: LadderId): boolean {
  return (LADDERS[ladder]?.seats ?? []).some((n) => n > 2);
}

/** A count rule never fires on nothing, whatever an override sets. */
function enough(n: number, threshold: number): boolean {
  return n >= Math.max(1, threshold);
}

function cmpText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rows once each (by game id), oldest first by (endedAt, game). */
export function inTimeOrder<T extends { game: string; endedAt: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: { row: T; t: number }[] = [];
  for (const row of rows) {
    if (seen.has(row.game)) continue;
    seen.add(row.game);
    out.push({ row, t: timeMs(row.endedAt, `game ${row.game}'s endedAt`) });
  }
  return out.sort((a, b) => a.t - b.t || cmpText(a.row.game, b.row.game)).map((x) => x.row);
}

function within<T extends { endedAt: string }>(rows: readonly T[], fromMs: number, toMs: number): T[] {
  return rows.filter((r) => {
    const t = timeMs(r.endedAt);
    return t >= fromMs && t <= toMs;
  });
}

function seatOf(row: HistoryRow, account: AccountId): AppliedSeat | undefined {
  return row.seats.find((s) => s.account === account);
}

function lost(s: AppliedSeat): boolean {
  return s.loss !== null && s.loss !== 'draw';
}

function endTurn(row: HistoryRow, s: AppliedSeat): number {
  return s.outTurn ?? row.turns;
}

function won(row: HistoryRow, s: AppliedSeat): boolean {
  return s.place === 1 && row.seats.filter((x) => x.place === 1).length === 1;
}

/** The seats whose exit ended the game: its runner-up (place 2) when one seat won; none in a draw. 1v1: the loser. */
function enders(row: HistoryRow): AppliedSeat[] {
  return row.seats.filter((s) => s.place === 1).length === 1 ? row.seats.filter((s) => s.place === 2 && lost(s)) : [];
}

function change(s: AppliedSeat): number | null {
  return s.displayBefore !== null && s.displayAfter !== null ? s.displayAfter - s.displayBefore : null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Parts of a split change are counted in 1/SPLIT_UNITS of a shown point, the least common multiple of 1 .. (most seats − 1): every split of a whole
 * change between the opponents of one game is then a whole number of units, so sums and the share thresholds are exact (6 with pods of 4).
 */
const SPLIT_UNITS = Array.from({ length: Math.max(2, ...Object.values(LADDERS).flatMap((l) => l.seats)) - 1 }, (_, i) => i + 1)
  .reduce((m, k) => (m * k) / gcd(m, k), 1);

/**
 * The opponents a change `delta` of the account's seat came from, each with its part in SPLIT_UNITS (see "came from" above). A deleted seat takes
 * its part and gives it to nobody, so a deletion never moves a part onto the others.
 */
function cameFrom(row: HistoryRow, account: AccountId, delta: number): Map<AccountId, number> {
  const me = seatOf(row, account)!;
  const others = row.seats.filter((s) => s !== me);
  const side = others.filter((s) => (delta >= 0 ? s.place > me.place : s.place < me.place));
  const from = side.length > 0 ? side : others.filter((s) => s.place === me.place);
  const out = new Map<AccountId, number>();
  for (const s of from) if (s.account !== null) out.set(s.account, (out.get(s.account) ?? 0) + (delta * SPLIT_UNITS) / from.length);
  return out;
}

/** Evidence only: the rating after a game, shown or (placement) hidden. No rule fires on it. */
function ratingAfter(s: AppliedSeat): number | null {
  return s.displayAfter ?? (s.after !== null ? displayRating(s.after) : null);
}

/** Evidence only: the rating before a game, shown or (placement) hidden. */
function ratingBefore(s: AppliedSeat): number | null {
  return s.displayBefore ?? (s.before !== null ? displayRating(s.before) : null);
}

/** A part in SPLIT_UNITS as evidence: shown points, two decimals. */
function points(units: number): number {
  return Math.round((units / SPLIT_UNITS) * 100) / 100;
}

/** The other seats' accounts of a row (deleted ones left out). */
function opponents(row: HistoryRow, account: AccountId): AccountId[] {
  const out: AccountId[] = [];
  for (const s of row.seats) if (s.account !== null && s.account !== account) out.push(s.account);
  return out;
}

function series(stats: Record<string, number>, name: string, values: readonly number[]): void {
  for (let i = Math.max(0, values.length - EVIDENCE_SERIES_MAX); i < values.length; i++) stats[`${name}.${i + 1}`] = values[i]!;
}

function count(stats: Record<string, number>, key: string): void {
  stats[key] = (stats[key] ?? 0) + 1;
}

function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function draft(kind: AbuseKind, ladder: LadderId | null, accounts: readonly AccountId[], games: string[], stats: Record<string, number>): AbuseDraft {
  return { kind, ladder, accounts: [...accounts].sort(cmpText), evidence: { games, stats } };
}

// ---- repeatedPairing and oneSided: two accounts of one ladder ---------------------------------------------------------------------------------

/**
 * The pair rules for accounts `a` and `b` in `ladder`, over `rows` (any rows: those without both accounts, outside the windows or repeated are left
 * out). repeatedPairing: at least repeatedPairingGames meetings (pods: repeatedPairingPods) within repeatedPairingDays; evidence the games and the
 * meetings per UTC day (`day.YYYY-MM-DD`). oneSided: at least oneSidedGames meetings within oneSidedDays, one account won at least
 * oneSidedWinShare of them (a meeting neither of the two won, a draw or in a pod another seat's win, is a win for neither), and at least
 * oneSidedQuickShare of them ended quickly: the exit that ended the game was a concession, leave, time-out or disconnect, or it came before turn
 * oneSidedBeforeTurn (a game without a winner counts only by its last turn). The ending exit is the runner-up's (1v1: the loser's), never a pod
 * seat's own earlier exit: the game went on without it. Evidence: the games, each account's wins (`wins.1`, `wins.2`, in the order of `accounts`),
 * the meetings neither won (`neither`), the loss codes of the ending exits (`loss.<code>`), and per meeting the result (`result.i`: 1 or 2 for the
 * account that won, 0 for neither) and the turn it ended (`turn.i`).
 */
export function checkPair(
  a: AccountId,
  b: AccountId,
  ladder: LadderId,
  rows: readonly HistoryRow[],
  anchorMs: number,
  rules: ResolvedAbuseRules,
): AbuseDraft[] {
  if (a === b) return [];
  const [x, y] = cmpText(a, b) < 0 ? [a, b] : [b, a];
  const met = inTimeOrder(rows.filter((r) => r.ladder === ladder && seatOf(r, x) !== undefined && seatOf(r, y) !== undefined));
  const out: AbuseDraft[] = [];

  const recent = within(met, anchorMs - rules.repeatedPairingDays * DAY_MS, anchorMs);
  if (enough(recent.length, isPodLadder(ladder) ? rules.repeatedPairingPods : rules.repeatedPairingGames)) {
    const stats: Record<string, number> = { games: recent.length };
    for (const r of recent) count(stats, `day.${isoAt(timeMs(r.endedAt)).slice(0, 10)}`);
    out.push(draft('repeatedPairing', ladder, [x, y], recent.map((r) => r.game), stats));
  }

  const month = within(met, anchorMs - rules.oneSidedDays * DAY_MS, anchorMs);
  if (enough(month.length, rules.oneSidedGames)) {
    const lossStats: Record<string, number> = {};
    let winsX = 0;
    let winsY = 0;
    let neither = 0;
    let quits = 0;
    let early = 0;
    let quick = 0;
    const results: number[] = [];
    const turns: number[] = [];
    for (const r of month) {
      if (won(r, seatOf(r, x)!)) {
        winsX++;
        results.push(1);
      } else if (won(r, seatOf(r, y)!)) {
        winsY++;
        results.push(2);
      } else {
        neither++;
        results.push(0);
      }
      // how the game ended, whoever won it: by its runner-up's exit (1v1: the loser's), or at its last turn when nobody won
      const ended = enders(r);
      const turn = ended.length > 0 ? Math.max(...ended.map((s) => endTurn(r, s))) : r.turns;
      const quit = ended.some((s) => PAIR_QUITS.has(s.loss!));
      const isEarly = turn < rules.oneSidedBeforeTurn;
      if (quit) quits++;
      if (isEarly) early++;
      if (quit || isEarly) quick++;
      for (const s of ended) count(lossStats, `loss.${s.loss}`);
      turns.push(turn);
    }
    const n = month.length;
    if (Math.max(winsX, winsY) / n >= rules.oneSidedWinShare && quick / n >= rules.oneSidedQuickShare) {
      const stats: Record<string, number> = { games: n, 'wins.1': winsX, 'wins.2': winsY, neither, quick, quits, early, ...lossStats };
      series(stats, 'result', results);
      series(stats, 'turn', turns);
      out.push(draft('oneSided', ladder, [x, y], month.map((r) => r.game), stats));
    }
  }
  return out;
}

// ---- earlyConcessions, ratingTransfer, sandbagging: one account's games in one ladder --------------------------------------------------------

/**
 * The account rules over `rows`, the account's games in `ladder` up to the anchor (rows of other accounts or ladders, outside the windows or
 * repeated are left out): earlyConcessions, ratingTransfer and sandbagging, in that order.
 */
export function checkAccountGames(
  account: AccountId,
  ladder: LadderId,
  rows: readonly HistoryRow[],
  anchorMs: number,
  rules: ResolvedAbuseRules,
): AbuseDraft[] {
  const mine = inTimeOrder(rows.filter((r) => r.ladder === ladder && seatOf(r, account) !== undefined));
  const out: AbuseDraft[] = [];
  const e = earlyConcessions(account, ladder, mine, anchorMs, rules);
  if (e) out.push(e);
  out.push(...ratingTransfer(account, ladder, mine, anchorMs, rules));
  const s = sandbagging(account, ladder, mine, anchorMs, rules);
  if (s) out.push(s);
  return out;
}

/**
 * earlyConcessions: at least earlyConcessionsLosses games lost by concession or leave with an end turn before earlyConcessionsBeforeTurn, within
 * earlyConcessionsDays. Evidence: those games, how many by each code, the distinct opponents and the most of them given to one opponent, and each
 * game's end turn (`turn.i`). The report names the account only: its opponents are evidence (in the games), not suspects.
 */
function earlyConcessions(account: AccountId, ladder: LadderId, mine: HistoryRow[], anchorMs: number, rules: ResolvedAbuseRules): AbuseDraft | null {
  const hits = within(mine, anchorMs - rules.earlyConcessionsDays * DAY_MS, anchorMs).filter((r) => {
    const s = seatOf(r, account)!;
    return s.loss !== null && EARLY_QUITS.has(s.loss) && endTurn(r, s) < rules.earlyConcessionsBeforeTurn;
  });
  if (!enough(hits.length, rules.earlyConcessionsLosses)) return null;
  const byOpponent = new Map<AccountId, number>();
  let concessions = 0;
  let leaves = 0;
  for (const r of hits) {
    if (seatOf(r, account)!.loss === 'concession') concessions++;
    else leaves++;
    for (const o of new Set(opponents(r, account))) byOpponent.set(o, (byOpponent.get(o) ?? 0) + 1);
  }
  const stats: Record<string, number> = {
    losses: hits.length, concessions, leaves, opponents: byOpponent.size, mostToOneOpponent: Math.max(0, ...byOpponent.values()),
  };
  series(stats, 'turn', hits.map((r) => endTurn(r, seatOf(r, account)!)));
  return draft('earlyConcessions', ladder, [account], hits.map((r) => r.game), stats);
}

/**
 * ratingTransfer: the account's changes within ratingTransferDays add up to a gain of at least ratingTransferGain, and the parts of them that came
 * from one opponent add up to at least ratingTransferOpponentShare of that gain. 1v1: the changes of the games against that opponent. A pod's change
 * is split between the opponents it came from (a gain between those the account finished ahead of), so the same pods never make several opponents
 * pass the share, and an opponent who finished ahead of the account is never named for a gain. One report per such opponent, naming the account and
 * the opponent. Evidence: the games the opponent's parts came from, the gain, the opponent's part (`opponentGain`), the game counts, and the part of
 * each of those games (`gain.i`; 1v1 the game's change), in shown points. Placement games count for nothing (their rating is not shown, and a new
 * rating moves by about 100 a game).
 */
function ratingTransfer(account: AccountId, ladder: LadderId, mine: HistoryRow[], anchorMs: number, rules: ResolvedAbuseRules): AbuseDraft[] {
  const rated = within(mine, anchorMs - rules.ratingTransferDays * DAY_MS, anchorMs).filter((r) => change(seatOf(r, account)!) !== null);
  const gain = rated.reduce((sum, r) => sum + change(seatOf(r, account)!)!, 0);
  if (gain <= 0 || gain < rules.ratingTransferGain) return [];
  const byOpponent = new Map<AccountId, { game: string; part: number }[]>();
  for (const r of rated) {
    for (const [o, part] of cameFrom(r, account, change(seatOf(r, account)!)!)) {
      const parts = byOpponent.get(o);
      if (parts) parts.push({ game: r.game, part });
      else byOpponent.set(o, [{ game: r.game, part }]);
    }
  }
  const out: { opponent: AccountId; part: number; parts: { game: string; part: number }[] }[] = [];
  for (const [opponent, parts] of byOpponent) {
    const part = parts.reduce((sum, p) => sum + p.part, 0);
    if (part > 0 && part / (gain * SPLIT_UNITS) >= rules.ratingTransferOpponentShare) out.push({ opponent, part, parts });
  }
  out.sort((p, q) => q.part - p.part || cmpText(p.opponent, q.opponent));
  return out.map(({ opponent, part, parts }) => {
    const stats: Record<string, number> = { gain, opponentGain: points(part), games: rated.length, opponentGames: parts.length };
    series(stats, 'gain', parts.map((p) => points(p.part)));
    return draft('ratingTransfer', ladder, [account, opponent], parts.map((p) => p.game), stats);
  });
}

/**
 * sandbagging: over the account's shown games (after placement) within sandbaggingFallDays + sandbaggingRiseDays, a run of consecutive games
 * i..j spanning at most sandbaggingFallDays whose changes add up to a fall of at least sandbaggingFall, with at least one loss and at least
 * sandbaggingQuitShare of its losses by concession, leave or time-out (at any turn); then a run j+1..k ending at most sandbaggingRiseDays after
 * game j whose changes add up to a rise of at least sandbaggingRise. The earliest such j is reported, with its largest qualifying fall and its
 * largest rise. Evidence: games i..k, the fall and the rise, their game counts, the losses and quits of the fall (with `loss.<code>`), the shown
 * rating at the start, the bottom and the end, the mean shown rating of the opponents in the fall and in the rise (the farming signal), and the
 * shown rating after each game (`rating.i`).
 */
function sandbagging(account: AccountId, ladder: LadderId, mine: HistoryRow[], anchorMs: number, rules: ResolvedAbuseRules): AbuseDraft | null {
  const fromMs = anchorMs - (rules.sandbaggingFallDays + rules.sandbaggingRiseDays) * DAY_MS;
  const games = within(mine, fromMs, anchorMs).filter((r) => change(seatOf(r, account)!) !== null);
  const n = games.length;
  if (n < 2) return null;
  const seats = games.map((r) => seatOf(r, account)!);
  const t = games.map((r) => timeMs(r.endedAt));
  const sum = [0];
  const losses = [0];
  const quits = [0];
  seats.forEach((s, i) => {
    sum.push(sum[i]! + change(s)!);
    losses.push(losses[i]! + (lost(s) ? 1 : 0));
    quits.push(quits[i]! + (lost(s) && SANDBAG_QUITS.has(s.loss!) ? 1 : 0));
  });
  const fallSpan = rules.sandbaggingFallDays * DAY_MS;
  const riseSpan = rules.sandbaggingRiseDays * DAY_MS;
  for (let j = 0; j < n - 1; j++) {
    // the largest rise after game j, within the next riseSpan (the earliest k on a tie)
    let k = -1;
    let rise = -Infinity;
    for (let m = j + 1; m < n && t[m]! - t[j]! <= riseSpan; m++) {
      const r = sum[m + 1]! - sum[j + 1]!;
      if (r > rise) {
        rise = r;
        k = m;
      }
    }
    if (k < 0 || rise <= 0 || rise < rules.sandbaggingRise) continue;
    // the largest fall ending at game j, starting at most fallSpan before it, that meets the loss rule (the earliest i on a tie)
    let i = -1;
    let fall = -Infinity;
    for (let m = 0; m <= j; m++) {
      if (t[j]! - t[m]! > fallSpan) continue;
      const f = sum[m]! - sum[j + 1]!;
      const l = losses[j + 1]! - losses[m]!;
      const q = quits[j + 1]! - quits[m]!;
      if (f > 0 && f >= rules.sandbaggingFall && l >= 1 && q / l >= rules.sandbaggingQuitShare && f > fall) {
        fall = f;
        i = m;
      }
    }
    if (i < 0) continue;
    const stats: Record<string, number> = {
      fall, rise, fallGames: j - i + 1, riseGames: k - j, losses: losses[j + 1]! - losses[i]!, quits: quits[j + 1]! - quits[i]!,
      ratingStart: seats[i]!.displayBefore!, ratingLow: seats[j]!.displayAfter!, ratingEnd: seats[k]!.displayAfter!,
    };
    for (let m = i; m <= j; m++) if (lost(seats[m]!)) count(stats, `loss.${seats[m]!.loss}`);
    const opponentRatings = (from: number, to: number) => {
      const xs: number[] = [];
      for (let m = from; m <= to; m++) {
        for (const s of games[m]!.seats) {
          if (s.account === account) continue;
          const shown = ratingBefore(s);
          if (shown !== null) xs.push(shown);
        }
      }
      return mean(xs);
    };
    const fallOpponents = opponentRatings(i, j);
    const riseOpponents = opponentRatings(j + 1, k);
    if (fallOpponents !== null) stats['fallOpponents'] = fallOpponents;
    if (riseOpponents !== null) stats['riseOpponents'] = riseOpponents;
    series(stats, 'rating', seats.slice(i, k + 1).map((s) => s.displayAfter!));
    return draft('sandbagging', ladder, [account], games.slice(i, k + 1).map((r) => r.game), stats);
  }
  return null;
}

// ---- smurf: a new account's first games in one ladder -------------------------------------------------------------------------------------

/**
 * smurf: the account was made (`createdAt`, milestone 14's Standing) at most smurfAccountDays before the anchor, and has at most smurfMaxGames
 * rated games in `ladder` up to the anchor, and either won at least smurfWinShare of them with at least smurfMinGames, or reached a shown rating of
 * smurfRating after one of them. Shown means `displayAfter`: a hidden placement rating never fires it (during placement a new rating moves by
 * about 100 a game, so an ordinary new player's early run would; 6.2), so a smurf whose climb starts in placement is seen at its first shown
 * rating, after its 10th game. `rows` must hold every game of the account in the ladder up to the anchor, or at least smurfMaxGames + 1 of the
 * newest (more than the limit: no report). Evidence: the games, the wins and the win rate, the account's age in whole days, which clause fired
 * (`byWins`, `byRating`, 1 or 0), the highest shown rating (`peak`, when one was shown), the game that first reached smurfRating (`reachedAt`,
 * 1-based), the games after which the rating was still hidden (`hiddenGames`) and the highest hidden one (`hiddenPeak`, when there was one), and
 * the rating after each game, hidden ones included (`rating.i`).
 */
export function checkSmurf(
  account: AccountId,
  ladder: LadderId,
  rows: readonly HistoryRow[],
  createdAt: string,
  anchorMs: number,
  rules: ResolvedAbuseRules,
): AbuseDraft | null {
  const age = anchorMs - timeMs(createdAt, 'createdAt');
  if (age > rules.smurfAccountDays * DAY_MS) return null;
  const games = inTimeOrder(rows.filter((r) => r.ladder === ladder && seatOf(r, account) !== undefined && timeMs(r.endedAt) <= anchorMs));
  if (games.length === 0 || games.length > rules.smurfMaxGames) return null;
  const seats = games.map((r) => seatOf(r, account)!);
  const wins = games.filter((r, i) => won(r, seats[i]!)).length;
  const reached = seats.findIndex((s) => s.displayAfter !== null && s.displayAfter >= rules.smurfRating);
  const byWins = enough(games.length, rules.smurfMinGames) && wins / games.length >= rules.smurfWinShare;
  const byRating = reached >= 0;
  if (!byWins && !byRating) return null;
  const shown = seats.flatMap((s) => (s.displayAfter === null ? [] : [s.displayAfter]));
  const hidden = seats.flatMap((s) => {
    const r = s.displayAfter === null ? ratingAfter(s) : null;
    return r === null ? [] : [r];
  });
  const stats: Record<string, number> = {
    games: games.length, wins, winRate: wins / games.length, ageDays: Math.floor(Math.max(0, age) / DAY_MS),
    byWins: byWins ? 1 : 0, byRating: byRating ? 1 : 0, hiddenGames: seats.filter((s) => s.displayAfter === null).length,
  };
  if (shown.length > 0) stats['peak'] = Math.max(...shown);
  if (hidden.length > 0) stats['hiddenPeak'] = Math.max(...hidden);
  if (byRating) stats['reachedAt'] = reached + 1;
  series(stats, 'rating', seats.flatMap((s) => {
    const r = ratingAfter(s);
    return r === null ? [] : [r];
  }));
  return draft('smurf', ladder, [account], games.map((r) => r.game), stats);
}

// ---- capStall: an account's cap events (rated and void games, every ladder) -------------------------------------------------------------------

/**
 * capStall: the account was in at least capStallGames ranked games that reached a per-game cap within capStallDays (by the event's `at`), each as
 * the driver or in a void without one; a cap whose driver was another seat does not count. Across ladders (the rule names none), so the report's
 * ladder is null. Evidence: those games, how many as the driver and how many void, how many at each cap, and the account's share in each
 * (`share.i`).
 */
export function checkCapStall(account: AccountId, events: readonly CapEvent[], anchorMs: number, rules: ResolvedAbuseRules): AbuseDraft | null {
  const fromMs = anchorMs - rules.capStallDays * DAY_MS;
  const seen = new Set<string>();
  const hits: { e: CapEvent; share: number; driver: boolean; t: number }[] = [];
  for (const e of events) {
    if (seen.has(e.game)) continue;
    seen.add(e.game);
    const t = timeMs(e.at, `cap event ${e.game}'s at`);
    if (t < fromMs || t > anchorMs) continue;
    const seat = e.seats.find((s) => s.account === account);
    if (seat === undefined) continue;
    const driver = e.verdict.kind === 'driver' && e.verdict.seat === seat.seat;
    if (e.verdict.kind === 'void' || driver) hits.push({ e, share: seat.share, driver, t });
  }
  if (!enough(hits.length, rules.capStallGames)) return null;
  hits.sort((p, q) => p.t - q.t || cmpText(p.e.game, q.e.game));
  const stats: Record<string, number> = {
    caps: hits.length,
    asDriver: hits.filter((h) => h.driver).length,
    voidCaps: hits.filter((h) => !h.driver).length,
    actionCaps: hits.filter((h) => h.e.kind === 'actions').length,
    timeCaps: hits.filter((h) => h.e.kind === 'time').length,
  };
  series(stats, 'share', hits.map((h) => h.share));
  return draft('capStall', null, [account], hits.map((h) => h.e.game), stats);
}

// ---- dodging: missed ranked ready checks (every ladder) ---------------------------------------------------------------------------------------

/**
 * dodging: at least dodgingMisses missed ranked ready checks within dodgingHours (each time once). Ready checks are anonymous and the cooldowns
 * count every ladder (8.6), so the report's ladder is null. Evidence: no games; the count and each miss's time in epoch ms (`miss.i`).
 */
export function checkDodging(account: AccountId, misses: readonly string[], anchorMs: number, rules: ResolvedAbuseRules): AbuseDraft | null {
  const fromMs = anchorMs - rules.dodgingHours * HOUR_MS;
  const times = [...new Set(misses.map((m) => timeMs(m, 'a miss')))].filter((t) => t >= fromMs && t <= anchorMs).sort((a, b) => a - b);
  if (!enough(times.length, rules.dodgingMisses)) return null;
  const stats: Record<string, number> = { misses: times.length };
  series(stats, 'miss', times);
  return draft('dodging', null, [account], [], stats);
}

// ---- parkedHigh: a closed season's records ----------------------------------------------------------------------------------------------------

/**
 * Whether a closed season's record is a parkedHigh case, and its evidence numbers: a final rank of at most parkedHighTopRank, or a badge at
 * TIER_IDS index parkedHighBadgeTier or above (Laser); the season's last rated game (`lastGameAt`) at least parkedHighIdleDays before the season's
 * end (`endsAtMs`); and the shown rating after it (`display`) at least parkedHighAboveMedian above the median of the season's post-placement
 * ratings. Null otherwise, and for a deleted account's record. Stats: the display, the median and the gap, the days parked, the season's games,
 * the final rank and the badge's tier index (when set), and the season's ratings (`rating.i`). checker.ts adds the last game's id.
 */
export function parkedHighStats(record: SeasonRecord, endsAtMs: number, rules: ResolvedAbuseRules): Record<string, number> | null {
  if (record.account === null || record.display === null || record.seasonRatings.length === 0) return null;
  const rankHigh = record.finalRank !== null && record.finalRank >= 1 && record.finalRank <= rules.parkedHighTopRank;
  const badge = record.badge === null ? -1 : (TIER_IDS as readonly string[]).indexOf(record.badge);
  const badgeHigh = badge >= 0 && badge >= rules.parkedHighBadgeTier;
  if (!rankHigh && !badgeHigh) return null;
  const idle = endsAtMs - timeMs(record.lastGameAt, 'lastGameAt');
  if (idle < rules.parkedHighIdleDays * DAY_MS) return null;
  const med = median(record.seasonRatings);
  const above = record.display - med;
  if (above < rules.parkedHighAboveMedian) return null;
  const stats: Record<string, number> = {
    display: record.display, median: med, aboveMedian: above, idleDays: idle / DAY_MS, seasonGames: record.games,
  };
  if (record.finalRank !== null) stats['finalRank'] = record.finalRank;
  if (badge >= 0) stats['badge'] = badge;
  series(stats, 'rating', record.seasonRatings);
  return stats;
}

export function parkedHighDraft(record: SeasonRecord, stats: Record<string, number>, lastGame: string | null): AbuseDraft {
  return draft('parkedHigh', record.ladder, [record.account!], lastGame === null ? [] : [lastGame], stats);
}
