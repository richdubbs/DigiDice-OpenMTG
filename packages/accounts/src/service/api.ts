/**
 * The account service, its parts, the operator's API and the server-side seams (design 11.3; M14-1). M14-5 builds the service core
 * (src/service/index.ts and the rest of src/service/* but providers.ts, which is M14-13's). Moderation (M14-6), data rights (M14-7) and email (M14-8)
 * are **parts** the service takes as optional dependencies: each is built by a factory from its own files, and a missing part's methods answer
 * `notYet`, so no package edits another's files to wire itself in (src/compose.ts passes all three).
 */
import type * as A from '../api';
import type {
  AccountStore, AccountPatch, AccountPurgeReport, AccountSessionRow, AppealRow, CredentialRow, NameHistoryRow, ReportQuery, ReportRow, SanctionRow,
} from '../store/api';
import type { AccountsConfig } from '../config';
import type { IdentityProvider } from '../identity/api';
import type { CredentialTools, PasswordHasher } from '../crypto/api';
import type { NameFilter, NameRules } from '../names/api';
import type { BreachedPasswordCheck, HumanVerifier, RateLimiter } from '../abuse/api';
import type { AuditWriter } from '../audit/api';
import type { Mailer, MailQueue, NoticeKind } from '../email/api';

/** Given by the host (hosted's gateway) with every call. */
export interface RequestContext {
  /** Server time. */
  now: Date;
  /** The gateway's connection id: provider flows are bound to it (3.5). */
  connection: string;
  /** The address key (/32 or /64), in memory only; never stored (D15). The service derives the /56 and /48 keys itself (8.1). */
  addressKey: string;
  /** The connection's guest hosted session while it is a guest; null when signed in. */
  guestSession: string | null;
  /** That guest session is seated, queued or waiting for capacity: register, signIn, recover, useEmailReset and confirmProvider answer busy (5.3). */
  guestBusy: boolean;
  client: A.ClientKind;
}
/** A signed-in connection. Every call checks again that the session is live and what the status allows (RESTRICTED_CALLS). */
export interface Auth { account: A.AccountId; session: string }
/** The account's credential, in the same request as a sensitive change (5.2): the password, or a one-use reauth ticket (3.5). */
export type Proof = { password: string } | { ticket: string };

export interface RegisterRequest {
  name: string; password: string; birth: { year: number; month: number };
  email?: string;
  /** Only true when the player ticked the box under the listed guest games (5.5). */
  claimGuest: boolean;
  captcha?: string; device?: string;
}
export interface PasswordSignIn { name: string; password: string; captcha?: string; device?: string }
export interface RecoverRequest { name: string; code: string; newPassword: string; captcha?: string; device?: string }
export interface EmailResetUse { name: string; code: string; newPassword: string; device?: string }
export interface SignedIn {
  account: A.SelfView; auth: Auth;
  /** The account session token and its rotation counter (5.2): given once, never again. */
  token: string; rotation: number;
  /** A device proof (new, or the one sent). */
  device: string;
  /**
   * Registration and the email reset: the 10 codes, given once. INTERFACE CHANGE (M14-15, review A5): also after an email reset, which makes them
   * anew so that codes an attacker made with a stolen password stop working; the client shows them as at registration.
   */
  recoveryCodes?: string[];
  /** After a recovery-code sign-in. */
  codesLeft?: number;
}
export interface Resumed { account: A.SelfView; auth: Auth; /** A rotated token and its counter, when one was due or inside the grace (5.2). */ token?: string; rotation?: number }
export type Reporter = { kind: 'account'; auth: Auth } | { kind: 'guest'; session: string } | { kind: 'system'; source: string };
export interface PlayerReport {
  target: { account: A.AccountId } | { guestSession: string; name: string };
  reason: A.ReportReason; text?: string; game?: string;
  /** Refused (badMessage) unless the reporter's kind is 'system' (milestone 15's abuse reports): the other accounts of the case, and its evidence. */
  related?: A.AccountId[];
  evidence?: { games: string[]; stats: Record<string, number> };
}
/** What the hosted HTTP server passes from GET /auth/shopify/callback (3.5); the route never logs the query. */
export interface ProviderCallbackInput { code?: string; state?: string; error?: string; addressKey: string; now: Date }
export type ProviderOutcome =
  | { kind: 'signedIn'; signedIn: SignedIn }
  | { kind: 'needsName'; flow: string }                 // a new subject: registerWithProvider next, from the same connection
  | { kind: 'linked'; account: A.SelfView }
  | { kind: 'reauthed'; ticket: string };               // a Proof for 2 minutes, one use, this session only

/** Hosted's guest sessions (5.5, 5.3); a fake in tests that records retire calls. */
export interface GuestSessions {
  /** The live guest session a guest token proves, and whether it is busy. Null: no such live guest session. */
  proof(token: string): Promise<{ session: string; busy: boolean } | null>;
  /** Seated, queued or waiting for capacity. */
  busy(session: string): Promise<boolean>;
  /** Ends a claimed guest session: its token stops working at once. Idempotent. */
  retire(session: string): Promise<void>;
}

export interface AccountService {
  // sign-up, sign-in and sessions (3, 4, 5)
  register(ctx: RequestContext, req: RegisterRequest): Promise<A.AccountResult<SignedIn>>;
  signIn(ctx: RequestContext, req: PasswordSignIn): Promise<A.AccountResult<SignedIn>>;
  /** A token from `hello`: the session, rotated when due or re-rotated inside the grace; reuse after the grace revokes it (5.2). */
  resume(ctx: RequestContext, token: string): Promise<A.AccountResult<Resumed>>;
  signOut(ctx: RequestContext, auth: Auth, everywhere: boolean): Promise<A.AccountResult<void>>;
  sessions(ctx: RequestContext, auth: Auth): Promise<A.AccountResult<A.SessionView[]>>;
  /** Only a session of auth.account; any other id answers notFound. */
  revokeSession(ctx: RequestContext, auth: Auth, session: string): Promise<A.AccountResult<void>>;
  /** `current` is the proof (5.2): a wrong one counts on the session. */
  changePassword(ctx: RequestContext, auth: Auth, current: string, next: string): Promise<A.AccountResult<void>>;
  /**
   * The new password is checked before the code (4.4), so a weak one burns no code; but before the code has matched, only by the rules that need
   * nothing private: CredentialTools.passwordProblem with the request's name, that name's key and `emailLocal: null`, so the answer is the same for
   * every account and every name. The email rule ('containsEmail') runs after the code matched and before it is spent: a weak password still burns
   * no code, and nobody without a valid code learns anything of the account's address (7.4). INTERFACE CHANGE (review of M14-1): 4.4's order refined.
   */
  useRecoveryCode(ctx: RequestContext, req: RecoverRequest): Promise<A.AccountResult<SignedIn>>;
  newRecoveryCodes(ctx: RequestContext, auth: Auth, proof: Proof): Promise<A.AccountResult<{ codes: string[] }>>;
  // email (3.4; the email part, M14-8)
  setEmail(ctx: RequestContext, auth: Auth, address: string | null, proof: Proof): Promise<A.AccountResult<A.SelfView>>;
  verifyEmail(ctx: RequestContext, auth: Auth, code: string): Promise<A.AccountResult<A.SelfView>>;
  /**
   * INTERFACE CHANGE (M14-15, review A4): `device`, the browser's device proof (8.3), checked as signIn checks it (badMessage for one of the wrong
   * shape). Kept after a sign-out, it gives the owner's request an allowance of its own (emailResetRequestsPerDay per device proof, after the answer
   * like the rest), so a stranger who spends the account's requests by its public name cannot keep the owner from a code. M14-10 adds `device?` to
   * the message (11.6).
   */
  requestEmailReset(ctx: RequestContext, name: string, device?: string): Promise<A.AccountResult<void>>;
  /**
   * The new password is checked before the code (3.4), as useRecoveryCode does it: before the code has matched without the email rule (the request's
   * name and key, `emailLocal: null`), after it matched and before it is used with the email rule, so the answer to a wrong code never depends on the
   * account's address (7.4). INTERFACE CHANGE (review of M14-1): 3.4's order refined.
   */
  useEmailReset(ctx: RequestContext, req: EmailResetUse): Promise<A.AccountResult<SignedIn>>;
  // external providers (3.5, 3.6; 'notYet' until M14-13, M14-14)
  /**
   * intent link needs `proof`; link and reauth need `auth`; signIn and register need a guest connection. A restricted session (3.8) may begin only
   * the intents of RESTRICTED_PROVIDER_INTENTS ('reauth'); any other intent from it answers the status's code (suspended, banned, deletionPending).
   */
  beginProvider(ctx: RequestContext, provider: A.ProviderId, intent: A.ProviderIntent, auth: Auth | null, proof?: Proof):
    Promise<A.AccountResult<{ flow: string; authorizeUrl?: string; options?: unknown }>>;
  /** The HTTP callback: finds the flow by `state`, checks the ID token, and gives the confirmation code for the page. Issues nothing (3.5). */
  providerCallback(input: ProviderCallbackInput): Promise<A.AccountResult<{ state: string; code: string; expiresAt: string }>>;
  /**
   * From the connection (and guest or account session) that started the flow, with the code: the outcome. From a restricted session only a flow of
   * RESTRICTED_PROVIDER_INTENTS ('reauth') is confirmed; any other (a link begun before a sanction) answers the status's code.
   *
   * INTERFACE CHANGE (M14-13, review of M14-13): `device`, the browser's device proof (8.3), checked as signIn checks it (badMessage for one of the
   * wrong shape; a valid one of the signed-in account is kept, else a new one is given). Without it every provider sign-in made a new proof and
   * pushed the account's other devices out (8.3: at most 10). M14-10 adds `device?` to the providerConfirm message (11.6).
   */
  confirmProvider(ctx: RequestContext, auth: Auth | null, flow: string, code: string, device?: string): Promise<A.AccountResult<ProviderOutcome>>;
  /** After needsName, from the same connection and guest session as the flow. */
  registerWithProvider(ctx: RequestContext, flow: string, req: { name: string; birth: { year: number; month: number }; claimGuest: boolean }):
    Promise<A.AccountResult<SignedIn>>;
  unlinkProvider(ctx: RequestContext, auth: Auth, provider: A.ProviderId, proof: Proof): Promise<A.AccountResult<A.SelfView>>;
  // guests (5.5, 6.6)
  /**
   * Needs `proof` (5.2, action 'claim'). INTERFACE CHANGE (M14-15, review A3): the `proof` parameter, and reauthRequired and badCredentials in its
   * row: a claim cannot be undone and an account has at most 20, so a stolen token alone could fill them with guest sessions it controls. A
   * registration's claim (RegisterRequest.claimGuest, registerWithProvider) is part of its one atomic createAccount and asks for nothing more.
   */
  claimGuest(ctx: RequestContext, auth: Auth, guestToken: string, proof: Proof): Promise<A.AccountResult<{ session: string }>>;
  /** True for every key that is not free or that 6.2 refuses, alike (6.6). */
  nameUnavailable(name: string): Promise<boolean>;
  // profile and privacy (6, 7)
  self(ctx: RequestContext, auth: Auth): Promise<A.AccountResult<A.SelfView>>;
  /** A warning the account has read (9.3). */
  markSeen(ctx: RequestContext, auth: Auth, sanction: string): Promise<A.AccountResult<A.SelfView>>;
  /**
   * Needs `proof` (5.2, action 'rename'): sign-in, recovery and the email reset find the account by its current name only, so a rename is a change
   * that could keep the owner out. INTERFACE CHANGE (review of M14-1): the `proof` parameter, and reauthRequired and badCredentials in its row.
   */
  rename(ctx: RequestContext, auth: Auth, name: string, proof: Proof): Promise<A.AccountResult<A.SelfView>>;
  setAvatar(ctx: RequestContext, auth: Auth, avatar: A.AvatarId): Promise<A.AccountResult<A.SelfView>>;
  setPrivacy(ctx: RequestContext, auth: Auth, change: Partial<A.PrivacySettings>): Promise<A.AccountResult<A.SelfView>>;
  profile(ctx: RequestContext, who: { account: A.AccountId } | { name: string }): Promise<A.AccountResult<A.PublicProfile>>;
  // relations, reports, appeals (9; the moderation part, M14-6)
  /** Accepted alike for hidden, erased and unknown ids (7.3). */
  block(ctx: RequestContext, auth: Auth, other: A.AccountId, on: boolean): Promise<A.AccountResult<void>>;
  mute(ctx: RequestContext, auth: Auth, other: A.AccountId, on: boolean): Promise<A.AccountResult<void>>;
  relations(ctx: RequestContext, auth: Auth): Promise<A.AccountResult<A.RelationView[]>>;
  report(ctx: RequestContext, reporter: Reporter, report: PlayerReport): Promise<A.AccountResult<{ report: string }>>;
  /**
   * Only the account's own sanctions (notFound otherwise). Needs `proof` (5.2, action 'appeal'), from a restricted session too (a password or a
   * reauth ticket). INTERFACE CHANGE (M14-15, review A3): the `proof` parameter, and reauthRequired and badCredentials in its row: a sanction has
   * one appeal, so a stolen token alone could use up the owner's.
   */
  appeal(ctx: RequestContext, auth: Auth, sanction: string, text: string, proof: Proof): Promise<A.AccountResult<void>>;
  // data rights (10; the rights part, M14-7)
  exportData(ctx: RequestContext, auth: Auth, proof: Proof): Promise<A.AccountResult<A.AccountExport>>;
  deleteAccount(ctx: RequestContext, auth: Auth, proof: Proof): Promise<A.AccountResult<{ purgeAt: string }>>;
  /** From a restricted session; refused (notAllowed) once erasingAt is set or now >= purgeAt (10.2). */
  cancelDeletion(ctx: RequestContext, auth: Auth): Promise<A.AccountResult<A.SelfView>>;
  // for other packages and the operator
  readonly directory: A.AccountDirectory;
  readonly admin: AccountAdmin;
  addHolder(holder: A.AccountDataHolder): void;
  changes(after: number, limit: number): Promise<A.AccountChange[]>;
  changesHead(): Promise<number>;
  onChange(listener: (c: A.AccountChange) => void): () => void;
  /** Due deletions, expired sanctions, inactive accounts, mail files, daily retention. The host calls it every minute. */
  tick(now: Date): Promise<TickReport>;
  close(): Promise<void>;
}
export type ServiceMethod = Exclude<keyof AccountService, 'directory' | 'admin' | 'addHolder' | 'changes' | 'changesHead' | 'onChange' | 'tick' | 'close'>;
export interface TickReport {
  erased: number; erasureRetries: number; erasureBlocked: number; sanctionsEnded: number; inactiveNotified: number; mailFilesRemoved: number;
  purged: AccountPurgeReport | null;
}

/**
 * 3.8: the calls a restricted session may make; every other call answers suspended, banned or deletionPending.
 *
 * INTERFACE CHANGE (review of M14-1): beginProvider and confirmProvider are in every list, for the intents of RESTRICTED_PROVIDER_INTENTS only
 * ('reauth'). An account without a password proves itself with a reauth ticket (5.2), so without them a restricted provider-only account could
 * never give the proof that exportData, deleteAccount, newRecoveryCodes and setEmail need (D24: a restricted player can export and delete from any
 * device). ServiceGuard.session lets both through and gives the status; the provider methods (M14-13) answer the status's code for any other
 * intent, so these two rows of ACCOUNT_METHOD_ERRORS keep suspended, banned and deletionPending.
 */
export const RESTRICTED_CALLS: {
  readonly suspended: readonly ServiceMethod[]; readonly banned: readonly ServiceMethod[]; readonly deleting: readonly ServiceMethod[];
} = Object.freeze({
  suspended: Object.freeze<ServiceMethod[]>([
    'self', 'markSeen', 'sessions', 'revokeSession', 'signOut', 'changePassword', 'newRecoveryCodes', 'setEmail', 'verifyEmail', 'appeal', 'exportData',
    'deleteAccount', 'beginProvider', 'confirmProvider',
  ]),
  banned: Object.freeze<ServiceMethod[]>([
    'self', 'markSeen', 'sessions', 'revokeSession', 'signOut', 'changePassword', 'newRecoveryCodes', 'setEmail', 'verifyEmail', 'appeal', 'exportData',
    'deleteAccount', 'beginProvider', 'confirmProvider',
  ]),
  deleting: Object.freeze<ServiceMethod[]>([
    'self', 'sessions', 'revokeSession', 'signOut', 'changePassword', 'exportData', 'cancelDeletion', 'beginProvider', 'confirmProvider',
  ]),
});
/** The provider intents a restricted session may begin and confirm (RESTRICTED_CALLS): a reauth ticket, its proof (5.2). INTERFACE CHANGE, as above. */
export const RESTRICTED_PROVIDER_INTENTS: readonly A.ProviderIntent[] = Object.freeze<A.ProviderIntent[]>(['reauth']);
/** The calls RESTRICTED_CALLS allow for some intents only: they may still answer the status's code. */
const INTENT_RESTRICTED: readonly ServiceMethod[] = ['beginProvider', 'confirmProvider'];

// ---- ACCOUNT_METHOD_ERRORS: the table of 11.3 as data --------------------------------------------------------------------------------------------
/** Every method may also answer these (notYet until its part has merged). */
const COMMON_CODES = ['badMessage', 'rateLimited', 'unavailable', 'notYet'] as const satisfies readonly A.AccountErrorCode[];
/** Each method's own codes (the table of 11.3, "Its own codes"). */
const OWN_CODES: { readonly [M in ServiceMethod]: readonly A.AccountErrorCode[] } = {
  register: [
    'busy', 'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'passwordWeak', 'ageGate', 'captchaRequired', 'captchaFailed', 'emailInvalid',
    'emailUnavailable', 'alreadyClaimed',
  ],
  signIn: ['busy', 'badCredentials', 'captchaRequired', 'captchaFailed'],
  resume: ['sessionExpired', 'sessionRevoked'],
  signOut: [], sessions: [], self: [], relations: [],
  revokeSession: ['notFound'], markSeen: ['notFound'],
  changePassword: ['badCredentials', 'passwordWeak'],
  useRecoveryCode: ['busy', 'badCredentials', 'passwordWeak', 'captchaRequired', 'captchaFailed'],
  newRecoveryCodes: ['reauthRequired', 'badCredentials'],
  setEmail: ['reauthRequired', 'badCredentials', 'emailInvalid', 'emailUnavailable', 'limitReached'],
  verifyEmail: ['emailCodeInvalid'],
  requestEmailReset: ['emailUnavailable'],
  useEmailReset: ['busy', 'emailCodeInvalid', 'passwordWeak'],
  beginProvider: ['providerUnavailable', 'notAllowed', 'reauthRequired', 'badCredentials'],
  providerCallback: ['providerFailed', 'providerUnavailable'],
  confirmProvider: ['busy', 'providerFailed', 'providerLinked'],
  registerWithProvider: ['busy', 'providerFailed', 'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'ageGate', 'alreadyClaimed'],
  unlinkProvider: ['reauthRequired', 'badCredentials', 'notFound', 'conflict'],
  // reauthRequired and badCredentials: the proof (INTERFACE CHANGE, M14-15 review A3)
  claimGuest: ['reauthRequired', 'badCredentials', 'busy', 'notFound', 'alreadyClaimed', 'limitReached'],
  nameUnavailable: [],
  // reauthRequired and badCredentials: the proof (INTERFACE CHANGE, review of M14-1)
  rename: ['reauthRequired', 'badCredentials', 'nameInvalid', 'nameTaken', 'nameReserved', 'nameFiltered', 'renameCooldown', 'conflict'],
  setAvatar: [], setPrivacy: [],
  profile: ['notFound'],
  block: ['limitReached'], mute: ['limitReached'],
  report: ['notAllowed'],
  // reauthRequired and badCredentials: the proof (INTERFACE CHANGE, M14-15 review A3)
  appeal: ['reauthRequired', 'badCredentials', 'notFound', 'conflict'],
  exportData: ['reauthRequired', 'badCredentials'],
  deleteAccount: ['reauthRequired', 'badCredentials'],
  cancelDeletion: ['notAllowed'],
};
/**
 * The methods that take an `Auth` (or an `Auth | null`; `report` through a Reporter of kind 'account'): they may also answer sessionExpired and
 * sessionRevoked, and, for a restricted session outside RESTRICTED_CALLS, suspended, banned or deletionPending.
 */
const AUTH_METHODS: readonly ServiceMethod[] = [
  'signOut', 'sessions', 'revokeSession', 'changePassword', 'newRecoveryCodes', 'setEmail', 'verifyEmail', 'beginProvider', 'confirmProvider',
  'unlinkProvider', 'claimGuest', 'self', 'markSeen', 'rename', 'setAvatar', 'setPrivacy', 'block', 'mute', 'relations', 'report', 'appeal', 'exportData',
  'deleteAccount', 'cancelDeletion',
];

/**
 * The methods that write the account row through ServiceGuard.patch (or the store's version check, as rename does): a version conflict that survives
 * the service's 3 retries answers 'conflict' (AccountResult, ServiceGuard.patch), so each of their rows holds it. The sign-ins write lastSignInAt
 * (and clear inactiveNoticeAt), setEmail and verifyEmail the email, setAvatar and setPrivacy theirs, deleteAccount and cancelDeletion the deletion,
 * rename the name. INTERFACE CHANGE (review of M14-1): 11.3's table gave 'conflict' only to rename, unlinkProvider and appeal, so these methods
 * could not answer what ServiceGuard.patch answers.
 */
const PATCH_METHODS: readonly ServiceMethod[] = [
  'signIn', 'useRecoveryCode', 'useEmailReset', 'confirmProvider', 'setEmail', 'verifyEmail', 'rename', 'setAvatar', 'setPrivacy', 'deleteAccount',
  'cancelDeletion',
];

function methodErrors(m: ServiceMethod): readonly A.AccountErrorCode[] {
  // nameUnavailable answers a plain boolean, never a code
  if (m === 'nameUnavailable') return Object.freeze([]);
  const codes = new Set<A.AccountErrorCode>([...COMMON_CODES, ...OWN_CODES[m]]);
  if (PATCH_METHODS.includes(m)) codes.add('conflict');
  if (AUTH_METHODS.includes(m)) {
    codes.add('sessionExpired');
    codes.add('sessionRevoked');
    const partly = INTENT_RESTRICTED.includes(m);
    if (partly || !RESTRICTED_CALLS.suspended.includes(m)) codes.add('suspended');
    if (partly || !RESTRICTED_CALLS.banned.includes(m)) codes.add('banned');
    if (partly || !RESTRICTED_CALLS.deleting.includes(m)) codes.add('deletionPending');
  }
  return Object.freeze([...codes]);
}

/**
 * The table below, as data; every service test checks each answer's code against it. Each row holds the method's own codes (11.3's table), the codes
 * every method may answer (badMessage, rateLimited, unavailable, and notYet until its part has merged), 'conflict' for a method that writes the
 * account row (PATCH_METHODS: a version conflict that survived 3 retries), and for a method that takes an Auth also
 * sessionExpired and sessionRevoked and, where RESTRICTED_CALLS leave the method out for that status or allow it for some intents only
 * (beginProvider, confirmProvider), suspended, banned and deletionPending.
 * `nameUnavailable` answers a plain boolean: its row is empty.
 */
export const ACCOUNT_METHOD_ERRORS: { readonly [M in ServiceMethod]: readonly A.AccountErrorCode[] } = Object.freeze(
  Object.fromEntries((Object.keys(OWN_CODES) as ServiceMethod[]).map((m) => [m, methodErrors(m)])) as { [M in ServiceMethod]: readonly A.AccountErrorCode[] },
);

// ---- parts (M14-6, M14-7, M14-8) ----
/** What the service hands each part, so a part builds from its own files and tests with fakes. */
export interface PartDeps {
  store: AccountStore;
  config: AccountsConfig;
  audit: AuditWriter;
  limits: RateLimiter;
  /** Appends a change and tells the onChange listeners. */
  changes(c: Omit<A.AccountChange, 'seq'>): Promise<number>;
  mail: MailQueue;
  log: AccountsLog;
  random: (n: number) => Uint8Array;
  /** The service core's shared checks. */
  guard: ServiceGuard;
  /**
   * INTERFACE CHANGE (M14-7): the service's clock (ServiceDeps.now; the system clock by default), for the operator's commands, which bring no
   * time (AccountAdmin). Optional, so a part's test fakes of PartDeps need not give it.
   */
  clock?: () => Date;
  /**
   * The mailer behind `mail`: its kind ('none' hides email, 3.4) and FileMailer's `forget` (expired files at tick, an account's at its erasure,
   * 10.2). INTERFACE CHANGE (M14-7, M14-8): added, optional so that existing fakes of PartDeps still fit; the service core always passes it.
   */
  mailer?: Mailer;
  /** The core's sign-in steps, for a part that signs a player in (the email reset, 3.4). INTERFACE CHANGE (M14-8), as above. */
  signIn?: PartSignIn;
  /**
   * A security notice through the email part (EmailPart.notify: queued, only to a verified address), so that every part's notices keep that rule
   * (the rights part's deletionRequested and inactive, the providers' providerLinked and providerUnlinked); resolves at once while the email part is
   * not built. INTERFACE CHANGE (M14-8), as above.
   */
  notify?: EmailPart['notify'];
  /**
   * The one constant-time comparison every secret check uses (CredentialTools.equal, 11.3 and 12.1: a test counts its calls), for the secrets a part
   * checks itself (the email part's codes). INTERFACE CHANGE (M14-8), as above.
   */
  equal?: (a: Uint8Array, b: Uint8Array) => boolean;
  /**
   * INTERFACE CHANGE (M14-7, review): two more, optional likewise.
   * - `limitWait`: milliseconds until `limits.take` with these arguments would succeed (0: now), taking nothing, so the export looks first and spends
   *   its day only once it is built (10.1).
   * - `auditQueued`: the events of `account` the audit writer still holds (a flush whose store write failed keeps them), so the erasure goes on only
   *   once the account's events are in the store it erases (10.2 step 5).
   */
  limitWait?(...args: Parameters<RateLimiter['take']>): number;
  auditQueued?(account: A.AccountId): number;
}
/**
 * What the email reset needs of the service core to act exactly like a recovery-code sign-in (3.4, 4.4): PartDeps had no way to find an account by
 * its name, check or hash a new password, or issue a session. INTERFACE CHANGE (M14-8): added, as PartDeps.signIn.
 */
export interface PartSignIn {
  /**
   * The account a typed name signs in to, by the name's key (6.3: the store's version, then the other one during a rekey), and that key. A forced
   * rename's banned old name reaches the account it was taken from, as sign-in does (M14-15, review A6).
   */
  findByName(name: string, now: Date): Promise<{ key: string; account: A.Account | null }>;
  /**
   * The stored hash of `proof` when it is a valid device proof of `account` (8.3: the account's, not spent, used within deviceIdleMs), else null.
   * INTERFACE CHANGE (M14-15, review A4): added, for the reset request's own allowance per device proof.
   */
  validDevice(proof: string, account: A.Account, now: Date): Promise<string | null>;
  /** 4.2's policy with the blocklist and the configured breach check: the problem (passwordWeak's detail), or null. */
  passwordProblem(password: string, ctx: { name: string; key: string; emailLocal: string | null }): Promise<A.PasswordProblem | null>;
  /**
   * A new local credential for the account (not yet stored): the hash runs under 8.1's in-flight limits in the address key's class (4.1). Throws the
   * hasher's HasherBusyError when the queue is full, and the core's rateLimited refusal when the in-flight limits are reached.
   */
  enroll(ctx: RequestContext, account: A.Account, password: string): Promise<CredentialRow>;
  /**
   * Signs in after the credential was replaced: a session (the device proof `device` when it is valid for the account, else a new one), every other
   * session revoked and every other device proof deleted (ServiceGuard.resetAccess with `reason`), lastSignInAt; what SignedIn carries, restricted
   * when the account is not active (3.8). Writes no audit event: the part records its own.
   */
  signIn(ctx: RequestContext, account: A.Account, device: string | undefined, reason: A.RevokeReason): Promise<SignedIn>;
  /**
   * A new generation of the account's 10 recovery codes, replacing every old one (as newRecoveryCodes does), formatted for the player; writes no
   * audit event and sends no notice: the part records its own. INTERFACE CHANGE (M14-15, review A5): added, for the email reset.
   */
  newRecoveryCodes(account: A.Account, now: Date): Promise<string[]>;
}
export interface ServiceGuard {
  /** The live session behind auth, and the account, if its status allows `call` (3.8); otherwise the error to answer. */
  session(ctx: RequestContext, auth: Auth, call: ServiceMethod): Promise<A.AccountResult<{ account: A.Account; row: AccountSessionRow; status: A.AccountStatus }>>;
  /** Checks a Proof (5.2) after everything else, counting a wrong one on the session; 5 in a row revoke it. */
  proof(ctx: RequestContext, auth: Auth, proof: Proof | undefined, action: A.SensitiveAction): Promise<A.AccountResult<void>>;
  /** m13's text rules (src/text.ts, 11.8) for every string the service takes: the trimmed text, or null when refused. */
  text(s: unknown, max: number): string | null;
  /** A self-contained patch, re-read and retried up to 3 times on a version conflict; then 'conflict'. */
  patch(id: A.AccountId, f: (a: A.Account) => AccountPatch | null): Promise<A.AccountResult<A.Account>>;
  /** Revokes every session but `except`, deletes every device proof but `keepDevice`, appends sessionsRevoked (a recovery, an email reset, 4.4). */
  resetAccess(account: A.AccountId, reason: A.RevokeReason, except: string | null, keepDevice: string | null, at: Date): Promise<void>;
}
export type ModerationPart = Pick<AccountService, 'block' | 'mute' | 'relations' | 'report' | 'appeal'> & {
  /** Every AccountAdmin method but the rights part's (exportAccount, deleteAccount, purge) and the core's (rekeyCheck, rekey). */
  readonly admin: Omit<AccountAdmin, 'exportAccount' | 'deleteAccount' | 'purge' | 'rekeyCheck' | 'rekey'>;
  tick(now: Date): Promise<{ sanctionsEnded: number }>;
};
export type RightsPart = Pick<AccountService, 'exportData' | 'deleteAccount' | 'cancelDeletion' | 'addHolder'> & {
  readonly admin: Pick<AccountAdmin, 'exportAccount' | 'deleteAccount' | 'purge'>;
  tick(now: Date): Promise<{ erased: number; erasureRetries: number; erasureBlocked: number; inactiveNotified: number; purged: AccountPurgeReport | null }>;
};
export type EmailPart = Pick<AccountService, 'setEmail' | 'verifyEmail' | 'requestEmailReset' | 'useEmailReset'> & {
  /** A security notice (3.4): queued, only to a verified address (the old one for an email change). */
  notify(account: A.AccountId, kind: NoticeKind, to?: string): Promise<void>;
  tick(now: Date): Promise<{ mailFilesRemoved: number }>;
};
/** Each exported by its part's src/<dir>/index.ts. M14-1's stub of each file exports the name as `undefined`; its owner replaces it. */
export type CreateModerationPart = (deps: PartDeps) => ModerationPart;     // src/moderation/index.ts (M14-6)
export type CreateRightsPart = (deps: PartDeps) => RightsPart;             // src/rights/index.ts (M14-7)
export type CreateEmailPart = (deps: PartDeps) => EmailPart;               // src/email/index.ts (M14-8)

/** `createAccountService(deps: AccountServiceDeps): AccountService`, exported by src/service/index.ts (M14-5). */
export type CreateAccountService = (deps: AccountServiceDeps) => AccountService;
export interface AccountServiceDeps {
  store: AccountStore;
  config: AccountsConfig;                  // src/config.ts (11.7)
  hasher: PasswordHasher;
  credentials: CredentialTools;
  providers: IdentityProvider[];           // 'local' always; others when configured
  names: NameRules;
  nameFilter: NameFilter;
  verifier: HumanVerifier;                 // WorkVerifier by default (8.4)
  mailer: Mailer;                          // NoMailer by default
  breachCheck?: BreachedPasswordCheck;     // none built in
  guests: GuestSessions;                   // hosted's; a fake in tests
  log: AccountsLog;                        // structured events, never a secret (12.1)
  random?: (n: number) => Uint8Array;      // node:crypto randomBytes by default; fixed in tests
  /** Missing or undefined: that part's methods answer notYet. src/compose.ts (M14-1) passes all three from their index files. */
  parts?: { moderation?: CreateModerationPart; rights?: CreateRightsPart; email?: CreateEmailPart };
}

/** Structured logging (12.1): one JSON object per line. Fields are ids, codes, counts and flags only; never a secret, a typed name or a message body. */
export interface AccountsLog { event(name: string, fields: Record<string, string | number | boolean | null>): void }

/** The operator (9.6). Calls throw AccountsAdminError: the operator is not a client. Every call is audited with name and OS user. */
export class AccountsAdminError extends Error {
  readonly code: 'notFound' | 'invalid' | 'conflict' | 'locked' | 'incomplete';
  constructor(code: AccountsAdminError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'AccountsAdminError';
  }
}
export interface Operator { name: string; osUser: string }
export interface AdminAccountView {
  account: A.Account; status: A.AccountStatus; nameHistory: NameHistoryRow[]; providers: A.ProviderId[];
  sessions: { live: number; lastUsedAt: string | null };
  sanctions: SanctionRow[]; appeals: AppealRow[]; reportsAbout: ReportRow[]; reportsBy: ReportRow[]; recentSecurity: A.AuditEvent[];
}
export interface NewSanction {
  kind: Exclude<A.SanctionKind, 'rename'>;
  reason: A.SanctionReason;
  /** Required for mute (at most 90 days) and suspend (at most a year); null for a permanent ban; ignored for warn. */
  until: string | null;
  message: string;
  note?: string;
  reports?: string[];
  /** In a running game: concede at once (CR 104.3a), through the change's detail.now. */
  now?: boolean;
}
/**
 * INTERFACE CHANGE (M14-6): each name of a collision carries `entry`, its names entry as the store keeps it (the key under the store's version, the
 * version), null for 6.2's static rules: the operator releases a banned or held entry by that key (releaseName's keyVersion), which keying a name
 * under the store's old version does not find when the new data folds it into another.
 *
 * INTERFACE CHANGE (M14-15, review A7): every entry is keyed again from the name it was made from (an account's current name; a held or banned key's
 * row in that account's name history, a forced rename's ban keeping its account; a reserved key's stored name), so a ban or a reservation still
 * covers its name under the new data. `unnamed` lists the entries with no name to key again (a reservation made before M14-15, an erased
 * account's ban or hold, a hold for nobody): they are keyed again from their old key, as before, so under data that folds differently the name
 * they stood for may be free; the operator reserves it again by name if it must stay taken.
 */
export interface RekeyCheck {
  from: number; to: number; changed: number;
  collisions: {
    key: string;
    names: { kind: string; name: string | null; account: A.AccountId | null; entry: { key: string; keyVersion: number } | null }[];
  }[];
  unnamed: { kind: string; account: A.AccountId | null; entry: { key: string; keyVersion: number } }[];
}
export interface AccountAdmin {
  find(op: Operator, text: string): Promise<A.Account[]>;
  show(op: Operator, account: A.AccountId): Promise<AdminAccountView | null>;
  reports(op: Operator, q: ReportQuery): Promise<ReportRow[]>;
  showReport(op: Operator, report: string): Promise<ReportRow | null>;
  closeReport(op: Operator, report: string, outcome: 'actioned' | 'dismissed', note?: string): Promise<void>;
  sanction(op: Operator, account: A.AccountId, s: NewSanction): Promise<A.SanctionView>;
  lift(op: Operator, sanction: string, note?: string): Promise<void>;
  forceRename(op: Operator, account: A.AccountId, reason: A.SanctionReason, to?: string): Promise<A.Account>;
  reserveName(op: Operator, name: string, note?: string): Promise<void>;
  /**
   * INTERFACE CHANGE (M14-6): with `keyVersion`, `name` is a names entry's key verbatim under that version, as rekeyCheck lists it (`entry`);
   * without it, a name, keyed under the store's version.
   */
  releaseName(op: Operator, name: string, keyVersion?: number): Promise<void>;
  revokeSessions(op: Operator, account: A.AccountId): Promise<number>;
  /** INTERFACE CHANGE (M14-6): `after`, a sanction id, for the next page (the store's appeals). */
  appeals(op: Operator, q: { open?: boolean; limit: number; after?: string }): Promise<AppealRow[]>;
  answerAppeal(op: Operator, sanction: string, answer: 'upheld' | 'lifted', message: string): Promise<void>;
  /** 'incomplete' unless every required holder is present, or partial is set (then AccountExport.missing lists them). */
  exportAccount(op: Operator, account: A.AccountId, partial: boolean): Promise<A.AccountExport>;
  /** now: purgeAt = now; the server's tick erases it with every holder (10.2). */
  deleteAccount(op: Operator, account: A.AccountId, reason: string, now: boolean): Promise<{ purgeAt: string }>;
  audit(op: Operator, account: A.AccountId, since?: string): Promise<A.AuditEvent[]>;
  rekeyCheck(op: Operator): Promise<RekeyCheck>;
  /** 'conflict' while rekeyCheck finds a collision. */
  rekey(op: Operator): Promise<{ changed: number }>;
  purge(op: Operator): Promise<AccountPurgeReport>;
}
