/**
 * The engine build (docs/design/online.md, versions.ts): a hash of every source file of the engine package, so any change to engine code makes two builds
 * different. Node only, and on purpose free of any other import: RPL-0 (replays design 5) computes the same value at build time in the client's Vite
 * config (packages/client/vite.config.ts), which loads this file directly, so the browser's replays and the local server's handshake agree.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';

const SOURCE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/;

/** A hash of the source files under `dir` (paths and contents; line endings normalized, so checkouts on Windows and Linux agree). */
export function fingerprintDirectory(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && SOURCE.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  const rel = (p: string) => relative(dir, p).split(sep).join('/');
  files.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));
  const h = createHash('sha256');
  for (const f of files) {
    h.update(rel(f)).update('\0');
    h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).update('\0');
  }
  return h.digest('hex');
}

/**
 * The engine build as seen from the module at `fromUrl` (an `import.meta.url`): the fingerprint of the directory of `@openmtg/engine`'s entry file (its
 * `src`), or null when it cannot be read (a bundled build).
 */
export function engineBuildFrom(fromUrl: string): string | null {
  try {
    return fingerprintDirectory(dirname(createRequire(fromUrl).resolve('@openmtg/engine')));
  } catch {
    return null;
  }
}
