#!/usr/bin/env tsx
/**
 * The operator's commands for the hosted server (design 10.1, 8.3, 4.2; package M13-14), run on the server's machine or in its container, never a network
 * endpoint. Run with `npx tsx packages/hosted/src/ops/main.ts <command>` (in the image: `node --import tsx packages/hosted/src/ops/main.ts <command>`).
 *
 *   check                       validate the environment as the server does and look at the files it names; prints the configuration (secrets hidden)
 *   migrate [--grant <role>]    PostgreSQL: apply pending migrations (accounts, then hosted) with DATABASE_URL (the OWNER's role); with --grant,
 *                               give that role (the service's) its rights
 *   purge                       retention: delete what the policy lets go (STORE and DATABASE_URL or DATA_DIR as the server reads them)
 *   hide <table> | unhide <table>   hide a table from the lobby (24 hours) or list it again: a line in DATA_DIR/hidden-tables.jsonl the server reads
 *
 * The bug inbox is `openmtg-hosted inbox ...` (packages/hosted/src/cli.ts, M13-13); the server itself drains on SIGTERM (docs/ops/hosted.md).
 *
 * Exit codes: 0 done; 1 refused or failed (a database that cannot be reached, a role that does not exist); 2 a command line or configuration problem.
 * Nothing is echoed that could be a secret: messages go through the logger's scrubber (obs/logger.ts) first.
 */
import { stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeConfig, parseConfig, type HostedConfig } from '../config';
import { hideTable, unhideTable } from '../moderation/hidden';
import { logScrubber, scrubLogText, secretValuesOf } from '../obs';
import { openStore } from '../store/index';
import { createPgPool, pgClient, type SqlClient } from '../store/sql';
import { MigrateError, migrateAll } from './migrate';
import { runPurge } from './purge';

export const USAGE = [
  'usage: ops check',
  '       ops migrate [--grant <role>]',
  '       ops purge',
  '       ops hide <table> | ops unhide <table>',
].join('\n');

/** What the command line reads and writes; the process's own by default (tests pass their own). */
export interface OpsIo {
  env?: Readonly<Record<string, string | undefined>>;
  out?: (text: string) => void;
  err?: (text: string) => void;
  now?: () => Date;
  /** Tests: the database (a PGlite client) instead of a pool on DATABASE_URL; it is not closed here. */
  sql?: SqlClient;
}

class UsageError extends Error {}

/** The card index's files (cards package `cacheFiles`: `cards.jsonl` and `tokens.jsonl` in `CARD_DATA_DIR`). */
export const CARD_INDEX_FILES = ['cards.jsonl', 'tokens.jsonl'] as const;

const isFile = (path: string): Promise<boolean> => stat(path).then((s) => s.isFile(), () => false);
const isDirectory = (path: string): Promise<boolean> => stat(path).then((s) => s.isDirectory(), () => false);

/** Problems the configuration cannot know: files and directories it names. Each is a line for the operator. */
export async function preflight(config: HostedConfig): Promise<string[]> {
  const problems: string[] = [];
  if (config.cardDataDir === null) {
    problems.push('CARD_DATA_DIR is not set: the card index is read from the cards package\'s default cache directory (OPENMTG_CACHE_DIR, else <repository>/.cache/scryfall); in a container, mount the index and set CARD_DATA_DIR.');
  } else if (!(await isDirectory(config.cardDataDir))) {
    problems.push(`CARD_DATA_DIR ${config.cardDataDir} is not a directory.`);
  } else {
    for (const f of CARD_INDEX_FILES) if (!(await isFile(join(config.cardDataDir, f)))) problems.push(`CARD_DATA_DIR has no ${f}: decks cannot be checked without the card index (npm run cards -- refresh).`);
  }
  if (config.moderationWordsFile !== null && !(await isFile(config.moderationWordsFile))) problems.push(`MODERATION_WORDS_FILE ${config.moderationWordsFile} is not a file.`);
  return problems;
}

/** Runs the command line (after the program name); resolves to the process exit code. */
export async function main(argv: readonly string[], io: OpsIo = {}): Promise<number> {
  const env = io.env ?? process.env;
  const scrub = logScrubber(secretValuesOf(env));
  const out = io.out ?? ((t: string) => void process.stdout.write(`${t}\n`));
  const err = io.err ?? ((t: string) => void process.stderr.write(`${t}\n`));
  const say = (f: (t: string) => void) => (t: string) => f(scrub(t));
  const o = say(out);
  const e = say(err);
  const [command, ...args] = argv;
  if (command === undefined || command === 'help' || command === '--help') {
    (command === undefined ? e : o)(USAGE);
    return command === undefined ? 2 : 0;
  }
  try {
    switch (command) {
      case 'check':
        return await check(args, env, o, e);
      case 'migrate':
        return await migrateCommand(args, env, io, o, e);
      case 'purge':
        return await purgeCommand(args, env, io, o, e);
      case 'hide':
      case 'unhide':
        return await hideCommand(command, args, env, io, o, e);
      default:
        throw new UsageError(`unknown command ${JSON.stringify(scrubLogText(command).slice(0, 40))}`);
    }
  } catch (x) {
    if (x instanceof UsageError) {
      e(`ops: ${x.message}\n${USAGE}`);
      return 2;
    }
    if (x instanceof MigrateError) {
      e(`ops: ${x.message}`);
      return 1;
    }
    e(`ops ${command}: ${x instanceof Error ? `${x.name}: ${x.message}` : 'failed'}`);
    return 1;
  }
}

function configOf(env: Readonly<Record<string, string | undefined>>, e: (t: string) => void): HostedConfig | null {
  const parsed = parseConfig(env, { cpus: availableParallelism() });
  if (!parsed.ok) {
    for (const p of parsed.errors) e(`ops: ${p}`);
    return null;
  }
  for (const w of parsed.warnings) e(`ops: warning: ${w}`);
  return parsed.config;
}

async function check(args: readonly string[], env: Readonly<Record<string, string | undefined>>, o: (t: string) => void, e: (t: string) => void): Promise<number> {
  if (args.length > 0) throw new UsageError('check takes no arguments');
  const config = configOf(env, e);
  if (config === null) return 2;
  const problems = await preflight(config);
  o(JSON.stringify(describeConfig(config), null, 2));
  for (const p of problems) e(`ops: ${p}`);
  return problems.length > 0 ? 1 : 0;
}

async function migrateCommand(
  args: readonly string[], env: Readonly<Record<string, string | undefined>>, io: OpsIo, o: (t: string) => void, e: (t: string) => void,
): Promise<number> {
  let grantTo: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--grant') {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError('--grant needs a role name');
      grantTo = v;
    } else throw new UsageError(`migrate: unknown argument ${JSON.stringify(String(args[i]).slice(0, 40))}`);
  }
  const url = env['DATABASE_URL']?.trim();
  if (!io.sql && !url) {
    e('ops: DATABASE_URL is not set: migrate needs the database OWNER\'s connection string (postgres://...).');
    return 2;
  }
  if (!io.sql && !/^postgres(ql)?:\/\//.test(url!)) {
    e('ops: DATABASE_URL must start with postgres:// or postgresql://.');
    return 2;
  }
  const sql = io.sql ?? pgClient(await createPgPool(url!));
  try {
    const report = await migrateAll(sql, { grantTo });
    for (const p of report.packages) o(`${p.name}: ${p.applied.length > 0 ? `applied ${p.applied.map((v) => String(v).padStart(3, '0')).join(', ')}` : 'already current'} (version ${p.version})`);
    if (report.granted) o(`rights granted to ${report.granted}`);
    return 0;
  } finally {
    if (!io.sql) await sql.close().catch(() => undefined);
  }
}

async function purgeCommand(
  args: readonly string[], env: Readonly<Record<string, string | undefined>>, io: OpsIo, o: (t: string) => void, e: (t: string) => void,
): Promise<number> {
  if (args.length > 0) throw new UsageError('purge takes no arguments');
  const config = configOf(env, e);
  if (config === null) return 2;
  if (config.store === 'memory') {
    e('ops: STORE=memory holds nothing between processes: set STORE=file (and DATA_DIR) or STORE=postgres (and DATABASE_URL).');
    return 2;
  }
  if (config.store === 'file') e('ops: warning: the file store belongs to one process: stop the server before purging it (PostgreSQL runs beside the server).');
  const store = await openStore({ kind: config.store, dataDir: resolve(config.dataDir), databaseUrl: config.databaseUrl });
  try {
    const r = await runPurge(store, config.retention, (io.now ?? (() => new Date()))());
    o(`purged: ${r.sessions} sessions, ${r.games} games, ${r.records} action records, ${r.snapshots} snapshots, ${r.reports} bug reports`);
    return 0;
  } finally {
    await store.close().catch(() => undefined);
  }
}

async function hideCommand(
  command: 'hide' | 'unhide', args: readonly string[], env: Readonly<Record<string, string | undefined>>, io: OpsIo, o: (t: string) => void, e: (t: string) => void,
): Promise<number> {
  if (args.length !== 1) throw new UsageError(`${command} takes one table id`);
  const config = configOf(env, e);
  if (config === null) return 2;
  if (config.store === 'memory') e('ops: warning: the server reads no hide file with STORE=memory.');
  try {
    const f = command === 'hide' ? hideTable : unhideTable;
    await f(resolve(config.dataDir), args[0]!, (io.now ?? (() => new Date()))().getTime());
  } catch (x) {
    if (x instanceof RangeError) throw new UsageError(x.message);
    throw x;
  }
  o(`${command === 'hide' ? 'hidden' : 'listed again'}: ${args[0]} (the server reads the file within a few seconds)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
