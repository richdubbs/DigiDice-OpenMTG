/**
 * M14-6: the operator's sanctions, lifts and answers to appeals (design 9.3, 9.5, 9.6, 9.7).
 *
 * - **A sanction** (`warn`, `mute`, `unlist`, `suspend`, `ban`): a reason (the report reasons or `evasion`), a message the account sees, an internal
 *   note only the operator sees, the operator's name, the reports it settles (each must exist; those still open are closed as `actioned`), and its
 *   start (now) and end: `warn` none (an `until` is ignored); `mute` required, at most MUTE_MAX_MS ahead; `suspend` required, at most
 *   SUSPEND_MAX_MS ahead; `unlist` and `ban` optional (none: permanent). `now` (a running game conceded at once) is for `suspend` and `ban` only.
 *   Effects: every kind but `warn` appends a `standing` change (with detail.now when asked); a `ban` also revokes every session of the account at
 *   once (`sessionsRevoked`, reason 'sanction'), before any change is appended. A suspension leaves the sessions, which are restricted from the
 *   next call on (3.8).
 * - **On record first** (./operator.ts): each event is appended right after the store write it records (`sanctioned` after putSanction, each
 *   `reportClosed` after its close, `sessionsRevoked` after the revocation, `sanctionLifted` after the end, `appealAnswered` after the answer) and
 *   before the change feed, so a command that fails half-way is on record for what it did.
 * - **Ends** are recorded once, with endedAt, endReason and endedBy: `lift` ('lifted', by the operator), an appeal answered `lifted` ('appeal'),
 *   or tick's expiry (src/moderation/expiry.ts). A sanction that has ended, or whose `until` has passed, cannot be lifted ('conflict'). A sanction
 *   is found by its id (the store's `sanction`); an id with none answers 'notFound'. The store keeps no note for an end, so `lift` refuses one
 *   ('invalid') rather than drop it.
 * - **Answers to appeals**: `upheld` or `lifted`, with a message the account sees; once per appeal ('conflict' after). `lifted` ends the sanction
 *   when it still runs.
 */
import { ACCOUNT_ID, REPORT_REASONS, sanctionRuns, type AccountId, type SanctionReason, type SanctionView } from '../api';
import { newSanctionId, REPORT_ID, SANCTION_ID } from '../ids';
import { sanctionView } from '../views';
import type { NewSanction, Operator } from '../service/api';
import type { ReportRow, SanctionRow } from '../store/api';
import { iso, standingChanged, storeCode, type Mod } from '../moderation/context';
import { actorOf, adminEvent, append, checkOperator, conflict, idOf, invalid, notFound, operatorText, optionalText } from './operator';

const DAY = 86_400_000;
/** 9.3: a mute lasts at most 90 days, a suspension at most a year. */
export const MUTE_MAX_MS = 90 * DAY;
export const SUSPEND_MAX_MS = 365 * DAY;
/** The reports one sanction may settle. */
export const SANCTION_REPORTS_MAX = 50;

export const NEW_SANCTION_KINDS: readonly NewSanction['kind'][] = Object.freeze<NewSanction['kind'][]>(['warn', 'mute', 'unlist', 'suspend', 'ban']);
export const SANCTION_REASONS: readonly SanctionReason[] = Object.freeze<SanctionReason[]>([...REPORT_REASONS, 'evasion']);

/** A sanction's end for its kind (see the header), at least a millisecond after `at`. */
function untilOf(kind: NewSanction['kind'], until: unknown, at: Date): string | null {
  if (kind === 'warn') return null;
  if (until === null || until === undefined) {
    if (kind === 'mute' || kind === 'suspend') invalid(`a ${kind} needs an end (--for or --until)`);
    return null;
  }
  const t = typeof until === 'string' && /^\d{4}-\d{2}-\d{2}/.test(until) ? Date.parse(until) : NaN;
  if (!Number.isFinite(t)) invalid('the end is not an ISO 8601 time');
  if (t <= at.getTime()) invalid('the end must be in the future');
  const max = kind === 'mute' ? MUTE_MAX_MS : kind === 'suspend' ? SUSPEND_MAX_MS : null;
  if (max !== null && t - at.getTime() > max) invalid(`a ${kind} lasts at most ${max / DAY} days`);
  return new Date(t).toISOString();
}

export async function sanction(m: Mod, op: Operator, account: AccountId, s: NewSanction): Promise<SanctionView> {
  checkOperator(op);
  const id = idOf<AccountId>('the account', account, ACCOUNT_ID);
  if (typeof s !== 'object' || s === null) invalid('the sanction is not an object');
  if (!NEW_SANCTION_KINDS.includes(s.kind)) invalid(`the kind must be one of ${NEW_SANCTION_KINDS.join(', ')}`);
  if (!SANCTION_REASONS.includes(s.reason)) invalid(`the reason must be one of ${SANCTION_REASONS.join(', ')}`);
  const message = operatorText('the message', s.message);
  const note = optionalText('the note', s.note);
  if (s.reports !== undefined && (!Array.isArray(s.reports) || s.reports.length > SANCTION_REPORTS_MAX)) invalid(`at most ${SANCTION_REPORTS_MAX} reports`);
  const reportIds = [...new Set((s.reports ?? []).map((r) => idOf('a report', r, REPORT_ID)))];
  if (s.now !== undefined && typeof s.now !== 'boolean') invalid('now is true or false');
  const now = s.now === true;
  if (now && s.kind !== 'suspend' && s.kind !== 'ban') invalid('--now is for a suspension or a ban');
  const at = m.clock();
  const atIso = iso(at);
  const until = untilOf(s.kind, s.until, at);
  if ((await m.store.account(id)) === null) notFound('no such account');
  const reports: ReportRow[] = [];
  for (const r of reportIds) reports.push((await m.store.report(r)) ?? notFound(`no such report: ${r}`));

  const by = actorOf(op);
  const row: SanctionRow = {
    id: newSanctionId(at, m.random), account: id, kind: s.kind, reason: s.reason, message, note, createdAt: atIso, createdBy: by,
    reports: reportIds, since: atIso, until, endedAt: null, endReason: null, endedBy: null, seenAt: null,
  };
  const event = adminEvent(m, op, 'sanctioned', id, { sanction: row.id, kind: s.kind, reason: s.reason, now }, at);
  await m.store.putSanction(row);
  await append(m, [event]);
  // the reports it settles are closed (those still open)
  for (const r of reports) {
    if (r.status !== 'new') continue;
    const closed = adminEvent(m, op, 'reportClosed', 'account' in r.target ? r.target.account : null, { report: r.id, outcome: 'actioned' }, at);
    try {
      await m.store.closeReport(r.id, 'actioned', by, atIso, null);
    } catch (e) {
      // closed meanwhile
      if (storeCode(e) === 'conflict') continue;
      throw e;
    }
    await append(m, [closed]);
  }
  // a ban revokes every session at once (3.8), before any change goes out; signing in again gives a restricted session
  const revoked = s.kind === 'ban' ? await m.store.revokeSessions(id, 'sanction', atIso) : null;
  if (revoked !== null) await append(m, [adminEvent(m, op, 'sessionsRevoked', id, { reason: 'sanction', count: revoked.length }, at)]);
  await standingChanged(m, id, s.kind, at, now);
  if (revoked !== null && revoked.length > 0) await m.changes({ at: atIso, account: id, kind: 'sessionsRevoked' });
  return sanctionView(row, null);
}

/** The sanction with this id, or 'notFound' with `refusal`. */
async function sanctionOf(m: Mod, id: string, refusal: string): Promise<SanctionRow> {
  return (await m.store.sanction(id)) ?? notFound(refusal);
}

export async function lift(m: Mod, op: Operator, sanctionId: string, note?: string): Promise<void> {
  checkOperator(op);
  const id = idOf('the sanction', sanctionId, SANCTION_ID);
  // the store keeps no note for an end (see the header): refused, never dropped
  if (note !== undefined && note !== null) invalid('a lift keeps no note: the store records only who lifted the sanction and when');
  const at = m.clock();
  const row = await sanctionOf(m, id, 'no such sanction');
  if (row.endedAt !== null || !sanctionRuns(row, iso(at))) conflict('the sanction has ended already');
  const event = adminEvent(m, op, 'sanctionLifted', row.account, { sanction: id }, at);
  try {
    await m.store.endSanction(id, iso(at), 'lifted', actorOf(op));
  } catch (e) {
    if (storeCode(e) === 'notFound') notFound('no such sanction');
    if (storeCode(e) === 'conflict') conflict('the sanction has ended already');
    throw e;
  }
  await append(m, [event]);
  await standingChanged(m, row.account, row.kind, at);
}

export async function answerAppeal(m: Mod, op: Operator, sanctionId: string, answer: 'upheld' | 'lifted', message: string): Promise<void> {
  checkOperator(op);
  const id = idOf('the sanction', sanctionId, SANCTION_ID);
  if (answer !== 'upheld' && answer !== 'lifted') invalid('the answer is upheld or lifted');
  const text = operatorText('the message', message);
  const row = await sanctionOf(m, id, 'no appeal of this sanction');
  const at = m.clock();
  const by = actorOf(op);
  const ends = answer === 'lifted' && row.endedAt === null && sanctionRuns(row, iso(at));
  const event = adminEvent(m, op, 'appealAnswered', row.account, { sanction: id, answer }, at);
  const liftEvent = ends ? adminEvent(m, op, 'sanctionLifted', row.account, { sanction: id }, at) : null;
  // the store answers each appeal once: no appeal ('notFound') and one answered already ('conflict')
  try {
    await m.store.answerAppeal(id, answer, text, by, iso(at));
  } catch (e) {
    if (storeCode(e) === 'notFound') notFound('no appeal of this sanction');
    if (storeCode(e) === 'conflict') conflict('the appeal has been answered already');
    throw e;
  }
  await append(m, [event]);
  if (liftEvent === null) return;
  try {
    await m.store.endSanction(id, iso(at), 'appeal', by);
  } catch (e) {
    // it expired or was lifted meanwhile: the appeal is answered, the end stays as it was recorded
    if (storeCode(e) === 'conflict') return;
    throw e;
  }
  await append(m, [liftEvent]);
  await standingChanged(m, row.account, row.kind, at);
}
