/**
 * M15-3: what the ranked queue and the start of a ranked game need from the ladder (design 8.1, 8.6, 9.1, 9.4, 6.4, D8, D9, D12, D14). Server only.
 *
 * - `eligibility`: may this account queue for this ladder now.
 * - `entryFor`: the matcher's entry (rating now, placement, the last 3 games' opponents) and the blocks between it and the queue.
 * - `readyCheckMissed`: the escalating cooldowns of 8.6 over a rolling 24 hours, stored per account (PenaltyRow), so a restart keeps them; the
 *   service keeps the active ones in memory for the matcher's synchronous check. Missing costs no rating.
 * - `registerStart`: the registry entry of a ranked game (D8), with each seat's stored rating row as it was at the start (NOT reset: intake applies
 *   ratingNow at the game's end exactly as for a live row, so a game across a season boundary resets once, G10b). Idempotent by game id. An account
 *   is in at most one running ranked game (D9): a start naming an account busy with another game is refused.
 * - `stakes`: what the game can do to each player's shown rating (6.4), a preview from ratingNow at startedAt; null deltas during placement.
 */
import {
  ACCOUNT_ID_SHAPE, displayRating, initialState, isLadderId, LADDERS, ratingNow, seasonOf, stakesOneVsOne, stakesPod, type Glicko2State,
  type LadderId, type SeatNo, type Stakes, type WengLinState,
} from '../api';
import { isoMs } from '../api/season';
import type { AccountId } from '../accounts';
import type { RankedStart, StartSeat } from '../ledger';
import { DEFAULT_RANKED_POLICY, type RankedEntry, type RankedMatcherContext } from '../match/api';
import { newMatchId } from '../ids';
import type { Eligibility, RankedStartInput } from './api';
import { DAY_MS, type ServiceCore } from './core';

const GAME_ID = /^[0-9A-Za-z_-]{1,64}$/;

function account(label: string, x: unknown): AccountId {
  if (typeof x !== 'string' || !ACCOUNT_ID_SHAPE.test(x)) throw new RangeError(`${label}: ${String(x)} is not an account id`);
  return x as AccountId;
}

function ladderOf(label: string, x: unknown): LadderId {
  if (!isLadderId(x)) throw new RangeError(`${label}: ${String(x)} is not a ladder id`);
  return x;
}

export function cooldownUntil(core: ServiceCore, a: AccountId): number | null {
  const u = core.cooldowns.get(a);
  if (u === undefined) return null;
  if (u <= core.nowMs()) {
    core.cooldowns.delete(a);
    return null;
  }
  return u;
}

export async function eligibility(core: ServiceCore, a: AccountId, ladder: LadderId): Promise<Eligibility> {
  core.mustBeOpen('eligibility');
  if (!isLadderId(ladder) || !core.offered.has(ladder)) return { ok: false, reason: 'notOffered' };
  if (typeof a !== 'string' || !ACCOUNT_ID_SHAPE.test(a)) return { ok: false, reason: 'notSignedIn' };
  const standing = await core.ports.accounts.standing(a);
  if (standing === null || standing.ranked !== true) return { ok: false, reason: 'notAllowed' };
  if (core.busy.has(a)) return { ok: false, reason: 'inRankedGame' };
  if (core.queue !== null && core.queue.queued(a) !== null) return { ok: false, reason: 'inQueue' };
  const until = cooldownUntil(core, a);
  if (until !== null) return { ok: false, reason: 'cooldown', until: new Date(until).toISOString() };
  return { ok: true };
}

export function matcherContext(core: ServiceCore, sessionBusy: (session: string) => boolean): RankedMatcherContext {
  if (typeof sessionBusy !== 'function') throw new TypeError('matcherContext: sessionBusy is not a function');
  return {
    sessionBusy,
    accountBusy: (a) => core.busy.has(a),
    cooldown: (a, now) => {
      const u = core.cooldowns.get(a);
      return u !== undefined && u > now;
    },
    offered: (l) => core.offered.has(l),
    newMatchId: () => newMatchId(core.nowMs()),
    policy: DEFAULT_RANKED_POLICY,
  };
}

export async function entryFor(
  core: ServiceCore,
  q: { account: AccountId; session: string; addressKey: string; ladder: LadderId; deck: string; enteredAt: number },
  queued: readonly AccountId[],
): Promise<{ entry: RankedEntry; blocks: [AccountId, AccountId][] }> {
  const a = account('entryFor', q.account);
  const ladder = ladderOf('entryFor', q.ladder);
  const def = LADDERS[ladder];
  const now = core.nowIso();
  const row = (await core.store.ratings(ladder, [a])).get(a) ?? null;
  const rn = ratingNow(row ?? { state: initialState(def.model), season: seasonOf(now), lastRatedAt: null }, now);
  const recent = await core.store.recentOpponents(a, ladder, DEFAULT_RANKED_POLICY.rematchGames);
  const others = [...new Set(queued)].filter((x) => x !== a);
  const pairs = others.length > 0 ? await core.ports.accounts.blockedAmong([a, ...others]) : [];
  const blocks = pairs.filter(([x, y]) => x === a || y === a).map(([x, y]): [AccountId, AccountId] => [x, y]);
  return {
    entry: {
      account: a, session: q.session, addressKey: q.addressKey, ladder, deck: q.deck, enteredAt: q.enteredAt,
      rating: displayRating(rn.state), deviation: rn.deviation, placement: (row?.games ?? 0) < def.placementGames, recent,
    },
    blocks,
  };
}

export async function readyCheckMissed(
  core: ServiceCore,
  match: string,
  accounts: readonly AccountId[],
): Promise<{ account: AccountId; cooldownUntil: string | null }[]> {
  core.mustBeOpen('readyCheckMissed');
  const list = [...new Set(accounts.map((a) => account('readyCheckMissed', a)))];
  const now = core.nowMs();
  const nowIso = new Date(now).toISOString();
  const out: { account: AccountId; cooldownUntil: string | null; misses: string[] }[] = [];
  for (const a of list) {
    const prev = await core.store.penalties(a);
    const misses = [...(prev?.misses ?? []).filter((m) => isoMs(m) > now - DAY_MS), nowIso];
    const n = misses.length;
    // the 1st miss within 24 hours costs nothing, the 2nd config.cooldowns[0], the 3rd [1], the 4th and later [2] (8.6)
    const ms = n < 2 ? 0 : core.config.cooldowns[Math.min(n - 2, core.config.cooldowns.length - 1)]!;
    const running = prev?.cooldownUntil != null && isoMs(prev.cooldownUntil) > now ? isoMs(prev.cooldownUntil) : null;
    const until = ms > 0 ? Math.max(now + ms, running ?? 0) : running;
    const row = { account: a, misses, cooldownUntil: until === null ? null : new Date(until).toISOString() };
    await core.store.putPenalties(row);
    if (until === null) core.cooldowns.delete(a);
    else core.cooldowns.set(a, until);
    out.push({ account: a, cooldownUntil: row.cooldownUntil, misses });
  }
  core.log.info('ranked.readyCheckMissed', { match, accounts: list.length, cooldowns: out.filter((o) => o.cooldownUntil !== null).length });
  for (const o of out) await core.check('afterMiss', (ctx) => core.ports.abuse.afterMiss(o.account, o.misses, ctx));
  return out.map(({ account: a, cooldownUntil: c }) => ({ account: a, cooldownUntil: c }));
}

export async function registerStart(core: ServiceCore, s: RankedStartInput): Promise<void> {
  core.mustBeOpen('registerStart');
  if (typeof s !== 'object' || s === null) throw new RangeError('registerStart: no start');
  if (typeof s.game !== 'string' || !GAME_ID.test(s.game)) throw new RangeError(`registerStart: ${String(s.game)} is not a game id`);
  if (typeof s.match !== 'string' || !GAME_ID.test(s.match)) throw new RangeError(`registerStart: ${String(s.match)} is not a match id`);
  const ladder = ladderOf('registerStart', s.ladder);
  const def = LADDERS[ladder];
  isoMs(s.startedAt, 'startedAt');
  if (!Array.isArray(s.seats) || !(def.seats as readonly number[]).includes(s.seats.length)) {
    throw new RangeError(`registerStart: ${ladder} games have ${def.seats.join(' or ')} seats`);
  }
  const seats = [...s.seats].sort((x, y) => x.seat - y.seat);
  seats.forEach((x, i) => {
    if (x.seat !== i + 1) throw new RangeError(`registerStart: the seats must be 1-${seats.length}, once each`);
    account(`registerStart seat ${x.seat}`, x.account);
  });
  if (new Set(seats.map((x) => x.account)).size !== seats.length) throw new RangeError('registerStart: an account holds two seats');
  if ((await core.store.start(s.game)) !== null) return; // idempotent: the first registration stands
  for (const x of seats) {
    const other = core.busy.get(x.account);
    if (other !== undefined && other !== s.game) throw new Error(`registerStart: seat ${x.seat}'s account is already in a running ranked game (D9)`);
  }
  const rows = await core.store.ratings(ladder, seats.map((x) => x.account));
  const startSeats: StartSeat[] = seats.map((x) => {
    const row = rows.get(x.account);
    return {
      seat: x.seat as SeatNo,
      account: x.account,
      row: row ? { state: row.state, season: row.season, lastRatedAt: row.lastRatedAt } : { state: initialState(def.model), season: seasonOf(s.startedAt), lastRatedAt: null },
      games: row?.games ?? 0,
    };
  });
  const start: RankedStart = { game: s.game, match: s.match, ladder, startedAt: s.startedAt, seats: startSeats, status: 'running', closedAt: null };
  await core.store.putStart(start);
  for (const x of seats) core.busy.set(x.account, s.game);
  core.log.info('ranked.started', { game: s.game, match: s.match, ladder, seats: seats.length });
}

export async function stakes(core: ServiceCore, game: string): Promise<Map<AccountId, Stakes>> {
  const out = new Map<AccountId, Stakes>();
  const start = await core.store.start(game);
  if (start === null) return out;
  const def = LADDERS[start.ladder];
  const seats = start.seats.filter((x) => x.row !== null);
  const startMs = isoMs(start.startedAt);
  const states = seats.map((x) => ratingNow(x.row!, start.startedAt).state);
  const days = seats.map((x) => (x.row!.lastRatedAt === null ? 0 : Math.max(0, startMs - isoMs(x.row!.lastRatedAt)) / DAY_MS));
  seats.forEach((x, i) => {
    if (x.account === null) return;
    const placed = x.games >= def.placementGames;
    if (def.model === 'glicko2') {
      const j = i === 0 ? 1 : 0;
      const st = placed && seats.length === 2
        ? stakesOneVsOne(states[i] as Glicko2State, states[j] as Glicko2State, days[i]!, days[j]!)
        : null;
      out.set(x.account, { ladder: start.ladder, kind: '1v1', win: st?.win ?? null, draw: st?.draw ?? null, loss: st?.loss ?? null });
    } else {
      const byPlace = placed ? stakesPod(states as WengLinState[], i, days) : states.map(() => null);
      out.set(x.account, { ladder: start.ladder, kind: 'pod', byPlace });
    }
  });
  return out;
}
