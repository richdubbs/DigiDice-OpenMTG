#!/usr/bin/env node
/**
 * `npm run test:all`: every test, the slow suites included (OPENMTG_SLOW=1: soak games, game marathons, whole-index corpus tests, the release-gate CLI
 * run; see packages/engine/test/slow.ts). This is the merge-time verification; `npm test` is the fast default suite for everyday work.
 *
 *   npm run test:all                       # everything
 *   npm run test:all -- --maxWorkers=2     # Vitest options pass through
 *
 * The whole-index tests need the local card cache (npm run cards -- refresh); from a git worktree they find the main checkout's
 * .cache/scryfall, or set OPENMTG_CACHE_DIR. Without a cache they are skipped as before.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, OPENMTG_SLOW: '1' } });
if (r.error) throw r.error;
process.exit(r.status ?? 1);
