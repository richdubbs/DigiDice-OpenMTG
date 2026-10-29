/**
 * The development store's lock (M14-4's, kept when the file store became PGlite: F26): `<dir>/lock`, { pid, startedAt, lockedAt }, made atomically
 * (written beside, then hard-linked into place, never half written). PGlite has no lock of its own, and two processes on one database directory
 * corrupt it, so the lock keeps a second process out ('locked': "stop the server, or use PostgreSQL", 9.6), the admin command beside a running server
 * included, and a second opener in the same process. A lock whose process is gone is taken over with a warning, and so is one whose process id now
 * names a later process (this one: a container's PID 1 after a restart; or, on Linux, one that started after the lock was taken). Two processes
 * taking over the same stale lock at the same moment could both succeed; for a development store, after a crash, that race is accepted.
 */
import { link, open, readFile, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { storeError } from './rules';

/** The lock's file name in the store's directory. */
export const STORE_LOCK_FILE = 'lock';

const isWindows = process.platform === 'win32';

async function fsyncDir(dir: string): Promise<void> {
  // Windows cannot open a directory for fsync (its renames are durable through NTFS's journal); elsewhere a failure is real.
  if (isWindows) return;
  const fh = await open(dir, 'r');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** `startedAt`: when the holding process started (m15 13.3 keeps "the process id and start time"), so a later process that got its id is told apart. */
interface LockInfo { pid: number; startedAt: string }

/**
 * The lock files this process holds or is taking (by the store directory's real path). A second opener in this process is refused by this set, not
 * by the process id, so a lock that carries this process's id but is not in the set was left by an earlier process that had the same id: a
 * container's PID 1 after a restart, or any process after a reboot (review of M14-4).
 */
const HELD = new Set<string>();

/** How much later than its recorded start a process read from the system may have started and still be the holder (whole-second boot time, clock steps). */
const START_SLACK_MS = 60_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * When process `pid` started, by the wall clock, where the system tells (Linux: its start in clock ticks after boot from /proc/<pid>/stat, at
 * USER_HZ 100, plus /proc/stat's boot time); null elsewhere or when it cannot be read.
 */
async function processStartMs(pid: number): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // the fields after the command name (which may hold spaces and parentheses) start at field 3; starttime is field 22
    const ticks = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]);
    const btime = (await readFile('/proc/stat', 'utf8')).split('\n').find((l) => l.startsWith('btime '));
    const boot = Number(btime?.slice('btime '.length));
    return btime !== undefined && Number.isFinite(ticks) && Number.isFinite(boot) ? boot * 1000 + ticks * 10 : null;
  } catch {
    return null;
  }
}

function parseLock(buf: Buffer | null): LockInfo | null {
  if (buf === null) return null;
  try {
    const j = JSON.parse(buf.toString('utf8')) as Partial<LockInfo>;
    return typeof j.pid === 'number' && Number.isSafeInteger(j.pid) && j.pid > 0 && typeof j.startedAt === 'string' ? { pid: j.pid, startedAt: j.startedAt } : null;
  } catch {
    return null;
  }
}

/** Why the lock `holder` is stale, or null while its process may still hold it. Asked only for a lock this process does not hold (HELD). */
async function staleReason(holder: LockInfo | null): Promise<string | null> {
  if (holder === null) return 'it does not parse';
  if (holder.pid === process.pid) return `it was left by an earlier process with this process id (${holder.pid})`;
  if (!processAlive(holder.pid)) return `process ${holder.pid} is gone`;
  const recorded = Date.parse(holder.startedAt);
  const started = await processStartMs(holder.pid);
  if (started !== null && Number.isFinite(recorded) && started > recorded + START_SLACK_MS) {
    return `process ${holder.pid} started after the lock was taken (its id was reused)`;
  }
  return null;
}

export interface StoreLock { release(): Promise<void> }

/**
 * Takes `<dir>/lock`: 'locked' while this process holds it (HELD) or a live process does; a lock whose process is gone, whose process id now names
 * a later process (this one, or one that started after the lock was taken), or that does not parse, is taken over with a warning. The lock file is
 * written in full beside it and hard-linked into place, so another opener never reads half of one.
 */
export async function takeLock(dir: string, warn: (message: string) => void): Promise<StoreLock> {
  const real = await realpath(dir);
  const path = join(real, STORE_LOCK_FILE);
  const inUse = 'stop the server, or use PostgreSQL';
  // checked and reserved in one step, so two openers in this process at once never both pass
  if (HELD.has(real)) throw storeError('locked', `the accounts store in ${dir} is in use by this process: ${inUse}`);
  HELD.add(real);
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const body = JSON.stringify({ pid: process.pid, startedAt, lockedAt: new Date().toISOString() });
  try {
    const tmp = join(real, `lock.${process.pid}.${Date.now()}.tmp`);
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(body);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await link(tmp, path);
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const holder = parseLock(await readIfExists(path));
          const why = await staleReason(holder);
          if (why === null) {
            throw storeError(
              'locked',
              `the accounts store in ${dir} is in use (process ${holder!.pid}, started ${holder!.startedAt}): ${inUse}; if no server runs there, delete ${path}`,
            );
          }
          if (attempt >= 2) throw storeError('locked', `the accounts store lock ${path} could not be taken`);
          warn(`taking over the accounts store lock in ${dir}: ${why}`);
          await unlinkIfExists(path);
        }
      }
    } finally {
      await unlinkIfExists(tmp);
    }
    await fsyncDir(real);
  } catch (e) {
    HELD.delete(real);
    throw e;
  }
  return {
    async release() {
      try {
        // only our own lock: one taken over since (this process was presumed gone) is the new holder's
        const now = await readIfExists(path);
        if (now !== null && now.toString('utf8') === body) await unlinkIfExists(path);
      } finally {
        HELD.delete(real);
      }
    },
  };
}

