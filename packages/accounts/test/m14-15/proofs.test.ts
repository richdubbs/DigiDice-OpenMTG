/**
 * M14-15, security review pass A, finding A3: an appeal and a guest claim cannot be undone (one appeal per sanction, 20 claims per account), so
 * each takes a proof in the same request (5.2: the password or a reauth ticket), like every other change a stolen token could make for good. In
 * process, the real moderation part, a fake clock and fixed inputs (owner rule).
 *
 * - The thief resumes the owner's token from its own connection and address key: without a proof its appeal and its claim answer
 *   reauthRequired, with a wrong password badCredentials; the owner's appeal and claim then still go through with the password.
 * - A banned owner (a restricted session) appeals with the password, or with a reauth ticket of the session.
 * - notFound and conflict answer before the proof, so a refused appeal costs none; five wrong proofs end the thief's session.
 */
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '@openmtg/accounts';
import type { CoreGuard } from '../../src/service/guard';
import { addressFor, code, ctxOf, inRow, OP, PW, PW2, registerAs, setup, value } from '../m14-6/support';

describe('M14-15 A3: a stolen token alone cannot appeal or claim (5.2)', () => {
  it('the thief\'s appeal and claim need the proof it lacks; the owner\'s still go through', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const own = ctxOf(s.clock, { connection: 'conn-alice', guestSession: null, addressKey: addressFor('alice') });
    const thiefCtx = ctxOf(s.clock, { connection: 'conn-thief', guestSession: null, addressKey: addressFor('thief') });
    const thief = value(await s.service.resume(thiefCtx, alice.token)).auth;
    const warning = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: 'Mind your words.' });

    // the appeal: no proof, a wrong password
    expect(code(inRow('appeal', await s.service.appeal(thiefCtx, thief, warning.id, 'Not me.', undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('appeal', await s.service.appeal(thiefCtx, thief, warning.id, 'Not me.', { password: PW2 })))).toBe('badCredentials');
    // a guest session the thief controls: no proof, a wrong password
    s.guests.add('e'.repeat(64), 'gs_thief');
    expect(code(inRow('claimGuest', await s.service.claimGuest(thiefCtx, thief, 'e'.repeat(64), undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('claimGuest', await s.service.claimGuest(thiefCtx, thief, 'e'.repeat(64), { password: PW2 })))).toBe('badCredentials');
    expect(await s.store.claimsOf(alice.auth.account)).toEqual([]);
    expect(s.guests.retired).toEqual([]);

    // the owner's own appeal and claim
    value(inRow('appeal', await s.service.appeal(own, alice.auth, warning.id, 'I was quoting someone.', { password: PW })));
    s.guests.add('a'.repeat(64), 'gs_alice');
    expect(value(inRow('claimGuest', await s.service.claimGuest(own, alice.auth, 'a'.repeat(64), { password: PW })))).toEqual({ session: 'gs_alice' });
    expect((await s.store.claimsOf(alice.auth.account)).map((c) => c.session)).toEqual(['gs_alice']);
    expect(ACCOUNT_LIMITS.claimsMax).toBe(20);
  });

  it('notFound and conflict before the proof; five wrong proofs end the session that guesses', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bobby');
    const ctx = ctxOf(s.clock, { connection: 'conn-alice', guestSession: null, addressKey: addressFor('alice') });
    const w = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'warn', reason: 'chat', until: null, message: 'Careful.' });
    // another account's sanction, and no sanction at all: notFound without a proof
    expect(code(inRow('appeal', await s.service.appeal(ctxOf(s.clock), bob.auth, w.id, 'Mine?', undefined as never)))).toBe('notFound');
    value(await s.service.appeal(ctx, alice.auth, w.id, 'Please.', { password: PW }));
    // appealed already: conflict without a proof
    expect(code(inRow('appeal', await s.service.appeal(ctx, alice.auth, w.id, 'Again.', undefined as never)))).toBe('conflict');
    // a claim's wrong proofs count on the session like every other proof
    s.guests.add('c'.repeat(64), 'gs_c');
    for (let i = 0; i < 4; i++) {
      expect(code(inRow('claimGuest', await s.service.claimGuest(ctx, alice.auth, 'c'.repeat(64), { password: PW2 })))).toBe('badCredentials');
    }
    expect(code(await s.service.claimGuest(ctx, alice.auth, 'c'.repeat(64), { password: PW2 }))).toBe('badCredentials');
    expect(code(inRow('claimGuest', await s.service.claimGuest(ctx, alice.auth, 'c'.repeat(64), { password: PW })))).toBe('sessionRevoked');
    // audited with their actions: the appeal's proof passed, the claim's five failed
    await s.service.tick(s.clock.now());
    const proofs = (await s.store.audit({ account: alice.auth.account, limit: 100 })).filter((e) => e.kind === 'reauthFailed' || e.kind === 'reauthed');
    const tally = (kind: string, action: string) => proofs.filter((e) => e.kind === kind && (e.details as { action: string }).action === action).length;
    expect([tally('reauthed', 'appeal'), tally('reauthFailed', 'claim'), proofs.length]).toEqual([1, 5, 6]);
  });

  it('a banned owner appeals from the restricted session with the password, or with a reauth ticket of that session', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const ban = await s.service.admin.sanction(OP, alice.auth.account, { kind: 'ban', reason: 'cheating', until: null, message: 'Banned.' });
    const ctx = ctxOf(s.clock, { connection: 'conn-alice', guestSession: null, addressKey: addressFor('alice') });
    // a ban revokes every session: the owner signs in again, to a restricted one
    const restricted = value(await s.service.signIn(ctx, { name: 'Alice', password: PW }));
    expect(restricted.account.restricted).toBe(true);
    expect(code(inRow('appeal', await s.service.appeal(ctx, restricted.auth, ban.id, 'I did not.', undefined as never)))).toBe('reauthRequired');
    const guard = s.partDeps.current!.guard as CoreGuard;
    const ticket = guard.issueTicket(restricted.auth, s.clock.now());
    value(inRow('appeal', await s.service.appeal(ctx, restricted.auth, ban.id, 'I did not cheat.', { ticket })));
    expect((await s.store.appeals({ account: alice.auth.account, limit: 10 })).map((a) => a.sanction)).toEqual([ban.id]);
  });
});
