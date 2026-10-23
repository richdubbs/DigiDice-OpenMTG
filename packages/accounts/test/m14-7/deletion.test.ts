/**
 * M14-7: deletion's request, grace and cancel (design 10.2 steps 1-3; 13.2): the proof, the 7-day grace, every other session revoked and this one
 * restricted, the changes and the notice, the account hidden meanwhile; the cancel from another device (a running suspension still running); the
 * cancel refused at and after purgeAt; and **cancel racing tick, in both orders**, as fixed interleavings of the two account writes on the
 * in-process store: either cancelled with no holder called, or claimed and erased with the cancel refused. From the review of M14-7: a revocation
 * that fails leaves no deletion (the request works when made again); a step after the deletion is set that fails never fails the request.
 */
import { describe, expect, it } from 'vitest';
import type { AccountStore } from '@openmtg/accounts';
import { tokenHash } from '../../src/ids';
import {
  code, ctxOf, DAY, FakeHolder, inRow, PW, registerAs, rightsSetup, sanctionOn, setEmail, T0, value,
} from './support';

/**
 * Holds the first two account writes that touch `deletion` until both are waiting (so both read the same version), then lets them through one
 * after the other in the order `first` names: the claim (a deletion with erasingAt set) or the cancel (deletion null). The second one then
 * conflicts, and its patch reads the row again.
 */
function interleave(store: AccountStore, first: 'cancel' | 'claim'): { held: { claim: boolean }[] } {
  const update = store.updateAccount.bind(store);
  const held: { claim: boolean; go: () => Promise<void> }[] = [];
  let armed = true;
  store.updateAccount = (id, version, patch) => {
    if (!armed || !('deletion' in patch)) return update(id, version, patch);
    return new Promise((resolve, reject) => {
      held.push({ claim: patch.deletion !== null && patch.deletion !== undefined, go: () => update(id, version, patch).then(resolve, reject) });
      if (held.length < 2) return;
      armed = false;
      const [a, b] = held[0]!.claim === (first === 'claim') ? [held[0]!, held[1]!] : [held[1]!, held[0]!];
      void a.go().then(() => b.go());
    });
  };
  return { held };
}

describe('M14-7: the deletion request (10.2 step 1)', () => {
  it('needs the proof; then the 7-day grace, every other session revoked, this one restricted, the changes, the notice, device proofs kept', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    await setEmail(s, A, 'alice@example.com');
    const phone = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.10', connection: 'phone' }), { name: 'Alice', password: PW }));
    expect(code(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: 'not the password' })))).toBe('badCredentials');
    const head = await s.service.changesHead();

    const del = value(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW })));
    expect(del.purgeAt).toBe(new Date(T0 + 7 * DAY).toISOString());
    expect((await s.store.account(A))!.deletion).toEqual({ requestedAt: new Date(T0).toISOString(), purgeAt: del.purgeAt, erasingAt: null, done: [] });
    // this session is restricted; the other one is revoked; its device proof stays (the owner may sign in from it to cancel)
    expect(value(await s.service.self(ctxOf(s.clock), alice.auth))).toMatchObject({
      status: 'deleting', restricted: true, deletion: { purgeAt: del.purgeAt, cancellable: true },
    });
    expect(code(inRow('setAvatar', await s.service.setAvatar(ctxOf(s.clock), alice.auth, 'd6-amber')))).toBe('deletionPending');
    expect(code(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW })))).toBe('deletionPending');
    expect(code(await s.service.self(ctxOf(s.clock), phone.auth))).toBe('sessionRevoked');
    expect(await s.store.device(tokenHash(phone.device))).not.toBeNull();
    expect((await s.service.changes(head, 100)).map((c) => [c.kind, c.detail ?? null])).toEqual([
      ['sessionsRevoked', { except: alice.auth.session }],
      ['deleting', null],
    ]);
    expect(s.notices).toEqual([{ account: A, kind: 'deletionRequested' }]);
    // hidden: no profile, no name, no history for others
    expect(code(await s.service.profile(ctxOf(s.clock), { account: A }))).toBe('notFound');
    expect((await s.service.directory.names([A])).size).toBe(0);
    expect((await s.service.directory.standing(A))!.status).toBe('deleting');
    // audited without the password
    await s.service.tick(s.clock.now());
    const events = await s.store.audit({ account: A, kinds: ['deletionRequested', 'sessionsRevoked'], limit: 10 });
    expect(events.map((e) => [e.kind, e.actor, e.details]).sort()).toEqual([
      ['deletionRequested', 'self', { purgeAt: del.purgeAt }],
      ['sessionsRevoked', 'self', { reason: 'deletion', count: 1 }],
    ]);
    expect(JSON.stringify(events)).not.toContain(PW);
  });

  it('a revocation that fails leaves no deletion behind, so the request made again works (contract 6)', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    await setEmail(s, A, 'alice@example.com');
    const phone = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.10', connection: 'phone' }), { name: 'Alice', password: PW }));
    const revoke = s.store.revokeSessions.bind(s.store);
    let failOnce = true;
    s.store.revokeSessions = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('the disk is full');
      }
      return revoke(...args);
    };
    const head = await s.service.changesHead();
    expect(code(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW })))).toBe('unavailable');
    expect((await s.store.account(A))!.deletion).toBeNull();
    expect(value(await s.service.self(ctxOf(s.clock), phone.auth)).status).toBe('active');
    expect(await s.service.changes(head, 10)).toEqual([]);
    expect(s.notices).toEqual([]);

    const del = value(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW })));
    expect((await s.store.account(A))!.deletion).toMatchObject({ purgeAt: del.purgeAt, erasingAt: null });
    expect(code(await s.service.self(ctxOf(s.clock), phone.auth))).toBe('sessionRevoked');
    expect((await s.service.changes(head, 10)).map((c) => c.kind)).toEqual(['sessionsRevoked', 'deleting']);
    expect(s.notices).toEqual([{ account: A, kind: 'deletionRequested' }]);
    await s.partDeps.current!.audit.flush();
    expect((await s.store.audit({ account: A, kinds: ['deletionRequested', 'sessionsRevoked'], limit: 10 })).map((e) => e.kind).sort()).toEqual([
      'deletionRequested', 'sessionsRevoked',
    ]);
  });

  it('a step after the deletion is set that fails is logged and passed over; the request answers ok (contract 6)', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    await setEmail(s, A, 'alice@example.com');
    value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.10', connection: 'phone' }), { name: 'Alice', password: PW }));
    const appendChange = s.store.appendChange.bind(s.store);
    s.store.appendChange = async (c) => {
      if (c.kind === 'deleting' || c.kind === 'sessionsRevoked') throw new Error('the feed is down');
      return appendChange(c);
    };
    const del = value(inRow('deleteAccount', await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW })));
    expect((await s.store.account(A))!.deletion).toMatchObject({ purgeAt: del.purgeAt });
    expect(s.notices).toEqual([{ account: A, kind: 'deletionRequested' }]);
    expect(s.log.filter((l) => l.name === 'accounts.deletion.step').map((l) => l.fields)).toEqual([
      { step: 'sessionsRevoked', error: 'Error' },
      { step: 'deleting', error: 'Error' },
    ]);
    await s.partDeps.current!.audit.flush();
    expect((await s.store.audit({ account: A, kinds: ['deletionRequested'], limit: 10 })).map((e) => e.actor)).toEqual(['self']);
  });

  it('the grace: tick before purgeAt erases nothing; at purgeAt it does', async () => {
    const s = rightsSetup();
    const holder = new FakeHolder('hosted');
    s.service.addHolder(holder);
    const alice = await registerAs(s, 'Alice');
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    for (const ms of [DAY, 6 * DAY, 7 * DAY - 1]) {
      expect((await s.service.tick(new Date(T0 + ms))).erased, `${ms}`).toBe(0);
      expect(await s.store.account(alice.auth.account)).not.toBeNull();
    }
    expect(holder.erases).toHaveLength(0);
    expect((await s.service.tick(new Date(del.purgeAt))).erased).toBe(1);
    expect(await s.store.account(alice.auth.account)).toBeNull();
  });
});

describe('M14-7: the cancel (10.2 step 2)', () => {
  it('from another device after a sign-in during the grace: the deletion is gone, a running suspension runs again, a standing change', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    await sanctionOn(s, A, 1, 'suspend', 30 * DAY);
    value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    s.clock.advance(3 * DAY);
    const other = value(await s.service.signIn(ctxOf(s.clock, { connection: 'device-b', addressKey: '192.0.2.70' }), { name: 'Alice', password: PW }));
    expect(other.account).toMatchObject({ status: 'deleting', restricted: true });
    const head = await s.service.changesHead();
    const view = value(inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock), other.auth)));
    expect([view.status, view.deletion, view.restricted]).toEqual(['suspended', null, true]);
    expect((await s.store.account(A))!.deletion).toBeNull();
    expect((await s.service.changes(head, 10)).map((c) => c.kind)).toEqual(['standing']);
    // nothing is left to cancel, and nothing is erased at the old purgeAt
    expect(code(inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock), other.auth)))).toBe('suspended');
    expect((await s.service.tick(new Date(T0 + 8 * DAY))).erased).toBe(0);
    expect(await s.store.account(A)).not.toBeNull();
    const events = await s.store.audit({ account: A, kinds: ['deletionCancelled'], limit: 10 });
    expect(events.map((e) => [e.actor, e.session])).toEqual([['self', other.auth.session]]);
  });

  it('an active account has nothing to cancel: notAllowed', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    expect(code(inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock), alice.auth)))).toBe('notAllowed');
  });

  it('is refused at purgeAt and after it, even before tick has claimed the erasure; tick then erases', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    const at = Date.parse(del.purgeAt);
    expect(value(await s.service.self(ctxOf(s.clock, { now: new Date(at - 1) }), alice.auth)).deletion).toEqual({ purgeAt: del.purgeAt, cancellable: true });
    for (const t of [at, at + 60_000]) {
      const r = inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock, { now: new Date(t) }), alice.auth));
      expect(code(r)).toBe('notAllowed');
      expect((await s.store.account(alice.auth.account))!.deletion!.erasingAt).toBeNull();
    }
    expect(value(await s.service.self(ctxOf(s.clock, { now: new Date(at) }), alice.auth)).deletion).toEqual({ purgeAt: del.purgeAt, cancellable: false });
    expect((await s.service.tick(new Date(at + 60_000))).erased).toBe(1);
  });

  it('is refused once tick has claimed the erasure, while a holder still answers pending', async () => {
    const s = rightsSetup();
    const holder = new FakeHolder('hosted', ['pending']);
    s.service.addHolder(holder);
    const alice = await registerAs(s, 'Alice');
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    const at = Date.parse(del.purgeAt);
    expect(await s.service.tick(new Date(at))).toMatchObject({ erased: 0, erasureRetries: 1 });
    expect((await s.store.account(alice.auth.account))!.deletion!.erasingAt).toBe(new Date(at).toISOString());
    // even a request stamped before purgeAt (a slow connection) cannot take it back now
    expect(code(inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock, { now: new Date(at - 1) }), alice.auth)))).toBe('notAllowed');
    expect((await s.service.tick(new Date(at + 60_000))).erased).toBe(1);
  });

  for (const first of ['cancel', 'claim'] as const) {
    it(`cancel racing tick, the ${first} first: ${first === 'cancel' ? 'cancelled, and no holder called' : 'claimed and erased, and the cancel refused'}`, async () => {
      const s = rightsSetup();
      const holder = new FakeHolder('hosted');
      s.service.addHolder(holder);
      const alice = await registerAs(s, 'Alice');
      const A = alice.auth.account;
      const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
      const at = Date.parse(del.purgeAt);
      // the holder waits until the cancel has answered, so the erasure cannot overtake the cancel's second read
      const open = holder.hold();
      const race = interleave(s.store, first);
      const ticking = s.service.tick(new Date(at));
      const cancel = inRow('cancelDeletion', await s.service.cancelDeletion(ctxOf(s.clock, { now: new Date(at - 1) }), alice.auth));
      open();
      const tick = await ticking;
      // both writes read the same version before either was written: a real race, settled by the version check
      expect(race.held.map((h) => h.claim).sort()).toEqual([false, true]);
      if (first === 'cancel') {
        expect(value(cancel).deletion).toBeNull();
        expect(tick.erased).toBe(0);
        expect(holder.erases).toHaveLength(0);
        expect((await s.store.account(A))!.deletion).toBeNull();
        // and it stays cancelled
        expect((await s.service.tick(new Date(at + DAY))).erased).toBe(0);
        expect(holder.erases).toHaveLength(0);
      } else {
        expect(code(cancel)).toBe('notAllowed');
        expect(tick.erased).toBe(1);
        expect(holder.erases).toHaveLength(1);
        expect(await s.store.account(A)).toBeNull();
        expect(await s.store.tombstone(A)).not.toBeNull();
      }
    });
  }
});
