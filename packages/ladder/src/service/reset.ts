/**
 * M15-3: a moderator's rating reset (design 11.3), shared by `LadderService.resetRating` (on the serial queue) and `openmtg-ladder reset` (which
 * holds the file store's lock, so no server runs beside it). The account's rating in the ladder goes back to the initial state with placement again
 * (games 0, no tier, not rated yet), in one write with its audit row (`ladder_adjustments`: who, why, before, after, when). Nothing is recomputed:
 * opponents keep their rating changes.
 */
import { ACCOUNT_ID_SHAPE, initialState, isLadderId, LADDERS, seasonOf, type LadderId } from '../api';
import type { AccountId } from '../accounts';
import { newUlid, type RandomBytes } from '../ids';
import type { AdjustmentRow, LadderStore, RatingRow } from '../store/api';

/** The moderator and the reason: 1-200 characters each, no control characters (they reach the audit and the owner's command output). */
function word(label: string, x: unknown): string {
  // eslint-disable-next-line no-control-regex
  if (typeof x !== 'string' || x.trim().length === 0 || x.length > 200 || /[\u0000-\u001f\u007f]/.test(x)) {
    throw new RangeError(`resetRating: ${label} must be 1-200 characters of text`);
  }
  return x;
}

/** A RangeError naming the first argument of a reset that is not of its shape (the CLI checks them before it opens the store). */
export function checkResetArgs(account: unknown, ladder: unknown, by: unknown, reason: unknown): void {
  if (typeof account !== 'string' || !ACCOUNT_ID_SHAPE.test(account)) throw new RangeError(`resetRating: ${String(account)} is not an account id`);
  if (!isLadderId(ladder)) throw new RangeError(`resetRating: ${String(ladder)} is not a ladder id`);
  word('by', by);
  word('reason', reason);
}

/**
 * Writes the reset and its audit; returns the audit row. A RangeError when the account has no rating in the ladder (nothing is written); the store
 * answers 'conflict' when the row changed or went between the read and the write.
 */
export async function resetRatingIn(
  store: Pick<LadderStore, 'ratings' | 'resetRating'>,
  account: AccountId,
  ladder: LadderId,
  by: string,
  reason: string,
  nowMs: number,
  random?: RandomBytes,
): Promise<AdjustmentRow> {
  checkResetArgs(account, ladder, by, reason);
  const at = new Date(nowMs).toISOString();
  const before = (await store.ratings(ladder, [account])).get(account) ?? null;
  // nothing to reset: an id from an older report after its erasure (the reset would write it back for good, 8.7), or a mistyped one (review of M15-3)
  if (before === null) throw new RangeError(`resetRating: no rating in ${ladder} for this account`);
  const after: RatingRow = {
    account, ladder, state: initialState(LADDERS[ladder].model), season: seasonOf(at), lastRatedAt: null, games: 0, tier: null,
    version: before.version + 1,
  };
  const audit: AdjustmentRow = { id: newUlid(nowMs, random), account, ladder, by, reason, before, after, at };
  await store.resetRating(after, audit);
  return audit;
}
