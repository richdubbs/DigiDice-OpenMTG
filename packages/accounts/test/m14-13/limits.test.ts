/**
 * M14-13: the limits of the provider flows (design 8.1, 5.2, 12.1; review of M14-13), in process with a fake clock and fixed inputs (owner rule: a
 * fixed sequence of calls, never traffic): one address key holds at most providerFlowsPerAddress live flows (with the IPv6 /56 and /48 factors, and
 * never more than a hundredth of the table), so it cannot fill the table every provider sign-in shares; beginProvider takes a token of the
 * address key's providerBeginsPerHour, providerCallback one of the browser's providerCallbacksPerHour before anything is exchanged; and every
 * limit comes before link's proof, so a begin they refuse never checks a password. providerFinish runs 8.1's registration pressure as register
 * does, answering rateLimited where register would ask for work.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_RATE_LIMITS, accountsEnvName, type RequestContext } from '@openmtg/accounts';
import { code, inRow, MIN, PW, PW2, value } from '../m14-5/support';
import { TOKEN_URL } from './issuer';
import { accountCtx, authorized, begin, BIRTH, callback, guestCtx, registerLocal, setupShopify, type ShopifySetup } from './support';

const ALICE = 'gid://shopify/Customer/7101';
const FLOW_MS = 10 * MIN;

/** A guest connection of its own (connection and guest session numbered) from `addressKey`. */
function fresh(s: ShopifySetup, n: number, addressKey: string): RequestContext {
  return guestCtx(s, `conn-${addressKey}-${n}`, `gs_${n}`, { addressKey });
}

const started = async (s: ShopifySetup, ctx: RequestContext) => inRow('beginProvider', await s.service.beginProvider(ctx, 'shopify', 'signIn', null));

describe('M14-13: one address key cannot fill the flow table (review of M14-13, security 1)', () => {
  it(`an address key holds at most ${ACCOUNT_RATE_LIMITS.providerFlowsPerAddress} live flows, from fresh connections too; others still begin`, async () => {
    const s = setupShopify();
    const max = ACCOUNT_RATE_LIMITS.providerFlowsPerAddress;
    const first = await begin(s, fresh(s, 0, '203.0.113.66'), 'signIn');
    s.clock.advance(MIN);
    for (let i = 1; i < max; i++) value(await started(s, fresh(s, i, '203.0.113.66')));
    // a fresh connection of the same address key: refused until the oldest flow of the key expires
    const r = await started(s, fresh(s, max, '203.0.113.66'));
    expect(code(r)).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(FLOW_MS - MIN);
    // another address key begins, signs in, and is never refused
    const other = fresh(s, 0, '198.51.100.40');
    const b = await begin(s, other, 'signIn');
    expect(value(inRow('confirmProvider', await s.service.confirmProvider(other, null, b.flow, (await callback(s, b, ALICE)).code))).kind).toBe('needsName');
    // a flow that ends frees its place at once: the first one's callback voids it (a wrong code), and the key begins again
    const back = authorized(s, first, ALICE);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ state: back.state, code: 'junk', addressKey: '192.0.2.5', now: s.clock.now() })))).toBe('providerFailed');
    value(await started(s, fresh(s, max + 1, '203.0.113.66')));
    expect(code(await started(s, fresh(s, max + 2, '203.0.113.66')))).toBe('rateLimited');
  });

  it('with a table of 9 (the review\'s case: 3 connections x 3 flows from one key), the key holds one flow and a victim elsewhere begins', async () => {
    const s = setupShopify({ env: { [accountsEnvName('counterEntries')]: '9' } });
    value(await started(s, fresh(s, 0, '203.0.113.66')));
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 3; i++) expect(code(await started(s, guestCtx(s, `conn-m${c}`, `gs_m${c}`, { addressKey: '203.0.113.66' })))).toBe('rateLimited');
    }
    value(await started(s, fresh(s, 0, '198.51.100.41')));
  });

  it('IPv6: a /56 holds prefix56Factor times as many live flows, a /48 prefix48Factor times, over all their /64s', async () => {
    const s = setupShopify({ env: { [accountsEnvName('providerFlowsPerAddress')]: '2' } });
    const in56 = (n: number) => `2001:db8:0:${n.toString(16)}::1`;
    // 4 x 2 flows from four /64s of the /56 2001:db8:0:0000::/56
    for (let n = 0; n < 4; n++) for (let i = 0; i < 2; i++) value(await started(s, fresh(s, i, in56(n))));
    // a fifth /64 of the same /56 is refused; a /64 of another /56 in the same /48 is not
    expect(code(await started(s, fresh(s, 0, in56(4))))).toBe('rateLimited');
    for (let n = 0; n < 3; n++) for (let i = 0; i < 8; i++) value(await started(s, fresh(s, i, `2001:db8:0:${(0x100 * (n + 1) + i).toString(16)}::1`)));
    // 8 + 24 = 32 = 16 x 2: the /48 is full, from any /56 of it; another /48 is not
    expect(code(await started(s, fresh(s, 9, '2001:db8:0:ff00::1')))).toBe('rateLimited');
    value(await started(s, fresh(s, 0, '2001:db8:1::1')));
  });
});

describe('M14-13: the per-address buckets of beginProvider and providerCallback (8.1; review of M14-13, security 1)', () => {
  it('beginProvider: providerBeginsPerHour per address key, with the IPv6 /56 and /48 aggregates', async () => {
    const s = setupShopify({ env: { [accountsEnvName('providerBeginsPerHour')]: '2' } });
    for (let i = 0; i < 2; i++) value(await started(s, fresh(s, i, '203.0.113.70')));
    const r = await started(s, fresh(s, 2, '203.0.113.70'));
    expect(code(r)).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(30 * MIN);
    value(await started(s, fresh(s, 0, '203.0.113.71')));
    s.clock.advance(30 * MIN);
    value(await started(s, fresh(s, 3, '203.0.113.70')));
    // the /56 2001:db8:5:0::/56 gets 4 x 2 begins over its /64s, then none from any /64 of it
    for (let n = 0; n < 4; n++) for (let i = 0; i < 2; i++) value(await started(s, fresh(s, i, `2001:db8:5:${n.toString(16)}::1`)));
    expect(code(await started(s, fresh(s, 0, '2001:db8:5:4::1')))).toBe('rateLimited');
    value(await started(s, fresh(s, 0, '2001:db8:5:100::1')));
  });

  it('providerCallback: providerCallbacksPerHour per address key of the browser, before the exchange: the token endpoint is not asked, the state not spent', async () => {
    // 12 an hour: one more every 5 minutes, inside a flow's 10
    const s = setupShopify({ env: { [accountsEnvName('providerCallbacksPerHour')]: '12' } });
    const junk = (state: string, addressKey = '203.0.113.80') =>
      s.service.providerCallback({ state, code: 'junk-code', addressKey, now: s.clock.now() }).then((r) => inRow('providerCallback', r));
    // twelve flows of its own, each called back with a junk code: twelve requests to the token endpoint
    for (let i = 0; i < 12; i++) {
      const b = await begin(s, fresh(s, i, '198.51.100.90'), 'signIn');
      expect(code(await junk(authorized(s, b, ALICE).state))).toBe('providerFailed');
    }
    expect(s.issuer.count(TOKEN_URL)).toBe(12);
    // the next: refused before the flow is looked up, whichever connection began it
    const victim = fresh(s, 9, '198.51.100.91');
    const b = await begin(s, victim, 'signIn');
    const back = authorized(s, b, ALICE);
    const r = await s.service.providerCallback({ ...back, addressKey: '203.0.113.80', now: s.clock.now() });
    expect(code(inRow('providerCallback', r))).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(5 * MIN);
    expect(s.issuer.count(TOKEN_URL)).toBe(12);
    expect(code(await junk('AAAAAAAAAAAAAAAAAAAAAA'))).toBe('rateLimited');
    // the same callback after the wait goes through: its state was not spent
    s.clock.advance(5 * MIN);
    const page = value(inRow('providerCallback', await s.service.providerCallback({ ...back, addressKey: '203.0.113.80', now: s.clock.now() })));
    expect(value(inRow('confirmProvider', await s.service.confirmProvider({ ...victim, now: s.clock.now() }, null, b.flow, page.code))).kind).toBe('needsName');
    // another browser's address key was never limited
    const c = await begin(s, fresh(s, 10, '198.51.100.91'), 'signIn');
    expect((await callback(s, c, ALICE, '192.0.2.200')).code).toHaveLength(8);
  });
});

describe('M14-13: the limits come before the proof (5.2; review of M14-13, contract 2)', () => {
  const cases: [string, Record<string, string>][] = [
    ['the full flow table', { [accountsEnvName('counterEntries')]: '1' }],
    ['the address key\'s empty begin bucket', { [accountsEnvName('providerBeginsPerHour')]: '1' }],
  ];
  for (const [what, env] of cases) {
    it(`a link ${what} refuses answers rateLimited without checking the password: nothing counted, no reauth recorded`, async () => {
      const s = setupShopify({ env });
      const alice = await registerLocal(s, 'Alice');
      const row = async () => (await s.store.sessionsOf(alice.auth.account)).find((r) => r.id === alice.auth.session)!;
      const authAt = (await row()).authAt;
      // the one place in the table (or the one begin of the address key's hour), taken by a guest's flow
      await begin(s, guestCtx(s, 'conn-g', 'gs_g'), 'signIn');
      const ctx = accountCtx(s, 'conn-Alice');
      s.clock.advance(1_000);
      for (const proof of [{ password: PW2 }, { password: PW }]) {
        const r = inRow('beginProvider', await s.service.beginProvider({ ...ctx, now: s.clock.now() }, 'shopify', 'link', alice.auth, proof));
        expect(code(r)).toBe('rateLimited');
      }
      expect((await row()).proofFailures).toBe(0);
      expect((await row()).authAt).toBe(authAt);
      await s.service.tick(s.clock.now());
      expect((await s.store.audit({ account: alice.auth.account, limit: 100 })).map((e) => e.kind)).not.toContain('reauthed');
    });
  }
});

describe('M14-13: providerFinish runs 8.1\'s registration pressure, as register does (review of M14-13, security 6)', () => {
  /** A flow of `addressKey` at needsName, and its finish. */
  async function named(s: ShopifySetup, addressKey: string, subject: string) {
    const ctx = guestCtx(s, `conn-${addressKey}`, 'gs_p', { addressKey });
    const b = await begin(s, ctx, 'signIn');
    expect(value(inRow('confirmProvider', await s.service.confirmProvider(ctx, null, b.flow, (await callback(s, b, subject)).code))).kind).toBe('needsName');
    return (name: string, over: Partial<RequestContext> = {}) =>
      s.service.registerWithProvider({ ...ctx, now: s.clock.now(), ...over }, b.flow, { name, birth: BIRTH, claimGuest: false }).then((r) => inRow('registerWithProvider', r));
  }

  it('CAPTCHA=none: a wide key with registerShedAfter registrations this hour is shed for a provider registration too; the flow stays', async () => {
    const s = setupShopify({ env: { [accountsEnvName('registerGlobalPerMinute')]: '0', [accountsEnvName('registerShedAfter')]: '1' } });
    const addressKey = '203.0.113.50';
    const local = (name: string, connection: string) =>
      s.service.register(guestCtx(s, connection, null, { addressKey }), { name, password: PW, birth: BIRTH, claimGuest: false }).then((r) => inRow('register', r));
    value(await local('Localone', 'conn-l1'));
    // the reference: register sheds the key's next registration
    expect(code(await local('Localtwo', 'conn-l2'))).toBe('rateLimited');
    const finish = await named(s, addressKey, ALICE);
    const r = await finish('Alice');
    expect(code(r)).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(MIN);
    expect(await s.store.credentialBySubject('shopify', ALICE)).toBeNull();
    // the flow was left for another try: from a key that registered nothing this hour it registers
    expect(value(await finish('Alice', { addressKey: '198.51.100.51' })).account.name).toBe('Alice');
  });

  it('CAPTCHA=work: above registerGlobalPerMinute register asks for work; providerFinish, which carries none, answers rateLimited', async () => {
    const s = setupShopify({ work: true, env: { [accountsEnvName('registerGlobalPerMinute')]: '0' } });
    const reference = inRow('register', await s.service.register(guestCtx(s, 'conn-l', null, { addressKey: '203.0.113.52' }), { name: 'Localone', password: PW, birth: BIRTH, claimGuest: false }));
    expect(code(reference)).toBe('captchaRequired');
    const finish = await named(s, '203.0.113.53', ALICE);
    const r = await finish('Alice');
    expect(code(r)).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(MIN);
    expect(await s.store.credentialBySubject('shopify', ALICE)).toBeNull();
  });
});
