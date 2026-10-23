/**
 * Identity providers (design 3.1, 11.3; M14-1). Built by: local M14-5 (src/identity/local.ts); oidc and shopify M14-13; passkey M14-14.
 *
 * A provider only answers "this proof belongs to subject S". The account service owns everything around it: rate limits and back-off, provider flows
 * and their binding to a connection (3.5), sessions, the audit log, standing.
 */
import type { AccountId, ProviderId, ProviderIntent } from '../api';
import type { CredentialTools, HashPriority, PasswordHasher } from '../crypto/api';
import type { CredentialRow } from '../store/api';

/**
 * INTERFACE CHANGE (M14-13, review of M14-13): `issuer`, which a redirect provider gives (OpenID Connect's `iss`): (iss, sub) is the stable identity,
 * not `sub` alone. The service keeps it in the credential (CredentialRow.meta.issuer) and requires it on every later match, so another issuer's
 * subjects (a changed shop or issuer setting) never reach an account linked under the first.
 */
export interface VerifiedIdentity { provider: ProviderId; subject: string; issuer?: string }
export interface PasswordProvider {
  readonly id: 'local'; readonly kind: 'password';
  /** A new credential for the account (its PHC string), after the policy check. */
  enroll(account: AccountId, password: string, at: string, opts: { priority: HashPriority }): Promise<CredentialRow>;
  /** In constant time against the credential, or the dummy hash when null; `rehash` is the replacement when the parameters or pepper changed (4.1). */
  verify(credential: CredentialRow | null, password: string, opts: { priority: HashPriority }): Promise<{ ok: boolean; rehash: CredentialRow | null }>;
}
/**
 * INTERFACE CHANGE (M14-13, review of M14-13): `begin` and `finish` are told the flow's intent. A 'reauth' authorization asks the provider for a
 * fresh sign-in (OpenID Connect's max_age=0 and prompt=login), and its ID token must show one (auth_time within OIDC_FRESH_AUTH_MS, ./oidc.ts):
 * otherwise a reauth ticket would prove only that the browser holds a provider session of any age.
 */
export interface RedirectProvider {
  readonly id: 'shopify'; readonly kind: 'redirect';
  /** A new authorization for `intent`; the service keeps state, nonce and verifier in its flow, bound to the connection (3.5). */
  begin(now: Date, intent: ProviderIntent): Promise<{ state: string; nonce: string; verifier: string; authorizeUrl: string }>;
  /** Exchanges the code and checks the ID token (3.5's list) against the flow's nonce, and for intent 'reauth' that the sign-in is fresh. */
  finish(code: string, flow: { nonce: string; verifier: string; intent: ProviderIntent }, now: Date):
    Promise<{ ok: true; identity: VerifiedIdentity } | { ok: false; code: 'providerFailed' | 'providerUnavailable' }>;
}
export interface ChallengeProvider {
  readonly id: 'passkey'; readonly kind: 'challenge';
  begin(intent: ProviderIntent, account: AccountId | null, now: Date): Promise<{ challenge: string; options: unknown }>;
  finish(challenge: string, response: unknown, now: Date):
    Promise<{ ok: true; identity: VerifiedIdentity; credential?: CredentialRow } | { ok: false; code: 'providerFailed' }>;
}
export type IdentityProvider = PasswordProvider | RedirectProvider | ChallengeProvider;

/**
 * The local provider (name and password, 3.2) from the hasher and the credential tools: `createLocalProvider` of src/service/index.ts (M14-5, which
 * builds it in src/identity/local.ts). src/compose.ts puts it first in AccountServiceDeps.providers.
 */
export type CreateLocalProvider = (deps: { hasher: PasswordHasher; credentials: CredentialTools }) => PasswordProvider;
