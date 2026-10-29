/**
 * M14-7: the operator's export files (design 9.6, 10.1, 10.3): `ACCOUNTS_DATA_DIR/exports/<account>-<time>.json`, the directory 0700 and each file
 * 0600 (it holds personal data), written beside as `<name>.tmp` and renamed into place, so a reader never sees half a file. The time is the export's
 * `exportedAt` with ':' and '.' as '-' (a file name every system takes), so the file's age is read from its name, by the service's clock, never
 * from the file system's. A file is deleted once it is older than its retention (a day: tick looks every minute), and every file of an account at
 * its erasure, with every other account's file that names it. A name that is not an export's is left alone.
 */
import { chmod, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountExport, AccountId } from '../api';

/** The folder under ACCOUNTS_DATA_DIR (beside the file store's db/ and lock, and FileMailer's mail/). */
export const ADMIN_EXPORTS_DIR = 'exports';

const FILE_NAME = /^(acc_[0-7][0-9A-HJKMNP-TV-Z]{25})-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json(?:\.tmp)?$/;

/** '2026-10-22T12:00:00.000Z' -> '2026-10-22T12-00-00-000Z'. */
const stamp = (exportedAt: string): string => new Date(Date.parse(exportedAt)).toISOString().replace(/[:.]/g, '-');

/** Where the operator's export of `account` made at `exportedAt` is written: `<dataDir>/exports/<account>-<time>.json`. */
export function adminExportPath(dataDir: string, account: AccountId, exportedAt: string): string {
  return join(dataDir, ADMIN_EXPORTS_DIR, `${account}-${stamp(exportedAt)}.json`);
}

/** The account and the time of an export file's name, or null for any other name. */
export function adminExportFile(name: string): { account: AccountId; at: number } | null {
  const m = FILE_NAME.exec(name);
  if (m === null) return null;
  const at = Date.parse(`${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z`);
  return Number.isFinite(at) ? { account: m[1] as AccountId, at } : null;
}

const missing = (e: unknown): boolean => (e as { code?: unknown })?.code === 'ENOENT';

/** Writes `text` to `path` through `<path>.tmp` (mode 0600, fsync, rename), so the file is never seen half written. */
async function writeWhole(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await unlink(tmp).catch((e: unknown) => {
    if (!missing(e)) throw e;
  });
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    // the umask may only narrow the mode; set it exactly
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/** Writes the operator's export (mode 0600, its folder 0700) and returns its path. A second export in the same millisecond replaces the first. */
export async function writeAdminExport(dataDir: string, exp: AccountExport): Promise<string> {
  const dir = join(dataDir, ADMIN_EXPORTS_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = adminExportPath(dataDir, exp.account.self.id, exp.exportedAt);
  await writeWhole(path, `${JSON.stringify(exp, null, 2)}\n`);
  return path;
}

async function exportNames(dataDir: string): Promise<string[]> {
  try {
    return await readdir(join(dataDir, ADMIN_EXPORTS_DIR));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

async function remove(dataDir: string, name: string): Promise<boolean> {
  try {
    await unlink(join(dataDir, ADMIN_EXPORTS_DIR, name));
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}

/** Deletes the export files older than `maxAgeMs` at `now` (by the time in their names); answers how many. */
export async function sweepAdminExports(dataDir: string, now: Date, maxAgeMs: number): Promise<number> {
  let removed = 0;
  for (const name of await exportNames(dataDir)) {
    const f = adminExportFile(name);
    if (f !== null && f.at + maxAgeMs <= now.getTime() && (await remove(dataDir, name))) removed++;
  }
  return removed;
}

/** Every string value in a JSON value (never its keys), lower-cased, into `out`. */
function stringValues(v: unknown, out: Set<string>): Set<string> {
  if (typeof v === 'string') out.add(v.toLowerCase());
  else if (Array.isArray(v)) for (const x of v) stringValues(x, out);
  else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) stringValues(x, out);
  return out;
}

/**
 * Deletes every other account's export file that names the erased account: one of `words` (its names and email address) as a whole JSON string
 * value in it, ignoring case (review of M14-7: never as a part of a longer string, so a short name such as "Ion" drops no file that only says
 * "session"; a file that does not parse, such as a `.tmp` cut short, is searched as text). Another player's export names the erased one where it
 * lists a block, a report's target or a game, and rewriting a name inside another player's data would damage it; an export made again after the
 * erasure shows "Deleted player" there by itself. Answers how many files were deleted.
 */
export async function dropAdminExportsNaming(dataDir: string, account: AccountId, words: readonly string[]): Promise<number> {
  const list = [...new Set(words.filter((w) => w.length > 0).map((w) => w.toLowerCase()))];
  if (list.length === 0) return 0;
  let dropped = 0;
  for (const name of await exportNames(dataDir)) {
    const f = adminExportFile(name);
    if (f === null || f.account === account) continue;
    let text: string;
    try {
      text = await readFile(join(dataDir, ADMIN_EXPORTS_DIR, name), 'utf8');
    } catch (e) {
      if (missing(e)) continue;
      throw e;
    }
    let names: (w: string) => boolean;
    try {
      const values = stringValues(JSON.parse(text) as unknown, new Set());
      names = (w) => values.has(w);
    } catch {
      const lower = text.toLowerCase();
      names = (w) => lower.includes(w);
    }
    if (list.some(names) && (await remove(dataDir, name))) dropped++;
  }
  return dropped;
}

/** Deletes the export file `exp` was written to (one whose account was erased while it was made); answers whether it was there. */
export async function removeAdminExport(dataDir: string, exp: AccountExport): Promise<boolean> {
  return remove(dataDir, `${exp.account.self.id}-${stamp(exp.exportedAt)}.json`);
}

/** Deletes every export file of `account` (its erasure, 10.2); answers how many. */
export async function removeAdminExports(dataDir: string, account: AccountId): Promise<number> {
  let removed = 0;
  for (const name of await exportNames(dataDir)) {
    if (adminExportFile(name)?.account === account && (await remove(dataDir, name))) removed++;
  }
  return removed;
}
