/**
 * M14-6: `openmtg-accounts admin` (design 9.6; 13.2), run in process through `main` with ACCOUNTS_DATA_DIR a temporary directory: each command
 * parsed and run, and audited with the operator (`--as`, or OPENMTG_OPERATOR) and the OS user; the command line's own refusals (exit 2); the file
 * store's lock (the real one: PostgreSQL on PGlite in the directory) refusing the command beside a running server; every other test runs its commands
 * on one memory store that stays open between them (the command line's openFileAccountStore factory answers it: F26, the file store's own tests are
 * test/m14-11/dir.test.ts); `delete --now` only setting purgeAt (never a tick, never an erasure); `export` refused without
 * the required holders and written, marked, with `--partial` (mode 0600); `rekey --check` listing a collision. The data-rights part (M14-7) is a
 * fake here, as the work package says.
 */
import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountsAdminError, builtFactories, createMemoryAccountStore, createNameData, createNameRules, encodeNameTable, openFileAccountStore, type AccountExport, type AccountId,
  type AccountsFactories, type AccountStore, type AuditEvent, type CreateRightsPart, type GeneratedNameData, type NameRules, type RightsPart,
} from '@openmtg/accounts';
import { main, osUserOf, type CliIo } from '../../src/cli';
import { parseCommand, parseDuration, UsageError } from '../../src/admin/commands';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { Clock, ctxOf, DAY, fastDerive, HOUR, OP, PW, registerAs, setup, T0, value, type Setup } from './support';

let dir = '';
/** The store every command of a test runs on (its close does nothing: each command closes the service it built). */
let shared: AccountStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openmtg-m14-6-'));
  const store = createMemoryAccountStore();
  shared = new Proxy(store, {
    get(t, p) {
      if (p === 'close') return async () => undefined;
      const v = Reflect.get(t, p) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The fake data-rights part's record of what the command line asked of it. */
interface RightsCalls { deleteAccount: unknown[][]; exportAccount: unknown[][]; purge: number; tick: number; erase: number }

/** A fake of M14-7's part, on the core's seams: deletion sets the deletion (purgeAt now with --now), export refuses or marks missing holders. */
function fakeRights(calls: RightsCalls, opts: { writeFile?: boolean } = {}): CreateRightsPart {
  return (deps) => {
    const part: RightsPart = {
      exportData: async () => ({ ok: false, error: { code: 'notYet', message: 'fake' } }),
      deleteAccount: async () => ({ ok: false, error: { code: 'notYet', message: 'fake' } }),
      cancelDeletion: async () => ({ ok: false, error: { code: 'notYet', message: 'fake' } }),
      addHolder() {},
      admin: {
        async exportAccount(op, account, partial) {
          calls.exportAccount.push([op, account, partial]);
          const missing = deps.config.requiredHolders;
          if (missing.length > 0 && !partial) throw new AccountsAdminError('incomplete', `required holders missing: ${missing.join(', ')}`);
          const data = { format: 'openmtg-account-export', version: 1, exportedAt: new Date().toISOString(), missing: [...missing], account: { id: account }, holders: {} };
          if (opts.writeFile) {
            await mkdir(join(deps.config.dataDir!, 'exports'), { recursive: true });
            await writeFile(join(deps.config.dataDir!, 'exports', `${account}-by-rights.json`), JSON.stringify(data), { mode: 0o600 });
          }
          return data as unknown as AccountExport;
        },
        async deleteAccount(op, account, reason, now) {
          calls.deleteAccount.push([op, account, reason, now]);
          const at = new Date(T0 + 5 * DAY);
          const purgeAt = now ? at.toISOString() : new Date(at.getTime() + deps.config.timing.deleteGraceMs).toISOString();
          const r = await deps.guard.patch(account, () => ({ deletion: { requestedAt: at.toISOString(), purgeAt, erasingAt: null, done: [] } }));
          if (!r.ok) throw new AccountsAdminError('notFound', 'no such account');
          return { purgeAt };
        },
        async purge() {
          calls.purge++;
          return { sessions: 0, devices: 0, emailCodes: 0, names: 0, reports: 0, audit: 0, changes: 0, tombstones: 0 };
        },
      },
      async tick() {
        calls.tick++;
        return { erased: 0, erasureRetries: 0, erasureBlocked: 0, inactiveNotified: 0, purged: null };
      },
    };
    return part;
  };
}

const newCalls = (): RightsCalls => ({ deleteAccount: [], exportAccount: [], purge: 0, tick: 0, erase: 0 });

/** The factories the command line builds with in these tests: the shared store, a fast hasher, M14-8's mailer while it is a stub, the fake rights part. */
function factories(calls: RightsCalls, extra: Partial<AccountsFactories> = {}): Partial<AccountsFactories> {
  return {
    openFileAccountStore: async () => shared,
    createPasswordHasher: (o) => buildPasswordHasher(o, { derive: fastDerive, sleep: async () => undefined }),
    ...(builtFactories().createNoMailer === undefined ? { createNoMailer: () => ({ kind: 'none', send: async () => undefined }) } : {}),
    createRightsPart: fakeRights(calls),
    ...extra,
  };
}

interface Run { code: number; out: string; err: string }

/** Runs `openmtg-accounts admin ...` in process against `dir`. */
async function cli(
  argv: string[], clock: Clock, o: { env?: Record<string, string>; factories?: Partial<AccountsFactories>; calls?: RightsCalls; osUser?: () => string | null } = {},
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    env: { ACCOUNTS_DATA_DIR: dir, ...o.env },
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    osUser: o.osUser ?? (() => 'tester'),
    now: clock.now,
    factories: o.factories ?? factories(o.calls ?? newCalls()),
  };
  const code = await main(['admin', ...argv], io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Accounts on the shared store, made by the service (then closed, as the server would be before the command runs). */
async function prepare(clock: Clock, f: (s: Setup) => Promise<void>, names?: NameRules): Promise<void> {
  const s = setup({ store: shared, clock, ...(names !== undefined ? { names } : {}) });
  await f(s);
  await s.service.close();
}

const withStore = <T>(f: (store: AccountStore) => Promise<T>): Promise<T> => f(shared);

describe('M14-6: the command line\'s own refusals (9.6)', () => {
  it('usage, unknown commands and options, a missing operator, bad durations: exit 2 with the usage; --help exit 0', async () => {
    const clock = new Clock();
    const cases: [string[], RegExp][] = [
      [[], /no command given/],
      [['frobnicate', '--as', 'op'], /unknown command: frobnicate/],
      [['show', '--as', 'op'], /show takes 1 argument/],
      [['show', 'acc_x', 'acc_y', '--as', 'op'], /show takes 1 argument/],
      [['show', 'acc_x', '--bogus', '--as', 'op'], /show has no option --bogus/],
      [['show', 'acc_x', '--as'], /--as needs a value/],
      [['appeals', '--open=yes', '--as', 'op'], /--open takes no value/],
      [['mute', 'acc_x', '--reason', 'chat', '--reason', 'spam', '--for', '1d', '--as', 'op'], /--reason is given twice/],
      [['close-report', 'rep_x', '--as', 'op'], /close-report takes 2 arguments/],
    ];
    for (const [argv, msg] of cases) {
      const r = await cli(argv, clock);
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.err, argv.join(' ')).toMatch(msg);
      expect(r.err).toMatch(/usage: openmtg-accounts admin/);
    }
    const help = await cli(['--help'], clock);
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/warn\|mute|ban <account> --reason <code>/);
    const out: string[] = [];
    expect(await main(['nothing'], { err: (t) => out.push(t), env: {} })).toBe(2);
    expect(out.join('\n')).toMatch(/usage: openmtg-accounts admin <command>/);
  });

  it('who runs it: --as, --as=, or OPENMTG_OPERATOR; none answers exit 2; the configuration\'s problems and stores it cannot open, exit 2', async () => {
    const clock = new Clock();
    await prepare(clock, async (s) => void (await registerAs(s, 'Alice')));
    expect((await cli(['find', 'alice'], clock)).err).toMatch(/Give --as <operator> or set OPENMTG_OPERATOR/);
    expect((await cli(['find', 'alice'], clock)).code).toBe(2);
    clock.advance(1);
    expect((await cli(['find', 'alice', '--as=Night Owl'], clock)).code).toBe(0);
    clock.advance(1);
    expect((await cli(['find', 'alice'], clock, { env: { OPENMTG_OPERATOR: 'From Env' } })).code).toBe(0);
    const actors = await withStore(async (st) => (await st.audit({ kinds: ['adminViewed'], limit: 10 })).map((e) => [e.actor, e.actorOs]));
    expect(actors).toEqual([['admin:Night Owl', 'tester'], ['admin:From Env', 'tester']]);
    const bad = await cli(['find', 'alice', '--as', 'op'], clock, { env: { MIN_AGE: '7' } });
    expect([bad.code, bad.err]).toEqual([2, expect.stringMatching(/MIN_AGE/)]);
    const memory = await cli(['find', 'alice', '--as', 'op'], clock, { env: { ACCOUNTS_DATA_DIR: '', ACCOUNTS_STORE: 'memory' } });
    expect([memory.code, memory.err]).toEqual([2, expect.stringMatching(/memory store holds nothing/)]);
    const pg = await cli(['find', 'alice', '--as', 'op'], clock, { env: { ACCOUNTS_STORE: 'postgres' } });
    expect([pg.code, pg.err]).toEqual([2, expect.stringMatching(/ACCOUNTS_STORE=postgres/)]);
    const op = await cli(['find', 'alice', '--as', 'x'.repeat(65)], clock);
    expect([op.code, op.err]).toEqual([1, expect.stringMatching(/invalid: the operator's name/)]);
  });

  it('parses durations, repeated and trailing report ids, and --name=value', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000);
    expect(parseDuration('12h')).toBe(12 * HOUR);
    expect(parseDuration('7d')).toBe(7 * DAY);
    expect(parseDuration('2w')).toBe(14 * DAY);
    expect(parseDuration('1y')).toBe(365 * DAY);
    for (const bad of ['0d', '7', 'd', '1.5d', '-1d', '7days', '']) expect(() => parseDuration(bad), bad).toThrow(UsageError);
    const c = parseCommand(['ban', 'acc_x', '--report', 'rep_01J0000000000000000000AAAA', 'rep_01J0000000000000000000BBBB', '--reason=cheating', '--now', '--report', 'rep_01J0000000000000000000CCCC']);
    expect(c.values.get('report')).toEqual(['rep_01J0000000000000000000AAAA', 'rep_01J0000000000000000000BBBB', 'rep_01J0000000000000000000CCCC']);
    expect(c.values.get('reason')).toEqual(['cheating']);
    expect([...c.flags]).toEqual(['now']);
    expect(parseCommand(['find', 'Ann', 'Lee']).args).toEqual(['Ann', 'Lee']);
  });
});

describe('M14-6: each command, run in process (9.6)', () => {
  it('every moderation command parsed and run, each audited with the operator and the OS user', async () => {
    const clock = new Clock();
    let A = '' as AccountId, B = '' as AccountId, rep = '', rep2 = '', appealed = '';
    await prepare(clock, async (s) => {
      const alice = await registerAs(s, 'Alice');
      const bob = await registerAs(s, 'Bob');
      A = alice.auth.account;
      B = bob.auth.account;
      rep = value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: bob.auth }, { target: { account: A }, reason: 'chat' })).report;
      rep2 = value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: alice.auth }, { target: { account: B }, reason: 'cheating' })).report;
      appealed = (await s.service.admin.sanction(OP, A, { kind: 'warn', reason: 'chat', until: null, message: 'Earlier warning.' })).id;
      value(await s.service.appeal(ctxOf(s.clock), alice.auth, appealed, 'Please look again.', { password: PW }));
    });
    const before = await withStore(async (st) => new Set((await st.audit({ limit: 10_000 })).map((e) => e.id)));
    const as = ['--as', 'Mod CLI'];
    const step = async (argv: string[]) => {
      clock.advance(1);
      const r = await cli([...argv, ...as], clock);
      expect(r.code, `${argv.join(' ')}\n${r.err}`).toBe(0);
      return r.out;
    };
    expect(JSON.parse(await step(['find', 'ali']))).toEqual([{ id: A, name: 'Alice', createdAt: new Date(T0).toISOString(), lastSignInAt: new Date(T0).toISOString() }]);
    expect(JSON.parse(await step(['show', A])).account.name).toBe('Alice');
    expect(JSON.parse(await step(['reports', '--status', 'new', '--target', A])).map((r: { id: string }) => r.id)).toEqual([rep]);
    expect(JSON.parse(await step(['show-report', rep])).targetName).toBe('Alice');
    expect(await step(['close-report', rep, 'dismissed', '--note', 'banter'])).toBe(`report ${rep} closed: dismissed`);
    const warn = JSON.parse(await step(['warn', A, '--reason', 'chat', '--message', 'Be kind.', '--note', 'first']));
    expect(warn).toMatchObject({ kind: 'warn', reason: 'chat', message: 'Be kind.', until: null });
    const mute = JSON.parse(await step(['mute', A, '--reason', 'chat', '--for', '2h']));
    expect(mute.until).toBe(new Date(clock.t + 2 * HOUR).toISOString());
    expect(mute.message).toMatch(/turned your chat off/);
    expect(JSON.parse(await step(['unlist', A, '--reason', 'smurf'])).until).toBeNull();
    const until = new Date(T0 + 3 * DAY).toISOString();
    expect(JSON.parse(await step(['suspend', A, '--reason', 'harassment', '--until', until, '--now'])).until).toBe(until);
    const ban = JSON.parse(await step(['ban', B, '--reason', 'cheating', '--report', rep2, '--now']));
    expect(await step(['lift', mute.id])).toBe(`sanction ${mute.id} lifted`);
    expect(await step(['rename', A, '--reason', 'name', '--to', 'Alicia Two'])).toBe(`${A} renamed to "Alicia Two"`);
    expect(await step(['reserve', 'Help', 'Desk', '--note', 'staff'])).toBe('reserved "Help Desk"');
    expect(await step(['release', 'Help Desk'])).toBe('released "Help Desk"');
    expect(await step(['revoke', A])).toBe('revoked 1 session');
    expect(JSON.parse(await step(['appeals', '--open'])).map((a: { sanction: string }) => a.sanction)).toEqual([appealed]);
    expect(await step(['answer', appealed, 'upheld', '--message', 'It stands.'])).toBe(`appeal of ${appealed} answered: upheld`);
    const audit = JSON.parse(await step(['audit', A, '--since', new Date(T0 + 1).toISOString()])) as AuditEvent[];
    expect(audit.map((e) => e.kind)).toEqual(expect.arrayContaining(['sanctioned', 'forcedRename', 'sessionsRevoked', 'adminViewed']));
    expect(JSON.parse(await step(['rekey', '--check']))).toEqual({ from: 1, to: 1, changed: 0, collisions: [], unnamed: [] });

    await withStore(async (st) => {
      const fresh = (await st.audit({ limit: 10_000 })).filter((e) => !before.has(e.id) && e.actor.startsWith('admin:'));
      expect(fresh.every((e) => e.actor === 'admin:Mod CLI' && e.actorOs === 'tester')).toBe(true);
      expect(fresh.map((e) => e.kind).sort()).toEqual([
        'adminViewed', 'adminViewed', 'adminViewed', 'adminViewed', 'adminViewed', 'adminViewed', // find, show, reports, show-report, appeals, audit
        'appealAnswered', 'forcedRename', 'nameReleased', 'nameReserved', 'reportClosed', 'reportClosed', 'sanctionLifted',
        'sanctioned', 'sanctioned', 'sanctioned', 'sanctioned', 'sanctioned', 'sessionsRevoked', 'sessionsRevoked',
      ].sort());
      // what the commands did, as the store holds it
      expect((await st.account(A))!.name).toBe('Alicia Two');
      expect((await st.report(rep2))!.status).toBe('actioned');
      expect((await st.sanctionsOf(B)).map((x) => x.id)).toEqual([ban.id]);
      expect((await st.sessionsOf(B)).every((x) => x.revokeReason === 'sanction')).toBe(true);
      expect((await st.changes(0, 100)).filter((c) => c.kind === 'standing' && c.detail?.now === true).map((c) => c.account)).toEqual([A, B]);
    });
  });

  it('a refusal by the admin is exit 1 with its code; nothing is changed', async () => {
    const clock = new Clock();
    let A = '' as AccountId;
    await prepare(clock, async (s) => void (A = (await registerAs(s, 'Alice')).auth.account));
    const as = ['--as', 'op'];
    const cases: [string[], RegExp][] = [
      [['show', `acc_7${'Z'.repeat(25)}`], /notFound: no such account/],
      [['show-report', 'rep_01J0000000000000000000ZZZZ'], /notFound: no such report/],
      [['mute', A, '--reason', 'chat'], /invalid: a mute needs an end/],
      [['suspend', A, '--reason', 'chat', '--for', '2y'], /invalid: a suspend lasts at most 365 days/],
      [['lift', 'san_01J0000000000000000000ZZZZ'], /notFound: no such sanction/],
      [['release', 'Alice'], /conflict: an account has this name/],
      [['export', A], /incomplete/],
    ];
    for (const [argv, msg] of cases) {
      const r = await cli([...argv, ...as], clock, { env: { ACCOUNTS_REQUIRED_HOLDERS: 'hosted' } });
      expect(r.code, argv.join(' ')).toBe(1);
      expect(r.err, argv.join(' ')).toMatch(msg);
    }
    const bad: [string[], RegExp][] = [
      [['warn', A, '--reason', 'rude'], /--reason: one of/],
      [['warn', A, '--reason', 'chat', '--for', '1d'], /a warning has no end/],
      [['ban', A, '--reason', 'chat', '--for', '1d', '--until', '2030-01-01'], /give --for or --until, not both/],
      [['ban', 'acc_x', '--reason', 'chat'], /not an account id/],
      [['answer', 'san_x', 'maybe', '--message', 'x'], /upheld or lifted/],
      [['delete', A], /delete needs --reason/],
      [['mute', A, '--reason', 'chat', '--until', 'soon'], /--until: not an ISO 8601/],
      // the store keeps no note for a lift: refused, never dropped
      [['lift', 'san_01J0000000000000000000ZZZZ', '--note', 'too harsh'], /lift takes no --note: notes are not stored for a lift/],
      // a duration that ends past the last time a date holds
      [['ban', A, '--reason', 'cheating', '--for', '999999y'], /--for 999999y: the end is too far ahead/],
    ];
    for (const [argv, msg] of bad) {
      const r = await cli([...argv, ...as], clock);
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.err, argv.join(' ')).toMatch(msg);
    }
    expect((await cli(['ban', A, '--reason', 'cheating', '--for', '999999y', ...as], clock)).err).toMatch(/usage: openmtg-accounts admin ban <account>/);
    await withStore(async (st) => expect(await st.sanctionsOf(A)).toEqual([]));
  });
});

describe('M14-6: pages of reports and appeals (9.6)', () => {
  it('--limit rows, oldest first, and a "more" line on stderr naming the next page\'s --after; the last page has none', async () => {
    const clock = new Clock();
    const reports: string[] = [];
    const sanctions: string[] = [];
    await prepare(clock, async (s) => {
      const bob = await registerAs(s, 'Bob');
      const alice = await registerAs(s, 'Alice');
      for (let i = 0; i < 5; i++) {
        clock.advance(1);
        const session = `gs_page${i}`;
        const ctx = ctxOf(clock, { guestSession: session, addressKey: `192.0.2.${10 + i}` });
        reports.push(value(await s.service.report(ctx, { kind: 'guest', session }, { target: { account: bob.auth.account }, reason: 'chat' })).report);
      }
      for (let i = 0; i < 3; i++) {
        clock.advance(1);
        const w = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: `Warning ${i}.` });
        clock.advance(1);
        value(await s.service.appeal(ctxOf(clock), alice.auth, w.id, `Appeal ${i}.`, { password: PW }));
        sanctions.push(w.id);
      }
    });
    const run = async (argv: string[]) => {
      clock.advance(1);
      const r = await cli([...argv, '--as', 'op'], clock);
      expect(r.code, `${argv.join(' ')}\n${r.err}`).toBe(0);
      return { ids: (JSON.parse(r.out) as { id?: string; sanction?: string }[]).map((x) => x.id ?? x.sanction), err: r.err };
    };
    const more = (id: string) => `openmtg-accounts: more: the next page is --after ${id}`;
    expect(await run(['reports', '--limit', '2'])).toEqual({ ids: reports.slice(0, 2), err: more(reports[1]!) });
    expect(await run(['reports', '--limit', '2', '--after', reports[1]!])).toEqual({ ids: reports.slice(2, 4), err: more(reports[3]!) });
    expect(await run(['reports', '--limit=2', `--after=${reports[3]!}`])).toEqual({ ids: [reports[4]], err: '' });
    // the default page holds them all
    expect(await run(['reports', '--status', 'new'])).toEqual({ ids: reports, err: '' });
    // appeals the same, after an appeal's sanction id
    expect(await run(['appeals', '--open', '--limit', '2'])).toEqual({ ids: sanctions.slice(0, 2), err: more(sanctions[1]!) });
    expect(await run(['appeals', '--after', sanctions[1]!])).toEqual({ ids: [sanctions[2]], err: '' });
    for (const argv of [['reports', '--limit', '0'], ['reports', '--limit', '501'], ['appeals', '--limit', 'ten']]) {
      const r = await cli([...argv, '--as', 'op'], clock);
      expect([r.code, r.err], argv.join(' ')).toEqual([2, expect.stringMatching(/--limit: a whole number from 1 to 500/)]);
    }
    expect(await cli(['reports', '--after', 'nope', '--as', 'op'], clock)).toMatchObject({ code: 1, err: expect.stringMatching(/invalid: after is not a valid id/) });
    expect(await cli(['appeals', '--after', reports[0]!, '--as', 'op'], clock)).toMatchObject({ code: 1, err: expect.stringMatching(/invalid: after is not a valid id/) });
  });
});

describe('M14-6: the OS user every command records (9.6, D16)', () => {
  it('the system\'s user name, else uid:<number>, never the environment; neither known: refused before anything runs', async () => {
    const noPasswd = () => {
      throw new Error('no passwd entry');
    };
    expect(osUserOf({ userInfo: () => ({ username: 'mod-ops' }), getuid: () => 1000 })).toBe('mod-ops');
    expect(osUserOf({ userInfo: noPasswd, getuid: () => 1000 })).toBe('uid:1000');
    expect(osUserOf({ userInfo: () => ({ username: '' }), getuid: () => 0 })).toBe('uid:0');
    expect(osUserOf({ userInfo: noPasswd, getuid: undefined })).toBeNull();
    // this process's own: a name or a uid, whatever $USER says
    const mine = osUserOf();
    expect(mine === null || mine !== '').toBe(true);
    const clock = new Clock();
    await prepare(clock, async (s) => void (await registerAs(s, 'Alice')));
    const r = await cli(['find', 'alice', '--as', 'op'], clock, { env: { USER: 'mallory', USERNAME: 'mallory' }, osUser: () => null });
    expect([r.code, r.err, r.out]).toEqual([2, expect.stringMatching(/cannot tell which OS user runs this/), '']);
    await withStore(async (st) => expect(await st.audit({ kinds: ['adminViewed'], limit: 10 })).toEqual([]));
  });
});

describe('M14-6: beside a running server (9.6: the real file store, PostgreSQL on PGlite)', { timeout: 60_000 }, () => {
  it('the file store\'s lock refuses the command while another opener holds it ("stop the server, or use PostgreSQL"); afterwards it runs', async () => {
    const clock = new Clock();
    const real = factories(newCalls(), { openFileAccountStore });
    const s = setup({ store: await openFileAccountStore({ dir }), clock });
    const A = (await registerAs(s, 'Alice')).auth.account;
    await s.service.close();
    const server = await openFileAccountStore({ dir });
    try {
      const r = await cli(['show', A, '--as', 'op'], clock, { factories: real });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/is in use \(is the server running\?\): stop the server, or use PostgreSQL/);
      expect(r.out).toBe('');
    } finally {
      await server.close();
    }
    expect((await cli(['show', A, '--as', 'op'], clock, { factories: real })).code).toBe(0);
  });
});

describe('M14-6: the data-rights commands from the command line (9.6, 10)', () => {
  it('delete --now only sets purgeAt: the part\'s deleteAccount with now, never a tick, no erasure, no tombstone', async () => {
    const clock = new Clock();
    let A = '' as AccountId, B = '' as AccountId;
    await prepare(clock, async (s) => {
      A = (await registerAs(s, 'Alice')).auth.account;
      B = (await registerAs(s, 'Bob')).auth.account;
    });
    const calls = newCalls();
    const r = await cli(['delete', A, '--reason', 'asked by mail', '--now', '--as', 'op'], clock, { calls });
    expect(r.code, r.err).toBe(0);
    const purgeAt = new Date(T0 + 5 * DAY).toISOString();
    expect(r.out).toBe(`${A}: purgeAt ${purgeAt}; the server's tick erases it with every holder (with the file store, at the server's next start)`);
    expect(calls.deleteAccount).toEqual([[{ name: 'op', osUser: 'tester' }, A, 'asked by mail', true]]);
    expect(calls.tick).toBe(0);
    await withStore(async (st) => {
      expect((await st.account(A))!.deletion).toEqual({ requestedAt: purgeAt, purgeAt, erasingAt: null, done: [] });
      expect(await st.tombstone(A)).toBeNull();
      expect((await st.changes(0, 100)).filter((c) => c.kind === 'deleted')).toEqual([]);
    });
    // without --now: the grace of 7 days
    const later = await cli(['delete', B, '--reason', 'asked by mail', '--as', 'op'], clock, { calls });
    expect(later.out).toBe(`${B}: deletion requested, purgeAt ${new Date(T0 + 12 * DAY).toISOString()}`);
    expect(calls.deleteAccount[1]![3]).toBe(false);
    expect(calls.tick).toBe(0);
    // purge is the part's too
    expect(JSON.parse((await cli(['purge', '--as', 'op'], clock, { calls })).out)).toMatchObject({ sessions: 0, tombstones: 0 });
    expect(calls.purge).toBe(1);
  });

  it('export is refused without the required holders; --partial writes it, marked with the missing ones, mode 0600 (once: the part\'s own file if it wrote one)', async () => {
    const clock = new Clock();
    let A = '' as AccountId;
    await prepare(clock, async (s) => void (A = (await registerAs(s, 'Alice')).auth.account));
    const env = { ACCOUNTS_REQUIRED_HOLDERS: 'hosted,ladder' };
    const calls = newCalls();
    const refused = await cli(['export', A, '--as', 'op'], clock, { env, calls });
    expect([refused.code, refused.err]).toEqual([1, expect.stringMatching(/incomplete: required holders missing: hosted, ladder/)]);
    expect(await readdir(join(dir, 'exports')).catch(() => [])).toEqual([]);
    const partial = await cli(['export', A, '--partial', '--as', 'op'], clock, { env, calls });
    expect(partial.code, partial.err).toBe(0);
    expect(calls.exportAccount.map((c) => c[2])).toEqual([false, true]);
    const files = await readdir(join(dir, 'exports'));
    expect(files).toEqual([`${A}-${new Date(T0).toISOString().replace(/[:.]/g, '-')}.json`]);
    const file = join(dir, 'exports', files[0]!);
    expect(partial.out).toBe(`export of ${A} (incomplete: missing hosted, ladder) written to ${file}`);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600); // Windows has no Unix modes
    expect(JSON.parse(await readFile(file, 'utf8')).missing).toEqual(['hosted', 'ladder']);
    // a part that writes the file itself: the command reports that one and writes none
    clock.advance(1);
    const own = await cli(['export', A, '--partial', '--as', 'op'], clock, { env, factories: factories(calls, { createRightsPart: fakeRights(calls, { writeFile: true }) }) });
    expect(own.out).toBe(`export of ${A} (incomplete: missing hosted, ladder) written to ${join(dir, 'exports', `${A}-by-rights.json`)}`);
    expect((await readdir(join(dir, 'exports'))).sort()).toEqual([files[0], `${A}-by-rights.json`].sort());
    // with no required holder, a complete export
    const complete = await cli(['export', A, '--as', 'op'], clock, { calls });
    expect(complete.out).toMatch(new RegExp(`^export of ${A} written to `));
  });

  it('without the data-rights part (M14-7 not merged), its commands answer incomplete', async () => {
    const clock = new Clock();
    let A = '' as AccountId;
    await prepare(clock, async (s) => void (A = (await registerAs(s, 'Alice')).auth.account));
    const f = { ...factories(newCalls()), createRightsPart: undefined as never };
    for (const argv of [['export', A], ['delete', A, '--reason', 'x', '--now'], ['purge']]) {
      const r = await cli([...argv, '--as', 'op'], clock, { factories: f });
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/incomplete: The data-rights commands are not built yet \(M14-7\)/);
    }
  });
});

/** Two fixed name data tables (as M14-2's and M14-5's tests): the second maps "q" to "g", so "Qwen" and "Gwen" become one name. */
function fixedData(version: number, extra: [string, string][] = []): GeneratedNameData {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return {
    version, unicodeVersion: `test-${version}`, sources: 'fixed test tables', supplement: encodeNameTable([['i', 'l']]),
    caseFolding: encodeNameTable(Array.from(upper, (c) => [c, c.toLowerCase()] as [string, string])),
    confusables: encodeNameTable([['I', 'l'], ['1', 'l'], ['0', 'O'], ['m', 'rn'], ...extra]),
  };
}

describe('M14-6: rekey from the command line (6.3)', () => {
  it('rekey --check lists the collision new name data would make; rekey refuses while it remains', async () => {
    const clock = new Clock();
    const v1 = createNameData(fixedData(1));
    const v2 = createNameData(fixedData(2, [['q', 'g']]));
    await prepare(clock, async (s) => {
      await registerAs(s, 'Qwen');
      await registerAs(s, 'Gwen');
      await registerAs(s, 'Alice');
    }, createNameRules({ reservedNamesText: '', data: v1 }));
    const f = factories(newCalls(), { createNameRules: (o) => createNameRules({ ...o, data: v2, previous: v1 }) });
    const check = await cli(['rekey', '--check', '--as', 'op'], clock, { factories: f });
    expect(check.code, check.err).toBe(0);
    const parsed = JSON.parse(check.out);
    expect([parsed.from, parsed.to]).toEqual([1, 2]);
    expect(parsed.collisions.map((c: { key: string; names: { name: string }[] }) => [c.key, c.names.map((n) => n.name).sort()])).toEqual([['gwen', ['Gwen', 'Qwen']]]);
    const rekey = await cli(['rekey', '--as', 'op'], clock, { factories: f });
    expect([rekey.code, rekey.err]).toEqual([1, expect.stringMatching(/conflict: 1 collisions remain/)]);
    await withStore(async (st) => expect(await st.nameKeyVersion()).toBe(1));
  });

  it('settled with forced renames: their generated and reserved names are no collision; the banned key, listed by its entry, is released by it', async () => {
    const clock = new Clock();
    const v1 = createNameData(fixedData(1));
    const v2 = createNameData(fixedData(2, [['q', 'g']]));
    let Q = '' as AccountId, G = '' as AccountId, A = '' as AccountId, O = '' as AccountId;
    await prepare(clock, async (s) => {
      Q = (await registerAs(s, 'Qwen')).auth.account;
      G = (await registerAs(s, 'Gwen')).auth.account;
      A = (await registerAs(s, 'Alice')).auth.account;
      // reserved only under the new data ("q" becomes "g": the contains-rule "openmtg")
      O = (await registerAs(s, 'Openmtq')).auth.account;
    }, createNameRules({ reservedNamesText: '', data: v1 }));
    // the new server settles the collision: Qwen renamed (a generated name), and Alice given a reserved name (both under the store's version 1)
    const names = createNameRules({ reservedNamesText: '', data: v2, previous: v1 });
    clock.advance(HOUR);
    await prepare(clock, async (s) => {
      expect((await s.service.admin.forceRename(OP, Q, 'name')).name).toMatch(/^Player [0-9]{6}$/);
      expect((await s.service.admin.forceRename(OP, A, 'other', 'Moderator')).name).toBe('Moderator');
    }, names);
    const f = factories(newCalls(), { createNameRules: (o) => createNameRules({ ...o, data: v2, previous: v1 }) });
    clock.advance(1);
    const check = await cli(['rekey', '--check', '--as', 'op'], clock, { factories: f });
    expect(check.code, check.err).toBe(0);
    // Gwen and the banned "qwen", each with its entry as the store keeps it; a name reserved only under the new data
    expect(JSON.parse(check.out).collisions).toEqual([
      {
        key: 'gwen',
        names: [
          { kind: 'current', name: 'Gwen', account: G, entry: { key: 'gwen', keyVersion: 1 } },
          // the ban keeps the account it was taken from (M14-15, review A6), and is keyed again from the name it banned (review A7)
          { kind: 'banned', name: 'Qwen', account: Q, entry: { key: 'qwen', keyVersion: 1 } },
        ],
      },
      {
        key: 'openrntg',
        names: [{ kind: 'current', name: 'Openmtq', account: O, entry: { key: 'openrntq', keyVersion: 1 } }, { kind: 'reserved', name: null, account: null, entry: null }],
      },
    ]);
    // the name the collision is listed under keys to Gwen's current name; the banned entry's own key releases it
    clock.advance(1);
    expect(await cli(['release', 'gwen', '--as', 'op'], clock, { factories: f })).toMatchObject({ code: 1, err: expect.stringMatching(/conflict: an account has this name/) });
    expect(await cli(['release', 'qwen', '--key-version', 'one', '--as', 'op'], clock, { factories: f })).toMatchObject({ code: 2, err: expect.stringMatching(/--key-version: a whole number/) });
    clock.advance(1);
    expect(await cli(['release', 'qwen', '--key-version', '1', '--as', 'op'], clock, { factories: f })).toMatchObject({ code: 0, out: 'released "qwen"' });
    clock.advance(1);
    await prepare(clock, async (s) => void (await s.service.admin.forceRename(OP, O, 'name')), names);
    clock.advance(1);
    expect(JSON.parse((await cli(['rekey', '--check', '--as', 'op'], clock, { factories: f })).out).collisions).toEqual([]);
    clock.advance(1);
    const rekey = await cli(['rekey', '--as', 'op'], clock, { factories: f });
    expect([rekey.code, rekey.err]).toEqual([0, '']);
    await withStore(async (st) => {
      expect(await st.nameKeyVersion()).toBe(2);
      expect((await st.account(A))!.name).toBe('Moderator');
    });
  });
});
