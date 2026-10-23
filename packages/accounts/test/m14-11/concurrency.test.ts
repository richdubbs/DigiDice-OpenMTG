/**
 * M14-11: the concurrency cases of design 13.2 on two connections, and the change feed's order. Two stores run on two `AccountsSql` of the service's role:
 * on a real server (OPENMTG_TEST_PG_URL) two pools, so two connections that really wait for each other's locks; on PGlite one connection that takes the
 * calls in turn, where each case still has exactly one winner (what the contract promises) but nothing waits. The two cases at the end hold a
 * transaction open between its statements and its COMMIT, and so need the real server: a writer holding the change feed's lock holds the next writer, and
 * a reader never sees seq n + 1 before n; an erase waits for a writer that has already read the account, then removes what it wrote.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccountStoreError, openPostgresAccountStore, type AccountChange, type AccountId, type AccountsSql, type AccountStore, type CredentialRow,
} from '@openmtg/accounts';
import {
  accId, at, auditOf, claimErasure, DAY, emailCodeId, emailCodeOf, guestSession, HOUR, historyOf, localSecret, MINUTE, newAccount, renameOpts, reportId, reportOf,
  sanctionId, sanctionOf, sessionId, sessionOf, sha, T0, tombstoneOf,
} from '../m14-4/contract';
import { kits } from './harness';

/** 'ok', or the code of the store's refusal; anything else is a failure of the case (a deadlock, a lost connection). */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AccountStoreError ? e.code : `other: ${(e as Error).message}`;
  }
}
const count = (list: readonly string[], what: string): number => list.filter((x) => x === what).length;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** A client whose transactions stop after their statements, before the COMMIT, until `release` (the writer is "in the middle of" its transaction). */
function held(base: AccountsSql): { sql: AccountsSql; inside: Promise<void>; release: () => void } {
  let reached!: () => void;
  let release!: () => void;
  const inside = new Promise<void>((r) => (reached = r));
  const gate = new Promise<void>((r) => (release = r));
  const sql: AccountsSql = {
    ...base,
    transaction: (fn) =>
      base.transaction(async (tx) => {
        const out = await fn(tx);
        reached();
        await gate;
        return out;
      }),
  };
  return { sql, inside, release };
}

for (const kit of kits()) {
  describe(`M14-11 two connections (${kit.name})`, { timeout: 120_000 }, () => {
    let a: AccountStore;
    let b: AccountStore;
    beforeAll(() => kit.reset());
    afterAll(() => kit.end());
    beforeEach(async () => {
      await kit.reset();
      a = await openPostgresAccountStore(kit.service());
      b = await openPostgresAccountStore(kit.serviceTwo());
    });
    /** Alternates the two stores: call i runs on a for even i, on b for odd i. */
    const either = (i: number): AccountStore => (i % 2 === 0 ? a : b);

    describe('names', () => {
      it('registrations of one key at once, on both connections: exactly one wins, the others answer exists and leave nothing behind', async () => {
        const racers = [1, 2, 3, 4, 5, 6].map((n) => newAccount(n, `Alice${n}`, 'allce'));
        const results = await Promise.all(racers.map((r, i) => outcome(either(i).createAccount(r, T0))));
        expect(count(results, 'ok')).toBe(1);
        expect(count(results, 'exists')).toBe(5);
        const winner = racers[results.indexOf('ok')]!;
        expect((await a.nameEntry('allce', 1))?.account).toBe(winner.account.id);
        for (const r of racers) {
          if (r === winner) continue;
          expect(await a.account(r.account.id)).toBeNull();
          expect(await a.sessionByTokenHash(r.session.tokenHash)).toBeNull();
          expect(await a.credentialBySubject('local', r.account.id)).toBeNull();
          expect(await a.device(r.device.hash)).toBeNull();
          expect(await a.audit({ account: r.account.id, limit: 10 })).toEqual([]);
        }
      });

      it('a rename and a registration of one key at once: one wins, the other answers exists, and neither waits for the other for ever', async () => {
        for (let round = 0; round < 5; round++) {
          const key = `carol${round}`;
          await a.createAccount(newAccount(10 + round, `Bob${round}`, `bob${round}`), T0);
          const acc = (await a.account(accId(10 + round)))!;
          const t1 = at(DAY);
          const results = await Promise.all([
            outcome(a.rename(acc.id, acc.version, historyOf(10 + round, `Carol${round}`, key, t1), renameOpts(t1))),
            outcome(b.createAccount(newAccount(30 + round, `CAROL${round}`, key, { account: { createdAt: t1 } }), t1)),
          ]);
          expect(results.filter((x) => x !== 'ok'), `round ${round}: ${results.join(', ')}`).toEqual(['exists']);
          const entry = (await a.nameEntry(key, 1))!;
          expect(entry.kind).toBe('current');
          expect([accId(10 + round), accId(30 + round)]).toContain(entry.account);
          // whichever won, an account holds the key and the other account's rows are as before
          expect(await a.accountByKey(key, 1)).toMatchObject({ id: entry.account });
        }
      });

      it('renames to one key at once: one wins, the others answer exists and keep their names', async () => {
        for (const n of [1, 2, 3, 4]) await a.createAccount(newAccount(n, `Bob${n}`, `bob${n}`), T0);
        const accounts = await Promise.all([1, 2, 3, 4].map((n) => a.account(accId(n))));
        const t1 = at(DAY);
        const results = await Promise.all(accounts.map((x, i) => outcome(either(i).rename(x!.id, x!.version, historyOf(i + 1, 'Dave', 'dave', t1), renameOpts(t1)))));
        expect(count(results, 'ok')).toBe(1);
        expect(count(results, 'exists')).toBe(3);
        const winner = accId(results.indexOf('ok') + 1);
        expect((await a.nameEntry('dave', 1))?.account).toBe(winner);
        for (const n of [1, 2, 3, 4]) {
          const x = (await a.account(accId(n)))!;
          expect(x.nameKey).toBe(accId(n) === winner ? 'dave' : `bob${n}`);
          expect((await a.nameHistory(accId(n))).length).toBe(accId(n) === winner ? 2 : 1);
        }
      });

      it('updates of one account at one version: one wins, the others answer conflict', async () => {
        await a.createAccount(newAccount(1, 'Kim', 'klrn'), T0);
        const x = (await a.account(accId(1)))!;
        const results = await Promise.all(['d4-white', 'd6-blue', 'd8-blue', 'd10-blue'].map((avatar, i) => outcome(either(i).updateAccount(x.id, x.version, { avatar: avatar as never }))));
        expect(count(results, 'ok')).toBe(1);
        expect(count(results, 'conflict')).toBe(3);
        expect((await a.account(accId(1)))!.version).toBe(x.version + 1);
      });
    });

    describe('credentials, codes and sessions', () => {
      beforeEach(async () => {
        await a.createAccount(newAccount(1, 'Mia', 'rnla'), T0);
      });

      it('a rehash racing a password change: the compare-and-set lets exactly one through, the other answers conflict', async () => {
        const c0 = (await a.credentialBySubject('local', accId(1)))!;
        const results = await Promise.all([
          outcome(a.putCredential({ ...c0, secret: `${localSecret(1)}-rehashed` }, c0.secret)),
          outcome(b.putCredential({ ...c0, secret: localSecret(1, 1) }, c0.secret)),
        ]);
        expect(results.slice().sort()).toEqual(['conflict', 'ok']);
        expect([`${localSecret(1)}-rehashed`, localSecret(1, 1)]).toContain((await a.credentialBySubject('local', accId(1)))!.secret);
      });

      it('the last two credentials deleted at once: one deletion passes, the other answers conflict, and the account keeps a way to sign in', async () => {
        const shopify: CredentialRow = { account: accId(1), provider: 'shopify', subject: 'gid-1', secret: null, meta: {}, createdAt: T0, lastUsedAt: null };
        await a.putCredential(shopify);
        const results = await Promise.all([outcome(a.deleteCredential(accId(1), 'local', accId(1))), outcome(b.deleteCredential(accId(1), 'shopify', 'gid-1'))]);
        expect(results.slice().sort()).toEqual(['conflict', 'ok']);
        expect(await a.credentials(accId(1))).toHaveLength(1);
      });

      it('a recovery code is spent by exactly one of many callers on both connections', async () => {
        const hash = sha('rc:1:3:1');
        const spent = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => either(i).spendRecoveryCode(accId(1), 3, hash, at(MINUTE))));
        expect(spent.filter(Boolean)).toHaveLength(1);
      });

      it('an email code is used by exactly one of many callers; at most the cap of live codes of a purpose goes in, however many are put at once', async () => {
        await a.putEmailCode(emailCodeOf(1, accId(1), 'verify'), T0);
        const used = await Promise.all([0, 1, 2, 3].map((i) => either(i).useEmailCode(emailCodeId(1), at(MINUTE))));
        expect(used.filter(Boolean)).toHaveLength(1);
        const results = await Promise.all([10, 11, 12, 13, 14, 15, 16, 17].map((n, i) => outcome(either(i).putEmailCode(emailCodeOf(n, accId(1), 'reset'), T0))));
        expect(count(results, 'ok')).toBe(3);
        expect(count(results, 'conflict')).toBe(5);
        expect(await a.liveEmailCodes(accId(1), 'reset', T0)).toHaveLength(3);
      });

      it('two rotations from one token hash: exactly one passes the compare-and-set', async () => {
        const s = sessionOf(1, 0);
        const rotations = await Promise.all([0, 1, 2].map((i) => either(i).rotateSession(s.id, s.tokenHash, sha(`next:${i}`), at(DAY))));
        expect(rotations.filter((r) => r !== null)).toEqual([1]);
      });

      it('claims of one guest session by three accounts: one wins, the others answer exists', async () => {
        for (const n of [2, 3]) await a.createAccount(newAccount(n, `Mia${n}`, `rnla${n}`), T0);
        const results = await Promise.all([1, 2, 3].map((n, i) => outcome(either(i).claimGuest({ session: guestSession(1), account: accId(n), claimedAt: at(DAY) }))));
        expect(count(results, 'ok')).toBe(1);
        expect(count(results, 'exists')).toBe(2);
      });
    });

    describe('moderation', () => {
      beforeEach(async () => {
        await a.createAccount(newAccount(1, 'Uma', 'urna'), T0);
        await a.putSanction(sanctionOf(1, accId(1), 'warn', null));
        await a.putReport(reportOf(1, { kind: 'system', source: 'ladder' }, { account: accId(1) }, 'Uma'));
      });

      it('one appeal per sanction, answered once, a sanction ended once, a report closed once, however many ask at once', async () => {
        const appeal = (i: number) => ({ sanction: sanctionId(1), account: accId(1), text: `appeal ${i}`, createdAt: at(HOUR), answer: null, answerMessage: null, answeredAt: null, answeredBy: null });
        const appeals = await Promise.all([0, 1, 2].map((i) => outcome(either(i).putAppeal(appeal(i)))));
        expect([count(appeals, 'ok'), count(appeals, 'exists')]).toEqual([1, 2]);
        const answers = await Promise.all([0, 1, 2].map((i) => outcome(either(i).answerAppeal(sanctionId(1), 'upheld', 'No.', 'op', at(DAY)))));
        expect([count(answers, 'ok'), count(answers, 'conflict')]).toEqual([1, 2]);
        const ends = await Promise.all([0, 1, 2].map((i) => outcome(either(i).endSanction(sanctionId(1), at(DAY), 'lifted', 'op'))));
        expect([count(ends, 'ok'), count(ends, 'conflict')]).toEqual([1, 2]);
        const closes = await Promise.all([0, 1, 2].map((i) => outcome(either(i).closeReport(reportId(1), 'dismissed', 'op', at(DAY), null))));
        expect([count(closes, 'ok'), count(closes, 'conflict')]).toEqual([1, 2]);
      });
    });

    describe('the change feed', () => {
      it('two writers on two connections interleaved with a reader: seqs come in order with none missing, and a reader never sees seq n + 1 before n', async () => {
        expect(await a.changesHead()).toBe(0);
        const writer = async (store: AccountStore, account: AccountId, kind: AccountChange['kind'], n: number): Promise<void> => {
          for (let i = 0; i < n; i++) await store.appendChange({ at: at(i * MINUTE), account, kind });
        };
        let seen = 0;
        let done = false;
        const order: number[] = [];
        const reader = (async () => {
          while (!done || seen < 40) {
            const page = await a.changes(seen, 7);
            page.forEach((c, i) => expect(c.seq).toBe(seen + 1 + i));
            for (const c of page) order.push(c.seq);
            seen = page.length > 0 ? page[page.length - 1]!.seq : seen;
            await tick();
          }
        })();
        await Promise.all([writer(a, accId(1), 'avatar', 20), writer(b, accId(2), 'renamed', 20)]);
        done = true;
        await reader;
        expect(order).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
        expect(await b.changesHead()).toBe(40);
        expect((await b.changes(0, 100)).filter((c) => c.account === accId(1))).toHaveLength(20);
      });

      it.runIf(kit.dbClock === 'real')('a writer that has not committed holds the next one: a reader sees nothing of seq 1 or 2 until 1 commits, then both in order', async () => {
        const h = held(kit.service());
        const writer = await openPostgresAccountStore(h.sql);
        const first = writer.appendChange({ at: T0, account: accId(1), kind: 'avatar' });
        await h.inside; // seq 1 is inserted, its transaction (and the feed's lock) still open
        let secondDone = false;
        const second = b.appendChange({ at: T0, account: accId(2), kind: 'avatar' }).then((seq) => ((secondDone = true), seq));
        await sleep(500);
        expect(secondDone).toBe(false);
        expect(await a.changes(0, 10)).toEqual([]);
        expect(await a.changesHead()).toBe(0);
        h.release();
        expect([await first, await second]).toEqual([1, 2]);
        expect((await a.changes(0, 10)).map((c) => c.seq)).toEqual([1, 2]);
      });
    });

    describe('erase against writers', () => {
      it('an erase racing an audit write and a change for the account leaves nothing of it but the operator\'s event without its id, in whatever order they meet', async () => {
        for (let round = 0; round < 8; round++) {
          const n = 50 + round;
          const X = accId(n);
          await a.createAccount({ ...newAccount(n, `Xena${n}`, `xena${n}`), audit: [] }, T0);
          await claimErasure(a, X, at(-DAY));
          const results = await Promise.all([
            outcome(a.erase(X, tombstoneOf(X, at(HOUR)), at(91 * DAY))),
            outcome(b.appendAudit([
              auditOf(n * 10, 'signedIn', X, { provider: 'local', device: false, restricted: true }, { session: sessionId(n) }),
              auditOf(n * 10 + 1, 'adminViewed', X, { what: 'show' }, { actor: 'admin:op', actorOs: 'root' }),
            ])),
            outcome(b.appendChange({ at: T0, account: X, kind: 'standing' })),
          ]);
          expect(results[0], `round ${round}: ${results.join(', ')}`).toBe('ok');
          expect(results[1], `round ${round}`).toBe('ok');
          expect(['ok', 'notFound'], `round ${round}`).toContain(results[2]);
          expect(await a.account(X)).toBeNull();
          expect((await a.audit({ account: X, limit: 10 })).map((e) => e.kind)).toEqual([]);
          expect((await a.audit({ kinds: ['adminViewed'], limit: 100 })).filter((e) => e.id === auditOf(n * 10 + 1, 'adminViewed', X, { what: 'show' }).id)).toMatchObject([{ account: null }]);
          expect((await a.changes(0, 1_000)).filter((c) => c.account === X)).toEqual([]);
        }
      });

      it.runIf(kit.dbClock === 'real')('an erase waits for a write that has already looked at the account, then removes what it wrote', async () => {
        const X = accId(1);
        await a.createAccount({ ...newAccount(1, 'Xena', 'xena'), audit: [] }, T0);
        await claimErasure(a, X, at(-DAY));
        const h = held(kit.service());
        const writer = await openPostgresAccountStore(h.sql);
        const write = writer.appendAudit([auditOf(1, 'signedIn', X, { provider: 'local', device: false, restricted: true })]);
        await h.inside; // the event is inserted, the account's row is locked against its erase, nothing committed
        let erased = false;
        const erase = b.erase(X, tombstoneOf(X, at(HOUR)), at(91 * DAY)).then(() => void (erased = true));
        await sleep(500);
        expect(erased).toBe(false);
        h.release();
        await write;
        await erase;
        expect(await a.account(X)).toBeNull();
        expect(await a.audit({ account: X, limit: 10 })).toEqual([]);
        expect(await a.audit({ limit: 10 })).toEqual([]);
      });
    });

    describe('review cases', () => {
      it('two accounts putting one session id at once: exactly one holds it, with its own token hash, and the other answers exists (the upsert keeps its account guard)', async () => {
        await a.createAccount(newAccount(1, 'Ann', 'ann'), T0);
        await a.createAccount(newAccount(2, 'Ben', 'ben'), T0);
        const mine = { ...sessionOf(1, 9), id: sessionId(777) };
        const theirs = { ...sessionOf(2, 9), id: sessionId(777) };
        const results = await Promise.all([outcome(a.putSession(mine)), outcome(b.putSession(theirs))]);
        expect(results.slice().sort()).toEqual(['exists', 'ok']);
        const winner = results[0] === 'ok' ? mine : theirs;
        const loser = winner === mine ? theirs : mine;
        expect((await a.sessionByTokenHash(winner.tokenHash))?.row).toEqual(winner);
        expect(await a.sessionByTokenHash(loser.tokenHash)).toBeNull();
      });

      it.runIf(kit.dbClock === 'real')('a change that waits for the erase of its account does not hold the change feed: another account\'s change goes through meanwhile', async () => {
        const X = accId(1);
        const Y = accId(2);
        await a.createAccount({ ...newAccount(1, 'Xena', 'xena'), audit: [] }, T0);
        await a.createAccount({ ...newAccount(2, 'Yuri', 'yurl'), audit: [] }, T0);
        await claimErasure(a, X, at(-DAY));
        const h = held(kit.service());
        const eraser = await openPostgresAccountStore(h.sql);
        const erasing = eraser.erase(X, tombstoneOf(X, at(HOUR)), at(91 * DAY));
        await h.inside; // X's row is locked and gone, its tombstone written, nothing committed
        let lateDone = false;
        const late = outcome(b.appendChange({ at: T0, account: X, kind: 'standing' })).then((o) => ((lateDone = true), o)); // waits for the erase on X's row
        await sleep(500);
        expect(lateDone).toBe(false);
        const other = await Promise.race([a.appendChange({ at: T0, account: Y, kind: 'avatar' }), sleep(3_000).then(() => 'held up')]);
        expect(other).toBe(1);
        h.release();
        await erasing;
        expect(await late).toBe('notFound');
        expect((await a.changes(0, 10)).map((c) => [c.account, c.kind])).toEqual([[Y, 'avatar']]);
      });
    });
  });
}
