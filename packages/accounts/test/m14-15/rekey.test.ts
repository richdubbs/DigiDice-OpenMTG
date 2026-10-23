/**
 * M14-15, security review pass A, finding A7: `rekey` (6.3) keys every names entry again from the name it was made from, so a data update cannot
 * free a banned or reserved name: a forced rename's ban from the name history of the account it keeps (A6), a reservation from the name stored
 * with it. Entries with no name to key again are listed (`unnamed`). In process, two fixed data tables (v1 maps "m" to "rn", v2 does not), the
 * real moderation part, a fake clock and fixed inputs (owner rule).
 */
import { describe, expect, it } from 'vitest';
import { createMemoryAccountStore, createNameData, createNameRules, encodeNameTable, type GeneratedNameData } from '@openmtg/accounts';
import { BIRTH, Clock, code, ctxOf, OP, PW, registerAs, setup, value } from '../m14-6/support';

/** Fixed tables as M14-2's tests make them; `rn` folds "m" into "rn" (v1), and without it "m" stays itself (v2). */
function fixedData(version: number, rn: boolean): GeneratedNameData {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return {
    version, unicodeVersion: `test-${version}`, sources: 'fixed test tables', supplement: encodeNameTable([['i', 'l']]),
    caseFolding: encodeNameTable(Array.from(upper, (c) => [c, c.toLowerCase()] as [string, string])),
    confusables: encodeNameTable([['I', 'l'], ['1', 'l'], ['0', 'O'], ...(rn ? [['m', 'rn'] as [string, string]] : [])]),
  };
}

describe('M14-15 A7: a rekey keeps bans and reservations on their names (6.3, 9.4)', () => {
  it('a ban and a reservation keyed under v1 still cover their names under v2 alone; an entry with no name is listed', async () => {
    const v1 = createNameData(fixedData(1, true));
    const v2 = createNameData(fixedData(2, false));
    const store = createMemoryAccountStore();
    const clock = new Clock();
    const old = setup({ store, clock, names: createNameRules({ reservedNamesText: '', data: v1 }) });
    const mike = await registerAs(old, 'Mike');
    clock.advance(1);
    const renamed = await old.service.admin.forceRename(OP, mike.auth.account, 'name');
    await old.service.admin.reserveName(OP, 'Emma Moderna');
    expect((await store.nameEntry('rnlke', 1))?.kind).toBe('banned');
    // a reservation made before M14-15 kept no name: nothing to key it again from
    await store.putNameEntry({ key: 'rnoderator', keyVersion: 1, kind: 'reserved', account: null, until: null, note: null, createdAt: clock.now().toISOString() });

    // the new server: v2, with v1 as its previous data
    const s = setup({ store, clock, seed: 'm14-15 rekey new', names: createNameRules({ reservedNamesText: '', data: v2, previous: v1 }) });
    const check = await s.service.admin.rekeyCheck(OP);
    expect(check.collisions).toEqual([]);
    expect(check.unnamed).toEqual([{ kind: 'reserved', account: null, entry: { key: 'rnoderator', keyVersion: 1 } }]);
    // the ban, the reservation and Mike's new name change key; the unnamed reservation is keyed again from its old key
    expect(check.changed).toBe(2);
    expect(await s.service.admin.rekey(OP)).toEqual({ changed: 2 });
    expect(s.names.key('Mike', v2)).toBe('mlke');
    expect(await store.nameEntry('mlke', 2)).toMatchObject({ kind: 'banned', account: mike.auth.account });
    expect(await store.nameEntry(s.names.key('Emma Moderna', v2), 2)).toMatchObject({ kind: 'reserved', name: 'Emma Moderna' });

    // a server on v2 alone: the banned and the reserved name are still taken
    const later = setup({ store, clock, seed: 'm14-15 rekey later', names: createNameRules({ reservedNamesText: '', data: v2 }) });
    for (const name of ['Mike', 'MIKE', 'Emma Moderna']) {
      const r = await later.service.register(ctxOf(clock, { addressKey: `192.0.2.${name.length}`, guestSession: null, connection: name }), {
        name, password: PW, birth: BIRTH, claimGuest: false,
      });
      expect(code(r), name).toBe('nameTaken');
    }
    // and the old name still reaches its owner (A6), under the new key
    expect(value(await later.service.signIn(ctxOf(clock, { addressKey: '192.0.2.99', guestSession: null }), { name: 'Mike', password: PW })).account.name).toBe(renamed.name);
    // nothing left to do
    expect(await later.service.admin.rekeyCheck(OP)).toEqual({ from: 2, to: 2, changed: 0, collisions: [], unnamed: [] });
  });
});
