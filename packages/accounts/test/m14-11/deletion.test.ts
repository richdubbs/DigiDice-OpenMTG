/**
 * M14-11 (review): the erasure claim cannot be forged by the service's role (design 11.5, threat model: the service's credentials cannot wipe the log).
 * `purge_audit(account)` does something only for an account whose purge_at has come and whose erasing_at is set (`erasure_claimed`); the service has no
 * INSERT or UPDATE on those columns (nor on deletion_requested_at) and writes them only through four SECURITY DEFINER functions that check each step by the
 * database's clock against the owner's deletion_policy (an hour's grace, a request made within five minutes of the database's time). A claim is never taken
 * back, so wiping an account's events means erasing that account for good, and every such purge is written to the insert-only purge_ledger.
 * These tests run with the migration's own policy (the other files relax it): the reviewed forgery, each function's guards, the store's mapping of them, and the ledger.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openPostgresAccountStore, type AccountId, type AccountStore, type AuditEvent } from '@openmtg/accounts';
import { accId, auditId, auditOf, DAY, HOUR, MINUTE, newAccount, refused, T0, tombstoneOf } from '../m14-4/contract';
import { attempt, DEFAULT_POLICY, kits, RELAXED_POLICY, setPolicy, SERVICE_ROLE, sqlState } from './harness';

const at = (ms: number): string => new Date(Date.now() + ms).toISOString();

for (const kit of kits()) {
  describe(`M14-11 the erasure claim (${kit.name})`, { timeout: 60_000 }, () => {
    let store: AccountStore;
    beforeAll(async () => {
      await kit.reset();
      await kit.admin((sql) => setPolicy(sql, DEFAULT_POLICY));
    });
    afterAll(() => kit.end());
    beforeEach(async () => {
      await kit.reset();
      await kit.admin((sql) => setPolicy(sql, DEFAULT_POLICY));
      store = await openPostgresAccountStore(kit.service());
    });

    const fn = (text: string, ...params: unknown[]): Promise<unknown> => kit.service().query(text, params);
    const request = (account: string, requestedAt: string, purgeAt: string): Promise<unknown> =>
      fn('SELECT accounts.request_deletion($1::text, $2::timestamptz, $3::timestamptz)', account, requestedAt, purgeAt);
    const move = (account: string, purgeAt: string): Promise<unknown> => fn('SELECT accounts.move_deletion($1::text, $2::timestamptz)', account, purgeAt);
    const cancel = (account: string): Promise<unknown> => fn('SELECT accounts.cancel_deletion($1::text)', account);
    const claim = (account: string, when: string): Promise<unknown> => fn('SELECT accounts.claim_erasure($1::text, $2::timestamptz)', account, when);
    const purgeAudit = async (account: string): Promise<number> => Number(((await fn('SELECT accounts.purge_audit($1::text) AS n', account)) as { rows: { n: unknown }[] }).rows[0]!.n);
    const live = (n: number): Promise<void> => store.createAccount({ ...newAccount(n, `Live${n}`, `live${n}`), audit: [] }, T0);
    const events = async (): Promise<string[]> => (await store.audit({ limit: 100 })).map((e) => e.id).sort();
    const ledger = async (): Promise<{ account_id: string; removed: number; anonymised: number; called_by: string }[]> =>
      kit.admin(async (sql) => (await sql.query<{ account_id: string; removed: number; anonymised: number; called_by: string }>('SELECT account_id, removed::int AS removed, anonymised::int AS anonymised, called_by FROM accounts.purge_ledger ORDER BY id')).rows);
    const op = { actor: 'admin:op', actorOs: 'root' } as const;
    /** One event of each category for an account (ids from n). */
    const eventsOf = (n: number, account: AccountId): AuditEvent[] => [
      auditOf(n, 'passwordChanged', account, { via: 'password' }), auditOf(n + 1, 'sanctioned', account, { sanction: 's', kind: 'warn', reason: 'chat', now: false }),
      auditOf(n + 2, 'adminViewed', account, { what: 'show' }, op), auditOf(n + 3, 'deleted', account, { holders: [] }, { actor: 'system' }),
    ];
    /** Time passing: the account's request and purge moved back by `ms`, as the owner could. */
    const age = (account: string, ms: number): Promise<void> =>
      kit.admin(async (sql) => {
        await sql.query(
          `UPDATE accounts.accounts SET deletion_requested_at = deletion_requested_at - $2 * interval '1 millisecond', purge_at = purge_at - $2 * interval '1 millisecond',
             erasing_at = erasing_at - $2 * interval '1 millisecond' WHERE id = $1`,
          [account, ms],
        );
      });

    it('the forgery of the review fails: the service cannot set purge_at and erasing_at on a live account, so purge_audit does nothing for it and the log stays whole', async () => {
      await live(1);
      await live(2);
      await store.appendAudit([...eventsOf(10, accId(1)), ...eventsOf(20, accId(2))]);
      const before = await events();
      for (const s of [
        `UPDATE accounts.accounts SET purge_at = now() - interval '1 day', erasing_at = now() WHERE id = '${accId(1)}'`,
        `UPDATE accounts.accounts SET deletion_requested_at = now() - interval '9 days', purge_at = now() - interval '1 day', erasing_at = now() WHERE id = '${accId(1)}'`,
        `UPDATE accounts.accounts SET erasing_at = now() WHERE id = '${accId(1)}'`,
        `UPDATE accounts.accounts SET purge_at = now() - interval '1 day' WHERE id = '${accId(1)}'`,
      ]) {
        expect(await attempt(kit, SERVICE_ROLE, s), s).toMatch(/permission denied for table accounts/);
      }
      expect(await purgeAudit(accId(1))).toBe(0);
      expect(await purgeAudit(accId(2))).toBe(0);
      expect(await events()).toEqual(before);
      expect(await ledger()).toEqual([]);
      expect((await store.account(accId(1)))!.deletion).toBeNull();
    });

    describe('the functions, as the service calls them', () => {
      it('request_deletion: made at the database\'s time (five minutes either way), falling due no sooner than an hour after, on an account with none pending', async () => {
        await live(1);
        const id = accId(1);
        expect(await sqlState(request(id, at(0), at(59 * MINUTE)))).toBe('OM409');
        expect(await sqlState(request(id, at(0), at(0)))).toBe('OM409');
        expect(await sqlState(request(id, at(-6 * MINUTE), at(7 * DAY)))).toBe('OM409');
        expect(await sqlState(request(id, at(6 * MINUTE), at(7 * DAY)))).toBe('OM409');
        expect(await sqlState(request(id, at(-30 * DAY), at(-23 * DAY)))).toBe('OM409');
        expect((await store.account(id))!.deletion).toBeNull();
        expect(await sqlState(request('acc_nobody', at(0), at(7 * DAY)))).toBe('OM404');
        expect(await sqlState(request(id, at(-4 * MINUTE), at(-4 * MINUTE + HOUR + 1_000)))).toBe('ok');
        expect(await sqlState(request(id, at(0), at(7 * DAY)))).toBe('OM409'); // one is pending
        expect((await store.account(id))!.deletion).toMatchObject({ erasingAt: null, done: [] });
      });

      it('move_deletion: only a pending, unclaimed deletion, and never to a time sooner than the grace after the request', async () => {
        await live(1);
        const id = accId(1);
        expect(await sqlState(move(id, at(2 * HOUR)))).toBe('OM409'); // none pending
        await request(id, at(0), at(7 * DAY));
        const requested = Date.parse((await store.account(id))!.deletion!.requestedAt);
        const asked = (ms: number) => new Date(requested + ms).toISOString();
        expect(await sqlState(move(id, asked(HOUR - 1)))).toBe('OM409');
        expect(await sqlState(move(id, asked(-DAY)))).toBe('OM409');
        expect(await sqlState(move('acc_nobody', asked(2 * HOUR)))).toBe('OM404');
        expect(await sqlState(move(id, asked(2 * HOUR)))).toBe('ok');
        expect((await store.account(id))!.deletion!.purgeAt).toBe(asked(2 * HOUR));
        // claimed: no longer movable
        await age(id, 3 * HOUR);
        await claim(id, at(0));
        expect(await sqlState(move(id, asked(5 * HOUR)))).toBe('OM409');
      });

      it('cancel_deletion: only before purge_at and while unclaimed', async () => {
        await live(1);
        const id = accId(1);
        expect(await sqlState(cancel(id))).toBe('OM409');
        expect(await sqlState(cancel('acc_nobody'))).toBe('OM404');
        await request(id, at(0), at(2 * HOUR));
        expect(await sqlState(cancel(id))).toBe('ok');
        expect((await store.account(id))!.deletion).toBeNull();
        await request(id, at(0), at(2 * HOUR));
        await age(id, 3 * HOUR); // due
        expect(await sqlState(cancel(id))).toBe('OM409');
        await claim(id, at(0));
        expect(await sqlState(cancel(id))).toBe('OM409');
        expect((await store.account(id))!.deletion).toMatchObject({ erasingAt: expect.any(String) });
      });

      it('claim_erasure: only once purge_at has come by the database\'s clock, once per lease (a minute), at a time not before purge_at and not past the database\'s by five minutes', async () => {
        await live(1);
        const id = accId(1);
        expect(await sqlState(claim(id, at(0)))).toBe('OM409'); // none pending
        await request(id, at(0), at(2 * HOUR));
        expect(await sqlState(claim(id, at(0)))).toBe('OM409'); // not due
        expect(await sqlState(claim(id, at(3 * HOUR)))).toBe('OM409');
        await age(id, 3 * HOUR);
        const purgeAt = Date.parse((await store.account(id))!.deletion!.purgeAt);
        expect(await sqlState(claim(id, new Date(purgeAt - 1).toISOString()))).toBe('OM409'); // before purge_at
        expect(await sqlState(claim(id, at(6 * MINUTE)))).toBe('OM409'); // past the database's time
        expect(await sqlState(claim('acc_nobody', at(0)))).toBe('OM404');
        expect(await sqlState(claim(id, at(0)))).toBe('ok');
        expect(await sqlState(claim(id, at(0)))).toBe('OM409'); // within the lease
        await age(id, 2 * MINUTE);
        expect(await sqlState(claim(id, at(0)))).toBe('ok'); // the lease ran out: claimed again
      });
    });

    it('a claim is never taken back, and a purge of an account leaves its mark: the account\'s events go, the ledger says who asked, and the row cannot be restored', async () => {
      await live(1);
      await live(2);
      await store.appendAudit([...eventsOf(10, accId(1)), ...eventsOf(20, accId(2))]);
      // the owner has lowered the floor (a break-glass deletion, grace 0): the service can then make one due at once, and claim it
      await kit.admin((sql) => setPolicy(sql, RELAXED_POLICY));
      await request(accId(1), at(-MINUTE), at(-MINUTE));
      await claim(accId(1), at(0));
      expect(await purgeAudit(accId(1))).toBe(3);
      expect(await events()).toEqual([auditId(12), auditId(13), auditId(20), auditId(21), auditId(22), auditId(23)]);
      expect((await store.audit({ account: accId(1), limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
      // the mark: one row, the account, what was removed and changed, the login role
      const rows = await ledger();
      const login = (await kit.admin(async (sql) => (await sql.query<{ u: string }>('SELECT session_user::text AS u')).rows[0]!.u));
      expect(rows).toEqual([{ account_id: accId(1), removed: 2, anonymised: 1, called_by: login }]);
      // the restore of the review: the claim cannot be undone by the service, by a function or by a statement
      expect(await sqlState(cancel(accId(1)))).toBe('OM409');
      expect(await attempt(kit, SERVICE_ROLE, `UPDATE accounts.accounts SET purge_at = NULL, erasing_at = NULL, deletion_requested_at = NULL WHERE id = '${accId(1)}'`)).toMatch(/permission denied/);
      await refused(store.updateAccount(accId(1), (await store.account(accId(1)))!.version, { deletion: null }), 'conflict');
      expect((await store.account(accId(1)))!.deletion).toMatchObject({ erasingAt: expect.any(String) });
      // and the ledger is the owner's: the service reads it and cannot change a row
      expect(((await fn('SELECT count(*)::int AS n FROM accounts.purge_ledger')) as { rows: { n: number }[] }).rows[0]!.n).toBe(1);
      for (const s of [`UPDATE accounts.purge_ledger SET removed = 0`, `DELETE FROM accounts.purge_ledger`, `INSERT INTO accounts.purge_ledger (account_id, removed, anonymised, called_by) VALUES ('x', 0, 0, 'x')`]) {
        expect(await attempt(kit, SERVICE_ROLE, s), s).toMatch(/permission denied/);
      }
    });

    it('a purge that does nothing (no claim, not due) writes no ledger row; every erase writes one', async () => {
      await live(1);
      await store.appendAudit(eventsOf(10, accId(1)));
      expect(await purgeAudit(accId(1))).toBe(0);
      expect(await ledger()).toEqual([]);
      await request(accId(1), at(0), at(2 * HOUR));
      expect(await purgeAudit(accId(1))).toBe(0);
      expect(await ledger()).toEqual([]);
      await age(accId(1), 3 * HOUR);
      expect(await purgeAudit(accId(1))).toBe(0); // due, not claimed
      expect(await ledger()).toEqual([]);
      const a = (await store.account(accId(1)))!;
      await store.updateAccount(a.id, a.version, { deletion: { ...a.deletion!, erasingAt: at(0) } });
      await store.erase(accId(1), tombstoneOf(accId(1), at(0)), at(90 * DAY));
      expect(await store.account(accId(1))).toBeNull();
      expect((await ledger()).map((r) => [r.account_id, r.removed, r.anonymised])).toEqual([[accId(1), 2, 1]]);
    });

    it('purge_audit with no account removes ledger rows older than two years, and no younger one', async () => {
      await kit.admin(async (sql) => {
        await sql.query(`INSERT INTO accounts.purge_ledger (at, account_id, removed, anonymised, called_by) VALUES (now() - interval '800 days', 'old', 1, 0, 'x'), (now() - interval '700 days', 'young', 1, 0, 'x')`);
      });
      await fn('SELECT accounts.purge_audit(NULL::text, NULL::bigint, NULL::bigint)');
      expect((await ledger()).map((r) => r.account_id)).toEqual(['young']);
      // a retention kept longer keeps it longer; one shorter does not make it go
      await kit.admin(async (sql) => {
        await sql.query(`INSERT INTO accounts.purge_ledger (at, account_id, removed, anonymised, called_by) VALUES (now() - interval '800 days', 'old', 1, 0, 'x')`);
      });
      await fn('SELECT accounts.purge_audit(NULL::text, 1::bigint, $1::bigint)', 900 * DAY);
      expect((await ledger()).map((r) => r.account_id).sort()).toEqual(['old', 'young']);
      await fn('SELECT accounts.purge_audit(NULL::text, 1::bigint, 1::bigint)');
      expect((await ledger()).map((r) => r.account_id)).toEqual(['young']);
    });

    describe('through the store (updateAccount\'s deletion patches)', () => {
      const d = (requestedAt: string, purgeAt: string, erasingAt: string | null = null, done: string[] = []) => ({ requestedAt, purgeAt, erasingAt, done });

      it('a request that breaks a guard answers conflict and changes nothing; the steps the service makes go through', async () => {
        await live(1);
        const a = (await store.account(accId(1)))!;
        await refused(store.updateAccount(a.id, a.version, { deletion: d(at(0), at(30 * MINUTE)) }), 'conflict'); // a grace under the floor
        await refused(store.updateAccount(a.id, a.version, { deletion: d(at(-DAY), at(8 * DAY)) }), 'conflict'); // not the database's time
        await refused(store.updateAccount(a.id, a.version, { deletion: d(at(-30 * DAY), at(-23 * DAY)) }), 'conflict'); // the past
        expect(await store.account(a.id)).toEqual(a);
        const requested = await store.updateAccount(a.id, a.version, { deletion: d(at(0), at(7 * DAY)), freeRename: true });
        expect(requested).toMatchObject({ freeRename: true, version: a.version + 1 });
        expect(requested.deletion).toMatchObject({ erasingAt: null, done: [] });
        expect(await store.account(a.id)).toEqual(requested);
        // moved sooner (but not below the grace), then cancelled, then asked again
        const requestedAt = requested.deletion!.requestedAt;
        const later = (ms: number) => new Date(Date.parse(requestedAt) + ms).toISOString();
        await refused(store.updateAccount(a.id, requested.version, { deletion: d(requestedAt, later(10 * MINUTE)) }), 'conflict');
        const moved = await store.updateAccount(a.id, requested.version, { deletion: d(requestedAt, later(2 * HOUR)) });
        expect(moved.deletion!.purgeAt).toBe(later(2 * HOUR));
        const cancelled = await store.updateAccount(a.id, moved.version, { deletion: null });
        expect(cancelled.deletion).toBeNull();
        const again = await store.updateAccount(a.id, cancelled.version, { deletion: d(at(0), at(2 * HOUR)) });
        // due (time passes), claimed, holders done; no cancel after the claim, no claim again within the lease
        await age(a.id, 3 * HOUR);
        const due = (await store.account(a.id))!;
        const claimed = await store.updateAccount(a.id, again.version, { deletion: { ...due.deletion!, erasingAt: at(0) } });
        expect(claimed.deletion!.erasingAt).not.toBeNull();
        await refused(store.updateAccount(a.id, claimed.version, { deletion: { ...claimed.deletion!, erasingAt: at(1_000) } }), 'conflict');
        await refused(store.updateAccount(a.id, claimed.version, { deletion: null }), 'conflict');
        const done = await store.updateAccount(a.id, claimed.version, { deletion: { ...claimed.deletion!, done: ['hosted'] } });
        expect((await store.account(a.id))!.deletion).toEqual({ ...claimed.deletion!, done: ['hosted'] });
        expect(done.version).toBe(claimed.version + 1);
        expect(await store.dueDeletions(at(DAY), 10)).toEqual([a.id]);
      });

      it('a deletion changes only by request, move, claim, cancel and done: any other patch is refused (value), and a new account has none', async () => {
        await live(1);
        const a = (await store.account(accId(1)))!;
        // a request that is already claimed, or already has holders done
        await refused(store.updateAccount(a.id, a.version, { deletion: d(at(0), at(2 * HOUR), at(0)) }), 'value');
        await refused(store.updateAccount(a.id, a.version, { deletion: d(at(0), at(2 * HOUR), null, ['hosted']) }), 'value');
        const r = await store.updateAccount(a.id, a.version, { deletion: d(at(0), at(2 * HOUR)) });
        // the time of the request is not changed after it, nor a move and holders in one patch
        await refused(store.updateAccount(a.id, r.version, { deletion: d(at(-HOUR), r.deletion!.purgeAt) }), 'value');
        await refused(store.updateAccount(a.id, r.version, { deletion: d(r.deletion!.requestedAt, at(3 * HOUR), null, ['hosted']) }), 'value');
        await age(a.id, 3 * HOUR);
        const due = (await store.account(a.id))!;
        const c = await store.updateAccount(a.id, due.version, { deletion: { ...due.deletion!, erasingAt: at(0) } });
        // a claim is not taken back, and changes nothing else
        await refused(store.updateAccount(a.id, c.version, { deletion: { ...c.deletion!, erasingAt: null } }), 'value');
        await refused(store.updateAccount(a.id, c.version, { deletion: { ...c.deletion!, erasingAt: at(10 * MINUTE), done: ['hosted'] } }), 'value');
        await refused(store.updateAccount(a.id, c.version, { deletion: { ...c.deletion!, purgeAt: at(-DAY) } }), 'conflict'); // a move of a claimed one: the database says no
        expect((await store.account(a.id))!.deletion).toEqual(c.deletion);
      });
    });
  });
}

