/**
 * M14-5: the counters and compare-and-sets under concurrent requests (design 4.1, 5.2, 6.5, 8.1, 8.2; 13.2's races as fixed interleavings in
 * process): wrong proofs on one session each count once and the 5th revokes it; a proof's hash runs under the in-flight limits of 8.1 in rule 5's
 * class and counts before it; concurrent wrong passwords with one device proof each count once; a password change commits only over the credential
 * its proof verified (a change, or the owner's recovery, landing while it hashes wins); concurrent recovery attempts from one address key stay
 * within rule 4; two renames at once cannot both use one free rename.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_RATE_LIMITS, ACCOUNT_STORE_METHODS, createMemoryAccountStore, type AccountResult, type AccountStore, type HashPriority, type PasswordHasher,
} from '@openmtg/accounts';
import { tokenHash } from '../../src/ids';
import { buildPasswordHasher } from '../../src/crypto/hasher';
import { addressFor, code, configOf, ctxOf, equal, fastDerive, fixedRandom, inRow, MIN, PW, PW2, registerAs, setup, value, type Setup } from './support';

/** Parks verify calls while it is closed (or the next `n` of them), so a test can run another request while one is hashing. */
class Gate {
  private waiting: (() => void)[] = [];
  private closed = false;
  private next = 0;
  parked = 0;
  close(): void {
    this.closed = true;
  }
  /** Parks only the next `n` verify calls. */
  parkNext(n: number): void {
    this.next = n;
  }
  async pass(): Promise<void> {
    if (!this.closed && this.next === 0) return;
    if (this.next > 0) this.next--;
    this.parked++;
    await new Promise<void>((r) => this.waiting.push(r));
    this.parked--;
  }
  open(): void {
    this.closed = false;
    this.next = 0;
    const w = this.waiting;
    this.waiting = [];
    for (const r of w) r();
  }
  async waitParked(n: number): Promise<void> {
    for (let i = 0; i < 10_000 && this.parked < n; i++) await new Promise((r) => setImmediate(r));
    expect(this.parked).toBe(n);
  }
}

/** The suite's fast hasher, with the gate in front of every verify. */
function gatedHasher(gate: Gate): PasswordHasher {
  const config = configOf();
  const inner = buildPasswordHasher(
    { scrypt: config.scrypt, concurrency: config.hashConcurrency, queue: config.hashQueue, peppers: config.peppers, random: fixedRandom('gate'), equal },
    { derive: fastDerive, sleep: async () => undefined },
  );
  return {
    hash: (pw, o) => inner.hash(pw, o),
    async verify(phc, pw, o) {
      await gate.pass();
      return inner.verify(phc, pw, o);
    },
    dummy: (pw, o) => inner.dummy(pw, o),
    load: () => inner.load(),
  };
}

const codes = (rs: AccountResult<unknown>[]) => rs.map((r) => (r.ok ? 'ok' : r.error.code)).sort();
const verifies = (s: Setup) => s.hasher.calls.filter((c) => c.op === 'verify' || c.op === 'dummy');

async function signInAs(s: Setup, name: string, password = PW, over: Parameters<typeof ctxOf>[1] = {}) {
  return value(inRow('signIn', await s.service.signIn(ctxOf(s.clock, { addressKey: addressFor(`signin ${name} ${over.connection ?? ''}`), ...over }), { name, password })));
}

describe('M14-5: wrong proofs under concurrent requests (5.2)', () => {
  it('8 wrong proofs at once on one session: one is checked, the others answer rateLimited; 5 such waves revoke the session after 5 hashes', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    s.hasher.reset();
    for (let wave = 1; wave <= 5; wave++) {
      const answers = await Promise.all(
        Array.from({ length: 8 }, () => s.service.newRecoveryCodes(ctxOf(s.clock), reg.auth, { password: PW2 })),
      );
      for (const r of answers) inRow('newRecoveryCodes', r);
      expect(codes(answers), `wave ${wave}`).toEqual(['badCredentials', ...Array<string>(7).fill('rateLimited')]);
      const row = (await s.store.sessionsOf(reg.auth.account))[0]!;
      expect(row.proofFailures).toBe(wave);
      expect(row.revokedAt === null).toBe(wave < 5);
    }
    expect(verifies(s)).toHaveLength(5);
    expect(code(await s.service.self(ctxOf(s.clock), reg.auth))).toBe('sessionRevoked');
    expect((await s.store.sessionsOf(reg.auth.account))[0]!.revokeReason).toBe('proofFailed');
  });

  it('8 wrong proofs at once on one session from 8 address keys (no in-flight limit shared): the session\'s lock still checks one at a time', async () => {
    const gate = new Gate();
    const s = setup({ hasher: gatedHasher(gate) });
    const reg = await registerAs(s, 'Alice');
    s.hasher.reset();
    for (let wave = 1; wave <= 5; wave++) {
      gate.close();
      const pending = Array.from({ length: 8 }, (_, i) =>
        s.service.newRecoveryCodes(ctxOf(s.clock, { addressKey: addressFor(`wave ${wave} thief ${i}`) }), reg.auth, { password: PW2 }),
      );
      await gate.waitParked(1);
      gate.open();
      const answers = await Promise.all(pending);
      for (const r of answers) inRow('newRecoveryCodes', r);
      expect(codes(answers), `wave ${wave}`).toEqual(['badCredentials', ...Array<string>(7).fill('rateLimited')]);
      const row = (await s.store.sessionsOf(reg.auth.account))[0]!;
      expect(row.proofFailures).toBe(wave);
      expect(row.revokedAt === null).toBe(wave < 5);
    }
    expect(verifies(s)).toHaveLength(5);
    expect((await s.store.sessionsOf(reg.auth.account))[0]!.revokeReason).toBe('proofFailed');
  });

  it('a proof\'s hash: counted before it, 1 in flight per account and address key and 2 per address key, in rule 5\'s class', async () => {
    const gate = new Gate();
    const s = setup({ hasher: gatedHasher(gate) });
    const alice = await registerAs(s, 'Alice');
    const second = await signInAs(s, 'Alice', PW, { connection: 'second' });
    const bob = await registerAs(s, 'Bobby');
    const carol = await registerAs(s, 'Carol');
    const addr = '198.51.100.20';
    // one failure from the address key: rule 5 puts its attempts in `low` for an hour
    expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: addr }), { name: 'Nobody', password: PW }))).toBe('badCredentials');
    s.hasher.reset();
    gate.close();
    const ctx = () => ctxOf(s.clock, { addressKey: addr });
    const pending = [
      s.service.newRecoveryCodes(ctx(), alice.auth, { password: PW }),
      s.service.newRecoveryCodes(ctx(), second.auth, { password: PW }),
      s.service.newRecoveryCodes(ctx(), bob.auth, { password: PW }),
      s.service.newRecoveryCodes(ctx(), carol.auth, { password: PW }),
    ];
    await gate.waitParked(2);
    // a proof in flight is already counted on its session
    const failures = async (auth: { account: string; session: string }) =>
      (await s.store.sessionsOf(auth.account as never)).find((r) => r.id === auth.session)!.proofFailures;
    expect((await failures(alice.auth)) + (await failures(second.auth))).toBe(1);
    expect(await failures(bob.auth)).toBe(1);
    gate.open();
    const [a, a2, b, c] = await Promise.all(pending);
    for (const r of [a, a2, b, c]) inRow('newRecoveryCodes', r!);
    // one of Alice's two sessions (one account, one address key), Bob's; Carol's is the third on the address key
    expect(codes([a!, a2!])).toEqual(['ok', 'rateLimited']);
    expect(value(b!).codes).toHaveLength(10);
    expect(code(c!)).toBe('rateLimited');
    expect(s.hasher.calls.map((x) => x.priority)).toEqual<HashPriority[]>(['low', 'low']);
    // a right proof cleared its count
    expect(await failures(bob.auth)).toBe(0);
    // from a clean address key: `normal`
    s.hasher.reset();
    value(await s.service.newRecoveryCodes(ctxOf(s.clock, { addressKey: '198.51.100.21' }), carol.auth, { password: PW }));
    expect(s.hasher.calls.map((x) => x.priority)).toEqual<HashPriority[]>(['normal']);
  });
});

describe('M14-5: a device proof\'s failures under concurrent requests (8.2 rule 2)', () => {
  it('12 wrong passwords at once with one device proof from 12 address keys: one is checked and counted; after 10 checked failures the proof is spent', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    s.hasher.reset();
    for (let wave = 1; wave <= 10; wave++) {
      const answers = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          s.service.signIn(ctxOf(s.clock, { addressKey: `198.51.100.${100 + i}`, connection: `c${i}` }), { name: 'Alice', password: PW2, device: reg.device }),
        ),
      );
      for (const r of answers) inRow('signIn', r);
      expect(codes(answers), `wave ${wave}`).toEqual(['badCredentials', ...Array<string>(11).fill('rateLimited')]);
      expect((await s.store.device(tokenHash(reg.device)))!.failures).toBe(wave);
      // past the proof's back-off before the next wave
      s.clock.advance(ACCOUNT_RATE_LIMITS.backoffMaxMs + MIN);
    }
    expect(verifies(s).map((c) => c.priority)).toEqual(Array<HashPriority>(10).fill('high'));
    // the proof is spent: the right password still signs in, with a new proof, and not at `high`
    s.hasher.reset();
    const r = value(await s.service.signIn(ctxOf(s.clock, { addressKey: '198.51.100.99' }), { name: 'Alice', password: PW, device: reg.device }));
    expect(r.device).not.toBe(reg.device);
    expect(verifies(s).map((c) => c.priority)).toEqual<HashPriority[]>(['normal']);
  });
});

describe('M14-5: a password change commits only over the credential its proof verified (4.1, 5.2)', () => {
  it('a change by another session while this proof hashes wins: this one answers sessionRevoked and writes nothing', async () => {
    const gate = new Gate();
    const s = setup({ hasher: gatedHasher(gate) });
    const a = await registerAs(s, 'Alice');
    const b = await signInAs(s, 'Alice', PW, { connection: 'b' });
    gate.parkNext(1);
    const stale = s.service.changePassword(ctxOf(s.clock), a.auth, PW, 'the stale request passphrase');
    await gate.waitParked(1);
    // from another address key (the stale proof holds the hash slot of its account on its own)
    value(inRow('changePassword', await s.service.changePassword(ctxOf(s.clock, { addressKey: '192.0.2.160' }), b.auth, PW, PW2)));
    gate.open();
    expect(code(inRow('changePassword', await stale))).toBe('sessionRevoked');
    expect(value(await s.service.self(ctxOf(s.clock), b.auth)).name).toBe('Alice');
    await signInAs(s, 'Alice', PW2, { connection: 'after' });
    expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.150' }), { name: 'Alice', password: 'the stale request passphrase' }))).toBe('badCredentials');
  });

  it('the owner\'s recovery while a leaked password\'s change hashes wins: the stale change answers sessionRevoked, the recovered password stands', async () => {
    const gate = new Gate();
    const s = setup({ hasher: gatedHasher(gate) });
    const owner = await registerAs(s, 'Alice');
    const thief = await signInAs(s, 'Alice', PW, { connection: 'thief' });
    gate.parkNext(1);
    const stale = s.service.changePassword(ctxOf(s.clock, { connection: 'thief' }), thief.auth, PW, 'the thief passphrase here');
    await gate.waitParked(1);
    const rec = value(await s.service.useRecoveryCode(ctxOf(s.clock, { addressKey: '192.0.2.44' }), { name: 'Alice', code: owner.recoveryCodes![0]!, newPassword: PW2 }));
    gate.open();
    expect(code(inRow('changePassword', await stale))).toBe('sessionRevoked');
    expect(value(await s.service.self(ctxOf(s.clock), rec.auth)).name).toBe('Alice');
    await signInAs(s, 'Alice', PW2, { connection: 'owner again' });
    expect(code(await s.service.signIn(ctxOf(s.clock, { addressKey: '192.0.2.151' }), { name: 'Alice', password: 'the thief passphrase here' }))).toBe('badCredentials');
  });

  it('a credential replaced while the proof hashes (the session still live): the compare-and-set on the verified string fails, badCredentials, nothing revoked', async () => {
    const gate = new Gate();
    const s = setup({ hasher: gatedHasher(gate) });
    const a = await registerAs(s, 'Alice');
    const other = await signInAs(s, 'Alice', PW, { connection: 'other' });
    gate.parkNext(1);
    const stale = s.service.changePassword(ctxOf(s.clock), a.auth, PW, 'the stale request passphrase');
    await gate.waitParked(1);
    // another writer replaces the credential by compare-and-set (as an email reset's would), without touching the sessions
    const cur = (await s.store.credentials(a.auth.account))[0]!;
    await s.store.putCredential({ ...cur, secret: await s.hasher.hash(PW2, { priority: 'normal' }) }, cur.secret);
    gate.open();
    expect(code(inRow('changePassword', await stale))).toBe('badCredentials');
    expect(value(await s.service.self(ctxOf(s.clock), other.auth)).name).toBe('Alice');
    await signInAs(s, 'Alice', PW2, { connection: 'after' });
    expect((await s.service.changes(0, 100)).filter((c) => c.kind === 'sessionsRevoked')).toEqual([]);
  });
});

describe('M14-5: recovery attempts at once from one address key (8.2 rule 4)', () => {
  it('30 wrong codes at once: 10 are checked, 20 answer rateLimited, and so does the next', async () => {
    const s = setup();
    await registerAs(s, 'Alice');
    const ctx = () => ctxOf(s.clock, { addressKey: '198.51.100.70', guestSession: null });
    const answers = await Promise.all(
      Array.from({ length: 30 }, () => s.service.useRecoveryCode(ctx(), { name: 'Alice', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: PW2 })),
    );
    for (const r of answers) inRow('useRecoveryCode', r);
    expect(codes(answers)).toEqual([...Array<string>(10).fill('badCredentials'), ...Array<string>(20).fill('rateLimited')]);
    expect(code(await s.service.useRecoveryCode(ctx(), { name: 'Alice', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: PW2 }))).toBe('rateLimited');
  });
});

/** The memory store with `updateAccount` held once, when it is asked to clear a free rename, until `release()`. */
function holdingFreeRenameStore() {
  const inner = createMemoryAccountStore();
  let held = false;
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let reached!: () => void;
  const reachedP = new Promise<void>((r) => (reached = r));
  const store = Object.fromEntries(
    ACCOUNT_STORE_METHODS.map((m) => [m, (...args: unknown[]) => (inner[m] as (...a: unknown[]) => unknown).apply(inner, args)]),
  ) as unknown as AccountStore;
  store.updateAccount = async (id, version, patch) => {
    if (!held && Object.keys(patch).length === 1 && patch.freeRename === false) {
      held = true;
      reached();
      await released;
    }
    return inner.updateAccount(id, version, patch);
  };
  return { store, inner, release: () => release(), reached: reachedP };
}

describe('M14-5: one free rename, two renames at once (6.5)', () => {
  it('the free rename is used up before the rename: the other rename meets the cooldown', async () => {
    const h = holdingFreeRenameStore();
    const s = setup({ store: h.store });
    const reg = await registerAs(s, 'Alice');
    const second = await signInAs(s, 'Alice', PW, { connection: 'second' });
    s.clock.advance(MIN);
    value(await s.service.rename(ctxOf(s.clock), reg.auth, 'Alicea', { password: PW }));
    // a forced rename's free rename
    const a = (await h.inner.account(reg.auth.account))!;
    await h.inner.updateAccount(a.id, a.version, { freeRename: true });
    s.clock.advance(MIN);
    const first = s.service.rename(ctxOf(s.clock), reg.auth, 'Carolina', { password: PW });
    await h.reached;
    const other = inRow('rename', await s.service.rename(ctxOf(s.clock, { connection: 'second' }), second.auth, 'Bobbington', { password: PW }));
    h.release();
    const one = inRow('rename', await first);
    expect(codes([one, other])).toEqual(['ok', 'renameCooldown']);
    const history = (await h.inner.nameHistory(reg.auth.account)).map((x) => x.name);
    expect(history).toEqual(['Alice', 'Alicea', 'Bobbington']);
    expect((await h.inner.account(reg.auth.account))!.freeRename).toBe(false);
  });

  it('a rename that fails after using up the free rename gives it back', async () => {
    const s = setup();
    const reg = await registerAs(s, 'Alice');
    await registerAs(s, 'Bobby');
    s.clock.advance(MIN);
    value(await s.service.rename(ctxOf(s.clock), reg.auth, 'Alicea', { password: PW }));
    const a = (await s.store.account(reg.auth.account))!;
    await s.store.updateAccount(a.id, a.version, { freeRename: true });
    // the store refuses the key ("exists": the checks passed, then a racing registration took it); simulated by taking it between check and rename
    const rename = s.store.rename.bind(s.store);
    s.store.rename = async () => {
      throw Object.assign(new Error('taken'), { code: 'exists' });
    };
    expect(code(inRow('rename', await s.service.rename(ctxOf(s.clock), reg.auth, 'Carolina', { password: PW })))).toBe('nameTaken');
    s.store.rename = rename;
    expect((await s.store.account(reg.auth.account))!.freeRename).toBe(true);
    value(await s.service.rename(ctxOf(s.clock), reg.auth, 'Carolina', { password: PW }));
    expect((await s.store.account(reg.auth.account))!.freeRename).toBe(false);
  });
});
