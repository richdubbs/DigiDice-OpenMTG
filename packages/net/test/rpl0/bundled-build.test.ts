/**
 * RPL-0 review (replays design 5): a bundled server (the Windows exe, the desktop app) ships no engine sources to hash, so its handshake sent no engine
 * build, or the hash of whatever checkout surrounded the exe, while its page carried the build it was made from. The build scripts now define the
 * build they computed for the page (`__OPENMTG_SERVER_ENGINE_BUILD__`), and `localEngineBuild` prefers it. Bundled here the way the scripts bundle
 * (esbuild with the define), the build reaches the code as the literal.
 */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { localVersions } from '../../src/index';

const versions = fileURLToPath(new URL('../../src/protocol/versions.ts', import.meta.url));

async function bundled(define: Record<string, string>): Promise<string> {
  const out = await build({ entryPoints: [versions], bundle: true, write: false, platform: 'node', format: 'esm', external: ['@openmtg/engine'], define, logLevel: 'silent' });
  return out.outputFiles[0]!.text;
}

describe('RPL-0 review: the engine build of a bundled server', () => {
  it('is the build the bundle was made with, when the build script defines it', async () => {
    const given = 'cd'.repeat(32);
    const text = await bundled({ __OPENMTG_SERVER_ENGINE_BUILD__: JSON.stringify(given) });
    expect(text).toContain(JSON.stringify(given));
    expect(text).not.toContain('__OPENMTG_SERVER_ENGINE_BUILD__');
  });

  it('is the fingerprint of the engine sources when not bundled (the dev server, the tests)', async () => {
    expect(localVersions(null).build).toMatch(/^[0-9a-f]{64}$/);
    expect(await bundled({})).toContain('typeof __OPENMTG_SERVER_ENGINE_BUILD__');
  });
});
