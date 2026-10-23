/**
 * M14-13: OpenID Connect for a redirect provider (design 3.5, 12.1), provider-neutral and `node:crypto` only. "Sign in with DigiDice" (./shopify.ts)
 * is this client with Shopify's issuer; another OpenID provider later is configuration plus a small adapter.
 *
 * - **Fetches** go through an injected fetch-like seam (`FetchLike`: globalThis.fetch in a server, an in-process fake issuer in tests, no
 *   sockets). Every request goes over HTTPS to the configured issuer's origin (the authorization endpoint, which only the browser opens, over HTTPS),
 *   with redirects refused (`redirect: 'error'`), a timeout and a size cap (OIDC_BODY_MAX bytes: a larger content-length is refused unread, and the
 *   body is read as a stream, chunk by chunk, and given up past the cap whatever the length said, so a chunked answer is never read in full); any
 *   other answer counts as the provider being unavailable.
 * - **Discovery** (`<issuer>/.well-known/openid-configuration`): its `issuer` must equal the configured one exactly; `jwks_uri` and
 *   `token_endpoint` (which receives the client secret) must be HTTPS URLs on the issuer's origin, `authorization_endpoint` an HTTPS URL;
 *   `id_token_signing_alg_values_supported` must name RS256 or ES256, `response_types_supported` 'code', and `code_challenge_methods_supported`,
 *   when given, 'S256'. The document is kept a day; a failed fetch is not tried again for 30 seconds (the provider answers unavailable meanwhile),
 *   and a failed refresh keeps the document held.
 * - **The JWKS** is loaded on first use and kept a day. A `kid` it does not hold refetches it **at most once per `jwksRefetchMs`** (5 minutes,
 *   ACCOUNT_TIMING), counted from the last fetch of any kind; otherwise the token is refused (3.5). Fetches of either document are single-flight.
 * - **PKCE S256** (RFC 7636): a 43-character verifier from 32 random bytes; the challenge is its SHA-256 in base64url. **`state` and `nonce`**: 128
 *   random bits each, in base64url. The service keeps all three in its flow, bound to the connection (src/service/providers.ts).
 * - **A fresh sign-in** (`fresh`, the service's reauth): the authorization asks for one (`max_age=0` and `prompt=login`, OpenID Connect Core
 *   3.1.2.1), and the ID token must carry `auth_time` no more than OIDC_FRESH_AUTH_MS (5 minutes) before now and not after it, each with the
 *   allowed clock skew (3.1.3.7 item 13); a token without it, or with an older one, is refused. A reauth ticket so proves a sign-in at the
 *   provider just now, not only a browser that still holds a provider session of any age.
 * - **The code exchange**: the authorization-code grant at the token endpoint with the verifier and the exact redirect URI; a confidential client
 *   authenticates with HTTP Basic (RFC 6749 2.3.1: the id and the secret form-urlencoded first). Only `id_token` is read from the answer: the access
 *   and refresh tokens are never read, kept or logged (3.5: dropped once the ID token is checked).
 * - **The ID token checks** (3.5), in this order: the shape (three base64url parts, at most 16 KB, JSON objects); `alg` on the allow-list RS256,
 *   ES256 (`none` and every `HS*` refused here, before the discovery document or any key is looked at), then in the discovery's list; no `crit`; a
 *   `kid`; a key of that kid whose `kty` (and `crv`) fit the algorithm (RSA of at least 2048 bits for RS256, EC P-256 for ES256), whose `use` is
 *   'sig' and `alg` the header's when present, `key_ops` holding 'verify' when present, built by `createPublicKey({ key, format: 'jwk' })` from
 *   its public members only (a kid held by no fitting key is refused, without a refetch); the signature by `crypto.verify` (ES256 with
 *   `dsaEncoding: 'ieee-p1363'`); then `iss` exactly the issuer; `aud` the client id or an array holding it; `azp` the client id whenever `aud` has
 *   more than one value (and whenever `azp` is present); `exp` in the future; `iat` at most 60 seconds ahead (the allowed clock skew), `nbf` likewise
 *   when present; `nonce` the flow's (a constant-time comparison); `sub` a string of 1-255 characters under m13's text rules; for a fresh sign-in,
 *   `auth_time` (above). Only `sub`, `iat` and `exp` leave this file: no email or other claim is ever kept.
 * - **Answers**: `providerFailed` for anything about this authorization (a refused token, a code the token endpoint refuses), `providerUnavailable`
 *   when the issuer cannot be reached or answers what it must not; each with a fixed reason word, which is all the log ever gets (AccountsLog
 *   `accounts.oidc.refused` and `accounts.oidc.unavailable`): never a token, code, state, nonce, verifier, secret or claim.
 */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { hostedTextProblem } from '../text';
import type { AccountsLog } from '../service/api';

// ---- The fetch seam -------------------------------------------------------------------------------------------------------------------------------

/** What a request asks of the fetch seam: always one of these two methods, never a redirect (globalThis.fetch takes it as RequestInit). */
export interface FetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  redirect: 'error';
  signal?: AbortSignal;
}
/**
 * The part of a fetch Response the client reads: the status, the content-length header and the body as a byte stream (null for none), which the
 * client reads chunk by chunk under the size cap (never `text()`, which reads all of it first).
 */
export interface FetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}
/** globalThis.fetch has this shape; tests pass an in-process fake issuer. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

// ---- Constants -------------------------------------------------------------------------------------------------------------------------------------

/** The only ID-token algorithms ever accepted (3.5). */
export const OIDC_ALGS = Object.freeze(['RS256', 'ES256'] as const);
export type OidcAlg = (typeof OIDC_ALGS)[number];
/** The allowed clock skew for `iat`, `nbf` and `auth_time` (3.5). */
export const OIDC_CLOCK_SKEW_MS = 60_000;
/** A fresh sign-in (the service's reauth): its `auth_time` at most this long before now, besides the skew. */
export const OIDC_FRESH_AUTH_MS = 5 * 60_000;
/** How long the discovery document and the JWKS are kept before they are fetched again. */
export const OIDC_CACHE_MS = 24 * 3_600_000;
/** After a failed fetch of either document, none is tried again for this long. */
export const OIDC_RETRY_MS = 30_000;
/** The timeout of every request. */
export const OIDC_TIMEOUT_MS = 10_000;
/** The largest body read from the issuer, in bytes. */
export const OIDC_BODY_MAX = 256 * 1024;
/** The longest ID token looked at. */
export const ID_TOKEN_MAX = 16 * 1024;
/** RFC 7636 4.1: 43-128 characters of the unreserved set. */
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** An authorization code as the callback may carry it: 1-2,048 visible ASCII characters. */
export const AUTH_CODE = /^[\x21-\x7e]{1,2048}$/;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const KID_MAX = 256;
const NONCE_MAX = 256;
const SUB_MAX = 255;

// ---- PKCE, state, nonce --------------------------------------------------------------------------------------------------------------------------

function bytes(random: (n: number) => Uint8Array, n: number): Uint8Array {
  const b = random(n);
  if (!(b instanceof Uint8Array) || b.length < n) throw new RangeError(`the random source gave ${b?.length ?? 0} bytes, not ${n}`);
  return b.subarray(0, n);
}

/** A PKCE code verifier (RFC 7636 4.1): 32 random bytes in base64url, 43 characters. */
export function newPkceVerifier(random: (n: number) => Uint8Array): string {
  return Buffer.from(bytes(random, 32)).toString('base64url');
}

/** The S256 code challenge of a verifier (RFC 7636 4.2): BASE64URL(SHA-256(ASCII(verifier))). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** A `state` or `nonce`: 128 random bits in base64url (22 characters). */
export function newOidcSecret(random: (n: number) => Uint8Array): string {
  return Buffer.from(bytes(random, 16)).toString('base64url');
}

// ---- Results ----------------------------------------------------------------------------------------------------------------------------------------

/** The fixed words a refusal is logged with (never anything the token or the issuer sent). */
export type OidcReason =
  | 'discovery' | 'jwks' | 'exchange' | 'code' | 'verifier' | 'token' | 'alg' | 'crit' | 'kid' | 'key' | 'signature' | 'iss' | 'aud' | 'azp' | 'exp'
  | 'iat' | 'nbf' | 'nonce' | 'sub' | 'authTime';
export interface OidcFailure { ok: false; code: 'providerFailed' | 'providerUnavailable'; reason: OidcReason }
/** What leaves this file of a checked ID token. */
export interface IdTokenClaims { sub: string; iat: number; exp: number }
export interface OidcAuthorization { state: string; nonce: string; verifier: string; authorizeUrl: string }

/** RedirectProvider.begin answers no error: a provider that cannot start an authorization throws this (the service answers providerUnavailable). */
export class ProviderUnavailableError extends Error {
  constructor(readonly reason: OidcReason) {
    super(`the provider is not available (${reason})`);
    this.name = 'ProviderUnavailableError';
  }
}

// ---- The client ------------------------------------------------------------------------------------------------------------------------------------

export interface OidcClientOptions {
  /** The issuer exactly as its ID tokens' `iss` says it: an HTTPS URL without query, fragment or user information. */
  issuer: string;
  clientId: string;
  /** A confidential client's secret (sent with HTTP Basic to the token endpoint only); null for a public client (PKCE alone). */
  clientSecret: string | null;
  /** The exact redirect URI registered with the provider: an HTTPS URL. */
  redirectUri: string;
  /** The scopes asked for: 'openid' and the fewest others the provider accepts. */
  scopes: readonly string[];
  fetch: FetchLike;
  /** node:crypto's randomBytes by default; fixed in tests. */
  random?: (n: number) => Uint8Array;
  /** ACCOUNT_TIMING.jwksRefetchMs (5 minutes): an unknown kid refetches the JWKS at most this often. */
  jwksRefetchMs: number;
  log?: AccountsLog;
  /** OIDC_TIMEOUT_MS by default. */
  timeoutMs?: number;
}

export interface OidcClient {
  readonly issuer: string;
  /**
   * A new authorization: state, nonce and verifier (for the service's flow) and the URL the browser opens (discovery on first use). `fresh`: ask for
   * a fresh sign-in (max_age=0, prompt=login).
   */
  begin(now: Date, opts?: { fresh?: boolean }): Promise<({ ok: true } & OidcAuthorization) | OidcFailure>;
  /** Exchanges the callback's code with the flow's verifier and checks the ID token against the flow's nonce (and, `fresh`, its auth_time). */
  finish(code: string, flow: { nonce: string; verifier: string; fresh?: boolean }, now: Date):
    Promise<{ ok: true; claims: IdTokenClaims } | OidcFailure>;
  /** The ID token checks alone (3.5's list), for a token from the token endpoint. */
  verifyIdToken(token: string, expect: { nonce: string; fresh?: boolean }, now: Date): Promise<{ ok: true; claims: IdTokenClaims } | OidcFailure>;
}

/** The discovery document's parts this client uses, checked. */
interface Discovery { issuer: string; authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string; algs: readonly OidcAlg[] }

type Json = Record<string, unknown>;

/** An own property only (a JSON object's `__proto__` key, or a name on Object.prototype, never reads as a claim). */
function own(o: Json, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An HTTPS URL without user information or fragment, as a URL; null otherwise. */
function httpsUrl(v: unknown): URL | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.hash !== '') return null;
  return u;
}

/** RFC 6749 2.3.1 / appendix B: application/x-www-form-urlencoded, as HTTP Basic's user and password must be before base64. */
function formEncode(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

/**
 * A body as UTF-8 text, read chunk by chunk: 'tooLarge' (the stream cancelled at once) as soon as more than `max` bytes have come, 'shape' for a
 * chunk that is not bytes. Bytes are counted, not UTF-16 units.
 */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ text: string } | 'tooLarge' | 'shape'> {
  if (body === null) return { text: '' };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const refused = !(value instanceof Uint8Array) ? 'shape' : bytes + value.byteLength > max ? 'tooLarge' : null;
    if (refused !== null) {
      reader.cancel().catch(() => undefined);
      return refused;
    }
    bytes += value.byteLength;
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

/** Constant time on equal lengths (the lengths of a nonce are not secret). */
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createOidcClient(opts: OidcClientOptions): OidcClient {
  const issuerUrl = httpsUrl(opts.issuer);
  if (issuerUrl === null || issuerUrl.search !== '') throw new TypeError('OIDC issuer: an HTTPS URL without query, fragment or user information');
  if (httpsUrl(opts.redirectUri) === null) throw new TypeError('OIDC redirect URI: an HTTPS URL without fragment or user information');
  if (typeof opts.clientId !== 'string' || opts.clientId.length === 0 || opts.clientId.length > 256 || hostedTextProblem(opts.clientId) !== null) {
    throw new TypeError('OIDC client id: 1-256 characters');
  }
  if (opts.clientSecret !== null && (typeof opts.clientSecret !== 'string' || opts.clientSecret.length === 0)) throw new TypeError('OIDC client secret');
  if (!opts.scopes.includes('openid') || !opts.scopes.every((s) => SCOPE_TOKEN.test(s))) throw new TypeError('OIDC scopes: openid and scope tokens');
  if (!Number.isFinite(opts.jwksRefetchMs) || opts.jwksRefetchMs <= 0) throw new TypeError('OIDC jwksRefetchMs: a positive number');
  const issuer = opts.issuer;
  const origin = issuerUrl.origin;
  const discoveryUrl = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const random = opts.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const timeoutMs = opts.timeoutMs ?? OIDC_TIMEOUT_MS;
  const scope = opts.scopes.join(' ');
  const basic =
    opts.clientSecret !== null ? `Basic ${Buffer.from(`${formEncode(opts.clientId)}:${formEncode(opts.clientSecret)}`, 'utf8').toString('base64')}` : null;

  const failed = (reason: OidcReason): OidcFailure => {
    opts.log?.event('accounts.oidc.refused', { reason });
    return { ok: false, code: 'providerFailed', reason };
  };
  const unavailable = (reason: OidcReason): OidcFailure => {
    opts.log?.event('accounts.oidc.unavailable', { reason });
    return { ok: false, code: 'providerUnavailable', reason };
  };

  /** One request: its status and body, or null when the issuer could not be reached, timed out, redirected or sent too much. */
  async function request(url: string, init: Omit<FetchInit, 'redirect' | 'signal'>, what: OidcReason): Promise<{ status: number; body: string } | null> {
    try {
      const r = await opts.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      const length = Number(r.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > OIDC_BODY_MAX) {
        // unread: the stream is cancelled, so nothing more of it is received
        r.body?.cancel().catch(() => undefined);
        opts.log?.event('accounts.oidc.tooLarge', { what });
        return null;
      }
      const body = await readCapped(r.body, OIDC_BODY_MAX);
      if (body === 'tooLarge') {
        opts.log?.event('accounts.oidc.tooLarge', { what });
        return null;
      }
      if (body === 'shape') {
        opts.log?.event('accounts.oidc.fetchFailed', { what, error: 'body' });
        return null;
      }
      return { status: r.status, body: body.text };
    } catch (e) {
      opts.log?.event('accounts.oidc.fetchFailed', { what, error: e instanceof Error ? e.name : 'error' });
      return null;
    }
  }

  async function getJson(url: string, what: OidcReason): Promise<Json | null> {
    const r = await request(url, { method: 'GET', headers: { accept: 'application/json' } }, what);
    if (r === null || r.status !== 200) return null;
    try {
      const v: unknown = JSON.parse(r.body);
      return isObject(v) ? v : null;
    } catch {
      return null;
    }
  }

  // ---- discovery
  let discovered: { doc: Discovery; fetchedAt: number } | null = null;
  let discoveryFailedAt: number | null = null;
  let discovering: Promise<void> | null = null;

  /** The checked discovery document, or null (3.5: only from the configured issuer's origin over HTTPS). */
  function checkDiscovery(v: Json): Discovery | null {
    if (own(v, 'issuer') !== issuer) return null;
    const authorization = httpsUrl(own(v, 'authorization_endpoint'));
    const token = httpsUrl(own(v, 'token_endpoint'));
    const jwks = httpsUrl(own(v, 'jwks_uri'));
    if (authorization === null || token === null || jwks === null) return null;
    if (token.origin !== origin || jwks.origin !== origin) return null;
    const algsRaw = own(v, 'id_token_signing_alg_values_supported');
    if (!Array.isArray(algsRaw)) return null;
    const algs = OIDC_ALGS.filter((a) => algsRaw.includes(a));
    if (algs.length === 0) return null;
    const types = own(v, 'response_types_supported');
    if (!Array.isArray(types) || !types.includes('code')) return null;
    const pkce = own(v, 'code_challenge_methods_supported');
    if (pkce !== undefined && !(Array.isArray(pkce) && pkce.includes('S256'))) return null;
    return { issuer, authorizationEndpoint: authorization.href, tokenEndpoint: token.href, jwksUri: jwks.href, algs };
  }

  async function loadDiscovery(t: number): Promise<void> {
    if (discoveryFailedAt !== null && t - discoveryFailedAt < OIDC_RETRY_MS) return;
    const v = await getJson(discoveryUrl, 'discovery');
    const doc = v !== null ? checkDiscovery(v) : null;
    if (doc === null) {
      discoveryFailedAt = t;
      opts.log?.event('accounts.oidc.discoveryFailed', { held: discovered !== null });
      return;
    }
    discovered = { doc, fetchedAt: t };
    discoveryFailedAt = null;
  }

  async function discovery(now: Date): Promise<Discovery | null> {
    const t = now.getTime();
    if (discovering !== null) await discovering;
    if (discovered === null || t - discovered.fetchedAt >= OIDC_CACHE_MS) {
      if (discovering === null) {
        discovering = loadDiscovery(t).finally(() => {
          discovering = null;
        });
      }
      await discovering;
    }
    return discovered?.doc ?? null;
  }

  // ---- the JWKS
  let keySet: { keys: Json[]; fetchedAt: number } | null = null;
  /** The last fetch of the JWKS of any kind (an unknown kid refetches at most once per jwksRefetchMs after it). */
  let jwksFetchedAt: number | null = null;
  let jwksFailedAt: number | null = null;
  let jwksLoading: Promise<void> | null = null;

  async function loadJwks(d: Discovery, t: number): Promise<void> {
    if (jwksFailedAt !== null && t - jwksFailedAt < OIDC_RETRY_MS) return;
    jwksFetchedAt = t;
    const v = await getJson(d.jwksUri, 'jwks');
    const keys = v !== null ? own(v, 'keys') : undefined;
    if (!Array.isArray(keys)) {
      jwksFailedAt = t;
      opts.log?.event('accounts.oidc.jwksFailed', { held: keySet !== null });
      return;
    }
    keySet = { keys: keys.filter(isObject), fetchedAt: t };
    jwksFailedAt = null;
  }

  function startJwks(d: Discovery, t: number): Promise<void> {
    if (jwksLoading === null) {
      jwksLoading = loadJwks(d, t).finally(() => {
        jwksLoading = null;
      });
    }
    return jwksLoading;
  }

  /** The key set to look `kid` up in: loaded or refreshed when due, refetched for an unknown kid at most once per jwksRefetchMs. */
  async function keysFor(d: Discovery, kid: string, now: Date): Promise<Json[] | null> {
    const t = now.getTime();
    if (jwksLoading !== null) await jwksLoading;
    if (keySet === null || t - keySet.fetchedAt >= OIDC_CACHE_MS) await startJwks(d, t);
    if (keySet === null) return null;
    const holds = (s: { keys: Json[] }) => s.keys.some((k) => own(k, 'kid') === kid);
    if (!holds(keySet) && (jwksFetchedAt === null || t - jwksFetchedAt >= opts.jwksRefetchMs)) await startJwks(d, t);
    return keySet?.keys ?? null;
  }

  /** A JWK that fits `alg` (3.5), as a public KeyObject built from its public members only; null when it does not fit. */
  function fit(jwk: Json, alg: OidcAlg): KeyObject | null {
    const use = own(jwk, 'use');
    if (use !== undefined && use !== 'sig') return null;
    const keyAlg = own(jwk, 'alg');
    if (keyAlg !== undefined && keyAlg !== alg) return null;
    const ops = own(jwk, 'key_ops');
    if (ops !== undefined && !(Array.isArray(ops) && ops.includes('verify'))) return null;
    let pub: JsonWebKey;
    if (alg === 'RS256') {
      const n = own(jwk, 'n');
      const e = own(jwk, 'e');
      if (own(jwk, 'kty') !== 'RSA' || typeof n !== 'string' || typeof e !== 'string') return null;
      pub = { kty: 'RSA', n, e };
    } else {
      const x = own(jwk, 'x');
      const y = own(jwk, 'y');
      if (own(jwk, 'kty') !== 'EC' || own(jwk, 'crv') !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') return null;
      pub = { kty: 'EC', crv: 'P-256', x, y };
    }
    try {
      const key = createPublicKey({ key: pub, format: 'jwk' });
      const details = key.asymmetricKeyDetails;
      if (alg === 'RS256' && (key.asymmetricKeyType !== 'rsa' || (details?.modulusLength ?? 0) < 2048)) return null;
      if (alg === 'ES256' && (key.asymmetricKeyType !== 'ec' || details?.namedCurve !== 'prime256v1')) return null;
      return key;
    } catch {
      return null;
    }
  }

  /** The three parts of a compact JWS, decoded; null when it is not one. */
  function parse(token: unknown): { header: Json; payload: Json; signed: Buffer; signature: Buffer } | null {
    if (typeof token !== 'string' || token.length > ID_TOKEN_MAX) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    if (!BASE64URL.test(h) || !BASE64URL.test(p) || (s !== '' && !BASE64URL.test(s))) return null;
    try {
      const header: unknown = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      const payload: unknown = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
      if (!isObject(header) || !isObject(payload)) return null;
      return { header, payload, signed: Buffer.from(`${h}.${p}`, 'ascii'), signature: Buffer.from(s, 'base64url') };
    } catch {
      return null;
    }
  }

  async function verifyIdToken(
    token: string, expect: { nonce: string; fresh?: boolean }, now: Date,
  ): Promise<{ ok: true; claims: IdTokenClaims } | OidcFailure> {
    const t = now.getTime();
    const jws = parse(token);
    if (jws === null) return failed('token');
    const { header, payload: c } = jws;
    // the allow-list first: `none` and every HS* never reach a key (3.5)
    const alg = own(header, 'alg');
    if (typeof alg !== 'string' || !(OIDC_ALGS as readonly string[]).includes(alg)) return failed('alg');
    if (own(header, 'crit') !== undefined) return failed('crit');
    const d = await discovery(now);
    if (d === null) return unavailable('discovery');
    if (!d.algs.includes(alg as OidcAlg)) return failed('alg');
    const kid = own(header, 'kid');
    if (typeof kid !== 'string' || kid.length === 0 || kid.length > KID_MAX) return failed('kid');
    const keys = await keysFor(d, kid, now);
    if (keys === null) return unavailable('jwks');
    const named = keys.filter((k) => own(k, 'kid') === kid);
    if (named.length === 0) return failed('kid');
    let key: KeyObject | null = null;
    for (const k of named) if ((key = fit(k, alg as OidcAlg)) !== null) break;
    if (key === null) return failed('key');
    let good = false;
    try {
      good =
        alg === 'RS256'
          ? verifySignature('sha256', jws.signed, key, jws.signature)
          : jws.signature.length === 64 && verifySignature('sha256', jws.signed, { key, dsaEncoding: 'ieee-p1363' }, jws.signature);
    } catch {
      good = false;
    }
    if (!good) return failed('signature');

    // the claims, now that the signature holds
    if (own(c, 'iss') !== d.issuer) return failed('iss');
    const aud = own(c, 'aud');
    const auds = typeof aud === 'string' ? [aud] : Array.isArray(aud) && aud.length > 0 && aud.every((x) => typeof x === 'string') ? (aud as string[]) : null;
    if (auds === null || !auds.includes(opts.clientId)) return failed('aud');
    const azp = own(c, 'azp');
    if ((auds.length > 1 || azp !== undefined) && azp !== opts.clientId) return failed('azp');
    const exp = own(c, 'exp');
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp * 1000 <= t) return failed('exp');
    const iat = own(c, 'iat');
    if (typeof iat !== 'number' || !Number.isFinite(iat) || iat * 1000 > t + OIDC_CLOCK_SKEW_MS) return failed('iat');
    const nbf = own(c, 'nbf');
    if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf) || nbf * 1000 > t + OIDC_CLOCK_SKEW_MS)) return failed('nbf');
    const nonce = own(c, 'nonce');
    if (typeof nonce !== 'string' || nonce.length > NONCE_MAX || typeof expect.nonce !== 'string' || !sameText(nonce, expect.nonce)) return failed('nonce');
    const sub = own(c, 'sub');
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > SUB_MAX || hostedTextProblem(sub) !== null || sub.trim() !== sub) return failed('sub');
    if (expect.fresh === true) {
      // a fresh sign-in (OpenID Connect Core 3.1.3.7 item 13): auth_time present, within OIDC_FRESH_AUTH_MS of now, the skew allowed both ways
      const authTime = own(c, 'auth_time');
      if (typeof authTime !== 'number' || !Number.isFinite(authTime)) return failed('authTime');
      if (authTime * 1000 < t - OIDC_FRESH_AUTH_MS - OIDC_CLOCK_SKEW_MS || authTime * 1000 > t + OIDC_CLOCK_SKEW_MS) return failed('authTime');
    }
    return { ok: true, claims: { sub, iat, exp } };
  }

  /** The authorization-code grant (RFC 6749 4.1.3 with RFC 7636 4.5): the ID token of the answer, nothing else of it. */
  async function exchange(d: Discovery, code: string, verifier: string): Promise<{ ok: true; idToken: string } | OidcFailure> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: opts.redirectUri, client_id: opts.clientId, code_verifier: verifier,
    }).toString();
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    if (basic !== null) headers['authorization'] = basic;
    const r = await request(d.tokenEndpoint, { method: 'POST', headers, body }, 'exchange');
    if (r === null || r.status >= 500) return unavailable('exchange');
    if (r.status !== 200) return failed('exchange');
    let v: unknown;
    try {
      v = JSON.parse(r.body);
    } catch {
      return failed('token');
    }
    const idToken = isObject(v) ? own(v, 'id_token') : undefined;
    if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > ID_TOKEN_MAX) return failed('token');
    return { ok: true, idToken };
  }

  return {
    issuer,
    async begin(now, o = {}) {
      const d = await discovery(now);
      if (d === null) return unavailable('discovery');
      const state = newOidcSecret(random);
      const nonce = newOidcSecret(random);
      const verifier = newPkceVerifier(random);
      const url = new URL(d.authorizationEndpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', opts.clientId);
      url.searchParams.set('redirect_uri', opts.redirectUri);
      url.searchParams.set('scope', scope);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', pkceChallenge(verifier));
      url.searchParams.set('code_challenge_method', 'S256');
      if (o.fresh === true) {
        url.searchParams.set('max_age', '0');
        url.searchParams.set('prompt', 'login');
      }
      return { ok: true, state, nonce, verifier, authorizeUrl: url.toString() };
    },
    async finish(code, flow, now) {
      if (typeof code !== 'string' || !AUTH_CODE.test(code)) return failed('code');
      if (typeof flow?.verifier !== 'string' || !PKCE_VERIFIER.test(flow.verifier)) return failed('verifier');
      const d = await discovery(now);
      if (d === null) return unavailable('discovery');
      const ex = await exchange(d, code, flow.verifier);
      if (!ex.ok) return ex;
      return verifyIdToken(ex.idToken, { nonce: flow.nonce, fresh: flow.fresh === true }, now);
    },
    verifyIdToken,
  };
}
