/**
 * M14-8: the email part's seams and wiring (design 3.4, 3.8, 11.3, 13.3): the factories are built and composeAccounts wires FileMailer and the part
 * from MAILER=file; restricted sessions keep setEmail and verifyEmail while suspended or banned, and get deletionPending while deleting; another
 * part's notice through PartDeps.notify keeps the verified-address rule; the part on PartDeps without the members M14-8 added (fakes of other
 * packages may lack them): no sign-in steps answers notYet for the resets, no comparison checks codes with node:crypto's, no mailer reads MAILER
 * from the configuration; a registration whose email part fails once the account exists still answers (review of M14-8); every answer's code is in
 * its ACCOUNT_METHOD_ERRORS row.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeAccounts, createMemoryAccountStore, type AccountId, type ModerationPart, type PartDeps, type SanctionKind } from '@openmtg/accounts';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { createEmailPart, createFileMailer, createMailQueue, createNoMailer } from '../../src/email/index';
import { buildEmailPart } from '../../src/email/part';
import {
  BIRTH, code, codeOf, configOf, ctxFor, DAY, FakeGuests, fastDerive, fixedRandom, inRow, PW, recordingSetup, registerAs, registerVerified, registerWith,
  setup, spyStore, value, type MailSetup,
} from './support';

const ALICE = 'alice.liddell@example.org';

async function sanction(s: MailSetup, account: AccountId, kind: SanctionKind): Promise<void> {
  const now = s.clock.now().toISOString();
  await s.store.putSanction({
    id: `san_01J0000000000000000000${kind === 'ban' ? '0001' : '0002'}`, account, kind, reason: 'other', message: 'Please read the rules.', note: null,
    since: now, until: new Date(s.clock.t + 30 * DAY).toISOString(), endedAt: null, endReason: null, endedBy: null, createdAt: now,
    createdBy: 'admin:op', reports: [], seenAt: null,
  });
}

describe('M14-8: the factories and the composition', () => {
  it('every factory is built; composeAccounts with MAILER=file mails a registration\'s code into <data dir>/mail/<account>/', async () => {
    for (const f of [createEmailPart, createNoMailer, createFileMailer, createMailQueue]) expect(typeof f).toBe('function');
    const dir = await mkdtemp(join(tmpdir(), 'openmtg-m14-8-compose-'));
    try {
      const config = configOf({ ACCOUNTS_DATA_DIR: dir, ACCOUNTS_STORE: 'memory', MAILER: 'file' });
      const { service } = await composeAccounts(config, {
        guests: new FakeGuests(), log: { event: () => undefined }, random: fixedRandom('compose m14-8'),
        factories: { createPasswordHasher: (o) => buildPasswordHasher(o, { derive: fastDerive, sleep: async () => undefined }) },
      });
      const ctx = { now: new Date(), connection: 'c', addressKey: '192.0.2.1', guestSession: null, guestBusy: false, client: 'desktop' as const };
      const r = value(inRow('register', await service.register(ctx, { name: 'Composed', password: PW, birth: BIRTH, claimGuest: false, email: ALICE })));
      expect(r.account.email).toEqual({ address: ALICE, verified: false });
      let files: string[] = [];
      for (let i = 0; i < 200 && files.length === 0; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        files = await readdir(join(dir, 'mail', r.auth.account)).catch(() => []);
      }
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d+-verify-[0-9a-f]{16}\.txt$/);
      // and requestEmailReset is no longer notYet
      value(inRow('requestEmailReset', await service.requestEmailReset(ctx, 'Composed')));
      await service.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('M14-8: restricted sessions keep the email calls of RESTRICTED_CALLS (3.8)', () => {
  it('suspended and banned: setEmail and verifyEmail work; deleting: deletionPending; a reset signs in to a restricted session', async () => {
    const s = recordingSetup();
    for (const kind of ['suspend', 'ban'] as const) {
      const name = kind === 'ban' ? 'Bea' : 'Sam';
      const reg = await registerWith(s, name);
      await sanction(s, reg.auth.account, kind);
      const ctx = ctxFor(s, name);
      const address = `${name.toLowerCase()}@example.org`;
      value(inRow('setEmail', await s.service.setEmail(ctx, reg.auth, address, { password: PW })));
      await s.idle();
      const v = value(inRow('verifyEmail', await s.service.verifyEmail(ctx, reg.auth, codeOf(s.mailer.to(address)[0]))));
      expect(v).toMatchObject({ status: kind === 'ban' ? 'banned' : 'suspended', restricted: true, email: { address, verified: true } });
    }
    const del = await registerVerified(s, 'Leaving', 'leaving@example.org');
    const a = (await s.store.account(del.auth.account))!;
    await s.store.updateAccount(a.id, a.version, {
      deletion: { requestedAt: s.clock.now().toISOString(), purgeAt: new Date(s.clock.t + 7 * DAY).toISOString(), erasingAt: null, done: [] },
    });
    const ctx = ctxFor(s, 'leaving');
    expect(code(inRow('setEmail', await s.service.setEmail(ctx, del.auth, null, { password: PW })))).toBe('deletionPending');
    expect(code(inRow('verifyEmail', await s.service.verifyEmail(ctx, del.auth, 'ABCDE-FGHJK')))).toBe('deletionPending');
    // the right code always signs in (D24): to a restricted session
    value(await s.service.requestEmailReset(ctx, 'Leaving'));
    await s.idle();
    const r = value(inRow('useEmailReset', await s.service.useEmailReset(ctx, {
      name: 'Leaving', code: codeOf(s.mailer.to('leaving@example.org').filter((m) => m.meta.kind === 'reset')[0]), newPassword: 'a brand new passphrase',
    })));
    expect(r.account).toMatchObject({ status: 'deleting', restricted: true });
  });
});

describe('M14-8: PartDeps.notify, the email part\'s notices for every part (11.3)', () => {
  it('another part\'s notice goes through the email part: only to a verified address; without the email part it does nothing', async () => {
    const s = recordingSetup();
    const verified = await registerVerified(s, 'Alice', ALICE);
    const unverified = await registerWith(s, 'Bruno', 'bruno@example.org');
    await s.partDeps.notify!(verified.auth.account, 'deletionRequested');
    await s.partDeps.notify!(unverified.auth.account, 'deletionRequested');
    await s.idle();
    expect(s.mailer.sent.filter((m) => m.meta.kind === 'notice').map((m) => [m.to, m.subject])).toEqual([
      [ALICE, 'Your OpenMTG account is going to be deleted'],
    ]);
    // a service without the email part (M14-5's setup with only a fake part, to see its PartDeps)
    const seen: { deps: PartDeps | null } = { deps: null };
    const t = setup({ parts: { moderation: (d) => ((seen.deps = d), {} as ModerationPart) } });
    const reg = await registerAs(t, 'Carol');
    await expect(seen.deps!.notify!(reg.auth.account, 'deletionRequested')).resolves.toBeUndefined();
  });
});

describe('M14-8: the part on PartDeps without M14-8\'s members (11.3)', () => {
  it('no sign-in steps: the resets answer notYet; no comparison: node:crypto\'s; no mailer: MAILER decides (none hides email)', async () => {
    const s = recordingSetup();
    const reg = await registerWith(s, 'Alice');
    const ctx = ctxFor(s, 'alice');
    const noSignIn = buildEmailPart({ ...s.partDeps, signIn: undefined });
    expect(code(inRow('requestEmailReset', await noSignIn.requestEmailReset(ctx, 'Alice')))).toBe('notYet');
    expect(code(inRow('useEmailReset', await noSignIn.useEmailReset(ctx, { name: 'Alice', code: 'ABCDE-FGHJK', newPassword: 'a brand new passphrase' })))).toBe('notYet');
    // setEmail needs neither
    value(inRow('setEmail', await noSignIn.setEmail(ctx, reg.auth, ALICE, { password: PW })));
    // no comparison: node:crypto's own checks the code
    await s.idle();
    const noEqual = buildEmailPart({ ...s.partDeps, equal: undefined });
    expect(value(inRow('verifyEmail', await noEqual.verifyEmail(ctx, reg.auth, codeOf(s.mailer.to(ALICE)[0])))).email).toEqual({ address: ALICE, verified: true });
    // no mailer, MAILER=none (this setup's configuration): email is hidden
    expect(s.config.mailer).toBe('none');
    const noMailer = buildEmailPart({ ...s.partDeps, mailer: undefined });
    expect(code(inRow('setEmail', await noMailer.setEmail(ctx, reg.auth, 'other@example.org', { password: PW })))).toBe('emailUnavailable');
    expect(code(inRow('requestEmailReset', await noMailer.requestEmailReset(ctx, 'Alice')))).toBe('emailUnavailable');
    expect(await noMailer.tick(s.clock.now())).toEqual({ mailFilesRemoved: 0 });
    // with MAILER=file in the configuration it works
    const fileConfig = buildEmailPart({ ...s.partDeps, mailer: undefined, config: configOf({ MAILER: 'file', ACCOUNTS_DATA_DIR: '/nonexistent' }) });
    value(inRow('setEmail', await fileConfig.setEmail(ctx, reg.auth, 'other@example.org', { password: PW })));
  });
});

describe('M14-8: a registration with an address (3.4, 11.3; review finding 3)', () => {
  it('a failure of the email part once the account exists is logged; the registration still answers, with its recovery codes and token', async () => {
    const calls: string[] = [];
    let failing = true;
    const store = spyStore(createMemoryAccountStore({ emailResetLiveCodes: 3 }), calls, {
      putEmailCode: (own, ...args) => {
        if (!failing) return own(...args);
        failing = false;
        return Promise.reject(Object.assign(new Error('the disk is full'), { name: 'DiskFull' }));
      },
    });
    const s = recordingSetup({ store });
    const req = { name: 'Alice', password: PW, birth: BIRTH, claimGuest: false, email: ALICE };
    const r = value(inRow('register', await s.service.register(ctxFor(s, 'register Alice'), req)));
    expect(calls).toContain('putEmailCode');
    expect(r.recoveryCodes).toHaveLength(10);
    expect(r.account.email).toEqual({ address: ALICE, verified: false });
    value(inRow('self', await s.service.self(ctxFor(s, 'alice'), r.auth)));
    expect(s.log).toContainEqual({ name: 'accounts.register.email', fields: { account: r.auth.account, error: 'DiskFull' } });
    await s.idle();
    expect(s.mailer.sent).toEqual([]);
    // the address set again: its code comes, and verifies it
    value(inRow('setEmail', await s.service.setEmail(ctxFor(s, 'alice'), r.auth, ALICE, { password: PW })));
    await s.idle();
    const v = value(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, 'alice'), r.auth, codeOf(s.mailer.to(ALICE)[0]))));
    expect(v.email).toEqual({ address: ALICE, verified: true });
  });
});
