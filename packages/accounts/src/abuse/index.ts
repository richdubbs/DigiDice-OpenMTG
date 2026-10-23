/**
 * M14-5: the abuse controls' factories (design 8.1-8.4), under the names src/compose.ts imports and src/index.ts re-exports (`export *`, so only
 * these names leave this file): the proof-of-work verifier (./work.ts), the verifier for CAPTCHA=none, and the rate limits with the sign-in guard
 * (./limiter.ts, ./signin.ts; ./bucket.ts is the copy of net's token bucket, ./address.ts the address aggregates, ./counters.ts the fixed-size maps).
 */
import type { CreateNoVerifier, CreateRateLimiter, CreateWorkVerifier } from './api';
import { buildRateLimiter } from './limiter';
import { buildNoVerifier, buildWorkVerifier } from './work';

export const createWorkVerifier: CreateWorkVerifier = (opts) => buildWorkVerifier(opts);
export const createNoVerifier: CreateNoVerifier = () => buildNoVerifier();
export const createRateLimiter: CreateRateLimiter = (opts) => buildRateLimiter(opts);
