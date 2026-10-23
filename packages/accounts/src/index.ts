/**
 * `@openmtg/accounts`: the server side of accounts (milestone 14; design docs/design/m14-accounts.md). Laid out once by M14-1 so no later package
 * edits it: the browser-safe contract (./api, also `@openmtg/accounts/api`), the configuration, ids, views, the text-rule copy, the composition, every
 * seam's api.ts, and each part's index.ts, whose factories their owners fill (M14-2 names, M14-3 crypto, M14-4 store, M14-5 service, abuse and
 * audit, M14-6 moderation, M14-7 rights, M14-8 email). The command line (src/cli.ts, `openmtg-accounts`) is not re-exported.
 */
export * from './api';
export * from './config';
export * from './ids';
export * from './views';
export * from './text';
export * from './compose';

export * from './store/api';
export * from './service/api';
export * from './identity/api';
export * from './crypto/api';
export * from './names/api';
export * from './abuse/api';
export * from './audit/api';
export * from './email/api';

export * from './store/index';
export * from './service/index';
export * from './names/index';
export * from './crypto/index';
export * from './abuse/index';
export * from './audit/index';
export * from './moderation/index';
export * from './rights/index';
export * from './email/index';

// INTERFACE CHANGE (M14-13, review of M14-13): "Sign in with DigiDice", which a host builds and passes in AccountsHost.providers (M14-10 at the
// sync): the Shopify provider (createShopifyProvider, shopifyProviderFromConfig, shopifyRedirectUri, SHOPIFY_CALLBACK_PATH, ...) and the types of the
// OpenID client's fetch seam it takes. Server side only, like the rest of this entry (node:crypto); never in ./api.
export * from './identity/shopify';
export type { FetchInit, FetchLike, FetchResponse, OidcClient } from './identity/oidc';
