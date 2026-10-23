#!/usr/bin/env node
/**
 * `npm run installer`: build the OpenMTG desktop app (packages/desktop, Electron) and its Windows installer into release/installer/.
 *
 *   release/installer/OpenMTG-Setup-<version>.exe   the installer (NSIS): pick a folder, Start menu and desktop shortcuts, an uninstaller
 *   release/installer/win-unpacked/OpenMTG.exe      the app as the installer installs it (to try a build without installing it)
 *   release/installer/latest.yml                    the auto-update manifest: a release on GitHub carries it next to the installer
 *
 * Signed through Azure Artifact Signing with the settings in scripts/signing.local.json (git-ignored; see SIGNING below): sign in first with
 * `az login`, as an account with the Artifact Signing Certificate Profile Signer role. The first signed build installs the TrustedSigning PowerShell
 * module for the current user (electron-builder does it). `--no-sign`, or no settings file, builds unsigned (Windows then warns before running the
 * installer). No keys or secrets here.
 *
 * The version is packages/desktop/package.json's; raise it for every installer that is handed out, or auto-update cannot tell the builds apart.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('npm run installer builds the Windows installer: run it on Windows.');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = JSON.parse(readFileSync(path.join(root, 'packages', 'desktop', 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
/**
 * SIGNING: Azure Artifact Signing (see the header), read from scripts/signing.local.json:
 *   { "publisherName": "...", "endpoint": "https://<region>.codesigning.azure.net/", "certificateProfileName": "...", "codeSigningAccountName": "..." }
 * publisherName is the certificate's subject name (CN), which installed copies require of every update's signature (resources/app-update.yml).
 * To move to another certificate later, first ship an update signed as now that also accepts the new name, then sign with the new profile.
 */
const signingFile = path.join(root, 'scripts', 'signing.local.json');
const AZURE_SIGNING = existsSync(signingFile) ? JSON.parse(readFileSync(signingFile, 'utf8')) : null;
if (!AZURE_SIGNING && !process.argv.includes('--no-sign')) console.log('No scripts/signing.local.json: building unsigned.');
const sign = !process.argv.includes('--no-sign') && AZURE_SIGNING !== null;

const stage = path.join(root, 'release', '.installer-app');
const out = path.join(root, 'release', 'installer');
rmSync(stage, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(stage, 'build'), { recursive: true });
mkdirSync(path.join(stage, 'notices'), { recursive: true });

// RPL-0 review (replays design 5): one engine build for the page and the server, as in build-exe.mjs: read once from the client's Vite config, given to
// the Vite build (OPENMTG_ENGINE_BUILD) and to the app bundle (__OPENMTG_SERVER_ENGINE_BUILD__), which ships no engine sources to hash. The app version
// is the desktop app's, the one its server reports (OPENMTG_APP_VERSION).
const { build: viteBuild, loadConfigFromFile } = await import('vite');
const clientConfig = path.join(root, 'packages', 'client', 'vite.config.ts');
process.env.OPENMTG_APP_VERSION = desktop.version;
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, clientConfig, undefined, 'warn');
const engineBuild = JSON.parse(String(loaded?.config.define?.__OPENMTG_ENGINE_BUILD__ ?? 'null'));
if (typeof engineBuild !== 'string') throw new Error('The engine build could not be computed (packages/engine/src).');
process.env.OPENMTG_ENGINE_BUILD = engineBuild;

console.log('Building the client...');
await viteBuild({ configFile: clientConfig, logLevel: 'warn' });
cpSync(path.join(root, 'packages', 'client', 'dist'), path.join(stage, 'client'), { recursive: true });

console.log('Bundling the app (Electron main process with the server)...');
const { build: esbuild } = await import('esbuild');
await esbuild({
  entryPoints: [path.join(root, 'packages', 'desktop', 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(stage, 'main.cjs'),
  // electron is the runtime; ws's optional native speedups: absent, ws falls back to JavaScript
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  define: { __OPENMTG_VERSION__: JSON.stringify(desktop.version), __OPENMTG_SERVER_ENGINE_BUILD__: JSON.stringify(engineBuild), 'import.meta.url': '__openmtgImportMetaUrl' },
  banner: { js: 'const __openmtgImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: 'warning',
});

for (const f of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PLAYING.md']) copyFileSync(path.join(root, f), path.join(stage, 'notices', f));
copyFileSync(path.join(root, 'assets', 'brand', 'digidice-mark-transparent.png'), path.join(stage, 'build', 'icon.png'));
writeFileSync(
  path.join(stage, 'package.json'),
  `${JSON.stringify({ name: 'openmtg', productName: 'OpenMTG', version: desktop.version, description: 'OpenMTG by DigiDice', author: { name: 'DigiDice LLC' }, license: 'MIT', main: 'main.cjs' }, null, 2)}\n`,
);

console.log(`Packaging with Electron ${electronVersion}${sign ? ', signed through Azure Artifact Signing' : ', unsigned'}...`);
const builder = await import('electron-builder');
await builder.build({
  projectDir: stage,
  targets: builder.Platform.WINDOWS.createTarget(['nsis'], builder.Arch.x64),
  publish: 'never',
  config: {
    appId: 'net.digidice.openmtg',
    productName: 'OpenMTG',
    copyright: 'Copyright © 2026 DigiDice LLC',
    electronVersion,
    directories: { output: out, buildResources: path.join(stage, 'build') },
    files: ['main.cjs', 'package.json'],
    asar: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    extraResources: [{ from: 'client', to: 'client' }],
    extraFiles: [{ from: 'notices', to: '.' }],
    win: {
      target: 'nsis',
      icon: 'icon.png',
      ...(sign ? { azureSignOptions: AZURE_SIGNING } : {}),
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'OpenMTG',
      uninstallDisplayName: 'OpenMTG',
      deleteAppDataOnUninstall: false,
      artifactName: 'OpenMTG-Setup-${version}.${ext}',
    },
    // Installed copies read the GitHub Releases of the repository at every launch (packages/desktop/src/update.ts) and install a newer version by
    // themselves; the installer, its .blockmap and latest.yml are uploaded to a release by hand (gh release create v<version> ...).
    publish: [{ provider: 'github', owner: 'richdubbs', repo: 'DigiDice-OpenMTG', releaseType: 'release' }],
  },
});
rmSync(stage, { recursive: true, force: true });
console.log(`Done: ${path.join(out, `OpenMTG-Setup-${desktop.version}.exe`)}`);
