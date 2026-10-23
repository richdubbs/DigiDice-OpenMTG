import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { engineBuildFrom } from '../net/src/protocol/fingerprint';
import { brandAssets } from './build/brand-assets';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * RPL-0 (replays design 5): the engine build of this client, `__OPENMTG_ENGINE_BUILD__` (src/engine-build.ts). It is packages/net's fingerprint of the
 * engine's sources, the value the local server's handshake sends (`localEngineBuild`, protocol/versions.ts), computed when the build is made; null when
 * the sources cannot be read. A replay records it, and one made under the same build is exact by construction. The build scripts that also bundle the
 * server (scripts/build-exe.mjs, build-installer.mjs) compute it once and hand it here as `OPENMTG_ENGINE_BUILD`, so the page and the bundled server
 * send the same value. The client's tests use a fixed value instead (vitest.config.ts).
 */
const GIVEN_BUILD = process.env['OPENMTG_ENGINE_BUILD'];
export const ENGINE_BUILD: string | null = GIVEN_BUILD !== undefined && /^[0-9a-f]{64}$/.test(GIVEN_BUILD) ? GIVEN_BUILD : engineBuildFrom(import.meta.url);

/**
 * RPL-0 review (replays design 4): the app a replay records it was saved by (`ReplayApp`, `__OPENMTG_APP__`, src/engine-build.ts). The version is what
 * the local server reports as the app's (`OPENMTG_APP_VERSION` when a build script sets it: the desktop installer's version, the exe's), else the root
 * package.json's; the commit is the short hash of the checkout's HEAD, null outside a git checkout.
 */
export function appRecord(): { version: string; commit: string | null } {
  const env = process.env['OPENMTG_APP_VERSION'];
  const version = env !== undefined && env !== '' ? env : (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
  let commit: string | null;
  try {
    commit = git('rev-parse', '--short=8', 'HEAD') || null;
  } catch {
    commit = null;
  }
  return { version, commit };
}

/**
 * The build stamp shown in the footer (app/Footer.tsx): the commit this build was made from and its date, plus "+ local edits" when tracked files had
 * uncommitted changes. It lets the owner see at a glance whether the build they are testing has the latest changes.
 */
function buildStamp(): string {
  try {
    const stamp = git('log', '-1', '--format=%h · %cd', '--date=format-local:%b %d, %H:%M');
    return git('status', '--porcelain', '--untracked-files=no') === '' ? stamp : `${stamp} + local edits`;
  } catch {
    return 'unknown';
  }
}
/** The local server (packages/server); keep in sync with DEFAULT_PORT in packages/server/src/api.ts. */
const SERVER = 'http://127.0.0.1:47600';

export default defineConfig(({ command }) => ({
  root: here,
  plugins: [react(), brandAssets(repoRoot)],
  define: {
    __OPENMTG_BUILD__: JSON.stringify(buildStamp()),
    // RPL-0 review: the dev server's engine changes under it (an edit hot-reloads the engine's code but not this value, while the API server under
    // `tsx watch` restarts with a new fingerprint), so a replay saved there carries no build and is always checked against its digests (design 5.3).
    __OPENMTG_ENGINE_BUILD__: JSON.stringify(command === 'build' ? ENGINE_BUILD : null),
    __OPENMTG_APP__: JSON.stringify(appRecord()),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // changeOrigin: the server accepts loopback Host headers only (DNS rebinding protection). ws: the online socket (/api/online/socket, milestone 9)
    // goes through the same proxy; the server accepts this page's origin only when started with --allow-origin http://127.0.0.1:5173 (scripts/dev.mjs).
    proxy: { '/api': { target: SERVER, changeOrigin: true, ws: true } },
  },
  // The rules engine is one chunk of about 1.2 MB, loaded with the first screen that needs it (app/App.tsx loads screens lazily); Home does not wait for it.
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true, chunkSizeWarningLimit: 1400 },
}));
