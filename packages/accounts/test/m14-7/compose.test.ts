/**
 * M14-7: the rights part wired in by the composition (design 13.3): src/rights/index.ts exports the factory, and composeAccounts passes it to the
 * service, so exportData, deleteAccount, cancelDeletion, the operator's rights commands and tick's erasure work without any fake part. Only the
 * mailer (M14-8's NoMailer, not built on this branch) and the hasher's key derivation (fast, instead of scrypt's 128 MiB) are stand-ins.
 */
import { describe, expect, it } from 'vitest';
import {
  composeAccounts, createRightsPart, loadAccountsConfig, type GuestSessions, type Mailer,
} from '@openmtg/accounts';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { BIRTH, DAY, fastDerive, PW, value } from './support';

describe('M14-7: the composition', () => {
  it('passes the real rights part: register, export, delete, and the next tick at purgeAt erases', async () => {
    expect(typeof createRightsPart).toBe('function');
    const r = loadAccountsConfig({ ACCOUNTS: 'on', CAPTCHA: 'none' });
    if (!r.ok) throw new Error(r.problems.join('\n'));
    const guests: GuestSessions = { proof: async () => null, busy: async () => false, retire: async () => undefined };
    const noMailer: Mailer = { kind: 'none', send: async () => undefined };
    const { service } = await composeAccounts(r.config, {
      guests, log: { event: () => undefined },
      factories: {
        createNoMailer: () => noMailer,
        createPasswordHasher: (opts) => buildPasswordHasher(opts, { derive: fastDerive, sleep: async () => undefined }),
      },
    });
    const now = new Date('2026-10-22T12:00:00.000Z');
    const ctx = { now, connection: 'c1', addressKey: '198.51.100.7', guestSession: null, guestBusy: false, client: 'web' as const };
    const reg = value(await service.register(ctx, { name: 'Alice', password: PW, birth: BIRTH, claimGuest: false }));
    expect(value(await service.exportData(ctx, reg.auth, { password: PW })).account.self.id).toBe(reg.auth.account);
    const del = value(await service.deleteAccount(ctx, reg.auth, { password: PW }));
    expect(del.purgeAt).toBe(new Date(now.getTime() + 7 * DAY).toISOString());
    expect((await service.tick(new Date(del.purgeAt))).erased).toBe(1);
    await expect(service.admin.exportAccount({ name: 'op', osUser: 'op' }, reg.auth.account, false)).rejects.toMatchObject({ code: 'notFound' });
    await service.close();
  });
});
