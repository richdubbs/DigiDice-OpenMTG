/**
 * M14-6: player reports (design 9.2, 8.1, 8.5, 7.3, 2.4; 13.2): the limits for accounts (10 a day, 1 a day per target, a report one refuses
 * costing nothing of the other, an unknown target costing the same) and for guests (3 a day per guest session and per address key; a system
 * reporter none); a guest only as the request's own guest session; `related` and `evidence` only from a system reporter; `reported` audited under the
 * reporter only (null for a guest or the system), with the report id and reason; reports about a hidden, an erased and an unknown id answer the
 * same (only the hidden one is stored); the target's name at the time; reports about oneself; validation. Every answer's code is in the row.
 */
import { describe, expect, it } from 'vitest';
import type { AccountId, PlayerReport, Reporter } from '@openmtg/accounts';
import { code, ctxOf, DAY, erase, events, HOUR, inRow, markDeleting, OP, registerAs, seedAccount, setup, UNKNOWN_ID, value } from './support';

const SYSTEM: Reporter = { kind: 'system', source: 'ladder' };
const guest = (session: string): Reporter => ({ kind: 'guest', session });

describe('M14-6: the report queue (9.2)', () => {
  it('stores the report with the target\'s name at the time, open, oldest first; the reporter learns only the id', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const ctx = ctxOf(s.clock);
    const r1 = value(inRow('report', await s.service.report(ctx, { kind: 'account', auth: alice.auth }, {
      target: { account: bob.auth.account }, reason: 'harassment', text: '  He kept insulting me.  ', game: 'g_123',
    })));
    expect(Object.keys(r1)).toEqual(['report']);
    s.clock.advance(1);
    const r2 = value(inRow('report', await s.service.report(ctxOf(s.clock, { guestSession: 'gs_guest9' }), guest('gs_guest9'), {
      target: { guestSession: 'gs_other', name: 'Mallory' }, reason: 'chat',
    })));
    const rows = await s.store.reports({ limit: 10 });
    expect(rows.map((r) => r.id)).toEqual([r1.report, r2.report]);
    expect(rows[0]).toMatchObject({
      reporter: { kind: 'account', account: alice.auth.account }, target: { account: bob.auth.account }, targetName: 'Bob', reason: 'harassment',
      game: 'g_123', text: 'He kept insulting me.', related: [], evidence: null, status: 'new', closedAt: null, closedBy: null, note: null,
    });
    expect(rows[1]).toMatchObject({ reporter: { kind: 'guest', session: 'gs_guest9' }, target: { guestSession: 'gs_other' }, targetName: 'Mallory', text: null });
    // a rename later changes nothing in the report: the name at the time stays
    s.clock.advance(HOUR);
    value(await s.service.rename(ctxOf(s.clock), bob.auth, 'Robert', { password: 'correct horse battery staple' }));
    expect((await s.store.report(r1.report))!.targetName).toBe('Bob');
  });

  it('related and evidence: refused from an account or a guest (badMessage), stored from a system reporter (the target left out)', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const carol = await registerAs(s, 'Carol');
    const ctx = ctxOf(s.clock);
    const base: PlayerReport = { target: { account: bob.auth.account }, reason: 'collusion' };
    const extras: Partial<PlayerReport>[] = [
      { related: [carol.auth.account] }, { related: [] }, { evidence: { games: ['g_1'], stats: { wins: 3 } } },
    ];
    for (const extra of extras) {
      expect(code(inRow('report', await s.service.report(ctx, { kind: 'account', auth: alice.auth }, { ...base, ...extra })))).toBe('badMessage');
      expect(code(inRow('report', await s.service.report(ctxOf(s.clock, { guestSession: 'gs_g1' }), guest('gs_g1'), { ...base, ...extra })))).toBe('badMessage');
    }
    expect(await s.store.reports({ limit: 10 })).toEqual([]);
    const sys = value(inRow('report', await s.service.report(ctxOf(s.clock, { connection: 'system', addressKey: 'system', guestSession: null }), SYSTEM, {
      ...base, text: 'collusion · 1v1-standard', related: [carol.auth.account, bob.auth.account, carol.auth.account],
      evidence: { games: ['g_1', 'g_2'], stats: { pairGames: 12, concessions: 9 } },
    })));
    const row = (await s.store.report(sys.report))!;
    expect(row).toMatchObject({ reporter: { kind: 'system', source: 'ladder' }, related: [carol.auth.account], evidence: { games: ['g_1', 'g_2'], stats: { pairGames: 12, concessions: 9 } } });
    // a system reporter's own malformed fields are refused too
    const bad: Partial<PlayerReport>[] = [
      { related: ['acc_x' as AccountId] }, { evidence: { games: ['bad id!'], stats: {} } }, { evidence: { games: [], stats: { n: Number.NaN } } },
      { evidence: { games: [], stats: {}, extra: 1 } as never },
    ];
    for (const extra of bad) expect(code(inRow('report', await s.service.report(ctx, SYSTEM, { ...base, ...extra })))).toBe('badMessage');
    expect(code(await s.service.report(ctx, { kind: 'system', source: 'Not A Source' }, base))).toBe('badMessage');
  });

  it('`reported` is audited under the reporter only (null for a guest or the system), with the report id and reason; the target gets nothing', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    // a millisecond apart, so the log's order is the calls' order
    const ctx = () => ctxOf(s.clock, { now: s.clock.advance(1) });
    const a = value(await s.service.report(ctx(), { kind: 'account', auth: alice.auth }, { target: { account: bob.auth.account }, reason: 'spam', text: 'secret words' }));
    const g = value(await s.service.report({ ...ctx(), guestSession: 'gs_g1' }, guest('gs_g1'), { target: { account: bob.auth.account }, reason: 'name' }));
    const y = value(await s.service.report({ ...ctx(), addressKey: 'system', connection: 'system', guestSession: null }, SYSTEM, { target: { account: bob.auth.account }, reason: 'smurf' }));
    const reported = (await events(s)).filter((e) => e.kind === 'reported');
    expect(reported.map((e) => [e.account, e.actor, e.details])).toEqual([
      [alice.auth.account, 'self', { report: a.report, reason: 'spam' }],
      [null, 'self', { report: g.report, reason: 'name' }],
      [null, 'system', { report: y.report, reason: 'smurf' }],
    ]);
    expect(reported[0]!.session).toBe(alice.auth.session);
    expect(reported[0]!.addressTag).not.toBeNull();
    expect(reported[2]!.addressTag).toBeNull();
    // nothing in the whole log names the target or carries the text
    const all = await events(s);
    expect(all.filter((e) => e.account === bob.auth.account).map((e) => e.kind)).toEqual(['registered']);
    expect(JSON.stringify(all)).not.toContain('secret words');
    expect(JSON.stringify(all.filter((e) => e.kind === 'reported'))).not.toContain(bob.auth.account);
  });

  it('about a hidden, an erased and an unknown id: the same answer; only the hidden one is stored, the others are dropped (and not audited)', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const sue = await seedAccount(s, 'Sue');
    const dee = await seedAccount(s, 'Dee');
    const erin = await seedAccount(s, 'Erin');
    await s.service.admin.sanction(OP, sue.id, { kind: 'ban', reason: 'cheating', until: null, message: 'Banned.' });
    await markDeleting(s, dee.id);
    await erase(s, erin.id);
    const answers = [];
    for (const t of [sue.id, dee.id, erin.id, UNKNOWN_ID]) {
      s.clock.advance(1);
      answers.push(inRow('report', await s.service.report(ctxOf(s.clock), SYSTEM, { target: { account: t }, reason: 'smurf' })));
    }
    for (const a of answers) {
      expect(a.ok).toBe(true);
      if (a.ok) expect(Object.keys(a.value)).toEqual(['report']);
    }
    // the same for an account reporter: one answer for every target, and each costs one of the day's reports
    for (const t of [sue.id, dee.id, erin.id, UNKNOWN_ID]) {
      s.clock.advance(1);
      value(await s.service.report(ctxOf(s.clock), { kind: 'account', auth: alice.auth }, { target: { account: t }, reason: 'spam' }));
    }
    const stored = await s.store.reports({ limit: 100 });
    expect(stored.map((r) => ['account' in r.target ? r.target.account : null, r.targetName])).toEqual([
      [sue.id, 'Sue'], [dee.id, 'Dee'], [sue.id, 'Sue'], [dee.id, 'Dee'],
    ]);
    expect((await events(s)).filter((e) => e.kind === 'reported')).toHaveLength(4);
  });

  it('a report about oneself answers notAllowed; a restricted session its status\'s code; malformed input badMessage', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const ctx = ctxOf(s.clock);
    const me: Reporter = { kind: 'account', auth: alice.auth };
    expect(code(inRow('report', await s.service.report(ctx, me, { target: { account: alice.auth.account }, reason: 'spam' })))).toBe('notAllowed');
    expect(code(inRow('report', await s.service.report(ctxOf(s.clock, { guestSession: 'gs_me' }), guest('gs_me'), { target: { guestSession: 'gs_me', name: 'Me' }, reason: 'spam' })))).toBe('notAllowed');
    const malformed: unknown[] = [
      { target: { account: bob.auth.account }, reason: 'rude' },
      { target: { account: 'acc_nope' }, reason: 'spam' },
      { target: { account: bob.auth.account, guestSession: 'gs_1' }, reason: 'spam' },
      { target: { guestSession: 'gs 1', name: 'X' }, reason: 'spam' },
      { target: { guestSession: 'gs_1', name: '' }, reason: 'spam' },
      { target: { account: bob.auth.account }, reason: 'spam', text: 'x'.repeat(2_001) },
      { target: { account: bob.auth.account }, reason: 'spam', text: 'bidi ‮ text' },
      { target: { account: bob.auth.account }, reason: 'spam', game: 'not a game id' },
      { target: { account: bob.auth.account }, reason: 'spam', note: 'unknown key' },
      null,
    ];
    for (const r of malformed) expect(code(inRow('report', await s.service.report(ctx, me, r as PlayerReport))), JSON.stringify(r)?.slice(0, 60)).toBe('badMessage');
    expect(code(await s.service.report(ctx, { kind: 'nobody' } as never, { target: { account: bob.auth.account }, reason: 'spam' }))).toBe('badMessage');
    expect(code(await s.service.report(ctx, guest('not a session!'), { target: { account: bob.auth.account }, reason: 'spam' }))).toBe('badMessage');
    // 2,000 characters are fine
    value(await s.service.report(ctx, me, { target: { account: bob.auth.account }, reason: 'spam', text: 'y'.repeat(2_000) }));
    await s.service.admin.sanction(OP, alice.auth.account, { kind: 'suspend', reason: 'spam', until: new Date(s.clock.t + DAY).toISOString(), message: 'Paused.' });
    expect(code(inRow('report', await s.service.report(ctx, me, { target: { account: bob.auth.account }, reason: 'chat' })))).toBe('suspended');
  });
});

describe('M14-6: the reports\' limits (8.1)', () => {
  it('an account: one a day about one target (costing none of the others), ten a day in all; again after a day', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const me: Reporter = { kind: 'account', auth: alice.auth };
    value(await s.service.report(ctxOf(s.clock), me, { target: { account: bob.auth.account }, reason: 'chat' }));
    const again = inRow('report', await s.service.report(ctxOf(s.clock), me, { target: { account: bob.auth.account }, reason: 'spam' }));
    expect(code(again)).toBe('rateLimited');
    // nine more targets (guest seats count as targets too): the day's ten
    for (let i = 1; i <= 9; i++) value(await s.service.report(ctxOf(s.clock), me, { target: { guestSession: `gs_t${i}`, name: `Guest ${i}` }, reason: 'chat' }));
    const eleventh = inRow('report', await s.service.report(ctxOf(s.clock), me, { target: { guestSession: 'gs_t10', name: 'Guest 10' }, reason: 'chat' }));
    expect(code(eleventh)).toBe('rateLimited');
    if (!eleventh.ok) expect(eleventh.error.retryAfterMs).toBeGreaterThan(0);
    expect(await s.store.reports({ limit: 100 })).toHaveLength(10);
    s.clock.advance(DAY);
    value(await s.service.report(ctxOf(s.clock), me, { target: { account: bob.auth.account }, reason: 'chat' }));
  });

  it('a guest: three a day per guest session and per address key; a system reporter is not limited', async () => {
    const s = setup();
    const bob = await registerAs(s, 'Bob');
    const target = { target: { account: bob.auth.account }, reason: 'chat' } as const;
    // a guest connection files as its own guest session
    const asGuest = (addressKey: string, session: string) => s.service.report(ctxOf(s.clock, { addressKey, guestSession: session }), guest(session), target);
    for (let i = 0; i < 3; i++) value(inRow('report', await asGuest('198.51.100.1', 'gs_a')));
    expect(code(inRow('report', await asGuest('198.51.100.1', 'gs_a')))).toBe('rateLimited');
    // another guest session behind the same address key: the address's three are gone
    expect(code(await asGuest('198.51.100.1', 'gs_b'))).toBe('rateLimited');
    // the same guest session from another address key: the session's three are gone
    expect(code(await asGuest('198.51.100.2', 'gs_a'))).toBe('rateLimited');
    // a fresh session on a fresh address key
    value(await asGuest('198.51.100.3', 'gs_c'));
    // IPv6: the /64 is the address key
    for (let i = 0; i < 3; i++) value(await asGuest(`2001:db8:1:2::${i + 1}`, `gs_v${i}`));
    expect(code(await asGuest('2001:db8:1:2::9', 'gs_v9'))).toBe('rateLimited');
    for (let i = 0; i < 25; i++) value(await s.service.report(ctxOf(s.clock, { connection: 'system', addressKey: 'system', guestSession: null }), SYSTEM, target));
    s.clock.advance(DAY);
    value(await asGuest('198.51.100.1', 'gs_a'));
  });

  it('a report refused by the day\'s limit takes nothing of the target\'s: it goes through once the day allows one again', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const me: Reporter = { kind: 'account', auth: alice.auth };
    for (let i = 1; i <= 10; i++) value(await s.service.report(ctxOf(s.clock), me, { target: { guestSession: `gs_t${i}`, name: `Guest ${i}` }, reason: 'chat' }));
    // the day's ten are gone: refused until one more is allowed (10 a day: one every 2.4 hours), not until the target's day is over
    const refused = inRow('report', await s.service.report(ctxOf(s.clock), me, { target: { account: bob.auth.account }, reason: 'chat' }));
    expect(code(refused)).toBe('rateLimited');
    if (!refused.ok) expect(refused.error.retryAfterMs).toBe(DAY / 10);
    s.clock.advance(3 * HOUR);
    value(inRow('report', await s.service.report(ctxOf(s.clock), me, { target: { account: bob.auth.account }, reason: 'chat' })));
    // and a second report about the target is refused by the target's limit, costing nothing of the day's
    s.clock.advance(3 * HOUR);
    expect(code(await s.service.report(ctxOf(s.clock), me, { target: { account: bob.auth.account }, reason: 'spam' }))).toBe('rateLimited');
    value(await s.service.report(ctxOf(s.clock), me, { target: { guestSession: 'gs_t11', name: 'Guest 11' }, reason: 'chat' }));
  });

  it('a report about an unknown or erased id costs the same: one of the day\'s, and that target\'s one', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const erin = await seedAccount(s, 'Erin');
    await erase(s, erin.id);
    const me: Reporter = { kind: 'account', auth: alice.auth };
    for (const t of [UNKNOWN_ID, erin.id]) {
      value(await s.service.report(ctxOf(s.clock), me, { target: { account: t }, reason: 'spam' }));
      expect(code(inRow('report', await s.service.report(ctxOf(s.clock), me, { target: { account: t }, reason: 'chat' })))).toBe('rateLimited');
    }
    for (let i = 1; i <= 8; i++) value(await s.service.report(ctxOf(s.clock), me, { target: { guestSession: `gs_t${i}`, name: `Guest ${i}` }, reason: 'chat' }));
    expect(code(await s.service.report(ctxOf(s.clock), me, { target: { guestSession: 'gs_t9', name: 'Guest 9' }, reason: 'chat' }))).toBe('rateLimited');
    expect(await s.store.reports({ limit: 100 })).toHaveLength(8);
  });
});

describe('M14-6: a guest reports as its own guest session only (9.2, 5.4)', () => {
  it('a connection naming another guest session, or a signed-in one naming any, answers badMessage and stores nothing', async () => {
    const s = setup();
    const bob = await registerAs(s, 'Bob');
    const target = { target: { account: bob.auth.account }, reason: 'chat' } as const;
    // the request's guest session is gs_guest1 (ctxOf), a signed-in connection's none
    for (const ctx of [ctxOf(s.clock), ctxOf(s.clock, { guestSession: null })]) {
      for (const session of ['gs_victim1', 'gs_victim2']) expect(code(inRow('report', await s.service.report(ctx, guest(session), target)))).toBe('badMessage');
    }
    expect(code(await s.service.report(ctxOf(s.clock, { guestSession: null }), guest('gs_guest1'), target))).toBe('badMessage');
    expect(await s.store.reports({ limit: 10 })).toEqual([]);
    value(await s.service.report(ctxOf(s.clock), guest('gs_guest1'), target));
    expect((await s.store.reports({ limit: 10 })).map((r) => r.reporter)).toEqual([{ kind: 'guest', session: 'gs_guest1' }]);
  });
});
