/**
 * Entry of the Windows executable (`npm run exe`, scripts/build-exe.mjs): a Node single executable application that bundles the server, with
 * the built client in `client/` next to it. The card data lives in `data/` next to the exe (OPENMTG_CACHE_DIR overrides): the first run downloads
 * it from Scryfall, later runs start in seconds. Opens the default browser once listening; closing the console window stops OpenMTG.
 * Flags: `--port <n>` (default 47600), `--no-open` (do not open the browser).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CardDatabase, defaultCacheDir } from '@openmtg/cards';
import { warmCardCache } from './cache';
import { contextFrom, startServer, type ServerOptions } from './http';

declare const __OPENMTG_VERSION__: string;

const base = path.dirname(process.execPath);
if (!process.env.OPENMTG_CACHE_DIR?.trim()) process.env.OPENMTG_CACHE_DIR = path.join(base, 'data', 'scryfall');

function openBrowser(url: string): void {
  spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
}

/** Keep the console window open on an error so the message can be read. */
function failAndWait(message: string): void {
  console.error(`\n${message}\nPress Enter to close this window.`);
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}

async function main(): Promise<void> {
  const cacheDir = defaultCacheDir();
  if (!existsSync(path.join(cacheDir, 'cards.jsonl'))) {
    console.log('Downloading the card data from Scryfall, first run only (a few minutes)...');
    const db = await CardDatabase.open({ allowEmpty: true, log: (m) => console.log(m) });
    await db.refresh({ force: false, index: {} });
  }
  const args = process.argv.slice(2);
  const portAt = args.indexOf('--port');
  const opts: ServerOptions = { clientDist: path.join(base, 'client'), version: __OPENMTG_VERSION__, ...(portAt >= 0 ? { port: Number(args[portAt + 1]) } : {}) };
  const running = await startServer(opts);
  console.log(`OpenMTG by DigiDice is running at ${running.url}`);
  console.log('Keep this window open while you play. Close it to stop OpenMTG.');
  void warmCardCache(contextFrom(opts));
  if (!args.includes('--no-open')) openBrowser(running.url);
  const stop = () => void running.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e: unknown) => {
  const err = e as NodeJS.ErrnoException;
  failAndWait(err.code === 'EADDRINUSE' ? 'Port 47600 is already in use: is OpenMTG already running?' : `Something went wrong: ${err.message}`);
});
