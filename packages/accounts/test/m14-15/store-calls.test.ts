/**
 * M14-15, security review pass A, finding A2: the answers 7.3 says are alike do the same store work. A hidden account (banned, suspended,
 * deleting) answers by name like a held, banned, reserved, erased or free key, and by id like an erased or unknown one; the answers were alike
 * but each path did one or two more store calls for a hidden account, a round trip each on PostgreSQL. In process: the memory store wrapped to
 * record every call's name (spyStore), the real moderation part, a fake clock and fixed inputs (owner rule). For each method every path's list of
 * store calls is the same: profile (by id and by name), signIn with a wrong password (with and without a device proof), useRecoveryCode with a
 * wrong code, block and mute, and report.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryAccountStore, type AccountId, type RequestContext, type SignedIn } from '@openmtg/accounts';
import { DAY, erase, markDeleting, OP, PW, PW2, registerAs, setup, UNKNOWN_ID, value } from '../m14-6/support';
import { spyStore } from '../m14-8/support';
import { addressFor, ctxOf, inRow, type Setup } from '../m14-5/support';

/** The audit queue's own flush may run in between (a timer): it is no part of a request's work. */
const NOT_REQUEST = new Set(['appendAudit']);

interface World {
  s: Setup;
  calls: string[];
  alice: SignedIn;
  /** Every kind of name a sign-in, a recovery or a profile may be given. */
  names: Record<string, string>;
  /** Every kind of id a profile, a block or a report may be given. */
  ids: Record<string, AccountId>;
}

async function world(): Promise<World> {
  const calls: string[] = [];
  const s = setup({ store: spyStore(createMemoryAccountStore(), calls) });
  const alice = await registerAs(s, 'Alice');
  const bobby = await registerAs(s, 'Bobby');
  const sue = await registerAs(s, 'Susan');
  const dee = await registerAs(s, 'Deedee');
  const carl = await registerAs(s, 'Carl');
  const hank = await registerAs(s, 'Hank');
  const erin = await registerAs(s, 'Erin');
  await s.service.admin.sanction(OP, bobby.auth.account, { kind: 'ban', reason: 'cheating', until: null, message: 'Banned.' });
  await s.service.admin.sanction(OP, sue.auth.account, {
    kind: 'suspend', reason: 'chat', until: new Date(s.clock.t + 7 * DAY).toISOString(), message: 'Suspended.',
  });
  await markDeleting(s, dee.auth.account);
  // "Carl" banned by a forced rename, "Hank" held by the account's own rename, "Rex" reserved, "Erin" held for nobody after the erasure
  await s.service.admin.forceRename(OP, carl.auth.account, 'name');
  value(await s.service.rename(ctxOf(s.clock, { addressKey: addressFor('register Hank') }), hank.auth, 'Henry', { password: PW }));
  await s.service.admin.reserveName(OP, 'Rex');
  await erase(s, erin.auth.account);
  return {
    s, calls, alice,
    names: { banned: 'Bobby', suspended: 'Susan', deleting: 'Deedee', bannedKey: 'Carl', held: 'Hank', reserved: 'Rex', erased: 'Erin', free: 'Nobody' },
    ids: { banned: bobby.auth.account, suspended: sue.auth.account, deleting: dee.auth.account, erased: erin.auth.account, unknown: UNKNOWN_ID },
  };
}

/** The store calls `f` makes (the audit queue's flush left out). */
async function callsOf(w: World, f: () => Promise<unknown>): Promise<string[]> {
  w.calls.length = 0;
  await f();
  return w.calls.filter((c) => !NOT_REQUEST.has(c));
}

/** Each path's calls, and a check that they are all the same list. */
async function alike(w: World, paths: Record<string, () => Promise<unknown>>): Promise<string[]> {
  const out: Record<string, string[]> = {};
  for (const [path, f] of Object.entries(paths)) out[path] = await callsOf(w, f);
  const first = Object.values(out)[0]!;
  for (const [path, list] of Object.entries(out)) expect(list, path).toEqual(first);
  return first;
}

/** A context of its own for each attempt (no back-off or allowance is shared between the paths). */
const fresh = (w: World, who: string): RequestContext => ctxOf(w.s.clock, { connection: `conn-${who}`, guestSession: null, addressKey: addressFor(who) });

describe('M14-15 A2: the same store calls for every answer 7.3 says is alike', () => {
  it('profile by id: a hidden account, an erased one and an unknown id (and an active one) cost the same', async () => {
    const w = await world();
    const paths = Object.fromEntries(
      Object.entries({ ...w.ids, active: w.alice.auth.account }).map(([k, id]) => [k, () => w.s.service.profile(fresh(w, `p ${k}`), { account: id })]),
    );
    expect(await alike(w, paths)).toEqual(['account', 'sanctionsOf']);
    for (const id of Object.values(w.ids)) expect(inRow('profile', await w.s.service.profile(fresh(w, 'p'), { account: id })).ok).toBe(false);
  });

  it('profile by name: every hidden account and every held, banned, reserved, erased or free key cost the same', async () => {
    const w = await world();
    const paths = Object.fromEntries(
      Object.entries({ ...w.names, active: 'Alice' }).map(([k, name]) => [k, () => w.s.service.profile(fresh(w, `n ${k}`), { name })]),
    );
    expect(await alike(w, paths)).toEqual(['nameKeyVersion', 'nameEntry', 'account', 'sanctionsOf']);
  });

  it('signIn with a wrong password, with and without a device proof: the same calls for every name', async () => {
    const w = await world();
    const device = '0123456789abcdef'.repeat(4);
    const without = Object.fromEntries(
      Object.entries(w.names).map(([k, name]) => [k, () => w.s.service.signIn(fresh(w, `s ${k}`), { name, password: PW2 })]),
    );
    expect(await alike(w, without)).toEqual(['nameKeyVersion', 'nameEntry', 'account', 'credentials']);
    const withDevice = Object.fromEntries(
      Object.entries(w.names).map(([k, name]) => [k, () => w.s.service.signIn(fresh(w, `d ${k}`), { name, password: PW2, device })]),
    );
    expect(await alike(w, withDevice)).toEqual(['nameKeyVersion', 'nameEntry', 'account', 'device', 'credentials']);
    for (const name of Object.values(w.names)) {
      const r = inRow('signIn', await w.s.service.signIn(fresh(w, `again ${name}`), { name, password: PW2 }));
      expect(r.ok ? 'ok' : r.error.code, name).toBe('badCredentials');
    }
  });

  it('useRecoveryCode with a wrong code: the same calls for every name', async () => {
    const w = await world();
    const paths = Object.fromEntries(
      Object.entries(w.names).map(([k, name]) => [
        k, () => w.s.service.useRecoveryCode(fresh(w, `r ${k}`), { name, code: 'AAAA-BBBB-CCCC-DDDD', newPassword: 'a brand new passphrase' }),
      ]),
    );
    expect(await alike(w, paths)).toEqual(['nameKeyVersion', 'nameEntry', 'account', 'recoveryCodes']);
  });

  it('block and mute: one write for a hidden account, an erased one and an unknown id alike; the store keeps only the first', async () => {
    const w = await world();
    const ctx = fresh(w, 'alice');
    // the session's lastUsedAt brought up to date, so no call below writes it
    value(await w.s.service.self(ctx, w.alice.auth));
    for (const kind of ['block', 'mute'] as const) {
      const paths = Object.fromEntries(
        Object.entries(w.ids).map(([k, id]) => [k, () => w.s.service[kind](ctx, w.alice.auth, id, true)]),
      );
      const list = await alike(w, paths);
      expect(list.slice(-2)).toEqual(['relationsOf', 'setRelation']);
      // again: the entry already there is written again as it is, so a second block costs the same whoever it names
      const again = await alike(w, paths);
      expect(again).toEqual(list);
    }
    const kept = (await w.s.store.relationsOf(w.alice.auth.account)).map((r) => r.other);
    expect(new Set(kept)).toEqual(new Set([w.ids.banned, w.ids.suspended, w.ids.deleting]));
  });

  it('report: the target read and one write for a hidden account, an erased one and an unknown id alike; the store keeps only the hidden one\'s', async () => {
    const w = await world();
    const ctx = fresh(w, 'alice');
    value(await w.s.service.self(ctx, w.alice.auth));
    const paths = Object.fromEntries(
      Object.entries(w.ids).map(([k, id]) => [
        k, () => w.s.service.report(ctx, { kind: 'account', auth: w.alice.auth }, { target: { account: id }, reason: 'chat' }),
      ]),
    );
    const list = await alike(w, paths);
    expect(list.slice(-2)).toEqual(['account', 'putReport']);
    const filed = (await w.s.store.reports({ limit: 100, reporter: w.alice.auth.account })).map((r) => 'account' in r.target && r.target.account);
    expect(new Set(filed)).toEqual(new Set([w.ids.banned, w.ids.suspended, w.ids.deleting]));
  });
});
