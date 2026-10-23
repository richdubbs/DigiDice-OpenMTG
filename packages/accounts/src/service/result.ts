/**
 * M14-5: the service's answers (design 11.1 AccountResult, 11.3). Every call answers an AccountResult and never throws for anything a client sends
 * (m13's C4 rule): a refusal inside a flow is thrown as a `Refusal` and caught by the method's wrapper (./core.ts), which also turns a full hashing
 * queue into `busy` (or `unavailable` for a method whose row has no `busy`) and any other failure into `unavailable`.
 *
 * The messages are plain and generic: none repeats what the client typed (a name, a password, a code) or tells one hidden state from another.
 */
import type { AccountError, AccountErrorCode, AccountResult } from '../api';

export const ERROR_MESSAGES: Readonly<Record<AccountErrorCode, string>> = Object.freeze({
  badMessage: 'The request is not valid.',
  rateLimited: 'Too many attempts. Please wait a little and try again.',
  busy: 'Please try again in a moment.',
  notYet: 'This is not available yet.',
  notAllowed: 'This is not allowed.',
  notFound: 'Not found.',
  conflict: 'Something changed at the same time. Please try again.',
  unavailable: 'The account service is not available right now. Please try again later.',
  badCredentials: 'The name or password is not right.',
  reauthRequired: 'Please enter your password to confirm.',
  sessionExpired: 'Your session has expired. Please sign in again.',
  sessionRevoked: 'You were signed out. Please sign in again.',
  nameInvalid: 'This name cannot be used.',
  nameTaken: 'This name is taken.',
  nameReserved: 'This name is reserved.',
  nameFiltered: 'This name is not allowed.',
  renameCooldown: 'You can rename only once every 30 days.',
  passwordWeak: 'Please choose a stronger password.',
  ageGate: 'You cannot make an account yet. You can still play as a guest.',
  captchaRequired: 'Please complete the check first.',
  captchaFailed: 'The check did not succeed. Please try again.',
  suspended: 'This account is suspended.',
  banned: 'This account is banned.',
  deletionPending: 'This account is being deleted.',
  alreadyClaimed: 'These games were already added to an account.',
  limitReached: 'You have reached the limit for this.',
  emailUnavailable: 'Email is not available on this server.',
  emailInvalid: 'This email address is not valid.',
  emailCodeInvalid: 'The code is not right or has expired.',
  providerUnavailable: 'This sign-in method is not available right now.',
  providerFailed: 'Signing in with the other service did not succeed.',
  providerLinked: 'This sign-in is already linked to an account.',
});

/** The message of a `busy` answer while the connection's guest session is seated, queued or waiting (5.3). */
export const BUSY_IN_GAME = 'Finish or leave your current game first.';

export function ok<T>(value: T): AccountResult<T> {
  return { ok: true, value };
}

export function fail(code: AccountErrorCode, extra: Omit<Partial<AccountError>, 'code'> = {}): { ok: false; error: AccountError } {
  return { ok: false, error: { code, message: extra.message ?? ERROR_MESSAGES[code], ...withoutMessage(extra) } };
}

function withoutMessage(extra: Omit<Partial<AccountError>, 'code'>): Omit<Partial<AccountError>, 'code' | 'message'> {
  const out: Omit<Partial<AccountError>, 'code' | 'message'> = {};
  if (extra.retryAfterMs !== undefined) out.retryAfterMs = Math.max(1, Math.ceil(extra.retryAfterMs));
  if (extra.details !== undefined) out.details = [...extra.details];
  if (extra.sanction !== undefined) out.sanction = extra.sanction;
  if (extra.challenge !== undefined) out.challenge = extra.challenge;
  return out;
}

/** A refusal thrown inside a flow; the method's wrapper answers its result. */
export class Refusal extends Error {
  constructor(readonly result: { ok: false; error: AccountError }) {
    super(result.error.code);
    this.name = 'Refusal';
  }
}

/** Throws the refusal of `code`. */
export function refuse(code: AccountErrorCode, extra: Omit<Partial<AccountError>, 'code'> = {}): never {
  throw new Refusal(fail(code, extra));
}

/** The value of an ok result, or throws its refusal (for a part of a flow that answers an AccountResult). */
export function unwrap<T>(r: AccountResult<T>): T {
  if (!r.ok) throw new Refusal(r);
  return r.value;
}
