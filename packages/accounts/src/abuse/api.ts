/**
 * Abuse controls (design section 8, 11.3; M14-1): human checks, rate limits, sign-in back-off. Built by M14-5 in src/abuse/* (the factories in
 * src/abuse/index.ts; src/abuse/bucket.ts is its copy of net's KeyedLimiter, 11.8).
 */
import type { AccountId, AccountRateLimits, WorkChallenge } from '../api';
import type { HashPriority, PasswordHasher } from '../crypto/api';

export type VerifyAction = 'register' | 'signIn' | 'recover';
export interface HumanVerifier {
  readonly kind: 'work' | 'none' | (string & {});
  /** Sent to the client; null for 'work' and 'none'. */
  readonly siteKey: string | null;
  /** A challenge for an attempt that needs one (8.4); null for a verifier with its own widget. */
  challenge(ctx: { action: VerifyAction; scope: string; bits: number }, now: Date): WorkChallenge | null;
  verify(token: string, ctx: { addressKey: string; action: VerifyAction; scope: string; bits: number }, now: Date):
    Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'unavailable' }>;
}
export interface BreachedPasswordCheck { breached(password: string): Promise<boolean | 'unknown'> }
/**
 * INTERFACE CHANGE (M14-8): 'emailCodeFailure' added (every try of an email code, per address key: emailCodeFailuresPerHour).
 * INTERFACE CHANGE (M14-13, review of M14-13): 'providerBegin' and 'providerCallback', the provider flows' per-address buckets (ACCOUNT_RATE_LIMITS).
 * INTERFACE CHANGE (M14-15, review A4): 'emailResetDevice', a reset request's own allowance per valid device proof of the account (`other`: the
 * proof's stored hash), emailResetRequestsPerDay a day like the account's.
 */
export type LimitRule =
  | 'register' | 'signIn' | 'recoveryFailure' | 'emailResetRequest' | 'emailResetDevice' | 'emailCodeFailure' | 'emailCodeTry' | 'verifyMail'
  | 'verifyMailAddress' | 'guestReport' | 'report' | 'reportTarget' | 'avatar' | 'privacy' | 'relation' | 'export' | 'providerBegin'
  | 'providerCallback';
export interface RateLimiter {
  /**
   * One token from each bucket of `rule`: for an address key also its /56 and /48 (IPv6), with the factors of ACCOUNT_RATE_LIMITS. `until`: the
   * buckets this call makes are forgotten at that moment, full or not (an email code's counters die with the code). INTERFACE CHANGE (M14-8):
   * `until` added.
   */
  take(
    rule: LimitRule, key: { addressKey?: string; account?: AccountId; other?: string; until?: Date }, now: Date,
  ): { ok: true } | { ok: false; retryAfterMs: number };
  /** Rules 1, 2, 3 and 5 of 8.2. */
  readonly signIn: SignInGuard;
}
export interface SignInAttempt {
  kind: 'signIn' | 'recover';
  nameKey: string;
  /** The key has an entry in `names` (8.2 rule 6: free names are not counted). */
  known: boolean;
  addressKey: string;
  /** A valid device proof for the account (rule 2). */
  device: { account: AccountId; hash: string; failures: number } | null;
  /** The bits of a solved challenge it carries, 0 if none. */
  workBits: number;
}
export interface SignInGuard {
  /** Before any hash: go on (with the hashing class), wait, or pay work first. */
  before(a: SignInAttempt, now: Date):
    | { go: true; priority: HashPriority }
    | { go: false; code: 'rateLimited'; retryAfterMs: number }
    | { go: false; code: 'captchaRequired'; bits: number };
  after(a: SignInAttempt, ok: boolean, now: Date): void;
}

// ---- Where they come from (src/abuse/index.ts, M14-5) ---------------------------------------------------------------------------------------
/**
 * The built-in proof-of-work verifier (kind 'work', the default, 8.4): `createWorkVerifier` of src/abuse/index.ts. Its HMAC key is made from
 * `random` at start and lives only in memory; challenges expire after `challengeMs` (ACCOUNT_TIMING.workChallengeMs).
 */
export type CreateWorkVerifier = (opts: { random: (n: number) => Uint8Array; challengeMs: number }) => HumanVerifier;
/** Kind 'none' (CAPTCHA=none): tests and development only: `createNoVerifier` of src/abuse/index.ts. */
export type CreateNoVerifier = () => HumanVerifier;
/**
 * The rate limits of 8.1 and the sign-in guard of 8.2, all in memory: `createRateLimiter` of src/abuse/index.ts, made by the service core.
 * `verifier` is the HumanVerifier's kind (rule 3 differs for 'none'); `hashLoad` is the hasher's load() (rule 5).
 */
export type CreateRateLimiter = (opts: {
  limits: AccountRateLimits;
  verifier: HumanVerifier['kind'];
  hashLoad: PasswordHasher['load'];
}) => RateLimiter;
