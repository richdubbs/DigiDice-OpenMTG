/**
 * M14-7: the export (design 10.1, 11.1 AccountExport; 13.2): every section of AccountExport, and a search of the JSON for what must never be in it
 * (hashes of any secret, peppers, address tags, reporters' ids or names, other accounts' ids, operator names, internal notes, moderation and
 * operator events); `reportsFiled` with the target's name and `open` or `closed`; `reportsAbout` closed only, by month; the claimed guest session's
 * reports counted as the account's; a proof needed; one export a day; an export from a restricted session; the holders' sections and `missing`.
 * From the review of M14-7: the day spent only by an export that was built; unavailable while a required holder is missing; every device proof;
 * an export across an erasure; relations and reports filed only to active accounts; the guest session's reports read by their own query.
 * Fixed inputs and a fake clock; the moderation rows are written straight to the store (M14-6 is not on this branch).
 */
import { describe, expect, it } from 'vitest';
import { SECURITY_AUDIT_KINDS, type AccountExport, type AccountId, type ReportQuery, type ReportRow } from '@openmtg/accounts';
import { tokenHash } from '../../src/ids';
import { MISSING_HOLDER_RETRY_MS } from '../../src/rights/part';
import {
  code, ctxOf, DAY, FakeHolder, inRow, PW, PW2, registerAs, rightsSetup, sanctionOn, setEmail, until, value, type RightsSetup,
} from './support';

const PEPPER = 'pepper-secret-0123456789-abcdefghijklmnop';
const repId = (n: number) => `rep_01J0000000000000000000${String(n).padStart(4, '0')}`;

function reportOf(n: number, reporter: ReportRow['reporter'], target: ReportRow['target'], targetName: string, over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: repId(n), reporter, target, targetName, reason: 'chat', game: null, text: null, related: [], evidence: null, status: 'new',
    createdAt: '2026-10-20T10:00:00.000Z', closedAt: null, closedBy: null, note: null, ...over,
  };
}

const closed = (at: string, note: string): Partial<ReportRow> => ({ status: 'actioned', closedAt: at, closedBy: 'admin:Moderator Max', note });

/** Alice with two sessions, a claimed guest session, a verified email, relations, reports both ways, a sanction with its appeal, and the events. */
async function world(s: RightsSetup) {
  const alice = await registerAs(s, 'Alice');
  const bob = await registerAs(s, 'Bobby');
  const carol = await registerAs(s, 'Carol');
  const dave = await registerAs(s, 'Davey');
  const erin = await registerAs(s, 'Erinn');
  const A = alice.auth.account;
  const second = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.10', connection: 'phone' }), { name: 'Alice', password: PW }));
  s.guests.add('c'.repeat(64), 'gs_alicesguest');
  value(inRow('claimGuest', await s.service.claimGuest(ctxOf(s.clock, { guestSession: null }), alice.auth, 'c'.repeat(64), { password: PW })));
  await setEmail(s, A, 'alice@example.com');
  const at = s.clock.now().toISOString();
  await s.store.setRelation({ account: A, other: bob.auth.account, kind: 'block', createdAt: at });
  await s.store.setRelation({ account: A, other: carol.auth.account, kind: 'mute', createdAt: at });
  // a relation set by someone else is not Alice's
  await s.store.setRelation({ account: dave.auth.account, other: A, kind: 'block', createdAt: at });
  // reports Alice filed (as an account, and as the guest she claimed), and reports about her (as an account and as that guest)
  await s.store.putReport(reportOf(1, { kind: 'account', account: A }, { account: bob.auth.account }, 'Bobby', { text: 'Spam in the lobby chat.' }));
  await s.store.putReport(reportOf(2, { kind: 'account', account: A }, { account: carol.auth.account }, 'Carol', { reason: 'title', ...closed(at, 'Moderator note: title changed') }));
  await s.store.putReport(reportOf(3, { kind: 'guest', session: 'gs_alicesguest' }, { account: carol.auth.account }, 'Carol', { reason: 'stalling' }));
  await s.store.putReport(reportOf(4, { kind: 'account', account: dave.auth.account }, { account: A }, 'Alice', {
    reason: 'harassment', text: 'Davey says Alice was rude', game: 'g_secretgame', createdAt: '2026-09-03T08:00:00.000Z',
    ...closed('2026-09-04T08:00:00.000Z', 'internal note about the case'),
  }));
  await s.store.putReport(reportOf(5, { kind: 'account', account: erin.auth.account }, { guestSession: 'gs_alicesguest' }, 'Alice (guest)', {
    reason: 'name', createdAt: '2026-10-01T08:00:00.000Z', ...closed('2026-10-02T08:00:00.000Z', 'second internal note'),
  }));
  await s.store.putReport(reportOf(6, { kind: 'account', account: carol.auth.account }, { account: A }, 'Alice', { reason: 'spam', text: 'Carol is still waiting' }));
  // a warning with its appeal, answered by the operator
  const warn = await sanctionOn(s, A, 1, 'warn', null, { reports: [repId(4)] });
  await s.store.putAppeal({ sanction: warn, account: A, text: 'It was a joke.', createdAt: at, answer: null, answerMessage: null, answeredAt: null, answeredBy: null });
  await s.store.answerAppeal(warn, 'upheld', 'We looked at it again.', 'admin:Moderator Max', at);
  // moderation and operator events under Alice, and a security event an operator caused
  const audit = s.partDeps.current!.audit;
  const op = { actor: 'admin:Moderator Max' as const, actorOs: 'opsuser' };
  await s.store.appendAudit([
    audit.build({ kind: 'sanctioned', account: A, ...op, details: { sanction: warn, kind: 'warn', reason: 'chat', now: false } }, s.clock.now()),
    audit.build({ kind: 'adminViewed', account: A, ...op, details: { what: 'show' } }, s.clock.now()),
    audit.build({ kind: 'sessionsRevoked', account: A, ...op, details: { reason: 'admin', count: 0 } }, s.clock.now()),
  ]);
  await audit.flush();
  return { alice, bob, carol, dave, erin, second, warn };
}

describe('M14-7: the export (10.1)', () => {
  it('holds every section of AccountExport, and only the account\'s own data', async () => {
    const s = rightsSetup({ env: { PASSWORD_PEPPERS: `k1:${PEPPER}`, ACCOUNTS_REQUIRED_HOLDERS: 'hosted,ladder' } });
    const hosted = new FakeHolder('hosted', [], { games: [{ id: 'g_1', seat: 0, place: 1 }] });
    s.service.addHolder(hosted);
    s.service.addHolder(new FakeHolder('ladder', [], { ratings: [] }));
    const w = await world(s);
    const A = w.alice.auth.account;
    s.clock.advance(60_000);
    const exp: AccountExport = value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), w.alice.auth, { password: PW })));

    expect(Object.keys(exp).sort()).toEqual(['account', 'exportedAt', 'format', 'holders', 'missing', 'version']);
    expect(Object.keys(exp.account).sort()).toEqual([
      'ageGate', 'claims', 'devices', 'lastSignInAt', 'nameHistory', 'relations', 'reportsAbout', 'reportsFiled', 'sanctions', 'security', 'self',
      'sessions',
    ]);
    expect([exp.format, exp.version, exp.exportedAt]).toEqual(['openmtg-account-export', 1, s.clock.now().toISOString()]);
    expect(exp.missing).toEqual([]);
    expect(exp.holders).toEqual({ hosted: { games: [{ id: 'g_1', seat: 0, place: 1 }] }, ladder: { ratings: [] } });
    expect(hosted.exports).toEqual([{ account: A, claims: [{ session: 'gs_alicesguest', claimedAt: expect.any(String) }], names: ['Alice'] }]);

    const acc = exp.account;
    expect(acc.self).toMatchObject({ id: A, name: 'Alice', status: 'active', email: { address: 'alice@example.com', verified: true } });
    expect(acc.self.createdAt).toBe((await s.store.account(A))!.createdAt);
    expect(acc.nameHistory).toEqual([{ name: 'Alice', from: acc.self.createdAt, to: null, cause: 'register' }]);
    expect(acc.ageGate).toEqual({ minAge: 13, passedAt: acc.self.createdAt });
    expect(acc.lastSignInAt).toBe((await s.store.account(A))!.lastSignInAt);
    expect(new Map(acc.sessions.map((x) => [x.id, x.current]))).toEqual(new Map([[w.alice.auth.session, true], [w.second.auth.session, false]]));
    expect(acc.devices).toHaveLength(2);
    for (const d of acc.devices) expect(Object.keys(d).sort()).toEqual(['createdAt', 'lastUsedAt']);
    expect(acc.claims).toEqual([{ session: 'gs_alicesguest', claimedAt: expect.any(String) }]);
    expect(acc.relations).toEqual([
      { name: 'Bobby', kind: 'block', since: expect.any(String) },
      { name: 'Carol', kind: 'mute', since: expect.any(String) },
    ]);
    // the target by its name at the time, open or closed only; the claimed guest's report is Alice's
    expect(acc.reportsFiled).toEqual([
      { id: repId(1), target: { kind: 'account', name: 'Bobby' }, reason: 'chat', text: 'Spam in the lobby chat.', createdAt: '2026-10-20T10:00:00.000Z', status: 'open' },
      { id: repId(2), target: { kind: 'account', name: 'Carol' }, reason: 'title', text: null, createdAt: '2026-10-20T10:00:00.000Z', status: 'closed' },
      { id: repId(3), target: { kind: 'account', name: 'Carol' }, reason: 'stalling', text: null, createdAt: '2026-10-20T10:00:00.000Z', status: 'open' },
    ]);
    // closed reports about her (and about the guest she claimed), by reason and month only; the open one is left out
    expect(acc.reportsAbout).toEqual([{ reason: 'harassment', month: '2026-09' }, { reason: 'name', month: '2026-10' }]);
    expect(acc.sanctions).toEqual([
      {
        id: w.warn, kind: 'warn', reason: 'chat', message: 'Please keep the chat friendly.', since: expect.any(String), until: null, ended: null,
        appeal: { at: expect.any(String), answer: 'upheld', message: 'We looked at it again.' },
      },
    ]);
    // security events whose actor is self or system, without an address tag or an actor
    expect(acc.security.length).toBeGreaterThan(0);
    for (const e of acc.security) {
      expect(Object.keys(e).sort()).toEqual(['at', 'details', 'kind', 'session']);
      expect(SECURITY_AUDIT_KINDS).toContain(e.kind);
    }
    expect(acc.security.map((e) => e.kind)).toEqual(expect.arrayContaining(['registered', 'signedIn', 'guestClaimed']));
    expect(acc.security.map((e) => e.kind)).not.toContain('sessionsRevoked');

    // ---- the search of the JSON
    const json = JSON.stringify(exp);
    const forbidden: [string, string][] = [['the pepper', PEPPER], ['an operator', 'Moderator Max'], ['an OS user', 'opsuser']];
    for (const c of await s.store.credentials(A)) forbidden.push(['a PHC string', c.secret!], ['its hash', c.secret!.split('$').at(-1)!]);
    for (const r of await s.store.recoveryCodes(A)) forbidden.push(['a recovery hash', r.hash]);
    for (const x of await s.store.sessionsOf(A)) {
      forbidden.push(['a token hash', x.tokenHash]);
      if (x.previousHash !== null) forbidden.push(['a previous hash', x.previousHash]);
      if (x.device !== null) forbidden.push(['a device hash', x.device]);
    }
    forbidden.push(['a device hash', tokenHash(w.second.device)]);
    const events = await s.store.audit({ limit: 10_000 });
    const tags = events.map((e) => e.addressTag).filter((t): t is string => t !== null);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) forbidden.push(['an address tag', t]);
    for (const [who, r] of [['Bobby', w.bob], ['Carol', w.carol], ['Davey', w.dave], ['Erinn', w.erin]] as const) forbidden.push([`${who}'s id`, r.auth.account]);
    forbidden.push(
      ['a reporter\'s name', 'Davey'], ['a reporter\'s name', 'Erinn'], ['a report about her', repId(4)], ['a report about her', repId(6)],
      ['a reporter\'s text', 'Davey says'], ['a reporter\'s text', 'Carol is still waiting'], ['the reported game', 'g_secretgame'],
      ['an internal note', 'internal: seen in three games'], ['an internal note', 'internal note about the case'],
      ['an internal note', 'Moderator note'], ['an internal note', 'second internal note'],
      ['a moderation event', '"sanctioned"'], ['an operator event', '"adminViewed"'],
    );
    for (const key of ['note', 'createdBy', 'closedBy', 'answeredBy', 'reports', 'addressTag', 'actor', 'actorOs', 'tokenHash', 'previousHash', 'nameKey', 'keyVersion', 'reporter', 'related', 'evidence']) {
      forbidden.push([`the key ${key}`, `"${key}":`]);
    }
    for (const [what, needle] of forbidden) expect(json.includes(needle), `${what}: ${needle}`).toBe(false);
    const accountIds = json.match(/acc_[0-7][0-9A-HJKMNP-TV-Z]{25}/g) ?? [];
    expect(new Set(accountIds)).toEqual(new Set<AccountId>([A]));
  });

  it('needs the proof in the same request: none answers reauthRequired, a wrong one badCredentials', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    expect(code(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, undefined as never)))).toBe('reauthRequired');
    expect(code(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW2 })))).toBe('badCredentials');
    expect(value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }))).account.self.name).toBe('Alice');
  });

  it('once a day: a second export answers rateLimited (a mistyped password spends nothing), and a day later it works again', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    expect(code(await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW2 }))).toBe('badCredentials');
    value(await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }));
    s.clock.advance(DAY - 60_000);
    const again = inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }));
    expect(code(again)).toBe('rateLimited');
    if (!again.ok) expect(again.error.retryAfterMs).toBeGreaterThan(0);
    s.clock.advance(60_000);
    value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW })));
    // each export is audited (exported), never with the password
    await s.service.tick(s.clock.now());
    const events = await s.store.audit({ account: alice.auth.account, kinds: ['exported'], limit: 10 });
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(PW);
  });

  it('works from a restricted session: a deleting account exports its data', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    const exp = value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW })));
    expect(exp.account.self).toMatchObject({ status: 'deleting', restricted: true, deletion: { cancellable: true } });
  });

  it('a holder that cannot export answers unavailable, never a partial export; every holder is asked with the PlayerRef', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const ladder = new FakeHolder('ladder', [], { ratings: [] });
    s.service.addHolder(ladder);
    s.service.addHolder({ name: 'hosted', exportFor: async () => Promise.reject(new Error('down')), erase: async () => ({ removed: 0, anonymised: 0 }) });
    expect(code(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW })))).toBe('unavailable');
    expect(ladder.exports).toEqual([{ account: alice.auth.account, claims: [], names: ['Alice'] }]);
  });

  it('addHolder refuses a bad name, a second holder of one name, and a holder without its methods', async () => {
    const s = rightsSetup();
    const h = (name: string) => new FakeHolder(name);
    s.service.addHolder(h('hosted'));
    expect(() => s.service.addHolder(h('hosted'))).toThrow(TypeError);
    for (const bad of ['Hosted', '', '1hosted', 'a'.repeat(33), 'host ed']) expect(() => s.service.addHolder(h(bad)), bad).toThrow(TypeError);
    expect(() => s.service.addHolder({ name: 'ladder' } as never)).toThrow(TypeError);
  });

  it('a failure while the export is built costs nothing: the next try the same day works, and then the day is spent (contract 7)', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    let down = true;
    let built = 0;
    s.service.addHolder({
      name: 'hosted', exportFor: async () => {
        built++;
        if (down) throw new Error('down');
        return { games: [] };
      },
      erase: async () => ({ removed: 0, anonymised: 0 }),
    });
    expect(code(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW })))).toBe('unavailable');
    down = false;
    s.clock.advance(60_000);
    expect(value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }))).holders).toEqual({ hosted: { games: [] } });
    // the day is spent now, and a request over it is answered before anything is built
    expect(code(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW })))).toBe('rateLimited');
    expect(built).toBe(2);
  });

  it('answers unavailable while a required holder is not registered: only the operator\'s --partial gives an export with missing (contract 7)', async () => {
    const s = rightsSetup({ env: { ACCOUNTS_REQUIRED_HOLDERS: 'hosted,ladder' } });
    s.service.addHolder(new FakeHolder('hosted'));
    const alice = await registerAs(s, 'Alice');
    const r = inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }));
    expect(code(r)).toBe('unavailable');
    if (!r.ok) expect(r.error.retryAfterMs).toBe(MISSING_HOLDER_RETRY_MS);
    expect((await s.service.admin.exportAccount({ name: 'Operator Olga', osUser: 'olga' }, alice.auth.account, true)).missing).toEqual(['ladder']);
    // nothing was spent: once the holder is there, the export works the same day
    s.service.addHolder(new FakeHolder('ladder'));
    expect(value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }))).missing).toEqual([]);
  });

  it('lists every device proof of the account, a proof whose session the purge removed too (contract 9)', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    const A = alice.auth.account;
    const phone = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.10', connection: 'phone' }), { name: 'Alice', password: PW }));
    value(await s.service.signOut(ctxOf(s.clock), phone.auth, false));
    // the revoked session goes with the purge after its 7 days; its device proof is kept a year after its last use
    s.clock.advance(8 * DAY);
    expect((await s.service.tick(s.clock.now())).purged).toMatchObject({ sessions: 1, devices: 0 });
    expect((await s.store.sessionsOf(A)).map((x) => x.id)).toEqual([alice.auth.session]);
    const proof = (await s.store.device(tokenHash(phone.device)))!;
    const exp = value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW })));
    expect(exp.account.devices).toHaveLength(2);
    expect(exp.account.devices).toContainEqual({ createdAt: proof.createdAt, lastUsedAt: proof.lastUsedAt });
  });

  it('an export built while the account is erased answers sessionExpired and records nothing (security 1)', async () => {
    const s = rightsSetup();
    let entered = false;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    s.service.addHolder({
      name: 'hosted', exportFor: async () => {
        entered = true;
        await gate;
        return { games: [] };
      },
      erase: async () => ({ removed: 0, anonymised: 0 }),
    });
    const alice = await registerAs(s, 'Alice');
    const del = value(await s.service.deleteAccount(ctxOf(s.clock), alice.auth, { password: PW }));
    // from the restricted session, at the moment the erasure is due
    s.clock.t = Date.parse(del.purgeAt);
    const exporting = s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW });
    await until(() => entered);
    expect((await s.service.tick(s.clock.now())).erased).toBe(1);
    open();
    expect(code(inRow('exportData', await exporting))).toBe('sessionExpired');
    await s.partDeps.current!.audit.flush();
    expect(await s.store.audit({ kinds: ['exported'], limit: 10 })).toEqual([]);
    expect((await s.store.audit({ account: alice.auth.account, limit: 10 })).map((e) => e.kind)).toEqual(['deleted']);
  });

  it('lists relations and reports filed only while the other account is active; one comes back once it is active again (security 4)', async () => {
    const s = rightsSetup();
    const a = await registerAs(s, 'Alice');
    const b = await registerAs(s, 'Bobby');
    const c = await registerAs(s, 'Carol');
    const d = await registerAs(s, 'Davey');
    const e = await registerAs(s, 'Erinn');
    const A = a.auth.account;
    const at = s.clock.now().toISOString();
    await s.store.setRelation({ account: A, other: b.auth.account, kind: 'block', createdAt: at });
    await s.store.setRelation({ account: A, other: c.auth.account, kind: 'block', createdAt: at });
    await s.store.setRelation({ account: A, other: e.auth.account, kind: 'mute', createdAt: at });
    const mine = { kind: 'account' as const, account: A };
    await s.store.putReport(reportOf(1, mine, { account: b.auth.account }, 'Bobby'));
    await s.store.putReport(reportOf(2, mine, { account: d.auth.account }, 'Davey'));
    await s.store.putReport(reportOf(3, mine, { account: e.auth.account }, 'Erinn'));
    await s.store.putReport(reportOf(4, mine, { guestSession: 'gs_someguest' }, 'Wolf (guest)'));
    // Bob renames and is banned; Carol asks for her deletion; Davey is suspended for a week: others see none of them now
    s.clock.advance(DAY);
    value(await s.service.rename(ctxOf(s.clock), b.auth, 'Robert', { password: PW }));
    await sanctionOn(s, b.auth.account, 1, 'ban', null);
    value(await s.service.deleteAccount(ctxOf(s.clock), c.auth, { password: PW }));
    await sanctionOn(s, d.auth.account, 2, 'suspend', 7 * DAY);
    expect([...(await s.service.directory.names([b.auth.account, c.auth.account, d.auth.account, e.auth.account])).keys()]).toEqual([e.auth.account]);

    const exp = value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), a.auth, { password: PW })));
    expect(exp.account.relations.map((x) => [x.name, x.kind])).toEqual([['Erinn', 'mute']]);
    expect(exp.account.reportsFiled.map((x) => [x.id, x.target.name])).toEqual([[repId(3), 'Erinn'], [repId(4), 'Wolf (guest)']]);
    const json = JSON.stringify(exp);
    for (const name of ['Robert', 'Bobby', 'Carol', 'Davey']) expect(json.includes(name), name).toBe(false);
    // a week later the suspension has ended: Davey's report is listed again
    s.clock.advance(7 * DAY);
    const later = await s.service.admin.exportAccount({ name: 'Operator Olga', osUser: 'olga' }, A, false);
    expect(later.account.reportsFiled.map((x) => x.target.name)).toEqual(['Davey', 'Erinn', 'Wolf (guest)']);
    expect(later.account.relations.map((x) => x.name)).toEqual(['Erinn']);
  });

  it('reads the claimed guest session\'s reports by the store\'s guestSession query, never the whole report table (security 5)', async () => {
    const s = rightsSetup();
    const w = await world(s);
    const queries: ReportQuery[] = [];
    const reports = s.store.reports.bind(s.store);
    s.store.reports = async (q) => {
      queries.push(q);
      return reports(q);
    };
    const exp = value(inRow('exportData', await s.service.exportData(ctxOf(s.clock), w.alice.auth, { password: PW })));
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q.reporter !== undefined || q.target !== undefined || q.guestSession !== undefined, JSON.stringify(q)).toBe(true);
    expect(queries.map((q) => q.guestSession).filter((g) => g !== undefined)).toEqual(['gs_alicesguest']);
    // the guest's reports are still hers: the one it filed, and the closed one about it
    expect(exp.account.reportsFiled.map((x) => x.id)).toContain(repId(3));
    expect(exp.account.reportsAbout).toContainEqual({ reason: 'name', month: '2026-10' });
  });

  it('a renamed account exports every name it has had, and its holders get them all', async () => {
    const s = rightsSetup();
    const alice = await registerAs(s, 'Alice');
    s.clock.advance(DAY);
    value(await s.service.rename(ctxOf(s.clock), alice.auth, 'Alicia', { password: PW }));
    const holder = new FakeHolder('hosted');
    s.service.addHolder(holder);
    const exp = value(await s.service.exportData(ctxOf(s.clock), alice.auth, { password: PW }));
    expect(exp.account.nameHistory.map((h) => [h.name, h.cause, h.to === null])).toEqual([['Alice', 'register', false], ['Alicia', 'rename', true]]);
    expect(holder.exports[0]!.names).toEqual(['Alice', 'Alicia']);
  });
});
