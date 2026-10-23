/**
 * M14-13: the reauth-only rule for restricted sessions (design 3.8, D24; 17: RESTRICTED_PROVIDER_INTENTS). A suspended, banned or deleting account
 * begins and confirms reauth flows only: any other intent, and a flow of another intent begun before the sanction, answers the status's code
 * exactly as ServiceGuard answers a call outside RESTRICTED_CALLS (the sanction with its appeal included), before any other check; unlinkProvider
 * answers it too. A confirmed provider sign-in of such an account always signs in, to a restricted session, and its reauth ticket is the proof a
 * provider-only account gives to export (and, while suspended or banned, to renew its recovery codes).
 */
import { describe, expect, it } from 'vitest';
import type { AccountId, AccountStatus, ProviderOutcome } from '@openmtg/accounts';
import { code, DAY, inRow, PW, PW2, value } from '../m14-5/support';
import {
  accountCtx, begin, callback, guestCtx, markDeleting, proofOnlyRights, registerLocal, registerWithShopify, sanction, setupShopify, type ShopifySetup,
} from './support';

const ALICE = 'gid://shopify/Customer/8001';
const OTHER = 'gid://shopify/Customer/8002';

type Restricted = Exclude<AccountStatus, 'active'>;
const STATUS_CODE: Record<Restricted, string> = { suspended: 'suspended', banned: 'banned', deleting: 'deletionPending' };

async function restrict(s: ShopifySetup, id: AccountId, status: Restricted): Promise<void> {
  if (status === 'suspended') await sanction(s, id, 'suspend', 30 * DAY);
  if (status === 'banned') await sanction(s, id, 'ban', null);
  if (status === 'deleting') await markDeleting(s, id);
}

function reauthed(o: ProviderOutcome): string {
  if (o.kind !== 'reauthed') throw new Error(`expected reauthed, got ${o.kind}`);
  return o.ticket;
}

/** Alice: a password and Shopify linked while active, then restricted; her restricted session from a new sign-in. */
async function restrictedAlice(s: ShopifySetup, status: Restricted) {
  const alice = await registerLocal(s, 'Alice');
  const link = await begin(s, accountCtx(s, 'conn-Alice'), 'link', alice.auth, { password: PW });
  value(inRow('confirmProvider', await s.service.confirmProvider(accountCtx(s, 'conn-Alice'), alice.auth, link.flow, (await callback(s, link, ALICE)).code)));
  await restrict(s, alice.auth.account, status);
  const signed = value(inRow('signIn', await s.service.signIn(guestCtx(s, 'conn-r', null), { name: 'Alice', password: PW })));
  expect(signed.account).toMatchObject({ status, restricted: true });
  return signed.auth;
}

for (const status of ['suspended', 'banned', 'deleting'] as const) {
  describe(`M14-13: a ${status} account's restricted session (3.8)`, () => {
    it(`beginProvider: reauth only; signIn, register and link answer ${STATUS_CODE[status]} exactly as the guard does, before any other check`, async () => {
      const s = setupShopify();
      const auth = await restrictedAlice(s, status);
      const ctx = () => accountCtx(s, 'conn-r');
      // the guard's answer for a call outside every list (rename): the reference
      const expected = inRow('rename', await s.service.rename(ctx(), auth, 'Alicia', { password: PW }));
      expect(code(expected)).toBe(STATUS_CODE[status]);
      if (status !== 'deleting' && !expected.ok) expect(expected.error.sanction?.kind).toBe(status === 'banned' ? 'ban' : 'suspend');
      for (const intent of ['signIn', 'register', 'link'] as const) {
        const r = inRow('beginProvider', await s.service.beginProvider(ctx(), 'shopify', intent, auth, intent === 'link' ? { password: PW } : undefined));
        expect(r, intent).toEqual(expected);
      }
      // a link with a wrong password: the status first, the proof never checked, nothing counted on the session
      expect(inRow('beginProvider', await s.service.beginProvider(ctx(), 'shopify', 'link', auth, { password: PW2 }))).toEqual(expected);
      expect((await s.store.sessionsOf(auth.account)).find((r) => r.id === auth.session)!.proofFailures).toBe(0);
      // a reauth begins
      const r = await begin(s, ctx(), 'reauth', auth);
      expect(reauthed(value(inRow('confirmProvider', await s.service.confirmProvider(ctx(), auth, r.flow, (await callback(s, r, ALICE)).code))))).toMatch(/^[0-9a-f]{64}$/);
    });

    it(`confirmProvider: a link begun before the ${status === 'deleting' ? 'deletion' : 'sanction'} answers ${STATUS_CODE[status]}; a reauth's ticket is a proof`, async () => {
      const s = setupShopify({ rights: proofOnlyRights });
      const bobby = await registerLocal(s, 'Bobby');
      const bctx = () => accountCtx(s, 'conn-Bobby');
      const link = await begin(s, bctx(), 'link', bobby.auth, { password: PW });
      const linkPage = await callback(s, link, OTHER);
      await restrict(s, bobby.auth.account, status);
      const r = inRow('confirmProvider', await s.service.confirmProvider(bctx(), bobby.auth, link.flow, linkPage.code));
      expect(code(r)).toBe(STATUS_CODE[status]);
      expect(r).toEqual(inRow('rename', await s.service.rename(bctx(), bobby.auth, 'Robert', { password: PW })));
      expect(await s.store.credentialBySubject('shopify', OTHER)).toBeNull();

      const auth = await restrictedAlice(s, status);
      const ctx = () => accountCtx(s, 'conn-r');
      const ticket = async () => {
        const f = await begin(s, ctx(), 'reauth', auth);
        return reauthed(value(inRow('confirmProvider', await s.service.confirmProvider(ctx(), auth, f.flow, (await callback(s, f, ALICE)).code))));
      };
      // export is allowed in every restricted status, with a proof (D24): the ticket is one, once
      const t = await ticket();
      value(inRow('exportData', await s.service.exportData(ctx(), auth, { ticket: t })));
      expect(code(inRow('exportData', await s.service.exportData(ctx(), auth, { ticket: t })))).toBe('badCredentials');
      const t2 = await ticket();
      const renewed = inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx(), auth, { ticket: t2 }));
      if (status === 'deleting') expect(code(renewed)).toBe('deletionPending');
      else expect(value(renewed).codes).toHaveLength(10);
    });

    it(`unlinkProvider answers ${STATUS_CODE[status]}, and the credential stays`, async () => {
      const s = setupShopify();
      const auth = await restrictedAlice(s, status);
      const ctx = accountCtx(s, 'conn-r');
      const r = inRow('unlinkProvider', await s.service.unlinkProvider(ctx, auth, 'shopify', { password: PW }));
      expect(r).toEqual(inRow('rename', await s.service.rename(ctx, auth, 'Alicia', { password: PW })));
      expect((await s.store.credentialBySubject('shopify', ALICE))?.account).toBe(auth.account);
    });

    it('a provider-only account signs in through Shopify to a restricted session, and exports with a reauth ticket (D24)', async () => {
      const s = setupShopify({ rights: proofOnlyRights });
      const only = await registerWithShopify(s, OTHER, 'Onlyone');
      await restrict(s, only.auth.account, status);
      const g = () => guestCtx(s, 'conn-new', 'gs_new');
      const b = await begin(s, g(), 'signIn');
      const out = value(inRow('confirmProvider', await s.service.confirmProvider(g(), null, b.flow, (await callback(s, b, OTHER)).code)));
      if (out.kind !== 'signedIn') throw new Error(out.kind);
      expect(out.signedIn.auth.account).toBe(only.auth.account);
      expect(out.signedIn.account).toMatchObject({ status, restricted: true, hasPassword: false });
      const auth = out.signedIn.auth;
      const ctx = () => accountCtx(s, 'conn-new');
      // no password to give: a password proof fails
      expect(code(inRow('exportData', await s.service.exportData(ctx(), auth, { password: PW })))).toBe('badCredentials');
      const f = await begin(s, ctx(), 'reauth', auth);
      const t = reauthed(value(inRow('confirmProvider', await s.service.confirmProvider(ctx(), auth, f.flow, (await callback(s, f, OTHER)).code))));
      value(inRow('exportData', await s.service.exportData(ctx(), auth, { ticket: t })));
      await s.service.tick(s.clock.now());
      expect((await s.store.audit({ account: only.auth.account, limit: 100 })).map((e) => [e.kind, e.details])).toEqual(
        expect.arrayContaining([['signedIn', { provider: 'shopify', device: false, restricted: true }], ['reauthed', { action: 'export', via: 'ticket' }]]),
      );
    });
  });
}
