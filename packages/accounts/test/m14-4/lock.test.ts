/**
 * M14-4: the store directory's lock (src/store/lock.ts; the file store's, kept for the development store on PGlite by F26): a second opener refused,
 * in this process and in another one, until the holder releases it; a stale lock (its process gone, unreadable, left by an earlier process with this
 * process's id, or with an id a later process now has) taken over with a warning; two openers at once; the lock file's mode. Fixed inputs only.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AccountStoreError } from '@openmtg/accounts';
import { STORE_LOCK_FILE, takeLock } from '../../src/store/lock';
import { refused, T0 } from './contract';

const root = mkdtempSync(join(tmpdir(), 'openmtg-m14-4-lock-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const freshDir = (): string => {
  const dir = join(root, `store-${++dirs}`);
  mkdirSync(dir, { mode: 0o700 });
  return dir;
};
const lockFile = (dir: string): string => join(dir, STORE_LOCK_FILE);
const take = (dir: string, onWarning: (m: string) => void = () => undefined) => takeLock(dir, onWarning);

/** The id of a process that has ended. */
function deadPid(): number {
  return Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
}

describe('M14-4 the store lock', () => {
  it('refuses a second opener, in this process and in another one, until it is released', async () => {
    const dir = freshDir();
    const lock = await take(dir);
    const second = await take(dir).then(
      () => null,
      (e: unknown) => e,
    );
    expect(second).toBeInstanceOf(AccountStoreError);
    expect((second as AccountStoreError).code).toBe('locked');
    expect((second as AccountStoreError).message).toContain('stop the server, or use PostgreSQL');
    // another process (the admin command beside a running server)
    const pkg = fileURLToPath(new URL('../../', import.meta.url));
    const script = join(root, 'take-lock.mjs');
    writeFileSync(
      script,
      [
        `import { takeLock } from ${JSON.stringify(pathToFileURL(join(pkg, 'src', 'store', 'lock.ts')).href)};`,
        'try {',
        '  const l = await takeLock(process.argv[2], () => undefined);',
        '  await l.release();',
        '  console.log(JSON.stringify({ code: "taken" }));',
        '} catch (e) {',
        '  console.log(JSON.stringify({ code: e.code ?? String(e) }));',
        '}',
      ].join('\n'),
    );
    const other = () => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script, dir], { cwd: pkg, encoding: 'utf8' })) as unknown;
    expect(other()).toEqual({ code: 'locked' });
    await lock.release();
    expect(existsSync(lockFile(dir))).toBe(false);
    expect(other()).toEqual({ code: 'taken' });
    await (await take(dir)).release();
  });

  it('a lock whose process is gone, or that does not parse, is taken over with a warning', async () => {
    for (const [body, why] of [[JSON.stringify({ pid: deadPid(), startedAt: T0 }), 'is gone'], ['{"pid":', 'does not parse']] as const) {
      const dir = freshDir();
      writeFileSync(lockFile(dir), body);
      const warnings: string[] = [];
      const lock = await take(dir, (m) => warnings.push(m));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(why);
      expect(JSON.parse(readFileSync(lockFile(dir), 'utf8'))).toMatchObject({ pid: process.pid });
      await refused(take(dir), 'locked');
      await lock.release();
      expect(existsSync(lockFile(dir))).toBe(false);
    }
  });

  it('a lock with this process\'s id that this process does not hold was left by an earlier process: taken over', async () => {
    // a container's PID 1 after a restart, or a reboot: process.kill(pid, 0) succeeds on this process itself (review of M14-4)
    const dir = freshDir();
    writeFileSync(lockFile(dir), JSON.stringify({ pid: process.pid, startedAt: '2026-10-01T00:00:00.000Z' }));
    const warnings: string[] = [];
    const lock = await take(dir, (m) => warnings.push(m));
    expect(warnings).toEqual([expect.stringContaining('an earlier process with this process id')]);
    // while this process holds it, a second opener here is still refused
    await refused(take(dir), 'locked');
    await lock.release();
    expect(existsSync(lockFile(dir))).toBe(false);
    await (await take(dir, (m) => warnings.push(m))).release();
    expect(warnings).toHaveLength(1);
  });

  it('two openers in this process at once: exactly one gets the lock', async () => {
    const dir = freshDir();
    const both = await Promise.allSettled([take(dir), take(dir)]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as AccountStoreError).code).toBe('locked');
    await (both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ release(): Promise<void> }>).value.release();
  });

  it.skipIf(process.platform !== 'linux')('a lock whose process id now names a process that started after it is taken over; a live holder names the lock file', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      const pid = child.pid!;
      const dir = freshDir();
      // the child started just now: a lock it "took" an hour ago belonged to an earlier process with the same id
      writeFileSync(lockFile(dir), JSON.stringify({ pid, startedAt: new Date(Date.now() - 3_600_000).toISOString() }));
      const warnings: string[] = [];
      const lock = await take(dir, (m) => warnings.push(m));
      expect(warnings).toEqual([expect.stringContaining('its id was reused')]);
      await lock.release();
      // a lock taken after the child started is the child's: refused, and the message says which file to delete if no server runs
      writeFileSync(lockFile(dir), JSON.stringify({ pid, startedAt: new Date().toISOString() }));
      const e = await take(dir).then(
        () => null,
        (x: unknown) => x,
      );
      expect((e as AccountStoreError).code).toBe('locked');
      expect((e as AccountStoreError).message).toContain(join(realpathSync(dir), STORE_LOCK_FILE));
    } finally {
      child.kill();
    }
  });

  it.skipIf(process.platform === 'win32')('the lock file is 0600', async () => {
    const dir = freshDir();
    const lock = await take(dir);
    expect(statSync(lockFile(dir)).mode & 0o777).toBe(0o600);
    await lock.release();
  });
});
