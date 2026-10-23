/**
 * The M14-13 tests' fake OpenID issuer, in process (owner rule: no sockets, no traffic, fixed inputs): a discovery document, a JWKS and a token
 * endpoint behind a fetch-like function (the seam src/identity/oidc.ts takes), keys made once by node:crypto, and the provider's side of an
 * authorization (`authorize`: what the browser would bring back to the callback). Its ID tokens are signed on demand; `mint` makes the fixed
 * token vectors of 13.2. The customer's browser holds a provider session begun SESSION_AGE_SEC ago: an authorization reuses it (auth_time that
 * old), and one with prompt=login or max_age=0 signs in anew (auth_time now), unless `ignoresFreshSignIn` is set.
 */
import { createHash, createHmac, generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { FetchInit, FetchLike, FetchResponse } from '../../src/identity/oidc';

export const ISSUER = 'https://shopify.example/authentication/4242';
export const ORIGIN = 'https://shopify.example';
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
export const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const TOKEN_URL = `${ISSUER}/oauth/token`;
export const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
export const CLIENT_ID = 'openmtg-test-client';
export const CLIENT_SECRET = 'not-a-real-secret-0123456789abcdef';
export const REDIRECT_URI = 'https://play.example/auth/shopify/callback';
/** What the fake token endpoint hands out besides the ID token: never read, kept or logged by the client (3.5). */
export const ACCESS_TOKEN = 'shcat_ACCESS_TOKEN_NEVER_KEPT';
export const REFRESH_TOKEN = 'shcrt_REFRESH_TOKEN_NEVER_KEPT';
/** How long ago the customer's browser signed in at the provider (30 days): an authorization that reuses that session carries this auth_time. */
export const SESSION_AGE_SEC = 30 * 86_400;

export interface TestKey { kid: string; alg: 'RS256' | 'ES256'; privateKey: KeyObject; publicKey: KeyObject; jwk: JsonWebKey }

function rsaKey(kid: string, modulusLength = 2048): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength });
  return { kid, alg: 'RS256', privateKey, publicKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' } };
}
function ecKey(kid: string, namedCurve: 'P-256' | 'P-384'): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve });
  return { kid, alg: 'ES256', privateKey, publicKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig' } };
}

/** The keys, made once per test file by node:crypto. */
export const KEYS = {
  rsa: rsaKey('rsa-1'),
  /** Published only once a test rotates the keys. */
  rsaNext: rsaKey('rsa-2'),
  ec: ecKey('ec-1', 'P-256'),
  /** An EC key on the wrong curve for ES256. */
  ec384: ecKey('ec-384', 'P-384'),
  /** An RSA key too small to trust. */
  rsaSmall: rsaKey('rsa-small', 1024),
};

export function defaultDiscovery(): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZE_URL,
    token_endpoint: TOKEN_URL,
    jwks_uri: JWKS_URL,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'email', 'customer-account-api:full'],
  };
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');

export interface MintOptions {
  key?: TestKey;
  /** Merged over { alg, kid, typ }; a key set to undefined is left out. */
  header?: Record<string, unknown>;
  /** Merged over the default claims; a claim set to undefined is left out. */
  claims?: Record<string, unknown>;
  /** Signs the "header.payload" bytes another way (an HMAC, a wrong key); `''` for no signature. */
  signer?: ((data: Buffer) => Buffer) | '';
}

export interface Grant {
  code: string; subject: string; nonce: string; challenge: string; redirectUri: string; used: boolean;
  /** When the customer signed in for this authorization (seconds), and the fresh-sign-in parameters the request carried. */
  authTime: number; maxAge: string | null; prompt: string | null;
}

/** A body as a byte stream of one chunk (fetch's Response.body), in process. */
export function streamOf(body: string): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(Buffer.from(body, 'utf8'));
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

export function response(status: number, body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = { 'content-type': 'application/json' }): FetchResponse {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n: string) => h[n.toLowerCase()] ?? null }, body: typeof body === 'string' ? streamOf(body) : body };
}

export class FakeIssuer {
  discovery: Record<string, unknown> = defaultDiscovery();
  jwks: JsonWebKey[] = [KEYS.rsa.jwk, KEYS.ec.jwk, KEYS.ec384.jwk, KEYS.rsaSmall.jwk];
  /** Every request, as the client sent it. */
  readonly calls: { url: string; init: FetchInit }[] = [];
  /** fetch rejects (the issuer cannot be reached). */
  down = false;
  /** The token endpoint answers this status instead. */
  tokenStatus: number | null = null;
  /** The key the token endpoint signs ID tokens with. */
  signingKey: TestKey = KEYS.rsa;
  /** Replaces the token endpoint's ID token (a fixed vector), given the grant it was exchanged for. */
  idTokenFor: ((g: Grant) => string) | null = null;
  /** A provider that ignores prompt=login and max_age: every authorization reuses the browser's old session. */
  ignoresFreshSignIn = false;
  /** Set: the token endpoint answers only once this settles (a test does something while the client waits for it). */
  tokenGate: Promise<void> | null = null;
  private readonly grants = new Map<string, Grant>();
  private seq = 0;

  constructor(private readonly clock: () => Date) {}

  /** The grant of a code (what the authorization asked for). */
  grant(code: string): Grant | undefined {
    return this.grants.get(code);
  }

  /** Seconds since 1970 at the clock's time. */
  get nowSec(): number {
    return Math.floor(this.clock().getTime() / 1000);
  }

  count(url: string): number {
    return this.calls.filter((c) => c.url === url).length;
  }

  /** A signed JWT: the default claims for `sub` and `nonce`, then the overrides. */
  mint(sub: string, nonce: string, o: MintOptions = {}): string {
    const key = o.key ?? this.signingKey;
    const header = Object.fromEntries(Object.entries({ alg: key.alg, kid: key.kid, typ: 'JWT', ...o.header }).filter(([, v]) => v !== undefined));
    const claims = Object.fromEntries(
      Object.entries({ iss: ISSUER, aud: CLIENT_ID, sub, nonce, iat: this.nowSec, exp: this.nowSec + 3_600, ...o.claims }).filter(([, v]) => v !== undefined),
    );
    const data = `${b64(header)}.${b64(claims)}`;
    let signature: Buffer;
    if (o.signer === '') signature = Buffer.alloc(0);
    else if (o.signer !== undefined) signature = o.signer(Buffer.from(data, 'ascii'));
    else if (key.alg === 'RS256') signature = sign('sha256', Buffer.from(data, 'ascii'), key.privateKey);
    else signature = sign('sha256', Buffer.from(data, 'ascii'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${data}.${signature.toString('base64url')}`;
  }

  /** HS256 "signed" with the RSA public key's PEM as the HMAC secret (the algorithm-confusion vector). */
  hs256WithPublicKey(sub: string, nonce: string): string {
    const pem = KEYS.rsa.publicKey.export({ format: 'pem', type: 'spki' });
    return this.mint(sub, nonce, { header: { alg: 'HS256', kid: KEYS.rsa.kid }, signer: (d) => createHmac('sha256', pem).update(d).digest() });
  }

  /**
   * The provider's side of an authorization: the browser opened `authorizeUrl` and the customer `subject` signed in. Answers what the redirect to
   * the callback carries (code and state). Checks what a real provider checks of the request.
   */
  authorize(authorizeUrl: string, subject: string): { code: string; state: string } {
    const u = new URL(authorizeUrl);
    const q = u.searchParams;
    if (`${u.origin}${u.pathname}` !== AUTHORIZE_URL) throw new Error(`not the authorization endpoint: ${u.origin}${u.pathname}`);
    if (q.get('response_type') !== 'code' || q.get('client_id') !== CLIENT_ID || q.get('code_challenge_method') !== 'S256') throw new Error('bad request');
    if (!(q.get('scope') ?? '').split(' ').includes('openid')) throw new Error('no openid scope');
    const code = `authcode-${++this.seq}`;
    const maxAge = q.get('max_age');
    const prompt = q.get('prompt');
    const fresh = !this.ignoresFreshSignIn && (prompt === 'login' || maxAge === '0');
    this.grants.set(code, {
      code, subject, nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge') ?? '', redirectUri: q.get('redirect_uri') ?? '', used: false,
      authTime: fresh ? this.nowSec : this.nowSec - SESSION_AGE_SEC, maxAge, prompt,
    });
    return { code, state: q.get('state') ?? '' };
  }

  readonly fetch: FetchLike = async (url, init) => {
    this.calls.push({ url, init });
    if (this.down) throw new TypeError('fetch failed');
    if (init.method === 'GET' && url === DISCOVERY_URL) return response(200, JSON.stringify(this.discovery));
    if (init.method === 'GET' && url === JWKS_URL) return response(200, JSON.stringify({ keys: this.jwks }));
    if (init.method === 'POST' && url === TOKEN_URL) {
      if (this.tokenGate !== null) await this.tokenGate;
      return this.token(init);
    }
    return response(404, '{"error":"not_found"}');
  };

  private token(init: FetchInit): FetchResponse {
    if (this.tokenStatus !== null) return response(this.tokenStatus, '{"error":"server_error"}');
    const refuse = (error: string) => response(400, JSON.stringify({ error }));
    if (init.headers['content-type'] !== 'application/x-www-form-urlencoded') return refuse('invalid_request');
    const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
    if (init.headers['authorization'] !== basic) return response(401, '{"error":"invalid_client"}');
    const q = new URLSearchParams(init.body ?? '');
    if (q.get('grant_type') !== 'authorization_code' || q.get('client_id') !== CLIENT_ID) return refuse('invalid_request');
    const g = this.grants.get(q.get('code') ?? '');
    if (g === undefined || g.used) return refuse('invalid_grant');
    g.used = true;
    if (q.get('redirect_uri') !== g.redirectUri) return refuse('invalid_grant');
    // PKCE S256 (RFC 7636 4.6): the verifier must hash to the challenge the authorization carried
    const verifier = q.get('code_verifier') ?? '';
    if (createHash('sha256').update(verifier, 'ascii').digest('base64url') !== g.challenge) return refuse('invalid_grant');
    const idToken = this.idTokenFor !== null ? this.idTokenFor(g) : this.mint(g.subject, g.nonce, { claims: { auth_time: g.authTime } });
    return response(200, JSON.stringify({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'Bearer', expires_in: 3_600, id_token: idToken }));
  }
}
