/**
 * M14-13: "Sign in with DigiDice" (design 3.5): the customer accounts of the digidice.net Shopify store, through Shopify's Customer Account API
 * (OAuth 2.0 authorization code with PKCE, OpenID Connect), as a RedirectProvider (src/identity/api.ts) on ./oidc.ts.
 *
 * **Only a way to sign in.** Nothing about purchases, orders, products or the store's catalogue is asked for, read or kept, and nothing is sold in
 * the game: the scopes are the fewest an ID token needs (`openid`; never `customer-account-api:full`), the access and refresh tokens are dropped
 * unread once the ID token is checked (./oidc.ts), and the one thing kept is the credential (`shopify`, the ID token's `sub`, with its issuer in
 * the credential's meta), never the email.
 *
 * - `begin` starts an authorization (./oidc.ts: discovery on first use, state, nonce, the PKCE verifier and the authorize URL); the service keeps
 *   them in its flow, bound to the connection (src/service/providers.ts). An issuer it cannot reach throws ProviderUnavailableError, which the
 *   service answers as providerUnavailable. Intent 'reauth' asks for a fresh sign-in (./oidc.ts: max_age=0, prompt=login).
 * - `finish` exchanges the callback's code with the client secret and the verifier and checks the ID token against the flow's nonce (for 'reauth'
 *   also that the sign-in is fresh, its auth_time): the verified subject, or providerFailed / providerUnavailable.
 * - The redirect URI is `https://<hosted origin>/auth/shopify/callback` (SHOPIFY_CALLBACK_PATH); Shopify refuses localhost, so it works only on a
 *   real domain (3.5).
 *
 * **What waits.** The owner's store setup (3.5, 13.5): the Headless channel, the Customer Account API client (confidential), its client id and
 * secret, the shop id, the registered callback URL and JavaScript origin; only the owner configures the store, and no test contacts Shopify. The issuer
 * defaults to `https://shopify.com/authentication/<shop id>` (`shopifyIssuer`), from memory and unverified until that setup: a host may pass the
 * one the store's settings show. And the m13 sync: the callback route and page in hosted's gateway (M14-13's part there, after M14-10), which
 * calls AccountService.providerCallback, and the hosted origin of the redirect URI. Until then nothing builds this provider outside tests.
 */
import { randomBytes } from 'node:crypto';
import { ACCOUNT_TIMING } from '../api';
import type { AccountsConfig } from '../config';
import type { AccountsLog } from '../service/api';
import type { RedirectProvider } from './api';
import { createOidcClient, ProviderUnavailableError, type FetchLike, type OidcClient } from './oidc';

/** The callback route on the hosted origin (3.5, 11.6). Its query string (code and state) is never logged. */
export const SHOPIFY_CALLBACK_PATH = '/auth/shopify/callback';
/** The fewest scopes an ID token needs (3.5): no order, product or customer-data scope. */
export const SHOPIFY_SCOPES: readonly string[] = Object.freeze(['openid']);

/** The store's numeric shop id (SHOPIFY_SHOP_ID, as src/config.ts checks it). */
const SHOP_ID = /^[0-9]{1,20}$/;

/**
 * The Customer Account API's issuer for a shop id: `https://shopify.com/authentication/<shop id>`. From memory, unverified until the owner's store
 * setup (the discovery document's `issuer` must equal it exactly, so a wrong one fails closed: providerUnavailable).
 */
export function shopifyIssuer(shopId: string): string {
  if (!SHOP_ID.test(shopId)) throw new TypeError('the shop id is the store\'s numeric id');
  return `https://shopify.com/authentication/${shopId}`;
}

/** The redirect URI on the hosted origin: an HTTPS origin (no path, query or fragment) + SHOPIFY_CALLBACK_PATH. */
export function shopifyRedirectUri(origin: string): string {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new TypeError('the hosted origin is not a URL');
  }
  if (u.protocol !== 'https:' || u.origin !== origin.replace(/\/$/, '')) throw new TypeError('the hosted origin: https://<host>[:port], nothing else');
  return `${u.origin}${SHOPIFY_CALLBACK_PATH}`;
}

export interface ShopifyProviderOptions {
  /** SHOPIFY_SHOP_ID, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (AccountsConfig.shopify). */
  shopId: string;
  clientId: string;
  clientSecret: string;
  /** The exact callback URL registered with the store (`shopifyRedirectUri(<hosted origin>)`). */
  redirectUri: string;
  /** shopifyIssuer(shopId) by default. */
  issuer?: string;
  /** SHOPIFY_SCOPES by default. */
  scopes?: readonly string[];
  /** globalThis.fetch by default; an in-process fake issuer in tests. */
  fetch?: FetchLike;
  random?: (n: number) => Uint8Array;
  /** ACCOUNT_TIMING.jwksRefetchMs by default (config.timing.jwksRefetchMs). */
  jwksRefetchMs?: number;
  log?: AccountsLog;
  timeoutMs?: number;
}

/** The Shopify provider, with its OpenID client (for the operator's checks and tests). */
export interface ShopifyProvider extends RedirectProvider {
  readonly oidc: OidcClient;
}

export function createShopifyProvider(o: ShopifyProviderOptions): ShopifyProvider {
  if (o.fetch === undefined && typeof globalThis.fetch !== 'function') throw new TypeError('no fetch: pass one');
  const fetcher: FetchLike = o.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const oidc = createOidcClient({
    issuer: o.issuer ?? shopifyIssuer(o.shopId),
    clientId: o.clientId,
    clientSecret: o.clientSecret,
    redirectUri: o.redirectUri,
    scopes: o.scopes ?? SHOPIFY_SCOPES,
    fetch: fetcher,
    random: o.random ?? ((n: number) => new Uint8Array(randomBytes(n))),
    jwksRefetchMs: o.jwksRefetchMs ?? ACCOUNT_TIMING.jwksRefetchMs,
    ...(o.log !== undefined ? { log: o.log } : {}),
    ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
  });
  return {
    id: 'shopify',
    kind: 'redirect',
    oidc,
    async begin(now, intent) {
      const r = await oidc.begin(now, { fresh: intent === 'reauth' });
      if (!r.ok) throw new ProviderUnavailableError(r.reason);
      return { state: r.state, nonce: r.nonce, verifier: r.verifier, authorizeUrl: r.authorizeUrl };
    },
    async finish(code, flow, now) {
      const r = await oidc.finish(code, { nonce: flow.nonce, verifier: flow.verifier, fresh: flow.intent === 'reauth' }, now);
      if (!r.ok) return { ok: false, code: r.code };
      // the ID token's iss is the configured issuer exactly (./oidc.ts): (iss, sub) is the identity the service keeps
      return { ok: true, identity: { provider: 'shopify', subject: r.claims.sub, issuer: oidc.issuer } };
    },
  };
}

/**
 * The provider a host configures from AccountsConfig (M14-10 at the sync passes it in AccountsHost.providers): null while SHOPIFY_* are not set
 * (the provider stays off and beginProvider answers notYet, 11.6). `origin` is the hosted origin of the callback.
 */
export function shopifyProviderFromConfig(
  config: Pick<AccountsConfig, 'shopify' | 'timing'>,
  host: { origin: string; issuer?: string; fetch?: FetchLike; log?: AccountsLog; random?: (n: number) => Uint8Array },
): ShopifyProvider | null {
  if (config.shopify === null) return null;
  return createShopifyProvider({
    shopId: config.shopify.shopId,
    clientId: config.shopify.clientId,
    clientSecret: config.shopify.clientSecret,
    redirectUri: shopifyRedirectUri(host.origin),
    jwksRefetchMs: config.timing.jwksRefetchMs,
    ...(host.issuer !== undefined ? { issuer: host.issuer } : {}),
    ...(host.fetch !== undefined ? { fetch: host.fetch } : {}),
    ...(host.log !== undefined ? { log: host.log } : {}),
    ...(host.random !== undefined ? { random: host.random } : {}),
  });
}
