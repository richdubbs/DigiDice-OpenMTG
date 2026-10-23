/**
 * Shared fixtures of the M14-13 service tests (owner rule: in process, a fake clock, fixed inputs): M14-5's service set-up (the memory store, the
 * real name rules and credential tools, the fast hasher) with the Shopify provider on the fake issuer of ./issuer.ts, and the steps of a provider
 * flow: begin on a connection, the provider's authorization in some browser, the callback, confirm.
 */
import {
  createCredentialTools, createListNameFilter, createMemoryAccountStore, createNameRules, type AccountExport, type AccountId, type AccountService,
  type AccountsConfig, type AccountStore, type Auth, type CreateRightsPart, type PartDeps, type ProviderIntent, type Proof, type RedirectProvider,
  type RequestContext, type SanctionKind,
} from '@openmtg/accounts';
import { buildNoVerifier, buildWorkVerifier } from '../../src/abuse/work';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { createShopifyProvider, type ShopifyProvider } from '../../src/identity/shopify';
import { buildAccountService } from '../../src/service/core';
import {
  addressFor, BIRTH, Clock, configOf, ctxOf, DAY, equal, FakeGuests, fastDerive, fixedRandom, inRow, PW, spyHasher, value, type LogLine,
} from '../m14-5/support';
import { CLIENT_ID, CLIENT_SECRET, FakeIssuer, ISSUER, REDIRECT_URI } from './issuer';

export { BIRTH };

export interface ShopifySetup {
  service: AccountService;
  store: AccountStore;
  clock: Clock;
  guests: FakeGuests;
  issuer: FakeIssuer;
  shopify: ShopifyProvider;
  log: LogLine[];
  config: AccountsConfig;
  /** The PartDeps the rights part was given (the fake rights part captures them). */
  partDeps: { current: PartDeps | null };
  /**
   * Set: the provider the service holds reports this issuer for every verified subject instead of ISSUER, as after the host configured another
   * issuer (a changed shop id or issuer setting) whose subjects are the same strings.
   */
  otherIssuer: { current: string | null };
}

/**
 * A fake rights part (M14-7's seam) whose export only checks the session and the proof through the core's ServiceGuard: enough to show that a reauth
 * ticket is the proof a provider-only account gives (5.2), in a restricted session too (D24).
 */
export const proofOnlyRights: CreateRightsPart = (deps) => ({
  async exportData(ctx, auth, proof) {
    const s = await deps.guard.session(ctx, auth, 'exportData');
    if (!s.ok) return s;
    const p = await deps.guard.proof(ctx, auth, proof, 'export');
    if (!p.ok) return p;
    return { ok: true, value: { account: s.value.account.id } as unknown as AccountExport };
  },
  async deleteAccount() {
    return { ok: false, error: { code: 'notYet', message: 'fake' } };
  },
  async cancelDeletion() {
    return { ok: false, error: { code: 'notYet', message: 'fake' } };
  },
  addHolder() {},
  admin: {
    exportAccount: async () => {
      throw new Error('fake');
    },
    deleteAccount: async () => {
      throw new Error('fake');
    },
    purge: async () => {
      throw new Error('fake');
    },
  },
  async tick() {
    return { erased: 0, erasureRetries: 0, erasureBlocked: 0, inactiveNotified: 0, purged: null };
  },
});

export interface ShopifySetupOptions {
  env?: Record<string, string>;
  /** Leave the Shopify provider out (not configured). */
  noShopify?: boolean;
  rights?: CreateRightsPart;
  /** The built-in work verifier (CAPTCHA=work) instead of none. */
  work?: boolean;
}

export function setupShopify(o: ShopifySetupOptions = {}): ShopifySetup {
  const clock = new Clock();
  const config = configOf({ CAPTCHA: o.work ? 'work' : 'none', ...o.env });
  const random = fixedRandom('m14-13');
  const store = createMemoryAccountStore({ emailResetLiveCodes: config.limits.emailResetLiveCodes });
  const hasher = spyHasher(
    buildPasswordHasher(
      { scrypt: config.scrypt, concurrency: config.hashConcurrency, queue: config.hashQueue, peppers: config.peppers, random, equal },
      { derive: fastDerive, sleep: async () => undefined },
    ),
  );
  const credentials = createCredentialTools({ random, equal, peppers: config.peppers, passwordMin: config.passwordMin });
  const names = createNameRules({ reservedNamesText: null });
  const guests = new FakeGuests();
  const issuer = new FakeIssuer(clock.now);
  const log: LogLine[] = [];
  const sink = { event: (name: string, fields: LogLine['fields']) => log.push({ name, fields }) };
  const shopify = createShopifyProvider({
    shopId: '4242', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, issuer: ISSUER, fetch: issuer.fetch,
    random: fixedRandom('m14-13 shopify'), jwksRefetchMs: config.timing.jwksRefetchMs, log: sink,
  });
  const partDeps: { current: PartDeps | null } = { current: null };
  const otherIssuer: { current: string | null } = { current: null };
  const reported: RedirectProvider = {
    id: 'shopify', kind: 'redirect', begin: (now, intent) => shopify.begin(now, intent),
    async finish(code, flow, now) {
      const r = await shopify.finish(code, flow, now);
      return r.ok && otherIssuer.current !== null ? { ok: true, identity: { ...r.identity, issuer: otherIssuer.current } } : r;
    },
  };
  const rights = o.rights;
  const service = buildAccountService({
    store, config, hasher, credentials, providers: o.noShopify ? [] : [reported], names, nameFilter: createListNameFilter(null, names),
    verifier: o.work ? buildWorkVerifier({ random: fixedRandom('m14-13 work'), challengeMs: config.timing.workChallengeMs }) : buildNoVerifier(),
    mailer: { kind: 'none', send: async () => undefined }, guests, log: sink, random, now: clock.now,
    parts: {
      rights: rights === undefined ? undefined : (deps) => {
        partDeps.current = deps;
        return rights(deps);
      },
    },
  });
  return { service, store, clock, guests, issuer, shopify, log, config, partDeps, otherIssuer };
}

/** A guest connection's context: its own connection id, guest session and address key. */
export function guestCtx(s: ShopifySetup, connection = 'conn-a', guestSession: string | null = 'gs_guestA', over: Partial<RequestContext> = {}): RequestContext {
  return ctxOf(s.clock, { connection, guestSession, addressKey: '198.51.100.7', ...over });
}

/** A signed-in connection's context (no guest session). */
export function accountCtx(s: ShopifySetup, connection = 'conn-a', over: Partial<RequestContext> = {}): RequestContext {
  return ctxOf(s.clock, { connection, guestSession: null, addressKey: '198.51.100.7', ...over });
}

export interface Begun { flow: string; authorizeUrl: string }

/** beginProvider for Shopify; fails the test unless it answers ok. */
export async function begin(s: ShopifySetup, ctx: RequestContext, intent: ProviderIntent, auth: Auth | null = null, proof?: Proof): Promise<Begun> {
  const r = inRow('beginProvider', await s.service.beginProvider(ctx, 'shopify', intent, auth, proof));
  const v = value(r);
  return { flow: v.flow, authorizeUrl: v.authorizeUrl! };
}

/** The callback after `subject` authorized in some browser: the confirmation code the page shows there. */
export async function callback(s: ShopifySetup, b: Begun, subject: string, addressKey = '192.0.2.99'): Promise<{ state: string; code: string; expiresAt: string }> {
  const back = s.issuer.authorize(b.authorizeUrl, subject);
  return value(inRow('providerCallback', await s.service.providerCallback({ code: back.code, state: back.state, addressKey, now: s.clock.now() })));
}

/** The authorization's redirect (code and state) without calling back yet. */
export function authorized(s: ShopifySetup, b: Begun, subject: string): { code: string; state: string } {
  return s.issuer.authorize(b.authorizeUrl, subject);
}

/** A code of the right shape that the flow did not mint (one of a fixed list). */
export function wrongCode(right: string, i = 0): string {
  const list = ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD', 'EEEEEEEE', 'FFFFFFFF', 'GGGGGGGG'];
  const pick = list.filter((c) => c !== right);
  return pick[i % pick.length]!;
}

/** Registers a provider-only account for `subject` on a guest connection: begin, callback, confirm (needsName), finish. */
export async function registerWithShopify(s: ShopifySetup, subject: string, name: string, connection = `conn-${name}`) {
  const ctx = guestCtx(s, connection, `gs_${name}`);
  const b = await begin(s, ctx, 'signIn');
  const cb = await callback(s, b, subject);
  const confirmed = value(inRow('confirmProvider', await s.service.confirmProvider(ctx, null, b.flow, cb.code)));
  if (confirmed.kind !== 'needsName') throw new Error(`expected needsName, got ${confirmed.kind}`);
  return value(inRow('registerWithProvider', await s.service.registerWithProvider(ctx, b.flow, { name, birth: BIRTH, claimGuest: false })));
}

/** Registers `name` with a password from its own guest connection. */
export async function registerLocal(s: ShopifySetup, name: string, password = PW) {
  const ctx = guestCtx(s, `conn-${name}`, null, { addressKey: addressFor(`register ${name}`) });
  return value(inRow('register', await s.service.register(ctx, { name, password, birth: BIRTH, claimGuest: false })));
}

let sanctionSeq = 0;
/** A running sanction of `kind` from now (until null: permanent), written straight to the store as the operator would. */
export async function sanction(s: ShopifySetup, account: AccountId, kind: SanctionKind, untilMs: number | null): Promise<string> {
  const id = `san_01J0000000000000000000${String(++sanctionSeq).padStart(4, '0')}`;
  const now = s.clock.now().toISOString();
  await s.store.putSanction({
    id, account, kind, reason: 'other', message: 'Please read the rules.', note: 'internal note', since: now,
    until: untilMs === null ? null : new Date(s.clock.t + untilMs).toISOString(), endedAt: null, endReason: null, endedBy: null, createdAt: now,
    createdBy: 'admin:op', reports: [], seenAt: null,
  });
  return id;
}

/** A pending deletion, as the rights part would set it. */
export async function markDeleting(s: ShopifySetup, id: AccountId): Promise<void> {
  const a = (await s.store.account(id))!;
  await s.store.updateAccount(id, a.version, {
    deletion: { requestedAt: s.clock.now().toISOString(), purgeAt: new Date(s.clock.t + 7 * DAY).toISOString(), erasingAt: null, done: [] },
  });
}
