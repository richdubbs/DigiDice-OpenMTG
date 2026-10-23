#!/usr/bin/env node
/**
 * `npm run desktop`: put the latest OpenMTG on your Desktop (%USERPROFILE%\Desktop\OpenMTG\OpenMTG.exe), to open it from there for testing.
 *
 *   1. Bring this folder up to GitHub's latest `main` (fast-forward only; stops if the folder is on another branch or cannot fast-forward).
 *   2. Stop any running OpenMTG.exe: the exe file is locked while it runs, and an old one keeps the game's address (127.0.0.1:47600).
 *   3. Build the exe (scripts/build-exe.mjs) into release/desktop-build and copy the exe, client and notices over the Desktop copy. data/ (card data)
 *      is left alone.
 *   4. Print the build stamp the game's footer shows.
 *
 *   npm run desktop                 # as above
 *   npm run desktop -- --no-pull    # skip step 1 (build what is in this folder now)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('npm run desktop builds the Windows exe: run it on Windows.');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(os.homedir(), 'Desktop', 'OpenMTG');
const buildOut = path.join(root, 'release', 'desktop-build', 'OpenMTG');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (!process.argv.includes('--no-pull')) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') throw new Error(`This folder is on "${branch}", not main: switch it back to main first.`);
  console.log('Getting the latest main from GitHub...');
  execFileSync('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: root, stdio: 'inherit' });
}

console.log('Stopping any running OpenMTG.exe...');
try {
  execFileSync('taskkill', ['/IM', 'OpenMTG.exe', '/T', '/F'], { stdio: 'ignore' });
} catch {
  // none running
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'build-exe.mjs'), '--out', buildOut], { cwd: root, stdio: 'inherit' });

mkdirSync(desktop, { recursive: true });
for (const f of ['OpenMTG.exe', 'client', 'LICENSE', 'NOTICE', 'PLAYING.md', 'THIRD_PARTY_NOTICES.md']) {
  const to = path.join(desktop, f);
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  cpSync(path.join(buildOut, f), to, { recursive: true });
}

const stamp = git('log', '-1', '--format=%h · %cd', '--date=format-local:%b %d, %H:%M');
const edits = git('status', '--porcelain', '--untracked-files=no') === '' ? '' : ' + local edits';
console.log(`\nDesktop OpenMTG updated: ${path.join(desktop, 'OpenMTG.exe')}\nThe footer shows: Build ${stamp}${edits}`);
