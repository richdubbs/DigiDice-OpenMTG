/**
 * M13-6: the gateway's connections (design 3.1-3.3, 11), in process with a fake clock and fixed crafted inputs (the owner rule: no floods, no fuzzing, no
 * forged traffic, no sockets): the upgrade decision (strict Origin, the proxy rule with its rightmost X-Forwarded-For, /32 and /64 address keys, sockets
 * per key and in all), hello within 5 s, guest tokens (new, resume, expiry, replace with 4001), pings and silent connections, frames that close the
 * connection, strikes, and the session limits.
 */
import { describe, expect, it } from 'vitest';
import {
  CLOSE_PROTOCOL, CLOSE_REFUSED, CLOSE_REPLACED, CLOSE_STOPPING, CLOSE_VERSION, HOSTED_PROTOCOL, HOSTED_TOKEN, MAX_FRAME_BYTES,
} from '../../src/api';
import { sha256Hex } from '../../src/gateway/ids';
import { METRICS } from '../../src/obs';
import { MemoryStore } from '../../src/store';
import { Browser, counted, createTable, freshPeer, guest, makeGateway, settle, slowStore, startTable } from './harness';

const DAY = 86_400_000;
const PUBLIC = 'https://play.digidice.net';

describe('M13-6 upgrade: Origin, the proxy and address keys (crafted headers, in process)', () => {
  it('accepts the public origin and the desktop loopback origins; every other Origin header is refused (403) and counted', () => {
    const t = makeGateway({ env: { PUBLIC_ORIGINS: PUBLIC } });
    const up = (origin: string | string[] | undefined) => t.gateway.upgrade({ peer: '203.0.113.5', origin, forwardedFor: undefined });
    for (const o of [PUBLIC, 'http://127.0.0.1:5173', 'http://localhost:8787']) {
      const d = up(o);
      expect(d.ok, o).toBe(true);
      if (d.ok) t.gateway.upgradeFailed(d.key);
    }
    const refused: (string | string[] | undefined)[] = [
      undefined, '', 'null', `${PUBLIC}/`, `${PUBLIC}.evil.example`, 'https://evil.play.digidice.net', 'http://play.digidice.net', 'https://evil.example',
      'http://127.0.0.1', 'http://127.0.0.1:5173/', 'http://127.0.0.2:5173', [PUBLIC], [PUBLIC, 'https://evil.example'], '*',
    ];
    for (const o of refused) expect(up(o), String(o)).toEqual({ ok: false, status: 403, why: 'origin' });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'origin' })).toBe(refused.length);
    // The refusals hold no socket.
    expect(t.gateway.connections).toBe(0);
  });

  it('with ALLOW_DESKTOP_ORIGINS off only the public origins pass', () => {
    const t = makeGateway({ env: { PUBLIC_ORIGINS: PUBLIC, ALLOW_DESKTOP_ORIGINS: '0' } });
    const up = (origin: string) => t.gateway.upgrade({ peer: '203.0.113.5', origin, forwardedFor: undefined });
    expect(up('http://127.0.0.1:5173')).toMatchObject({ ok: false, status: 403 });
    expect(up('http://localhost:5173')).toMatchObject({ ok: false, status: 403 });
    expect(up(PUBLIC)).toMatchObject({ ok: true });
  });

  it('with TRUST_PROXY only the proxy may connect; the client is the rightmost X-Forwarded-For entry and has its own sockets', () => {
    const t = makeGateway({ env: { PUBLIC_ORIGINS: PUBLIC, TRUST_PROXY: '10.0.0.2' } });
    const up = (peer: string | undefined, forwardedFor: string | string[] | undefined) => t.gateway.upgrade({ peer, origin: PUBLIC, forwardedFor });
    // any other TCP peer, whatever it claims
    expect(up('10.0.0.3', '198.51.100.7')).toEqual({ ok: false, status: 403, why: 'proxy' });
    expect(up('198.51.100.7', '10.0.0.2')).toEqual({ ok: false, status: 403, why: 'proxy' });
    expect(up('10.0.0.2', undefined)).toEqual({ ok: false, status: 403, why: 'proxy' });
    expect(up('10.0.0.2', 'not an address')).toEqual({ ok: false, status: 403, why: 'proxy' });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'proxy' })).toBe(4);
    // the proxy, with the client it saw (an IPv4-mapped peer address is the same peer)
    expect(up('10.0.0.2', '198.51.100.7')).toMatchObject({ ok: true, address: '198.51.100.7', key: '4:198.51.100.7' });
    expect(up('::ffff:10.0.0.2', ['1.1.1.1', '198.51.100.8'])).toMatchObject({ ok: true, address: '198.51.100.8' });
    // entries left of the proxy's own are the client's claim: 1.1.1.1 forged in front changes nothing, and the real client still has its 8 sockets
    for (let i = 0; i < 7; i++) expect(up('10.0.0.2', `203.0.113.${i}, 198.51.100.7`), `socket ${i}`).toMatchObject({ ok: true, key: '4:198.51.100.7' });
    expect(up('10.0.0.2', '9.9.9.9, 198.51.100.7')).toEqual({ ok: false, status: 429, why: 'sockets' });
    expect(up('10.0.0.2', '198.51.100.9')).toMatchObject({ ok: true, key: '4:198.51.100.9' });
  });

  it('IPv6 clients share their /64: one host cannot pick a fresh address for each socket', () => {
    const t = makeGateway();
    const up = (peer: string) => t.gateway.upgrade({ peer, origin: 'http://127.0.0.1:5173', forwardedFor: undefined });
    for (let i = 1; i <= 8; i++) expect(up(`2001:db8:1:2::${i.toString(16)}`), String(i)).toMatchObject({ ok: true, key: '6:2001:db8:1:2' });
    expect(up('2001:db8:1:2:ffff:ffff:ffff:ffff')).toEqual({ ok: false, status: 429, why: 'sockets' });
    expect(up('2001:db8:1:3::1')).toMatchObject({ ok: true, key: '6:2001:db8:1:3' });
    // an IPv4-mapped IPv6 peer counts as its IPv4 address
    expect(up('::ffff:203.0.113.9')).toMatchObject({ ok: true, key: '4:203.0.113.9' });
  });

  it('sockets: 8 open per address key; a closed socket gives its place back', async () => {
    const t = makeGateway();
    const peer = '203.0.113.20';
    const open: Browser[] = [];
    for (let i = 0; i < 8; i++) open.push(Browser.connect(t, { peer }));
    expect(t.transport.connect({ peer })).toEqual({ refused: { status: 429, why: 'sockets' } });
    open[0]!.client.close();
    await settle(2);
    expect('refused' in t.transport.connect({ peer })).toBe(false);
    expect(t.transport.connect({ peer })).toEqual({ refused: { status: 429, why: 'sockets' } });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'sockets' })).toBe(2);
  });

  it('sockets: a /48 has 128 open sockets in all, from its /64s (8 each); another /48 is not affected', () => {
    const t = makeGateway();
    const up = (peer: string) => t.gateway.upgrade({ peer, origin: 'http://127.0.0.1:5173', forwardedFor: undefined });
    for (let net = 0; net < 16; net++) for (let i = 1; i <= 8; i++) expect(up(`2001:db8:1:${net.toString(16)}::${i}`).ok, `${net}/${i}`).toBe(true);
    expect(up('2001:db8:1:ff::1')).toEqual({ ok: false, status: 429, why: 'sockets' });
    expect(up('2001:db8:2:0::1')).toMatchObject({ ok: true, key: '6:2001:db8:2:0' });
  });

  it('sockets: 1 new a second per address key (burst 10)', async () => {
    const t = makeGateway();
    const peer = '203.0.113.21';
    for (let i = 0; i < 10; i++) {
      const c = t.transport.connect({ peer });
      expect('refused' in c, `socket ${i}`).toBe(false);
      (c as { close(): void }).close();
      await settle(1);
    }
    expect(t.transport.connect({ peer })).toEqual({ refused: { status: 429, why: 'sockets' } });
    t.clock.advance(999);
    expect(t.transport.connect({ peer })).toEqual({ refused: { status: 429, why: 'sockets' } });
    t.clock.advance(1);
    expect('refused' in t.transport.connect({ peer })).toBe(false);
  });

  it('sockets: MAX_CONNECTIONS in all, from any address', () => {
    const t = makeGateway({ env: { MAX_CONNECTIONS: '12' } });
    for (let i = 0; i < 12; i++) expect('refused' in t.transport.connect({ peer: freshPeer() }), `connection ${i}`).toBe(false);
    expect(t.transport.connect({ peer: freshPeer() })).toEqual({ refused: { status: 503, why: 'connections' } });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'connections' })).toBe(1);
    expect(t.gateway.connections).toBe(12);
  });

  it('a handshake that fails after the upgrade was admitted gives its socket back', () => {
    const t = makeGateway();
    const up = () => t.gateway.upgrade({ peer: '203.0.113.30', origin: 'http://127.0.0.1:5173', forwardedFor: undefined });
    const keys: string[] = [];
    for (let i = 0; i < 8; i++) {
      const d = up();
      expect(d.ok, String(i)).toBe(true);
      if (d.ok) keys.push(d.key);
    }
    expect(up()).toEqual({ ok: false, status: 429, why: 'sockets' });
    t.gateway.upgradeFailed(keys[0]!);
    expect(up()).toMatchObject({ ok: true });
  });
});

describe('M13-6 hello: within 5 s, guest tokens, resume, expiry, replace', () => {
  it('a new guest gets a 64-hex token and a session; the store keeps only the SHA-256 of the token', async () => {
    const t = makeGateway();
    const b = Browser.connect(t);
    const w = await b.hello('  Alice   the   Brave ');
    expect(w.resumed).toBe(false);
    expect(HOSTED_TOKEN.test(w.token)).toBe(true);
    expect(w.name).toBe('Alice the Brave');
    expect(w.session).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(w.server.protocol).toBe(HOSTED_PROTOCOL);
    expect(w.server.engineBuild).toBe('build-test');
    expect(w.server.capacity).toBe('open');
    expect(w.server.formats.some((f) => f.id === 'casual' && f.seats.join() === '2')).toBe(true);
    expect(w.table).toBeUndefined();
    const row = await t.store.sessionByTokenHash(sha256Hex(w.token));
    expect(row).toMatchObject({ id: w.session, tokenHash: sha256Hex(w.token), name: 'Alice the Brave' });
    expect(JSON.stringify(row)).not.toContain(w.token);
    expect(await t.store.sessionByTokenHash(w.token)).toBeNull();
    // Nothing the server logs holds the token.
    expect(t.logger.lines.join('\n')).not.toContain(w.token);
  });

  it('a token resumes its session (same id, the name may change); a malformed token is refused before any lookup and gets a new session', async () => {
    const t = makeGateway();
    const first = await guest(t, 'Alice');
    const token = first.token;
    first.client.close();
    await settle(3);
    const again = await guest(t, 'Alicia', {}, token);
    expect(again.last('welcome')).toMatchObject({ resumed: true, session: first.session, token, name: 'Alicia' });
    expect((await t.store.sessionByTokenHash(sha256Hex(token)))?.name).toBe('Alicia');

    const lookups: string[] = [];
    const store = new Proxy(t.store, {
      get: (target, prop, recv) => {
        if (prop === 'sessionByTokenHash') return (h: string) => (lookups.push(h), target.sessionByTokenHash(h));
        const v = Reflect.get(target, prop, recv) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const u = makeGateway({ store });
    const malformed = ['', 'abc', 'G'.repeat(64), token.toUpperCase(), `${token}0`, token.slice(1), ` ${token}`, 'x'.repeat(128)];
    for (const bad of malformed) {
      const b = Browser.connect(u, { peer: freshPeer() });
      const w = await b.hello('Mallory', bad || undefined);
      expect(w.resumed, JSON.stringify(bad)).toBe(false);
      expect(w.token).not.toBe(bad);
    }
    expect(lookups).toEqual([]);
    // a well-formed token nobody holds is looked up and gets a new session
    const b = Browser.connect(u, { peer: freshPeer() });
    expect((await b.hello('Mallory', 'ab'.repeat(32))).resumed).toBe(false);
    expect(lookups).toEqual([sha256Hex('ab'.repeat(32))]);
  });

  it('sessions are forgotten 30 days after their last use (answer 9)', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    a.client.close();
    b.client.close();
    await settle(3);
    // exactly 30 days after the last use the session is still there; a millisecond more and it is gone
    t.clock.advance(30 * DAY);
    const kept = await guest(t, 'Alice', {}, a.token);
    expect(kept.last('welcome')).toMatchObject({ resumed: true, session: a.session });
    kept.client.close();
    await settle(3);
    t.clock.advance(1);
    const gone = await guest(t, 'Bob', {}, b.token);
    expect(gone.last('welcome')?.resumed).toBe(false);
    expect(gone.session).not.toBe(b.session);
    expect(await t.store.sessionByTokenHash(sha256Hex(b.token))).not.toBeNull(); // the row stays until the purge (M13-4); it is just not resumable
    // use renews: Alice was seen again 30 days in, so 29 days later she is still there (59 days after her first visit)
    t.clock.advance(29 * DAY);
    const alice = await guest(t, 'Alice', {}, a.token);
    expect(alice.last('welcome')).toMatchObject({ resumed: true, session: a.session });
  });

  it('a second socket with the same token replaces the first (4001); the seat stays and goes to the new socket without a drop', async () => {
    const t = makeGateway();
    const { a, b, table } = await startTable(t);
    expect(t.runtime.games.has(table)).toBe(true);
    t.runtime.inputs.length = 0;
    const second = Browser.connect(t, { peer: freshPeer() });
    const w = await second.hello('Alice', a.token);
    expect(w.resumed).toBe(true);
    expect(w).toMatchObject({ table, seat: 1, session: a.session });
    await a.client.until(() => a.client.closed !== null);
    expect(a.client.closed).toMatchObject({ code: CLOSE_REPLACED });
    expect(a.of('bye').map((m) => m.reason)).toEqual(['You connected again from elsewhere.']);
    await settle(3);
    // the runtime was told the seat is connected again, never that it dropped
    expect(t.runtime.inputs.map((i) => i.input)).toEqual([{ t: 'connect', seat: 1 }]);
    // the old socket's own close later changes nothing
    a.client.handle.closed();
    await settle(2);
    expect(t.runtime.inputs.map((i) => i.input.t)).toEqual(['connect']);
    expect(counted(t.metrics, METRICS.refusals, { reason: 'replaced' })).toBe(1);
    // commands now come from the new socket only (the fake runtime does not answer: the actor would)
    second.client.send({ t: 'chat', id: 50, text: 'hello' });
    await settle(3);
    expect(t.runtime.inputs.at(-1)?.input).toMatchObject({ t: 'chat', seat: 1, id: 50, text: 'hello' });
    expect(b.client.closed).toBeNull();
  });

  it('two sockets that say hello with the same token at the same moment: the later one stays, the earlier is replaced (4001)', async () => {
    const t = makeGateway({ store: slowStore(new MemoryStore(), 'sessionByTokenHash', 20) });
    const first = await guest(t, 'Alice');
    first.client.close();
    await settle(3);
    // the session is not in memory now (nobody sits anywhere): both hellos go to the store, which takes its time
    const x = Browser.connect(t, { peer: freshPeer() });
    const y = Browser.connect(t, { peer: freshPeer() });
    x.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Alice', token: first.token });
    y.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Alice', token: first.token });
    await y.client.until(() => y.of('welcome').length > 0);
    await settle(3);
    const open = [x, y].filter((b) => b.client.closed === null);
    expect(open).toHaveLength(1);
    const gone = [x, y].find((b) => b.client.closed !== null)!;
    expect(gone.client.closed).toMatchObject({ code: CLOSE_REPLACED });
    // the session answers on the one that stayed, and a table made on it is shown there
    const { table } = await createTable(open[0]!);
    expect(open[0]!.last('table')!.table.table).toBe(table);
    expect(t.gateway.connections).toBe(1);
  });

  it('a hello that changes the name while the last socket of the session closes still leaves the session where messages find it', async () => {
    const t = makeGateway({ store: slowStore(new MemoryStore(), 'putSession', 30) });
    const a = await guest(t, 'Alice');
    const b = Browser.connect(t, { peer: freshPeer() });
    b.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Alicia', token: a.token });
    await settle(1); // b's hello is waiting for the store to save the new name
    a.client.close(); // and the session's only socket goes away, which forgets a session nobody sits with
    await b.client.until(() => b.of('welcome').length > 0);
    expect(b.last('welcome')).toMatchObject({ resumed: true, name: 'Alicia', session: a.session });
    // what the tables layer sends to this session reaches b
    const { table } = await createTable(b);
    expect(b.last('table')!.table).toMatchObject({ table, you: 1 });
    expect(b.last('table')!.table.seats[0]).toMatchObject({ name: 'Alicia', connected: true });
  });

  it('hello comes within 5 s, once, first, with this protocol and a name the text rules allow', async () => {
    const t = makeGateway();
    // too late: the 5 s deadline (checked by the gateway's once-a-second housekeeping)
    const slow = Browser.connect(t);
    t.clock.advance(4_999);
    t.gateway.tick();
    expect(slow.client.closed).toBeNull();
    t.clock.advance(1);
    t.gateway.tick();
    expect(slow.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'hello' })).toBe(1);
    // a command before hello, a second hello
    const eager = Browser.connect(t, { peer: freshPeer() });
    eager.client.send({ t: 'sync', id: 1 });
    await eager.client.until(() => eager.client.closed !== null);
    expect(eager.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    const twice = await guest(t, 'Alice');
    twice.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Alice' });
    await twice.client.until(() => twice.client.closed !== null);
    expect(twice.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    // another protocol version: 4005 with a bye
    const old = Browser.connect(t, { peer: freshPeer() });
    old.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL + 1, name: 'Alice' });
    await old.client.until(() => old.client.closed !== null);
    expect(old.client.closed).toMatchObject({ code: CLOSE_VERSION });
    expect(old.of('bye')).toHaveLength(1);
    // names: empty, too long, control and bidi characters, invisible text
    for (const name of ['', '   ', 'x'.repeat(41), 'Al\u0000ice', 'Al‮ice', 'A​', 'Al\u0007ice']) {
      const b = Browser.connect(t, { peer: freshPeer() });
      b.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name });
      await b.client.until(() => b.client.closed !== null);
      expect(b.client.closed, JSON.stringify(name)).toMatchObject({ code: CLOSE_PROTOCOL });
      expect(b.of('welcome')).toEqual([]);
    }
  });

  it('pings every 20 s; a connection silent for 45 s is closed; a pong or any frame keeps it alive', async () => {
    const t = makeGateway();
    const quiet = await guest(t, 'Quiet');
    const lively = await guest(t, 'Lively');
    const chatty = await guest(t, 'Chatty');
    for (let s = 1; s <= 44; s++) {
      t.clock.advance(1_000);
      if (s === 30) lively.client.pong();
      if (s === 40) chatty.client.send({ t: 'ping' });
      t.gateway.tick();
      await settle(1);
    }
    expect(quiet.client.pings).toBe(2); // at 20 s and 40 s
    expect([quiet, lively, chatty].map((b) => b.client.closed)).toEqual([null, null, null]);
    t.clock.advance(1_000);
    t.gateway.tick();
    expect(quiet.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    expect(lively.client.closed).toBeNull(); // 15 s since its pong
    t.clock.advance(30_000);
    t.gateway.tick();
    expect(lively.client.closed).toMatchObject({ code: CLOSE_PROTOCOL }); // 45 s since its pong
    expect(chatty.client.closed).toBeNull(); // 35 s since its ping
    t.clock.advance(10_000);
    t.gateway.tick();
    expect(chatty.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    expect(counted(t.metrics, METRICS.refusals, { reason: 'dead' })).toBe(3);
  });

  it('new sessions: 5 a minute per address key (burst 10), and past the global rate only keys with more than 2 recent sessions are shed', async () => {
    const t = makeGateway();
    const peer = '203.0.113.40';
    const make = async (name: string, o: { peer: string }): Promise<boolean> => {
      const b = Browser.connect(t, o);
      b.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name });
      await b.client.until(() => b.of('welcome').length > 0 || b.client.closed !== null);
      const ok = b.of('welcome').length > 0;
      if (!ok) expect(b.client.closed).toMatchObject({ code: CLOSE_REFUSED });
      b.client.close();
      await settle(2);
      return ok;
    };
    // ten sessions in ten seconds: the burst; the eleventh finds 0.8 of a token
    const results: boolean[] = [];
    for (let i = 0; i < 11; i++) {
      results.push(await make(`G${i}`, { peer }));
      t.clock.advance(1_000);
    }
    expect(results).toEqual([...Array<boolean>(10).fill(true), false]);
    expect(counted(t.metrics, METRICS.refusals, { reason: 'sessions' })).toBe(1);
    // another key is not affected by it
    expect(await make('Other', { peer: freshPeer() })).toBe(true);
    // 12 seconds later the key has a token again
    t.clock.advance(12_000);
    expect(await make('Again', { peer })).toBe(true);

    // The global rate (SESSION_RATE, a minute's window) is backpressure only.
    const g = makeGateway({ env: { SESSION_RATE: '4' } });
    const mk = async (peer2: string): Promise<boolean> => {
      const b = Browser.connect(g, { peer: peer2 });
      b.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'G' });
      await b.client.until(() => b.of('welcome').length > 0 || b.client.closed !== null);
      const ok = b.of('welcome').length > 0;
      b.client.close();
      await settle(2);
      return ok;
    };
    const heavy = '203.0.113.50';
    for (let i = 0; i < 4; i++) expect(await mk(heavy), `heavy ${i}`).toBe(true);
    // 4 sessions in the last minute: the rate is used up. The heavy key (4 recent, more than 2) is shed; a light key and a new key are not.
    expect(await mk(heavy)).toBe(false);
    expect(await mk('203.0.113.51')).toBe(true);
    expect(await mk('203.0.113.52')).toBe(true);
    // the minute passes: the rate is free again
    g.clock.advance(61_000);
    expect(await mk(heavy)).toBe(true);
  });
});

describe('M13-6 one hello per socket (review: hellos sent back to back)', () => {
  it('a second hello while the first waits for the store closes the socket (4002); no session is left bound to it', async () => {
    const t = makeGateway({ store: slowStore(new MemoryStore(), 'sessionByTokenHash', 30) });
    const a = await guest(t, 'Alice');
    const b = await guest(t, 'Bob');
    a.client.close();
    b.client.close();
    await settle(3);
    expect(counted(t.metrics, METRICS.sessions)).toBe(0);
    // the sessions are not in memory: each hello goes to the (slow) store
    const x = Browser.connect(t, { peer: freshPeer() });
    x.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Alice', token: a.token });
    await settle(1);
    x.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Bob', token: b.token });
    await x.client.until(() => x.client.closed !== null);
    expect(x.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    await new Promise((r) => setTimeout(r, 80)); // the first hello's lookup ends
    expect(x.of('welcome')).toEqual([]);
    // neither session is held by the closed socket: nobody is connected, and each comes back as itself
    expect(counted(t.metrics, METRICS.sessions)).toBe(0);
    t.gateway.tick();
    const a2 = await guest(t, 'Alice', {}, a.token);
    expect(a2.last('welcome')).toMatchObject({ resumed: true, session: a.session });
    const b2 = await guest(t, 'Bob', {}, b.token);
    expect(b2.last('welcome')).toMatchObject({ resumed: true, session: b.session });
    expect(a2.client.closed).toBeNull();
    expect(b2.client.closed).toBeNull();
  });

  it('a second hello right behind the first (nothing awaited yet) closes the socket too, and a welcome is not sent twice', async () => {
    const t = makeGateway();
    const a = await guest(t, 'Alice');
    a.client.close();
    await settle(3);
    const x = Browser.connect(t, { peer: freshPeer() });
    x.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Alice', token: a.token });
    x.client.send({ t: 'hello', protocol: HOSTED_PROTOCOL, name: 'Mallory' });
    await x.client.until(() => x.client.closed !== null);
    expect(x.client.closed).toMatchObject({ code: CLOSE_PROTOCOL });
    await settle(5);
    expect(x.of('welcome').length).toBeLessThanOrEqual(1);
    expect(counted(t.metrics, METRICS.sessions)).toBe(0);
  });
});

describe('M13-6 frames: what is not a message closes the connection; a bad command is answered and is a strike', () => {
  async function fresh() {
    const t = makeGateway();
    const b = await guest(t, 'Alice');
    return { t, b };
  }
  const closedWith = async (b: Browser) => {
    await b.client.until(() => b.client.closed !== null);
    return b.client.closed;
  };

  it('binary, oversize, too deep, not JSON, unknown type, bad id: closed with 4002 and counted', async () => {
    const crafted: [string, string | Buffer, 'binary' | 'frame' | 'depth', boolean][] = [
      ['binary', '{"t":"ping"}', 'binary', true],
      ['oversize', JSON.stringify({ t: 'chat', id: 1, text: 'x'.repeat(MAX_FRAME_BYTES) }), 'frame', false],
      ['deep', `{"t":"chat","id":1,"text":${'['.repeat(30)}${']'.repeat(30)}}`, 'depth', false],
      ['not json', 'hello there', 'frame', false],
      ['unknown type', '{"t":"nope","id":1}', 'frame', false],
      ['id zero', '{"t":"sync","id":0}', 'frame', false],
      ['array', '[]', 'frame', false],
    ];
    for (const [what, data, reason, binary] of crafted) {
      const { t, b } = await fresh();
      b.client.send(typeof data === 'string' ? data : data.toString(), binary);
      expect(await closedWith(b), what).toMatchObject({ code: CLOSE_PROTOCOL });
      expect(counted(t.metrics, METRICS.refusals, { reason }), what).toBe(1);
    }
  });

  it('a known command with bad fields is answered badMessage with its id; 30 strikes are tolerated, the 31st closes the connection (4004)', async () => {
    const { t, b } = await fresh();
    const r = await b.cmd({ t: 'sync', extra: 1 });
    expect(r).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    for (let i = 0; i < 29; i++) await b.cmd({ t: 'sync', extra: 1 });
    expect(b.client.closed).toBeNull();
    expect(counted(t.metrics, METRICS.strikes)).toBe(30);
    b.client.send({ t: 'sync', id: 99, extra: 1 });
    expect(await closedWith(b)).toMatchObject({ code: CLOSE_REFUSED });
    expect(b.of('bye').at(-1)?.reason).toBe('Too many refused messages.');
    expect(counted(t.metrics, METRICS.refusals, { reason: 'strikes' })).toBe(1);
  });

  it('strikes come back at 2 a second: a client that slows down is not closed', async () => {
    const { t, b } = await fresh();
    for (let i = 0; i < 30; i++) await b.cmd({ t: 'sync', extra: 1 });
    t.clock.advance(10_000); // 20 tokens
    for (let i = 0; i < 20; i++) await b.cmd({ t: 'sync', extra: 1 });
    expect(b.client.closed).toBeNull();
  });

  it('close() ends every connection with 4003 and refuses new upgrades', async () => {
    const { t, b } = await fresh();
    t.gateway.close();
    expect(await closedWith(b)).toMatchObject({ code: CLOSE_STOPPING });
    expect(t.gateway.connections).toBe(0);
    expect(t.transport.connect()).toEqual({ refused: { status: 503, why: 'stopping' } });
  });
});
