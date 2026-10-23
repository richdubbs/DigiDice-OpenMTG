/**
 * M12-5a security review fixes, in process (no sockets; normal traffic only: invited guests joining and resuming with their own codes and tokens, an
 * older guest, a guest with a code the host has not got).
 *
 * - MAJOR: join attempts are budgeted per seat, and resumes have their own per-seat budget: a guest resuming over and over spends only its own seat's.
 * - The decoy ACCEPT is sealed with a key derived per INIT (no two INITs get the same ciphertext); an older guest's tag-less INIT gets each code in turn.
 * - The drop clock is an allowance for the whole game, not per drop.
 * - A lobby resume updates every guest's lobby; a guest cannot name itself like the host's "(seat N)" disambiguation; at most three codes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Connection } from '../../src/link/connection';
import { DEFAULT_LINK_OPTIONS } from '../../src/link/channel';
import { Connection as Conn } from '../../src/link/connection';
import { HostEndpoint } from '../../src/link/endpoint';
import { GuestHandshake, HostHandshake } from '../../src/link/handshake';
import { PROTOCOL_VERSION } from '../../src/protocol/messages';
import { localVersions } from '../../src/protocol/versions';
import { generateJoinCode, normalizeJoinCode } from '../../src/wire/codes';
import { helloProof } from '../../src/wire/crypto';
import { PacketType, parsePacket } from '../../src/wire/packet';
import { deck, FAST_LINK, until } from '../helpers';
import type { Datagram } from '../memory';
import { joinSeat, openTable, TABLE_LINK, type Table } from './table';

const open: Table[] = [];
const conns: Connection[] = [];
afterEach(async () => {
  for (const c of conns.splice(0)) c.destroy('test over');
  for (const t of open.splice(0)) await t.close();
});

/** A raw guest connection to the table's host holding `code`: sends a hello (with `resume` when given) and keeps what it receives. */
async function rawHello(t: Table, code: string, resume?: string): Promise<{ inbox: Record<string, unknown>[] }> {
  const conn = await t.transport.connect(FAST_LINK, code);
  conns.push(conn);
  const inbox: Record<string, unknown>[] = [];
  conn.onMessage((m) => inbox.push(m as Record<string, unknown>));
  conn.send({
    v: PROTOCOL_VERSION, type: 'hello', versions: localVersions(null), name: 'Gus', deck: resume ? { main: [], sideboard: [] } : deck({ Mountain: 40 }),
    proof: helloProof(conn.keys, conn.connId), ...(resume ? { resume } : {}),
  });
  await until(() => inbox.length > 0, 3000, 'an answer');
  return { inbox };
}

describe('MAJOR: join and resume budgets per seat', () => {
  it('a guest resuming over and over spends only its own seat\'s budget: another seat still joins, and still resumes after a drop', async () => {
    const t = await openTable(3, { order: [2], guest: { reconnect: { attempts: 20, delayMs: 100 } } });
    open.push(t);
    const gus = t.guests[0]!;
    const seat2 = t.host.codes.find((c) => c.seat === 2)!.code;
    // Gus resumes his own seat many times in a row (his own code, his own token): past his seat's burst he is refused.
    const answers: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await rawHello(t, seat2, gus.guest.session!);
      answers.push(String(r.inbox[0]!['type'] === 'error' ? r.inbox[0]!['code'] : r.inbox[0]!['type']));
    }
    expect(answers.slice(0, 5)).toEqual(['welcome', 'welcome', 'welcome', 'welcome', 'welcome']);
    expect(answers.slice(5)).toEqual(['rateLimited', 'rateLimited', 'rateLimited']);
    // Bianca joins seat 3 at once: her seat's budget is untouched.
    const bianca = await joinSeat(t.host, t.transport, 3, { reconnect: { attempts: 20, delayMs: 100 } });
    t.guests.push(bianca);
    await until(() => t.host.started, 5000, 'the start');
    // Bianca's link drops: she takes her seat back while Gus's resume budget is still spent.
    const events: string[] = [];
    bianca.guest.on('reconnected', () => events.push('back'));
    bianca.guest.connection!.destroy('cable cut');
    await until(() => events.includes('back'), 5000, 'Bianca back');
    expect(t.host.connected('p3')).toBe(true);
  }, 30000);
});

const link = { ...DEFAULT_LINK_OPTIONS };
function handshakeHost(codes: string[]) {
  const out: Datagram[] = [];
  const host = new HostHandshake({ code: codes[0]!, codes, send: (buf, to) => out.push({ buf: Buffer.from(buf), to }), link, cookieAge: 11, now: () => 1_000_000_000 });
  const made: Connection[] = [];
  host.onConnection((c) => made.push(c));
  return { host, out, made };
}
const A = normalizeJoinCode('8RFA-2QXN-K7DM-5WCT')!;
const B = normalizeJoinCode('9SGB-3RYP-M8EN-6XDV')!;
const C = normalizeJoinCode('4HJK-7MNP-2QRS-9TVW')!;
const D = normalizeJoinCode('6BCD-8FGH-3JKM-5NPQ')!;
const from = { address: '198.51.100.9', port: 40009 };

describe('the handshake (security review minors)', () => {
  it('a decoy ACCEPT is sealed with a key of its own INIT: two INITs with unknown codes never get the same sealed bytes, and it has a real ACCEPT\'s size', () => {
    const h = handshakeHost([A, B]);
    h.host.datagram(new GuestHandshake(C).init, from);
    h.host.datagram(new GuestHandshake(C).init, from);
    h.host.datagram(new GuestHandshake(A).init, from);
    const [d1, d2, real] = h.out.map((d) => parsePacket(d.buf)) as Extract<ReturnType<typeof parsePacket>, { type: 2 }>[];
    expect(d1!.type).toBe(PacketType.Accept);
    expect(d1!.sealed.equals(d2!.sealed)).toBe(false);
    expect(h.out[0]!.buf.length).toBe(h.out[2]!.buf.length);
    void real;
  });

  it('an older guest (all-zero code tag) gets each code in turn, so it completes the link with whichever code it holds', () => {
    const h = handshakeHost([A, B, C]);
    const g = new GuestHandshake(C);
    g.init.fill(0, 76, 92); // a milestone 9 INIT: no code tag
    let got: ReturnType<GuestHandshake['accept']> = null;
    let tries = 0;
    while (!got && tries < 3) {
      tries++;
      h.host.datagram(g.init, from); // the old guest repeats its INIT until an ACCEPT authenticates
      const p = parsePacket(h.out.shift()!.buf);
      if (p?.type === PacketType.Accept) got = g.accept(p);
    }
    expect(got).not.toBeNull();
    expect(tries).toBe(3); // C is the third code
    const toHost: Buffer[] = [];
    const conn = new Conn({ connId: g.connId, keys: got!.keys, role: 'guest', remote: { address: 'host', port: 1 }, send: (b) => toHost.push(Buffer.from(b)), options: link, salts: got!.salts, ownTimer: false });
    conn.send({ hello: 'old' });
    for (const b of toHost) h.host.datagram(b, from);
    expect(h.made.map((c) => c.joinCode)).toEqual([C]); // then its version-3 hello is refused with the clear version message (protocol4.test.ts)
  });

  it('a host has at most three join codes', async () => {
    expect(() => handshakeHost([A, B, C, D])).toThrow(/at most 3/);
    await expect(HostEndpoint.listen({ code: A, codes: [A, B, C, generateJoinCode()], port: 0, address: '127.0.0.1' })).rejects.toThrow(/at most 3 join codes/);
  });
});

describe('the table (security review minors)', () => {
  it('the drop allowance adds up across drops: a second drop starts from what the first one left', async () => {
    const t = await openTable(3, { host: { forfeitAfterMs: 4000 }, guest: { link: TABLE_LINK, reconnect: { attempts: 40, delayMs: 900 } } });
    open.push(t);
    await until(() => t.host.started, 5000, 'the start');
    const gus = t.guests[0]!;
    const back = () => new Promise<void>((r) => gus.guest.on('reconnected', () => r()));
    let returned = back();
    gus.guest.connection!.destroy('cable cut');
    await until(() => t.host.players().find((p) => p.id === 'p2')!.forfeitInMs !== undefined, 3000, 'the first clock');
    await returned;
    await until(() => t.host.connected('p2') && t.host.players().find((p) => p.id === 'p2')!.forfeitInMs === undefined, 3000, 'the clock stopped');
    returned = back();
    gus.guest.connection!.destroy('cable cut again');
    await until(() => t.host.players().find((p) => p.id === 'p2')!.forfeitInMs !== undefined, 3000, 'the second clock');
    const left = t.host.players().find((p) => p.id === 'p2')!.forfeitInMs!;
    expect(left).toBeLessThan(4000 - 300); // the first drop's time is gone from the allowance
    expect(left).toBeGreaterThan(0);
    await returned;
  }, 30000);

  it('a guest coming back in the lobby shows connected again in every guest\'s lobby', async () => {
    const t = await openTable(4, { order: [2, 3], guest: { link: TABLE_LINK, reconnect: { attempts: 40, delayMs: 700 } } });
    open.push(t);
    const [gus, bianca] = t.guests as [Table['guests'][0], Table['guests'][0]];
    const lobbyOf = (p: string) => bianca.guest.players.find((x) => x.id === p)?.connected;
    const returned = new Promise<void>((r) => gus.guest.on('reconnected', () => r()));
    gus.guest.connection!.destroy('cable cut');
    await until(() => lobbyOf('p2') === false, 3000, 'Bianca\'s lobby: Gus down');
    await returned;
    await until(() => lobbyOf('p2') === true, 3000, 'Bianca\'s lobby: Gus back');
  }, 30000);

  it('a guest cannot name itself like the host\'s disambiguation "(seat N)"; names compare without case', async () => {
    const t = await openTable(3, { order: [] });
    open.push(t);
    const g2 = await joinSeat(t.host, t.transport, 2, { name: 'Hana (seat 1)' });
    const g3 = await joinSeat(t.host, t.transport, 3, { name: 'HANA' });
    t.guests.push(g2, g3);
    expect(t.host.players().map((p) => p.name)).toEqual(expect.arrayContaining(['Hana', 'Hana (seat 2)', 'HANA (seat 3)']));
  }, 30000);
});
