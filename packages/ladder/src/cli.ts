#!/usr/bin/env tsx
/**
 * `openmtg-ladder <command>` (design 11.2, 11.3, 13.3; M15-3), the package's `bin` entry: commands the owner runs on the server, never a network
 * endpoint. Both open the file store in `--dir`, else `<DATA_DIR>/ladder` (DATA_DIR as hosted reads it, default `data`), and are refused while the
 * server holds its lock ("the ladder store is in use: stop the server, or use PostgreSQL"), so a server never overwrites a command's write.
 *
 *   openmtg-ladder reports [--since <ISO time>] [--limit <1-100000>] [--dir <path>]
 *       The stored abuse reports created since then (default: all), oldest first, one JSON object a line (11.2: until milestone 14 is wired the
 *       sink refuses everything and they stay pending).
 *   openmtg-ladder reset <account> <ladder> --by <moderator> --reason <text> [--dir <path>]
 *       A moderator's rating reset (11.3): the account's rating in the ladder back to the initial state with placement again, with its audit row,
 *       which is printed. Nothing is recomputed.
 *   openmtg-ladder help
 *
 * **The store is never made here** (review of M15-3): a directory that holds no ladder store is refused ("no ladder store in <dir>"), so a command
 * pointed at the wrong place cannot act on a new, empty store beside the server's (and miss the server's lock). A relative `--dir` or DATA_DIR is
 * taken from the directory the command was started in: npm's INIT_CWD when npm runs it (`npm run ladder -w @openmtg/ladder` runs in
 * packages/ladder), else the working directory. The absolute directory is printed on stderr before the command runs, and is in every refusal.
 *
 * Exit codes: 0 done, 1 refused (no store there, the store in use, damaged or refusing the write), 2 a usage error.
 * Run with `npm run ladder -w @openmtg/ladder -- <args>` or, once installed, `openmtg-ladder <args>` (tsx on the PATH). Not re-exported by
 * src/index.ts.
 */
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLadderId, type LadderId } from './api';
import { isoMs } from './api/season';
import type { AccountId } from './accounts';
import { checkResetArgs, resetRatingIn } from './service/reset';
import { openFileLadderStore, type FileLadderStore } from './store/file';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  /** Ms since the epoch (the reset's time). */
  now: () => number;
  /** The directory a relative path is taken from when the environment has no INIT_CWD (default: process.cwd()). */
  cwd?: () => string;
}

const defaultIo: CliIo = {
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
  env: process.env,
  now: () => Date.now(),
  cwd: () => process.cwd(),
};

export const USAGE = [
  'usage:',
  '  openmtg-ladder reports [--since <ISO time>] [--limit <1-100000>] [--dir <path>]',
  '  openmtg-ladder reset <account> <ladder> --by <moderator> --reason <text> [--dir <path>]',
  '  openmtg-ladder help',
  'The store is <DATA_DIR>/ladder (DATA_DIR default "data") unless --dir names it, a relative path taken from the directory the command was run in.',
  'It must be there (the command never makes one), and both commands refuse while the server runs.',
].join('\n');

class UsageError extends Error {}

/** Positional arguments and --name value options; an option given twice, without a value or unknown is a usage error. */
function parse(args: readonly string[], options: readonly string[]): { positional: string[]; opts: Map<string, string> } {
  const positional: string[] = [];
  const opts = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (!options.includes(name)) throw new UsageError(`unknown option --${name}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    if (opts.has(name)) throw new UsageError(`--${name} is given twice`);
    opts.set(name, value);
    i++;
  }
  return { positional, opts };
}

/** The store's absolute directory: --dir, else <DATA_DIR>/ladder; a relative one from INIT_CWD (where npm was run) or the working directory. */
function storeDir(opts: Map<string, string>, io: CliIo): string {
  const base = io.env['INIT_CWD'] || (io.cwd ?? (() => process.cwd()))();
  return resolve(base, opts.get('dir') ?? join(io.env['DATA_DIR'] || 'data', 'ladder'));
}

/** `e`'s message, with the store's directory unless it names it already. */
function inDir(e: unknown, dir: string): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes(dir) ? message : `${message} (the ladder store in ${dir})`;
}

/** Opens the store that is in `dir` (never a new one), runs `f` and closes it; every refusal names the directory. */
async function withStore<R>(command: string, dir: string, io: CliIo, f: (store: FileLadderStore) => Promise<R>): Promise<R> {
  io.stderr(`openmtg-ladder: ${command} on the ladder store in ${dir}\n`);
  let store: FileLadderStore;
  try {
    store = await openFileLadderStore({ dir, mustExist: true, onWarning: (m) => io.stderr(`openmtg-ladder: ${m}\n`) });
  } catch (e) {
    throw new Error(inDir(e, dir), { cause: e });
  }
  let out: R;
  try {
    out = await f(store);
  } catch (e) {
    await store.close().catch(() => undefined);
    if (e instanceof UsageError) throw new UsageError(inDir(e, dir));
    throw new Error(inDir(e, dir), { cause: e });
  }
  try {
    await store.close();
  } catch (e) {
    throw new Error(inDir(e, dir), { cause: e });
  }
  return out;
}

async function reports(args: readonly string[], io: CliIo): Promise<number> {
  const { positional, opts } = parse(args, ['since', 'limit', 'dir']);
  if (positional.length > 0) throw new UsageError(`reports takes no argument (${positional[0]})`);
  const since = opts.get('since') ?? '1970-01-01T00:00:00.000Z';
  try {
    isoMs(since);
  } catch {
    throw new UsageError(`--since is not an ISO-8601 UTC time (${since})`);
  }
  const limitText = opts.get('limit') ?? '100000';
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) throw new UsageError('--limit must be from 1 to 100000');
  await withStore('reports', storeDir(opts, io), io, async (store) => {
    for (const r of await store.reports(since, limit)) io.stdout(`${JSON.stringify(r)}\n`);
  });
  return 0;
}

async function reset(args: readonly string[], io: CliIo): Promise<number> {
  const { positional, opts } = parse(args, ['by', 'reason', 'dir']);
  if (positional.length !== 2) throw new UsageError('reset takes an account and a ladder');
  const [account, ladder] = positional as [string, string];
  if (!isLadderId(ladder)) throw new UsageError(`${ladder} is not a ladder id`);
  const by = opts.get('by');
  const reason = opts.get('reason');
  if (by === undefined || reason === undefined) throw new UsageError('reset needs --by and --reason');
  // the arguments are checked before the store is opened
  try {
    checkResetArgs(account, ladder, by, reason);
  } catch (e) {
    if (e instanceof RangeError) throw new UsageError(e.message);
    throw e;
  }
  const audit = await withStore('reset', storeDir(opts, io), io, async (store) => {
    try {
      return await resetRatingIn(store, account as AccountId, ladder as LadderId, by, reason, io.now());
    } catch (e) {
      if (e instanceof RangeError) throw new UsageError(e.message);
      throw e;
    }
  });
  io.stdout(`${JSON.stringify(audit)}\n`);
  return 0;
}

/** Runs the command line; resolves to the process exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'reports') return await reports(rest, io);
    if (command === 'reset') return await reset(rest, io);
    if (command === 'help' || command === '--help' || command === '-h') {
      io.stdout(`${USAGE}\n`);
      return 0;
    }
    throw new UsageError(command === undefined ? 'no command' : `unknown command ${command}`);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`openmtg-ladder: ${e.message}\n${USAGE}\n`);
      return 2;
    }
    // no store there, the lock ('locked': the server runs), a damaged store ('corrupt') or anything else the store or the file system refused
    io.stderr(`openmtg-ladder: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`openmtg-ladder: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 2;
    },
  );
}
