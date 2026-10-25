#!/usr/bin/env tsx
/**
 * M14-6: `openmtg-accounts admin <command> --as <operator>` (design 9.6), the package's `bin` entry: run on the server, never a network endpoint.
 * Run with `npm run accounts -w @openmtg/accounts -- admin <command> ...` or, once installed, `openmtg-accounts admin <command> ...` (tsx on the PATH).
 *
 * It reads the server's configuration from the environment (loadAccountsConfig: ACCOUNTS_DATA_DIR and the rest), opens the account store and
 * builds the service as the server does (composeAccounts, with the parts that are built), runs one command on its AccountAdmin
 * (./admin/commands.ts), and closes the service again (its audit queue flushed, the store's lock released). Every command is audited by the admin
 * with the operator's name (`--as`, or OPENMTG_OPERATOR) and the OS user who ran it (`os.userInfo().username`, or `uid:<number>` without a passwd
 * entry, never the environment): the name is free text anyone at the shell can set, the OS user is not. A process with neither refuses to run.
 *
 * - **Stores.** The file store is single-process: it holds a lock file, so the command refuses while the server runs ("stop the server, or use
 *   PostgreSQL"). PostgreSQL runs beside the server, but its store is hosted's to pass (M14-11, at the sync), so ACCOUNTS_STORE=postgres is
 *   refused here; so is the memory store, which holds nothing between processes.
 * - **No holder of another package** is in this process (hosted, the ladder): the command never erases anything and never ticks. `delete --now`
 *   only moves purgeAt (the server's tick then erases it, at its next start for the file store); `export` is refused unless every required
 *   holder is present, or `--partial` writes it marked with the missing ones. The export file (ACCOUNTS_DATA_DIR/exports/<account>-<time>.json,
 *   mode 0600, deleted by purge after a day) is the data-rights part's (M14-7) to write; when its exportAccount wrote none, this command writes it.
 * - **Exit codes**: 0 done; 1 refused (AccountsAdminError: notFound, invalid, conflict, locked, incomplete) or failed; 2 a command line or
 *   configuration problem (an OS user that cannot be told too).
 */
import { realpathSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountId } from './api';
import { composeAccounts, type AccountsFactories, type ComposedAccounts } from './compose';
import { loadAccountsConfig, type AccountsConfig } from './config';
import { createModerationPart } from './moderation/index';
import { AccountsAdminError, type AccountsLog, type GuestSessions, type Operator } from './service/api';
import { AccountStoreError } from './store/api';
import { parseCommand, runCommand, USAGE, UsageError } from './admin/commands';

/** What the command line reads and writes; the process's own by default (tests pass their own). */
export interface CliIo {
  env?: Readonly<Record<string, string | undefined>>;
  out?: (text: string) => void;
  err?: (text: string) => void;
  /** The OS user who runs the command (osUserOf by default); null: not known, and the command refuses to run. */
  osUser?: () => string | null;
  /** The clock of the operator's commands (the system clock by default). */
  now?: () => Date;
  /** Factories to build the service with instead of the built ones (as composeAccounts takes them). */
  factories?: Partial<AccountsFactories>;
}

/** The command line has no guest sessions: no guest token proves anything here. */
const NO_GUESTS: GuestSessions = { proof: async () => null, busy: async () => false, retire: async () => undefined };

/** Where the OS user comes from (the process's own by default; tests pass their own). */
export interface OsUserSource {
  userInfo: () => { username: string };
  /** process.getuid, which Windows has not. */
  getuid: (() => number) | undefined;
}

/**
 * The OS user, by name; when the system has none for this process (a container without a passwd entry), `uid:<number>`; null when neither is
 * known (the command then refuses to run). Never the environment: $USER is free text anyone at the shell sets, like `--as`.
 */
export function osUserOf(source: OsUserSource = { userInfo, getuid: process.getuid?.bind(process) }): string | null {
  try {
    const name = source.userInfo().username;
    if (name !== '') return name;
  } catch {
    // no passwd entry
  }
  const uid = source.getuid?.();
  return typeof uid === 'number' && Number.isSafeInteger(uid) && uid >= 0 ? `uid:${uid}` : null;
}

/** The export file of 9.6, unless the data-rights part wrote one during the call (a new file of the account in exports/). */
async function exportFile(config: AccountsConfig, before: ReadonlySet<string>, account: AccountId, data: unknown, at: Date): Promise<string> {
  const dir = join(config.dataDir!, 'exports');
  const made = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.startsWith(`${account}-`) && !before.has(f));
  if (made.length > 0) return join(dir, made.sort().at(-1)!);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${account}-${at.toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return file;
}

/** Runs the command line; resolves to the process exit code. */
export async function main(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const env = io.env ?? process.env;
  const out = io.out ?? ((t: string) => void process.stdout.write(`${t}\n`));
  const err = io.err ?? ((t: string) => void process.stderr.write(`${t}\n`));
  const clock = io.now ?? (() => new Date());
  if (argv[0] === '--help' || argv[0] === 'help' || (argv[0] === 'admin' && (argv[1] === '--help' || argv[1] === 'help'))) {
    out(USAGE);
    return 0;
  }
  if (argv[0] !== 'admin') {
    err(USAGE);
    return 2;
  }
  let command;
  try {
    command = parseCommand(argv.slice(1));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`openmtg-accounts: ${e.message}`);
    err(e.usage !== null ? `usage: openmtg-accounts admin ${e.usage} --as <operator>` : USAGE);
    return 2;
  }
  const name = command.values.get('as')?.[0] ?? env['OPENMTG_OPERATOR'];
  if (name === undefined || name.trim() === '') {
    err('openmtg-accounts: who runs this? Give --as <operator> or set OPENMTG_OPERATOR');
    return 2;
  }
  const osUser = io.osUser !== undefined ? io.osUser() : osUserOf();
  if (osUser === null) {
    err('openmtg-accounts: cannot tell which OS user runs this (no user name, no uid), and every command records it: run it as a user the system knows');
    return 2;
  }
  const op: Operator = { name, osUser };

  const loaded = loadAccountsConfig(env);
  if (!loaded.ok) {
    for (const p of loaded.problems) err(`openmtg-accounts: ${p}`);
    return 2;
  }
  const config = loaded.config;
  for (const w of loaded.warnings) err(`openmtg-accounts: warning: ${w}`);
  if (config.store.kind === 'memory') {
    err('openmtg-accounts: the memory store holds nothing between processes: set ACCOUNTS_DATA_DIR (or DATA_DIR) to the server\'s data directory');
    return 2;
  }
  if (config.store.kind === 'postgres') {
    err('openmtg-accounts: ACCOUNTS_STORE=postgres: use the hosted server\'s admin command, which opens the PostgreSQL store (at the sync)');
    return 2;
  }

  const log: AccountsLog = { event: (event, fields) => err(JSON.stringify({ event, ...fields })) };
  const moderation = io.factories?.createModerationPart ?? createModerationPart;
  const factories: Partial<AccountsFactories> = {
    ...io.factories,
    // the operator's clock reaches the moderation part (its commands take no time)
    ...(io.now !== undefined ? { createModerationPart: (deps) => (moderation as typeof createModerationPart)({ ...deps, now: clock }) } : {}),
  };
  let composed: ComposedAccounts;
  try {
    composed = await composeAccounts(config, { guests: NO_GUESTS, log, factories });
  } catch (e) {
    if (e instanceof AccountStoreError && e.code === 'locked') {
      err(`openmtg-accounts: the accounts store in ${config.dataDir} is in use (is the server running?): stop the server, or use PostgreSQL`);
    } else err(`openmtg-accounts: cannot start the account service: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const { service } = composed;
  try {
    const exportsBefore = new Set(await readdir(join(config.dataDir!, 'exports')).catch(() => [] as string[]));
    await runCommand(command, {
      admin: service.admin, op, now: clock, out, err,
      exported: (account, data) => exportFile(config, exportsBefore, account, data, clock()),
    });
    return 0;
  } catch (e) {
    if (e instanceof AccountsAdminError) err(`openmtg-accounts: ${e.code}: ${e.message}`);
    else if (e instanceof UsageError) {
      err(`openmtg-accounts: ${e.message}`);
      if (e.usage !== null) err(`usage: openmtg-accounts admin ${e.usage} --as <operator>`);
      return 2;
    } else err(`openmtg-accounts: failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return 1;
  } finally {
    await service.close().catch((e: unknown) => err(`openmtg-accounts: closing the store failed: ${e instanceof Error ? e.message : String(e)}`));
  }
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
