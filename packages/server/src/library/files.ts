/**
 * Files of the player's library (decks.ts, settings.ts): JSON written whole to a temporary file and renamed over the old one, so a crash or a full
 * disk leaves the previous version, never half a file; and one queue per file, so two requests never read-check-write the same file at once.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const queues = new Map<string, Promise<void>>();

/** Run `fn` once every earlier call for the same key has finished (an earlier failure does not stop it). */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Windows refuses a rename for a moment while another program (a virus scanner, an indexer) has the target open: tried again a few times. */
async function renameOver(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
      await sleep(20 * (attempt + 1));
    }
  }
}

let tmpCounter = 0;

/** Write `content` (text, or bytes) to `file` atomically: a temporary file in the same folder, then a rename over the old file. */
export async function writeAtomic(file: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${(tmpCounter++).toString(36)}.tmp`;
  try {
    await (typeof content === 'string' ? writeFile(tmp, content, 'utf8') : writeFile(tmp, content));
    await renameOver(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** The parsed JSON of `file`; undefined when it does not exist or does not hold JSON. */
export async function readJsonFile(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
