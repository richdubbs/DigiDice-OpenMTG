/**
 * M14-7: deletion (design 10.2): the request with its grace, the cancel, the claim, the erasure through every holder, the tombstone and the name
 * hold.
 *
 * 1. **Request** (`requestDeletion`; the account's deleteAccount with its proof, the operator's `delete`, an inactive account): every other session
 *    is revoked first ('deletion'; the session that asked stays, restricted) and the change feed gets `sessionsRevoked` (with `except`); then
 *    `Account.deletion` = `{ requestedAt, purgeAt, erasingAt: null, done: [] }` by a self-contained patch, so the status is `deleting` (D23); then the
 *    change feed gets `deleting` (hosted drops the account from queues and unstarted tables; its profile disappears), and the email part sends the
 *    notice to a verified address. A revocation that fails leaves no deletion, so the request can be made again; once the patch is written the
 *    guard answers deletionPending to another one, and a revocation done is not done again, so the change-feed appends and the notice are logged and
 *    passed over when they fail, never failing the request (review of M14-7). Device proofs are kept: the owner may sign in from another device to
 *    cancel. A request while one is pending changes nothing, except the operator's `--now`, which only moves `purgeAt` to now (never later, never
 *    once the erasure is claimed).
 * 2. **Cancel** (`cancelDeletion`, from a restricted session on any device): only while `erasingAt` is null and now is before `purgeAt`, by a patch
 *    that re-reads the row on a version conflict; afterwards `notAllowed`. The status is worked out again (a running sanction is still running), and
 *    the change feed gets `standing`.
 * 3. **Claim** (`tick`, for each of `dueDeletions`, paged on from tick to tick so a full page of held-up erasures never hides the rest): `erasingAt`
 *    set to the pass's `now` by a compare-and-set on the account's version, only while it is null or older than ERASURE_LEASE_MS, and only the pass
 *    whose write won goes on (review of M14-7): two processes ticking at once erase once, and a pass a holder held up is claimed again by a later one.
 *    A cancel that wrote first changed the version, so the claim reads the row again, finds no deletion and erases nothing; a claim that wrote first
 *    makes the cancel's re-read find `erasingAt` set, and the cancel answers notAllowed. Either way exactly one of them happens.
 * 4. **Holders**: each registered AccountDataHolder not yet in `deletion.done` is called with the PlayerRef; one that succeeds is added to `done` (a
 *    patch); one that throws or answers `pending` is called again at the next tick while the account stays hidden (`erasureRetries`). A required
 *    holder (11.7) that is not registered stops the erasure (`erasureBlocked`, logged by name); it resumes once the holder is there.
 * 5. **The store's erase**, only when every registered holder and every required one is done. First FileMailer's files of the account
 *    (Mailer.forget) and the operator's export files of it are deleted, with every other account's export file that names it (made again, it
 *    shows "Deleted player"); the audit queue is flushed, so the erase also removes the account's events still queued (a flush that could not write
 *    them all keeps the erasure for the next tick). Then, if the claim is still this pass's (one that outlasted its lease leaves the rest to the
 *    pass that claimed it again), once (a retry finds the `deleted` event): the `deleted` change, then the `deleted` audit event (actor system, no
 *    address tag, the holders done), both before the erase, which keeps them, so neither a failed erase nor a restart loses them (a retry between
 *    the two appends the change again: a reader finds the account gone either way). Then AccountStore.erase with the tombstone (deletion time, the
 *    end of a running ban or suspension, the holders done) and the current key held deletedNameHoldMs (90 days) for nobody; from then on the store
 *    keeps out what a request still running writes of the account. An erase whose snapshot failed ('notCompacted': committed, its old copies still
 *    on disk) is called again at each tick until it finishes. The files are forgotten once more after the erase, in case a mail was filed meanwhile.
 *
 * Every step can run again and then finds nothing more to do: the claim is taken again, a holder in `done` is never called again, the `deleted`
 * event is written once, and an erased account is no longer due.
 */
import { sanctionRuns, type Account, type AccountId, type AccountResult, type AccountDataHolder, type AuditEvent, type SelfView } from '../api';
import type { Auth, Proof, RequestContext } from '../service/api';
import { fail, ok, refuse, unwrap } from '../service/result';
import type { ListCursor, SanctionRow, TombstoneRow } from '../store/api';
import { errorName, iso, missingHolders, playerRef, selfViewFor, type Cursors, type Rights } from './context';
import { dropAdminExportsNaming, removeAdminExports } from './files';

/** Due deletions handled per tick. */
export const ERASE_BATCH = 50;
/**
 * How long an erasure's claim holds (10.2 step 3): no pass claims it again, in this process or another one, until this long after `erasingAt`.
 * The tick's minute, so an erasure a holder held up is claimed again at the next tick; a pass that takes longer leaves the rest to the one that
 * claimed it again.
 */
export const ERASURE_LEASE_MS = 60_000;
/**
 * A tombstone's `sanctionUntil` for a permanent ban: TombstoneRow has no other way to say "never ends", and the tombstone stays while the sanction
 * runs (10.3).
 */
export const PERMANENT_SANCTION_UNTIL = '9999-12-31T23:59:59.999Z';

export interface DeletionRequest {
  at: Date;
  purgeAt: Date;
  /** The session that asked, which stays (restricted); null revokes every session. */
  keep: string | null;
  /** An operator's `--now`: a pending deletion's purgeAt is moved to `purgeAt` when that is sooner and the erasure is not claimed yet. */
  moveExisting: boolean;
  /** Who revokes the sessions (the sessionsRevoked event). */
  actor: AuditEvent['actor'];
  actorOs: string | null;
  /** Checked again on the row at every try: false leaves the account as it is (an inactive account that signed in meanwhile). */
  still?: (a: Account) => boolean;
}

export interface DeletionOutcome {
  account: Account;
  purgeAt: string;
  /** A new deletion was set (false: one was pending already). */
  started: boolean;
  /** An existing deletion's purgeAt was moved (the operator's --now). */
  moved: boolean;
}

/**
 * 10.2 step 1. Null when the account is gone, or `still` turned false; a version conflict that survives the patch's retries throws the refusal
 * 'conflict'. Nothing after the patch fails it (see the header).
 */
export async function requestDeletion(r: Rights, id: AccountId, req: DeletionRequest): Promise<DeletionOutcome | null> {
  const before = await r.store.account(id);
  if (before === null) return null;
  // a deletion that is to start revokes the other sessions before it is set: a failure here (thrown) leaves the account as it was (an inactive
  // account's owner who signs in between the two keeps the account, and signs in once more if that session was revoked)
  if (before.deletion === null && (req.still === undefined || req.still(before))) await revokeOthers(r, id, req);
  let started = false, moved = false, skipped = false;
  const p = await r.deps.guard.patch(id, (cur) => {
    started = moved = skipped = false;
    if (req.still !== undefined && !req.still(cur)) {
      skipped = true;
      return null;
    }
    const d = cur.deletion;
    if (d === null) {
      started = true;
      return { deletion: { requestedAt: iso(req.at), purgeAt: iso(req.purgeAt), erasingAt: null, done: [] } };
    }
    if (req.moveExisting && d.erasingAt === null && Date.parse(d.purgeAt) > req.purgeAt.getTime()) {
      moved = true;
      return { deletion: { ...d, purgeAt: iso(req.purgeAt) } };
    }
    return null;
  });
  if (!p.ok) {
    if (p.error.code === 'notFound') return null;
    refuse(p.error.code);
  }
  if (skipped) return null;
  const account = p.value;
  if (account.deletion === null) return null;
  if (started) {
    await passOver(r, 'deleting', () => r.deps.changes({ at: iso(req.at), account: id, kind: 'deleting' }));
    await notify(r, id, 'deletionRequested');
  }
  return { account, purgeAt: account.deletion.purgeAt, started, moved };
}

/** Every session of the account but `req.keep` revoked ('deletion'), recorded, and told to the change feed. */
async function revokeOthers(r: Rights, id: AccountId, req: DeletionRequest): Promise<void> {
  const at = iso(req.at);
  const revoked = await r.store.revokeSessions(id, 'deletion', at, req.keep ?? undefined);
  if (revoked.length === 0) return;
  r.deps.audit.record(
    { kind: 'sessionsRevoked', account: id, actor: req.actor, actorOs: req.actorOs, session: req.keep, details: { reason: 'deletion', count: revoked.length } },
    req.at,
  );
  // revoked already: a request made again would find nothing more to revoke, so a feed that fails here is logged and the request goes on
  await passOver(r, 'sessionsRevoked', () =>
    r.deps.changes({ at, account: id, kind: 'sessionsRevoked', ...(req.keep !== null ? { detail: { except: req.keep } } : {}) }),
  );
}

/** A step of the request that can no longer fail it (10.2 step 1): logged by name and passed over when it fails. */
async function passOver(r: Rights, step: string, f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
  } catch (e) {
    r.log.event('accounts.deletion.step', { step, error: errorName(e) });
  }
}

/** The email part's notice (PartDeps.notify), never failing the flow that sends it. */
export async function notify(r: Rights, id: AccountId, kind: 'deletionRequested' | 'inactive'): Promise<void> {
  try {
    await r.deps.notify?.(id, kind);
  } catch (e) {
    r.log.event('accounts.rights.notice', { kind, error: errorName(e) });
  }
}

/** The account's deleteAccount (10.2 step 1): the session, the proof in the same request (5.2), then the request. */
export async function deleteAccount(r: Rights, ctx: RequestContext, auth: Auth, proof: Proof): Promise<AccountResult<{ purgeAt: string }>> {
  const s = unwrap(await r.deps.guard.session(ctx, auth, 'deleteAccount'));
  unwrap(await r.deps.guard.proof(ctx, auth, proof, 'delete'));
  const out = await requestDeletion(r, auth.account, {
    at: ctx.now, purgeAt: new Date(ctx.now.getTime() + r.config.timing.deleteGraceMs), keep: s.row.id, moveExisting: false, actor: 'self',
    actorOs: null,
  });
  if (out === null) return fail('sessionExpired');
  if (out.started) {
    r.deps.audit.record(
      { kind: 'deletionRequested', account: auth.account, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { purgeAt: out.purgeAt } },
      ctx.now,
    );
  }
  return ok({ purgeAt: out.purgeAt });
}

/** 10.2 step 2. */
export async function cancelDeletion(r: Rights, ctx: RequestContext, auth: Auth): Promise<AccountResult<SelfView>> {
  const s = unwrap(await r.deps.guard.session(ctx, auth, 'cancelDeletion'));
  let pending = false, allowed = false;
  const p = await r.deps.guard.patch(auth.account, (cur) => {
    const d = cur.deletion;
    pending = d !== null;
    allowed = d !== null && d.erasingAt === null && ctx.now.getTime() < Date.parse(d.purgeAt);
    return allowed ? { deletion: null } : null;
  });
  if (!p.ok) return p.error.code === 'notFound' ? fail('sessionExpired') : p;
  if (!allowed) return pending ? fail('notAllowed', { message: 'The deletion has begun and can no longer be cancelled.' }) : fail('notAllowed');
  const nowIso = iso(ctx.now);
  await r.deps.changes({ at: nowIso, account: auth.account, kind: 'standing' });
  r.deps.audit.record(
    { kind: 'deletionCancelled', account: auth.account, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: {} },
    ctx.now,
  );
  return ok(await selfViewFor(r, p.value, ctx.now));
}

// ---- the erasure (10.2 steps 3-5) ---------------------------------------------------------------------------------------------------------------

export interface ErasureCounts { erased: number; erasureRetries: number; erasureBlocked: number }

/**
 * What an erasure that is committed still owes, finished at the next ticks: the snapshot of an erase that answered 'notCompacted' (erase called again
 * with the same arguments; the file store also tries it at its next write and at its next open).
 */
export type OwedErasures = Map<AccountId, { tombstone: TombstoneRow; hold: string }>;

/** The end of the running ban or suspension at `now` that ends last (permanent: PERMANENT_SANCTION_UNTIL), or null when none runs. */
export function runningSanctionEnd(rows: readonly SanctionRow[], now: Date): string | null {
  let end: number | null = null;
  for (const s of rows) {
    if ((s.kind !== 'ban' && s.kind !== 'suspend') || !sanctionRuns(s, iso(now))) continue;
    const until = s.until === null ? Number.NaN : Date.parse(s.until);
    if (!Number.isFinite(until)) return PERMANENT_SANCTION_UNTIL;
    end = end === null ? until : Math.max(end, until);
  }
  return end === null ? null : new Date(end).toISOString();
}

/**
 * 10.2 step 3: the account with its erasure claimed by this call, or null when it was cancelled, is not due, is gone, or is claimed by another pass
 * whose lease (ERASURE_LEASE_MS) still holds. Only a write of this call counts: a pass that lost the compare-and-set reads the row again, finds the
 * fresh claim, and stops.
 */
async function claim(r: Rights, id: AccountId, now: Date): Promise<Account | null> {
  let won = false;
  const p = await r.deps.guard.patch(id, (cur) => {
    const d = cur.deletion;
    won = d !== null && Date.parse(d.purgeAt) <= now.getTime() && (d.erasingAt === null || now.getTime() - Date.parse(d.erasingAt) >= ERASURE_LEASE_MS);
    return won ? { deletion: { ...d!, erasingAt: iso(now) } } : null;
  });
  if (!p.ok) {
    if (p.error.code !== 'notFound') r.log.event('accounts.erasure.claim', { code: p.error.code });
    return null;
  }
  return won ? p.value : null;
}

const holderResult = (v: unknown): v is { pending?: boolean } => typeof v === 'object' && v !== null;

/** FileMailer's files of the account, the operator's export files of it, and the other accounts' export files that name it (10.2 step 5, 10.3). */
async function forgetFiles(r: Rights, id: AccountId, words: readonly string[], now: Date): Promise<void> {
  if (r.deps.mailer?.forget !== undefined) await r.deps.mailer.forget(id, now);
  if (r.config.dataDir !== null) {
    await removeAdminExports(r.config.dataDir, id);
    const dropped = await dropAdminExportsNaming(r.config.dataDir, id, words);
    if (dropped > 0) r.log.event('accounts.erasure.exports', { dropped });
  }
}

/** Steps 3-5 for one due account. */
async function eraseOne(r: Rights, id: AccountId, now: Date, counts: ErasureCounts, owed: OwedErasures): Promise<void> {
  let a = await claim(r, id, now);
  if (a === null) return;
  const claimed = a.deletion!.erasingAt;
  const ref = await playerRef(r, a);
  const registered: AccountDataHolder[] = [...r.holders.values()];
  for (const h of registered) {
    if (a.deletion!.done.includes(h.name)) continue;
    let res: unknown;
    try {
      res = await h.erase(ref);
    } catch (e) {
      counts.erasureRetries++;
      r.log.event('accounts.erasure.holder', { holder: h.name, outcome: 'failed', error: errorName(e) });
      continue;
    }
    if (!holderResult(res)) {
      counts.erasureRetries++;
      r.log.event('accounts.erasure.holder', { holder: h.name, outcome: 'invalid', error: null });
      continue;
    }
    if (res.pending === true) {
      // data still in use (a running game): called again at the next tick, the account hidden meanwhile
      counts.erasureRetries++;
      r.log.event('accounts.erasure.holder', { holder: h.name, outcome: 'pending', error: null });
      continue;
    }
    const p = await r.deps.guard.patch(id, (cur) =>
      cur.deletion === null || cur.deletion.done.includes(h.name) ? null : { deletion: { ...cur.deletion, done: [...cur.deletion.done, h.name] } },
    );
    if (!p.ok) {
      counts.erasureRetries++;
      r.log.event('accounts.erasure.done', { holder: h.name, code: p.error.code });
      if (p.error.code === 'notFound') return;
      continue;
    }
    a = p.value;
  }

  const missing = missingHolders(r);
  if (missing.length > 0) {
    counts.erasureBlocked++;
    r.log.event('accounts.erasure.blocked', { holders: missing.join(',') });
    return;
  }
  const done = [...a.deletion!.done];
  if (registered.some((h) => !done.includes(h.name))) return;

  const words = [...ref.names, ...(a.email !== null ? [a.email.address] : [])];
  await forgetFiles(r, id, words, now);
  // the account's events still queued (a sign-in a moment ago) go to the store first, so its erase removes them too; a flush the store refused
  // keeps them queued, and the erasure waits for the next tick
  await r.deps.audit.flush();
  const queued = r.deps.auditQueued?.(id) ?? 0;
  if (queued > 0) {
    counts.erasureRetries++;
    r.log.event('accounts.erasure.audit', { queued });
    return;
  }
  // still this pass's claim: one that outlasted its lease (a slow holder) leaves the rest to the pass that claimed it again
  if ((await r.store.account(id))?.deletion?.erasingAt !== claimed) {
    r.log.event('accounts.erasure.lease', { holders: done.length });
    return;
  }
  const nowIso = iso(now);
  if ((await r.store.audit({ account: id, kinds: ['deleted'], limit: 1 })).length === 0) {
    // before the erase, which keeps both: a failed erase or a restart never loses the change (the event's once-only check above covers both)
    await r.deps.changes({ at: nowIso, account: id, kind: 'deleted' });
    await r.store.appendAudit([r.deps.audit.build({ kind: 'deleted', account: id, actor: 'system', details: { holders: done } }, now)]);
  }
  const tombstone: TombstoneRow = { account: id, deletedAt: nowIso, sanctionUntil: runningSanctionEnd(await r.store.sanctionsOf(id), now), holdersDone: done };
  const hold = new Date(now.getTime() + r.config.timing.deletedNameHoldMs).toISOString();
  try {
    await r.store.erase(id, tombstone, hold);
  } catch (e) {
    if ((e as { code?: unknown })?.code !== 'notCompacted') throw e;
    // committed (no read finds the account any more), but its old copies are still in the store's files: finished at the next ticks
    owed.set(id, { tombstone, hold });
    r.log.event('accounts.erasure.notCompacted', { holders: done.length });
  }
  await forgetFiles(r, id, words, now).catch((e: unknown) => r.log.event('accounts.erasure.files', { error: errorName(e) }));
  counts.erased++;
}

/**
 * Steps 3-5 for the due accounts of this tick: a page of at most ERASE_BATCH after `cursors.erase`, the next tick going on after its last account
 * (from the start again after a short page), so a full page of erasures a holder holds up never hides the ones after it. One account's failure is
 * counted and never stops the others.
 */
export async function eraseDue(r: Rights, now: Date, counts: ErasureCounts, owed: OwedErasures, cursors: Cursors): Promise<void> {
  const ids = await r.store.dueDeletions(iso(now), ERASE_BATCH, cursors.erase ?? undefined);
  // the last one's purgeAt, read before it may be erased (it never moves once due)
  cursors.erase = ids.length < ERASE_BATCH ? null : await cursorOf(r, ids[ids.length - 1]!);
  for (const id of ids) {
    try {
      await eraseOne(r, id, now, counts, owed);
    } catch (e) {
      counts.erasureRetries++;
      r.log.event('accounts.erasure.failed', { error: errorName(e) });
    }
  }
}

/** Where dueDeletions goes on after `id` (its purgeAt and id), or null (from the start) when it is no longer due. */
async function cursorOf(r: Rights, id: AccountId): Promise<ListCursor | null> {
  const d = (await r.store.account(id))?.deletion;
  return d !== null && d !== undefined ? { at: d.purgeAt, account: id } : null;
}

/** What committed erasures still owe (OwedErasures): AccountStore.erase is safe to repeat and then only finishes its snapshot. */
export async function finishErasures(r: Rights, owed: OwedErasures): Promise<void> {
  for (const [id, x] of [...owed]) {
    try {
      await r.store.erase(id, x.tombstone, x.hold);
      owed.delete(id);
    } catch (e) {
      r.log.event('accounts.erasure.owed', { error: errorName(e) });
    }
  }
}
