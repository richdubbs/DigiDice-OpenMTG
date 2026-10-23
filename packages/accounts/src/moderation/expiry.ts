/**
 * M14-6: the moderation part's tick (design 9.3, 3.8): it records the end of every sanction whose `until` has passed.
 *
 * The status changed at `until` already (accountStatus reads the time, D23); tick only records it, once: `sanctionsEndingBy` returns only sanctions
 * not yet ended, and `endSanction` ends one exactly once (a second end, by a concurrent tick or a lift that won, answers conflict and is skipped).
 * So each `sanctionExpired` event and each `standing` change is written exactly once. The recorded end is the sanction's own `until`, when it
 * really ended, not the tick's time. At most PAGES pages of PAGE sanctions a tick; the rest wait for the next one.
 *
 * **A change the store failed to append** after the end was recorded (the sanction is no longer due, so no later page finds it again) is owed:
 * the part keeps it (ExpiryState, in memory) and the next tick appends it before anything else; that tick stops at a failure as this one did. A
 * process that stops in between loses it, as it loses its audit queue; a server that starts reads live state itself (9.7).
 */
import type { AccountId, SanctionKind } from '../api';
import { iso, standingChanged, storeCode, type Mod } from './context';

const PAGE = 200;
const PAGES = 10;

/** The standing changes owed by an earlier tick, by sanction id (at most one per failed tick: a tick stops at its first failure). */
export interface ExpiryState { owed: Map<string, { account: AccountId; kind: SanctionKind; at: Date }> }

export const newExpiryState = (): ExpiryState => ({ owed: new Map() });

export async function expireSanctions(m: Mod, now: Date, state: ExpiryState): Promise<{ sanctionsEnded: number }> {
  // what an earlier tick owes, first; each taken out before its append, so two ticks at once never append one twice
  for (const [id, c] of [...state.owed]) {
    state.owed.delete(id);
    try {
      await standingChanged(m, c.account, c.kind, c.at);
    } catch (e) {
      state.owed.set(id, c);
      throw e;
    }
  }
  let ended = 0;
  for (let page = 0; page < PAGES; page++) {
    const due = await m.store.sanctionsEndingBy(iso(now), PAGE);
    let progress = 0;
    for (const s of due) {
      if (s.until === null) continue;
      try {
        await m.store.endSanction(s.id, s.until, 'expired', 'system');
      } catch (e) {
        // ended meanwhile (lifted, or another tick): nothing more to record
        if (storeCode(e) === 'conflict' || storeCode(e) === 'notFound') continue;
        throw e;
      }
      progress++;
      ended++;
      m.audit.record({ kind: 'sanctionExpired', account: s.account, actor: 'system', details: { sanction: s.id } }, now);
      try {
        await standingChanged(m, s.account, s.kind, now);
      } catch (e) {
        // owed only once it failed: a tick that runs meanwhile never appends it too
        state.owed.set(s.id, { account: s.account, kind: s.kind, at: now });
        throw e;
      }
    }
    if (due.length < PAGE || progress === 0) break;
  }
  return { sanctionsEnded: ended };
}
