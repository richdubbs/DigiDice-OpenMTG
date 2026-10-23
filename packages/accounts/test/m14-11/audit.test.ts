/**
 * M14-11: `accounts.purge_audit` and `accounts.erasure_claimed` (design 11.5, 13.2). The function enforces the retention policy itself, by the database's own
 * clock, and takes no time or kind: with no account it deletes no security event younger than 180 days and no operator event younger than 730 (never a
 * `deleted` event whose tombstone still exists, never a moderation event); with an account it does nothing unless that account's erasure has been claimed
 * and is due, and then removes only that account's security and moderation events but `deleted`, and takes its id off its operator events. A retention
 * configured longer is honoured; one shorter changes nothing. The store's erase refuses an account the database does not show as due, and its purge reports
 * what the function removed. Every event time here is relative to the real clock (PGlite's and a server's alike), run as the service's role.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_RETENTION, openPostgresAccountStore, type AccountId, type AccountStore, type AuditEvent } from '@openmtg/accounts';
import { accId, auditId, auditOf, claimErasure, DAY, newAccount, refused, T0, tombstoneOf } from '../m14-4/contract';
import { kits } from './harness';

const now = Date.now();
const ago = (days: number): string => new Date(now - days * DAY).toISOString();
const ahead = (days: number): string => new Date(now + days * DAY).toISOString();

const signedIn = { provider: 'local' as const, device: false, restricted: false };

for (const kit of kits()) {
  describe(`M14-11 purge_audit and erasure_claimed (${kit.name})`, { timeout: 60_000 }, () => {
    let store: AccountStore;
    beforeAll(() => kit.reset());
    afterAll(() => kit.end());
    beforeEach(async () => {
      await kit.reset();
      store = await openPostgresAccountStore(kit.service());
    });

    /** purge_audit as the service's role: the number of events it deleted or changed. */
    const purgeAudit = async (account: string | null = null, keepSecurityMs: number | null = null, keepOperatorMs: number | null = null): Promise<number> =>
      Number((await kit.service().query<{ n: unknown }>('SELECT accounts.purge_audit($1::text, $2::bigint, $3::bigint) AS n', [account, keepSecurityMs, keepOperatorMs])).rows[0]!.n);
    const ids = async (): Promise<string[]> => (await store.audit({ limit: 1_000 })).map((e) => e.id).sort();
    const idsOf = (...n: number[]): string[] => n.map(auditId).sort();
    const event = (n: number, kind: AuditEvent['kind'], account: AccountId | null, days: number, over: Partial<AuditEvent> = {}): AuditEvent =>
      auditOf(n, kind, account, (kind === 'signedIn' ? signedIn : kind === 'sanctioned' ? { sanction: 's', kind: 'warn', reason: 'chat', now: false } : kind === 'deleted' ? { holders: [] } : { what: 'show' }) as never, {
        at: ago(days), ...over,
      });
    /**
     * The erasure claim's three columns written by the owner: the service's role cannot write them (only the deletion functions of migration 001 do, under
     * their own checks: test/m14-11/deletion.test.ts), so a state the database would refuse a request for, such as a claim not yet due, is set up here.
     */
    const force = (account: AccountId, d: { requestedAt: string; purgeAt: string; erasingAt: string | null }): Promise<void> =>
      kit.admin(async (sql) => {
        await sql.query('UPDATE accounts.accounts SET deletion_requested_at = $2, purge_at = $3, erasing_at = $4 WHERE id = $1', [account, d.requestedAt, d.purgeAt, d.erasingAt]);
      });
    /** A live account with no registration event of its own to count (its events are the test's). */
    const live = async (n: number): Promise<void> => {
      await store.createAccount({ ...newAccount(n, `Live${n}`, `live${n}`), audit: [] }, T0);
    };

    it('with no account: deletes no security event younger than 180 days, and no operator event younger than 730 days; moderation events never', async () => {
      await live(1);
      await store.appendAudit([
        event(1, 'signedIn', accId(1), 100), event(2, 'signedIn', accId(1), 179), event(3, 'signedIn', accId(1), 181), event(4, 'signedIn', null, 400),
        event(5, 'sanctioned', accId(1), 100), event(6, 'sanctioned', accId(1), 3_000),
        event(7, 'adminViewed', accId(1), 400, { actor: 'admin:op', actorOs: 'root' }), event(8, 'adminViewed', accId(1), 729, { actor: 'admin:op', actorOs: 'root' }),
        event(9, 'adminViewed', accId(1), 731, { actor: 'admin:op', actorOs: 'root' }), event(10, 'adminViewed', null, 5_000, { actor: 'admin:op', actorOs: 'root' }),
      ]);
      expect(await purgeAudit()).toBe(4);
      expect(await ids()).toEqual(idsOf(1, 2, 5, 6, 7, 8));
      // run again: nothing more
      expect(await purgeAudit()).toBe(0);
      // nothing about the live account's other rows, or the account itself
      expect(await store.account(accId(1))).not.toBeNull();
    });

    it('never deletes a `deleted` event whose tombstone still exists; one without a tombstone goes at 180 days like any security event', async () => {
      await store.createAccount({ ...newAccount(1, 'Gone', 'gone'), audit: [] }, T0);
      await store.appendAudit([event(1, 'deleted', accId(1), 300, { actor: 'system' })]);
      await claimErasure(store, accId(1), ago(1));
      await store.erase(accId(1), tombstoneOf(accId(1), new Date(now).toISOString()), ahead(90));
      await store.appendAudit([event(2, 'deleted', accId(9), 300, { actor: 'system' }), event(3, 'deleted', accId(9), 100, { actor: 'system' })]);
      expect(await store.tombstone(accId(1))).not.toBeNull();
      expect(await purgeAudit()).toBe(1);
      expect(await ids()).toEqual(idsOf(1, 3));
      // the tombstone goes (its hold and sanction are over): then its event is as old as any
      await store.purge(DEFAULT_ACCOUNT_RETENTION, ahead(91));
      expect(await store.tombstone(accId(1))).toBeNull();
      expect(await ids()).toEqual(idsOf(3));
    });

    it('a retention configured longer is kept (keep_*_ms); one shorter, zero or negative changes nothing: the floors are the function\'s own', async () => {
      await store.appendAudit([
        event(1, 'signedIn', null, 100), event(2, 'signedIn', null, 190), event(3, 'signedIn', null, 250),
        event(4, 'adminViewed', null, 700, { actor: 'admin:op', actorOs: 'root' }), event(5, 'adminViewed', null, 750, { actor: 'admin:op', actorOs: 'root' }),
        event(6, 'adminViewed', null, 900, { actor: 'admin:op', actorOs: 'root' }),
      ]);
      // longer: security 200 days, operator 800 days
      expect(await purgeAudit(null, 200 * DAY, 800 * DAY)).toBe(2); // 3 and 6
      expect(await ids()).toEqual(idsOf(1, 2, 4, 5));
      // shorter than the floors, or silly: the floors apply (190 days and 750 days are old enough, 100 and 700 are not)
      expect(await purgeAudit(null, 1, 1)).toBe(2);
      expect(await ids()).toEqual(idsOf(1, 4));
      expect(await purgeAudit(null, 0, 0)).toBe(0);
      expect(await purgeAudit(null, -1, -DAY)).toBe(0);
      expect(await purgeAudit(null, null, null)).toBe(0);
      expect(await ids()).toEqual(idsOf(1, 4));
      // a retention far past any real event, or past the end of time: nothing deleted, and no error from the date arithmetic
      await store.appendAudit([event(7, 'signedIn', null, 1_000)]);
      expect(await purgeAudit(null, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(0);
      expect(await ids()).toEqual(idsOf(1, 4, 7));
      expect(await purgeAudit(null, 36_500 * DAY, 36_500 * DAY)).toBe(0);
    });

    describe('with an account', () => {
      /** An account with one event of each category, and another with the same, which no call about the first may touch. */
      async function setup(deletion: 'none' | 'requested' | 'claimedFuture' | 'claimed'): Promise<void> {
        await live(1);
        await live(2);
        const mine = (n: number, account: AccountId): AuditEvent[] => [
          event(n, 'signedIn', account, 10), event(n + 1, 'sanctioned', account, 10), event(n + 2, 'adminViewed', account, 10, { actor: 'admin:op', actorOs: 'root' }),
          event(n + 3, 'deleted', account, 10, { actor: 'system' }),
        ];
        await store.appendAudit([...mine(10, accId(1)), ...mine(20, accId(2))]);
        const d = (purgeAt: string, erasingAt: string | null) => ({ requestedAt: ago(8), purgeAt, erasingAt });
        if (deletion === 'requested') await force(accId(1), d(ago(1), null));
        else if (deletion === 'claimedFuture') await force(accId(1), d(ahead(3), ago(0)));
        else if (deletion === 'claimed') await force(accId(1), d(ago(1), ago(0)));
      }

      it('does nothing for an account that is live, one whose deletion is requested but not claimed, one claimed but not due by the database\'s clock, or no account at all', async () => {
        for (const state of ['none', 'requested', 'claimedFuture'] as const) {
          await kit.reset();
          await setup(state);
          const before = await ids();
          expect(await purgeAudit(accId(1)), state).toBe(0);
          expect(await ids(), state).toEqual(before);
        }
        expect(await purgeAudit(accId(77))).toBe(0);
        expect(await purgeAudit('')).toBe(0);
        expect(await ids()).toHaveLength(8);
      });

      it('for a claimed erasure that is due: deletes that account\'s security and moderation events but `deleted`, and takes its id off its operator events; nothing of anyone else\'s', async () => {
        await setup('claimed');
        expect(await purgeAudit(accId(1))).toBe(3); // signedIn and sanctioned deleted, adminViewed anonymised
        const all = await store.audit({ limit: 100 });
        expect(all.filter((e) => e.account === accId(1)).map((e) => e.kind)).toEqual(['deleted']);
        expect(all.find((e) => e.id === auditId(12))).toMatchObject({ kind: 'adminViewed', account: null, actor: 'admin:op', actorOs: 'root' });
        expect(all.filter((e) => e.account === accId(2)).map((e) => e.id).sort()).toEqual(idsOf(20, 21, 22, 23));
        expect(all).toHaveLength(6);
        // again: nothing more to do; and the other account is live, so a call about it does nothing
        expect(await purgeAudit(accId(1))).toBe(0);
        expect(await purgeAudit(accId(2))).toBe(0);
        expect(await ids()).toHaveLength(6);
      });

      it('with an account, the retention arguments change nothing: the claim decides', async () => {
        await setup('claimed');
        expect(await purgeAudit(accId(1), 1, 1)).toBe(3);
        await kit.reset();
        await setup('none');
        expect(await purgeAudit(accId(1), 1, 1)).toBe(0);
        expect(await ids()).toHaveLength(8);
      });
    });

    it('erasure_claimed: true only with purge_at at or before now and erasing_at set, by the database\'s clock', async () => {
      const claimed = async (id: string): Promise<boolean> => (await kit.service().query<{ ok: boolean }>('SELECT accounts.erasure_claimed($1::text) AS ok', [id])).rows[0]!.ok;
      for (const n of [1, 2, 3, 4]) await live(n);
      const d = (purgeAt: string, erasingAt: string | null) => ({ requestedAt: ago(8), purgeAt, erasingAt });
      for (const [n, deletion] of [[2, d(ago(1), null)], [3, d(ahead(1), ago(0))], [4, d(ago(1), ago(0))]] as const) await force(accId(n), deletion);
      expect([await claimed(accId(1)), await claimed(accId(2)), await claimed(accId(3)), await claimed(accId(4)), await claimed(accId(5))]).toEqual([false, false, false, true, false]);
    });

    describe('the store', () => {
      it('erase refuses an account the database does not show as claimed and due, and changes nothing; once it is due it erases and leaves the events as erase does', async () => {
        await live(1);
        await store.appendAudit([event(1, 'signedIn', accId(1), 10), event(2, 'sanctioned', accId(1), 10), event(3, 'adminViewed', accId(1), 10, { actor: 'admin:op', actorOs: 'root' })]);
        // claimed (erasingAt set) with purgeAt a day ahead: the service's clock may say due (tombstone a week on), the database's does not
        await force(accId(1), { requestedAt: ago(6), purgeAt: ahead(1), erasingAt: ago(0) });
        const before = await ids();
        await refused(store.erase(accId(1), tombstoneOf(accId(1), ahead(7)), ahead(97)), 'conflict');
        expect(await store.account(accId(1))).not.toBeNull();
        expect(await store.tombstone(accId(1))).toBeNull();
        expect(await ids()).toEqual(before);
        expect(await store.credentials(accId(1))).toHaveLength(1);
        // due by the database's clock now (purgeAt moved a day back): the erase goes through
        await force(accId(1), { requestedAt: ago(6), purgeAt: ago(1), erasingAt: ago(0) });
        await store.erase(accId(1), tombstoneOf(accId(1), new Date(now).toISOString()), ahead(90));
        expect(await store.account(accId(1))).toBeNull();
        expect((await store.audit({ limit: 100 })).map((e) => [e.id, e.account])).toEqual([[auditId(3), null]]);
      });

      it('purge reports what purge_audit removed, honours a retention configured longer, and ignores one shorter than the floors', async () => {
        const op = { actor: 'admin:op', actorOs: 'root' } as const;
        await store.appendAudit([
          event(1, 'signedIn', null, 100), event(2, 'signedIn', null, 190), event(3, 'signedIn', null, 250), event(4, 'sanctioned', null, 900),
          event(5, 'adminViewed', null, 740, op), event(6, 'adminViewed', null, 900, op), event(7, 'adminViewed', null, 1_100, op),
        ]);
        const at = new Date(now).toISOString();
        // operator events kept 800 days: 6 and 7 go, 5 stays; the security events go at the floor, 180 days: 2 and 3
        const longer = { ...DEFAULT_ACCOUNT_RETENTION, operatorAuditMs: 800 * DAY };
        expect((await store.purge(longer, at)).audit).toBe(4);
        expect(await ids()).toEqual(idsOf(1, 4, 5));
        // a retention of one day is below the floors: it is the floors that apply (5 is 740 days old: it goes, 1 and 4 stay)
        const shorter = { ...DEFAULT_ACCOUNT_RETENTION, securityAuditMs: DAY, operatorAuditMs: DAY };
        expect((await store.purge(shorter, at)).audit).toBe(1);
        expect(await ids()).toEqual(idsOf(1, 4));
        expect((await store.purge(DEFAULT_ACCOUNT_RETENTION, at)).audit).toBe(0);
      });

      it('the service\'s role cannot make it delete anything younger, by any argument it can give the function or the store', async () => {
        await store.appendAudit([
          event(1, 'signedIn', null, 1), event(2, 'signedIn', null, 179), event(3, 'adminViewed', null, 1, { actor: 'admin:op', actorOs: 'root' }),
          event(4, 'adminViewed', null, 729, { actor: 'admin:op', actorOs: 'root' }), event(5, 'sanctioned', null, 1),
        ]);
        for (const args of [[null, 0, 0], [null, -1, -1], [null, 1, 1], ['', 0, 0], ['x', 0, 0], [accId(1), 0, 0], [null, null, null]] as const) {
          expect(await purgeAudit(args[0], args[1], args[2]), JSON.stringify(args)).toBe(0);
        }
        // purge's `now` ages everything but the audit log: that is counted by the database's clock, whatever time the store is told
        const policy = { ...DEFAULT_ACCOUNT_RETENTION, securityAuditMs: 0, operatorAuditMs: 0 };
        expect((await store.purge(policy, new Date(now + 1_000 * DAY).toISOString())).audit).toBe(0);
        expect(await ids()).toEqual(idsOf(1, 2, 3, 4, 5));
      });
    });
  });
}
