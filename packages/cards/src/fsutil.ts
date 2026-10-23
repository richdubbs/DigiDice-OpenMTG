/** Small file helpers: atomic writes (temp file + rename) and tolerant JSON reads. */
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Errors of a rename over a file another handle has open (Windows: until that handle closes, usually milliseconds). */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 320, 640, 1000];

/**
 * rename(from, to), waiting out a reader of `to`: on Windows a file that another handle has open cannot be replaced, the rename fails with EPERM
 * (EACCES, EBUSY) until the read closes. The local server reads cache files (GET /api/status: bulk-meta.json) while the Update button's refresh
 * replaces them. Retries after each of `delays` (about 2 s in all), then throws the last error; other errors throw at once.
 */
export async function renameRetrying(
  from: string,
  to: string,
  opts: { rename?: (from: string, to: string) => Promise<void>; delays?: readonly number[] } = {},
): Promise<void> {
  const move = opts.rename ?? rename;
  const delays = opts.delays ?? RENAME_DELAYS_MS;
  for (let i = 0; ; i++) {
    try {
      await move(from, to);
      return;
    } catch (e) {
      if (i >= delays.length || !BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await new Promise((resolve) => setTimeout(resolve, delays[i]));
    }
  }
}

export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await renameRetrying(tmp, file);
}

export async function readJsonIfExists<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (e instanceof SyntaxError) return undefined; // corrupt cache file: treat as missing
    throw e;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}
