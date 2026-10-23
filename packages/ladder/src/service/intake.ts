/**
 * M15-3: one ledger record through intake (design 8.2, 8.3, 8.5, 8.7, D8-D10): the adapter, then the store's one atomic write. Server only. Runs
 * as a job of the serial queue (src/service/core.ts); `intakeRecord` itself never queues, so the sweep can queue each record as a job of its own.
 *
 * - A RatedGame: the stored rows are read, `computeApplication` (pure) says what to write, `applyGame` writes it with the registry close and the
 *   applied marker in one step. On 'conflict' (a stale version, or a seat erased since, 8.3) the registry entry and the rows are read afresh and the
 *   game is computed again, at most 3 times in all; then the intake answers 'failed' and the sweep takes the game again.
 * - A skip: what 8.2's table stores, in one `markSkipped` write (the marker, the cap event, the registry close), then "not rated" to the seats
 *   where the table says so. `unranked` stores nothing; `closed` answers 'duplicate' (its marker exists).
 * - A store or port failure answers 'failed' with nothing written (each write is atomic), logged at warn.
 */
import { LADDERS, seasonOf, type NotRatedReason } from '../api';
import type { AccountId } from '../accounts';
import { capProblem, copyCap, isIntakeSkip, toRatedGame } from '../intake/adapter';
import { capEventOf, computeApplication } from '../intake/apply';
import type { IntakeResult, IntakeSkip, LedgerGameRecord, RankedStart, RatedGame } from '../ledger';
import type { CapEvent, SeasonRecord } from '../store/api';
import { liveAccounts, message, type ServiceCore } from './core';

/** Conflicts tolerated before the intake answers 'failed' (8.3). */
export const INTAKE_ATTEMPTS = 3;

const NOT_RATED: Partial<Record<IntakeSkip['skip'], NotRatedReason>> = {
  lost: 'lost', mismatch: 'mismatch', void: 'void', malformed: 'malformed', ladderOff: 'ladderOff',
};

/** 8.2: logged at warn (a hosted bug or a ledger row the ladder never started); the others at info. */
const WARN_SKIPS: ReadonlySet<IntakeSkip['skip']> = new Set(['unregistered', 'mismatch', 'malformed']);

function isIsoTime(x: unknown): x is string {
  try {
    seasonOf(x as string);
    return true;
  } catch {
    return false;
  }
}

export async function intakeRecord(core: ServiceCore, record: LedgerGameRecord): Promise<IntakeResult> {
  const game = typeof record === 'object' && record !== null && typeof record.game === 'string' ? record.game : '';
  if (game === '' || game.length > 64) {
    // nothing can key it: never stored, never retried (the cursor passes it)
    core.log.warn('intake.skipped', { game: game.slice(0, 64), reason: 'malformed', detail: 'the record has no game id' });
    return { kind: 'skipped', game, reason: 'malformed' };
  }
  try {
    let start = await core.store.start(game);
    for (let attempt = 1; ; attempt++) {
      const out = toRatedGame(record, start, (l) => core.offered.has(l));
      if (isIntakeSkip(out)) return await storeSkip(core, record, start, out);
      const res = await applyRated(core, out, start!);
      if (res !== 'conflict') return res;
      if (attempt >= INTAKE_ATTEMPTS) {
        core.log.warn('intake.failed', { game, error: `${INTAKE_ATTEMPTS} conflicts` });
        return { kind: 'failed', game, error: `${INTAKE_ATTEMPTS} conflicts: the rows or the registry entry kept changing` };
      }
      start = await core.store.start(game);
    }
  } catch (e) {
    core.log.warn('intake.failed', { game, error: message(e) });
    return { kind: 'failed', game, error: message(e) };
  }
}

async function storeSkip(core: ServiceCore, record: LedgerGameRecord, start: RankedStart | null, skip: IntakeSkip): Promise<IntakeResult> {
  const { game } = skip;
  if (skip.skip === 'unranked') return { kind: 'skipped', game, reason: 'unranked' };
  if (skip.skip === 'closed') return { kind: 'duplicate', game };
  const now = core.nowIso();
  let cap: CapEvent | null = null;
  if (start !== null && record.cap !== undefined && record.cap !== null) {
    const problem = capProblem(record.cap, start.seats.map((s) => s.seat));
    if (problem === null) cap = capEventOf(copyCap(record.cap), start, start.ladder, isIsoTime(record.endedAt) ? record.endedAt : now);
    else core.log.warn('intake.capDropped', { game, detail: problem });
  }
  const stored = await core.store.markSkipped({ game, reason: skip.skip, at: now, closeStartAs: skip.closeStartAs, cap });
  if (stored === 'duplicate') return { kind: 'duplicate', game };
  (WARN_SKIPS.has(skip.skip) ? core.log.warn : core.log.info).call(core.log, 'intake.skipped', { game, reason: skip.skip, detail: skip.detail });
  if (start !== null) {
    if (skip.closeStartAs !== null) core.freeStart(start);
    const reason = NOT_RATED[skip.skip];
    if (skip.notRated && reason !== undefined) core.emitNotRated({ game, ladder: start.ladder, reason, accounts: liveAccounts(start) });
  }
  return { kind: 'skipped', game, reason: skip.skip };
}

async function applyRated(core: ServiceCore, game: RatedGame, start: RankedStart): Promise<IntakeResult | 'conflict'> {
  const live = game.seats.flatMap((s) => (s.account === null ? [] : [s.account]));
  const [ratings, standings] = await Promise.all([
    core.store.ratings(game.ladder, live),
    live.length > 0 ? core.ports.accounts.standings(live) : Promise.resolve(new Map()),
  ]);
  const seasons = new Map<AccountId, SeasonRecord>();
  for (const a of live) {
    const r = await core.store.seasonRecord(a, game.ladder, game.season);
    if (r !== null) seasons.set(a, r);
  }
  const listed = new Map<AccountId, boolean>(live.map((a) => [a, standings.get(a)?.listed === true]));
  const row = await core.seasonRowOf(game.ladder, game.season);
  const app = computeApplication(game, start, { ratings, seasons, listed }, {
    floors: row.floors, appliedAt: core.nowIso(), seasonOpen: row.status !== 'closed',
  });
  for (const v of app.volatilityKept) core.log.warn('glicko2.volatilityKept', { game: game.game, seat: v.seat, iterations: v.iterations });
  if (row.status === 'closed') core.log.warn('intake.closedSeason', { game: game.game, ladder: game.ladder, season: game.season });
  const res = await core.store.applyGame(app.applied);
  if (res === 'conflict') {
    core.log.info('intake.conflict', { game: game.game });
    return 'conflict';
  }
  if (res === 'duplicate') return { kind: 'duplicate', game: game.game };
  core.freeStart(start);
  core.log.info('intake.applied', { game: game.game, ladder: game.ladder, model: LADDERS[game.ladder].model });
  core.emitRated(app.notices, game.game);
  await core.check('afterGame', (ctx) => core.ports.abuse.afterGame(app.applied, ctx));
  return { kind: 'applied', game: game.game, notices: app.notices };
}
