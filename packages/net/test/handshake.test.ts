/**
 * The handshake in process (no sockets): HostHandshake gets crafted datagrams by calling `datagram` directly, and its answers land in an array.
 * Covers the X25519 handshake (audit 2026-10-12, m8), no amplification, stateless INITs, the connection caps and the handshake rate limit (m6),
 * and refusing weak chosen codes (m9).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_OPTIONS } from '../src/link/channel';
import type { Connection, Remote } from '../src/link/connection';
import { requireStrongCode } from '../src/link/endpoint';
import { GuestHandshake, HostHandshake, type HostLimits } from '../src/link/handshake';
import { normalizeJoinCode } from '../src/wire/codes';
import { newEphemeral } from '../src/wire/crypto';
import { encodeInit, INIT_BYTES, PacketType, parsePacket } from '../src/wire/packet';
import { Connection as Conn } from '../src/link/connection';
import type { Datagram } from './memory';

const CODE = normalizeJoinCode('8RFA-2QXN-K7DM-5WCT')!;
const link = { ...DEFAULT_LINK_OPTIONS };

function makeHost(limits: Partial<HostLimits> = {}, clock = { t: 1_000_000_000 }) {
  const out: Datagram[] = [];
  const host = new HostHandshake({ code: CODE, send: (buf, to) => out.push({ buf: Buffer.from(buf), to }), link, cookieAge: 11, limits, now: () => clock.t });
  const conns: Connection[] = [];
  const received: unknown[] = [];
  host.onConnection((c) => {
    conns.push(c);
    c.onMessage((m) => received.push(m));
  });
  return { host, out, conns, received, clock };
}

/** A guest that completes the handshake with `host` and sends one message; returns its connection (or null when the host gave no ACCEPT). */
function join(h: ReturnType<typeof makeHost>, from: Remote, message: unknown = { hello: 1 }, code = CODE): Connection | null {
  const g = new GuestHandshake(code);
  h.host.datagram(g.init, from);
  const accept = h.out.splice(0).map((d) => parsePacket(d.buf)).find((p) => p?.type === PacketType.Accept);
  if (!accept || accept.type !== PacketType.Accept) return null;
  const got = g.accept(accept);
  if (!got) return null;
  const toHost: Buffer[] = [];
  const conn = new Conn({ connId: g.connId, keys: got.keys, role: 'guest', remote: { address: 'host', port: 1 }, send: (b) => toHost.push(Buffer.from(b)), options: link, salts: got.salts, ownTimer: false });
  conn.send(message);
  for (const b of toHost) h.host.datagram(b, from);
  return conn;
}

const addr = (i: number): Remote => ({ address: `198.51.100.${i}`, port: 40000 + i });

describe('handshake (in process)', () => {
  it('authenticates both sides with the join code and an X25519 exchange; the first DATA0 makes the connection', () => {
    const h = makeHost();
    const conn = join(h, addr(1), { hi: 1 });
    expect(conn).not.toBeNull();
    expect(h.conns).toHaveLength(1);
    expect(h.received).toEqual([{ hi: 1 }]);
    expect(h.conns[0]!.keys.recv.equals(conn!.keys.send)).toBe(true);
    expect(h.host.stats.handshakes).toBe(1);
  });

  it('a guest with another code cannot authenticate the ACCEPT, and the host never gets a connection', () => {
    const h = makeHost();
    expect(join(h, addr(1), {}, normalizeJoinCode('9SGB-3RYP-M8EN-6XDV')!)).toBeNull();
    expect(h.conns).toHaveLength(0);
  });

  it('answers an INIT with an ACCEPT no larger than it (no amplification) and stores nothing per INIT', () => {
    const h = makeHost();
    const init = encodeInit(randomBytes(8), randomBytes(32), newEphemeral().publicKey);
    expect(init).toHaveLength(INIT_BYTES);
    h.host.datagram(init, addr(1));
    h.host.datagram(init, addr(1));
    expect(h.out).toHaveLength(2);
    expect(h.out[0]!.buf.equals(h.out[1]!.buf)).toBe(true); // same second, same answer: stateless
    expect(h.out[0]!.buf.length).toBeLessThanOrEqual(init.length);
    expect(h.host.connections).toHaveLength(0);
  });

  it('many INITs with random connection ids do not keep a joining guest out', () => {
    const h = makeHost();
    const g = new GuestHandshake(CODE);
    h.host.datagram(g.init, addr(1));
    const accept = parsePacket(h.out.splice(0)[0]!.buf)!;
    for (let i = 0; i < 300; i++) h.host.datagram(encodeInit(randomBytes(8), randomBytes(32), newEphemeral().publicKey), addr(2));
    h.out.length = 0;
    const got = accept.type === PacketType.Accept ? g.accept(accept) : null;
    expect(got).not.toBeNull();
    const toHost: Buffer[] = [];
    const conn = new Conn({ connId: g.connId, keys: got!.keys, role: 'guest', remote: addr(9), send: (b) => toHost.push(Buffer.from(b)), options: link, salts: got!.salts, ownTimer: false });
    conn.send({ hello: 1 });
    for (const b of toHost) h.host.datagram(b, addr(1));
    expect(h.received).toEqual([{ hello: 1 }]);
    expect(h.host.stats.handshakes).toBe(1);
  });

  it('drops malformed datagrams and DATA for unknown connections without throwing (audit C4)', () => {
    const h = makeHost();
    expect(() => h.host.datagram(Buffer.from('GET / HTTP/1.1\r\n\r\n'), addr(1))).not.toThrow();
    expect(() => h.host.datagram(Buffer.alloc(0), addr(1))).not.toThrow();
    const data = Buffer.alloc(60);
    data.writeUInt16BE(0x4f4d, 0);
    data.writeUInt8(2, 2);
    data.writeUInt8(PacketType.Data, 3);
    h.host.datagram(data, addr(1));
    expect(h.host.stats.dropped).toBe(3);
  });

  it('a recorded DATA0 cannot open a second connection', () => {
    const h = makeHost();
    const g = new GuestHandshake(CODE);
    h.host.datagram(g.init, addr(1));
    const accept = parsePacket(h.out.splice(0)[0]!.buf)!;
    const got = accept.type === PacketType.Accept ? g.accept(accept)! : null;
    const toHost: Buffer[] = [];
    const conn = new Conn({ connId: g.connId, keys: got!.keys, role: 'guest', remote: addr(9), send: (b) => toHost.push(Buffer.from(b)), options: link, salts: got!.salts, ownTimer: false });
    conn.send({ n: 1 });
    h.host.datagram(toHost[0]!, addr(1));
    h.conns[0]!.close('gone');
    h.host.datagram(toHost[0]!, addr(1)); // the same DATA0 once more
    expect(h.conns).toHaveLength(1);
  });
});

describe('connection limits (audit m6)', () => {
  it('keeps at most maxPending connections waiting to be admitted: a new one closes the oldest', () => {
    const h = makeHost({ maxPending: 2, maxConnections: 8 });
    for (let i = 1; i <= 3; i++) join(h, addr(i));
    expect(h.conns).toHaveLength(3);
    expect(h.conns[0]!.closed).toBe(true);
    expect(h.conns[0]!.closeReason).toMatch(/too many connections are waiting/);
    expect(h.host.connections).toHaveLength(2);
    expect(h.host.stats.evicted).toBe(1);
  });

  it('an admitted (seated) connection is not pending; past maxConnections new ones are dropped', () => {
    const h = makeHost({ maxPending: 4, maxConnections: 2 });
    join(h, addr(1));
    h.conns[0]!.admit();
    join(h, addr(2));
    h.conns[1]!.admit();
    expect(join(h, addr(3))).not.toBeNull(); // the guest finishes its side, but the host makes no connection
    expect(h.conns).toHaveLength(2);
    expect(h.conns.every((c) => !c.closed)).toBe(true);
    expect(h.host.stats.evicted).toBe(1);
  });

  it('rate-limits the DATA0s that open connections per source address, and in total', () => {
    const h = makeHost({ maxPending: 100, maxConnections: 100, handshakesPerAddress: { rate: 1, burst: 3 }, handshakesTotal: { rate: 1, burst: 5 } });
    for (let i = 0; i < 4; i++) join(h, addr(1));
    expect(h.conns).toHaveLength(3); // the fourth from the same address is over its burst
    expect(h.host.stats.rateLimited).toBe(1);
    for (let i = 0; i < 3; i++) join(h, addr(2 + i));
    expect(h.conns).toHaveLength(5); // the total burst of 5 is spent
    h.clock.t += 2000; // two seconds later: two more tokens in total
    join(h, addr(10));
    join(h, addr(11));
    expect(h.conns).toHaveLength(7);
  });

  /** A guest's INIT from `from`, and the DATA0 it would send next (not delivered). `garbage`: its sealed part is altered, so it cannot open. */
  function data0(h: ReturnType<typeof makeHost>, from: Remote, garbage = false): Buffer {
    const g = new GuestHandshake(CODE);
    h.host.datagram(g.init, from);
    const accept = parsePacket(h.out.splice(0)[0]!.buf)!;
    const got = accept.type === PacketType.Accept ? g.accept(accept)! : null;
    const toHost: Buffer[] = [];
    const conn = new Conn({ connId: g.connId, keys: got!.keys, role: 'guest', remote: addr(99), send: (b) => toHost.push(Buffer.from(b)), options: link, salts: got!.salts, ownTimer: false });
    conn.send({ hello: 1 });
    const d = Buffer.from(toHost[0]!);
    if (garbage) d[d.length - 1]! ^= 0xff;
    return d;
  }

  it('m6: the cookie binds the source address and port, so a DATA0 replayed from another source is dropped before it takes a rate-limit token', () => {
    const h = makeHost({ handshakesPerAddress: { rate: 1, burst: 1 }, handshakesTotal: { rate: 1, burst: 1 } });
    const d = data0(h, addr(1));
    h.host.datagram(d, addr(2)); // another address
    h.host.datagram(d, { ...addr(1), port: addr(1).port + 1 }); // the same address, another port
    expect(h.conns).toHaveLength(0);
    expect(h.host.stats.rateLimited).toBe(0);
    h.host.datagram(d, addr(1)); // from where its INIT came: the one token is still there
    expect(h.conns).toHaveLength(1);
    expect(h.host.stats.handshakes).toBe(1);
  });

  it('m6: replays of one cookie from many forged addresses do not spend the total budget, so a real guest still joins', () => {
    const h = makeHost({ handshakesPerAddress: { rate: 10, burst: 20 }, handshakesTotal: { rate: 1, burst: 5 } });
    const bad = data0(h, { address: '203.0.113.5', port: 4000 }, true);
    for (let i = 0; i < 500; i++) h.host.datagram(bad, { address: `10.0.${i >> 8}.${i & 255}`, port: 4000 });
    expect(h.host.stats.rateLimited).toBe(0);
    expect(join(h, addr(7), { real: 1 })).not.toBeNull();
    expect(h.received).toEqual([{ real: 1 }]);
  });

  it('m6: a DATA0 that failed to open is not tried again for its connection id (one cookie buys at most one X25519)', () => {
    const h = makeHost({ handshakesPerAddress: { rate: 1, burst: 2 }, handshakesTotal: { rate: 100, burst: 100 } });
    const from = { address: '203.0.113.5', port: 4000 };
    const bad = data0(h, from, true);
    for (let i = 0; i < 5; i++) h.host.datagram(bad, from);
    expect(h.host.stats.rateLimited).toBe(0); // only the first one took a token
    expect(join(h, from, { real: 1 })).not.toBeNull(); // the same sender still has its second token
    expect(h.received).toEqual([{ real: 1 }]);
  });

  it('one timer drives all connections: tick reaches each of them', () => {
    const h = makeHost();
    join(h, addr(1));
    join(h, addr(2));
    expect(() => h.host.tick()).not.toThrow();
    h.host.close();
    expect(h.conns.every((c) => c.closed)).toBe(true);
  });
});

describe('join code strength at the host (audit m9)', () => {
  it('the host refuses a chosen code that is easy to guess before it opens a port', () => {
    expect(() => requireStrongCode('0000-0000-0000-0000')).toThrow(/too easy to guess/);
    expect(() => requireStrongCode('7KQ2-M9XD-4TRB-HC8P')).toThrow(/too easy to guess/);
    expect(() => requireStrongCode('nope')).toThrow(/not a valid join code/);
    expect(requireStrongCode('8rfa 2qxn k7dm 5wct')).toBe(CODE);
  });
});
