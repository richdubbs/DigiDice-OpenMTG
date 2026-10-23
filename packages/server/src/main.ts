/**
 * Command line entry: `tsx packages/server/src/main.ts [--port 47600] [--dist <dir>] [--api-only] [--allow-origin <origin>]... [--game-address <ip>]`.
 * `--allow-origin`: an extra origin the online socket accepts, loopback only (the Vite dev server: http://127.0.0.1:5173; online/guard.ts).
 * `--game-address`: the address a hosted game's UDP port binds (default 0.0.0.0, every interface; 127.0.0.1 for a game on this machine only).
 * `--hosted-url` (M13-11; or OPENMTG_HOSTED_URL): the DigiDice game server this page may play on, `https://play.example.net` (or `http://127.0.0.1:47700` for
 * one on this machine): New game then offers "Play on the DigiDice server", and the page's Content-Security-Policy allows that one origin.
 * Prints the URL once listening. Used by `npm run play` and `npm run dev` (scripts/play.mjs, scripts/dev.mjs).
 */
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from './api';
import { warmCardCache } from './cache';
import { contextFrom, hostedSocketOrigin, startServer, type ServerOptions } from './http';

function parseArgs(argv: string[]): ServerOptions {
  const opts: ServerOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
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
  const opts = { ...parseArgs(process.argv.slice(2)), version: pkg.version };
  const running = await startServer(opts);
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
