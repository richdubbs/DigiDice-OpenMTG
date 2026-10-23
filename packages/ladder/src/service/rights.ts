/**
 * M15-3: the ladder as milestone 14's `AccountDataHolder` (design 8.7, D13; LadderService.exportAccount and forgetAccount), the moderators' rating
 * reset (11.3) and the change feed's listed mirror (10.1, standingChanged). Server only. Each runs as one serial-queue job (8.3), so an erasure
 * waits for any computation in flight and then leaves nothing of the id behind.
 */
import { ACCOUNT_ID_SHAPE, LADDER_IDS, type LadderId } from '../api';
import type { AccountId } from '../accounts';
import type { ForgetReport, IntakeCursor } from '../store/api';
import { LadderStoreError } from '../store/memory';
import type { LadderExport } from './api';
import type { ServiceCore } from './core';
import { refreshListed } from './reads';
import { resetRatingIn } from './reset';

const PAGE = 500;

function accountOf(label: string, x: unknown): AccountId {
  if (typeof x !== 'string' || !ACCOUNT_ID_SHAPE.test(x)) throw new RangeError(`${label}: ${String(x)} is not an account id`);
  return x as AccountId;
}

/** Only this account's data (JSON-safe): its rating rows, season records and badges, its own seat of each rated game, its penalties. */
export async function exportAccount(core: ServiceCore, accountIn: AccountId): Promise<LadderExport> {
  const account = accountOf('exportAccount', accountIn);
  const ratings = [];
  for (const ladder of LADDER_IDS) {
    const row = (await core.store.ratings(ladder, [account])).get(account);
    if (row) ratings.push(row);
  }
  const games: LadderExport['games'] = [];
  for (let before: IntakeCursor | undefined; ;) {
    const page = await core.store.history({ account, before, limit: PAGE });
    for (const h of page) {
      const seat = h.seats.find((s) => s.account === account);
      if (seat) games.push({ game: h.game, ladder: h.ladder, season: h.season, endedAt: h.endedAt, outcome: h.outcome, seat });
    }
    if (page.length < PAGE) break;
    const last = page[page.length - 1]!;
    before = { endedAt: last.endedAt, game: last.game };
  }
  return { ratings, seasons: await core.store.seasonRecords(account), games, penalties: await core.store.penalties(account) };
}

/**
 * 8.7: the store's erasure, then the memory forgets the account (its busy entry and its cooldown). Run again it finds nothing more. A store that
 * answers 'notCompacted' has committed the erasure (every read answers without the id) but could not yet drop its old copies: the memory forgets
 * the account all the same, and the refusal goes back to milestone 14's erasure, which calls the holder again and so finishes it (review of M15-3).
 */
export async function forgetAccount(core: ServiceCore, accountIn: AccountId): Promise<ForgetReport> {
  const account = accountOf('forgetAccount', accountIn);
  let report: ForgetReport;
  try {
    report = await core.store.forgetAccount(account);
  } catch (e) {
    if (e instanceof LadderStoreError && e.code === 'notCompacted') {
      core.busy.delete(account);
      core.cooldowns.delete(account);
      core.log.warn('ladder.forgotNotCompacted', { error: e.message });
    }
    throw e;
  }
  core.busy.delete(account);
  core.cooldowns.delete(account);
  core.log.info('ladder.forgot', { ...report });
  return report;
}

/** 11.3: the rating back to the initial state with placement again, audited; nothing is recomputed. */
export async function resetRating(core: ServiceCore, accountIn: AccountId, ladder: LadderId, by: string, reason: string): Promise<void> {
  const account = accountOf('resetRating', accountIn);
  const audit = await resetRatingIn(core.store, account, ladder, by, reason, core.nowMs());
  core.log.info('ladder.ratingReset', { ladder, audit: audit.id });
}

/** Milestone 14's change feed (standing, deleting, deleted): the ladder's listed mirror of these accounts, from fresh standings (10.1). */
export async function standingChanged(core: ServiceCore, accounts: readonly AccountId[]): Promise<void> {
  if (!Array.isArray(accounts)) throw new RangeError('standingChanged: accounts is not a list');
  await refreshListed(core, accounts.map((a) => accountOf('standingChanged', a)));
}
