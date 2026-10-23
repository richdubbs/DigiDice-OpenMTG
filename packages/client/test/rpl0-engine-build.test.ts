// @vitest-environment node
/**
 * RPL-0 (replays design 5): the client's Vite config defines `__OPENMTG_ENGINE_BUILD__` as packages/net's fingerprint of the engine's sources, the value
 * the local server's handshake sends (`localVersions().build`), so a replay saved in the browser and the host server's replay of the same checkout agree.
 *
 * RPL-0 review: on the dev server the engine changes under the page (an edit hot-reloads the engine but not a define), so it defines no build there; a
 * build script that also bundles the server hands the build in (`OPENMTG_ENGINE_BUILD`), so page and server agree; the config also defines the app record
 * a replay carries (`__OPENMTG_APP__`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localVersions } from '@openmtg/net';
import { loadConfigFromFile, type ConfigEnv, type UserConfig, type UserConfigFnObject } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import config, { appRecord, ENGINE_BUILD } from '../vite.config';
import { APP } from '../src/engine-build';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const env = (command: ConfigEnv['command']): ConfigEnv => ({ command, mode: command === 'build' ? 'production' : 'development' });
const defineOf = (command: ConfigEnv['command']): Record<string, unknown> => ((config as UserConfigFnObject)(env(command)) as UserConfig).define ?? {};

const saved = { build: process.env['OPENMTG_ENGINE_BUILD'], app: process.env['OPENMTG_APP_VERSION'] };
afterEach(() => {
  for (const [k, v] of [['OPENMTG_ENGINE_BUILD', saved.build], ['OPENMTG_APP_VERSION', saved.app]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('RPL-0: the browser engine build', () => {
  it('is the local server handshake build in a build: a SHA-256 of the engine sources', () => {
    const build = localVersions(null).build;
    expect(build).toMatch(/^[0-9a-f]{64}$/);
    expect(ENGINE_BUILD).toBe(build);
    expect(defineOf('build')['__OPENMTG_ENGINE_BUILD__']).toBe(JSON.stringify(build));
  }, 120_000);

  it('RPL-0 review: is null on the dev server, whose engine changes under the page (its replays are checked against their digests)', () => {
    expect(defineOf('serve')['__OPENMTG_ENGINE_BUILD__']).toBe('null');
  });

  it('RPL-0 review: is the build a build script hands in (OPENMTG_ENGINE_BUILD), read as scripts/build-exe.mjs and build-installer.mjs read it', async () => {
    const given = 'ab'.repeat(32);
    process.env['OPENMTG_ENGINE_BUILD'] = given;
    const loaded = await loadConfigFromFile(env('build'), configFile, undefined, 'silent');
    expect(loaded?.config.define?.['__OPENMTG_ENGINE_BUILD__']).toBe(JSON.stringify(given));
    process.env['OPENMTG_ENGINE_BUILD'] = 'not a build';
    const ignored = await loadConfigFromFile(env('build'), configFile, undefined, 'silent');
    expect(ignored?.config.define?.['__OPENMTG_ENGINE_BUILD__']).toBe(JSON.stringify(localVersions(null).build));
  }, 120_000);
});

describe('RPL-0 review: the app record a replay carries (replays design 4)', () => {
  it('is the app version (the root package.json, or what a build script sets) and the short commit of the checkout', () => {
    delete process.env['OPENMTG_APP_VERSION'];
    const root = path.resolve(path.dirname(configFile), '..', '..');
    const rec = appRecord();
    expect(rec.version).toBe((JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version);
    expect(rec.commit === null || /^[0-9a-f]{8,}$/.test(rec.commit)).toBe(true);
    process.env['OPENMTG_APP_VERSION'] = '0.2.3';
    expect(appRecord().version).toBe('0.2.3');
    expect(defineOf('build')['__OPENMTG_APP__']).toBe(JSON.stringify(appRecord()));
  });

  it('reaches the client as APP (a fixed value in tests)', () => {
    expect(APP).toEqual({ version: '0.0.0-test', commit: 'testcommit' });
  });
});
