/**
 * M14-13: the Shopify provider (src/identity/shopify.ts; design 3.5) on the fake issuer: only a way to sign in (the openid scope, never an order,
 * product or customer-data scope; the verified subject and nothing else), its issuer and redirect URI, its construction from the configuration, and
 * the package entry a host builds it from.
 */
import { describe, expect, it } from 'vitest';
import * as entry from '@openmtg/accounts';
import { ProviderUnavailableError } from '../../src/identity/oidc';
import {
  createShopifyProvider, SHOPIFY_CALLBACK_PATH, SHOPIFY_SCOPES, shopifyIssuer, shopifyProviderFromConfig, shopifyRedirectUri,
} from '../../src/identity/shopify';
import { Clock, configOf, fixedRandom } from '../m14-5/support';
import { CLIENT_ID, CLIENT_SECRET, FakeIssuer, ISSUER, REDIRECT_URI } from './issuer';

const SUB = 'gid://shopify/Customer/9001';

function provider(clock = new Clock(), issuer = new FakeIssuer(clock.now)) {
  const shopify = createShopifyProvider({
    shopId: '4242', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, issuer: ISSUER, fetch: issuer.fetch,
    random: fixedRandom('m14-13 shopify test'), jwksRefetchMs: 5 * 60_000,
  });
  return { clock, issuer, shopify };
}

describe('M14-13: "Sign in with DigiDice" (3.5)', () => {
  it('asks for the openid scope only: no order, product or customer-data scope', async () => {
    expect(SHOPIFY_SCOPES).toEqual(['openid']);
    const { clock, shopify } = provider();
    const a = await shopify.begin(clock.now(), 'signIn');
    expect(new URL(a.authorizeUrl).searchParams.get('scope')).toBe('openid');
    expect(a.authorizeUrl).not.toMatch(/customer-account-api|order|product/i);
  });

  it('finish answers the verified subject, with its issuer, as a shopify identity, and nothing else', async () => {
    const { clock, issuer, shopify } = provider();
    const a = await shopify.begin(clock.now(), 'signIn');
    const back = issuer.authorize(a.authorizeUrl, SUB);
    const flow = { ...a, intent: 'signIn' as const };
    expect(await shopify.finish(back.code, flow, clock.now())).toEqual({ ok: true, identity: { provider: 'shopify', subject: SUB, issuer: ISSUER } });
    expect(await shopify.finish(back.code, flow, clock.now())).toEqual({ ok: false, code: 'providerFailed' });
  });

  it('intent reauth asks for a fresh sign-in (max_age=0, prompt=login) and finish refuses a sign-in that is not one; the other intents ask nothing more', async () => {
    const { clock, issuer, shopify } = provider();
    for (const intent of ['signIn', 'register', 'link'] as const) {
      const q = new URL((await shopify.begin(clock.now(), intent)).authorizeUrl).searchParams;
      expect([q.has('max_age'), q.has('prompt')], intent).toEqual([false, false]);
    }
    const a = await shopify.begin(clock.now(), 'reauth');
    const q = new URL(a.authorizeUrl).searchParams;
    expect([q.get('max_age'), q.get('prompt')]).toEqual(['0', 'login']);
    expect(await shopify.finish(issuer.authorize(a.authorizeUrl, SUB).code, { ...a, intent: 'reauth' }, clock.now())).toEqual({ ok: true, identity: { provider: 'shopify', subject: SUB, issuer: ISSUER } });
    issuer.ignoresFreshSignIn = true;
    const b = await shopify.begin(clock.now(), 'reauth');
    expect(await shopify.finish(issuer.authorize(b.authorizeUrl, SUB).code, { ...b, intent: 'reauth' }, clock.now())).toEqual({ ok: false, code: 'providerFailed' });
    // the same old provider session signs in
    const c = await shopify.begin(clock.now(), 'signIn');
    expect((await shopify.finish(issuer.authorize(c.authorizeUrl, SUB).code, { ...c, intent: 'signIn' }, clock.now())).ok).toBe(true);
  });

  it('an issuer it cannot reach makes begin throw ProviderUnavailableError (the service answers providerUnavailable)', async () => {
    const { clock, issuer, shopify } = provider();
    issuer.down = true;
    await expect(shopify.begin(clock.now(), 'signIn')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('the issuer of a shop id, and the callback on the hosted origin over HTTPS', () => {
    expect(shopifyIssuer('4242')).toBe('https://shopify.com/authentication/4242');
    expect(() => shopifyIssuer('shop.example')).toThrow(TypeError);
    expect(SHOPIFY_CALLBACK_PATH).toBe('/auth/shopify/callback');
    expect(shopifyRedirectUri('https://play.example')).toBe('https://play.example/auth/shopify/callback');
    expect(shopifyRedirectUri('https://play.example:8443/')).toBe('https://play.example:8443/auth/shopify/callback');
    for (const bad of ['http://play.example', 'https://play.example/path', 'https://play.example?x=1', 'localhost', '']) {
      expect(() => shopifyRedirectUri(bad), bad).toThrow(TypeError);
    }
  });

  it('from the configuration: none without SHOPIFY_*, a provider with them', async () => {
    expect(shopifyProviderFromConfig(configOf(), { origin: 'https://play.example' })).toBeNull();
    const config = configOf({ SHOPIFY_SHOP_ID: '4242', SHOPIFY_CLIENT_ID: CLIENT_ID, SHOPIFY_CLIENT_SECRET: CLIENT_SECRET });
    const clock = new Clock();
    const issuer = new FakeIssuer(clock.now);
    const p = shopifyProviderFromConfig(config, { origin: 'https://play.example', issuer: ISSUER, fetch: issuer.fetch, random: fixedRandom('cfg') });
    expect(p).not.toBeNull();
    expect([p!.id, p!.kind, p!.oidc.issuer]).toEqual(['shopify', 'redirect', ISSUER]);
    const a = await p!.begin(clock.now(), 'signIn');
    expect(new URL(a.authorizeUrl).searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    // the default issuer is Shopify's for the shop id
    expect(shopifyProviderFromConfig(config, { origin: 'https://play.example', fetch: issuer.fetch })!.oidc.issuer).toBe('https://shopify.com/authentication/4242');
  });
});

describe('M14-13: a host builds the provider from the package entry (review of M14-13, contract 7)', () => {
  it('@openmtg/accounts exports the Shopify provider (not the browser-safe ./api)', () => {
    expect(entry.createShopifyProvider).toBe(createShopifyProvider);
    expect(entry.shopifyProviderFromConfig).toBe(shopifyProviderFromConfig);
    expect(entry.shopifyRedirectUri).toBe(shopifyRedirectUri);
    expect(entry.shopifyIssuer).toBe(shopifyIssuer);
    expect([entry.SHOPIFY_CALLBACK_PATH, entry.SHOPIFY_SCOPES]).toEqual([SHOPIFY_CALLBACK_PATH, SHOPIFY_SCOPES]);
    // what the host passes in AccountsHost.providers, built from the entry alone
    const config = configOf({ SHOPIFY_SHOP_ID: '4242', SHOPIFY_CLIENT_ID: CLIENT_ID, SHOPIFY_CLIENT_SECRET: CLIENT_SECRET });
    const clock = new Clock();
    const fetch: entry.FetchLike = new FakeIssuer(clock.now).fetch;
    const host: entry.AccountsHost['providers'] = [entry.shopifyProviderFromConfig(config, { origin: 'https://play.example', issuer: ISSUER, fetch })!];
    expect(host.map((p) => [p.id, p.kind])).toEqual([['shopify', 'redirect']]);
  });
});
