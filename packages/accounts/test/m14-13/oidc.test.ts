/**
 * M14-13: the OpenID Connect client (src/identity/oidc.ts; design 3.5, 12.1, 13.2) against the in-process fake issuer with keys made by
 * node:crypto: PKCE S256 (RFC 7636's own vector and the token endpoint's check), state and nonce, the discovery rules, the fixed ID-token vectors
 * (alg none, HS256 signed with the RSA public key, an unknown kid with its one refetch and then none for 5 minutes, keys of the wrong kty or crv, a
 * multi-audience token without azp or with another azp, iss, exp, iat, nbf, nonce, sub), a fresh sign-in (max_age=0 and prompt=login asked for,
 * auth_time required), the code exchange, what is never kept or logged, and the size cap on what the issuer sends (counted in bytes, read chunk by
 * chunk).
 */
import { describe, expect, it } from 'vitest';
import {
  createOidcClient, newOidcSecret, newPkceVerifier, OIDC_BODY_MAX, OIDC_CLOCK_SKEW_MS, OIDC_FRESH_AUTH_MS, OIDC_RETRY_MS, PKCE_VERIFIER, pkceChallenge,
  type FetchLike, type OidcClient, type OidcClientOptions, type OidcFailure,
} from '../../src/identity/oidc';
import { Clock, fixedRandom, MIN, type LogLine } from '../m14-5/support';
import {
  ACCESS_TOKEN, AUTHORIZE_URL, CLIENT_ID, CLIENT_SECRET, DISCOVERY_URL, FakeIssuer, ISSUER, JWKS_URL, KEYS, REDIRECT_URI, REFRESH_TOKEN, response,
  SESSION_AGE_SEC, TOKEN_URL,
} from './issuer';

const NONCE = 'nonce-of-the-flow-0123456789';
const SUB = 'gid://shopify/Customer/1001';

interface Fixture { clock: Clock; issuer: FakeIssuer; oidc: OidcClient; log: LogLine[] }

function fixture(o: Partial<OidcClientOptions> = {}): Fixture {
  const clock = new Clock();
  const issuer = new FakeIssuer(clock.now);
  const log: LogLine[] = [];
  const oidc = createOidcClient({
    issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, scopes: ['openid'], fetch: issuer.fetch,
    random: fixedRandom('m14-13 oidc'), jwksRefetchMs: 5 * MIN, log: { event: (name, fields) => log.push({ name, fields }) }, ...o,
  });
  return { clock, issuer, oidc, log };
}

/** The reason of a refusal (fails the test on ok). */
function reason(r: { ok: true } | OidcFailure): string {
  if (r.ok) throw new Error('expected a refusal, got ok');
  return `${r.code}:${r.reason}`;
}

const verify = (f: Fixture, token: string, nonce = NONCE) => f.oidc.verifyIdToken(token, { nonce }, f.clock.now());

describe('M14-13: PKCE S256, state and nonce (3.5)', () => {
  it('the S256 challenge is RFC 7636\'s own example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('a verifier is 43 characters from 32 random bytes; state and nonce 128 bits each', () => {
    const random = fixedRandom('pkce');
    const v = newPkceVerifier(random);
    expect(v).toMatch(PKCE_VERIFIER);
    expect(v).toHaveLength(43);
    const s = newOidcSecret(random);
    expect(s).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(s, 'base64url')).toHaveLength(16);
  });

  it('the authorize URL carries the code flow, the exact redirect URI, openid, state, nonce and the S256 challenge of the verifier', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    if (!a.ok) throw new Error(reason(a));
    const u = new URL(a.authorizeUrl);
    expect(`${u.origin}${u.pathname}`).toBe(AUTHORIZE_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid', state: a.state, nonce: a.nonce,
      code_challenge: pkceChallenge(a.verifier), code_challenge_method: 'S256',
    });
    // the verifier itself never goes into the URL
    expect(a.authorizeUrl).not.toContain(a.verifier);
    const b = await f.oidc.begin(f.clock.now());
    if (!b.ok) throw new Error(reason(b));
    expect(new Set([a.state, a.nonce, b.state, b.nonce]).size).toBe(4);
    expect(b.verifier).not.toBe(a.verifier);
  });

  it('a fresh sign-in is asked for with max_age=0 and prompt=login; the ID token must show one, or the authorization fails', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now(), { fresh: true });
    if (!a.ok) throw new Error(reason(a));
    const q = new URL(a.authorizeUrl).searchParams;
    expect([q.get('max_age'), q.get('prompt'), q.get('scope')]).toEqual(['0', 'login', 'openid']);
    const fresh = { nonce: a.nonce, verifier: a.verifier, fresh: true };
    expect((await f.oidc.finish(f.issuer.authorize(a.authorizeUrl, SUB).code, fresh, f.clock.now())).ok).toBe(true);
    // a provider that ignores both and reuses the browser's 30-day-old session: refused
    f.issuer.ignoresFreshSignIn = true;
    const b = await f.oidc.begin(f.clock.now(), { fresh: true });
    if (!b.ok) throw new Error(reason(b));
    expect(reason(await f.oidc.finish(f.issuer.authorize(b.authorizeUrl, SUB).code, { nonce: b.nonce, verifier: b.verifier, fresh: true }, f.clock.now())))
      .toBe('providerFailed:authTime');
    // the same old session is fine for a sign-in that is not a reauth
    const c = await f.oidc.begin(f.clock.now());
    if (!c.ok) throw new Error(reason(c));
    expect(new URL(c.authorizeUrl).searchParams.has('max_age')).toBe(false);
    expect((await f.oidc.finish(f.issuer.authorize(c.authorizeUrl, SUB).code, c, f.clock.now())).ok).toBe(true);
  });

  it('the exchange sends the verifier: the flow\'s own passes, another flow\'s is refused by the token endpoint (S256)', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    const b = await f.oidc.begin(f.clock.now());
    if (!a.ok || !b.ok) throw new Error('begin failed');
    const codeA = f.issuer.authorize(a.authorizeUrl, SUB).code;
    expect(reason(await f.oidc.finish(codeA, { nonce: a.nonce, verifier: b.verifier }, f.clock.now()))).toBe('providerFailed:exchange');
    const codeA2 = f.issuer.authorize(a.authorizeUrl, SUB).code;
    const r = await f.oidc.finish(codeA2, { nonce: a.nonce, verifier: a.verifier }, f.clock.now());
    expect(r).toEqual({ ok: true, claims: { sub: SUB, iat: f.issuer.nowSec, exp: f.issuer.nowSec + 3_600 } });
  });

  it('the nonce must be the flow\'s: a code from another authorization of the same client is refused (nonce mismatch)', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    const b = await f.oidc.begin(f.clock.now());
    if (!a.ok || !b.ok) throw new Error('begin failed');
    const codeA = f.issuer.authorize(a.authorizeUrl, SUB).code;
    // a's code with a's verifier, checked against b's nonce
    expect(reason(await f.oidc.finish(codeA, { nonce: b.nonce, verifier: a.verifier }, f.clock.now()))).toBe('providerFailed:nonce');
  });

  it('a code the token endpoint already exchanged is refused; a code or verifier of the wrong shape never reaches it', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    if (!a.ok) throw new Error(reason(a));
    const code = f.issuer.authorize(a.authorizeUrl, SUB).code;
    expect((await f.oidc.finish(code, a, f.clock.now())).ok).toBe(true);
    expect(reason(await f.oidc.finish(code, a, f.clock.now()))).toBe('providerFailed:exchange');
    const before = f.issuer.count(TOKEN_URL);
    expect(reason(await f.oidc.finish('code with spaces', a, f.clock.now()))).toBe('providerFailed:code');
    expect(reason(await f.oidc.finish('', a, f.clock.now()))).toBe('providerFailed:code');
    expect(reason(await f.oidc.finish(code, { nonce: a.nonce, verifier: 'short' }, f.clock.now()))).toBe('providerFailed:verifier');
    expect(f.issuer.count(TOKEN_URL)).toBe(before);
  });
});

describe('M14-13: the discovery document (3.5: only from the issuer\'s origin over HTTPS)', () => {
  it('is fetched once and kept; every request refuses redirects', async () => {
    const f = fixture();
    await f.oidc.begin(f.clock.now());
    await f.oidc.begin(f.clock.now());
    expect(f.issuer.count(DISCOVERY_URL)).toBe(1);
    expect(f.issuer.calls.every((c) => c.init.redirect === 'error')).toBe(true);
  });

  const bad: [string, (d: Record<string, unknown>) => void][] = [
    ['another issuer', (d) => (d['issuer'] = 'https://elsewhere.example/authentication/4242')],
    ['the issuer with a trailing slash', (d) => (d['issuer'] = `${ISSUER}/`)],
    ['a JWKS on another origin', (d) => (d['jwks_uri'] = 'https://keys.elsewhere.example/jwks.json')],
    ['a JWKS over plain HTTP', (d) => (d['jwks_uri'] = 'http://shopify.example/authentication/4242/.well-known/jwks.json')],
    ['a token endpoint on another origin', (d) => (d['token_endpoint'] = 'https://tokens.elsewhere.example/token')],
    ['an authorization endpoint over plain HTTP', (d) => (d['authorization_endpoint'] = 'http://shopify.example/authentication/4242/oauth/authorize')],
    ['no RS256 or ES256', (d) => (d['id_token_signing_alg_values_supported'] = ['HS256', 'none'])],
    ['no algorithm list', (d) => delete d['id_token_signing_alg_values_supported']],
    ['no code response type', (d) => (d['response_types_supported'] = ['id_token'])],
    ['PKCE without S256', (d) => (d['code_challenge_methods_supported'] = ['plain'])],
  ];
  for (const [what, change] of bad) {
    it(`${what}: the provider is unavailable`, async () => {
      const f = fixture();
      change(f.issuer.discovery);
      expect(reason(await f.oidc.begin(f.clock.now()))).toBe('providerUnavailable:discovery');
    });
  }

  it('an issuer that cannot be reached is not asked again for 30 seconds; then it is', async () => {
    const f = fixture();
    f.issuer.down = true;
    expect(reason(await f.oidc.begin(f.clock.now()))).toBe('providerUnavailable:discovery');
    f.issuer.down = false;
    f.clock.advance(OIDC_RETRY_MS - 1);
    expect(reason(await f.oidc.begin(f.clock.now()))).toBe('providerUnavailable:discovery');
    expect(f.issuer.count(DISCOVERY_URL)).toBe(1);
    f.clock.advance(1);
    expect((await f.oidc.begin(f.clock.now())).ok).toBe(true);
    expect(f.issuer.count(DISCOVERY_URL)).toBe(2);
  });

  it('the client refuses an issuer or redirect URI that is not HTTPS, and scopes without openid', () => {
    const base: OidcClientOptions = {
      issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, scopes: ['openid'], fetch: async () => {
        throw new Error('no');
      }, jwksRefetchMs: 5 * MIN,
    };
    expect(() => createOidcClient({ ...base, issuer: 'http://shopify.example/authentication/4242' })).toThrow(TypeError);
    expect(() => createOidcClient({ ...base, issuer: `${ISSUER}?x=1` })).toThrow(TypeError);
    expect(() => createOidcClient({ ...base, redirectUri: 'http://play.example/auth/shopify/callback' })).toThrow(TypeError);
    expect(() => createOidcClient({ ...base, scopes: ['email'] })).toThrow(TypeError);
    expect(() => createOidcClient(base)).not.toThrow();
  });
});

describe('M14-13: the size cap on what the issuer sends (review of M14-13, security 4 and contract 8)', () => {
  /** A chunked answer without a content-length: 64 KiB chunks, 80 of them (5 MiB) if read to the end; it counts the chunks pulled from it. */
  function chunked() {
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const seen = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        seen.pulls += 1;
        if (seen.pulls > 80) c.close();
        else c.enqueue(chunk);
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { stream, seen };
  }

  /** The fixture, with the discovery document's answer replaced. */
  function answering(discovery: () => ReturnType<FetchLike>): Fixture {
    let inner: FetchLike | null = null;
    const f = fixture({ fetch: (url, init) => (url === DISCOVERY_URL ? discovery() : inner!(url, init)) });
    inner = f.issuer.fetch;
    return f;
  }

  it('a chunked answer with no content-length is read only up to the cap, then given up: the provider is unavailable', async () => {
    const big = chunked();
    const f = answering(async () => response(200, big.stream));
    expect(reason(await f.oidc.begin(f.clock.now()))).toBe('providerUnavailable:discovery');
    // 4 chunks are the cap; the fifth goes beyond it and the stream is cancelled, never read to its 80
    expect(big.seen.pulls).toBeLessThanOrEqual(6);
    expect(big.seen.cancelled).toBe(true);
    expect(f.log.map((l) => l.name)).toContain('accounts.oidc.tooLarge');
  });

  it('the cap counts bytes, not UTF-16 units: a document under the cap in characters but over it in UTF-8 is refused; one under it passes', async () => {
    const f = fixture();
    // 140,000 two-byte characters: about 137 Ki characters, but 280,000 bytes
    f.issuer.discovery = { ...f.issuer.discovery, pad: '\u00e9'.repeat(140_000) };
    expect(JSON.stringify(f.issuer.discovery).length).toBeLessThan(OIDC_BODY_MAX);
    expect(Buffer.byteLength(JSON.stringify(f.issuer.discovery), 'utf8')).toBeGreaterThan(OIDC_BODY_MAX);
    expect(reason(await f.oidc.begin(f.clock.now()))).toBe('providerUnavailable:discovery');
    expect(f.log.map((l) => l.name)).toContain('accounts.oidc.tooLarge');
    const g = fixture();
    g.issuer.discovery = { ...g.issuer.discovery, pad: 'a'.repeat(200_000) };
    expect((await g.oidc.begin(g.clock.now())).ok).toBe(true);
  });

  it('a content-length above the cap is refused before the body is read', async () => {
    const big = chunked();
    const f = answering(async () => response(200, big.stream, { 'content-type': 'application/json', 'content-length': String(OIDC_BODY_MAX + 1) }));
    expect(reason(await f.oidc.begin(f.clock.now()))).toBe('providerUnavailable:discovery');
    expect(big.seen.pulls).toBeLessThanOrEqual(1);
  });
});

describe('M14-13: the fixed ID-token vectors (3.5, 13.2)', () => {
  it('a good RS256 token and a good ES256 token pass, giving only sub, iat and exp', async () => {
    const f = fixture();
    expect(await verify(f, f.issuer.mint(SUB, NONCE, { claims: { email: 'someone@example.com', name: 'Someone' } }))).toEqual({
      ok: true, claims: { sub: SUB, iat: f.issuer.nowSec, exp: f.issuer.nowSec + 3_600 },
    });
    expect((await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.ec }))).ok).toBe(true);
  });

  it('alg none is refused before the discovery document or any key is looked at', async () => {
    const f = fixture();
    for (const alg of ['none', 'None', 'NONE']) {
      expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { header: { alg }, signer: '' })))).toBe('providerFailed:alg');
    }
    expect(f.issuer.calls).toHaveLength(0);
  });

  it('HS256 signed with the RSA public key (algorithm confusion) is refused before any key is looked up; so is every other algorithm', async () => {
    const f = fixture();
    expect(reason(await verify(f, f.issuer.hs256WithPublicKey(SUB, NONCE)))).toBe('providerFailed:alg');
    for (const alg of ['HS384', 'HS512', 'RS384', 'RS512', 'PS256', 'ES384', 'ES512', 'EdDSA', 'rs256']) {
      expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { header: { alg } }))), alg).toBe('providerFailed:alg');
    }
    expect(f.issuer.count(JWKS_URL)).toBe(0);
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { header: { alg: undefined } })))).toBe('providerFailed:alg');
  });

  it('an allowed algorithm the discovery document does not list is refused', async () => {
    const f = fixture();
    f.issuer.discovery['id_token_signing_alg_values_supported'] = ['RS256'];
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.ec })))).toBe('providerFailed:alg');
    expect((await verify(f, f.issuer.mint(SUB, NONCE))).ok).toBe(true);
  });

  it('an unknown kid refetches the JWKS once, then not again for 5 minutes; a rotated key is found by the next refetch', async () => {
    const f = fixture();
    expect((await verify(f, f.issuer.mint(SUB, NONCE))).ok).toBe(true);
    expect(f.issuer.count(JWKS_URL)).toBe(1);
    // fetched just now: an unknown kid does not refetch yet
    const unknown = () => f.issuer.mint(SUB, NONCE, { header: { kid: 'kid-nobody-has' } });
    expect(reason(await verify(f, unknown()))).toBe('providerFailed:kid');
    expect(f.issuer.count(JWKS_URL)).toBe(1);
    f.clock.advance(5 * MIN);
    expect(reason(await verify(f, unknown()))).toBe('providerFailed:kid');
    expect(f.issuer.count(JWKS_URL)).toBe(2);
    // the issuer rotates: the new key is published, but the last fetch was less than 5 minutes ago
    f.issuer.jwks = [...f.issuer.jwks, KEYS.rsaNext.jwk];
    f.clock.advance(5 * MIN - 1);
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.rsaNext })))).toBe('providerFailed:kid');
    expect(reason(await verify(f, unknown()))).toBe('providerFailed:kid');
    expect(f.issuer.count(JWKS_URL)).toBe(2);
    f.clock.advance(1);
    expect((await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.rsaNext }))).ok).toBe(true);
    expect(f.issuer.count(JWKS_URL)).toBe(3);
    // a known kid never refetches
    expect((await verify(f, f.issuer.mint(SUB, NONCE))).ok).toBe(true);
    expect(f.issuer.count(JWKS_URL)).toBe(3);
  });

  it('a key of the wrong kty or crv is refused, without a refetch', async () => {
    const f = fixture();
    await verify(f, f.issuer.mint(SUB, NONCE));
    // RS256 naming the EC key, ES256 naming the RSA key, ES256 naming the P-384 key
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.rsa, header: { kid: KEYS.ec.kid } })))).toBe('providerFailed:key');
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.ec, header: { kid: KEYS.rsa.kid } })))).toBe('providerFailed:key');
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.ec384, header: { alg: 'ES256' } })))).toBe('providerFailed:key');
    // an RSA key under 2048 bits
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.rsaSmall })))).toBe('providerFailed:key');
    expect(f.issuer.count(JWKS_URL)).toBe(1);
  });

  it('a key whose use, alg or key_ops do not fit is refused', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['use enc', { use: 'enc' }], ['alg RS512', { alg: 'RS512' }], ['key_ops sign only', { key_ops: ['sign'] }],
    ];
    for (const [what, change] of cases) {
      const f = fixture();
      f.issuer.jwks = [{ ...KEYS.rsa.jwk, ...change }];
      expect(reason(await verify(f, f.issuer.mint(SUB, NONCE))), what).toBe('providerFailed:key');
    }
    const f = fixture();
    f.issuer.jwks = [{ ...KEYS.rsa.jwk, key_ops: ['verify'], use: undefined, alg: undefined }];
    expect((await verify(f, f.issuer.mint(SUB, NONCE))).ok).toBe(true);
  });

  it('a signature that does not hold is refused: a claim changed after signing, another key under the same kid, no signature', async () => {
    const f = fixture();
    const good = f.issuer.mint(SUB, NONCE);
    const [h, , s] = good.split('.') as [string, string, string];
    const p = Buffer.from(JSON.stringify({ iss: ISSUER, aud: CLIENT_ID, sub: 'gid://shopify/Customer/6666', nonce: NONCE, iat: f.issuer.nowSec, exp: f.issuer.nowSec + 60 })).toString('base64url');
    expect(reason(await verify(f, `${h}.${p}.${s}`))).toBe('providerFailed:signature');
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.rsaNext, header: { kid: KEYS.rsa.kid } })))).toBe('providerFailed:signature');
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { signer: '' })))).toBe('providerFailed:signature');
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { key: KEYS.ec, signer: (d) => Buffer.concat([d.subarray(0, 32), d.subarray(0, 33)]) })))).toBe('providerFailed:signature');
  });

  it('aud: the client id or an array holding it; with more than one audience azp must be the client id; azp, when present, always', async () => {
    const f = fixture();
    const v = (claims: Record<string, unknown>) => verify(f, f.issuer.mint(SUB, NONCE, { claims }));
    expect(reason(await v({ aud: 'another-client' }))).toBe('providerFailed:aud');
    expect(reason(await v({ aud: [] }))).toBe('providerFailed:aud');
    expect(reason(await v({ aud: ['another-client', 'third-client'] }))).toBe('providerFailed:aud');
    expect(reason(await v({ aud: undefined }))).toBe('providerFailed:aud');
    expect(reason(await v({ aud: [CLIENT_ID, 'another-client'] }))).toBe('providerFailed:azp');
    expect(reason(await v({ aud: [CLIENT_ID, 'another-client'], azp: 'another-client' }))).toBe('providerFailed:azp');
    expect(reason(await v({ azp: 'another-client' }))).toBe('providerFailed:azp');
    expect((await v({ aud: [CLIENT_ID, 'another-client'], azp: CLIENT_ID })).ok).toBe(true);
    expect((await v({ aud: [CLIENT_ID] })).ok).toBe(true);
  });

  it('iss must equal the issuer exactly', async () => {
    const f = fixture();
    for (const iss of ['https://elsewhere.example/authentication/4242', `${ISSUER}/`, ISSUER.toUpperCase(), undefined]) {
      expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { claims: { iss } }))), String(iss)).toBe('providerFailed:iss');
    }
  });

  it('exp must be in the future; iat at most 60 seconds ahead; nbf likewise', async () => {
    const f = fixture();
    const now = f.issuer.nowSec;
    const v = (claims: Record<string, unknown>) => verify(f, f.issuer.mint(SUB, NONCE, { claims }));
    expect(reason(await v({ exp: now - 1 }))).toBe('providerFailed:exp');
    expect(reason(await v({ exp: now }))).toBe('providerFailed:exp');
    expect(reason(await v({ exp: undefined }))).toBe('providerFailed:exp');
    expect(reason(await v({ exp: String(now + 60) }))).toBe('providerFailed:exp');
    expect((await v({ exp: now + 1 })).ok).toBe(true);
    expect(reason(await v({ iat: now + OIDC_CLOCK_SKEW_MS / 1000 + 1 }))).toBe('providerFailed:iat');
    expect(reason(await v({ iat: undefined }))).toBe('providerFailed:iat');
    expect((await v({ iat: now + OIDC_CLOCK_SKEW_MS / 1000 })).ok).toBe(true);
    expect(reason(await v({ nbf: now + 61 }))).toBe('providerFailed:nbf');
    expect((await v({ nbf: now + 60 })).ok).toBe(true);
  });

  it('a fresh sign-in: auth_time present, at most 5 minutes old and not ahead, with the 60-second skew either way; without fresh it is not looked at', async () => {
    const f = fixture();
    const now = f.issuer.nowSec;
    const skew = OIDC_CLOCK_SKEW_MS / 1000;
    const age = OIDC_FRESH_AUTH_MS / 1000;
    const v = (claims: Record<string, unknown>, fresh = true) => f.oidc.verifyIdToken(f.issuer.mint(SUB, NONCE, { claims }), { nonce: NONCE, fresh }, f.clock.now());
    expect(reason(await v({}))).toBe('providerFailed:authTime');
    expect(reason(await v({ auth_time: String(now) }))).toBe('providerFailed:authTime');
    expect(reason(await v({ auth_time: now - SESSION_AGE_SEC }))).toBe('providerFailed:authTime');
    expect(reason(await v({ auth_time: now - age - skew - 1 }))).toBe('providerFailed:authTime');
    expect((await v({ auth_time: now - age - skew })).ok).toBe(true);
    expect((await v({ auth_time: now })).ok).toBe(true);
    expect((await v({ auth_time: now + skew })).ok).toBe(true);
    expect(reason(await v({ auth_time: now + skew + 1 }))).toBe('providerFailed:authTime');
    // not a fresh sign-in (signIn, register, link): an old session's auth_time, or none, is accepted
    expect((await v({ auth_time: now - SESSION_AGE_SEC }, false)).ok).toBe(true);
    expect((await v({}, false)).ok).toBe(true);
  });

  it('the nonce must be the flow\'s; sub a string of 1-255 characters without control characters', async () => {
    const f = fixture();
    const v = (claims: Record<string, unknown>) => verify(f, f.issuer.mint(SUB, NONCE, { claims }));
    expect(reason(await v({ nonce: 'another-nonce' }))).toBe('providerFailed:nonce');
    expect(reason(await v({ nonce: undefined }))).toBe('providerFailed:nonce');
    expect(reason(await v({ nonce: `${NONCE}x` }))).toBe('providerFailed:nonce');
    for (const sub of [undefined, '', 'x'.repeat(256), 'gid://shopify/Customer/1\n2', ' padded', 42]) {
      expect(reason(await v({ sub })), JSON.stringify(sub)).toBe('providerFailed:sub');
    }
    expect((await v({ sub: 'x'.repeat(255) })).ok).toBe(true);
  });

  it('a crit header, a missing kid and tokens of the wrong shape are refused', async () => {
    const f = fixture();
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { header: { crit: ['exp'] } })))).toBe('providerFailed:crit');
    expect(reason(await verify(f, f.issuer.mint(SUB, NONCE, { header: { kid: undefined } })))).toBe('providerFailed:kid');
    const good = f.issuer.mint(SUB, NONCE);
    const [h, p] = good.split('.') as [string, string];
    const shapes = [
      `${h}.${p}`, `${h}.${p}.sig.extra`, `${h}.${Buffer.from('[1,2]').toString('base64url')}.c2ln`, `${h}.bm90IGpzb24.c2ln`, `${h}.${p}.si+g`,
      `${good}${'A'.repeat(16 * 1024)}`,
    ];
    for (const t of shapes) expect(reason(await verify(f, t))).toBe('providerFailed:token');
  });
});

describe('M14-13: the code exchange (3.5)', () => {
  it('authenticates with HTTP Basic, sends the exact redirect URI, and keeps nothing of the answer but the checked claims', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    if (!a.ok) throw new Error(reason(a));
    const code = f.issuer.authorize(a.authorizeUrl, SUB).code;
    const r = await f.oidc.finish(code, a, f.clock.now());
    expect(r).toEqual({ ok: true, claims: { sub: SUB, iat: f.issuer.nowSec, exp: f.issuer.nowSec + 3_600 } });
    const call = f.issuer.calls.find((c) => c.url === TOKEN_URL)!;
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['authorization']).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(call.init.body))).toEqual({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, code_verifier: a.verifier,
    });
    // the secret only in the token request's header; Shopify's access and refresh tokens nowhere in the answer or the log
    expect(JSON.stringify(r)).not.toMatch(/ACCESS_TOKEN|REFRESH_TOKEN/);
    for (const c of f.issuer.calls.filter((x) => x.url !== TOKEN_URL)) expect(JSON.stringify(c)).not.toContain(CLIENT_SECRET);
    expect(ACCESS_TOKEN).not.toBe(REFRESH_TOKEN);
  });

  it('a refused grant fails the flow; a server error or no answer makes the provider unavailable', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    if (!a.ok) throw new Error(reason(a));
    expect(reason(await f.oidc.finish('authcode-unknown', a, f.clock.now()))).toBe('providerFailed:exchange');
    f.issuer.tokenStatus = 503;
    expect(reason(await f.oidc.finish(f.issuer.authorize(a.authorizeUrl, SUB).code, a, f.clock.now()))).toBe('providerUnavailable:exchange');
    f.issuer.tokenStatus = null;
    f.issuer.down = true;
    expect(reason(await f.oidc.finish(f.issuer.authorize(a.authorizeUrl, SUB).code, a, f.clock.now()))).toBe('providerUnavailable:exchange');
  });

  it('an answer without an ID token, or with one that fails a check, fails the flow', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    if (!a.ok) throw new Error(reason(a));
    f.issuer.idTokenFor = () => '';
    expect(reason(await f.oidc.finish(f.issuer.authorize(a.authorizeUrl, SUB).code, a, f.clock.now()))).toBe('providerFailed:token');
    f.issuer.idTokenFor = (g) => f.issuer.mint(g.subject, g.nonce, { claims: { aud: 'another-client' } });
    expect(reason(await f.oidc.finish(f.issuer.authorize(a.authorizeUrl, SUB).code, a, f.clock.now()))).toBe('providerFailed:aud');
  });

  it('logs only fixed reason words: no token, code, state, nonce, verifier, secret or claim', async () => {
    const f = fixture();
    const a = await f.oidc.begin(f.clock.now());
    if (!a.ok) throw new Error(reason(a));
    const code = f.issuer.authorize(a.authorizeUrl, SUB).code;
    f.issuer.idTokenFor = (g) => f.issuer.mint(g.subject, 'wrong-nonce');
    await f.oidc.finish(code, a, f.clock.now());
    await verify(f, f.issuer.hs256WithPublicKey(SUB, NONCE));
    f.issuer.down = true;
    f.clock.advance(2 * OIDC_RETRY_MS);
    await verify(f, f.issuer.mint(SUB, NONCE, { header: { kid: 'unknown' } }));
    expect(f.log.length).toBeGreaterThan(0);
    const text = JSON.stringify(f.log);
    for (const secret of [code, a.state, a.nonce, a.verifier, CLIENT_SECRET, SUB, ACCESS_TOKEN, REFRESH_TOKEN, 'wrong-nonce', 'eyJ']) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
