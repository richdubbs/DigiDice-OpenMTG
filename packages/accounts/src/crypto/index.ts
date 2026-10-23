/**
 * The crypto part's factories (design section 4; M14-3), under the names src/compose.ts imports and src/index.ts re-exports: the scrypt hasher and
 * its priority pool (./hasher.ts, ./pool.ts, ./phc.ts) and CredentialTools (./tools.ts: the policy of ./policy.ts with the blocklist of
 * ./blocklist.ts, recovery codes, device proofs, the injected comparison). Only these two names leave this file: src/index.ts re-exports it with
 * `export *`, so anything more could clash with another part's names.
 */
import type { CreateCredentialTools, CreatePasswordHasher } from './api';
import { buildPasswordHasher } from './hasher';
import { buildCredentialTools } from './tools';

export const createCredentialTools: CreateCredentialTools = (deps) => buildCredentialTools(deps);
export const createPasswordHasher: CreatePasswordHasher = (opts) => buildPasswordHasher(opts);
