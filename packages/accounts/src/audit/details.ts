/**
 * M14-5: the fixed shape of each audit kind's details (design 8.5, AuditDetails in src/api.ts), checked at run time: TypeScript does not stop an
 * extra property, so the writer refuses any event whose details have another key, a value of another type, or more than AUDIT_DETAILS_MAX bytes of
 * JSON. The shapes leave no room for a password, code, token, email address, birth date, internal note, reporter, typed name or another account's
 * id: every free value is an id of the event's own records, a count, a time, or a value of a closed set.
 */
import {
  AUDIT_DETAILS_MAX, REPORT_REASONS, type AuditDetails, type AuditKind, type ProviderId, type RevokeReason, type SanctionKind, type SanctionReason,
  type SensitiveAction,
} from '../api';
import { STORE_ID } from '../text';

type Check = (v: unknown) => boolean;

const oneOf = (...values: readonly unknown[]): Check => (v) => values.includes(v);
const bool: Check = (v) => typeof v === 'boolean';
const count: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const bits: Check = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 32;
/** An id of the event's own records (a session, report, sanction or guest session): m13's store id rule. */
const id: Check = (v) => typeof v === 'string' && STORE_ID.test(v);
/** A keyed tag (8.5): 16 lowercase hex digits. */
const tag: Check = (v) => v === null || (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v));
const time: Check = (v) => typeof v === 'string' && v.length <= 32 && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const holderList: Check = (v) => Array.isArray(v) && v.length <= 16 && v.every((h) => typeof h === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(h));

const PROVIDERS: readonly ProviderId[] = ['local', 'shopify', 'passkey'];
const REVOKE: readonly RevokeReason[] = [
  'signOut', 'signOutEverywhere', 'revoked', 'passwordChanged', 'recovery', 'emailReset', 'reuse', 'proofFailed', 'expired', 'tooMany', 'sanction',
  'deletion', 'admin',
];
const ACTIONS: readonly SensitiveAction[] = ['password', 'recoveryCodes', 'email', 'link', 'unlink', 'rename', 'export', 'delete', 'appeal', 'claim'];
const SANCTION_KINDS: readonly SanctionKind[] = ['warn', 'mute', 'rename', 'unlist', 'suspend', 'ban'];
const SANCTION_REASONS: readonly SanctionReason[] = [...REPORT_REASONS, 'evasion'];

const provider = oneOf(...PROVIDERS);

/** Every kind's keys and the check of each value. */
export const AUDIT_DETAIL_SHAPES: { readonly [K in AuditKind]: { readonly [F in keyof AuditDetails[K]]-?: Check } } = Object.freeze({
  registered: { provider, claimed: bool },
  signedIn: { provider, device: bool, restricted: bool },
  signInFailed: { count, nameTag: tag },
  signInThrottled: { rule: oneOf(1, 2, 3, 5), nameTag: tag },
  signedOut: { everywhere: bool },
  sessionRevoked: { reason: oneOf(...REVOKE) },
  sessionsRevoked: { reason: oneOf(...REVOKE), count },
  sessionReuse: {},
  reauthed: { action: oneOf(...ACTIONS), via: oneOf('password', 'ticket') },
  reauthFailed: { action: oneOf(...ACTIONS), count },
  passwordChanged: { via: oneOf('password', 'recovery', 'emailReset') },
  recoveryUsed: { left: count },
  recoveryFailed: { count },
  recoveryCodesRenewed: {},
  emailSet: {},
  emailVerified: {},
  emailRemoved: {},
  emailResetRequested: { sent: bool },
  emailResetUsed: {},
  providerLinked: { provider },
  providerUnlinked: { provider },
  renamed: { free: bool },
  guestClaimed: { guestSession: id, games: count },
  exported: {},
  deletionRequested: { purgeAt: time },
  deletionCancelled: {},
  deleted: { holders: holderList },
  captchaRequired: { rule: oneOf(3, 5, 'register'), bits },
  reported: { report: id, reason: oneOf(...REPORT_REASONS) },
  appealed: { sanction: id },
  sanctioned: { sanction: id, kind: oneOf(...SANCTION_KINDS), reason: oneOf(...SANCTION_REASONS), now: bool },
  sanctionLifted: { sanction: id },
  sanctionExpired: { sanction: id },
  forcedRename: { sanction: (v) => v === null || id(v) },
  reportClosed: { report: id, outcome: oneOf('actioned', 'dismissed') },
  appealAnswered: { sanction: id, answer: oneOf('upheld', 'lifted') },
  adminViewed: { what: oneOf('find', 'show', 'reports', 'report', 'appeals', 'audit') },
  adminExported: { partial: bool },
  nameReserved: {},
  nameReleased: {},
  nameRekeyed: { from: count, to: count, changed: count },
});

/**
 * Null when `details` has exactly the keys of its kind's shape, every value passes, a `nameTag` is only set on an event without an account (8.5),
 * and the JSON is at most AUDIT_DETAILS_MAX bytes; else the problem (naming the key, never echoing the value).
 */
export function auditDetailsProblem(kind: AuditKind, details: unknown, account: string | null): string | null {
  const shape = (AUDIT_DETAIL_SHAPES as Record<string, Record<string, Check>>)[kind];
  if (shape === undefined) return `unknown audit kind`;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return `${kind}: details are not an object`;
  const keys = Object.keys(details);
  // own keys only: `in` would also find what every object inherits (constructor, toString, hasOwnProperty)
  for (const k of keys) if (!Object.hasOwn(shape, k)) return `${kind}: details have the unknown key ${JSON.stringify(k.slice(0, 32))}`;
  for (const [k, check] of Object.entries(shape)) {
    if (!Object.hasOwn(details, k)) return `${kind}: details lack ${k}`;
    if (!check((details as Record<string, unknown>)[k])) return `${kind}: details.${k} has a value of the wrong kind`;
  }
  if (account !== null && Object.hasOwn(details, 'nameTag') && (details as { nameTag: unknown }).nameTag !== null) {
    return `${kind}: a nameTag is only for an event without an account`;
  }
  if (Buffer.byteLength(JSON.stringify(details), 'utf8') > AUDIT_DETAILS_MAX) return `${kind}: details are longer than ${AUDIT_DETAILS_MAX} bytes`;
  return null;
}
