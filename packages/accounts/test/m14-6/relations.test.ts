/**
 * M14-6: blocks and mutes (design 9.1, 7.3, 8.1; 13.2): through the directory (blockedAmong both ways, silenced), the account's own list
 * (RELATION_VIEW_KEYS), the same answer for a hidden, an erased and an unknown id (nothing stored for the last two; the list shows only active
 * accounts), the limits (30 changes an hour, 500 entries, also for two blocks at once), and the session rules (a restricted session answers its
 * status's code). Every answer's code is in its method's row.
 */
import { describe, expect, it } from 'vitest';
import { RELATION_VIEW_KEYS, type AccountId } from '@openmtg/accounts';
import {
  code, ctxOf, erase, HOUR, inRow, markDeleting, seedName, OP, registerAs, seedAccount, setup, UNKNOWN_ID, value, type Setup,
} from './support';

async function three(s: Setup) {
  return { alice: await registerAs(s, 'Alice'), bob: await registerAs(s, 'Bob'), carol: await registerAs(s, 'Carol') };
}

describe('M14-6: block and mute through the directory (9.1)', () => {
  it('a block is per pair (blockedAmong lists it once, whoever set it); a mute silences one way only', async () => {
    const s = setup();
    const { alice, bob, carol } = await three(s);
    const [A, B, C] = [alice.auth.account, bob.auth.account, carol.auth.account];
    const ctx = ctxOf(s.clock);
    const pair = (x: AccountId, y: AccountId): [AccountId, AccountId] => (x < y ? [x, y] : [y, x]);
    value(inRow('block', await s.service.block(ctx, alice.auth, B, true)));
    expect(await s.service.directory.blockedAmong([A, B, C])).toEqual([pair(A, B)]);
    expect(await s.service.directory.blockedAmong([B, A])).toEqual([pair(A, B)]);
    // the other side blocks too: still one pair
    value(inRow('block', await s.service.block(ctx, bob.auth, A, true)));
    expect(await s.service.directory.blockedAmong([C, B, A])).toEqual([pair(A, B)]);
    // no chat between a blocked pair, either way
    expect(await s.service.directory.silenced(A, B)).toBe(true);
    expect(await s.service.directory.silenced(B, A)).toBe(true);
    // a mute: Carol no longer hears Alice; nothing else changes
    value(inRow('mute', await s.service.mute(ctx, carol.auth, A, true)));
    expect(await s.service.directory.silenced(C, A)).toBe(true);
    expect(await s.service.directory.silenced(A, C)).toBe(false);
    expect(await s.service.directory.blockedAmong([A, C])).toEqual([]);
    // the account's own list: exactly the view's keys, with the other's current name
    const list = value(inRow('relations', await s.service.relations(ctx, alice.auth)));
    expect(list).toEqual([{ account: B, name: 'Bob', kind: 'block', since: s.clock.now().toISOString() }]);
    for (const r of list) expect(Object.keys(r)).toEqual([...RELATION_VIEW_KEYS]);
    expect(value(await s.service.relations(ctx, carol.auth)).map((r) => [r.name, r.kind])).toEqual([['Alice', 'mute']]);
    // nobody else sees them
    expect(value(await s.service.relations(ctx, bob.auth)).map((r) => r.account)).toEqual([A]);
    // twice is once; off removes only that side's
    value(await s.service.block(ctx, alice.auth, B, true));
    expect(await s.store.relationsOf(A)).toHaveLength(1);
    value(await s.service.block(ctx, alice.auth, B, false));
    expect(await s.service.directory.blockedAmong([A, B])).toEqual([pair(A, B)]);
    value(await s.service.block(ctx, bob.auth, A, false));
    expect(await s.service.directory.blockedAmong([A, B])).toEqual([]);
    expect(await s.service.directory.silenced(A, B)).toBe(false);
    value(await s.service.mute(ctx, carol.auth, A, false));
    expect(await s.service.directory.silenced(C, A)).toBe(false);
    // a block and a mute of one account are two entries
    value(await s.service.block(ctx, alice.auth, C, true));
    value(await s.service.mute(ctx, alice.auth, C, true));
    expect((await s.store.relationsOf(A)).map((r) => r.kind).sort()).toEqual(['block', 'mute']);
  });

  it('refuses itself, a malformed id or flag (badMessage), and a restricted session (its status\'s code)', async () => {
    const s = setup();
    const { alice, bob } = await three(s);
    const ctx = ctxOf(s.clock);
    expect(code(inRow('block', await s.service.block(ctx, alice.auth, alice.auth.account, true)))).toBe('badMessage');
    expect(code(inRow('block', await s.service.block(ctx, alice.auth, 'acc_nope' as AccountId, true)))).toBe('badMessage');
    expect(code(inRow('mute', await s.service.mute(ctx, alice.auth, bob.auth.account, 'yes' as never)))).toBe('badMessage');
    // a ban: block, mute and relations are not restricted calls (3.8)
    await s.service.admin.sanction(OP, alice.auth.account, { kind: 'suspend', reason: 'harassment', until: new Date(s.clock.t + HOUR).toISOString(), message: 'Take a break.' });
    expect(code(inRow('block', await s.service.block(ctx, alice.auth, bob.auth.account, true)))).toBe('suspended');
    expect(code(inRow('mute', await s.service.mute(ctx, alice.auth, bob.auth.account, true)))).toBe('suspended');
    expect(code(inRow('relations', await s.service.relations(ctx, alice.auth)))).toBe('suspended');
    expect(await s.store.relationsOf(alice.auth.account)).toEqual([]);
  });
});

describe('M14-6: one answer whoever the other account is (9.1, 7.3)', () => {
  it('a hidden (suspended, banned, deleting), an erased and an unknown id answer the same; only the hidden ones are stored', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const suspended = await seedAccount(s, 'Sue');
    const banned = await seedAccount(s, 'Ben');
    const deleting = await seedAccount(s, 'Dee');
    const erased = await seedAccount(s, 'Erin');
    const until = new Date(s.clock.t + HOUR).toISOString();
    await s.service.admin.sanction(OP, suspended.id, { kind: 'suspend', reason: 'spam', until, message: 'Suspended.' });
    const ban = await s.service.admin.sanction(OP, banned.id, { kind: 'ban', reason: 'cheating', until: null, message: 'Banned.' });
    await markDeleting(s, deleting.id);
    await erase(s, erased.id);
    const ctx = ctxOf(s.clock);
    const targets: AccountId[] = [suspended.id, banned.id, deleting.id, erased.id, UNKNOWN_ID];
    for (const method of ['block', 'mute'] as const) {
      const answers = [];
      for (const t of targets) answers.push(inRow(method, await s.service[method](ctx, alice.auth, t, true)));
      for (const a of answers) expect(a).toEqual({ ok: true, value: undefined });
      const off = [];
      for (const t of targets) off.push(inRow(method, await s.service[method](ctx, alice.auth, t, false)));
      for (const a of off) expect(a).toEqual({ ok: true, value: undefined });
      for (const t of targets) await s.service[method](ctx, alice.auth, t, true);
    }
    const stored = await s.store.relationsOf(alice.auth.account);
    expect(new Set(stored.map((r) => r.other))).toEqual(new Set([suspended.id, banned.id, deleting.id]));
    expect(stored).toHaveLength(6);
    // the list shows none of them, a hidden account as an erased one (7.3); still in force, and listed again once the account is active
    expect(value(inRow('relations', await s.service.relations(ctx, alice.auth)))).toEqual([]);
    expect(await s.service.directory.silenced(alice.auth.account, banned.id)).toBe(true);
    s.clock.advance(HOUR);
    await s.service.admin.lift(OP, ban.id);
    expect(value(await s.service.relations(ctxOf(s.clock), alice.auth)).map((r) => [r.name, r.kind]).sort()).toEqual([
      ['Ben', 'block'], ['Ben', 'mute'], ['Sue', 'block'], ['Sue', 'mute'],
    ]);
  });
});

describe('M14-6: the relations\' limits (8.1, 9.1)', () => {
  it('30 changes an hour, counted alike for every target (an unknown id included), then rateLimited until the bucket refills', async () => {
    const s = setup();
    const alice = await registerAs(s, 'Alice');
    const bob = await registerAs(s, 'Bob');
    const ctx = ctxOf(s.clock);
    for (let i = 0; i < 15; i++) {
      value(await s.service.block(ctx, alice.auth, i % 2 === 0 ? bob.auth.account : UNKNOWN_ID, true));
      value(await s.service.block(ctx, alice.auth, i % 2 === 0 ? bob.auth.account : UNKNOWN_ID, false));
    }
    const r = inRow('mute', await s.service.mute(ctx, alice.auth, bob.auth.account, true));
    expect(code(r)).toBe('rateLimited');
    if (!r.ok) expect(r.error.retryAfterMs).toBeGreaterThan(0);
    expect(code(await s.service.mute(ctxOf(s.clock), alice.auth, UNKNOWN_ID, true))).toBe('rateLimited');
    s.clock.advance(HOUR);
    value(await s.service.mute(ctxOf(s.clock), alice.auth, bob.auth.account, true));
  });

  it('at most 500 entries: the 501st answers limitReached, for an unknown id too; an existing one is still accepted, and removing one makes room', async () => {
    const s = setup({ env: { ACCOUNTS_RELATION_CHANGES_PER_HOUR: '10000' } });
    const alice = await registerAs(s, 'Alice');
    const others: AccountId[] = [];
    for (let i = 0; i < 501; i++) others.push((await seedAccount(s, seedName(i))).id);
    const at = s.clock.now().toISOString();
    for (let i = 0; i < 500; i++) {
      await s.store.setRelation({ account: alice.auth.account, other: others[i]!, kind: i % 2 === 0 ? 'block' : 'mute', createdAt: at });
    }
    const ctx = ctxOf(s.clock);
    expect(code(inRow('block', await s.service.block(ctx, alice.auth, others[500]!, true)))).toBe('limitReached');
    expect(code(inRow('mute', await s.service.mute(ctx, alice.auth, UNKNOWN_ID, true)))).toBe('limitReached');
    // an entry already there: accepted, nothing added
    value(await s.service.block(ctx, alice.auth, others[0]!, true));
    expect(await s.store.relationsOf(alice.auth.account)).toHaveLength(500);
    value(await s.service.block(ctx, alice.auth, others[0]!, false));
    value(await s.service.block(ctx, alice.auth, others[500]!, true));
    expect(await s.store.relationsOf(alice.auth.account)).toHaveLength(500);
  });

  it('two blocks at once at 499 entries: the first is stored, the second answers limitReached (the cap is checked and written one at a time)', async () => {
    const s = setup({ env: { ACCOUNTS_RELATION_CHANGES_PER_HOUR: '10000' } });
    const alice = await registerAs(s, 'Alice');
    const others: AccountId[] = [];
    for (let i = 0; i < 501; i++) others.push((await seedAccount(s, seedName(i))).id);
    const at = s.clock.now().toISOString();
    for (let i = 0; i < 499; i++) await s.store.setRelation({ account: alice.auth.account, other: others[i]!, kind: 'block', createdAt: at });
    const ctx = ctxOf(s.clock);
    const answers = await Promise.all([s.service.block(ctx, alice.auth, others[499]!, true), s.service.mute(ctx, alice.auth, others[500]!, true)]);
    expect(answers.map((a) => (a.ok ? 'ok' : a.error.code))).toEqual(['ok', 'limitReached']);
    expect(await s.store.relationsOf(alice.auth.account)).toHaveLength(500);
  });
});
