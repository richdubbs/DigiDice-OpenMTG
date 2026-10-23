/**
 * M12-5a: protocol 4 and one join code per seat, in process (no sockets; normal traffic only: guests that hold a code, a guest with a code the host has
 * not got, a guest of the previous version).
 */
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { GameHost, GUEST_MESSAGE_BYTES, GUEST_MESSAGE_DEPTH } from '../../src/game/host';
import { GameGuest } from '../../src/game/guest';
import { DEFAULT_LINK_OPTIONS } from '../../src/link/channel';
import { Connection, type Remote } from '../../src/link/connection';
import { GuestHandshake, HostHandshake } from '../../src/link/handshake';
import { MemoryTransport } from '../../src/link/memory';
import { parseHostMessage, PROTOCOL_VERSION } from '../../src/protocol/messages';
import { localVersions } from '../../src/protocol/versions';
import { normalizeJoinCode } from '../../src/wire/codes';
import { helloProof, newEphemeral } from '../../src/wire/crypto';
import { encodeInit, INIT_BYTES, PacketType, parsePacket } from '../../src/wire/packet';
import { deck, FAST_LINK, fixtureDb, until } from '../helpers';
import type { Datagram } from '../memory';

const A = normalizeJoinCode('8RFA-2QXN-K7DM-5WCT')!;
const B = normalizeJoinCode('9SGB-3RYP-M8EN-6XDV')!;
const C = normalizeJoinCode('4HJK-7MNP-2QRS-9TVW')!;
const link = { ...DEFAULT_LINK_OPTIONS };
const addr = (i: number): Remote => ({ address: `198.51.100.${i}`, port: 40000 + i });

function hostWith(codes: string[]) {
  const out: Datagram[] = [];
  const host = new HostHandshake({ code: codes[0]!, codes, send: (buf, to) => out.push({ buf: Buffer.from(buf), to }), link, cookieAge: 11, now: () => 1_000_000_000 });
  const conns: Connection[] = [];
  host.onConnection((c) => conns.push(c));
  return { host, out, conns };
}

/** A guest holding `code` completes the handshake and sends one message; null when it could not authenticate the host's ACCEPT. */
function join(h: ReturnType<typeof hostWith>, code: string, from: Remote): Connection | null {
  const g = new GuestHandshake(code);
  h.host.datagram(g.init, from);
  const accept = h.out.splice(0).map((d) => parsePacket(d.buf)).find((p) => p?.type === PacketType.Accept);
  if (!accept || accept.type !== PacketType.Accept) return null;
  const got = g.accept(accept);
  if (!got) return null;
  const toHost: Buffer[] = [];
  const conn = new Connection({ connId: g.connId, keys: got.keys, role: 'guest', remote: { address: 'host', port: 1 }, send: (b) => toHost.push(Buffer.from(b)), options: link, salts: got.salts, ownTimer: false });
  conn.send({ hello: 1 });
  for (const b of toHost) h.host.datagram(b, from);
  return conn;
}

describe('one join code per seat in the handshake (M12-5a, m12 design 6)', () => {
  it('each guest\'s connection is keyed with its own code and records it (its seat); a code the host has not got cannot authenticate', () => {
    const h = hostWith([A, B]);
    expect(join(h, B, addr(1))).not.toBeNull();
    expect(join(h, A, addr(2))).not.toBeNull();
    expect(h.conns.map((c) => c.joinCode)).toEqual([B, A]);
    expect(join(h, C, addr(3))).toBeNull(); // the ACCEPT is sealed with a key nobody has: the guest reports a wrong code
    expect(h.conns).toHaveLength(2);
  });

  it('answers every INIT with an ACCEPT no larger than it, tag or none (no amplification)', () => {
    const h = hostWith([A, B]);
    const tagless = encodeInit(randomBytes(8), randomBytes(32), newEphemeral().publicKey);
    h.host.datagram(tagless, addr(1));
    h.host.datagram(new GuestHandshake(B).init, addr(1));
    expect(h.out).toHaveLength(2);
    for (const d of h.out) expect(d.buf.length).toBeLessThanOrEqual(INIT_BYTES);
  });

  it('a host with one code does not read the tag: a two-player game\'s handshake is milestone 9\'s', () => {
    const h = hostWith([A]);
    expect(join(h, A, addr(1))).not.toBeNull();
    expect(h.conns[0]!.joinCode).toBe(A);
  });
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('protocol 4 (M12-5a)', () => {
  it('a guest of protocol 3 is refused with "version" in a message its version can read', async () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(4); // RPL-3: 5 (test/rpl3/protocol5.test.ts pins it and refuses a guest of protocol 4)
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const host = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 40 }), cards: fixtureDb(), seats: 3 }, transport);
    cleanups.push(() => host.close('test over', 100));
    const rejected: string[] = [];
    host.on('rejected', (r) => rejected.push(r));
    const conn = await transport.connect(FAST_LINK, host.code);
    cleanups.push(() => conn.close('done'));
    const got: Record<string, unknown>[] = [];
    conn.onMessage((m) => got.push(m as Record<string, unknown>));
    conn.send({ v: 3, type: 'hello', versions: { ...localVersions(null), protocol: 3 }, name: 'Old', deck: { main: [], sideboard: [] }, proof: helloProof(conn.keys, conn.connId) });
    await until(() => got.length > 0, 3000, 'the refusal');
    expect(got[0]).toMatchObject({ v: 3, type: 'error', code: 'version', fatal: true });
    expect(got[0]!['message']).toBe(`Message rejected: different OpenMTG network protocols (host ${PROTOCOL_VERSION}, guest 3). Both players need the same OpenMTG version.`);
    expect(rejected).toHaveLength(1);
  });

  it('a guest of protocol 4 reads the refusal of a protocol-3 host (its error message), so the player learns why', () => {
    const e = parseHostMessage({ v: 3, type: 'error', code: 'version', message: 'Message rejected: protocol version 4 (this host speaks 3)', fatal: true });
    expect(e).toMatchObject({ type: 'error', code: 'version', fatal: true });
    expect(e && e.type === 'error' && e.message).toMatch(
      new RegExp(`^The host runs another OpenMTG version \\(network protocol 3; this one speaks ${PROTOCOL_VERSION}\\)\\. Both players need the same OpenMTG version\\.`),
    );
    expect(parseHostMessage({ v: 3, type: 'view', seq: 1, view: {}, events: [], legal: [] })).toBeNull(); // anything else of another version is dropped
  });

  it('a two-player game never sends the multiplayer messages: welcome names the host, then views (milestone 9)', async () => {
    const transport = new MemoryTransport({ maxReceiveBytes: GUEST_MESSAGE_BYTES, maxReceiveDepth: GUEST_MESSAGE_DEPTH });
    const host = await GameHost.attach({ name: 'Hana', deck: deck({ Forest: 20, 'Grizzly Bears': 20 }), cards: fixtureDb(), seed: 'two' }, transport);
    cleanups.push(() => host.close('test over', 100));
    expect(host.seats).toBe(2);
    expect(host.codes).toHaveLength(1);
    const inbox: { type: string }[] = [];
    const guest = await GameGuest.join({ host: 'memory', port: 0, code: host.code, name: 'Gus', deck: deck({ Mountain: 20, 'Hill Giant': 20 }), link: FAST_LINK, connector: (o) => transport.connect(o.link), inspect: (m) => inbox.push(m as { type: string }) });
    cleanups.push(() => guest.close());
    await until(() => guest.view !== null, 3000, 'the first view');
    expect(guest.opponent).toEqual({ id: 'p1', name: 'Hana' });
    expect(guest.seat).toBeNull();
    expect(guest.seats).toBe(2);
    expect(guest.started).toBe(true);
    expect((await guest.act({ type: 'concede', player: 'p2' })).ok).toBe(true);
    await until(() => guest.view?.result != null, 3000, 'the result');
    expect(new Set(inbox.map((m) => m.type))).toEqual(new Set(['welcome', 'view']));
    expect(inbox[0]).not.toHaveProperty('seat');
    expect(host.state!.options.multiplayer).toBeUndefined();
    expect(host.state!.players.map((p) => p.id)).toContain('p2');
  });

  it('refuses Duel Commander with more than two seats (a two-player format, m12 design 10 Q8), and seat counts other than 2-4', async () => {
    const transport = new MemoryTransport();
    await expect(GameHost.attach({ name: 'Hana', deck: deck({ Forest: 40 }), cards: fixtureDb(), seats: 3, format: 'Duel Commander' }, transport)).rejects.toThrow(/two-player format/);
    await expect(GameHost.attach({ name: 'Hana', deck: deck({ Forest: 40 }), cards: fixtureDb(), seats: 5 as never }, transport)).rejects.toThrow(/2 to 4 seats/);
  });
});
