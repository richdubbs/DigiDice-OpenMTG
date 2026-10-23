/**
 * M14-8: the mailers built now (design 3.4). Server only. A real sender (the owner's mail provider's HTTP API through `fetch`) is an owner setup item;
 * until then email recovery is off in any real deployment.
 *
 * - **NoMailer** (`kind` 'none', MAILER=none, the default): sends nothing and keeps nothing. With it the service hides email: setEmail (an address
 *   to set) and requestEmailReset answer emailUnavailable for every name alike, and register refuses an address (src/service/signin.ts).
 * - **FileMailer** (`kind` 'file', MAILER=file, development): each message is a text file `<dir>/<account>/<expires>-<kind>-<random>.txt` (dir is
 *   ACCOUNTS_DATA_DIR/mail), the directories mode 0700 and the files mode 0600, written exclusively (never over another file). `<expires>` is the
 *   time in milliseconds when the file goes: the message's code expiry (meta.expiresAt), or for a notice `noticeFileMs` after it was written.
 *   `forget(null, now)` deletes every file whose time has come, and the directories it empties; `forget(account, now)` deletes all of an account's
 *   files at once (its erasure, 10.2). The account id is checked against ACCOUNT_ID before it names a directory. No log line, no address outside the
 *   message file itself.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isAccountId, type AccountId } from '../api';
import type { CreateFileMailer, CreateNoMailer, MailKind, Mailer } from './api';

/** A mailer that keeps files by account (FileMailer): the email part's tick also deletes the files of accounts that no longer exist. */
export interface MailFiles {
  /** The accounts that have a directory of messages. */
  filedAccounts(): Promise<AccountId[]>;
}

/** A mailer that keeps files by account and can forget them. */
export type FilingMailer = Mailer & MailFiles & Required<Pick<Mailer, 'forget'>>;

export function hasMailFiles(m: Mailer): m is FilingMailer {
  return typeof (m as Partial<MailFiles>).filedAccounts === 'function' && typeof m.forget === 'function';
}

export const buildNoMailer: CreateNoMailer = (): Mailer => ({
  kind: 'none',
  async send() {
    // nothing is sent and nothing is kept
  },
  async forget() {
    return 0;
  },
});

/** What FileMailer takes besides CreateFileMailer's options: the clock that dates a notice's file (the system clock by default; tests pass one). */
export interface FileMailerInternals {
  now?: () => Date;
}

const FILE_NAME = /^(\d{1,16})-(verify|reset|notice)-[0-9a-f]{16}\.txt$/;
const KINDS: readonly MailKind[] = ['verify', 'reset', 'notice'];

/** The files of one account directory and when each goes (null: not one of FileMailer's names). */
async function filesOf(dir: string): Promise<{ name: string; due: number | null }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as { code?: unknown }).code === 'ENOENT') return [];
    throw e;
  }
  return names.map((name) => {
    const m = FILE_NAME.exec(name);
    return { name, due: m !== null ? Number(m[1]) : null };
  });
}

export function buildFileMailer(opts: Parameters<CreateFileMailer>[0], internals: FileMailerInternals = {}): FilingMailer {
  const { dir } = opts;
  const noticeFileMs = opts.noticeFileMs;
  if (typeof dir !== 'string' || dir.length === 0) throw new TypeError('FileMailer needs a directory');
  if (!Number.isFinite(noticeFileMs) || noticeFileMs < 0) throw new RangeError('FileMailer needs a noticeFileMs of 0 or more');
  const clock = internals.now ?? (() => new Date());

  async function forgetAccount(account: AccountId): Promise<number> {
    const d = join(dir, account);
    const n = (await filesOf(d)).length;
    await rm(d, { recursive: true, force: true });
    return n;
  }

  async function forgetDue(now: Date): Promise<number> {
    let removed = 0;
    for (const account of await filedAccounts()) {
      const d = join(dir, account);
      const files = await filesOf(d);
      let left = files.length;
      for (const f of files) {
        if (f.due === null || f.due > now.getTime()) continue;
        await rm(join(d, f.name), { force: true });
        removed++;
        left--;
      }
      // a directory emptied here goes too (one a send is writing into again at this moment is not empty, and stays)
      if (left === 0) await rmdir(d).catch(() => undefined);
    }
    return removed;
  }

  async function filedAccounts(): Promise<AccountId[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      if ((e as { code?: unknown }).code === 'ENOENT') return [];
      throw e;
    }
    return names.filter(isAccountId).sort();
  }

  return {
    kind: 'file',
    async send(to, message, meta) {
      if (!isAccountId(meta.account)) throw new TypeError('FileMailer: the message has no valid account');
      if (!KINDS.includes(meta.kind)) throw new TypeError('FileMailer: the message has no valid kind');
      if (typeof to !== 'string' || typeof message.subject !== 'string' || typeof message.text !== 'string') throw new TypeError('FileMailer: not a message');
      const due = meta.expiresAt !== null ? Date.parse(meta.expiresAt) : clock().getTime() + noticeFileMs;
      if (!Number.isSafeInteger(due) || due < 0) throw new RangeError('FileMailer: the message has no valid expiry');
      const d = join(dir, meta.account);
      const file = join(d, `${due}-${meta.kind}-${randomBytes(8).toString('hex')}.txt`);
      const body =
        `To: ${to}\nSubject: ${message.subject}\nKind: ${meta.kind}\nDeleted after: ${new Date(due).toISOString()}\n\n` +
        `${message.text.endsWith('\n') ? message.text : `${message.text}\n`}`;
      for (let attempt = 0; ; attempt++) {
        // the directories mode 0700 (every one mkdir makes), the account's own also when it was there before
        await mkdir(d, { recursive: true, mode: 0o700 });
        await chmod(d, 0o700);
        let fh;
        try {
          // exclusive, and mode 0600 whatever the umask
          fh = await open(file, 'wx', 0o600);
        } catch (e) {
          // forget(null) removed the emptied directory between the two steps: once more
          if ((e as { code?: unknown }).code === 'ENOENT' && attempt === 0) continue;
          throw e;
        }
        try {
          await fh.chmod(0o600);
          await fh.writeFile(body, 'utf8');
        } finally {
          await fh.close();
        }
        return;
      }
    },
    async forget(account, now) {
      if (account !== null) {
        if (!isAccountId(account)) throw new TypeError('FileMailer: not an account id');
        return forgetAccount(account);
      }
      return forgetDue(now);
    },
    filedAccounts,
  };
}
