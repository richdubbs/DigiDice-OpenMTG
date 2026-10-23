/**
 * Set by vite.config.ts when the build is made (RPL-0, replays design 5): the engine build, packages/net's fingerprint of the engine's sources (null
 * when they could not be read, and on the dev server). A fixed test value in the client's tests (vitest.config.ts). Read it through engine-build.ts.
 */
declare const __OPENMTG_ENGINE_BUILD__: string | null;

/**
 * Set by vite.config.ts (RPL-0 review): the app's version and the build's short commit, which a replay records. A fixed test value in the client's
 * tests (vitest.config.ts). Read it through engine-build.ts.
 */
declare const __OPENMTG_APP__: { version: string; commit: string | null };
