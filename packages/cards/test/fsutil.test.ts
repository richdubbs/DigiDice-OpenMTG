/**
 * UPD1 review: replacing a cache file while another request reads it. On Windows a rename over a file that another handle has open fails with EPERM
 * (or EACCES, EBUSY) until that read closes; the local server's GET /api/status reads bulk-meta.json while the Update button's refresh replaces it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renameRetrying } from '../src/fsutil';
import { tempDir } from './helpers';

const busy = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

describe('renameRetrying', () => {
  it('waits out a reader holding the target open (EPERM, EACCES, EBUSY), then replaces the file', async () => {
    const dir = await tempDir();
    const from = path.join(dir, 'meta.json.tmp');
    const to = path.join(dir, 'meta.json');
    await writeFile(from, 'new');
    await writeFile(to, 'old');
    const failures = ['EPERM', 'EACCES', 'EBUSY'];
    const attempts: string[] = [];
    const { rename } = await import('node:fs/promises');
    await renameRetrying(from, to, {
      delays: [0, 0, 0, 0],
      rename: async (a, b) => {
        attempts.push('try');
        const code = failures.shift();
        if (code) throw busy(code);
        await rename(a, b);
      },
    });
    expect(attempts).toHaveLength(4);
    expect(await readFile(to, 'utf8')).toBe('new');
  });

  it('gives up after its delays, and never retries other errors', async () => {
    let tries = 0;
    await expect(renameRetrying('a', 'b', { delays: [0, 0], rename: async () => { tries++; throw busy('EPERM'); } })).rejects.toThrow(/EPERM/);
    expect(tries).toBe(3);
    tries = 0;
    await expect(renameRetrying('a', 'b', { delays: [0, 0], rename: async () => { tries++; throw busy('ENOENT'); } })).rejects.toThrow(/ENOENT/);
    expect(tries).toBe(1);
  });
});
