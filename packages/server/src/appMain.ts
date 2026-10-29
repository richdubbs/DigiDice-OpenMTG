/**
 * The local server as the Godot app starts it: `bin/openmtg-server.exe --port 0 --announce-json` (one program, built by scripts/build-godot-server.mjs).
 * Its output is main.ts's with `--announce-json`: the first line is the JSON announcement ({port, token, url}), then the usual line.
 *
 * As in the Electron desktop app (packages/desktop/src/main.ts), the card data, the compiled cache, the rules packs, the library and the replays live in
 * %APPDATA%\OpenMTG\data (OPENMTG_CACHE_DIR, when it is not set, is its `scryfall` folder), so an install that moves from the desktop app keeps them.
 * Card data more than a day old is refreshed in the background (cardData.ts) and the compiled cards warm up. No page is served: the app is the screen.
 *
 * The server stops with the app: on a "stop" line on its standard input (the app asks as it closes), or when that input ends (the app is gone, however
 * it went). Either way it closes properly first, so an online game is left with a bye and its replay is kept.
 */
import path from 'node:path';
import { DEFAULT_PORT } from './api';
import { warmCardCache } from './cache';
import { cardDataStale, refreshCardData } from './cardData';
import { announceLine } from './announce';
import { contextFrom, startServer, type RunningServer, type ServerOptions } from './http';

/** The app's version, given to the bundle (scripts/build-godot-server.mjs). */
declare const __OPENMTG_APP_VERSION__: string | undefined;
const VERSION = typeof __OPENMTG_APP_VERSION__ === 'string' ? __OPENMTG_APP_VERSION__ : '0.0.0-dev';
/** How long a closing server may take before it is ended anyway. */
const CLOSE_MS = 5000;

const appData = process.env['APPDATA']?.trim();
if (!process.env['OPENMTG_CACHE_DIR']?.trim() && appData) process.env['OPENMTG_CACHE_DIR'] = path.join(appData, 'OpenMTG', 'data', 'scryfall');

function parseArgs(argv: readonly string[]): { port: number; announce: boolean } {
  let port = DEFAULT_PORT;
  let announce = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--announce-json') announce = true;
    else if (a === '--port') {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port ${argv[i]}`);
    } else throw new Error(`Unknown argument ${a}`);
  }
  return { port, announce };
}

/** Stop when the app asks ("stop") or its end of the pipe closes; a developer's console (a TTY) is left alone. */
function stopWithTheApp(running: RunningServer): void {
  if (process.stdin.isTTY) return;
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), CLOSE_MS).unref();
    void running.close().finally(() => process.exit(0));
  };
  process.stdin.setEncoding('utf8');
  let pending = '';
  process.stdin.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    if (lines.some((l) => l.trim() === 'stop')) stop();
  });
  process.stdin.on('end', stop);
  process.stdin.on('error', stop);
}

async function main(): Promise<void> {
  const { port, announce } = parseArgs(process.argv.slice(2));
  const opts: ServerOptions = { version: VERSION, clientDist: null };
  const running = await startServer({ ...opts, port });
  if (announce) console.log(announceLine(running));
  console.log(`OpenMTG by DigiDice is running at ${running.url}`);
  stopWithTheApp(running);
  const ctx = contextFrom(opts);
  if (cardDataStale(ctx.cacheDir)) void refreshCardData(running.url);
  void warmCardCache(ctx);
  process.on('SIGINT', () => void running.close().then(() => process.exit(0)));
  process.on('SIGTERM', () => void running.close().then(() => process.exit(0)));
}

// One program (Node's single executable) runs CommonJS, which has no top-level await.
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
