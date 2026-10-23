#!/usr/bin/env node
/**
 * `npm run exe`: build the Windows executable into release/OpenMTG/ (and release/OpenMTG-<version>-win-x64.zip).
 *
 *   release/OpenMTG/OpenMTG.exe   Node single executable application: the server bundled (packages/server/src/exe.ts)
 *   release/OpenMTG/client/       the built client
 *   release/OpenMTG/data/         card data, downloaded from Scryfall on the first run (never shipped)
 *
 * Uses the Node that runs this script as the exe's runtime (https://nodejs.org/api/single-executable-applications.html).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('npm run exe builds a Windows executable: run it on Windows.');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
// `--out <dir>`: build into another folder (e.g. while release/OpenMTG/OpenMTG.exe is running and locked).
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'release', 'OpenMTG');
const work = path.join(path.dirname(out), '.build');
rmSync(work, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });

// RPL-0 review (replays design 5): one engine build for the page and the server. The client's Vite config computes the fingerprint of the engine's
// sources (packages/net protocol/fingerprint.ts); it is read here once and given to the Vite build (OPENMTG_ENGINE_BUILD, which the config prefers)
// and to the server bundle (__OPENMTG_SERVER_ENGINE_BUILD__), which ships no engine sources to hash. The app version is the one the exe's server
// reports (OPENMTG_APP_VERSION).
const { build: viteBuild, loadConfigFromFile } = await import('vite');
const clientConfig = path.join(root, 'packages', 'client', 'vite.config.ts');
process.env.OPENMTG_APP_VERSION = pkg.version;
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, clientConfig, undefined, 'warn');
const engineBuild = JSON.parse(String(loaded?.config.define?.__OPENMTG_ENGINE_BUILD__ ?? 'null'));
if (typeof engineBuild !== 'string') throw new Error('The engine build could not be computed (packages/engine/src).');
process.env.OPENMTG_ENGINE_BUILD = engineBuild;

console.log('Building the client...');
await viteBuild({ configFile: clientConfig, logLevel: 'warn' });
cpSync(path.join(root, 'packages', 'client', 'dist'), path.join(out, 'client'), { recursive: true });

console.log('Bundling the server...');
const { build: esbuild } = await import('esbuild');
const bundle = path.join(work, 'openmtg.cjs');
await esbuild({
  entryPoints: [path.join(root, 'packages', 'server', 'src', 'exe.ts')],
  bundle: true,
  platform: 'node',
  target: `node${process.versions.node.split('.')[0]}`,
  format: 'cjs',
  outfile: bundle,
  // ws's optional native speedups: absent, ws falls back to JavaScript
  external: ['bufferutil', 'utf-8-validate'],
  define: { __OPENMTG_VERSION__: JSON.stringify(pkg.version), __OPENMTG_SERVER_ENGINE_BUILD__: JSON.stringify(engineBuild), 'import.meta.url': '__openmtgImportMetaUrl' },
  banner: { js: 'const __openmtgImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: 'warning',
});

console.log('Packing OpenMTG.exe...');
const blob = path.join(work, 'sea-prep.blob');
const seaConfig = path.join(work, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
const exe = path.join(out, 'OpenMTG.exe');
copyFileSync(process.execPath, exe);
const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });

for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PLAYING.md']) copyFileSync(path.join(root, f), path.join(out, f));
rmSync(work, { recursive: true, force: true });

const zip = path.join(path.dirname(out), `OpenMTG-${pkg.version}-win-x64.zip`);
rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}'`], { stdio: 'inherit' });
console.log(`Done: ${exe}\n      ${zip}`);
