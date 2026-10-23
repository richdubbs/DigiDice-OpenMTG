/**
 * The file store's run lock (package M13-13): the file store is a directory that one process owns (store/file.ts: opening it cuts torn log tails, deletes
 * leftover temporary files and rolls finished games forward, none of which another process may do while the server appends). The server holds
 * `<dir>/hosted.lock` while it runs on a file store; the owner's `inbox` command refuses to open a file store a live server holds ("stop the server, or use
 * PostgreSQL", as the accounts store's command does). PostgreSQL needs no lock: the command runs beside the server.
 *
 * The lock is a file made with the exclusive flag (`wx`: it exists or it is made, atomically) holding `{ pid, startedAt }`. A lock whose process is gone is
 * stale (a crash, a kill): it is taken over, and `takenOver` says so. A lock whose process id has since been given to another live process looks live: the
 * message names the file, so the operator can remove it. Two processes taking over the same stale lock at the same instant could both succeed; for a
 * development store that is accepted, as in the accounts store.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const RUN_LOCK_FILE = 'hosted.lock';

export interface RunLockHolder {
  pid: number;
  startedAt: string;
}

/** The lock is held by a live process. */
export class RunLockedError extends Error {
  constructor(readonly path: string, readonly holder: RunLockHolder) {
    super(`The data directory is in use by process ${holder.pid} (since ${holder.startedAt}; lock ${path}): stop the server, or use PostgreSQL. If that process is not a server, remove the lock file.`);
    this.name = 'RunLockedError';
  }
}

export interface RunLock {
  /** A stale lock (its process gone) was taken over. */
  takenOver: boolean;
  release(): Promise<void>;
}

/** Whether process `pid` is running (a signal of 0 only tests: EPERM means it runs under another user). */
export function processRuns(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function holderOf(path: string): Promise<RunLockHolder | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    const x = JSON.parse(text) as Partial<RunLockHolder>;
    if (typeof x.pid === 'number' && typeof x.startedAt === 'string') return { pid: x.pid, startedAt: x.startedAt };
  } catch {
    // a lock that does not parse (half written: a crash) holds nobody
  }
  return { pid: 0, startedAt: '' };
}

/** The live process that holds the lock of data directory `dir`, or null (no lock, or a stale one). */
export async function liveHolder(dir: string): Promise<RunLockHolder | null> {
  const h = await holderOf(join(dir, RUN_LOCK_FILE));
  return h !== null && processRuns(h.pid) ? h : null;
}

/** The lock files this process holds (a second opener in the same process is refused, whatever the process id says). */
const HELD = new Set<string>();

/** Takes the lock of data directory `dir` (created when missing); throws `RunLockedError` while a live process holds it, this one included. */
export async function takeRunLock(dir: string, pid: number = process.pid): Promise<RunLock> {
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, RUN_LOCK_FILE);
  if (HELD.has(path)) throw new RunLockedError(path, { pid, startedAt: 'this process' });
  const body = JSON.stringify({ pid, startedAt: new Date().toISOString() } satisfies RunLockHolder);
  let takenOver = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await writeFile(path, body, { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const holder = await holderOf(path);
    if (holder !== null && holder.pid !== pid && processRuns(holder.pid)) throw new RunLockedError(path, holder);
    // (a lock of this process id that this process does not hold is an earlier run's: stale)
    if (attempt >= 2) throw new Error(`The lock ${path} could not be taken.`);
    // stale (or ours from an earlier run in this process id): taken over
    takenOver = true;
    await rm(path, { force: true });
  }
  HELD.add(path);
  let released = false;
  return {
    takenOver,
    release: async () => {
      if (released) return;
      released = true;
      HELD.delete(path);
      // only our own lock: one taken over since is the new holder's
      const holder = await holderOf(path).catch(() => null);
      if (holder !== null && holder.pid === pid) await rm(path, { force: true });
    },
  };
}
