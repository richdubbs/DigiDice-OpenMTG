/**
 * M14-6: what every operator command shares (design 9.6, 8.5, D16): the operator's check, the audit event of a command, and the checks of what the
 * operator types. The operator is not a client: a refusal throws AccountsAdminError ('invalid' for input, 'notFound', 'conflict').
 *
 * - **The operator** is checked with the audit writer's own rules before anything runs (as the core's rekey does: a name of 1 to 64 UTF-16 units
 *   that is not blank and an OS user of at most 64, both plain text under m13's text rules): a command the audit log cannot record is refused,
 *   never run unrecorded. The `--as` name is free text anyone at the shell can set, so every event also carries the OS user (`actorOs`).
 * - **Events.** A command that changes something builds its events first (so a refusal comes before any change), and appends each to the store
 *   itself, outside the writer's queue, right after the store write it records and before the command's later steps (the change feed above all):
 *   a command that fails half-way is on record for every change it made, and its events are written when it returns. A read appends its
 *   `adminViewed` event before it reads.
 */
import { hostedTextProblem, codePoints } from '../text';
import { AccountsAdminError, type Operator } from '../service/api';
import type { AuditDetails, AuditEvent, AuditKind, AccountId } from '../api';
import type { Mod } from '../moderation/context';

/** An operator's name (`--as`) and OS user, as the audit writer takes them (`admin:<name>`, actorOs). */
export const OPERATOR_MAX = 64;
/** A note, a message to the account, a deletion reason: plain text of at most this many characters (as a report's or an appeal's text). */
export const OPERATOR_TEXT_MAX = 2_000;

export function invalid(message: string): never {
  throw new AccountsAdminError('invalid', message);
}
export function notFound(message: string): never {
  throw new AccountsAdminError('notFound', message);
}
export function conflict(message: string): never {
  throw new AccountsAdminError('conflict', message);
}

export function checkOperator(op: Operator): void {
  if (typeof op !== 'object' || op === null || typeof op.name !== 'string' || op.name.trim() === '' || typeof op.osUser !== 'string') {
    invalid('the operator needs a name (--as) and an OS user');
  }
  if (op.name.length > OPERATOR_MAX || hostedTextProblem(op.name) !== null) {
    invalid(`the operator's name (--as) must be plain text of at most ${OPERATOR_MAX} characters`);
  }
  if (op.osUser.length > OPERATOR_MAX || hostedTextProblem(op.osUser) !== null) {
    invalid(`the OS user must be plain text of at most ${OPERATOR_MAX} characters`);
  }
}

/** The actor the store records for the operator (sanctions' createdBy, endedBy; reports' closedBy; appeals' answeredBy). */
export const actorOf = (op: Operator): `admin:${string}` => `admin:${op.name}`;

/** The command's audit event, built (and so checked) now; appended by `append`. */
export function adminEvent<K extends AuditKind>(m: Mod, op: Operator, kind: K, account: AccountId | null, details: AuditDetails[K], at: Date): AuditEvent<K> {
  try {
    return m.audit.build({ kind, account, actor: actorOf(op), actorOs: op.osUser, details }, at);
  } catch {
    return invalid('the command cannot be audited as given');
  }
}

/** Appends the command's events to the store. */
export async function append(m: Mod, events: readonly AuditEvent[]): Promise<void> {
  if (events.length > 0) await m.store.appendAudit(events);
}

/** A read's `adminViewed` event, appended before the read (D16: reads are audited too). */
export async function viewed(m: Mod, op: Operator, what: AuditDetails['adminViewed']['what'], account: AccountId | null): Promise<void> {
  await append(m, [adminEvent(m, op, 'adminViewed', account, { what }, m.clock())]);
}

/** Operator text: plain text of 1 to `max` code points once trimmed, or the refusal naming `label`. */
export function operatorText(label: string, v: unknown, max = OPERATOR_TEXT_MAX): string {
  if (typeof v !== 'string' || v.length > 4 * max + 64 || hostedTextProblem(v) !== null) invalid(`${label} must be plain text`);
  const t = v.trim();
  if (t === '' || codePoints(t) > max) invalid(`${label} must be 1 to ${max} characters`);
  return t;
}

/** Optional operator text: undefined stays null. */
export function optionalText(label: string, v: unknown, max = OPERATOR_TEXT_MAX): string | null {
  return v === undefined || v === null ? null : operatorText(label, v, max);
}

/** An id the operator typed, against its pattern. */
export function idOf<T extends string = string>(label: string, v: unknown, pattern: RegExp): T {
  if (typeof v !== 'string' || !pattern.test(v)) invalid(`${label} is not a valid id`);
  return v as T;
}

/** A limit the operator (or the command line) gives: a whole number from 1 to `max`. */
export function limitOf(v: unknown, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max) invalid(`the limit must be a whole number from 1 to ${max}`);
  return v;
}
