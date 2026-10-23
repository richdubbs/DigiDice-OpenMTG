/**
 * M15-3: the LadderStore contract suite (src/store/contract.ts) on the memory store (a search of a full dump of every table) and on the file store
 * (a byte search of every file in its directory), design 13.3 and 17.10. The file store's own cases are in file.test.ts.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openFileLadderStore, type FileLadderStore } from '../../src/store/file';
import { createMemoryLadderStore, type MemoryLadderStore } from '../../src/store/memory';
import { ladderStoreContract, type LadderStoreHarness } from '../../src/store/contract';
import type { LadderStore } from '../../src/store/api';
import { fixedRandom } from '../support/random';
import { placesInDir, placesInDump } from './support';

const memory: LadderStoreHarness = {
  name: 'memory',
  open: async () => createMemoryLadderStore({ random: fixedRandom('memory') }),
  places: async (store, needle) => placesInDump((store as MemoryLadderStore).dump(), needle),
};

const root = mkdtempSync(join(tmpdir(), 'openmtg-m15-3-store-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const dirOf = new WeakMap<LadderStore, string>();

const file: LadderStoreHarness = {
  name: 'file',
  async open() {
    const dir = join(root, `s${++dirs}`);
    const store = await openFileLadderStore({ dir, random: fixedRandom(dir), onWarning: () => undefined });
    dirOf.set(store, dir);
    return store;
  },
  places: async (store, needle) => placesInDir(dirOf.get(store)!, needle),
  async reopen(store) {
    const dir = dirOf.get(store)!;
    await store.close();
    const again: FileLadderStore = await openFileLadderStore({ dir, random: fixedRandom(`${dir}:again`), onWarning: () => undefined });
    dirOf.set(again, dir);
    return again;
  },
};

for (const h of [memory, file]) {
  describe(`M15-3: the store contract on the ${h.name} store`, () => {
    for (const c of ladderStoreContract(h)) it(c.name, c.run);
  });
}

describe('M15-3: the memory store', () => {
  it('createMemoryLadderStore makes a new, empty store each time, and its dump is a copy', async () => {
    const a = createMemoryLadderStore();
    const b = createMemoryLadderStore();
    await a.setIntakeCursor({ endedAt: '2026-10-15T12:00:00.000Z', game: 'g' });
    expect(await b.intakeCursor()).toBeNull();
    const dump = a.dump();
    (dump.meta[0]![1] as { game: string }).game = 'changed';
    expect((await a.intakeCursor())?.game).toBe('g');
    expect(Object.values(b.dump()).every((rows) => rows.length === 0)).toBe(true);
  });

  it('refuses every call once closed', async () => {
    const s = createMemoryLadderStore();
    await s.close();
    await expect(s.intakeCursor()).rejects.toThrow(/closed/);
  });
});
