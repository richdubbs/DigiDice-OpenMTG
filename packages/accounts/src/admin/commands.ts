/**
 * M14-6: the commands of `openmtg-accounts admin` (design 9.6): parsing the command line into a command, and running it on an AccountAdmin. Pure
 * apart from what it is given: src/cli.ts opens the store, builds the service and passes its `admin`, the operator, the clock and the output.
 *
 * The command line: `admin <command> <arguments> [options] --as <operator>` (the operator may come from OPENMTG_OPERATOR instead). Options are
 * `--name value` or `--name=value`; `--report` may be repeated, and takes every report id that follows it. `find`, `reserve` and `release` join
 * their arguments with spaces (a name may have them). A duration (`--for`) is a whole number and a unit: m (minutes), h, d, w or y (365 days);
 * `--until` and `--since` take an ISO 8601 date or time.
 *
 * Reads print JSON; writes print one line. `reports` and `appeals` print one page, oldest first (`--limit`, PAGE_DEFAULT rows unless given;
 * `--after` the last id of the page before: a report id, or an appeal's sanction id), and when more follow, a "more" line on stderr naming the next
 * page's `--after`, so the JSON on stdout stays whole. `release --key-version <n>` takes its argument as a key, verbatim, as `rekey --check` lists
 * an entry. `lift` refuses `--note` (the store keeps no note for a lift). `export` and `delete` are the data-rights part's (M14-7) and `rekey` the
 * core's: the command line has no hosted or ladder holder (9.6), so `export` is refused ('incomplete') unless every required holder is present or
 * `--partial` is given, and `delete --now` only moves purgeAt to now: the server's tick erases the account with every holder; this command never
 * ticks.
 */
import { ACCOUNT_ID, type AccountId, type SanctionReason } from '../api';
import { AccountsAdminError, type AccountAdmin, type NewSanction, type Operator } from '../service/api';
import type { ReportQuery } from '../store/api';
import { REPORT_ID } from '../ids';
import { SANCTION_REASONS } from './sanctions';

type CommandName =
  | 'find' | 'show' | 'reports' | 'show-report' | 'close-report' | 'warn' | 'mute' | 'unlist' | 'suspend' | 'ban' | 'lift' | 'rename' | 'reserve'
  | 'release' | 'revoke' | 'appeals' | 'answer' | 'export' | 'delete' | 'audit' | 'rekey' | 'purge';

interface Spec {
  /** Positional arguments: a count, or 'text' (one or more, joined with spaces). */
  args: number | 'text';
  /** Options that take a value. */
  values?: readonly string[];
  /** Options without a value. */
  flags?: readonly string[];
  usage: string;
}

const SANCTION_SPEC = (kind: NewSanction['kind'], until: string): Spec => ({
  args: 1, values: ['reason', 'for', 'until', 'message', 'note', 'report'], flags: ['now'],
  usage: `${kind} <account> --reason <code> ${until} [--message <text>] [--note <text>] [--report <id>...]${kind === 'suspend' || kind === 'ban' ? ' [--now]' : ''}`,
});

export const COMMANDS: Readonly<Record<CommandName, Spec>> = Object.freeze({
  find: { args: 'text', usage: 'find <text>' },
  show: { args: 1, usage: 'show <account>' },
  reports: {
    args: 0, values: ['status', 'target', 'after', 'limit'],
    usage: 'reports [--status new|actioned|dismissed] [--target <account>] [--after <report>] [--limit <n>]',
  },
  'show-report': { args: 1, usage: 'show-report <report>' },
  'close-report': { args: 2, values: ['note'], usage: 'close-report <report> actioned|dismissed [--note <text>]' },
  warn: SANCTION_SPEC('warn', ''),
  mute: SANCTION_SPEC('mute', '--for <duration> | --until <date>'),
  unlist: SANCTION_SPEC('unlist', '[--for <duration> | --until <date>]'),
  suspend: SANCTION_SPEC('suspend', '--for <duration> | --until <date>'),
  ban: SANCTION_SPEC('ban', '[--for <duration> | --until <date>]'),
  // --note is parsed only to be refused with the reason (runCommand): the store keeps no note for a lift
  lift: { args: 1, values: ['note'], usage: 'lift <sanction>' },
  rename: { args: 1, values: ['reason', 'to'], usage: 'rename <account> --reason <code> [--to <name>]' },
  reserve: { args: 'text', values: ['note'], usage: 'reserve <name> [--note <text>]' },
  release: { args: 'text', values: ['key-version'], usage: 'release <name> [--key-version <n>]' },
  revoke: { args: 1, usage: 'revoke <account>' },
  appeals: { args: 0, values: ['after', 'limit'], flags: ['open'], usage: 'appeals [--open] [--after <sanction>] [--limit <n>]' },
  answer: { args: 2, values: ['message'], usage: 'answer <sanction> upheld|lifted --message <text>' },
  export: { args: 1, flags: ['partial'], usage: 'export <account> [--partial]' },
  delete: { args: 1, values: ['reason'], flags: ['now'], usage: 'delete <account> --reason <text> [--now]' },
  audit: { args: 1, values: ['since'], usage: 'audit <account> [--since <date>]' },
  rekey: { args: 0, flags: ['check'], usage: 'rekey [--check]' },
  purge: { args: 0, usage: 'purge' },
});

export const USAGE = [
  'usage: openmtg-accounts admin <command> [arguments] --as <operator>   (or OPENMTG_OPERATOR=<operator>)',
  '',
  'commands:',
  ...Object.values(COMMANDS).map((s) => `  ${s.usage}`),
  '',
  `reasons: ${SANCTION_REASONS.join(', ')}`,
  'durations: a number and m, h, d, w or y (365 days), e.g. 7d; dates: ISO 8601, e.g. 2026-11-01 or 2026-11-01T12:00:00Z',
  'release --key-version <n>: the name is a key as rekey --check lists an entry (entry.key and entry.keyVersion), taken as it is',
].join('\n');

export interface Command {
  name: CommandName;
  args: string[];
  /** Each value option's values, in order (only --report may have several). */
  values: ReadonlyMap<string, string[]>;
  flags: ReadonlySet<string>;
}

/** A command line problem (exit code 2): the message, and the command's usage when there is one. */
export class UsageError extends Error {
  constructor(message: string, readonly usage: string | null) {
    super(message);
    this.name = 'UsageError';
  }
}

const isCommand = (s: string): s is CommandName => Object.hasOwn(COMMANDS, s);

/** Parses `<command> ...` (the words after `admin`); `--as` is taken by every command. Throws UsageError. */
export function parseCommand(argv: readonly string[]): Command {
  const [name, ...rest] = argv;
  if (name === undefined || name.startsWith('--')) throw new UsageError('no command given', null);
  if (!isCommand(name)) throw new UsageError(`unknown command: ${name.slice(0, 40)}`, null);
  const spec = COMMANDS[name];
  const valueOpts = new Set(['as', ...(spec.values ?? [])]);
  const flagOpts = new Set(spec.flags ?? []);
  const args: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (!word.startsWith('--')) {
      args.push(word);
      continue;
    }
    const eq = word.indexOf('=');
    const opt = word.slice(2, eq < 0 ? undefined : eq);
    if (flagOpts.has(opt)) {
      if (eq >= 0) throw new UsageError(`--${opt} takes no value`, spec.usage);
      flags.add(opt);
      continue;
    }
    if (!valueOpts.has(opt)) throw new UsageError(`${name} has no option --${opt.slice(0, 40)}`, spec.usage);
    let value: string | undefined;
    if (eq >= 0) value = word.slice(eq + 1);
    else {
      value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${opt} needs a value`, spec.usage);
      i++;
    }
    const list = values.get(opt) ?? [];
    if (list.length > 0 && opt !== 'report') throw new UsageError(`--${opt} is given twice`, spec.usage);
    list.push(value);
    // --report <id>...: the report ids that follow belong to it
    if (opt === 'report') while (i + 1 < rest.length && REPORT_ID.test(rest[i + 1]!)) list.push(rest[++i]!);
    values.set(opt, list);
  }
  if (spec.args === 'text' ? args.length === 0 : args.length !== spec.args) {
    throw new UsageError(`${name} takes ${spec.args === 'text' ? 'a name' : `${spec.args} argument${spec.args === 1 ? '' : 's'}`}`, spec.usage);
  }
  return { name, args, values, flags };
}

const UNITS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, y: 365 * 86_400_000 };

/** `--for <duration>` in milliseconds. */
export function parseDuration(text: string): number {
  const m = /^([0-9]{1,6})([mhdwy])$/.exec(text.trim());
  const n = m ? Number(m[1]) * UNITS[m[2]!]! : NaN;
  if (!(n > 0)) throw new UsageError(`not a duration: ${text.slice(0, 40)} (a number and m, h, d, w or y)`, null);
  return n;
}

/** An ISO 8601 date or time (`--until`, `--since`), as an ISO string. */
export function parseTime(label: string, text: string): string {
  const t = /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text) : NaN;
  if (!Number.isFinite(t)) throw new UsageError(`${label}: not an ISO 8601 date or time: ${text.slice(0, 40)}`, null);
  return new Date(t).toISOString();
}

/** The default message the account sees for a sanction given without --message. */
export const DEFAULT_MESSAGES: Readonly<Record<NewSanction['kind'], string>> = Object.freeze({
  warn: 'A moderator has sent you a warning. Please keep to the rules of play and chat.',
  mute: 'A moderator has turned your chat off for a while.',
  unlist: 'A moderator has taken your account off the leaderboards for a while.',
  suspend: 'A moderator has suspended your account for a while.',
  ban: 'A moderator has banned your account.',
});

/** What running a command needs. */
export interface CommandContext {
  admin: AccountAdmin;
  op: Operator;
  now: () => Date;
  out: (text: string) => void;
  /** A note beside the output (stderr), never in it: a page's "more" marker. */
  err: (text: string) => void;
  /** After `export` (src/cli.ts writes the file unless the data-rights part did). */
  exported?: (account: AccountId, data: unknown) => Promise<string>;
}

const one = (c: Command, opt: string): string | undefined => c.values.get(opt)?.[0];
const json = (v: unknown): string => JSON.stringify(v, null, 2);

/** A page of `reports` and `appeals`: --limit rows, PAGE_DEFAULT when not given, at most PAGE_LIMIT_MAX (the admin's page holds one more). */
export const PAGE_DEFAULT = 100;
export const PAGE_LIMIT_MAX = 500;

function pageLimit(c: Command): number {
  const text = one(c, 'limit');
  if (text === undefined) return PAGE_DEFAULT;
  const n = /^[0-9]{1,4}$/.test(text) ? Number(text) : NaN;
  if (!(n >= 1 && n <= PAGE_LIMIT_MAX)) throw new UsageError(`--limit: a whole number from 1 to ${PAGE_LIMIT_MAX}`, COMMANDS[c.name].usage);
  return n;
}

/** Prints a page as JSON; rows past `limit` (it was asked one more) mean more follow, and the marker names the next page's --after. */
function page<T>(x: CommandContext, rows: readonly T[], limit: number, idOf: (r: T) => string): void {
  const shown = rows.slice(0, limit);
  x.out(json(shown));
  if (rows.length > limit && shown.length > 0) x.err(`openmtg-accounts: more: the next page is --after ${idOf(shown[shown.length - 1]!)}`);
}

function need(c: Command, opt: string): string {
  const v = one(c, opt);
  if (v === undefined) throw new UsageError(`${c.name} needs --${opt}`, COMMANDS[c.name].usage);
  return v;
}

function accountArg(c: Command): AccountId {
  const a = c.args[0]!;
  if (!ACCOUNT_ID.test(a)) throw new UsageError(`not an account id: ${a.slice(0, 40)}`, COMMANDS[c.name].usage);
  return a as AccountId;
}

function reasonOf(c: Command): SanctionReason {
  const r = need(c, 'reason');
  if (!(SANCTION_REASONS as readonly string[]).includes(r)) throw new UsageError(`--reason: one of ${SANCTION_REASONS.join(', ')}`, COMMANDS[c.name].usage);
  return r as SanctionReason;
}

/** Runs a parsed command. Refusals throw AccountsAdminError (from the admin) or UsageError. */
export async function runCommand(c: Command, x: CommandContext): Promise<void> {
  const { admin, op, out } = x;
  switch (c.name) {
    case 'find': {
      const found = await admin.find(op, c.args.join(' '));
      out(json(found.map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt, lastSignInAt: a.lastSignInAt }))));
      return;
    }
    case 'show': {
      const view = await admin.show(op, accountArg(c));
      if (view === null) throw new AccountsAdminError('notFound', 'no such account');
      out(json(view));
      return;
    }
    case 'reports': {
      const limit = pageLimit(c);
      const q: ReportQuery = { limit: limit + 1 };
      const status = one(c, 'status');
      if (status !== undefined) q.status = status as ReportQuery['status'];
      const target = one(c, 'target');
      if (target !== undefined) q.target = target as AccountId;
      const after = one(c, 'after');
      if (after !== undefined) q.after = after;
      page(x, await admin.reports(op, q), limit, (r) => r.id);
      return;
    }
    case 'show-report': {
      const r = await admin.showReport(op, c.args[0]!);
      if (r === null) throw new AccountsAdminError('notFound', 'no such report');
      out(json(r));
      return;
    }
    case 'close-report': {
      const [report, outcome] = c.args as [string, string];
      if (outcome !== 'actioned' && outcome !== 'dismissed') throw new UsageError('the outcome is actioned or dismissed', COMMANDS[c.name].usage);
      const note = one(c, 'note');
      await admin.closeReport(op, report, outcome, note);
      out(`report ${report} closed: ${outcome}`);
      return;
    }
    case 'warn': case 'mute': case 'unlist': case 'suspend': case 'ban': {
      const account = accountArg(c);
      const reason = reasonOf(c);
      const forText = one(c, 'for');
      const untilText = one(c, 'until');
      if (forText !== undefined && untilText !== undefined) throw new UsageError('give --for or --until, not both', COMMANDS[c.name].usage);
      if (c.name === 'warn' && (forText !== undefined || untilText !== undefined)) throw new UsageError('a warning has no end', COMMANDS[c.name].usage);
      let until: string | null = untilText !== undefined ? parseTime('--until', untilText) : null;
      if (forText !== undefined) {
        // a duration may end past the last time a date can hold (about 275,000 years on): a usage problem, not a failure
        const end = new Date(x.now().getTime() + parseDuration(forText));
        if (Number.isNaN(end.getTime())) throw new UsageError(`--for ${forText.slice(0, 40)}: the end is too far ahead`, COMMANDS[c.name].usage);
        until = end.toISOString();
      }
      const s: NewSanction = {
        kind: c.name, reason, until, message: one(c, 'message') ?? DEFAULT_MESSAGES[c.name], reports: c.values.get('report') ?? [], now: c.flags.has('now'),
      };
      const note = one(c, 'note');
      if (note !== undefined) s.note = note;
      out(json(await admin.sanction(op, account, s)));
      return;
    }
    case 'lift': {
      if (one(c, 'note') !== undefined) {
        throw new UsageError('lift takes no --note: notes are not stored for a lift (the store records only who lifted it and when)', COMMANDS.lift.usage);
      }
      await admin.lift(op, c.args[0]!);
      out(`sanction ${c.args[0]} lifted`);
      return;
    }
    case 'rename': {
      const account = accountArg(c);
      const a = await admin.forceRename(op, account, reasonOf(c), one(c, 'to'));
      out(`${a.id} renamed to ${JSON.stringify(a.name)}`);
      return;
    }
    case 'reserve': {
      await admin.reserveName(op, c.args.join(' '), one(c, 'note'));
      out(`reserved ${JSON.stringify(c.args.join(' '))}`);
      return;
    }
    case 'release': {
      const version = one(c, 'key-version');
      if (version !== undefined && !/^[0-9]{1,9}$/.test(version)) throw new UsageError('--key-version: a whole number', COMMANDS.release.usage);
      await admin.releaseName(op, c.args.join(' '), version !== undefined ? Number(version) : undefined);
      out(`released ${JSON.stringify(c.args.join(' '))}`);
      return;
    }
    case 'revoke': {
      const n = await admin.revokeSessions(op, accountArg(c));
      out(`revoked ${n} session${n === 1 ? '' : 's'}`);
      return;
    }
    case 'appeals': {
      const limit = pageLimit(c);
      const after = one(c, 'after');
      const q = { ...(c.flags.has('open') ? { open: true } : {}), ...(after !== undefined ? { after } : {}), limit: limit + 1 };
      page(x, await admin.appeals(op, q), limit, (a) => a.sanction);
      return;
    }
    case 'answer': {
      const [sanction, answer] = c.args as [string, string];
      if (answer !== 'upheld' && answer !== 'lifted') throw new UsageError('the answer is upheld or lifted', COMMANDS[c.name].usage);
      await admin.answerAppeal(op, sanction, answer, need(c, 'message'));
      out(`appeal of ${sanction} answered: ${answer}`);
      return;
    }
    case 'export': {
      const account = accountArg(c);
      const data = await admin.exportAccount(op, account, c.flags.has('partial'));
      const where = x.exported !== undefined ? await x.exported(account, data) : null;
      const missing = data.missing.length > 0 ? ` (incomplete: missing ${data.missing.join(', ')})` : '';
      out(`export of ${account}${missing}${where !== null ? ` written to ${where}` : ''}`);
      return;
    }
    case 'delete': {
      const account = accountArg(c);
      const now = c.flags.has('now');
      const r = await admin.deleteAccount(op, account, need(c, 'reason'), now);
      out(
        now
          ? `${account}: purgeAt ${r.purgeAt}; the server's tick erases it with every holder (with the file store, at the server's next start)`
          : `${account}: deletion requested, purgeAt ${r.purgeAt}`,
      );
      return;
    }
    case 'audit': {
      const since = one(c, 'since');
      out(json(await admin.audit(op, accountArg(c), since !== undefined ? parseTime('--since', since) : undefined)));
      return;
    }
    case 'rekey': {
      if (c.flags.has('check')) out(json(await admin.rekeyCheck(op)));
      else out(`rekeyed: ${(await admin.rekey(op)).changed} keys changed`);
      return;
    }
    case 'purge': {
      out(json(await admin.purge(op)));
      return;
    }
  }
}
