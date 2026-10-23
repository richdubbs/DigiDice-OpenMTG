/**
 * M14-5: the service core's factories (design 3.1-3.3, 3.8, 5, 6.5-6.7, 7, 8), under the names src/compose.ts imports and src/index.ts re-exports
 * (`export *`, so only these names leave this file): the account service (./core.ts and the flows it runs) and the local provider of
 * src/identity/local.ts.
 */
import type { CreateLocalProvider } from '../identity/api';
import { buildLocalProvider } from '../identity/local';
import type { CreateAccountService } from './api';
import type { ServiceDeps } from './context';
import { buildAccountService } from './core';

/** `createAccountService(deps: AccountServiceDeps): AccountService`. A deps object may also carry `now`, the service's clock (ServiceDeps). */
export const createAccountService: CreateAccountService = (deps) => buildAccountService(deps as ServiceDeps);
/** The local provider (name and password), from the hasher and the credential tools. */
export const createLocalProvider: CreateLocalProvider = (deps) => buildLocalProvider(deps);
