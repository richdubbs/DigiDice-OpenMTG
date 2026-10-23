/**
 * M14-13: the external-provider methods of the service (design 3.5, 3.8, 5.2, D25): "Sign in with DigiDice" through a RedirectProvider
 * (src/identity/shopify.ts on src/identity/oidc.ts), its flows and their binding to the connection, the callback, confirm, finish, link and unlink.
 * The one file under src/service/ that M14-13 owns; the core (./core.ts) builds these five methods with `createProviderPart`. A provider that is not
 * configured (no SHOPIFY_* settings) answers notYet (11.6), and so do passkeys (a ChallengeProvider) until M14-14.
 *
 * **Flows** live in memory only, never in the store: an id (`pf_` + 128 random bits, sent only to the connection that started it, never in a URL),
 * the provider's state, nonce and PKCE verifier, the intent, and the **binding**: the connection id and its guest session (intents signIn and
 * register) or the connection id and its account session (link and reauth). A flow lives providerFlowMs (10 minutes) from its start, whatever
 * happens to it; at most FLOWS_PER_CONNECTION per connection (a new one drops that connection's oldest), providerFlowsPerAddress per address key
 * of the connection that began it (with 8.1's factors for the IPv6 /56 and /48, and never more than a hundredth of the table at any of them) and
 * counterEntries in all (beyond the last two, rateLimited until the oldest that counts expires: a flood never drops anyone else's flow, and one
 * address key never holds more than a small share of the table). Every flow has the same lifetime, so each list's order is the order of expiry and
 * each call drops the expired ones from the front.
 *
 * - **beginProvider**: the fields; the session for link and reauth, and for a restricted status (3.8) any intent but RESTRICTED_PROVIDER_INTENTS
 *   ('reauth') answers the status's code; the intent must fit the connection (signIn and register from a guest connection, link and reauth
 *   from a signed-in one: else notAllowed), a proof only with link (else badMessage); the provider configured (else notYet); link only for an
 *   account without a credential of this provider, reauth only for one with it (else notAllowed); the limits (rateLimited): the flow table's and
 *   the address key's live flows, then the per-address bucket of 8.1 (providerBeginsPerHour, with the IPv6 aggregates); for link the proof (5.2:
 *   the password or a reauth ticket in the same request, after the limits; reauthRequired, badCredentials) last of the checks; then the provider's
 *   authorization (providerUnavailable when its issuer cannot be reached). The answer: the flow id and the URL the browser opens.
 * - **providerCallback** (GET /auth/shopify/callback, hosted's route at the sync): first the per-address bucket of 8.1 for the browser that brings it
 *   (providerCallbacksPerHour of `input.addressKey`, with the IPv6 aggregates; rateLimited spends nothing, so the same callback works after the
 *   wait), so no address key sends the token endpoint the client secret more often; then it finds the flow by `state`, which is spent at once (a
 *   replayed callback is refused, providerFailed); an `error` or a code of the wrong shape voids the flow; the provider exchanges the code and
 *   checks the ID token against the flow's nonce (providerFailed, providerUnavailable: the flow is void either way). Then it records the verified
 *   subject and its issuer and mints the **confirmation code**: 8 Crockford base32 characters (40 bits), valid providerConfirmMs (2 minutes,
 *   never beyond the flow), confirmTries (5) tries, kept as SHA-256 bound to the flow. **It issues nothing**: no session, link, registration or
 *   outcome reaches any connection; the code goes only into the callback page shown to whoever finished the authorization (D25).
 * - **confirmProvider**: the fields (a code of CONFIRM_CODE's shape after look-alikes are mapped, and a device proof of ACCOUNT_TOKEN's shape when
 *   sent, else badMessage); the session (link, reauth); the flow, live and **bound to this connection and this guest or account session**
 *   (anything else answers providerFailed, without comparing the code or counting a try: another connection cannot even spend the flow's tries);
 *   the reauth-only rule for a restricted status (a link begun before a sanction answers the status's code); busy while the guest session is
 *   seated, queued or waiting (5.3); a flow its callback has not reached yet answers providerFailed, without counting a try; then the code (the
 *   injected constant-time comparison; a wrong or expired one answers providerFailed, and the fifth wrong one voids the flow). Every one of those
 *   providerFailed answers is the same, code and message, so polling a flow tells nobody whether, or when, its authorization was finished.
 *   Only now is the outcome applied. The identity is (issuer, subject): a credential keeps the issuer in `meta.issuer`, and a subject a credential
 *   holds under another issuer (or none) is not that credential's. **signIn and register** sign the linked account in (a restricted session for
 *   an account that is not active, D24; the device proof sent is kept when signIn's check finds it valid for the account, else a new one is
 *   given), answer providerFailed for a subject held under another issuer, or answer needsName for a subject no account holds; **link** links the
 *   subject (providerLinked when it is another account's, or the account has one of this provider already), one link of an account at a time (a
 *   second right code meanwhile answers rateLimited and keeps its flow); **reauth** gives a one-use proof ticket for this session, 2 minutes
 *   (ServiceGuard.issueTicket), when the subject, under its issuer, is the account's own (else providerFailed). A reauth's authorization asked
 *   the provider for a fresh sign-in, and its callback was refused unless the ID token showed one (RedirectProvider.begin and finish get the
 *   intent; src/identity/oidc.ts).
 * - **registerWithProvider** (after needsName): from the same connection and guest session, within the flow's life: busy; the age gate (7.5, the
 *   same marks as register); the name (6.1-6.5); the guest-games claim (5.5); 8.1's registration pressure (as register runs it: above
 *   registerGlobalPerMinute work is asked, or with CAPTCHA=none busy wide keys are shed; the provider path has no work to give, so both answer
 *   rateLimited with a retry time) and the per-address registration limit; one atomic createAccount with the provider's credential and no password
 *   and no recovery codes (11.2: none for a provider-only account until it asks, which it does with a reauth ticket). A refused name, or a limit,
 *   leaves the flow for another try; success ends it.
 * - **unlinkProvider**: the session (outside RESTRICTED_CALLS, so a restricted session gets its status's code); an external provider (local is not
 *   unlinked here: badMessage); notFound without a credential of it; conflict while it is the last way to sign in (and the store's own
 *   compare-and-set keeps it so under a race); the proof (action 'unlink'); then the credential deleted, audited and notified.
 *
 * Logs carry the provider, the intent and fixed outcome words; never a state, nonce, verifier, code, ticket, token or subject.
 */
import { createHash } from 'node:crypto';
import {
  ACCOUNT_LIMITS, CONFIRM_CODE, DEFAULT_PRIVACY, defaultAvatar, normalizeRecoveryCode, oldEnough, sanctionRuns, type Account, type AccountResult,
  type AccountStatus, type AuditEvent, type ProviderIntent,
} from '../api';
import { checkAccountName } from '../api/names';
import { RECOVERY_ALPHABET } from '../api/passwords';
import { addressKeys } from '../abuse/address';
import type { IdentityProvider, RedirectProvider } from '../identity/api';
import { AUTH_CODE } from '../identity/oidc';
import { FLOW_ID, newAccountId, newFlowId } from '../ids';
import type { CredentialRow, NameHistoryRow, NewAccount } from '../store/api';
import { hostedTextProblem } from '../text';
import { sanctionView } from '../views';
import { RESTRICTED_PROVIDER_INTENTS, type AccountService, type Auth, type PartDeps, type ProviderOutcome, type RequestContext, type SignedIn } from './api';
import { clientText, entriesFor, IN_FLIGHT_RETRY_MS, isFree, iso, keysOf, reserved, selfViewOf, statusOf, type Core } from './context';
import { BUSY_IN_GAME, ERROR_MESSAGES, fail, ok, refuse, unwrap } from './result';
import { deviceField, issueSession, newDeviceRow, newSessionRow, noteSignIn, validDevice } from './sessions';

/** The five provider methods of AccountService. */
export type ProviderPart = Pick<AccountService, 'beginProvider' | 'providerCallback' | 'confirmProvider' | 'registerWithProvider' | 'unlinkProvider'>;
/**
 * What the core hands the provider methods: the parts' dependencies, the configured providers ('local' first) and the core itself, whose session,
 * name and registration steps the provider flows share (issueSession, keysOf, the age-gate marks, the guest sessions). INTERFACE CHANGE (M14-13):
 * `core` added; PartDeps alone has no name rules, word filter, guest sessions or session issuing.
 */
export interface ProviderPartDeps extends PartDeps { providers: readonly IdentityProvider[]; core: Core }

/** Live flows one connection may hold at once; a new one drops the connection's oldest. */
export const FLOWS_PER_CONNECTION = 3;

const EXTERNAL = ['shopify', 'passkey'] as const;
const INTENTS: readonly ProviderIntent[] = ['signIn', 'register', 'link', 'reauth'];
/** A state as the service accepts one from a provider and from the callback. */
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const AUTHORIZE_URL_MAX = 8_192;
/** While 8.1's registration pressure asks for work, a provider registration (which carries none) waits a minute: the window registerGlobalPerMinute counts. */
const REGISTRATION_PRESSURE_RETRY_MS = 60_000;
const SUBJECT_MAX = 255;
/** An issuer as a redirect provider names it (an HTTPS URL, OIDC's `iss`). */
const ISSUER_MAX = 2_048;

const WRONG_CODE = 'The code is not right or has expired. Please start again if it keeps failing.';
const ALREADY_LINKED = 'This sign-in method is already linked to your account.';
const NOT_LINKED = 'This sign-in method is not linked to your account.';
/** Only a provider-only account meets it, and such an account cannot set a password (no call takes a reauth ticket for one yet): it links another way. */
const LAST_WAY = 'This is your only way to sign in. Link another way to sign in first.';

const isGuestIntent = (i: ProviderIntent): boolean => i === 'signIn' || i === 'register';

/**
 * A flow's stage: started (no callback yet), calling (the provider is checking the callback), called (the code minted), confirming (the right code
 * is being applied), named (needsName answered: registerWithProvider next), registering.
 */
type Stage = 'started' | 'calling' | 'called' | 'confirming' | 'named' | 'registering';

interface Flow {
  id: string;
  provider: RedirectProvider;
  intent: ProviderIntent;
  state: string;
  nonce: string;
  verifier: string;
  connection: string;
  /** The canonical keys of the address key that began it (src/abuse/address.ts, narrowest first): the live-flow caps count by them. */
  addresses: readonly string[];
  /** signIn and register: the connection's guest session (null when it had none). */
  guestSession: string | null;
  /** link and reauth: the account session. */
  auth: Auth | null;
  expiresAt: number;
  stage: Stage;
  subject: string | null;
  /** The issuer the provider verified the subject under (VerifiedIdentity.issuer): (issuer, subject) is the identity. */
  issuer: string | null;
  codeHash: Uint8Array | null;
  codeExpiresAt: number;
  tries: number;
}

/** A live-flow cap: an address key's canonical key at one level (/32, /64, /56, /48 or opaque) and the flows it may hold at once. */
interface AddressCap { key: string; max: number }

/** The flows in memory (see the header): by id, by state (until the callback spends it), by connection and by address key at each level. */
class FlowTable {
  private readonly byId = new Map<string, Flow>();
  private readonly byState = new Map<string, Flow>();
  private readonly byConnection = new Map<string, Flow[]>();
  private readonly byAddress = new Map<string, Flow[]>();
  /** `max`: the flows in all (counterEntries); `idleMs`: the wait of a cap of 0, which no expiry ever frees (counterFullRetryMs). */
  constructor(private readonly max: number, private readonly idleMs: number) {}

  /** Drops the expired flows from the front (every flow lives the same time, so the front expires first). */
  sweep(t: number): void {
    for (const f of this.byId.values()) {
      if (f.expiresAt > t) break;
      this.drop(f);
    }
  }

  /**
   * Milliseconds until a flow of `connection` from an address key with these caps can be added (0: now): the table's cap and each level's, not
   * counting the flow the add would drop (the connection's oldest beyond FLOWS_PER_CONNECTION). The wait is until the oldest flow that counts
   * expires; the longest of them.
   */
  waitMs(connection: string, caps: readonly AddressCap[], t: number): number {
    const mine = this.byConnection.get(connection) ?? [];
    const drops = new Set(mine.slice(0, Math.max(0, mine.length - (FLOWS_PER_CONNECTION - 1))));
    let wait = 0;
    const full = (held: number, max: number, oldest: Flow | undefined) => {
      if (held < max) return;
      wait = Math.max(wait, oldest === undefined ? this.idleMs : Math.max(1, oldest.expiresAt - t));
    };
    let oldest: Flow | undefined;
    for (const f of this.byId.values()) {
      if (!drops.has(f)) {
        oldest = f;
        break;
      }
    }
    full(this.byId.size - drops.size, this.max, oldest);
    for (const c of caps) {
      const held = (this.byAddress.get(c.key) ?? []).filter((f) => !drops.has(f));
      full(held.length, c.max, held[0]);
    }
    return wait;
  }

  hasState(state: string): boolean {
    return this.byState.has(state);
  }

  add(f: Flow): void {
    // the connection's oldest beyond the cap (drop replaces the connection's list, so it is read again each time)
    for (let mine = this.byConnection.get(f.connection) ?? []; mine.length >= FLOWS_PER_CONNECTION; mine = this.byConnection.get(f.connection) ?? []) {
      this.drop(mine[0]!);
    }
    this.byId.set(f.id, f);
    this.byState.set(f.state, f);
    this.byConnection.set(f.connection, [...(this.byConnection.get(f.connection) ?? []), f]);
    for (const k of f.addresses) this.byAddress.set(k, [...(this.byAddress.get(k) ?? []), f]);
  }

  /** The live flow of an id (an expired one is dropped). */
  live(id: string, t: number): Flow | null {
    const f = this.byId.get(id);
    if (f === undefined) return null;
    if (f.expiresAt <= t) {
      this.drop(f);
      return null;
    }
    return f;
  }

  /** The flow a state names, the state spent at once (one use). */
  takeState(state: string): Flow | null {
    const f = this.byState.get(state);
    if (f === undefined) return null;
    this.byState.delete(state);
    return f;
  }

  holds(f: Flow): boolean {
    return this.byId.get(f.id) === f;
  }

  drop(f: Flow): void {
    if (this.byId.get(f.id) === f) this.byId.delete(f.id);
    if (this.byState.get(f.state) === f) this.byState.delete(f.state);
    without(this.byConnection, f.connection, f);
    for (const k of f.addresses) without(this.byAddress, k, f);
  }
}

/** Takes `f` out of the list of `key` (a list left empty goes). */
function without(map: Map<string, Flow[]>, key: string, f: Flow): void {
  const list = map.get(key);
  if (list === undefined) return;
  const rest = list.filter((x) => x !== f);
  if (rest.length > 0) map.set(key, rest);
  else map.delete(key);
}

/** A credential of a redirect provider is the identity (issuer, subject): its meta.issuer must be the one the provider verified the subject under. */
function sameIssuer(c: CredentialRow, issuer: string): boolean {
  return typeof c.meta['issuer'] === 'string' && c.meta['issuer'] === issuer;
}

/** A confirmation code: 40 random bits as 8 Crockford base32 characters (CONFIRM_CODE). */
function newConfirmCode(random: (n: number) => Uint8Array): string {
  const b = random(5);
  if (!(b instanceof Uint8Array) || b.length < 5) throw new RangeError('the random source gave too few bytes');
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + b[i]!;
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = RECOVERY_ALPHABET[n % 32]! + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/** The code as the flow keeps it: SHA-256 bound to the flow's id. */
function codeHash(flow: string, code: string): Uint8Array {
  return createHash('sha256').update(`openmtg/provider-confirm\n${flow}\n${code}`, 'utf8').digest();
}

function birthField(v: unknown, now: Date): { year: number; month: number } {
  if (typeof v !== 'object' || v === null) refuse('badMessage');
  const { year, month } = v as { year: unknown; month: unknown };
  if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > now.getUTCFullYear()) refuse('badMessage');
  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) refuse('badMessage');
  return { year: year as number, month: month as number };
}

export function createProviderPart(deps: ProviderPartDeps): ProviderPart {
  const { core } = deps;
  const flows = new FlowTable(core.limits.counterEntries, core.limits.counterFullRetryMs);

  /**
   * The live-flow caps of an address key (see the header): providerFlowsPerAddress for the /32, /64 or opaque key, prefix56Factor and
   * prefix48Factor times it for the IPv6 /56 and /48 (8.1), each at most a hundredth of the table (at least 1), whatever the configuration.
   */
  function addressCaps(addressKey: string): AddressCap[] {
    const share = Math.max(1, Math.floor(core.limits.counterEntries / 100));
    const factors = [1, core.limits.prefix56Factor, core.limits.prefix48Factor];
    return addressKeys(addressKey).all.map((key, i) => ({ key, max: Math.min(share, core.limits.providerFlowsPerAddress * factors[i]!) }));
  }

  /** The configured redirect provider of an id, or null (not configured; passkeys until M14-14). */
  function redirectProvider(id: string): RedirectProvider | null {
    const p = deps.providers.find((x) => x.id === id);
    return p !== undefined && p.kind === 'redirect' ? p : null;
  }

  /**
   * The status's answer for a call this status does not allow, exactly as ServiceGuard.session gives it (./guard.ts): deletionPending, or suspended
   * or banned with the running sanction that sets the status (the one that ends last) and its appeal, as SelfView shows it.
   */
  async function statusAnswer(a: Account, status: Exclude<AccountStatus, 'active'>, now: Date) {
    if (status === 'deleting') return fail('deletionPending');
    const nowIso = iso(now);
    const kind = status === 'banned' ? 'ban' : 'suspend';
    const running = (await core.store.sanctionsOf(a.id)).filter((s) => s.kind === kind && sanctionRuns(s, nowIso));
    running.sort((x, y) => (x.until === null ? 1 : y.until === null ? -1 : Date.parse(x.until) - Date.parse(y.until)));
    const s = running[running.length - 1];
    if (s === undefined) return fail(status);
    const appeal = (await core.store.appeals({ account: a.id, limit: 10_000 })).find((x) => x.sanction === s.id) ?? null;
    return fail(status, { sanction: sanctionView(s, appeal) });
  }

  const flowFailed = (message?: string) => fail('providerFailed', message !== undefined ? { message } : {});
  /**
   * confirmProvider's one answer for every flow it cannot confirm with this code: none (or not this connection's), no callback yet, a code expired
   * or wrong, a flow voided or already confirmed. A phisher polling its own flow learns nothing, not even when the victim finished (review of
   * M14-13).
   */
  const notConfirmed = () => flowFailed(WRONG_CODE);

  /** The flow is bound to this connection and to this guest session (signIn, register) or this account session (link, reauth). */
  function bound(f: Flow, ctx: RequestContext, auth: Auth | null): boolean {
    if (f.connection !== ctx.connection) return false;
    if (isGuestIntent(f.intent)) return auth === null && f.auth === null && f.guestSession === ctx.guestSession;
    return auth !== null && f.auth !== null && f.auth.account === auth.account && f.auth.session === auth.session;
  }

  // ---- begin ---------------------------------------------------------------------------------------------------------------------------------------

  const beginProvider: ProviderPart['beginProvider'] = async (ctx, provider, intent, auth, proof) => {
    if (typeof provider !== 'string' || !(EXTERNAL as readonly string[]).includes(provider)) return fail('badMessage');
    if (typeof intent !== 'string' || !INTENTS.includes(intent)) return fail('badMessage');
    if (auth === undefined) return fail('badMessage');
    const now = ctx.now;
    let account: Account | null = null;
    if (auth !== null) {
      const s = unwrap(await core.guard.session(ctx, auth, 'beginProvider'));
      // 3.8: a restricted session begins a reauth only (RESTRICTED_PROVIDER_INTENTS); anything else answers the status's code
      if (s.status !== 'active' && !RESTRICTED_PROVIDER_INTENTS.includes(intent)) return statusAnswer(s.account, s.status, now);
      account = s.account;
    }
    if (isGuestIntent(intent) !== (auth === null)) return fail('notAllowed');
    if (intent !== 'link' && proof !== undefined) return fail('badMessage');
    const p = redirectProvider(provider);
    if (p === null) return fail('notYet');
    if (account !== null) {
      const linked = (await core.store.credentials(account.id)).some((c) => c.provider === p.id);
      if (intent === 'link' && linked) return fail('notAllowed', { message: ALREADY_LINKED });
      if (intent === 'reauth' && !linked) return fail('notAllowed', { message: NOT_LINKED });
    }
    // the limits before the proof (5.2), so a request they refuse never checks a password or spends a ticket: the table's and the address key's
    // live flows first (they take nothing), then 8.1's bucket of the address key
    const t = now.getTime();
    flows.sweep(t);
    const caps = addressCaps(ctx.addressKey);
    const wait = flows.waitMs(ctx.connection, caps, t);
    if (wait > 0) return fail('rateLimited', { retryAfterMs: wait });
    const took = core.rate.take('providerBegin', { addressKey: ctx.addressKey }, now);
    if (!took.ok) return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
    // 5.2: linking is a way into the account: the proof in the same request, after every other check and before anything is made
    if (intent === 'link') unwrap(await core.guard.proof(ctx, auth!, proof, 'link'));
    let begun: Awaited<ReturnType<RedirectProvider['begin']>>;
    try {
      begun = await p.begin(now, intent);
    } catch (e) {
      core.log.event('accounts.provider.unavailable', { provider: p.id, step: 'begin', error: e instanceof Error ? e.name : 'error' });
      return fail('providerUnavailable');
    }
    const shaped =
      typeof begun === 'object' && begun !== null && typeof begun.state === 'string' && STATE.test(begun.state) && typeof begun.nonce === 'string' &&
      begun.nonce.length > 0 && typeof begun.verifier === 'string' && begun.verifier.length > 0 && typeof begun.authorizeUrl === 'string' &&
      begun.authorizeUrl.startsWith('https://') && begun.authorizeUrl.length <= AUTHORIZE_URL_MAX;
    if (!shaped || flows.hasState(begun.state)) {
      core.log.event('accounts.provider.unavailable', { provider: p.id, step: 'begin', error: 'shape' });
      return fail('providerUnavailable');
    }
    // the table or the address key's flows may have filled while the provider answered
    const late = flows.waitMs(ctx.connection, caps, t);
    if (late > 0) return fail('rateLimited', { retryAfterMs: late });
    const flow: Flow = {
      id: newFlowId(core.random), provider: p, intent, state: begun.state, nonce: begun.nonce, verifier: begun.verifier, connection: ctx.connection,
      addresses: caps.map((c) => c.key), guestSession: auth === null ? ctx.guestSession : null,
      auth: auth !== null ? { account: auth.account, session: auth.session } : null,
      expiresAt: t + core.timing.providerFlowMs, stage: 'started', subject: null, issuer: null, codeHash: null, codeExpiresAt: 0, tries: 0,
    };
    flows.add(flow);
    core.log.event('accounts.provider.begin', { provider: p.id, intent });
    return ok({ flow: flow.id, authorizeUrl: begun.authorizeUrl });
  };

  // ---- the callback --------------------------------------------------------------------------------------------------------------------------------

  const providerCallback: ProviderPart['providerCallback'] = async (input) => {
    if (typeof input !== 'object' || input === null || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) return fail('badMessage');
    if (typeof input.addressKey !== 'string' || input.addressKey.length === 0 || input.addressKey.length > 128) return fail('badMessage');
    const now = input.now;
    const t = now.getTime();
    // 8.1: the bucket of the browser's address key before anything is looked up or exchanged (refused, the state is not spent)
    const took = core.rate.take('providerCallback', { addressKey: input.addressKey }, now);
    if (!took.ok) {
      core.log.event('accounts.provider.callback', { outcome: 'rateLimited' });
      return fail('rateLimited', { retryAfterMs: took.retryAfterMs });
    }
    flows.sweep(t);
    // one use: the state is spent here, whatever follows (a replayed callback finds nothing)
    const flow = typeof input.state === 'string' && STATE.test(input.state) ? flows.takeState(input.state) : null;
    if (flow === null) {
      core.log.event('accounts.provider.callback', { outcome: 'noFlow' });
      return flowFailed();
    }
    const voided = (outcome: string, code: 'providerFailed' | 'providerUnavailable' = 'providerFailed') => {
      flows.drop(flow);
      core.log.event('accounts.provider.callback', { provider: flow.provider.id, outcome });
      return fail(code);
    };
    if (!flows.holds(flow) || flow.expiresAt <= t || flow.stage !== 'started') return voided('expired');
    if (input.error !== undefined) return voided('error');
    // the callback's code before the provider looks at it (it checks it again)
    if (typeof input.code !== 'string' || !AUTH_CODE.test(input.code)) return voided('code');
    flow.stage = 'calling';
    let r: Awaited<ReturnType<RedirectProvider['finish']>>;
    try {
      r = await flow.provider.finish(input.code, { nonce: flow.nonce, verifier: flow.verifier, intent: flow.intent }, now);
    } catch (e) {
      core.log.event('accounts.provider.unavailable', { provider: flow.provider.id, step: 'callback', error: e instanceof Error ? e.name : 'error' });
      return voided('unavailable', 'providerUnavailable');
    }
    if (!r.ok) return voided(r.code, r.code === 'providerUnavailable' ? 'providerUnavailable' : 'providerFailed');
    const subject = r.identity?.subject;
    const issuer = r.identity?.issuer;
    if (
      r.identity?.provider !== flow.provider.id || typeof subject !== 'string' || subject.length === 0 || subject.length > SUBJECT_MAX ||
      hostedTextProblem(subject) !== null || typeof issuer !== 'string' || issuer.length === 0 || issuer.length > ISSUER_MAX ||
      hostedTextProblem(issuer) !== null
    ) {
      return voided('identity');
    }
    // the connection may have started newer flows meanwhile and dropped this one
    if (!flows.holds(flow)) return voided('expired');
    const code = newConfirmCode(core.random);
    flow.subject = subject;
    flow.issuer = issuer;
    flow.codeHash = codeHash(flow.id, code);
    flow.codeExpiresAt = Math.min(t + core.timing.providerConfirmMs, flow.expiresAt);
    flow.tries = 0;
    flow.stage = 'called';
    core.log.event('accounts.provider.callback', { provider: flow.provider.id, outcome: 'ok' });
    return ok({ state: flow.state, code, expiresAt: new Date(flow.codeExpiresAt).toISOString() });
  };

  // ---- confirm -------------------------------------------------------------------------------------------------------------------------------------

  const confirmProvider: ProviderPart['confirmProvider'] = async (ctx, auth, flowId, code, device) => {
    if (typeof flowId !== 'string' || !FLOW_ID.test(flowId)) return fail('badMessage');
    const typed = typeof code === 'string' ? normalizeRecoveryCode(code) : null;
    if (typed === null || !CONFIRM_CODE.test(typed)) return fail('badMessage');
    if (auth === undefined) return fail('badMessage');
    const deviceProof = deviceField(device);
    const now = ctx.now;
    const t = now.getTime();
    let session: { account: Account; status: AccountStatus } | null = null;
    if (auth !== null) session = unwrap(await core.guard.session(ctx, auth, 'confirmProvider'));
    flows.sweep(t);
    const flow = flows.live(flowId, t);
    // another connection, another guest or account session: refused, without comparing the code or counting a try
    if (flow === null || !bound(flow, ctx, auth)) return notConfirmed();
    // 3.8: a restricted session confirms a reauth only (a link begun before a sanction answers the status's code)
    if (session !== null && session.status !== 'active' && !RESTRICTED_PROVIDER_INTENTS.includes(flow.intent)) {
      return statusAnswer(session.account, session.status, now);
    }
    if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });
    // no callback yet (or the flow is past its code): the same answer as a wrong code, so polling tells nobody when the authorization finished
    if (flow.stage !== 'called' || flow.codeHash === null || flow.subject === null || flow.issuer === null) return notConfirmed();
    if (flow.codeExpiresAt <= t) {
      flows.drop(flow);
      return notConfirmed();
    }
    if (!core.credentials.equal(codeHash(flow.id, typed), flow.codeHash)) {
      flow.tries += 1;
      if (flow.tries >= ACCOUNT_LIMITS.confirmTries) {
        flows.drop(flow);
        core.log.event('accounts.provider.confirm', { provider: flow.provider.id, outcome: 'voided' });
      }
      return notConfirmed();
    }
    // the right code. A link holds its account's lock while it runs: one login of a provider per account, and two link flows of one account
    // confirmed at once would each find none yet. A second meanwhile answers rateLimited and keeps its flow, so the same code works after it
    const lock = flow.intent === 'link' ? `link:${auth!.account}` : null;
    if (lock !== null && !core.locks.enter(lock)) return fail('rateLimited', { retryAfterMs: IN_FLIGHT_RETRY_MS });
    // from here on the flow is this call's (a second confirm meanwhile finds it confirming)
    flow.stage = 'confirming';
    const subject = flow.subject;
    const issuer = flow.issuer;
    const provider = flow.provider.id;
    try {
      if (isGuestIntent(flow.intent)) {
        const cred = await core.store.credentialBySubject(provider, subject);
        // the subject under another issuer is another identity: it never signs in to the account that holds it, nor registers again
        if (cred !== null && !sameIssuer(cred, issuer)) {
          flows.drop(flow);
          core.log.event('accounts.provider.confirm', { provider, outcome: 'issuer' });
          return flowFailed();
        }
        if (cred === null) {
          if (!flows.holds(flow)) return flowFailed();
          flow.stage = 'named';
          core.log.event('accounts.provider.confirm', { provider, outcome: 'needsName' });
          return ok<ProviderOutcome>({ kind: 'needsName', flow: flow.id });
        }
        flows.drop(flow);
        const account = await core.store.account(cred.account);
        if (account === null) return flowFailed();
        return ok<ProviderOutcome>({ kind: 'signedIn', signedIn: await signInWith(ctx, account, cred, deviceProof) });
      }
      flows.drop(flow);
      if (flow.intent === 'link') return await linkTo(ctx, auth!, provider, subject, issuer);
      // reauth: the subject, under its issuer, must be the account's own
      const own = (await core.store.credentials(auth!.account)).find((c) => c.provider === provider && c.subject === subject && sameIssuer(c, issuer));
      if (own === undefined) return flowFailed(NOT_LINKED);
      await core.store.putCredential({ ...own, lastUsedAt: iso(now) }, own.secret).catch(() => undefined);
      core.log.event('accounts.provider.confirm', { provider, outcome: 'reauthed' });
      return ok<ProviderOutcome>({ kind: 'reauthed', ticket: core.guard.issueTicket(auth!, now) });
    } catch (e) {
      flows.drop(flow);
      throw e;
    } finally {
      if (lock !== null) core.locks.leave(lock);
    }
  };

  /**
   * A confirmed provider sign-in (3.5): a session, restricted when the account is not active (D24). The device proof sent, when signIn's validDevice
   * finds it valid for the account, is kept (and its failures cleared, as a sign-in does); otherwise a new one is given (8.3).
   */
  async function signInWith(ctx: RequestContext, account: Account, cred: CredentialRow, deviceProof: string | undefined): Promise<SignedIn> {
    const now = ctx.now;
    const nowIso = iso(now);
    const status = await statusOf(core, account, now);
    const sent = await validDevice(core, deviceProof, account, now);
    const issued = await issueSession(core, ctx, account, cred.provider, sent !== null && deviceProof !== undefined ? { proof: deviceProof, row: sent } : null);
    await core.store.putCredential({ ...cred, lastUsedAt: nowIso }, cred.secret).catch(() => undefined);
    const updated = (await noteSignIn(core, account.id, now)) ?? account;
    core.audit.record(
      {
        kind: 'signedIn', account: account.id, actor: 'self', session: issued.row.id, addressKey: ctx.addressKey,
        details: { provider: cred.provider, device: sent !== null, restricted: status !== 'active' },
      },
      now,
    );
    return { account: await selfViewOf(core, updated, now), auth: issued.auth, token: issued.token, rotation: 0, device: issued.device };
  }

  /**
   * A confirmed link (3.5), under the account's link lock (confirmProvider): the subject becomes a credential of the account, unless it is another
   * account's or the account has one of this provider.
   */
  async function linkTo(
    ctx: RequestContext, auth: Auth, provider: RedirectProvider['id'], subject: string, issuer: string,
  ): Promise<AccountResult<ProviderOutcome>> {
    const now = ctx.now;
    const nowIso = iso(now);
    if ((await core.store.credentials(auth.account)).some((c) => c.provider === provider)) return fail('providerLinked', { message: ALREADY_LINKED });
    if ((await core.store.credentialBySubject(provider, subject)) !== null) return fail('providerLinked');
    try {
      await core.store.putCredential({ account: auth.account, provider, subject, secret: null, meta: { issuer }, createdAt: nowIso, lastUsedAt: nowIso });
    } catch (e) {
      // linked to another account meanwhile
      if ((e as { code?: unknown })?.code === 'exists') return fail('providerLinked');
      throw e;
    }
    core.audit.record({ kind: 'providerLinked', account: auth.account, actor: 'self', session: auth.session, addressKey: ctx.addressKey, details: { provider } }, now);
    await core.email?.notify(auth.account, 'providerLinked').catch(() => undefined);
    core.log.event('accounts.provider.confirm', { provider, outcome: 'linked' });
    const a = await core.store.account(auth.account);
    if (a === null) return fail('sessionExpired');
    return ok({ kind: 'linked', account: await selfViewOf(core, a, now) });
  }

  // ---- finish (registration after needsName) ----------------------------------------------------------------------------------------------------

  const registerWithProvider: ProviderPart['registerWithProvider'] = async (ctx, flowId, req) => {
    if (typeof flowId !== 'string' || !FLOW_ID.test(flowId)) return fail('badMessage');
    if (typeof req !== 'object' || req === null) return fail('badMessage');
    const now = ctx.now;
    const t = now.getTime();
    const nameRaw = clientText(req.name, ACCOUNT_LIMITS.nameRawMax);
    const birth = birthField(req.birth, now);
    if (typeof req.claimGuest !== 'boolean') return fail('badMessage');
    flows.sweep(t);
    const flow = flows.live(flowId, t);
    // only the connection and guest session that started the flow, after needsName
    if (flow === null || !isGuestIntent(flow.intent) || !bound(flow, ctx, null)) return flowFailed();
    if (flow.stage === 'registering') return fail('rateLimited', { retryAfterMs: IN_FLIGHT_RETRY_MS });
    if (flow.stage !== 'named' || flow.subject === null || flow.issuer === null) return flowFailed();
    if (ctx.guestBusy) return fail('busy', { message: BUSY_IN_GAME });
    flow.stage = 'registering';
    let done = false;
    try {
      const r = await registerFrom(ctx, flow, flow.subject, flow.issuer, nameRaw, birth, req.claimGuest);
      done = r.done;
      return r.result;
    } finally {
      if (done) flows.drop(flow);
      else if (flows.holds(flow)) flow.stage = 'named';
    }
  };

  /** The registration of 3.5 "Accounts": `done` ends the flow (a success, or a subject linked meanwhile); any other refusal leaves it for another try. */
  async function registerFrom(
    ctx: RequestContext, flow: Flow, subject: string, issuer: string, nameRaw: string, birth: { year: number; month: number }, claimGuest: boolean,
  ): Promise<{ done: boolean; result: AccountResult<SignedIn> }> {
    const now = ctx.now;
    const nowIso = iso(now);
    const refused = (result: AccountResult<SignedIn>, done = false) => ({ done, result });
    // the age gate (7.5), with register's marks: a refusal marks this connection and guest session for 24 hours
    const marks = [`c:${ctx.connection}`, ...(ctx.guestSession !== null ? [`g:${ctx.guestSession}`] : [])];
    if (core.ageMarks.marked(marks, now)) return refused(fail('ageGate'));
    if (!oldEnough(birth, core.config.minAge, nowIso)) {
      core.ageMarks.mark(marks, now);
      return refused(fail('ageGate'));
    }
    // the name (6.1-6.5)
    const checked = checkAccountName(nameRaw);
    if (!checked.ok) return refused(fail('nameInvalid', { details: [checked.problem], message: checked.message }));
    const display = checked.display;
    const keys = await keysOf(core, display);
    for (const k of [keys.primary, ...keys.others]) if (reserved(core, k.key, display)) return refused(fail('nameReserved'));
    if (!core.nameFilter.check({ display, key: keys.primary.key }).ok) return refused(fail('nameFiltered'));
    if ((await entriesFor(core, keys)).some((e) => !isFree(e, now))) return refused(fail('nameTaken'));
    // the claim (5.5): only the connection's own guest session, and only when ticked
    const claim = claimGuest ? ctx.guestSession : null;
    if (claimGuest) {
      if (claim === null) return refused(fail('badMessage'));
      if (await core.guests.busy(claim)) return refused(fail('busy', { message: BUSY_IN_GAME }));
    }
    // 8.1, as register runs it: the registration pressure (work above registerGlobalPerMinute, or with CAPTCHA=none the wide keys shed), then the
    // per-address registration limit. No hash here (the provider's authorization came first), and no work or CAPTCHA field: a decision that asks
    // for work, or sheds, answers rateLimited with a retry time
    const pressure = core.rate.signIn.registration(ctx.addressKey, 0, now);
    if (!pressure.go) {
      core.log.event('accounts.provider.register', { provider: flow.provider.id, outcome: pressure.code === 'rateLimited' ? 'shed' : 'pressure' });
      return refused(fail('rateLimited', { retryAfterMs: pressure.code === 'rateLimited' ? pressure.retryAfterMs : REGISTRATION_PRESSURE_RETRY_MS }));
    }
    const took = core.rate.take('register', { addressKey: ctx.addressKey }, now);
    if (!took.ok) return refused(fail('rateLimited', { retryAfterMs: took.retryAfterMs }));

    const provider = flow.provider.id;
    const id = newAccountId(core.random);
    const device = core.credentials.newDeviceProof();
    const { row: session, token } = newSessionRow(core, id, provider, ctx, device.hash);
    const account: Account = {
      id, name: display, nameKey: keys.primary.key, keyVersion: keys.primary.version, avatar: defaultAvatar(id), privacy: { ...DEFAULT_PRIVACY },
      email: null, ageGate: { minAge: core.config.minAge, passedAt: nowIso }, createdAt: nowIso, lastSignInAt: nowIso, renamedAt: null,
      freeRename: false, deletion: null, inactiveNoticeAt: null, version: 1,
    };
    const history: NameHistoryRow = {
      account: id, name: display, key: keys.primary.key, keyVersion: keys.primary.version, from: nowIso, to: null, cause: 'register', redacted: false,
    };
    const audit: AuditEvent[] = [
      core.audit.build({ kind: 'registered', account: id, actor: 'self', session: session.id, addressKey: ctx.addressKey, details: { provider, claimed: claim !== null } }, now),
    ];
    if (claim !== null) {
      audit.push(core.audit.build({ kind: 'guestClaimed', account: id, actor: 'self', session: session.id, addressKey: ctx.addressKey, details: { guestSession: claim, games: 0 } }, now));
    }
    const n: NewAccount = {
      account, credential: { account: id, provider, subject, secret: null, meta: { issuer }, createdAt: nowIso, lastUsedAt: nowIso }, recovery: [], history,
      claim: claim !== null ? { session: claim, account: id, claimedAt: nowIso } : null, session, device: newDeviceRow(id, device.hash, now), audit,
    };
    try {
      await core.store.createAccount(n, nowIso);
    } catch (e) {
      if ((e as { code?: unknown })?.code !== 'exists') throw e;
      // a registration racing this one won the key, the subject was linked meanwhile, or the guest session was claimed
      if (!isFree(await core.store.nameEntry(keys.primary.key, keys.primary.version), now)) return refused(fail('nameTaken'));
      if ((await core.store.credentialBySubject(provider, subject)) !== null) return refused(flowFailed(ERROR_MESSAGES.providerLinked), true);
      if (claim !== null) return refused(fail('alreadyClaimed'));
      throw e;
    }
    core.rate.signIn.registered(ctx.addressKey, now);
    if (claim !== null) {
      await core.guests.retire(claim).catch((err: unknown) => core.log.event('accounts.claim.retire', { account: id, error: err instanceof Error ? err.name : 'error' }));
    }
    core.log.event('accounts.provider.registered', { provider });
    const created = (await core.store.account(id)) ?? account;
    return { done: true, result: ok({ account: await selfViewOf(core, created, now), auth: { account: id, session: session.id }, token, rotation: 0, device: device.proof }) };
  }

  // ---- unlink --------------------------------------------------------------------------------------------------------------------------------------

  const unlinkProvider: ProviderPart['unlinkProvider'] = async (ctx, auth, provider, proof) => {
    const s = unwrap(await core.guard.session(ctx, auth, 'unlinkProvider'));
    if (typeof provider !== 'string' || !(EXTERNAL as readonly string[]).includes(provider)) return fail('badMessage');
    const now = ctx.now;
    const all = await core.store.credentials(s.account.id);
    const mine = all.filter((c) => c.provider === provider);
    if (mine.length === 0) return fail('notFound');
    // 3.1: an account always keeps a way to sign in (a password, or another linked provider)
    if (all.length === mine.length) return fail('conflict', { message: LAST_WAY });
    unwrap(await core.guard.proof(ctx, auth, proof, 'unlink'));
    for (const c of mine) {
      try {
        await core.store.deleteCredential(s.account.id, c.provider, c.subject);
      } catch (e) {
        const code = (e as { code?: unknown })?.code;
        // the other way was removed meanwhile: this one stays (the store's compare-and-set)
        if (code === 'conflict') return fail('conflict', { message: LAST_WAY });
        if (code !== 'notFound') throw e;
      }
    }
    core.audit.record({ kind: 'providerUnlinked', account: s.account.id, actor: 'self', session: s.row.id, addressKey: ctx.addressKey, details: { provider: mine[0]!.provider } }, now);
    await core.email?.notify(s.account.id, 'providerUnlinked').catch(() => undefined);
    const a = await core.store.account(s.account.id);
    if (a === null) return fail('sessionExpired');
    return ok(await selfViewOf(core, a, now));
  };

  return { beginProvider, providerCallback, confirmProvider, registerWithProvider, unlinkProvider };
}
