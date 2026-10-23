/**
 * M13-6: every per-command limit of design 3.6 and the seated flood gate, through the gateway with a fake clock and fixed inputs (no floods: each
 * limit is met by exactly its burst, the refusal is read, the clock moves by exactly the wait the refusal named, and the command works again), plus
 * the join-attempt lock-outs (codes and passwords: 1/s burst 5 per session and per address key, 10 failures in 10 minutes lock both for 10 minutes).
 */
import { describe, expect, it, vi } from 'vitest';
import { CLOSE_REFUSED } from '../../src/api';
import { COMMAND_LIMITS } from '../../src/config';
import { METRICS } from '../../src/obs';
import { type Browser, counted, createTable, FakePasswords, freshPeer, guest, makeGateway, settle, startTable, TEST_DECK } from './harness';

const FAR_TABLE = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

/** One command's limit: its message, its burst, the wait the refusal names, and the code its allowed calls answer (never rateLimited). */
interface Limit {
  name: string;
  msg: Parameters<Browser['cmd']>[0];
  burst: number;
  waitMs: number;
  code: string | 'ok';
}

const LIMITS: Limit[] = [
  { name: 'browse', msg: { t: 'browse', filter: {}, sort: 'newest', page: 0 }, burst: 4, waitMs: 500, code: 'notYet' },
  { name: 'watchLobby', msg: { t: 'watchLobby', filter: null }, burst: 1, waitMs: 5_000, code: 'notYet' },
  { name: 'join', msg: { t: 'join', table: FAR_TABLE, deck: TEST_DECK }, burst: 2, waitMs: 1_000, code: 'noTable' },
  { name: 'codes', msg: { t: 'codes' }, burst: 1, waitMs: 10_000, code: 'notAllowed' },
  { name: 'queue', msg: { t: 'queue', format: 'casual', size: 2, deck: TEST_DECK }, burst: 1, waitMs: 5_000, code: 'notYet' },
  { name: 'ready', msg: { t: 'ready', start: 'abcd' }, burst: 4, waitMs: 500, code: 'notAllowed' },
  { name: 'vote', msg: { t: 'vote', proposal: 1, accept: true }, burst: 4, waitMs: 500, code: 'notStarted' },
  { name: 'leave', msg: { t: 'leave' }, burst: 2, waitMs: 1_000, code: 'ok' },
  { name: 'report', msg: { t: 'report', kind: 'bug', text: 'it broke' }, burst: 1, waitMs: 60_000, code: 'notYet' },
  { name: 'history', msg: { t: 'history' }, burst: 2, waitMs: 5_000, code: 'ok' },
  { name: 'spectate', msg: { t: 'spectate' }, burst: 2, waitMs: 1_000, code: 'notYet' },
];

const codeOf = (r: { ok: boolean } & Record<string, unknown>): string => (r.ok ? 'ok' : (r['error'] as { code: string }).code);

/** The replies a browser got after the first `from` ones, as [command id, 'ok' or the error code]. */
const repliesAfter = (b: Browser, from: number): [number, string][] => b.of('reply').slice(from).map((r) => [r.id, r.ok ? 'ok' : r.error.code]);

describe('M13-6 limits per command (design 3.6): the burst, the named wait, and again', () => {
  it('the table of limits is the design\'s', () => {
    expect(Object.fromEntries(LIMITS.map((l) => [l.name, [COMMAND_LIMITS[l.name as keyof typeof COMMAND_LIMITS].burst, Math.round(1000 / COMMAND_LIMITS[l.name as keyof typeof COMMAND_LIMITS].rate)]]))).toEqual({
      browse: [4, 500], watchLobby: [1, 5_000], join: [2, 1_000], codes: [1, 10_000], queue: [1, 5_000], ready: [4, 500], vote: [4, 500], leave: [2, 1_000],
      report: [1, 60_000], history: [2, 5_000], spectate: [2, 1_000],
    });
    expect([COMMAND_LIMITS.create.burst, Math.round(1000 / COMMAND_LIMITS.create.rate), COMMAND_LIMITS.ping.burst, COMMAND_LIMITS.ping.rate]).toEqual([1, 10_000, 5, 1]);
  });

  for (const l of LIMITS) {
    it(`${l.name}: ${l.burst} at once, then rateLimited with retryAfterMs ${l.waitMs}; after that wait it works again`, async () => {
      const t = makeGateway();
      const b = await guest(t, 'Alice');
      for (let i = 0; i < l.burst; i++) {
        const r = await b.cmd(l.msg);
        expect(codeOf(r), `${l.name} ${i + 1}`).toBe(l.code);
      }
      const refused = await b.cmd(l.msg);
      expect(refused).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMs: l.waitMs } });
      t.clock.advance(l.waitMs - 1);
      expect(codeOf(await b.cmd(l.msg)), 'a millisecond early').toBe('rateLimited');
      // That refusal did not move the bucket: one more millisecond and the token is there.
      t.clock.advance(1);
      expect(codeOf(await b.cmd(l.msg)), 'on time').toBe(l.code);
      expect(counted(t.metrics, METRICS.refusals, { reason: 'rateLimited' })).toBe(2);
      expect(b.client.closed).toBeNull();
    });
  }

  it('create: one, then rateLimited for 10 s; afterwards `busy`, not rateLimited (the session already has a table)', async () => {
    const t = makeGateway();
    const b = await guest(t, 'Alice');
    const msg = { t: 'create', format: 'casual', seats: 2, visibility: 'private', deck: TEST_DECK } as const;
    expect((await b.cmd(msg)).ok).toBe(true);
    expect(await b.cmd(msg)).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMs: 10_000 } });
    t.clock.advance(10_000);
    expect(await b.cmd(msg)).toMatchObject({ ok: false, error: { code: 'busy' } });
  });

  it('queue and unqueue share one bucket (1 per 5 s)', async () => {
    const t = makeGateway();
    const b = await guest(t, 'Alice');
    expect(codeOf(await b.cmd({ t: 'queue', format: 'casual', size: 2, deck: TEST_DECK }))).toBe('notYet');
    expect(await b.cmd({ t: 'unqueue' })).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMs: 5_000 } });
    t.clock.advance(5_000);
    expect(await b.cmd({ t: 'unqueue' })).toMatchObject({ ok: true });
  });

  it('ping: 5 at once are free and each is answered pong; the 6th is a strike (no answer); a second later one more is free and answered again', async () => {
    const t = makeGateway();
    const b = await guest(t, 'Alice');
    for (let i = 0; i < 5; i++) b.client.send({ t: 'ping' });
    await settle(3);
    expect(counted(t.metrics, METRICS.strikes)).toBe(0);
    expect(b.of('pong')).toEqual(Array.from({ length: 5 }, () => ({ t: 'pong' })));
    b.client.send({ t: 'ping' });
    await settle(3);
    expect(counted(t.metrics, METRICS.strikes)).toBe(1);
    expect(b.of('pong')).toHaveLength(5);
    t.clock.advance(1_000);
    b.client.send({ t: 'ping' });
    await settle(3);
    expect(counted(t.metrics, METRICS.strikes)).toBe(1);
    expect(b.of('pong')).toHaveLength(6);
    expect(b.client.closed).toBeNull();
    // a ping that is not allowed to keep the connection alive: 30 more strikes close it
    for (let i = 0; i < 31; i++) b.client.send({ t: 'ping' });
    await b.client.until(() => b.client.closed !== null);
    expect(b.client.closed).toMatchObject({ code: CLOSE_REFUSED });
  });

  it('limits belong to the connection: another browser has its own buckets', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const c = await guest(t, 'Carol');
    for (let i = 0; i < 4; i++) await a.cmd(LIMITS[0]!.msg);
    expect(codeOf(await a.cmd(LIMITS[0]!.msg))).toBe('rateLimited');
    expect(codeOf(await c.cmd(LIMITS[0]!.msg))).toBe('notYet');
  });
});

describe('M13-6 the seated flood gate: actions, stop changes, chat (net\'s GuestGate on the gateway\'s clock)', () => {
  const pass = (id: number) => ({ t: 'act', id, seq: 0, action: { type: 'pass', player: 'p1' } });
  const acts = (t: ReturnType<typeof makeGateway>) => t.runtime.inputs.filter((i) => i.input.t === 'act').length;

  it('20 actions a second with a burst of 50; 32 more wait for tokens in order; the next is refused rateLimited', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const seen = a.of('reply').length;
    for (let i = 1; i <= 50; i++) a.client.send(pass(i));
    await settle(5);
    expect(acts(t)).toBe(50);
    for (let i = 51; i <= 82; i++) a.client.send(pass(i));
    await settle(5);
    expect(acts(t)).toBe(50); // queued, not run
    a.client.send(pass(83));
    await settle(5);
    expect(repliesAfter(a, seen)).toEqual([[83, 'rateLimited']]);
    // a second later 20 tokens are there: the oldest 20 queued actions run, in order
    t.clock.advance(1_000);
    await vi.waitFor(() => expect(acts(t)).toBe(70), { timeout: 5_000, interval: 20 });
    expect(t.runtime.inputs.filter((i) => i.input.t === 'act').slice(50).map((i) => (i.input as { id: number }).id)).toEqual(Array.from({ length: 20 }, (_, i) => 51 + i));
    t.clock.advance(1_000);
    await vi.waitFor(() => expect(acts(t)).toBe(82), { timeout: 5_000, interval: 20 });
    t.gateway.close();
  });

  it('setStops needs a token of its own bucket: 5 at once, then 1 a second', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const seen = a.of('reply').length;
    const stops = (id: number) => ({ t: 'act', id, seq: 0, action: { type: 'setStops', player: 'p1', stops: { ownTurn: ['main1'], opponentTurn: [], fullControl: false } } });
    for (let i = 1; i <= 6; i++) a.client.send(stops(i));
    await settle(5);
    expect(acts(t)).toBe(5);
    expect(repliesAfter(a, seen)).toEqual([[6, 'rateLimited']]);
    expect(a.of('reply').at(-1)).toMatchObject({ error: { message: 'Too many stop changes; wait a moment.' } });
    t.clock.advance(1_000);
    a.client.send(stops(7));
    await settle(5);
    expect(acts(t)).toBe(6);
  });

  it('game chat: 2 a second with a burst of 5; more is refused; lobby chat has the same limit', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const seen = a.of('reply').length;
    for (let i = 1; i <= 6; i++) a.client.send({ t: 'chat', id: i, text: `line ${i}` });
    await settle(5);
    expect(t.runtime.inputs.filter((i) => i.input.t === 'chat')).toHaveLength(5);
    expect(repliesAfter(a, seen)).toEqual([[6, 'rateLimited']]);
    // not seated in a game yet: the table's lobby chat, the gateway's own bucket
    const lobby = await guest(t, 'Lobby');
    await createTable(lobby);
    for (let i = 1; i <= 5; i++) expect((await lobby.cmd({ t: 'chat', text: `hi ${i}` })).ok, `chat ${i}`).toBe(true);
    expect(await lobby.cmd({ t: 'chat', text: 'hi 6' })).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    t.clock.advance(500);
    expect((await lobby.cmd({ t: 'chat', text: 'hi 7' })).ok).toBe(true);
  });

  it('a seated flood that keeps going is closed (4004): the gate\'s 30 strikes', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    // 32 chat lines over the burst of 5: each refusal is a strike; the 31st closes the connection
    for (let i = 1; i <= 36; i++) a.client.send({ t: 'chat', id: i, text: `spam ${i}` });
    await a.client.until(() => a.client.closed !== null);
    expect(a.client.closed).toMatchObject({ code: CLOSE_REFUSED });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'strikes' })).toBe(1);
  });
});

describe('M13-6 sync: at most one full view per 5 s per connection; more are answered together', () => {
  const syncs = (t: ReturnType<typeof makeGateway>) => t.runtime.inputs.filter((i) => i.input.t === 'sync').map((i) => (i.input as { id?: number }).id);

  it('the first goes to the table at once; others within 5 s wait and are answered by one sync when it is due', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const seen = a.of('reply').length;
    a.client.send({ t: 'sync', id: 1 });
    await settle(3);
    expect(syncs(t)).toEqual([1]);
    t.clock.advance(1_000);
    for (const id of [2, 3, 4]) a.client.send({ t: 'sync', id });
    await settle(3);
    expect(syncs(t)).toEqual([1]);
    t.clock.advance(3_999);
    t.gateway.tick();
    expect(syncs(t)).toEqual([1]);
    t.clock.advance(1);
    t.gateway.tick();
    await settle(3);
    // 2 and 3 are answered ok together; the last one carries the single view
    expect(syncs(t)).toEqual([1, 4]);
    expect(repliesAfter(a, seen)).toEqual([[2, 'ok'], [3, 'ok']]);
    // after a flush the 5 s start again
    t.clock.advance(1_000);
    a.client.send({ t: 'sync', id: 5 });
    await settle(3);
    expect(syncs(t)).toEqual([1, 4]);
  });

  it('at most 8 wait; the ninth is refused rateLimited', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const seen = a.of('reply').length;
    a.client.send({ t: 'sync', id: 1 });
    await settle(3);
    for (let id = 2; id <= 10; id++) a.client.send({ t: 'sync', id });
    await settle(3);
    expect(repliesAfter(a, seen)).toEqual([[10, 'rateLimited']]);
    t.clock.advance(5_000);
    t.gateway.tick();
    await settle(3);
    expect(syncs(t)).toEqual([1, 9]);
    expect(repliesAfter(a, seen)).toEqual([[10, 'rateLimited'], ...[2, 3, 4, 5, 6, 7, 8].map((id): [number, string] => [id, 'ok'])]);
  });

  it('a seat that left before its coalesced syncs were due is answered notStarted for the last of them', async () => {
    const t = makeGateway();
    const { a } = await startTable(t);
    const seen = a.of('reply').length;
    a.client.send({ t: 'sync', id: 1 });
    await settle(3);
    for (const id of [2, 3]) a.client.send({ t: 'sync', id });
    a.client.send({ t: 'leave', id: 4 });
    await settle(3);
    t.clock.advance(5_000);
    t.gateway.tick();
    await settle(3);
    expect(repliesAfter(a, seen)).toEqual([[2, 'ok'], [3, 'notStarted']]);
  });

  it('not seated in a game: notStarted', async () => {
    const t = makeGateway();
    const b = await guest(t, 'Alice');
    expect(await b.cmd({ t: 'sync' })).toMatchObject({ ok: false, error: { code: 'notStarted' } });
  });
});

describe('M13-6 join attempts: 1/s burst 5, ten wrong codes or passwords lock the session and its address key for ten minutes', () => {
  async function room(passwords = false) {
    const t = makeGateway(passwords ? { passwords: new FakePasswords() } : {});
    const owner = await guest(t, 'Owner');
    const { table, codes } = await createTable(owner, passwords ? { password: 'open sesame' } : { visibility: 'private' });
    return { t, owner, table, code: codes[0]! };
  }
  const wrongCode = (n: number) => `ABCD-EFGH-JKMN-P${String(n % 10)}RS`;

  it('wrong codes: each is badCode and a strike; the 10th within 10 minutes locks the session; the lock reaches its address key and ends after 10 minutes', async () => {
    const { t } = await room();
    const peer = freshPeer();
    const g = await guest(t, 'Guesser', { peer });
    // The join command's own limit is 1/s (burst 2): one attempt a second, each answered badCode.
    for (let i = 0; i < 10; i++) {
      const r = await g.cmd({ t: 'join', code: wrongCode(i), deck: TEST_DECK });
      expect(r, `attempt ${i + 1}`).toMatchObject({ ok: false, error: { code: 'badCode' } });
      t.clock.advance(1_000);
    }
    expect(counted(t.metrics, METRICS.strikes)).toBe(10);
    // the 11th: locked, with the time left
    const locked = await g.cmd({ t: 'join', code: wrongCode(11), deck: TEST_DECK });
    expect(locked).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMs: 10 * 60_000 - 1_000 } });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'joinLocked' })).toBe(1);
    // another session on the same address key is locked too ...
    const sibling = await guest(t, 'Sibling', { peer });
    expect(await sibling.cmd({ t: 'join', code: wrongCode(12), deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    // ... the same session on another address key is also locked (its own lock) ...
    const elsewhere = await guest(t, 'Guesser', { peer: freshPeer() }, g.token);
    expect(await elsewhere.cmd({ t: 'join', code: wrongCode(13), deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    // ... and another session from another address is not
    const stranger = await guest(t, 'Stranger');
    expect(await stranger.cmd({ t: 'join', code: wrongCode(14), deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badCode' } });
    // after 10 minutes the lock is over (the session came back from another address, which replaced its first socket)
    t.clock.advance(10 * 60_000);
    expect(await elsewhere.cmd({ t: 'join', code: wrongCode(15), deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'badCode' } });
  });

  it('slow guessing is never locked: 9 failures in 10 minutes, then the window moves on', async () => {
    const { t } = await room();
    const g = await guest(t, 'Slow');
    for (let i = 0; i < 9; i++) {
      expect(await g.cmd({ t: 'join', code: wrongCode(i), deck: TEST_DECK })).toMatchObject({ error: { code: 'badCode' } });
      t.clock.advance(10_000);
    }
    t.clock.advance(10 * 60_000);
    for (let i = 0; i < 5; i++) {
      expect(await g.cmd({ t: 'join', code: wrongCode(i), deck: TEST_DECK })).toMatchObject({ error: { code: 'badCode' } });
      t.clock.advance(2_000);
    }
  });

  it('a right code is not a failure and a deck problem does not spend the code', async () => {
    const { t, code } = await room();
    const g = await guest(t, 'Friend');
    expect(await g.cmd({ t: 'join', code, deck: { main: [{ name: 'Bad Card', count: 60 }], sideboard: [] } })).toMatchObject({ ok: false, error: { code: 'deckRejected' } });
    t.clock.advance(1_000);
    expect(await g.cmd({ t: 'join', code: code.toLowerCase().replace(/-/g, ' '), deck: TEST_DECK })).toMatchObject({ ok: true });
  });

  it('wrong passwords count the same: ten in ten minutes lock joining', async () => {
    const { t, table } = await room(true);
    const g = await guest(t, 'Guesser');
    for (let i = 0; i < 10; i++) {
      expect(await g.cmd({ t: 'join', table, password: `wrong ${i}`, deck: TEST_DECK }), `attempt ${i + 1}`).toMatchObject({ ok: false, error: { code: 'badPassword' } });
      t.clock.advance(1_000);
    }
    expect(await g.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
    t.clock.advance(10 * 60_000);
    expect(await g.cmd({ t: 'join', table, password: 'open sesame', deck: TEST_DECK })).toMatchObject({ ok: true });
  });
});

