import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import { isolatedTestFiles } from './packages/engine/test/suite-isolation';

const root = fileURLToPath(new URL('.', import.meta.url));
/** The engine build the client's tests see (`__OPENMTG_ENGINE_BUILD__`, packages/client/src/engine-build.ts): a fixed stand-in for the real fingerprint. */
export const CLIENT_TEST_ENGINE_BUILD = 'test-engine-build';
/** The app record the client's tests see (`__OPENMTG_APP__`, packages/client/src/engine-build.ts). */
export const CLIENT_TEST_APP = { version: '0.0.0-test', commit: 'testcommit' };

// Package QT. `npm test` is the fast default suite:
//  - the slow suites are skipped (packages/engine/test/slow.ts);
//  - the `node` project's files run in worker threads that keep their module cache from file to file (each worker loads the engine and builds its
//    template set once, not once per file), except the node test files that replace modules or globals (packages/engine/test/suite-isolation.ts):
//    those run in `node-isolated`, a fresh process per file, as the client's files do.
// `npm run test:all` (OPENMTG_SLOW=1, the merge-time verification) runs everything, every file in a fresh process (as before QT); OPENMTG_ISOLATE=1
// does the same for the default suite.
const isolateAll = process.env['OPENMTG_SLOW'] === '1' || process.env['OPENMTG_ISOLATE'] === '1';
const isolated = isolatedTestFiles(root);

// Vitest 3.2 reads whether a pool recycles its workers after each file from the ROOT pool options, and whether a worker resets modules and mocks
// between files from each project's pool options. The forks pool always recycles (node-isolated, client, and everything under isolateAll); the
// threads pool (the `node` project in the default suite) keeps its workers.
// Projects on different pools would run at the same time, each with up to maxWorkers workers; `sequence.groupOrder` runs the threads group first and
// the forks group after it, so --maxWorkers stays the limit for the whole run.
const fresh = { pool: 'forks', isolate: true, poolOptions: { forks: { isolate: true } }, sequence: { groupOrder: 1 } } as const;

export default defineConfig({
  test: {
    // Says once per run whether the slow suites run.
    globalSetup: ['scripts/vitest-slow-notice.ts'],
    poolOptions: { forks: { isolate: true }, threads: { isolate: isolateAll } },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, 'packages/client/**', ...isolated],
          environment: 'node',
          ...(isolateAll
            ? fresh
            : {
                pool: 'threads',
                isolate: false,
                poolOptions: { threads: { isolate: false } },
                sequence: { groupOrder: 0 },
                // fails a file that leaves an engine table (handlers, renderers, evaluators, hook actions, capabilities) changed for the next file
                setupFiles: ['packages/engine/test/shared-state-guard.ts'],
              }),
        },
      },
      {
        // Node test files that use vi.mock, vi.stubGlobal, fake timers, ...
        extends: true,
        test: {
          name: 'node-isolated',
          include: isolated.length > 0 ? isolated : ['packages/*/test/__none__.test.ts'],
          environment: 'node',
          ...fresh,
        },
      },
      {
        // The browser client: React components under jsdom (Testing Library); only these tests get a DOM.
        extends: true,
        esbuild: { jsx: 'automatic' },
        // RPL-0: the engine build packages/client/vite.config.ts defines for the browser; a fixed value here, so tests do not hash the engine's sources.
        define: { __OPENMTG_ENGINE_BUILD__: JSON.stringify(CLIENT_TEST_ENGINE_BUILD), __OPENMTG_APP__: JSON.stringify(CLIENT_TEST_APP) },
        test: {
          name: 'client',
          include: ['packages/client/test/**/*.test.ts', 'packages/client/test/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['packages/client/test/setup.ts'],
          ...fresh,
        },
      },
    ],
  },
});
