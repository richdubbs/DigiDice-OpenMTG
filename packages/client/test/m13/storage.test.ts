/**
 * M13-11: what the page keeps of its hosted session (hosted/storage.ts; hosted design D6, 3.2, 4.3): the token and the command counter survive a reload and
 * a closed browser (for the one tab that owns the identity), a second tab of the same browser plays as a guest of its own, the table and the codes stay
 * in the tab, and a browser that blocks storage still works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHostedStorage, EMPTY_SESSION, MemoryHostedStorage, parseStoredSession, type BrowserStorageEnv, type StoredSession } from '../../src/hosted/storage';
import { CLOCK, FakeLocks, fakeStorage, OTHER_TOKEN, SERVER, TOKEN } from './fakes';

const KEY = `openmtg.hosted.${SERVER}`;
const LOCK = `openmtg-hosted:${SERVER}`;

/** One tab: its own sessionStorage, the browser's localStorage and locks. */
function tab(local: ReturnType<typeof fakeStorage>, locks: FakeLocks | null, session = fakeStorage(), lockWaitMs = 1500) {
  const env: BrowserStorageEnv = { local, session, locks, lockWaitMs };
  return { env, session, storage: new BrowserHostedStorage(SERVER, env) };
}

const withToken = (token: string, extra: Partial<StoredSession> = {}): StoredSession => ({ ...EMPTY_SESSION, token, name: 'Alice', nextId: 7, ...extra });
const TABLE = { table: 'T1', title: 'Friday', format: 'casual' as const, source: 'private' as const, status: 'lobby' as const, clock: CLOCK, seats: [{ seat: 1 as const, name: 'Alice' }], you: 1 as const };

describe('parseStoredSession', () => {
  it('reads back what was saved, and drops what is not a session or has no valid token', () => {
    expect(parseStoredSession(JSON.stringify(withToken(TOKEN)))).toMatchObject({ token: TOKEN, nextId: 7, name: 'Alice' });
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession('not json')).toBeNull();
    expect(parseStoredSession('[1]')).toBeNull();
    expect(parseStoredSession(JSON.stringify({ token: 'short', nextId: 3 }))).toMatchObject({ token: null, nextId: 3 });
    expect(parseStoredSession(JSON.stringify({ token: TOKEN, nextId: -4 }))).toMatchObject({ nextId: 1 });
    expect(parseStoredSession(JSON.stringify({ token: TOKEN, nextId: 1.5 }))).toMatchObject({ nextId: 1 });
    expect(parseStoredSession(JSON.stringify({ token: TOKEN, table: 'x', codes: 5 }))).toMatchObject({ table: null, codes: null });
  });
});

describe('MemoryHostedStorage', () => {
  it('keeps one session', async () => {
    const m = new MemoryHostedStorage();
    expect(await m.open()).toEqual(EMPTY_SESSION);
    m.save(withToken(TOKEN));
    expect((await m.open()).token).toBe(TOKEN);
  });
});

describe("the browser's storage", () => {
  it('the first tab owns the identity: it goes to the tab storage and the browser storage, and the next page finds it', async () => {
    const local = fakeStorage();
    const locks = new FakeLocks();
    const a = tab(local, locks);
    expect(await a.storage.open()).toEqual(EMPTY_SESSION);
    a.storage.save(withToken(TOKEN, { table: TABLE }));
    expect(locks.isHeld(LOCK)).toBe(true);
    expect(JSON.parse(a.session.data.get(KEY)!)).toMatchObject({ token: TOKEN, table: { table: 'T1' } });
    // the browser's copy holds the identity only: another tab never inherits this tab's table or codes
    expect(JSON.parse(local.data.get(KEY)!)).toMatchObject({ token: TOKEN, nextId: 7, table: null, codes: null });
  });

  it('a reload of that tab continues the same guest (its own storage) and takes the lock back from the page it replaces', async () => {
    const local = fakeStorage();
    const locks = new FakeLocks();
    const a = tab(local, locks);
    await a.storage.open();
    a.storage.save(withToken(TOKEN, { table: TABLE, codes: { table: 'T1', list: [{ seat: 2, code: 'K7Q2-M9XD-4TPA-HW3N' }] } }));
    // the page goes away; the new one starts while the old one's lock is still being let go
    const reloaded = tab(local, locks, a.session);
    const opening = reloaded.storage.open();
    locks.release(LOCK);
    const s = await opening;
    expect(s).toMatchObject({ token: TOKEN, nextId: 7, table: { table: 'T1' }, codes: { table: 'T1' } });
    reloaded.storage.save({ ...s, nextId: 8 });
    expect(JSON.parse(local.data.get(KEY)!).nextId).toBe(8);
  });

  it("a second tab of the same browser plays as a guest of its own and never touches the first one's identity", async () => {
    const local = fakeStorage();
    const locks = new FakeLocks();
    const a = tab(local, locks);
    await a.storage.open();
    a.storage.save(withToken(TOKEN));
    const b = tab(local, locks);
    const s = await b.storage.open();
    expect(s.token).toBeNull();
    expect(s.name).toBe('Alice'); // the name it last used is a fair first guess
    b.storage.save({ ...EMPTY_SESSION, token: OTHER_TOKEN, nextId: 3 });
    expect(JSON.parse(b.session.data.get(KEY)!).token).toBe(OTHER_TOKEN);
    expect(JSON.parse(local.data.get(KEY)!).token).toBe(TOKEN);
  });

  it('a browser that was closed and opened again finds the identity in its storage (nothing holds the lock then)', async () => {
    const local = fakeStorage();
    const locks = new FakeLocks();
    const a = tab(local, locks);
    await a.storage.open();
    a.storage.save(withToken(TOKEN, { table: TABLE }));
    locks.release(LOCK);
    const fresh = tab(local, locks); // a new tab: empty tab storage
    const s = await fresh.storage.open();
    expect(s).toMatchObject({ token: TOKEN, nextId: 7, name: 'Alice', table: null, codes: null });
    expect(locks.isHeld(LOCK)).toBe(true);
  });

  it('a page that opens its storage twice (a screen that connects twice: StrictMode, Try again) still owns the identity', async () => {
    const local = fakeStorage();
    const locks = new FakeLocks();
    const a = tab(local, locks);
    // both opens begin before either finishes, as React's StrictMode runs an effect twice
    const [first, second] = await Promise.all([a.storage.open(), a.storage.open()]);
    expect(first).toEqual(EMPTY_SESSION);
    expect(second).toEqual(EMPTY_SESSION);
    a.storage.save(withToken(TOKEN));
    expect(JSON.parse(local.data.get(KEY)!).token).toBe(TOKEN);
    // and again later, with the token known
    const third = await a.storage.open();
    expect(third.token).toBe(TOKEN);
    a.storage.save({ ...third, nextId: 12 });
    expect(JSON.parse(local.data.get(KEY)!).nextId).toBe(12);
  });

  describe('timing', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("a reloaded tab that cannot get the lock in time goes on with its own token and leaves the browser's copy alone", async () => {
      const local = fakeStorage();
      const locks = new FakeLocks();
      const a = tab(local, locks);
      await a.storage.open();
      a.storage.save(withToken(TOKEN));
      // the lock is held by someone (the old page, or another tab that has taken the identity over) and never let go
      const reloaded = tab(local, locks, a.session, 1500);
      const opening = reloaded.storage.open();
      await vi.advanceTimersByTimeAsync(1600);
      const s = await opening;
      expect(s.token).toBe(TOKEN);
      local.data.set(KEY, JSON.stringify(withToken(OTHER_TOKEN)));
      reloaded.storage.save({ ...s, nextId: 99 });
      expect(JSON.parse(local.data.get(KEY)!).token).toBe(OTHER_TOKEN);
      expect(JSON.parse(reloaded.session.data.get(KEY)!).nextId).toBe(99);
    });
  });

  it('without the Web Locks API the first tab owns the identity', async () => {
    const local = fakeStorage();
    const a = tab(local, null);
    await a.storage.open();
    a.storage.save(withToken(TOKEN));
    expect(JSON.parse(local.data.get(KEY)!).token).toBe(TOKEN);
  });

  it('a damaged or foreign value is not used', async () => {
    const local = fakeStorage();
    local.data.set(KEY, '{"token": 42}');
    const a = tab(local, new FakeLocks());
    expect(await a.storage.open()).toEqual(EMPTY_SESSION);
  });

  it('a browser that blocks storage still works, keeping nothing', async () => {
    const a = tab(fakeStorage(true), new FakeLocks(), fakeStorage(true));
    expect(await a.storage.open()).toEqual(EMPTY_SESSION);
    expect(() => a.storage.save(withToken(TOKEN))).not.toThrow();
    const none = new BrowserHostedStorage(SERVER, { local: null, session: null, locks: null, lockWaitMs: 10 });
    expect(await none.open()).toEqual(EMPTY_SESSION);
    expect(() => none.save(withToken(TOKEN))).not.toThrow();
  });

  it('every server has its own keys', async () => {
    const local = fakeStorage();
    const a = tab(local, new FakeLocks());
    await a.storage.open();
    a.storage.save(withToken(TOKEN));
    const other = new BrowserHostedStorage('wss://play.example.net', { local, session: fakeStorage(), locks: new FakeLocks(), lockWaitMs: 10 });
    expect(await other.open()).toEqual(EMPTY_SESSION);
  });
});
