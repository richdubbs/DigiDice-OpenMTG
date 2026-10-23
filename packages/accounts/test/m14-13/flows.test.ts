/**
 * M14-13: the provider flows in the service (src/service/providers.ts; design 3.5, D25, 5.2, 13.2) against the in-process fake issuer: sign-in and
 * registration through Shopify; state, nonce, a replayed callback and flow expiry; the binding (a callback completed in another browser gives the
 * starting connection nothing; providerConfirm from another connection is refused; 5 wrong codes void the flow; one answer for every flow that
 * cannot be confirmed; providerFinish from another connection or guest session is refused); the device proof a sign-in keeps; link needs the
 * password, one link of an account at a time; reauth tickets, only after a fresh sign-in; the unlink rules; the identity as (issuer, subject); and
 * what the logs and the audit log never hold. Every answer's code is checked against its ACCOUNT_METHOD_ERRORS row (inRow).
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS, CONFIRM_CODE, type AccountChange, type ProviderOutcome } from '@openmtg/accounts';
import { FLOW_ID } from '../../src/ids';
import { FLOWS_PER_CONNECTION } from '../../src/service/providers';
import { ERROR_MESSAGES } from '../../src/service/result';
import { code, dumpOf, inRow, MIN, PW, PW2, value } from '../m14-5/support';
import { ACCESS_TOKEN, CLIENT_SECRET, ISSUER, KEYS, REFRESH_TOKEN, TOKEN_URL } from './issuer';
import {
  accountCtx, authorized, begin, BIRTH, callback, guestCtx, registerLocal, registerWithShopify, setupShopify, wrongCode, type ShopifySetup,
} from './support';

const ALICE = 'gid://shopify/Customer/7001';
const VICTIM = 'gid://shopify/Customer/7002';
const OTHER = 'gid://shopify/Customer/7003';

function signedIn(o: ProviderOutcome) {
  if (o.kind !== 'signedIn') throw new Error(`expected signedIn, got ${o.kind}`);
  return o.signedIn;
}

const confirm = async (s: ShopifySetup, ctx: Parameters<ShopifySetup['service']['confirmProvider']>[0], auth: Parameters<ShopifySetup['service']['confirmProvider']>[1], flow: string, c: string) =>
  inRow('confirmProvider', await s.service.confirmProvider(ctx, auth, flow, c));

describe('M14-13: signing in and registering with Shopify (3.5)', () => {
  it('a new subject: needsName, then providerFinish registers a provider-only account; the next flow signs it in', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    expect(b.flow).toMatch(FLOW_ID);
    // the flow id is sent only to the connection, never in the URL
    expect(b.authorizeUrl).not.toContain(b.flow);
    const page = await callback(s, b, ALICE);
    expect(page.code).toMatch(CONFIRM_CODE);
    expect(page.expiresAt).toBe(new Date(s.clock.t + 2 * MIN).toISOString());
    expect(value(await confirm(s, ctx, null, b.flow, page.code))).toEqual({ kind: 'needsName', flow: b.flow });
    const reg = value(inRow('registerWithProvider', await s.service.registerWithProvider(ctx, b.flow, { name: 'Alice', birth: BIRTH, claimGuest: false })));
    expect(reg.account).toMatchObject({ name: 'Alice', providers: ['shopify'], hasPassword: false, recoveryCodesLeft: 0, email: null, restricted: false });
    expect(reg.recoveryCodes).toBeUndefined();
    expect(reg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.device).toMatch(/^[0-9a-f]{64}$/);
    expect(await s.store.credentials(reg.auth.account)).toEqual([
      { account: reg.auth.account, provider: 'shopify', subject: ALICE, secret: null, meta: { issuer: ISSUER }, createdAt: s.clock.now().toISOString(), lastUsedAt: s.clock.now().toISOString() },
    ]);
    expect(value(await s.service.sessions(accountCtx(s), reg.auth)).map((x) => x.provider)).toEqual(['shopify']);
    // the flow is spent
    expect(code(inRow('registerWithProvider', await s.service.registerWithProvider(ctx, b.flow, { name: 'Alicia', birth: BIRTH, claimGuest: false })))).toBe('providerFailed');

    s.clock.advance(MIN);
    const ctx2 = guestCtx(s, 'conn-b', 'gs_guestB');
    const b2 = await begin(s, ctx2, 'register');
    const page2 = await callback(s, b2, ALICE);
    const again = signedIn(value(await confirm(s, ctx2, null, b2.flow, page2.code)));
    expect(again.auth.account).toBe(reg.auth.account);
    expect(again.auth.session).not.toBe(reg.auth.session);
    expect(again.account).toMatchObject({ name: 'Alice', restricted: false });
    expect((await s.store.credentials(reg.auth.account))[0]!.lastUsedAt).toBe(s.clock.now().toISOString());
    await s.service.tick(s.clock.now());
    const audit = (await s.store.audit({ account: reg.auth.account, limit: 100 })).map((e) => [e.kind, e.details]);
    expect(audit).toEqual(expect.arrayContaining([
      ['registered', { provider: 'shopify', claimed: false }], ['signedIn', { provider: 'shopify', device: false, restricted: false }],
    ]));
  });

  it('providerFinish claims the guest games only when ticked, from the flow\'s own guest session, and retires it', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    const page = await callback(s, b, ALICE);
    value(await confirm(s, ctx, null, b.flow, page.code));
    s.guests.busySessions.add('gs_guestA');
    expect(code(inRow('registerWithProvider', await s.service.registerWithProvider(ctx, b.flow, { name: 'Alice', birth: BIRTH, claimGuest: true })))).toBe('busy');
    s.guests.busySessions.clear();
    const reg = value(inRow('registerWithProvider', await s.service.registerWithProvider(ctx, b.flow, { name: 'Alice', birth: BIRTH, claimGuest: true })));
    expect(await s.store.claimsOf(reg.auth.account)).toEqual([{ session: 'gs_guestA', account: reg.auth.account, claimedAt: s.clock.now().toISOString() }]);
    expect(s.guests.retired).toEqual(['gs_guestA']);
  });

  it('providerFinish: the name rules, the age gate with its 24-hour mark, and the per-address registration limit', async () => {
    const s = setupShopify();
    await registerLocal(s, 'Bobby');
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    value(await confirm(s, ctx, null, b.flow, (await callback(s, b, ALICE)).code));
    const finish = (name: string, birth = BIRTH) => s.service.registerWithProvider(ctx, b.flow, { name, birth, claimGuest: false });
    // a refused name leaves the flow for another try
    expect(code(inRow('registerWithProvider', await finish('Admin')))).toBe('nameReserved');
    expect(code(inRow('registerWithProvider', await finish('BOBBY')))).toBe('nameTaken');
    expect(code(inRow('registerWithProvider', await finish('a')))).toBe('nameInvalid');
    expect(code(inRow('registerWithProvider', await finish('Alice', { year: 1900, month: 13 })))).toBe('badMessage');
    const year = s.clock.now().getUTCFullYear();
    expect(code(inRow('registerWithProvider', await finish('Alice', { year: year - 10, month: 1 })))).toBe('ageGate');
    // marked for 24 hours: the connection's next answer is the same, whatever the date
    expect(code(inRow('registerWithProvider', await finish('Alice')))).toBe('ageGate');

    // the per-address limit of 8.1 (3 an hour) counts provider registrations too
    const t = setupShopify();
    for (let i = 0; i < 4; i++) {
      const c = guestCtx(t, `conn-${i}`, `gs_g${i}`, { addressKey: '198.51.100.200' });
      const f = await begin(t, c, 'signIn');
      value(await confirm(t, c, null, f.flow, (await callback(t, f, `gid://shopify/Customer/90${i}`)).code));
      const r = inRow('registerWithProvider', await t.service.registerWithProvider(c, f.flow, { name: `Player${i}x`, birth: BIRTH, claimGuest: false }));
      if (i < 3) value(r);
      else expect(code(r)).toBe('rateLimited');
    }
  });

  it('a confirmed sign-in answers busy while the guest session is seated, queued or waiting, without spending a try', async () => {
    const s = setupShopify();
    await registerWithShopify(s, ALICE, 'Alice');
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    const page = await callback(s, b, ALICE);
    // wrong codes too, as many as the flow's tries (review of M14-13, contract 5a): busy comes before the code is compared or counted
    for (let i = 0; i < ACCOUNT_LIMITS.confirmTries; i++) {
      expect(code(await confirm(s, { ...ctx, guestBusy: true }, null, b.flow, wrongCode(page.code, i)))).toBe('busy');
    }
    expect(code(await confirm(s, { ...ctx, guestBusy: true }, null, b.flow, page.code))).toBe('busy');
    signedIn(value(await confirm(s, ctx, null, b.flow, page.code)));
  });

  it('a login registered by another connection meanwhile: the second providerFinish answers providerFailed and ends its flow (review of M14-13, contract 5b)', async () => {
    const s = setupShopify();
    const a = guestCtx(s, 'conn-a', 'gs_a');
    const b = guestCtx(s, 'conn-b', 'gs_b');
    // both connections reach needsName for the same login
    const fa = await begin(s, a, 'signIn');
    const fb = await begin(s, b, 'signIn');
    expect(value(await confirm(s, a, null, fa.flow, (await callback(s, fa, ALICE)).code)).kind).toBe('needsName');
    expect(value(await confirm(s, b, null, fb.flow, (await callback(s, fb, ALICE)).code)).kind).toBe('needsName');
    const finish = (ctx: typeof a, flow: string, name: string) =>
      s.service.registerWithProvider(ctx, flow, { name, birth: BIRTH, claimGuest: false }).then((r) => inRow('registerWithProvider', r));
    const first = value(await finish(a, fa.flow, 'Alice'));
    const second = await finish(b, fb.flow, 'Alicia');
    expect(code(second)).toBe('providerFailed');
    if (!second.ok) expect(second.error.message).toBe(ERROR_MESSAGES.providerLinked);
    // the flow ended: another try answers providerFailed before any check of the request (a name of the wrong shape is never looked at)
    expect(code(await finish(b, fb.flow, 'a'))).toBe('providerFailed');
    expect((await s.store.credentialBySubject('shopify', ALICE))!.account).toBe(first.auth.account);
    expect(await s.service.nameUnavailable('Alicia')).toBe(false);
  });

  it('a provider sign-in keeps a device proof that is valid for the account, so the account\'s other devices stay (8.3; review of M14-13, contract 3)', async () => {
    const s = setupShopify();
    // the laptop: a password registration and its device proof; Shopify linked
    const alice = await registerLocal(s, 'Alice');
    const actx = accountCtx(s, 'conn-Alice');
    const l = await begin(s, actx, 'link', alice.auth, { password: PW });
    value(await confirm(s, actx, alice.auth, l.flow, (await callback(s, l, ALICE)).code));
    const viaShopify = async (n: number, device?: string) => {
      s.clock.advance(MIN);
      const g = guestCtx(s, `conn-phone-${n}`, `gs_phone${n}`);
      const b = await begin(s, g, 'signIn');
      const page = await callback(s, b, ALICE);
      return inRow('confirmProvider', await s.service.confirmProvider(g, null, b.flow, page.code, device));
    };
    // the phone: its first Shopify sign-in, without a proof, gets a new one
    const phone = signedIn(value(await viaShopify(0))).device;
    expect(phone).not.toBe(alice.device);
    // then it sends it, more times than an account keeps devices: the same proof back each time
    for (let i = 1; i <= 10; i++) expect(signedIn(value(await viaShopify(i, phone))).device).toBe(phone);
    // the laptop's proof is still valid: a password sign-in with it keeps it
    expect(value(await s.service.signIn(guestCtx(s, 'conn-laptop', null), { name: 'Alice', password: PW, device: alice.device })).device).toBe(alice.device);
    await s.service.tick(s.clock.now());
    const signIns = (await s.store.audit({ account: alice.auth.account, limit: 100 })).filter((e) => e.kind === 'signedIn').map((e) => e.details);
    expect(signIns).toEqual(expect.arrayContaining([{ provider: 'shopify', device: true, restricted: false }, { provider: 'shopify', device: false, restricted: false }]));
    // another account's proof is not this account's: a new one; a proof of the wrong shape answers badMessage before anything else
    const bobby = await registerLocal(s, 'Bobby');
    expect(signedIn(value(await viaShopify(20, bobby.device))).device).not.toBe(bobby.device);
    expect(code(await viaShopify(21, 'not-a-device-proof'))).toBe('badMessage');
  });

  it('the intent must fit the connection; a proof only with link; only external providers', async () => {
    const s = setupShopify();
    const alice = await registerLocal(s, 'Alice');
    const g = guestCtx(s);
    const a = accountCtx(s);
    const start = async (ctx: typeof g, intent: string, auth: typeof alice.auth | null, provider = 'shopify', proof?: { password: string }) =>
      inRow('beginProvider', await s.service.beginProvider(ctx, provider as 'shopify', intent as 'signIn', auth, proof));
    expect(code(await start(a, 'signIn', alice.auth))).toBe('notAllowed');
    expect(code(await start(a, 'register', alice.auth))).toBe('notAllowed');
    expect(code(await start(g, 'link', null))).toBe('notAllowed');
    expect(code(await start(g, 'reauth', null))).toBe('notAllowed');
    expect(code(await start(g, 'signIn', null, 'shopify', { password: PW }))).toBe('badMessage');
    expect(code(await start(g, 'signIn', null, 'local'))).toBe('badMessage');
    expect(code(await start(g, 'signIn', null, 'github'))).toBe('badMessage');
    expect(code(await start(g, 'login', null))).toBe('badMessage');
    // reauth needs a linked provider
    expect(code(await start(a, 'reauth', alice.auth))).toBe('notAllowed');
    // passkeys wait for M14-14
    expect(code(await start(g, 'signIn', null, 'passkey'))).toBe('notYet');
  });

  it('a provider that is not configured answers notYet; an issuer that cannot be reached, providerUnavailable', async () => {
    const off = setupShopify({ noShopify: true });
    expect(code(inRow('beginProvider', await off.service.beginProvider(guestCtx(off), 'shopify', 'signIn', null)))).toBe('notYet');
    const s = setupShopify();
    s.issuer.down = true;
    expect(code(inRow('beginProvider', await s.service.beginProvider(guestCtx(s), 'shopify', 'signIn', null)))).toBe('providerUnavailable');
  });

  it('a flow its connection dropped while the provider checked the callback gets no code (review of M14-13, contract 5d)', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    const back = authorized(s, b, ALICE);
    let release: () => void = () => undefined;
    s.issuer.tokenGate = new Promise<void>((r) => (release = r));
    const pending = s.service.providerCallback({ ...back, addressKey: '192.0.2.1', now: s.clock.now() });
    // while the token endpoint is answering, the connection starts newer flows, the last of which drops this one
    for (let i = 0; i < FLOWS_PER_CONNECTION; i++) await begin(s, ctx, 'signIn');
    expect(s.issuer.count(TOKEN_URL)).toBe(1);
    release();
    expect(code(inRow('providerCallback', await pending))).toBe('providerFailed');
    expect(s.log.filter((l) => l.name === 'accounts.provider.callback').map((l) => l.fields['outcome'])).toEqual(['expired']);
  });

  it(`a connection holds at most ${FLOWS_PER_CONNECTION} flows: a new one drops its oldest, never another connection's`, async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const other = await begin(s, guestCtx(s, 'conn-b', 'gs_guestB'), 'signIn');
    const flows = [];
    for (let i = 0; i <= FLOWS_PER_CONNECTION; i++) flows.push(await begin(s, ctx, 'signIn'));
    const oldest = authorized(s, flows[0]!, ALICE);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...oldest, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    for (const f of [...flows.slice(1), other]) expect((await callback(s, f, ALICE)).code).toMatch(CONFIRM_CODE);
  });
});

describe('M14-13: state, nonce, replay and expiry (3.5)', () => {
  it('a callback without a live flow\'s state is refused; an error from the provider voids the flow', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    const back = authorized(s, b, ALICE);
    const cb = (input: Partial<Parameters<ShopifySetup['service']['providerCallback']>[0]>) =>
      s.service.providerCallback({ addressKey: '192.0.2.1', now: s.clock.now(), ...input }).then((r) => inRow('providerCallback', r));
    expect(code(await cb({ code: back.code, state: 'AAAAAAAAAAAAAAAAAAAAAA' }))).toBe('providerFailed');
    expect(code(await cb({ code: back.code }))).toBe('providerFailed');
    expect(code(await cb({ code: back.code, state: `${back.state}!` }))).toBe('providerFailed');
    // none of those touched the flow
    const other = await begin(s, ctx, 'signIn');
    const denied = authorized(s, other, ALICE);
    expect(code(await cb({ state: denied.state, error: 'access_denied' }))).toBe('providerFailed');
    expect(code(await cb(denied))).toBe('providerFailed');
    expect((await callback(s, b, ALICE)).code).toMatch(CONFIRM_CODE);
    // a code of the wrong shape voids the flow (its state is spent)
    const e = await begin(s, ctx, 'signIn');
    const backE = authorized(s, e, ALICE);
    expect(code(await cb({ state: backE.state, code: 'not a code' }))).toBe('providerFailed');
    expect(code(await cb(backE))).toBe('providerFailed');
  });

  it('a replayed callback is refused: the state is one use; the first code still confirms', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    const back = authorized(s, b, ALICE);
    const first = value(inRow('providerCallback', await s.service.providerCallback({ ...back, addressKey: '192.0.2.1', now: s.clock.now() })));
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...back, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    // a fresh authorization brought back with the spent state is refused too
    const fresh = authorized(s, b, OTHER);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...fresh, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    expect(value(await confirm(s, ctx, null, b.flow, first.code)).kind).toBe('needsName');
  });

  it('a code from one flow\'s authorization brought back with another flow\'s state is refused (PKCE and nonce), and that flow is void', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const a = await begin(s, ctx, 'signIn');
    const b = await begin(s, ctx, 'signIn');
    const backA = authorized(s, a, ALICE);
    const backB = authorized(s, b, ALICE);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ code: backA.code, state: backB.state, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...backB, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
  });

  it('an ID token with another nonce, or failing any other check, fails the callback and voids the flow; an unreachable issuer answers providerUnavailable', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    s.issuer.idTokenFor = (g) => s.issuer.mint(g.subject, 'a-nonce-of-another-flow');
    const b = await begin(s, ctx, 'signIn');
    const back = authorized(s, b, ALICE);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...back, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    expect(code(await confirm(s, ctx, null, b.flow, 'AAAAAAAA'))).toBe('providerFailed');
    s.issuer.idTokenFor = (g) => s.issuer.hs256WithPublicKey(g.subject, g.nonce);
    const c = await begin(s, ctx, 'signIn');
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...authorized(s, c, ALICE), addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    s.issuer.idTokenFor = (g) => s.issuer.mint(g.subject, g.nonce, { key: KEYS.ec384, header: { alg: 'ES256' } });
    const d = await begin(s, ctx, 'signIn');
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...authorized(s, d, ALICE), addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    s.issuer.idTokenFor = null;
    const e = await begin(s, ctx, 'signIn');
    const backE = authorized(s, e, ALICE);
    s.issuer.down = true;
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...backE, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerUnavailable');
  });

  it('flow expiry: a callback 10 minutes after the start is refused; a code 2 minutes after the callback; a finish after the flow\'s 10 minutes', async () => {
    const s = setupShopify();
    // a context carries its time: one per call, at the clock's time
    const ctx = () => guestCtx(s);
    const late = await begin(s, ctx(), 'signIn');
    s.clock.advance(10 * MIN);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...authorized(s, late, ALICE), addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');

    const b = await begin(s, ctx(), 'signIn');
    const page = await callback(s, b, ALICE);
    s.clock.advance(2 * MIN - 1);
    const live = await begin(s, ctx(), 'signIn');
    const livePage = await callback(s, live, ALICE);
    s.clock.advance(1);
    expect(code(await confirm(s, ctx(), null, b.flow, page.code))).toBe('providerFailed');
    // the code expired, so the flow is void: no try is left for it
    expect(code(await confirm(s, ctx(), null, b.flow, page.code))).toBe('providerFailed');
    expect(value(await confirm(s, ctx(), null, live.flow, livePage.code)).kind).toBe('needsName');

    // a callback near the end: its code ends with the flow
    const c = await begin(s, ctx(), 'signIn');
    s.clock.advance(9 * MIN);
    const near = await callback(s, c, ALICE);
    expect(near.expiresAt).toBe(new Date(s.clock.t + MIN).toISOString());

    const d = await begin(s, ctx(), 'signIn');
    value(await confirm(s, ctx(), null, d.flow, (await callback(s, d, OTHER)).code));
    s.clock.advance(10 * MIN - 1);
    // a refused name keeps the flow until its 10 minutes are up
    expect(code(inRow('registerWithProvider', await s.service.registerWithProvider(ctx(), d.flow, { name: 'Admin', birth: BIRTH, claimGuest: false })))).toBe('nameReserved');
    s.clock.advance(1);
    expect(code(inRow('registerWithProvider', await s.service.registerWithProvider(ctx(), d.flow, { name: 'Alice', birth: BIRTH, claimGuest: false })))).toBe('providerFailed');
  });
});

describe('M14-13: the flow is bound to the connection that started it (D25)', () => {
  it('a callback completed in another browser gives the starting connection nothing: no session, link or account, and no way to the code', async () => {
    const s = setupShopify();
    const victim = await registerWithShopify(s, VICTIM, 'Victim');
    const mallory = await registerLocal(s, 'Mallory');
    const changes: AccountChange[] = [];
    s.service.onChange((c) => changes.push(c));
    const guest = guestCtx(s, 'conn-x', 'gs_mallory', { addressKey: '203.0.113.66' });
    const signed = accountCtx(s, 'conn-y', { addressKey: '203.0.113.66' });
    // the attacker starts three flows and sends their authorize URLs to victims, who finish them in their own browsers
    const signInFlow = await begin(s, guest, 'signIn');
    const linkFlow = await begin(s, signed, 'link', mallory.auth, { password: PW });
    const registerFlow = await begin(s, guest, 'register');
    await s.service.tick(s.clock.now());
    const before = JSON.stringify(dumpOf(s.store));
    const pages = [await callback(s, signInFlow, VICTIM), await callback(s, linkFlow, OTHER), await callback(s, registerFlow, OTHER)];
    await s.service.tick(s.clock.now());
    // the callbacks issued nothing: not a row, a change or an audit event
    expect(JSON.stringify(dumpOf(s.store))).toBe(before);
    expect(changes).toEqual([]);
    // the attacker's connections, without the codes the victims' pages showed, only spend their own flows' tries
    const tries: [typeof signInFlow, typeof guest, typeof mallory.auth | null][] = [[signInFlow, guest, null], [linkFlow, signed, mallory.auth], [registerFlow, guest, null]];
    for (const [i, [flow, ctx, auth]] of tries.entries()) {
      for (let n = 0; n < ACCOUNT_LIMITS.confirmTries; n++) expect(code(await confirm(s, ctx, auth, flow.flow, wrongCode(pages[i]!.code, n)))).toBe('providerFailed');
      // void: a code read out later is worth nothing either
      expect(code(await confirm(s, ctx, auth, flow.flow, pages[i]!.code))).toBe('providerFailed');
    }
    expect(JSON.stringify(dumpOf(s.store))).toBe(before);
    expect((await s.store.sessionsOf(victim.auth.account)).length).toBe(1);
    expect(await s.store.credentialBySubject('shopify', OTHER)).toBeNull();
    expect((await s.store.credentials(mallory.auth.account)).map((c) => c.provider)).toEqual(['local']);
  });

  it('every flow confirmProvider cannot confirm gets one answer, so polling tells a phisher nothing of when the victim finished (review of M14-13, security 3)', async () => {
    const s = setupShopify();
    await registerWithShopify(s, VICTIM, 'Victim');
    const guest = guestCtx(s, 'conn-x', 'gs_mallory', { addressKey: '203.0.113.66' });
    const poll = async (flow: string, c: string, ctx = guest) => inRow('confirmProvider', await s.service.confirmProvider({ ...ctx, now: s.clock.now() }, null, flow, c));
    const b = await begin(s, guest, 'signIn');
    // before the victim finishes: the answer, whatever is sent
    const before = await poll(b.flow, 'AAAAAAAA');
    expect(code(before)).toBe('providerFailed');
    // the victim finishes the authorization in their own browser; the phisher's polls answer exactly the same
    const page = await callback(s, b, VICTIM);
    for (let i = 0; i < ACCOUNT_LIMITS.confirmTries; i++) expect(await poll(b.flow, wrongCode(page.code, i))).toEqual(before);
    // voided now: the same again, even with the right code
    expect(await poll(b.flow, page.code)).toEqual(before);
    // another connection's poll, an unknown flow, a code past its 2 minutes: the same
    const c = await begin(s, guest, 'signIn');
    const pageC = await callback(s, c, VICTIM);
    expect(await poll(c.flow, pageC.code, guestCtx(s, 'conn-y', 'gs_y'))).toEqual(before);
    expect(await poll(`${c.flow.slice(0, -1)}${c.flow.endsWith('A') ? 'B' : 'A'}`, pageC.code)).toEqual(before);
    s.clock.advance(2 * MIN);
    expect(await poll(c.flow, pageC.code)).toEqual(before);
  });

  it('providerConfirm from another connection, or another guest session, is refused without spending a try; then the starting one confirms', async () => {
    const s = setupShopify();
    await registerWithShopify(s, ALICE, 'Alice');
    const bobby = await registerLocal(s, 'Bobby');
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    const page = await callback(s, b, ALICE);
    const others = [guestCtx(s, 'conn-b', 'gs_guestA'), guestCtx(s, 'conn-a', 'gs_other'), guestCtx(s, 'conn-a', null)];
    for (let round = 0; round < 2; round++) {
      for (const o of others) expect(code(await confirm(s, o, null, b.flow, page.code))).toBe('providerFailed');
      expect(code(await confirm(s, accountCtx(s, 'conn-a'), bobby.auth, b.flow, page.code))).toBe('providerFailed');
    }
    // eight refusals with the right code, more than the 5 tries: none counted
    expect(signedIn(value(await confirm(s, ctx, null, b.flow, page.code))).account.name).toBe('Alice');
  });

  it('link and reauth flows are bound to the account session too', async () => {
    const s = setupShopify();
    const alice = await registerLocal(s, 'Alice');
    const second = value(await s.service.signIn(guestCtx(s, 'conn-a2', null), { name: 'Alice', password: PW }));
    const ctx = accountCtx(s, 'conn-a');
    const b = await begin(s, ctx, 'link', alice.auth, { password: PW });
    const page = await callback(s, b, ALICE);
    expect(code(await confirm(s, ctx, second.auth, b.flow, page.code))).toBe('providerFailed');
    expect(code(await confirm(s, accountCtx(s, 'conn-b'), alice.auth, b.flow, page.code))).toBe('providerFailed');
    expect(code(await confirm(s, guestCtx(s, 'conn-a', null), null, b.flow, page.code))).toBe('providerFailed');
    expect(value(await confirm(s, ctx, alice.auth, b.flow, page.code)).kind).toBe('linked');
  });

  it('5 wrong codes void the flow; 4 do not', async () => {
    const s = setupShopify();
    await registerWithShopify(s, ALICE, 'Alice');
    const ctx = guestCtx(s);
    const four = await begin(s, ctx, 'signIn');
    const page4 = await callback(s, four, ALICE);
    for (let i = 0; i < ACCOUNT_LIMITS.confirmTries - 1; i++) expect(code(await confirm(s, ctx, null, four.flow, wrongCode(page4.code, i)))).toBe('providerFailed');
    signedIn(value(await confirm(s, ctx, null, four.flow, page4.code)));
    const five = await begin(s, ctx, 'signIn');
    const page5 = await callback(s, five, ALICE);
    for (let i = 0; i < ACCOUNT_LIMITS.confirmTries; i++) expect(code(await confirm(s, ctx, null, five.flow, wrongCode(page5.code, i)))).toBe('providerFailed');
    expect(code(await confirm(s, ctx, null, five.flow, page5.code))).toBe('providerFailed');
  });

  it('a code typed with look-alikes and in lower case confirms; a malformed one answers badMessage and counts nothing; a confirm before the callback counts nothing', async () => {
    const s = setupShopify();
    await registerWithShopify(s, ALICE, 'Alice');
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    // no callback yet: nothing to compare, nothing counted
    for (let i = 0; i < ACCOUNT_LIMITS.confirmTries + 1; i++) expect(code(await confirm(s, ctx, null, b.flow, 'AAAAAAAA'))).toBe('providerFailed');
    const page = await callback(s, b, ALICE);
    for (const bad of ['', 'ABC', 'ABCDEFGHJ', 'UUUUUUUU', 'ABCD EFG!', 'x'.repeat(40)]) expect(code(await confirm(s, ctx, null, b.flow, bad))).toBe('badMessage');
    expect(code(inRow('confirmProvider', await s.service.confirmProvider(ctx, null, 'pf_nope', page.code)))).toBe('badMessage');
    const typed = `${page.code.slice(0, 4)}-${page.code.slice(4)}`.toLowerCase();
    signedIn(value(await confirm(s, ctx, null, b.flow, typed)));
  });

  it('providerFinish from another connection or guest session is refused; the starting one registers', async () => {
    const s = setupShopify();
    const ctx = guestCtx(s);
    const b = await begin(s, ctx, 'signIn');
    value(await confirm(s, ctx, null, b.flow, (await callback(s, b, ALICE)).code));
    const finish = (c: typeof ctx) => s.service.registerWithProvider(c, b.flow, { name: 'Alice', birth: BIRTH, claimGuest: false }).then((r) => inRow('registerWithProvider', r));
    expect(code(await finish(guestCtx(s, 'conn-b', 'gs_guestA')))).toBe('providerFailed');
    expect(code(await finish(guestCtx(s, 'conn-a', 'gs_other')))).toBe('providerFailed');
    expect(code(await finish(guestCtx(s, 'conn-a', null)))).toBe('providerFailed');
    expect(code(await finish({ ...ctx, guestBusy: true }))).toBe('busy');
    // the confirmed flow cannot be confirmed again
    expect(code(await confirm(s, ctx, null, b.flow, 'AAAAAAAA'))).toBe('providerFailed');
    expect(value(await finish(ctx)).account.name).toBe('Alice');
  });
});

describe('M14-13: link, reauth and unlink (3.5, 5.2)', () => {
  it('link needs the password in the same request: none answers reauthRequired, a wrong one badCredentials and counts; then the subject is linked', async () => {
    const s = setupShopify();
    const alice = await registerLocal(s, 'Alice');
    const ctx = accountCtx(s);
    expect(code(inRow('beginProvider', await s.service.beginProvider(ctx, 'shopify', 'link', alice.auth)))).toBe('reauthRequired');
    expect(code(inRow('beginProvider', await s.service.beginProvider(ctx, 'shopify', 'link', alice.auth, { password: PW2 })))).toBe('badCredentials');
    expect((await s.store.sessionsOf(alice.auth.account)).find((r) => r.id === alice.auth.session)!.proofFailures).toBe(1);
    const b = await begin(s, ctx, 'link', alice.auth, { password: PW });
    const out = value(await confirm(s, ctx, alice.auth, b.flow, (await callback(s, b, ALICE)).code));
    if (out.kind !== 'linked') throw new Error(out.kind);
    expect(out.account).toMatchObject({ providers: ['local', 'shopify'], hasPassword: true });
    // signing in with the subject now reaches Alice
    const g = guestCtx(s, 'conn-g', 'gs_g');
    const f = await begin(s, g, 'signIn');
    expect(signedIn(value(await confirm(s, g, null, f.flow, (await callback(s, f, ALICE)).code))).auth.account).toBe(alice.auth.account);
    await s.service.tick(s.clock.now());
    const audit = (await s.store.audit({ account: alice.auth.account, limit: 100 })).map((e) => [e.kind, e.details]);
    expect(audit).toEqual(expect.arrayContaining([['providerLinked', { provider: 'shopify' }], ['reauthed', { action: 'link', via: 'password' }]]));
    // a second link of the same provider is refused before any flow
    expect(code(inRow('beginProvider', await s.service.beginProvider(ctx, 'shopify', 'link', alice.auth, { password: PW })))).toBe('notAllowed');
  });

  it('one Shopify login per account: a second link flow confirmed after the first answers providerLinked (review of M14-13, contract 5c)', async () => {
    const s = setupShopify();
    const alice = await registerLocal(s, 'Alice');
    const ctx = accountCtx(s);
    // both begun while the account has none
    const one = await begin(s, ctx, 'link', alice.auth, { password: PW });
    const two = await begin(s, ctx, 'link', alice.auth, { password: PW });
    const pageOne = await callback(s, one, 'gid://shopify/Customer/1');
    const pageTwo = await callback(s, two, 'gid://shopify/Customer/2');
    expect(value(await confirm(s, ctx, alice.auth, one.flow, pageOne.code)).kind).toBe('linked');
    const r = await confirm(s, ctx, alice.auth, two.flow, pageTwo.code);
    expect(code(r)).toBe('providerLinked');
    if (!r.ok) expect(r.error.message).toBe('This sign-in method is already linked to your account.');
    expect((await s.store.credentials(alice.auth.account)).map((c) => `${c.provider}:${c.subject}`)).toEqual(['local:' + alice.auth.account, 'shopify:gid://shopify/Customer/1']);
  });

  it('two link flows of one account confirmed at once: one links, the other waits (rateLimited, its flow kept) and then answers providerLinked (review of M14-13, contract 1)', async () => {
    const s = setupShopify();
    const alice = await registerLocal(s, 'Alice');
    const ctx = accountCtx(s);
    const one = await begin(s, ctx, 'link', alice.auth, { password: PW });
    const two = await begin(s, ctx, 'link', alice.auth, { password: PW });
    const pages = [await callback(s, one, 'gid://shopify/Customer/1'), await callback(s, two, 'gid://shopify/Customer/2')];
    const flows = [one, two];
    const both = await Promise.all(flows.map((f, i) => confirm(s, ctx, alice.auth, f.flow, pages[i]!.code)));
    const outcomes = both.map((r) => (r.ok ? r.value.kind : r.error.code));
    expect([...outcomes].sort()).toEqual(['linked', 'rateLimited']);
    const shopify = async () => (await s.store.credentials(alice.auth.account)).filter((c) => c.provider === 'shopify');
    expect(await shopify()).toHaveLength(1);
    // the one that waited: its flow and code still work, and answer that the account has one already
    const waited = outcomes.indexOf('rateLimited');
    expect(code(await confirm(s, ctx, alice.auth, flows[waited]!.flow, pages[waited]!.code))).toBe('providerLinked');
    expect(await shopify()).toHaveLength(1);
    expect(value(await s.service.self(ctx, alice.auth)).providers).toEqual(['local', 'shopify']);
  });

  it('a subject another account holds answers providerLinked, and is not moved', async () => {
    const s = setupShopify();
    const owner = await registerWithShopify(s, ALICE, 'Alice');
    const bobby = await registerLocal(s, 'Bobby');
    const ctx = accountCtx(s, 'conn-b');
    const b = await begin(s, ctx, 'link', bobby.auth, { password: PW });
    expect(code(await confirm(s, ctx, bobby.auth, b.flow, (await callback(s, b, ALICE)).code))).toBe('providerLinked');
    expect((await s.store.credentialBySubject('shopify', ALICE))!.account).toBe(owner.auth.account);
    expect((await s.store.credentials(bobby.auth.account)).map((c) => c.provider)).toEqual(['local']);
  });

  it('reauth gives a ticket for this session only, one use, 2 minutes: a provider-only account renews its recovery codes with it', async () => {
    const s = setupShopify();
    const alice = await registerWithShopify(s, ALICE, 'Alice');
    const ctx = accountCtx(s, 'conn-Alice');
    expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, alice.auth, undefined as never)))).toBe('reauthRequired');
    const reauth = async () => {
      const b = await begin(s, ctx, 'reauth', alice.auth);
      const out = value(await confirm(s, ctx, alice.auth, b.flow, (await callback(s, b, ALICE)).code));
      if (out.kind !== 'reauthed') throw new Error(out.kind);
      return out.ticket;
    };
    const ticket = await reauth();
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    const codes = value(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, alice.auth, { ticket })));
    expect(codes.codes).toHaveLength(ACCOUNT_LIMITS.recoveryCodes);
    expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, alice.auth, { ticket })))).toBe('badCredentials');
    // another session of the same account cannot use it
    const g = guestCtx(s, 'conn-2', 'gs_2');
    const f = await begin(s, g, 'signIn');
    const other = signedIn(value(await confirm(s, g, null, f.flow, (await callback(s, f, ALICE)).code)));
    const t2 = await reauth();
    expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(accountCtx(s, 'conn-2'), other.auth, { ticket: t2 })))).toBe('badCredentials');
    const t3 = await reauth();
    s.clock.advance(2 * MIN);
    expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(accountCtx(s, 'conn-Alice'), alice.auth, { ticket: t3 })))).toBe('badCredentials');
  });

  it('reauth asks the provider for a fresh sign-in; a provider session of any age, or a token without auth_time, gives no ticket (review of M14-13, security 2)', async () => {
    const s = setupShopify();
    const alice = await registerWithShopify(s, ALICE, 'Alice');
    const ctx = accountCtx(s, 'conn-Alice');
    // a sign-in's authorization asks for nothing more; a reauth's for max_age=0 and prompt=login
    const g = new URL((await begin(s, guestCtx(s, 'conn-g', 'gs_g'), 'signIn')).authorizeUrl).searchParams;
    expect([g.has('max_age'), g.has('prompt')]).toEqual([false, false]);
    const r = await begin(s, ctx, 'reauth', alice.auth);
    const q = new URL(r.authorizeUrl).searchParams;
    expect([q.get('max_age'), q.get('prompt')]).toEqual(['0', 'login']);
    // the review's chain: the browser's 30-day-old Shopify session answers without anyone signing in (a stolen game session on a shared computer)
    s.issuer.ignoresFreshSignIn = true;
    const back = authorized(s, r, ALICE);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...back, addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    expect(code(await confirm(s, ctx, alice.auth, r.flow, 'AAAAAAAA'))).toBe('providerFailed');
    // an ID token without auth_time
    s.issuer.ignoresFreshSignIn = false;
    s.issuer.idTokenFor = (grant) => s.issuer.mint(grant.subject, grant.nonce);
    const r2 = await begin(s, ctx, 'reauth', alice.auth);
    expect(code(inRow('providerCallback', await s.service.providerCallback({ ...authorized(s, r2, ALICE), addressKey: '192.0.2.1', now: s.clock.now() })))).toBe('providerFailed');
    // nothing was given: renewing the recovery codes still needs a proof
    expect(code(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctx, alice.auth, undefined as never)))).toBe('reauthRequired');
    // a fresh sign-in gives the ticket
    s.issuer.idTokenFor = null;
    const r3 = await begin(s, ctx, 'reauth', alice.auth);
    expect(value(await confirm(s, ctx, alice.auth, r3.flow, (await callback(s, r3, ALICE)).code)).kind).toBe('reauthed');
  });

  it('reauth with another customer\'s subject answers providerFailed and gives no ticket', async () => {
    const s = setupShopify();
    const alice = await registerWithShopify(s, ALICE, 'Alice');
    const ctx = accountCtx(s, 'conn-Alice');
    const b = await begin(s, ctx, 'reauth', alice.auth);
    expect(code(await confirm(s, ctx, alice.auth, b.flow, (await callback(s, b, OTHER)).code))).toBe('providerFailed');
  });

  it('unlink: notFound when not linked; conflict for the last way to sign in; the proof in the same request; then the subject is free', async () => {
    const s = setupShopify();
    const only = await registerWithShopify(s, OTHER, 'Onlyone');
    const octx = accountCtx(s, 'conn-Onlyone');
    const last = inRow('unlinkProvider', await s.service.unlinkProvider(octx, only.auth, 'shopify', { password: PW }));
    expect(code(last)).toBe('conflict');
    // a provider-only account cannot set a password: the message never tells it to (review of M14-13, contract 4)
    if (!last.ok) expect(last.error.message).toBe('This is your only way to sign in. Link another way to sign in first.');
    expect(code(inRow('unlinkProvider', await s.service.unlinkProvider(octx, only.auth, 'passkey', { password: PW })))).toBe('notFound');
    expect(code(inRow('unlinkProvider', await s.service.unlinkProvider(octx, only.auth, 'local' as 'shopify', { password: PW })))).toBe('badMessage');

    const alice = await registerLocal(s, 'Alice');
    const ctx = accountCtx(s);
    expect(code(inRow('unlinkProvider', await s.service.unlinkProvider(ctx, alice.auth, 'shopify', { password: PW })))).toBe('notFound');
    const b = await begin(s, ctx, 'link', alice.auth, { password: PW });
    value(await confirm(s, ctx, alice.auth, b.flow, (await callback(s, b, ALICE)).code));
    expect(code(inRow('unlinkProvider', await s.service.unlinkProvider(ctx, alice.auth, 'shopify', undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('unlinkProvider', await s.service.unlinkProvider(ctx, alice.auth, 'shopify', { password: PW2 })))).toBe('badCredentials');
    const view = value(inRow('unlinkProvider', await s.service.unlinkProvider(ctx, alice.auth, 'shopify', { password: PW })));
    expect(view).toMatchObject({ providers: ['local'], hasPassword: true });
    expect(await s.store.credentialBySubject('shopify', ALICE)).toBeNull();
    await s.service.tick(s.clock.now());
    expect((await s.store.audit({ account: alice.auth.account, limit: 100 })).map((e) => [e.kind, e.details])).toEqual(
      expect.arrayContaining([['providerUnlinked', { provider: 'shopify' }]]),
    );
    // the subject is free: signing in with it now asks for a name
    const g = guestCtx(s, 'conn-g', 'gs_g');
    const f = await begin(s, g, 'signIn');
    expect(value(await confirm(s, g, null, f.flow, (await callback(s, f, ALICE)).code)).kind).toBe('needsName');
  });

  it('unlink with a reauth ticket instead of the password', async () => {
    const s = setupShopify();
    const alice = await registerLocal(s, 'Alice');
    const ctx = accountCtx(s);
    const b = await begin(s, ctx, 'link', alice.auth, { password: PW });
    value(await confirm(s, ctx, alice.auth, b.flow, (await callback(s, b, ALICE)).code));
    const r = await begin(s, ctx, 'reauth', alice.auth);
    const out = value(await confirm(s, ctx, alice.auth, r.flow, (await callback(s, r, ALICE)).code));
    if (out.kind !== 'reauthed') throw new Error(out.kind);
    expect(value(inRow('unlinkProvider', await s.service.unlinkProvider(ctx, alice.auth, 'shopify', { ticket: out.ticket }))).providers).toEqual(['local']);
  });
});

describe('M14-13: the identity is (issuer, subject), not the subject alone (OpenID Connect; review of M14-13, security 5)', () => {
  const ELSEWHERE = 'https://shopify.example/authentication/5555';

  it('a subject held under one issuer never signs in, registers or reauths under another; link keeps the issuer it was verified under', async () => {
    const s = setupShopify();
    const alice = await registerWithShopify(s, ALICE, 'Alice');
    expect((await s.store.credentials(alice.auth.account)).map((c) => c.meta)).toEqual([{ issuer: ISSUER }]);
    // the host now configures another issuer, whose customer ids are the same strings
    s.otherIssuer.current = ELSEWHERE;
    const g = guestCtx(s, 'conn-g', 'gs_g');
    const b = await begin(s, g, 'signIn');
    expect(code(await confirm(s, g, null, b.flow, (await callback(s, b, ALICE)).code))).toBe('providerFailed');
    // nothing issued, and the flow is void: no registration on it either
    expect((await s.store.sessionsOf(alice.auth.account)).length).toBe(1);
    expect(code(inRow('registerWithProvider', await s.service.registerWithProvider(g, b.flow, { name: 'Alicia', birth: BIRTH, claimGuest: false })))).toBe('providerFailed');
    // Alice's own session: the other issuer's subject gives no ticket
    const ctx = accountCtx(s, 'conn-Alice');
    const r = await begin(s, ctx, 'reauth', alice.auth);
    expect(code(await confirm(s, ctx, alice.auth, r.flow, (await callback(s, r, ALICE)).code))).toBe('providerFailed');
    // a link of a new subject under the other issuer keeps that issuer; the held subject string is not moved
    const bobby = await registerLocal(s, 'Bobby');
    const bctx = accountCtx(s, 'conn-Bobby');
    const l = await begin(s, bctx, 'link', bobby.auth, { password: PW });
    expect(code(await confirm(s, bctx, bobby.auth, l.flow, (await callback(s, l, ALICE)).code))).toBe('providerLinked');
    const l2 = await begin(s, bctx, 'link', bobby.auth, { password: PW });
    expect(value(await confirm(s, bctx, bobby.auth, l2.flow, (await callback(s, l2, OTHER)).code)).kind).toBe('linked');
    expect((await s.store.credentials(bobby.auth.account)).find((c) => c.provider === 'shopify')!.meta).toEqual({ issuer: ELSEWHERE });
    expect((await s.store.credentialBySubject('shopify', ALICE))!.account).toBe(alice.auth.account);
    // under the first issuer again, Alice signs in as before
    s.otherIssuer.current = null;
    const h = guestCtx(s, 'conn-h', 'gs_h');
    const c = await begin(s, h, 'signIn');
    expect(signedIn(value(await confirm(s, h, null, c.flow, (await callback(s, c, ALICE)).code))).auth.account).toBe(alice.auth.account);
  });

  it('a credential that names no issuer is no identity\'s: it never signs in', async () => {
    const s = setupShopify();
    const alice = await registerWithShopify(s, ALICE, 'Alice');
    const cred = (await s.store.credentials(alice.auth.account))[0]!;
    await s.store.putCredential({ ...cred, meta: {} }, cred.secret);
    const g = guestCtx(s, 'conn-g', 'gs_g');
    const b = await begin(s, g, 'signIn');
    expect(code(await confirm(s, g, null, b.flow, (await callback(s, b, ALICE)).code))).toBe('providerFailed');
  });
});

describe('M14-13: nothing secret in the logs or the audit log (12.1)', () => {
  it('no state, nonce, verifier, flow id, confirmation code, ticket, token, secret or subject in any log line or audit event', async () => {
    const s = setupShopify();
    const secrets: string[] = [CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN, ALICE];
    const keep = (b: { flow: string; authorizeUrl: string }) => {
      const q = new URL(b.authorizeUrl).searchParams;
      secrets.push(b.flow, q.get('state')!, q.get('nonce')!, q.get('code_challenge')!);
      return b;
    };
    const ctx = guestCtx(s);
    const b = keep(await begin(s, ctx, 'signIn'));
    const page = await callback(s, b, ALICE);
    secrets.push(page.code);
    expect(code(await confirm(s, ctx, null, b.flow, wrongCode(page.code)))).toBe('providerFailed');
    value(await confirm(s, ctx, null, b.flow, page.code));
    const reg = value(inRow('registerWithProvider', await s.service.registerWithProvider(ctx, b.flow, { name: 'Alice', birth: BIRTH, claimGuest: false })));
    secrets.push(reg.token, reg.device);
    const actx = accountCtx(s, 'conn-a');
    const r = keep(await begin(s, actx, 'reauth', reg.auth));
    const rp = await callback(s, r, ALICE);
    secrets.push(rp.code);
    const out = value(await confirm(s, actx, reg.auth, r.flow, rp.code));
    if (out.kind !== 'reauthed') throw new Error(out.kind);
    secrets.push(out.ticket);
    value(await s.service.newRecoveryCodes(actx, reg.auth, { ticket: out.ticket }));
    await s.service.tick(s.clock.now());
    const text = JSON.stringify([s.log, await s.store.audit({ limit: 1_000 })]);
    for (const x of secrets) expect(text, x.slice(0, 12)).not.toContain(x);
    expect(s.log.some((l) => l.name === 'accounts.provider.callback')).toBe(true);
  });
});
