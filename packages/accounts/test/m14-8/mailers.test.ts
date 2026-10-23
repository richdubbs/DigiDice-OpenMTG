/**
 * M14-8: the mailers and the mail queue (design 3.4, 10.2, 10.3). FileMailer writes each message mode 0600 under mail/<account>/ (directories
 * 0700), deletes a code's file when the code expires, a notice's after a day and every file of an account at its erasure, and the service's tick does
 * it on time; NoMailer keeps nothing; the queue sends after the answer, one message at a time, bounded (the oldest notice gives way, never a code),
 * and logs only kinds and error names.
 */
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountId } from '@openmtg/accounts';
import { createFileMailer, createMailQueue, createNoMailer } from '../../src/email/index';
import { buildFileMailer } from '../../src/email/mailers';
import { buildMailQueue } from '../../src/email/queue';
import {
  Clock, codeOf, ctxFor, DAY, inRow, mailSetup, MIN, PW, PW2, RecordingMailer, registerWith, T0, until, value, type LogLine, type SentMail,
} from './support';

const A = 'acc_00000000000000000000000001' as AccountId;
const B = 'acc_00000000000000000000000002' as AccountId;
const ALICE = 'alice.liddell@example.org';
const iso = (t: number) => new Date(t).toISOString();
const posix = process.platform !== 'win32';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'openmtg-m14-8-mail-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  let accounts: string[];
  try {
    accounts = await readdir(dir);
  } catch {
    return out;
  }
  for (const a of accounts) for (const f of await readdir(join(dir, a))) out.push(`${a}/${f}`);
  return out.sort();
}

/** Every byte under `dir`, file names included, as text. */
async function everything(dir: string): Promise<string> {
  let text = '';
  for (const f of await filesUnder(dir)) text += `${f}\n${await readFile(join(dir, f), 'utf8')}\n`;
  return text;
}

describe('M14-8: FileMailer (3.4)', () => {
  it('one file per message, mode 0600, under mail/<account>/ (0700); a code\'s goes at its expiry, a notice\'s after a day', async () => {
    const root = await tempDir();
    const dir = join(root, 'mail');
    const clock = new Clock();
    const m = buildFileMailer({ dir, noticeFileMs: DAY }, { now: clock.now });
    expect(m.kind).toBe('file');
    await m.send(ALICE, { subject: 'Your code', text: 'Code: ABCDE-FGHJK' }, { account: A, kind: 'verify', expiresAt: iso(T0 + 15 * MIN) });
    await m.send(ALICE, { subject: 'A notice', text: 'Something changed.\n' }, { account: A, kind: 'notice', expiresAt: null });
    await m.send('bob@example.org', { subject: 'Your reset', text: 'Code: KJHGF-EDCBA' }, { account: B, kind: 'reset', expiresAt: iso(T0 + 15 * MIN) });
    const files = await filesUnder(dir);
    expect(files).toHaveLength(3);
    expect(files.filter((f) => f.startsWith(`${A}/`))).toHaveLength(2);
    for (const f of files) {
      // the name holds the time it goes and the kind, never the address
      expect(f).toMatch(/^acc_0{25}[12]\/\d+-(verify|reset|notice)-[0-9a-f]{16}\.txt$/);
      expect(f).not.toContain('@');
      if (posix) expect((await stat(join(dir, f))).mode & 0o777).toBe(0o600);
    }
    if (posix) {
      expect((await stat(join(dir, A))).mode & 0o777).toBe(0o700);
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
    const verify = files.find((f) => f.includes('-verify-'))!;
    expect(verify).toContain(`/${T0 + 15 * MIN}-verify-`);
    expect(await readFile(join(dir, verify), 'utf8')).toBe(
      `To: ${ALICE}\nSubject: Your code\nKind: verify\nDeleted after: ${iso(T0 + 15 * MIN)}\n\nCode: ABCDE-FGHJK\n`,
    );
    expect(files.find((f) => f.includes('-notice-'))).toContain(`/${T0 + DAY}-notice-`);
    // nothing before its time
    expect(await m.forget(null, new Date(T0 + 15 * MIN - 1))).toBe(0);
    expect(await filesUnder(dir)).toHaveLength(3);
    // the codes at their expiry; B's emptied directory goes too
    expect(await m.forget(null, new Date(T0 + 15 * MIN))).toBe(2);
    expect(await filesUnder(dir)).toEqual([files.find((f) => f.includes('-notice-'))]);
    expect(await m.filedAccounts()).toEqual([A]);
    // the notice after a day
    expect(await m.forget(null, new Date(T0 + DAY))).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it('every file of an account at its erasure; ids that are not account ids are refused', async () => {
    const root = await tempDir();
    const dir = join(root, 'mail');
    const m = createFileMailer({ dir, noticeFileMs: DAY });
    for (const kind of ['verify', 'reset', 'notice'] as const) {
      await m.send(ALICE, { subject: 's', text: 't' }, { account: A, kind, expiresAt: kind === 'notice' ? null : iso(Date.now() + DAY) });
    }
    await m.send('bob@example.org', { subject: 's', text: 't' }, { account: B, kind: 'notice', expiresAt: null });
    expect(await m.forget!(A, new Date())).toBe(3);
    expect(await filesUnder(dir)).toHaveLength(1);
    expect(await everything(dir)).not.toContain(A);
    expect(await everything(dir)).not.toContain(ALICE);
    await expect(m.forget!('../outside' as AccountId, new Date())).rejects.toThrow(TypeError);
    await expect(m.send(ALICE, { subject: 's', text: 't' }, { account: '../../etc' as AccountId, kind: 'notice', expiresAt: null })).rejects.toThrow(TypeError);
    await expect(m.send(ALICE, { subject: 's', text: 't' }, { account: A, kind: 'notice', expiresAt: 'soon' })).rejects.toThrow(RangeError);
    expect(() => createFileMailer({ dir: '', noticeFileMs: DAY })).toThrow(TypeError);
  });

  it('through the service: the verification file holds the code; tick deletes on time and after an erasure, and counts what it deleted', async () => {
    const root = await tempDir();
    const dir = join(root, 'mail');
    const clock = new Clock();
    const s = mailSetup({ mailer: buildFileMailer({ dir, noticeFileMs: DAY }, { now: clock.now }), clock });
    const reg = await registerWith(s, 'Alice', ALICE);
    const id = reg.auth.account;
    const [first] = await filesUnder(dir);
    expect(first).toMatch(new RegExp(`^${id}/\\d+-verify-`));
    const text = await readFile(join(dir, first!), 'utf8');
    expect(text.startsWith(`To: ${ALICE}\nSubject: Your OpenMTG verification code\n`)).toBe(true);
    const ctx = ctxFor(s, 'alice');
    value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codeOf({ text } as SentMail))));
    // a notice to the verified address
    value(inRow('changePassword', await s.service.changePassword(ctx, reg.auth, PW, PW2)));
    await s.idle();
    expect((await filesUnder(dir)).map((f) => f.split('-')[1]).sort()).toEqual(['notice', 'verify']);
    clock.advance(15 * MIN);
    expect((await s.service.tick(clock.now())).mailFilesRemoved).toBe(1);
    expect((await filesUnder(dir)).map((f) => f.split('-')[1])).toEqual(['notice']);
    clock.advance(DAY);
    expect((await s.service.tick(clock.now())).mailFilesRemoved).toBe(1);
    expect(await filesUnder(dir)).toEqual([]);
    // a reset mail, then the account is erased (as the rights part's erasure does): the next tick deletes its files
    value(await s.service.requestEmailReset(ctxFor(s, 'asker'), 'Alice'));
    await s.idle();
    expect(await filesUnder(dir)).toHaveLength(1);
    const now = clock.now();
    const at = now.toISOString();
    const a = (await s.store.account(id))!;
    await s.store.updateAccount(id, a.version, { deletion: { requestedAt: at, purgeAt: at, erasingAt: at, done: [] } });
    await s.store.erase(id, { account: id, deletedAt: at, sanctionUntil: null, holdersDone: [] }, new Date(now.getTime() + 90 * DAY).toISOString());
    expect((await s.service.tick(now)).mailFilesRemoved).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('M14-8: NoMailer (3.4)', () => {
  it('sends nothing and keeps nothing', async () => {
    const m = createNoMailer();
    expect(m.kind).toBe('none');
    await expect(m.send(ALICE, { subject: 's', text: 't' }, { account: A, kind: 'verify', expiresAt: null })).resolves.toBeUndefined();
    expect(await m.forget!(A, new Date())).toBe(0);
    expect(JSON.stringify(m)).not.toContain(ALICE);
  });
});

describe('M14-8: the mail queue (3.4, 11.3 MailQueue)', () => {
  const msg = (n: string) => ({ subject: `subject ${n}`, text: `text ${n}` });
  const meta = (kind: SentMail['meta']['kind']) => ({ account: A, kind, expiresAt: kind === 'notice' ? null : iso(T0 + 15 * MIN) });

  it('sends after enqueue returns, one message at a time and in order', async () => {
    const mailer = new RecordingMailer();
    mailer.hold = true;
    const q = createMailQueue({ mailer, log: { event: () => undefined } });
    q.enqueue('one@example.org', msg('1'), meta('verify'));
    q.enqueue('two@example.org', msg('2'), meta('notice'));
    expect(mailer.calls).toBe(0);
    await until(() => mailer.calls === 1);
    // the first is held: the second waits
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
    expect(mailer.calls).toBe(1);
    mailer.release();
    await until(() => mailer.resolved === 2);
    expect(mailer.sent.map((m) => m.to)).toEqual(['one@example.org', 'two@example.org']);
  });

  it('bounded: the oldest notice gives way to a new message; a waiting code never does, so a new message then is dropped', async () => {
    const mailer = new RecordingMailer();
    const log: LogLine[] = [];
    const later: (() => void)[] = [];
    const q = buildMailQueue({ mailer, log: { event: (name, fields) => log.push({ name, fields }) } }, { max: 3, schedule: (f) => later.push(f) });
    q.enqueue('n1@example.org', msg('n1'), meta('notice'));
    q.enqueue('v1@example.org', msg('v1'), meta('verify'));
    q.enqueue('n2@example.org', msg('n2'), meta('notice'));
    q.enqueue('r1@example.org', msg('r1'), meta('reset')); // n1 gives way
    q.enqueue('n3@example.org', msg('n3'), meta('notice')); // n2 gives way
    q.enqueue('v2@example.org', msg('v2'), meta('verify')); // n3 gives way
    q.enqueue('n4@example.org', msg('n4'), meta('notice')); // only codes wait: n4 dropped
    q.enqueue('r2@example.org', msg('r2'), meta('reset')); // and r2
    expect(q.size).toBe(3);
    expect(later).toHaveLength(1);
    later[0]!();
    await q.idle();
    expect(mailer.sent.map((m) => m.to)).toEqual(['v1@example.org', 'r1@example.org', 'v2@example.org']);
    expect(log.map((l) => [l.name, l.fields['kind']])).toEqual([
      ['accounts.mail.dropped', 'notice'], ['accounts.mail.dropped', 'notice'], ['accounts.mail.dropped', 'notice'],
      ['accounts.mail.dropped', 'notice'], ['accounts.mail.dropped', 'reset'],
    ]);
    expect(JSON.stringify(log)).not.toContain('@');
  });

  it('a failed send is logged by its kind and its error\'s name only, never the address or the error\'s message', async () => {
    const log: LogLine[] = [];
    const failing = {
      kind: 'test',
      async send(to: string) {
        throw Object.assign(new Error(`could not deliver to ${to}`), { name: 'MailError' });
      },
    };
    const q = buildMailQueue({ mailer: failing, log: { event: (name, fields) => log.push({ name, fields }) } });
    q.enqueue('zed.secret@example.org', msg('x'), meta('reset'));
    q.enqueue('zed.secret@example.org', msg('y'), meta('notice'));
    await q.idle();
    expect(log).toEqual([
      { name: 'accounts.mail.failed', fields: { kind: 'reset', error: 'MailError' } },
      { name: 'accounts.mail.failed', fields: { kind: 'notice', error: 'MailError' } },
    ]);
    expect(q.size).toBe(0);
  });
});
