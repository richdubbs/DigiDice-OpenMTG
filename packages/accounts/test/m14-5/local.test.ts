/**
 * M14-5: the local provider (design 3.2, 4.1): enroll makes a `local` credential whose subject is the account; verify against a credential, or the
 * dummy's work without one; a right password under older parameters (or another pepper) gives a rehash, which the sign-in writes by compare-and-set
 * on the string it verified, so a sign-in that began before a password change never writes the old password back.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryAccountStore, type AccountStore, type CredentialRow } from '@openmtg/accounts';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { buildLocalProvider } from '../../src/identity/local';
import { createCredentialTools } from '../../src/crypto/index';
import { ctxOf, equal, fastDerive, fixedRandom, PW, PW2, registerAs, setup, spyHasher, value } from './support';

const hasherWith = (ln: number, peppers: { id: string; secret: string }[] = []) =>
  buildPasswordHasher(
    { scrypt: ln === 16 ? { ln: 16, r: 8, p: 2 } : { ln: 17, r: 8, p: 1 }, concurrency: 2, queue: 8, peppers, random: fixedRandom(`h${ln}`), equal },
    { derive: fastDerive, sleep: async () => undefined },
  );
const tools = createCredentialTools({ random: fixedRandom('t'), equal, peppers: [], passwordMin: 12 });
const ACC = 'acc_00000000000000000000000001';

describe('M14-5: the local provider', () => {
  it('enroll and verify; no credential does the dummy\'s work; a right password under old parameters gives a rehash', async () => {
    const spy = spyHasher(hasherWith(17));
    const local = buildLocalProvider({ hasher: spy, credentials: tools });
    const cred = await local.enroll(ACC, PW, '2026-10-22T00:00:00.000Z', { priority: 'normal' });
    expect(cred).toMatchObject({ account: ACC, provider: 'local', subject: ACC, meta: {}, lastUsedAt: null });
    expect(cred.secret).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$/);
    expect(await local.verify(cred, PW, { priority: 'high' })).toEqual({ ok: true, rehash: null });
    expect(await local.verify(cred, PW2, { priority: 'low' })).toEqual({ ok: false, rehash: null });
    spy.reset();
    expect(await local.verify(null, PW, { priority: 'normal' })).toEqual({ ok: false, rehash: null });
    expect(spy.calls).toEqual([{ op: 'dummy', priority: 'normal' }]);
    const shopify: CredentialRow = { ...cred, provider: 'shopify', secret: null };
    expect((await local.verify(shopify, PW, { priority: 'normal' })).ok).toBe(false);
    const old = await buildLocalProvider({ hasher: hasherWith(16), credentials: tools }).enroll(ACC, PW, cred.createdAt, { priority: 'normal' });
    const r = await local.verify(old, PW, { priority: 'normal' });
    expect(r.ok).toBe(true);
    expect(r.rehash!.secret).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$/);
    expect({ ...r.rehash!, secret: '' }).toEqual({ ...old, secret: '' });
    // a wrong password under old parameters gives no rehash
    expect(await local.verify(old, PW2, { priority: 'normal' })).toEqual({ ok: false, rehash: null });
  });

  it('a sign-in rehashes an old string by compare-and-set; one racing a password change writes nothing back', async () => {
    const store = createMemoryAccountStore();
    const s = setup({ store, hasher: hasherWith(16) });
    const reg = await registerAs(s, 'Alice');
    expect((await store.credentials(reg.auth.account))[0]!.secret).toMatch(/ln=16/);
    // the server now hashes with the new parameters
    const t = setup({ store, clock: s.clock });
    value(await t.service.signIn(ctxOf(t.clock, { addressKey: '192.0.2.5' }), { name: 'Alice', password: PW }));
    const rehashed = (await store.credentials(reg.auth.account))[0]!;
    expect(rehashed.secret).toMatch(/ln=17/);
    expect(rehashed.lastUsedAt).toBe(t.clock.now().toISOString());
    // back to an old string, then a password change lands between the verify and the rehash's write
    await store.putCredential({ ...rehashed, secret: await hasherWith(16).hash(PW, { priority: 'normal' }) });
    racingCredential(store, async () => {
      await store.putCredential({ ...rehashed, secret: await hasherWith(17).hash(PW2, { priority: 'normal' }) });
    });
    const v = setup({ store, clock: s.clock });
    value(await v.service.signIn(ctxOf(v.clock, { addressKey: '192.0.2.6' }), { name: 'Alice', password: PW }));
    // the change won: the old password was not written back
    const after = (await store.credentials(reg.auth.account))[0]!;
    expect(value(await v.service.signIn(ctxOf(v.clock, { addressKey: '192.0.2.7' }), { name: 'Alice', password: PW2 })).auth.account).toBe(reg.auth.account);
    expect(after.secret).toMatch(/ln=17/);
  });
});

/** A store whose next compare-and-set putCredential first runs `meanwhile` (a password change elsewhere). */
function racingCredential(store: AccountStore, meanwhile: () => Promise<void>): AccountStore {
  let armed = true;
  const put = store.putCredential.bind(store);
  store.putCredential = async (c, expect) => {
    if (armed && expect !== undefined) {
      armed = false;
      await meanwhile();
    }
    return put(c, expect);
  };
  return store;
}
