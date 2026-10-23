/**
 * M13-11: the hosted link on a fake socket (normal traffic only): hello and the stored token, numbered commands that keep counting across sockets and
 * reloads, replies, reconnect with backoff, views and patches (and the one `sync` for a patch that does not fit), the clocks, the table, the ready check,
 * invite codes, notices and chat, Leave. Hosted design 3, 4.3, 12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostedLinkError, hostedSocketUrl } from '../../src/hosted/HostedLink';
import { EMPTY_SESSION, MemoryHostedStorage } from '../../src/hosted/storage';
import { clocksAt } from '../../src/hosted/clocks';
import { CODE, clockMsg, fakeHosted, flush, gameViews, OTHER_TOKEN, SERVER, seatView, TOKEN, tableMsg, welcomeMsg } from './fakes';

async function connected(o: Parameters<typeof fakeHosted>[0] = {}) {
  const h = fakeHosted(o);
  await h.link.connect();
  return h;
}

describe('hostedSocketUrl', () => {
  it('puts the protocol path on the origin, whatever scheme the setting used', () => {
    expect(hostedSocketUrl('wss://play.example.net')).toBe('wss://play.example.net/ws');
    expect(hostedSocketUrl('ws://127.0.0.1:47700')).toBe('ws://127.0.0.1:47700/ws');
    expect(hostedSocketUrl('https://play.example.net/')).toBe('wss://play.example.net/ws');
    expect(hostedSocketUrl('http://localhost:1')).toBe('ws://localhost:1/ws');
  });
});

describe('connecting', () => {
  it('says hello with the protocol and the name (no token the first time) and resolves with the welcome', async () => {
    const h = fakeHosted();
    expect(h.link.linkState()).toBe('connecting');
    await h.link.connect();
    expect(h.socket().url).toBe('ws://127.0.0.1:47700/ws');
    expect(h.socket().sent[0]).toEqual({ t: 'hello', protocol: 1, name: 'Alice' });
    expect(h.link.linkState()).toBe('open');
    expect(h.link.welcome()).toMatchObject({ token: TOKEN, resumed: false });
    expect(h.link.server()?.formats.map((f) => f.id)).toEqual(['casual', 'standard', 'commander']);
    expect(h.link.table()).toBeNull();
    expect(h.link.hasTable()).toBe(false);
  });

  it('keeps the token in storage and sends it again from the next page (never in the URL)', async () => {
    const h = await connected();
    expect(h.storage.session.token).toBe(TOKEN);
    expect(h.socket().url).not.toContain(TOKEN);
    const next = await connected({ storage: h.storage, welcome: welcomeMsg({ resumed: true }) });
    expect(next.socket().sent[0]).toEqual({ t: 'hello', protocol: 1, name: 'Alice', token: TOKEN });
    expect(next.link.welcome()?.resumed).toBe(true);
  });

  it('sends the name it has now when it says hello again, and takes a new one', async () => {
    const h = fakeHosted();
    h.link.setName('Alicia');
    await h.link.connect();
    expect(h.socket().sent[0]).toMatchObject({ t: 'hello', name: 'Alicia' });
    expect(h.link.name()).toBe('Alicia');
  });

  it('rename says hello again on a fresh socket under the new name, with the same token and seat, and does nothing for the same name', async () => {
    const h = fakeHosted({ welcomes: [welcomeMsg({ table: 'T1', seat: 1 }), welcomeMsg({ resumed: true, name: 'Alicia', table: 'T1', seat: 1 })] });
    await h.link.connect();
    const first = h.socket();
    const waiting = h.link.say('x');
    await h.link.rename('Alicia');
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'disconnected' } });
    expect(first.closedWith).toMatchObject({ code: 1000 });
    expect(h.sockets).toHaveLength(2);
    expect(h.socket().sent[0]).toEqual({ t: 'hello', protocol: 1, name: 'Alicia', token: TOKEN });
    expect(h.link.welcome()).toMatchObject({ name: 'Alicia', resumed: true });
    expect(h.link.linkState()).toBe('open');
    expect(h.link.seat()).toBe(1);
    await h.link.rename('Alicia');
    expect(h.sockets).toHaveLength(2);
    // a command goes out on the new socket, with the next number
    void h.link.say('y');
    expect(h.socket().last('chat').id).toBe(2);
  });

  it('rename before the link is open just sets the name its hello will say', async () => {
    const h = fakeHosted();
    await h.link.rename('Early');
    await h.link.connect();
    expect(h.sockets).toHaveLength(1);
    expect(h.socket().sent[0]).toMatchObject({ t: 'hello', name: 'Early' });
  });

  it('rejects when the server cannot be reached, and does not keep trying behind the screen\'s back', async () => {
    vi.useFakeTimers();
    try {
      const h = fakeHosted({ manual: true });
      const done = h.link.connect().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      h.socket().drop(1006);
      const e = await done;
      expect(e).toBeInstanceOf(HostedLinkError);
      expect(e).toMatchObject({ code: 'unreachable' });
      expect(h.link.linkState()).toBe('closed');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.sockets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a server of another protocol version is refused with its own words', async () => {
    const h = fakeHosted({ welcome: welcomeMsg({ server: { ...welcomeMsg().server, protocol: 2 } }) });
    await expect(h.link.connect()).rejects.toMatchObject({ code: 'version' });
    expect(h.link.linkState()).toBe('closed');
    expect(h.link.linkProblem()).toMatch(/different versions/);
  });

  it('a close with the version code is the same refusal, and one for limits says to wait', async () => {
    const v = fakeHosted({ manual: true });
    const pv = v.link.connect().catch((e: unknown) => e);
    await flush();
    v.socket().drop(4005, 'protocol');
    expect(await pv).toMatchObject({ code: 'version' });
    const r = fakeHosted({ manual: true });
    const pr = r.link.connect().catch((e: unknown) => e);
    await flush();
    r.socket().drop(4004, 'Too many sockets.');
    expect(await pr).toMatchObject({ code: 'refused' });
  });
});

describe('commands', () => {
  it('number every command, count on across sockets and reloads, and resolve with the reply', async () => {
    const h = await connected();
    const p1 = h.link.command({ t: 'browse', filter: {}, sort: 'newest', page: 0 });
    expect(h.socket().last('browse').id).toBe(1);
    h.socket().reply('browse', { ok: true, tables: [], total: 0 });
    expect(await p1).toEqual({ ok: true, tables: [], total: 0 });
    const p2 = h.link.say('hello');
    expect(h.socket().last('chat').id).toBe(2);
    h.socket().reply('chat', { ok: true });
    await p2;
    expect(h.storage.session.nextId).toBe(3);

    // a reload: a new link on the same storage goes on from there
    const again = await connected({ storage: h.storage, welcome: welcomeMsg({ resumed: true }) });
    void again.link.say('again');
    expect(again.socket().last('chat').id).toBe(3);
  });

  it('keeps the counter going across a dropped socket too', async () => {
    vi.useFakeTimers();
    try {
      const h = fakeHosted({ welcomes: [welcomeMsg(), welcomeMsg({ resumed: true })] });
      const c = h.link.connect();
      await vi.advanceTimersByTimeAsync(0);
      await c;
      void h.link.say('one');
      expect(h.socket().last('chat').id).toBe(1);
      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.sockets).toHaveLength(2);
      void h.link.say('two');
      expect(h.socket().last('chat').id).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers an error reply with the server\'s error', async () => {
    const h = await connected();
    const p = h.link.command({ t: 'join', code: CODE, deck: { main: [], sideboard: [] } });
    h.socket().reply('join', { error: { code: 'badCode', message: 'That invite code is not valid (or its seat is taken).' } });
    expect(await p).toEqual({ ok: false, error: { code: 'badCode', message: 'That invite code is not valid (or its seat is taken).' } });
  });

  it('refuses a command at once while the socket is down, and gives up on a reply that never comes', async () => {
    vi.useFakeTimers();
    try {
      const h = fakeHosted();
      const c = h.link.connect();
      await vi.advanceTimersByTimeAsync(0);
      await c;
      const slow = h.link.command({ t: 'browse', filter: {}, sort: 'newest', page: 0 }, { timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await slow).toMatchObject({ ok: false, error: { code: 'timeout' } });
      h.socket().drop(1006);
      expect(await h.link.say('x')).toMatchObject({ ok: false, error: { code: 'disconnected' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a socket that drops answers the commands waiting with disconnected', async () => {
    const h = await connected();
    const waiting = h.link.command({ t: 'create', format: 'casual', seats: 2, visibility: 'private', deck: { main: [], sideboard: [] } });
    h.socket().drop(1006);
    expect(await waiting).toMatchObject({ ok: false, error: { code: 'disconnected' } });
  });

  it('sends nothing for a texts that is not text, and ignores a message that is not JSON', async () => {
    const h = await connected();
    const seen = vi.fn();
    h.link.subscribe(seen);
    h.socket().raw(new ArrayBuffer(4));
    h.socket().raw('not json');
    h.socket().raw('[1,2]');
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('reconnecting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function start(welcomes: Parameters<typeof fakeHosted>[0] extends infer O ? (O extends { welcomes?: infer W } ? W : never) : never) {
    const h = fakeHosted({ welcomes });
    const c = h.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    await c;
    return h;
  }

  it('opens the socket again after 1 s, doubling to 10 s, says hello with the token and goes back to open', async () => {
    const h = await start([welcomeMsg(), null, null, null, null, null, welcomeMsg({ resumed: true })]);
    h.socket().drop(1006);
    expect(h.link.linkState()).toBe('lost');
    expect(h.link.linkProblem()).toMatch(/Lost the connection/);
    // each new socket opens but the server does not answer (null): the next drop doubles the wait
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = h.sockets.length;
      let waited = 0;
      while (h.sockets.length === before) {
        await vi.advanceTimersByTimeAsync(250);
        waited += 250;
      }
      waits.push(waited);
      h.socket().drop(1006);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 10_000]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.sockets).toHaveLength(7);
    expect(h.socket().sent[0]).toEqual({ t: 'hello', protocol: 1, name: 'Alice', token: TOKEN });
    expect(h.link.linkState()).toBe('open');
    expect(h.link.linkProblem()).toBeNull();
  });

  it('is not retried when another window took the session over (4001), and says so', async () => {
    const h = await start([welcomeMsg()]);
    h.socket().drop(4001, 'Replaced by a newer connection.');
    expect(h.link.linkState()).toBe('closed');
    expect(h.link.linkProblem()).toMatch(/another window/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('waits longer when the server says it is stopping (4003), and tries again', async () => {
    const h = await start([welcomeMsg(), welcomeMsg({ resumed: true })]);
    h.socket().drop(4003, 'stopping');
    expect(h.link.linkProblem()).toMatch(/restarting/);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('close() ends it for good: no retry, waiting commands answered', async () => {
    const h = await start([welcomeMsg()]);
    h.socket().drop(1006);
    h.link.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.link.linkState()).toBe('closed');
    expect(h.link.linkProblem()).toBeNull();
  });

  it('a Leave sent while the socket is being reopened waits for it (a flicker must not strand the seat)', async () => {
    const h = await start([welcomeMsg({ table: 'T1', seat: 1 }), welcomeMsg({ resumed: true, table: 'T1', seat: 1 })]);
    h.socket().drop(1006);
    const left = h.link.leave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    expect(h.socket().last('leave')).toBeDefined();
    h.socket().reply('leave');
    expect(await left).toEqual({ ok: true });
    expect(h.link.hasTable()).toBe(false);
  });

  it('a Leave that finds no socket for 4 s gives up', async () => {
    const h = await start([welcomeMsg(), null]);
    h.socket().drop(1006);
    const left = h.link.leave();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await left).toMatchObject({ ok: false, error: { code: 'disconnected' } });
  });

  it('a text ping goes out every 20 s while open', async () => {
    const h = fakeHosted({ opts: { pingEveryMs: 20_000 } });
    const c = h.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    await c;
    await vi.advanceTimersByTimeAsync(41_000);
    expect(h.socket().all('ping')).toHaveLength(2);
    h.link.close();
  });
});

describe('the table, codes and the ready check', () => {
  it('create: the reply\'s codes are for seats 2 and up, kept for the session (storage), and shown again after a reload', async () => {
    const h = await connected();
    const made = h.link.command({ t: 'create', format: 'casual', seats: 3 as never, visibility: 'private', deck: { main: [], sideboard: [] } });
    h.socket().push(tableMsg({ seats: [seatView(1, 'Alice'), seatView(2, null), seatView(3, null)] }));
    h.socket().reply('create', { ok: true, table: 'T1', codes: [CODE, 'R4VC-8NJE-2LMQ-T6YB'] });
    await made;
    expect(h.link.codes()).toEqual([{ seat: 2, code: CODE }, { seat: 3, code: 'R4VC-8NJE-2LMQ-T6YB' }]);
    expect(h.link.table()).toMatchObject({ table: 'T1', status: 'lobby', you: 1 });
    expect(h.link.seat()).toBe(1);

    // a reload into the same table: the welcome names it, the codes come back from storage, the table message follows
    const again = await connected({ storage: h.storage, welcome: welcomeMsg({ resumed: true, table: 'T1', seat: 1 }) });
    expect(again.link.codes()).toEqual(h.link.codes());
    expect(again.link.hasTable()).toBe(true);
  });

  it('new codes replace the old ones, by the seats still open', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push(tableMsg({ seats: [seatView(1, 'Alice'), seatView(2, 'Bob'), seatView(3, null), seatView(4, null)] }));
    const p = h.link.newCodes();
    h.socket().reply('codes', { ok: true, table: 'T1', codes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'] });
    await p;
    expect(h.link.codes().map((c) => c.seat)).toEqual([3, 4]);
  });

  it('a code of another table is not shown (the welcome names the table the storage must match)', async () => {
    const storage = new MemoryHostedStorage({ ...EMPTY_SESSION, token: TOKEN, codes: { table: 'OLD', list: [{ seat: 2, code: CODE }] } });
    const h = await connected({ storage, welcome: welcomeMsg({ resumed: true, table: 'NEW', seat: 1 }) });
    expect(h.link.codes()).toEqual([]);
  });

  it('a reload into a running game gets no table message: the title and clocks come from what the page kept', async () => {
    const h = await connected();
    h.socket().push(tableMsg({ title: 'Friday game', status: 'playing', clock: { bankMs: 600_000, delayMs: 5000, dropMs: 300_000 }, seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    const again = await connected({ storage: h.storage, welcome: welcomeMsg({ resumed: true, table: 'T1', seat: 1 }) });
    expect(again.link.table()).toMatchObject({ title: 'Friday game', status: 'playing', clock: { bankMs: 600_000 }, you: 1 });
    expect(again.link.table()?.seats.map((s) => s.name)).toEqual(['Alice', 'Bob']);
    expect(again.link.seat()).toBe(1);
  });

  it('a welcome with no table drops what was kept of one (it expired or closed while the page was away)', async () => {
    const h = await connected();
    h.socket().push(tableMsg());
    const again = await connected({ storage: h.storage, welcome: welcomeMsg({ resumed: true }) });
    expect(again.link.table()).toBeNull();
    expect(again.storage.session.table).toBeNull();
    expect(again.storage.session.codes).toBeNull();
  });

  it('the ready check: the deadline is counted on this page\'s clock, and the seat\'s own confirmation is read from it', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_800_000_100_000);
      const h = fakeHosted({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
      const c = h.link.connect();
      await vi.advanceTimersByTimeAsync(0);
      await c;
      h.socket().push(tableMsg({ status: 'readyCheck', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
      // the server's clock is hours off: it does not matter, a fresh check has its whole 30 s
      h.socket().push({ t: 'readyCheck', start: 'S1', deadlineAt: 1_700_000_000_000, players: [{ seat: 1, name: 'Alice', ready: false }, { seat: 2, name: 'Bob', ready: true }] });
      const rc = h.link.readyCheck()!;
      expect(rc.start).toBe('S1');
      expect(rc.deadline - Date.now()).toBe(30_000);
      expect(rc.confirmed).toBe(false);
      vi.setSystemTime(Date.now() + 10_000);
      // the same check again (a reconnect, a confirmation): the deadline stays
      h.socket().push({ t: 'readyCheck', start: 'S1', deadlineAt: 1_700_000_000_000, players: [{ seat: 1, name: 'Alice', ready: true }, { seat: 2, name: 'Bob', ready: true }] });
      expect(h.link.readyCheck()!.deadline).toBe(rc.deadline);
      expect(h.link.readyCheck()!.confirmed).toBe(true);
      const p = h.link.confirm('S1');
      expect(h.socket().last('ready')).toMatchObject({ t: 'ready', start: 'S1' });
      h.socket().reply('ready', { ok: true, table: 'T1' });
      await p;
      // a table that is not in a ready check any more has none
      h.socket().push(tableMsg({ status: 'lobby' }));
      expect(h.link.readyCheck()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a matched table\'s check is 15 s', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push(tableMsg({ source: 'matched', status: 'readyCheck' }));
    h.socket().push({ t: 'readyCheck', start: 'M1', deadlineAt: 0, players: [] });
    expect(h.link.readyCheck()!.deadline - Date.now()).toBeLessThanOrEqual(15_000);
    expect(h.link.readyCheck()!.deadline - Date.now()).toBeGreaterThan(14_000);
  });

  it('leave: after its reply nothing of the table is held, here or in storage', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push(tableMsg());
    const p = h.link.leave();
    h.socket().reply('leave');
    await p;
    expect(h.link.table()).toBeNull();
    expect(h.link.seat()).toBeNull();
    expect(h.storage.session.table).toBeNull();
    expect(h.storage.session.codes).toBeNull();
  });

  it('the capacity queue\'s status is held and cleared when the game starts', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push({ t: 'queueStatus', queue: { kind: 'capacity', table: 'T1', position: 2, unitsAhead: 3, estimatedWaitMs: 120_000 } });
    expect(h.link.queue()).toMatchObject({ kind: 'capacity', position: 2 });
    h.socket().push({ t: 'start', table: 'T1', players: [{ id: 'p1', name: 'Alice', seat: 1 }, { id: 'p2', name: 'Bob', seat: 2 }] });
    expect(h.link.queue()).toBeNull();
    expect(h.link.me()).toBe('p1');
    expect(h.link.nameOfSeat(2)).toBe('Bob');
  });
});

describe('views and patches', () => {
  it('holds the full view with its events and legal actions, and applies patches to it', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    const first = g.full('p1');
    h.socket().push(first);
    expect(h.link.view()).toMatchObject({ seq: 1 });
    expect(h.link.view()!.view.viewer).toBe('p1');
    expect(h.link.me()).toBe('p1');
    const before = h.link.view();
    const events = g.step();
    h.socket().push(g.patch('p1', 1, events));
    const now = h.link.view()!;
    expect(now.seq).toBe(g.seq);
    expect(now.events).toEqual(events);
    expect(now).not.toBe(before);
    expect(JSON.stringify(now.view)).toBe(JSON.stringify(g.full('p1').view));
    // the same link, nothing sent: the patch fitted
    expect(h.socket().all('sync')).toHaveLength(0);
  });

  it('a patch whose base is not the view held asks for one full view, and drops the patches that come meanwhile', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    h.socket().push(g.full('p1'));
    g.step();
    g.patch('p1', 1); // a patch this page never gets
    g.step();
    h.socket().push(g.patch('p1', 2)); // base 2: not the view held (1)
    expect(h.socket().all('sync')).toHaveLength(1);
    g.step();
    h.socket().push(g.patch('p1', 3));
    expect(h.socket().all('sync')).toHaveLength(1); // not again while one is on its way
    expect(h.link.view()!.seq).toBe(1);
    h.socket().reply('sync');
    h.socket().push(g.full('p1'));
    expect(h.link.view()!.seq).toBe(g.seq);
    g.step();
    h.socket().push(g.patch('p1', g.seq - 1));
    expect(h.link.view()!.seq).toBe(g.seq);
  });

  it('a patch that does not fit the view asks for a full view too', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    h.socket().push(g.full('p1'));
    h.socket().push({ t: 'patch', seq: 2, base: 1, ops: [{ op: 'del', path: ['nothing', 'here'] }], events: [], legal: [] });
    expect(h.socket().all('sync')).toHaveLength(1);
    expect(h.link.view()!.seq).toBe(1);
  });

  it('a patch that comes before any view asks for one', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push({ t: 'patch', seq: 5, base: 4, ops: [], events: [], legal: [] });
    expect(h.socket().all('sync')).toHaveLength(1);
    expect(h.link.view()).toBeNull();
  });

  it('a view or patch for a view this page is past is ignored (seq only goes up)', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    h.socket().push(g.full('p1'));
    g.step();
    h.socket().push(g.patch('p1', 1));
    const held = h.link.view();
    h.socket().push({ ...g.full('p1'), seq: 1 });
    expect(h.link.view()).toBe(held);
    h.socket().push({ t: 'patch', seq: 2, base: 1, ops: [], events: [], legal: [] });
    expect(h.link.view()).toBe(held);
    expect(h.socket().all('sync')).toHaveLength(0);
  });

  it('a resend of the view held (a new socket) is not news: the events shown already stay what they were', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    h.socket().push(g.full('p1'));
    const events = g.step();
    h.socket().push(g.patch('p1', 1, events));
    expect(h.link.view()!.events).toEqual(events);
    h.socket().push({ ...g.full('p1'), events: [] });
    expect(h.link.view()!.seq).toBe(g.seq);
    expect(h.link.view()!.events).toEqual(events);
  });

  it('act sends the seq of the view held, with the next command number', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    h.socket().push(g.full('p1'));
    g.step();
    h.socket().push(g.patch('p1', 1));
    const p = h.link.act({ type: 'pass', player: 'p1' });
    expect(h.socket().last('act')).toMatchObject({ t: 'act', seq: g.seq, action: { type: 'pass', player: 'p1' } });
    h.socket().reply('act');
    expect(await p).toEqual({ ok: true });
  });

  it('act before any view is refused without sending', async () => {
    const h = await connected();
    expect(await h.link.act({ type: 'pass', player: 'p1' })).toMatchObject({ ok: false, error: { code: 'notStarted' } });
    expect(h.socket().all('act')).toHaveLength(0);
  });

  it('a new game (start) forgets the old game\'s view, clocks, notices, chat and result', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const g = gameViews();
    h.socket().push(g.full('p1'));
    h.socket().push(clockMsg(Date.now(), [{ seat: 1 }, { seat: 2 }]));
    h.socket().push({ t: 'notice', kind: 'playerDropped', seat: 2, text: 'x' });
    h.socket().push({ t: 'chat', from: 2, text: 'gg' });
    h.socket().push({ t: 'result', outcome: 'draw', reason: 'draw', result: null, placements: [] });
    h.socket().push({ t: 'start', table: 'T2', players: [{ id: 'p1', name: 'Alice', seat: 1 }, { id: 'p2', name: 'Bob', seat: 2 }] });
    expect(h.link.view()).toBeNull();
    expect(h.link.clocks()).toBeNull();
    expect(h.link.notices()).toEqual([]);
    expect(h.link.chat()).toEqual([]);
    expect(h.link.result()).toBeNull();
    expect(h.link.away().size).toBe(0);
  });
});

describe('clocks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('are held with `at` on this page\'s clock, whatever the server\'s time of day, and counted down from there', async () => {
    vi.setSystemTime(1_800_000_000_000);
    const h = fakeHosted({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    const c = h.link.connect();
    await vi.advanceTimersByTimeAsync(0);
    await c;
    h.socket().push(clockMsg(5_000, [{ seat: 1, bankMs: 600_000, running: true, delayMs: 5000 }, { seat: 2, bankMs: 800_000 }], undefined));
    const view = h.link.clocks()!;
    expect(view.at).toBe(Date.now());
    expect(view.seats.map((s) => s.seat)).toEqual([1, 2]);
    const at = (ms: number) => clocksAt(view, Date.now() + ms);
    expect(at(3000).seats[0]).toMatchObject({ delayMs: 2000, bankMs: 600_000, rope: false });
    expect(at(8000).seats[0]).toMatchObject({ delayMs: 0, bankMs: 597_000, rope: true, urgent: false });
    expect(at(8000).seats[1]).toMatchObject({ bankMs: 800_000, rope: false });
  });
});

describe('notices, presence and chat', () => {
  it('keeps the notices, and knows who dropped, came back and left', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push({ t: 'notice', kind: 'playerDropped', seat: 2, text: 'Seat 2 lost the connection; the game waits for them only when they must decide.' });
    expect(h.link.away().get(2)).toBe('dropped');
    h.socket().push({ t: 'notice', kind: 'playerBack', seat: 2, text: 'Seat 2 is back.' });
    expect(h.link.away().has(2)).toBe(false);
    h.socket().push({ t: 'notice', kind: 'timeout', seat: 2, text: 'Seat 2 ran out of time and concedes (CR 104.3a).' });
    expect(h.link.away().get(2)).toBe('left');
    expect(h.link.notices().map((n) => n.kind)).toEqual(['playerDropped', 'playerBack', 'timeout']);
    expect(h.link.notices().map((n) => n.n)).toEqual([1, 2, 3]);
    h.socket().push({ t: 'notice', kind: 'serverDraining', text: 'The server restarts soon.' });
    expect(h.link.notices().at(-1)).toMatchObject({ kind: 'serverDraining', text: 'The server restarts soon.' });
  });

  it('a table message marks seats that are away, and an open seat is nobody', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push(tableMsg({ status: 'playing', seats: [seatView(1, 'Alice'), seatView(2, 'Bob', { connected: false })] }));
    expect(h.link.away().get(2)).toBe('dropped');
    h.socket().push(tableMsg({ status: 'playing', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    expect(h.link.away().has(2)).toBe(false);
  });

  it('chat lines come only from the server\'s echo, tagged as this seat\'s own or not', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push(tableMsg({ status: 'playing', seats: [seatView(1, 'Alice'), seatView(2, 'Bob')] }));
    const p = h.link.say('good luck');
    expect(h.link.chat()).toEqual([]);
    h.socket().push({ t: 'chat', from: 1, text: 'good luck' });
    h.socket().reply('chat');
    await p;
    h.socket().push({ t: 'chat', from: 2, text: 'you too' });
    expect(h.link.chat().map((c) => [c.from, c.mine, c.text])).toEqual([[1, true, 'good luck'], [2, false, 'you too']]);
  });

  it('proposals: held until closed, and how the last one ended is kept', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push({ t: 'proposal', proposal: { id: 4, seat: 2, sourceName: 'Odd Card', text: 'Do something odd.', lines: ['Bob gains 1 life.'] } });
    expect(h.link.proposal()).toMatchObject({ id: 4, sourceName: 'Odd Card' });
    const p = h.link.vote(4, false, 'no thanks');
    expect(h.socket().last('vote')).toMatchObject({ t: 'vote', proposal: 4, accept: false, reason: 'no thanks' });
    h.socket().reply('vote');
    await p;
    h.socket().push({ t: 'proposalClosed', proposal: 4, outcome: 'rejected' });
    expect(h.link.proposal()).toBeNull();
    expect(h.link.proposalOutcome()).toMatchObject({ proposal: 4, outcome: 'rejected' });
  });

  it('the result and the server\'s goodbye are kept', async () => {
    const h = await connected({ welcome: welcomeMsg({ table: 'T1', seat: 1 }) });
    h.socket().push({
      t: 'result', outcome: 'win', reason: 'Bob ran out of time.', result: { winner: 'p1', reason: 'Bob timed out', rules: ['CR 104.3a'] } as never,
      placements: [{ seat: 1, name: 'Alice', place: 1, loss: null, lossRule: null, outTurn: null }, { seat: 2, name: 'Bob', place: 2, loss: 'timeout', lossRule: null, outTurn: 4 }],
    });
    expect(h.link.result()).toMatchObject({ outcome: 'win' });
    h.socket().push({ t: 'bye', reason: 'The server stops.' });
    expect(h.link.bye()).toBe('The server stops.');
  });

  it('every server message goes to the listeners after the link took it in (the lobby browser reads its own)', async () => {
    const h = await connected();
    const seen: string[] = [];
    const stop = h.link.onMessage((m) => seen.push(m.t));
    h.socket().push({ t: 'lobbyUpdate', added: [], changed: [], removed: [] });
    h.socket().push(tableMsg());
    expect(seen).toEqual(['lobbyUpdate', 'table']);
    stop();
    h.socket().push(tableMsg());
    expect(seen).toHaveLength(2);
  });
});

describe('a second guest in the same browser', () => {
  it('uses its own storage: two links with two tokens, each welcomed under its own', async () => {
    const a = await connected();
    const b = await connected({ welcome: welcomeMsg({ token: OTHER_TOKEN, session: 'S2', name: 'Bob' }) });
    expect(a.storage.session.token).toBe(TOKEN);
    expect(b.storage.session.token).toBe(OTHER_TOKEN);
    expect(SERVER).toContain('127.0.0.1');
  });
});
