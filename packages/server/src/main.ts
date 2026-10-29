/**
 * Command line entry: `tsx packages/server/src/main.ts [--port 47600] [--dist <dir>] [--api-only] [--allow-origin <origin>]... [--game-address <ip>] [--announce-json]`.
 * `--allow-origin`: an extra origin the online socket accepts, loopback only (the Vite dev server: http://127.0.0.1:5173; online/guard.ts).
 * `--game-address`: the address a hosted game's UDP port binds (default 0.0.0.0, every interface; 127.0.0.1 for a game on this machine only).
 * `--hosted-url` (M13-11; or OPENMTG_HOSTED_URL): the DigiDice game server this page may play on, `https://play.example.net` (or `http://127.0.0.1:47700` for
 * one on this machine): New game then offers "Play on the DigiDice server", and the page's Content-Security-Policy allows that one origin.
 * Prints the URL once listening ("OpenMTG by DigiDice is running at http://127.0.0.1:<port>"), which `npm run play` and `npm run dev` read (scripts/play.mjs,
 * scripts/dev.mjs).
 * `--announce-json` (or OPENMTG_ANNOUNCE_JSON=1; Godot plan phase 2, for a shell that starts this server and reads its output: the Godot app): the FIRST line
 * printed is then exactly one JSON object, `{"port":<n>,"token":"<token>","url":"http://127.0.0.1:<n>"}` (the port it listens on, the per-launch token of
 * the table channel and the online socket, and its address), and the usual lines follow. Without it the output is as before (the token is not printed).
 */
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceLine } from './announce';
import { DEFAULT_PORT } from './api';
import { warmCardCache } from './cache';
import { contextFrom, hostedSocketOrigin, startServer, type ServerOptions } from './http';

/** Whether the environment asks for the JSON announcement (OPENMTG_ANNOUNCE_JSON=1, or true/yes). */
function announceFromEnv(): boolean {
  return /^(1|true|yes)$/i.test(process.env['OPENMTG_ANNOUNCE_JSON']?.trim() ?? '');
}

function parseArgs(argv: string[]): ServerOptions & { announceJson?: boolean } {
  const opts: ServerOptions & { announceJson?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--announce-json') opts.announceJson = true;
    else if (a === '--port') {
      const port = Number(argv[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port ${argv[i]}`);
      opts.port = port;
    } else if (a === '--dist') opts.clientDist = path.resolve(argv[++i] ?? '');
    else if (a === '--api-only') opts.clientDist = null;
    else if (a === '--allow-origin') {
      const online = opts.online === false ? {} : (opts.online ?? {});
      opts.online = { ...online, allowOrigins: [...(online.allowOrigins ?? []), argv[++i] ?? ''] };
    } else if (a === '--game-address') {
      const address = argv[++i] ?? '';
      if (!isIP(address)) throw new Error(`Invalid --game-address ${address} (an IP address of this machine, or 0.0.0.0)`);
      const online = opts.online === false ? {} : (opts.online ?? {});
      opts.online = { ...online, bridge: { ...online.bridge, bindAddress: address } };
    } else if (a === '--hosted-url') {
      const url = argv[++i] ?? '';
      hostedSocketOrigin(url); // throws on an address that cannot be used
      opts.hostedUrl = url;
    } else throw new Error(`Unknown argument ${a}`);
  }
  return opts;
}

const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string };

try {
  const { announceJson, ...opts } = { ...parseArgs(process.argv.slice(2)), version: pkg.version };
  const running = await startServer(opts);
  if (announceJson === true || announceFromEnv()) console.log(announceLine(running));
  console.log(`OpenMTG by DigiDice is running at ${running.url}`);
  void warmCardCache(contextFrom(opts)); // C1: open the card index and build the classification index in the background
  const stop = () => void running.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  if (err.code === 'EADDRINUSE') console.error(`Port ${DEFAULT_PORT} (or the one given) is already in use: is OpenMTG already running? Use --port to pick another.`);
  else console.error(err.message);
  process.exit(1);
}
