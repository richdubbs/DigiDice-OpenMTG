/**
 * M14-6: player reports into this package's own queue (design 9.2, 8.1, 8.5, 2.4).
 *
 * - **Reporters**: an account (a full session: a restricted one answers its status's code), a guest (hosted's guest session: the request's own,
 *   ctx.guestSession, and no other; one the caller names otherwise answers badMessage, so a signed-in connection cannot file as some guest) or the
 *   `system` (the ladder's abuse detection, `source` 'ladder'). Only a system reporter may name the case's other accounts (`related`) and carry
 *   its evidence; from an account or a guest either field answers badMessage. A report about oneself (the same account, or the same guest
 *   session) answers notAllowed. Hosted resolves a guest target's seat into its session and the name at the time before it calls (a seat at a
 *   table where the reporter never sat answers notAllowed there, at the sync).
 * - **Limits** (8.1): an account files reportsPerDay a day and reportsPerTargetPerDay about one target, both checked before either is taken (a
 *   report one refuses costs nothing of the other); a guest guestReportsPerDay a day per guest session and per address key; a system reporter is
 *   not limited (the ladder deduplicates its own).
 * - **One answer for every target**: a report about a hidden account is stored like any other; one about an erased or unknown account id answers
 *   the same (a fresh report id) after the same limits, and is then dropped: nothing is stored or audited (7.3). The store's work is the same too
 *   (review A2, M14-15): the target read and one putReport, which the store drops, in the same transaction, for a target with no account.
 * - **Stored with it**: the target's display name at the time (`targetName`), all the reporter's export shows of the target (10.1).
 * - **Audit**: `reported` under the reporter's account (null for a guest or the system), with the report id and the reason only; the target's
 *   audit log gets nothing (8.5).
 *
 * Bounds of a system report (this package's choice): at most RELATED_MAX related accounts (deduplicated, the target left out), EVIDENCE_GAMES_MAX
 * game ids and EVIDENCE_STATS_MAX statistics, each a finite number under a plain key of at most STAT_KEY_MAX characters.
 */
import {
  ACCOUNT_LIMITS, DELETED_PLAYER_NAME, isAccountId, REPORT_REASONS, type AccountId, type AccountResult, type ReportReason,
} from '../api';
import { newReportId } from '../ids';
import { fail, ok, unwrap } from '../service/result';
import type { Auth, PlayerReport, Reporter, RequestContext } from '../service/api';
import type { ReporterRef, ReportRow, ReportTarget } from '../store/api';
import { hostedTextProblem, STORE_ID } from '../text';
import { iso, waitFor, type Mod } from './context';

export const RELATED_MAX = 50;
export const EVIDENCE_GAMES_MAX = 100;
export const EVIDENCE_STATS_MAX = 50;
export const STAT_KEY_MAX = 64;
/** A guest target's name as hosted resolved it (m13's guest names are shorter). */
const GUEST_NAME_MAX = 64;
/** A system reporter's source: a short lowercase identifier, as a data holder's name ('ladder'). */
const SOURCE = /^[a-z][a-z0-9-]{0,31}$/;
const REPORT_KEYS: ReadonlySet<string> = new Set(['target', 'reason', 'text', 'game', 'related', 'evidence']);

/** The reporter, checked: an account's session (and the session row's id for the audit event), a guest session, or a system source. */
type CheckedReporter =
  | { kind: 'account'; account: AccountId; session: string }
  | { kind: 'guest'; session: string }
  | { kind: 'system'; source: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

async function checkReporter(m: Mod, ctx: RequestContext, reporter: Reporter): Promise<AccountResult<CheckedReporter>> {
  if (!isPlainObject(reporter)) return fail('badMessage');
  switch (reporter.kind) {
    case 'account': {
      const s = await m.guard.session(ctx, (reporter as { auth: Auth }).auth, 'report');
      if (!s.ok) return s;
      return ok({ kind: 'account', account: s.value.account.id, session: s.value.row.id });
    }
    case 'guest': {
      // the request's own guest session only (hosted's, ctx.guestSession): never one the caller merely names
      const session = (reporter as { session: unknown }).session;
      const own = typeof session === 'string' && STORE_ID.test(session) && ctx.guestSession !== null && session === ctx.guestSession;
      return own ? ok({ kind: 'guest', session }) : fail('badMessage');
    }
    case 'system': {
      const source = (reporter as { source: unknown }).source;
      return typeof source === 'string' && SOURCE.test(source) ? ok({ kind: 'system', source }) : fail('badMessage');
    }
    default:
      return fail('badMessage');
  }
}

/** The related accounts of a system report: account ids, each once, the target left out. Null: refused. */
function checkRelated(v: unknown, target: ReportTarget): AccountId[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > RELATED_MAX || !v.every((x) => isAccountId(x))) return null;
  const self = 'account' in target ? target.account : null;
  return [...new Set(v as AccountId[])].filter((x) => x !== self);
}

/** The evidence of a system report: null when none is given, undefined when it is refused. */
function checkEvidence(v: unknown): ReportRow['evidence'] | undefined {
  if (v === undefined) return null;
  if (!isPlainObject(v) || Object.keys(v).some((k) => k !== 'games' && k !== 'stats')) return undefined;
  const { games, stats } = v;
  if (!Array.isArray(games) || games.length > EVIDENCE_GAMES_MAX || !games.every((g) => typeof g === 'string' && STORE_ID.test(g))) return undefined;
  if (!isPlainObject(stats)) return undefined;
  const entries = Object.entries(stats);
  if (entries.length > EVIDENCE_STATS_MAX) return undefined;
  const out: Record<string, number> = {};
  for (const [k, x] of entries) {
    if (k.length === 0 || k.length > STAT_KEY_MAX || hostedTextProblem(k) !== null) return undefined;
    if (typeof x !== 'number' || !Number.isFinite(x)) return undefined;
    out[k] = x;
  }
  return { games: [...(games as string[])], stats: out };
}

export async function report(m: Mod, ctx: RequestContext, reporter: Reporter, r: PlayerReport): Promise<AccountResult<{ report: string }>> {
  const who = unwrap(await checkReporter(m, ctx, reporter));
  if (!isPlainObject(r) || Object.keys(r).some((k) => !REPORT_KEYS.has(k))) return fail('badMessage');
  // the target: an account id, or a guest session with the name hosted resolved for it
  const t = r.target as unknown;
  if (!isPlainObject(t)) return fail('badMessage');
  const tk = Object.keys(t).sort().join(',');
  let target: ReportTarget;
  let guestName: string | null = null;
  if (tk === 'account' && isAccountId(t['account'])) target = { account: t['account'] };
  else if (tk === 'guestSession,name' && typeof t['guestSession'] === 'string' && STORE_ID.test(t['guestSession'])) {
    guestName = m.guard.text(t['name'], GUEST_NAME_MAX);
    if (guestName === null || guestName === '') return fail('badMessage');
    target = { guestSession: t['guestSession'] };
  } else return fail('badMessage');
  if (!(REPORT_REASONS as readonly unknown[]).includes(r.reason)) return fail('badMessage');
  const reason = r.reason as ReportReason;
  let text: string | null = null;
  if (r.text !== undefined) {
    const x = m.guard.text(r.text, ACCOUNT_LIMITS.reportText);
    if (x === null) return fail('badMessage');
    text = x === '' ? null : x;
  }
  if (r.game !== undefined && !(typeof r.game === 'string' && STORE_ID.test(r.game))) return fail('badMessage');
  const game = r.game ?? null;
  // only a system reporter names the case's other accounts and brings evidence (9.2)
  if (who.kind !== 'system' && (r.related !== undefined || r.evidence !== undefined)) return fail('badMessage');
  const related = checkRelated(r.related, target);
  const evidence = checkEvidence(r.evidence);
  if (related === null || evidence === undefined) return fail('badMessage');
  // nobody reports themselves
  if (who.kind === 'account' && 'account' in target && target.account === who.account) return fail('notAllowed');
  if (who.kind === 'guest' && 'guestSession' in target && target.guestSession === who.session) return fail('notAllowed');

  // the limits, before the target is looked up: an unknown target costs the same (8.1)
  const targetKey = 'account' in target ? target.account : `guest:${target.guestSession}`;
  if (who.kind === 'account') {
    // both checked before either is taken: a report one of them refuses costs nothing of the other (a second report about one target none of
    // the day's, one past the day's none of the target's); the answer waits until both allow it
    const one = { account: who.account, other: targetKey };
    const day = { account: who.account };
    const wait = Math.max(waitFor(m, 'reportTarget', one, ctx.now), waitFor(m, 'report', day, ctx.now));
    if (wait > 0) return fail('rateLimited', { retryAfterMs: wait });
    for (const [rule, key] of [['reportTarget', one], ['report', day]] as const) {
      const took = m.limits.take(rule, key, ctx.now);
      if (!took.ok) return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
    }
  } else if (who.kind === 'guest') {
    const g = m.limits.take('guestReport', { addressKey: ctx.addressKey, other: who.session }, ctx.now);
    if (!g.ok) return fail('rateLimited', { retryAfterMs: g.retryAfterMs });
  }

  const id = newReportId(ctx.now, m.random);
  let targetName: string;
  let kept = true;
  if ('account' in target) {
    const a = await m.store.account(target.account);
    // erased or never existed: the same answer and the same write, which the store drops (9.2, 7.3, review A2)
    kept = a !== null;
    targetName = a?.name ?? DELETED_PLAYER_NAME;
  } else targetName = guestName!;
  const ref: ReporterRef =
    who.kind === 'account' ? { kind: 'account', account: who.account } : who.kind === 'guest' ? { kind: 'guest', session: who.session } : who;
  const row: ReportRow = {
    id, reporter: ref, target, targetName, reason, game, text, related, evidence, status: 'new', createdAt: iso(ctx.now), closedAt: null, closedBy: null,
    note: null,
  };
  await m.store.putReport(row);
  if (!kept) return ok({ report: id });
  m.audit.record(
    {
      kind: 'reported',
      account: who.kind === 'account' ? who.account : null,
      actor: who.kind === 'system' ? 'system' : 'self',
      session: who.kind === 'account' ? who.session : null,
      addressKey: who.kind === 'system' ? null : ctx.addressKey,
      details: { report: id, reason },
    },
    ctx.now,
  );
  return ok({ report: id });
}
