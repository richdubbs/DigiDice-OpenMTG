/**
 * M14-4: the contract suite (test/m14-4/contract.ts) on the memory store, whose erase test searches a full dump of every table (design 13.2).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryAccountStore, MemoryAccountStore, type AccountStore } from '@openmtg/accounts';
import { accountStoreContract, newAccount, placesInTables, T0 } from './contract';

function dumpOf(store: AccountStore): Record<string, [string, unknown][]> {
  if (!(store instanceof MemoryAccountStore)) throw new Error('not a memory store');
  return store.dump();
}

accountStoreContract({
  name: 'memory',
  open: async (limits) => createMemoryAccountStore(limits),
  places: async (store, needle) => placesInTables(dumpOf(store), needle),
});

describe('M14-4 memory store', () => {
  it('createMemoryAccountStore makes a new, empty store each time', async () => {
    const a = createMemoryAccountStore();
    const b = createMemoryAccountStore();
    await a.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    expect(await b.account((await a.accountByKey('allce', 1))!.id)).toBeNull();
    expect(Object.values(dumpOf(b)).every((rows) => rows.length === 0)).toBe(true);
    await a.close();
    await b.close();
  });

  it('refuses a live-code cap that is not a whole number from 0 (RangeError)', () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => createMemoryAccountStore({ emailResetLiveCodes: bad }), String(bad)).toThrow(RangeError);
    expect(() => createMemoryAccountStore({})).not.toThrow();
  });

  it('a dump is a copy: changing it changes nothing stored', async () => {
    const store = createMemoryAccountStore();
    await store.createAccount(newAccount(1, 'Alice', 'allce'), T0);
    const dump = dumpOf(store);
    (dump['accounts']![0]![1] as { name: string }).name = 'Mallory';
    expect((await store.accountByKey('allce', 1))?.name).toBe('Alice');
    await store.close();
  });
});
