#!/usr/bin/env tsx
/**
 * `openmtg-hosted inbox ...` (design 4.8, 13.1 M13-13), the package's `bin` entry: the owner reads the bug inbox with a command on the server, never a
 * network endpoint. Run with `npm run hosted -w @openmtg/hosted -- inbox ...` or, once installed, `openmtg-hosted inbox ...` (tsx on the PATH).
 *
 *   openmtg-hosted inbox [list] [--status new|read|closed|all] [--kind bug|title] [--since <date>|<n>d] [--limit <n>]   (default: the new reports)
 *   openmtg-hosted inbox show <id> [--keep]            one report in full; marks a new one as read unless --keep
 *   openmtg-hosted inbox read|close|reopen <id>        a report's status (read, closed, new)
 *   openmtg-hosted inbox export <id> [--out <file>]    a hosted game's report as a bug report file for `npm run bug -- replay <file>`
 *
 * It reads the server's own configuration from the environment (`STORE`, `DATA_DIR`, `DATABASE_URL`; config.ts) and opens the store as the server does
 * (inbox/open.ts). The file store is one process's: the command refuses while the server runs (its run lock, inbox/lock.ts: "stop the server, or use
 * PostgreSQL"); PostgreSQL runs beside the server. Everything a player wrote is printed without control characters (inbox/format.ts).
 *
 * Exit codes: 0 done; 1 refused or failed (no such report, no game log, a store that cannot be opened); 2 a command line or configuration problem;
 * 3 `export` wrote the file but this build plays the game differently from the server (the notes say where).
 */
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGzippedJson } from '@openmtg/engine';
import { exportLines, listLines, shown, showLines } from './inbox/format';
import { Inbox, REPORT_STATUSES, type ReportQuery, type ReportStatus } from './inbox/inbox';
import { openConfiguredStore } from './inbox/open';
import type { GameStore } from './store/api';

export const USAGE = [
  'usage: openmtg-hosted inbox [list] [--status new|read|closed|all] [--kind bug|title] [--since <date>|<n>d] [--limit <n>]',
  '       openmtg-hosted inbox show <id> [--keep]',
  '       openmtg-hosted inbox read|close|reopen <id>',
  '       openmtg-hosted inbox export <id> [--out <file>]',
].join('\n');

/** What the command line reads and writes; the process's own by default (tests pass their own). */
export interface CliIo {
  env?: Readonly<Record<string, string | undefined>>;
  out?: (text: string) => void;
  err?: (text: string) => void;
  /** Where relative file names are written (the process's working directory by default; npm runs workspace scripts in the package's directory). */
  cwd?: string;
  now?: () => Date;
  /** Tests: a store to use instead of the configured one (it is not closed here). */
  store?: GameStore;
}

class UsageError extends Error {}

interface Parsed {
  command: 'list' | 'show' | 'status' | 'export';
  id: string | null;
  query: ReportQuery;
  status: ReportStatus | null;
  keep: boolean;
  out: string | null;
}

const STATUS_COMMANDS: Readonly<Record<string, ReportStatus>> = { read: 'read', close: 'closed', reopen: 'new' };

/** `--since`: an ISO date or time, or a number of days back ("7d"). */
function sinceOf(text: string, now: Date): Date {
  const days = /^(\d{1,5})d$/.exec(text);
  if (days) return new Date(now.getTime() - Number(days[1]) * 86_400_000);
  const t = Date.parse(text);
  if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}/.test(text)) throw new UsageError(`--since: "${shown(text, 40)}" is neither a date (2026-10-15) nor a number of days (7d)`);
  return new Date(t);
}

function parse(args: readonly string[], now: Date): Parsed {
  const [first, ...rest] = args;
  // the command word may be left out: options only means list
  const named = first !== undefined && !first.startsWith('--');
  const word = named ? first : 'list';
  const options = named ? rest : [...args];
  const p: Parsed = { command: 'list', id: null, query: { status: 'new' }, status: null, keep: false, out: null };
  const take = (name: string, i: number): string => {
    const v = options[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
    return v;
  };
  const positional: string[] = [];
  for (let i = 0; i < options.length; i++) {
    const o = options[i]!;
    if (!o.startsWith('--')) positional.push(o);
    else if (o === '--keep') p.keep = true;
    else if (o === '--status') {
      const v = take(o, i++);
      if (v !== 'all' && !(REPORT_STATUSES as readonly string[]).includes(v)) throw new UsageError('--status is new, read, closed or all');
      p.query.status = v as ReportStatus | 'all';
    } else if (o === '--kind') {
      const v = take(o, i++);
      if (v !== 'bug' && v !== 'title') throw new UsageError('--kind is bug or title');
      p.query.kind = v;
    } else if (o === '--since') p.query.since = sinceOf(take(o, i++), now);
    else if (o === '--limit') {
      const v = take(o, i++);
      if (!/^\d{1,4}$/.test(v) || Number(v) < 1) throw new UsageError('--limit is a number from 1 to 9999');
      p.query.limit = Number(v);
    } else if (o === '--out') p.out = take(o, i++);
    else throw new UsageError(`unknown option ${shown(o, 40)}`);
  }
  const needsId = (): string => {
    if (positional.length !== 1) throw new UsageError(`${word} takes one report id`);
    return positional[0]!;
  };
  if (word === 'list') {
    if (positional.length > 0) throw new UsageError('list takes no report id (try show <id>)');
    return p;
  }
  if (word === 'show') return { ...p, command: 'show', id: needsId() };
  if (word === 'export') return { ...p, command: 'export', id: needsId() };
  if (word in STATUS_COMMANDS) return { ...p, command: 'status', id: needsId(), status: STATUS_COMMANDS[word]! };
  throw new UsageError(`unknown command ${shown(word, 40)}`);
}

/** Runs the command line (after the program name); resolves to the process exit code. */
export async function main(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const out = io.out ?? ((t: string) => void process.stdout.write(`${t}\n`));
  const err = io.err ?? ((t: string) => void process.stderr.write(`${t}\n`));
  const now = io.now ?? (() => new Date());
  if (argv[0] === undefined || argv[0] === 'help' || argv[0] === '--help') {
    (argv[0] === undefined ? err : out)(USAGE);
    return argv[0] === undefined ? 2 : 0;
  }
  if (argv[0] !== 'inbox') {
    err(`openmtg-hosted: unknown command ${shown(argv[0], 40)}\n${USAGE}`);
    return 2;
  }
  let cmd: Parsed;
  try {
    cmd = parse(argv.slice(1), now());
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`openmtg-hosted: ${e.message}\n${USAGE}`);
    return 2;
  }

  let store: GameStore;
  let close: () => Promise<void> = async () => undefined;
  if (io.store) store = io.store;
  else {
    const opened = await openConfiguredStore(io.env ?? process.env);
    if (!opened.ok) {
      for (const p of opened.problems) err(`openmtg-hosted: ${p}`);
      return opened.code;
    }
    store = opened.store;
    close = opened.close;
  }
  const inbox = new Inbox(store, { now });
  try {
    return await run(cmd, inbox, { out, err, cwd: io.cwd ?? process.cwd() });
  } catch (e) {
    err(`openmtg-hosted: failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return 1;
  } finally {
    await close().catch((e: unknown) => err(`openmtg-hosted: closing the store failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function run(cmd: Parsed, inbox: Inbox, io: { out: (t: string) => void; err: (t: string) => void; cwd: string }): Promise<number> {
  if (cmd.command === 'list') {
    for (const line of listLines(await inbox.list(cmd.query))) io.out(line);
    return 0;
  }
  const id = cmd.id!;
  if (cmd.command === 'show') {
    const d = await inbox.details(id);
    if (!d) {
      io.err(`openmtg-hosted: no report ${shown(id, 40)}`);
      return 1;
    }
    for (const line of showLines(d)) io.out(line);
    if (d.report.status === 'new' && !cmd.keep) {
      await inbox.setStatus(id, 'read');
      io.out('(marked read)');
    }
    return 0;
  }
  if (cmd.command === 'status') {
    if (!(await inbox.setStatus(id, cmd.status!))) {
      io.err(`openmtg-hosted: no report ${shown(id, 40)}`);
      return 1;
    }
    io.out(`Report ${shown(id, 40)} is now ${cmd.status}.`);
    return 0;
  }
  const made = await inbox.export(id);
  if (!made.ok) {
    io.err(`openmtg-hosted: ${shown(made.message, 600)}`);
    return 1;
  }
  const bytes = await writeGzippedJson(made.export.file);
  if (!bytes.ok) {
    io.err(`openmtg-hosted: the report file could not be written: ${shown(bytes.error.message, 300)}`);
    return 1;
  }
  const file = resolve(io.cwd, cmd.out ?? `hosted-${made.report.id}.openmtg-bug-report`);
  try {
    await writeFile(file, bytes.value, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    io.err(`openmtg-hosted: cannot write ${shown(file, 300)}: ${(e as NodeJS.ErrnoException).code === 'EEXIST' ? 'it exists (choose another with --out)' : e instanceof Error ? shown(e.message, 300) : 'unknown error'}`);
    return 1;
  }
  for (const line of exportLines(made.export, { file })) io.out(line);
  return made.export.checks.stopped !== null || made.export.checks.mismatches.length > 0 ? 3 : 0;
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  void main(process.argv.slice(2), { cwd: process.env['INIT_CWD'] ?? process.cwd() }).then((code) => {
    process.exitCode = code;
  });
}
