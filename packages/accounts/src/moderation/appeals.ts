/**
 * M14-6: an account's appeal of its own sanction (design 9.5, 3.8).
 *
 * One appeal per sanction, at most ACCOUNT_LIMITS.appealText characters under m13's text rules, from a full or a suspended or banned session
 * (RESTRICTED_CALLS: a deleting account cannot appeal). Only the account's own sanctions: the store checks the sanction's account (putAppeal), so an
 * appeal naming another account's sanction answers notFound, exactly as for an id that never existed, and leaves that sanction's one appeal unused.
 * A second appeal of the same sanction answers conflict. Any of its sanctions may be appealed, running or ended (a warning, a forced rename's
 * notice). The operator answers with `answer` (src/admin/sanctions.ts). Audited as `appealed` with the sanction id only.
 *
 * **The proof** (5.2, action 'appeal'; M14-15, review A3): the one appeal cannot be undone, so it takes the password or a reauth ticket in the same
 * request, checked last: after the session, the fields, and notFound and conflict, which are looked at first so that a refused appeal costs no
 * proof (the store's putAppeal still decides both for an appeal made meanwhile).
 */
import { ACCOUNT_LIMITS, type AccountResult } from '../api';
import { SANCTION_ID } from '../ids';
import { fail, ok, unwrap } from '../service/result';
import type { Auth, Proof, RequestContext } from '../service/api';
import { iso, storeCode, type Mod } from './context';

const ALREADY = 'This sanction has been appealed already.';

export async function appeal(
  m: Mod, ctx: RequestContext, auth: Auth, sanction: unknown, text: unknown, proof: Proof | undefined,
): Promise<AccountResult<void>> {
  const s = unwrap(await m.guard.session(ctx, auth, 'appeal'));
  if (typeof sanction !== 'string' || !SANCTION_ID.test(sanction)) return fail('badMessage');
  const body = m.guard.text(text, ACCOUNT_LIMITS.appealText);
  if (body === null || body === '') return fail('badMessage');
  // the account's own sanction, not yet appealed: before the proof (see the header)
  const row = await m.store.sanction(sanction);
  if (row === null || row.account !== auth.account) return fail('notFound');
  const appeals = await m.store.appeals({ account: auth.account, limit: 10_000 });
  if (appeals.some((a) => a.sanction === sanction)) return fail('conflict', { message: ALREADY });
  unwrap(await m.guard.proof(ctx, auth, proof, 'appeal'));
  try {
    await m.store.putAppeal({
      sanction, account: auth.account, text: body, createdAt: iso(ctx.now), answer: null, answerMessage: null, answeredAt: null, answeredBy: null,
    });
  } catch (e) {
    const code = storeCode(e);
    if (code === 'notFound') return fail('notFound');
    if (code === 'exists') return fail('conflict', { message: ALREADY });
    throw e;
  }
  m.audit.record({ kind: 'appealed', account: auth.account, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { sanction } }, ctx.now);
  return ok(undefined);
}
