/**
 * M14-6: blocks and mutes between two accounts (design 9.1, 7.3, 8.1).
 *
 * - **Who**: an account with a full session (a restricted one answers its status's code: RESTRICTED_CALLS have neither). Guests have no account and
 *   cannot block; the client hides a guest's chat itself.
 * - **The answer never depends on the other account**: one aimed at a hidden account (suspended, banned, deleting) is stored and answers as for an
 *   active one; one aimed at an erased or never-existing id answers the same and stores nothing. The rate limit (relationChangesPerHour) and the cap
 *   (ACCOUNT_LIMITS.relationsMax entries, block and mute together) are checked before anything of the other id, so they answer alike too. So is the
 *   store's work (review A2, M14-15): one setRelation whatever the id, and the store keeps the entry for an account and drops it for an id with
 *   none, in the same transaction (an entry already there is written again as it is).
 *   The cap is checked and the entry written one at a time per account (Mod.serial), so two blocks at once cannot pass it; in this process only
 *   (two servers on one PostgreSQL store could still pass it by one each).
 * - **The list** (`relations`) shows only the entries whose other account is active now, with its current name: one aimed at a hidden account
 *   would show by that name what its profile hides, and set it apart from an erased one (7.3). The entry stays stored and in force, and is listed
 *   again once that account is active.
 * - **Effects** are read, not pushed: hosted and the ladder ask the directory (`blockedAmong`, `silenced`) when they seat, match or deliver chat.
 *   Both are private: only the account that set them sees them (`relations`, and its export, M14-7).
 */
import { accountStatus, ACCOUNT_LIMITS, isAccountId, type AccountResult, type RelationKind, type RelationView } from '../api';
import { fail, ok, unwrap } from '../service/result';
import type { Auth, RequestContext } from '../service/api';
import { relationView } from '../views';
import { iso, storeCode, type Mod } from './context';

export async function setRelation(
  m: Mod, ctx: RequestContext, auth: Auth, other: unknown, on: unknown, kind: RelationKind,
): Promise<AccountResult<void>> {
  unwrap(await m.guard.session(ctx, auth, kind));
  if (!isAccountId(other) || other === auth.account || typeof on !== 'boolean') return fail('badMessage');
  const took = m.limits.take('relation', { account: auth.account }, ctx.now);
  if (!took.ok) return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
  if (!on) {
    await m.store.deleteRelation(auth.account, other, kind);
    return ok(undefined);
  }
  // the cap's check and the write, one at a time per account (see the header)
  return m.serial(`relations:${auth.account}`, async (): Promise<AccountResult<void>> => {
    const rows = await m.store.relationsOf(auth.account);
    const there = rows.find((r) => r.other === other && r.kind === kind);
    if (there === undefined && rows.length >= ACCOUNT_LIMITS.relationsMax) return fail('limitReached');
    // one write for every id (see the header): the store drops it for an erased or unknown one, so the answer and the work are the same (7.3)
    try {
      await m.store.setRelation({ account: auth.account, other, kind, createdAt: there?.createdAt ?? iso(ctx.now) });
    } catch (e) {
      // this account erased meanwhile: the same answer
      if (storeCode(e) === 'notFound') return ok(undefined);
      throw e;
    }
    return ok(undefined);
  });
}

export async function relations(m: Mod, ctx: RequestContext, auth: Auth): Promise<AccountResult<RelationView[]>> {
  unwrap(await m.guard.session(ctx, auth, 'relations'));
  const now = iso(ctx.now);
  const rows = await m.store.relationsOf(auth.account);
  const ids = [...new Set(rows.map((r) => r.other))];
  const [others, running] = await Promise.all([m.store.accounts(ids), m.store.runningSanctions(ids, now)]);
  const views: RelationView[] = [];
  for (const r of rows) {
    // only an active account's entries (see the header)
    const a = others.get(r.other);
    if (a !== undefined && accountStatus(running.get(r.other) ?? [], a.deletion, now) === 'active') views.push(relationView(r, a.name));
  }
  return ok(views);
}
